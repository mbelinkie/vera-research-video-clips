import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  CreateSourceRequestSchema,
  StillAssetRoleSchema,
  StillCropRequestSchema,
  StillPageCropSchema,
  StillProvenanceUrlSchema,
  StillUploadSchema,
  StillUrlImportSchema,
  type AuthenticatedActor,
  type StillAssetManifest,
  type StillUpload,
} from "@research-video/contracts";
import {
  InvalidStillImage,
  MAX_STILL_BYTES,
  prepareStill,
} from "@research-video/media/still-images";
import {
  CaptureDenied,
  inspectPublicUrl,
  NodePinnedTransport,
  PublicEgressGuard,
  SystemDnsResolver,
} from "@research-video/providers/public-egress";
import type { CloudApiDependencies } from "./app.ts";

const ProjectParams = z.object({ projectId: z.uuid() });
const StillParams = ProjectParams.extend({ itemId: z.uuid() });
const MaxMetadataBytes = 64 * 1024;
const MaxMultipartBytes = MAX_STILL_BYTES + 2 * MaxMetadataBytes;
const base = "/api/projects/:projectId/stills";

export type PublicStillReader = (
  url: string,
) => Promise<{ bytes: Buffer; finalUrl: string }>;

class StillImportError extends Error {
  readonly code = "still_import_failed";
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function createPublicStillReader(
  guard: Pick<PublicEgressGuard, "fetch"> = new PublicEgressGuard(
    new SystemDnsResolver(),
    new NodePinnedTransport(),
    { maxRedirects: 5, maxResponseBytes: MAX_STILL_BYTES },
  ),
): PublicStillReader {
  let active = 0;
  return async (url) => {
    if (active >= 2)
      throw new StillImportError(
        429,
        "Other images are downloading. Try again shortly.",
      );
    active++;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new StillImportError(504, "The image download timed out."));
      }, 12_000);
    });
    // A pending OS DNS lookup keeps its slot until it finishes.
    const download = guard
      .fetch(url, "GET", abort.signal)
      .finally(() => active--);
    try {
      const response = await Promise.race([download, deadline]);
      if (response.status !== 200)
        throw new StillImportError(
          422,
          "The URL did not return an accessible image.",
        );
      return { bytes: response.body, finalUrl: response.finalUrl };
    } finally {
      clearTimeout(timer);
    }
  };
}

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readMultipart(request: FastifyRequest) {
  const type = request.headers["content-type"];
  if (!type || !Buffer.isBuffer(request.body))
    throw new StillImportError(
      400,
      "Send an image and metadata as multipart form data.",
    );
  let data: FormData;
  try {
    data = await new Response(new Uint8Array(request.body), {
      headers: { "content-type": type },
    }).formData();
  } catch {
    throw new StillImportError(
      400,
      "The image upload is incomplete or malformed.",
    );
  }
  const metadata = data.get("metadata");
  const image = data.get("image");
  let fieldCount = 0;
  data.forEach(() => fieldCount++);
  if (
    fieldCount !== 2 ||
    typeof metadata !== "string" ||
    !image ||
    typeof image === "string" ||
    Buffer.byteLength(metadata) > MaxMetadataBytes
  ) {
    throw new StillImportError(
      400,
      "Send exactly one image and one JSON metadata field.",
    );
  }
  if (image.size > MAX_STILL_BYTES)
    throw new StillImportError(
      413,
      "This image exceeds the upload size limit.",
    );
  let fields: unknown;
  try {
    fields = JSON.parse(metadata);
  } catch {
    throw new StillImportError(400, "The image metadata must be valid JSON.");
  }
  return { fields, bytes: Buffer.from(await image.arrayBuffer()) };
}

export function registerStillRoutes(
  app: FastifyInstance,
  dependencies: CloudApiDependencies,
) {
  const { catalog, authenticate } = dependencies;
  const readPublicStill =
    dependencies.publicStillReader ?? createPublicStillReader();
  const writes = new WeakMap<
    FastifyRequest,
    { actor: AuthenticatedActor; projectId: string }
  >();
  let inFlight = 0;
  const finish = (request: FastifyRequest) => {
    if (writes.delete(request)) inFlight--;
  };

  app.addContentTypeParser(
    "multipart/form-data",
    { parseAs: "buffer", bodyLimit: MaxMultipartBytes },
    (_request, body, done) => done(null, body),
  );
  app.addHook("onRequest", async (request) => {
    if (request.method !== "POST") return;
    const { projectId } = ProjectParams.parse(request.params);
    const actor = await authenticate(request);
    await catalog.authorizeSourceWrite(actor, projectId);
    if (inFlight >= 2)
      throw new StillImportError(
        429,
        "Other images are being saved. Try again shortly.",
      );
    writes.set(request, { actor, projectId });
    inFlight++;
  });
  app.addHook("onResponse", async (request) => finish(request));
  app.addHook("onRequestAbort", async (request) => finish(request));

  const writeContext = (request: FastifyRequest) => {
    const context = writes.get(request);
    if (!context)
      throw new StillImportError(400, "The upload was interrupted.");
    return context;
  };

  const publish = async (
    request: FastifyRequest,
    metadata: StillUpload,
    bytes: Buffer,
    provenance: Omit<StillAssetManifest["provenance"], "inputSha256">,
    sourceId?: string,
  ) => {
    const { actor, projectId } = writeContext(request);
    if (bytes.byteLength > MAX_STILL_BYTES)
      throw new StillImportError(413, "This image exceeds the size limit.");
    const inputSha256 = digest(bytes);
    let images;
    try {
      images = await prepareStill(bytes, provenance.crop);
    } catch (error) {
      if (error instanceof InvalidStillImage)
        throw new StillImportError(400, error.message);
      throw error;
    }
    const source = sourceId
      ? { id: sourceId }
      : {
          create: CreateSourceRequestSchema.parse({
            kind: "image",
            bibliography: {
              title: { value: metadata.title, state: "confirmed" },
              ...(metadata.credit && {
                credit: { value: metadata.credit, state: "confirmed" },
              }),
              ...(provenance.sourceUrl && {
                url: { value: provenance.sourceUrl, state: "confirmed" },
              }),
            },
            details: {
              originalUrl: provenance.sourceUrl,
              pageUrl: provenance.pageUrl,
              altText: metadata.altText,
              width: images.display.width,
              height: images.display.height,
            },
          }),
        };
    return catalog.library.publishStill(actor, projectId, {
      metadata,
      images,
      provenance: { altText: metadata.altText, ...provenance, inputSha256 },
      source,
    });
  };

  app.post(base + "/from-url", async (request, reply) => {
    const { url, ...metadata } = StillUrlImportSchema.parse(request.body);
    let image;
    try {
      const target = inspectPublicUrl(url);
      image = await readPublicStill(target.canonicalUrl);
      inspectPublicUrl(image.finalUrl);
    } catch (error) {
      if (error instanceof CaptureDenied) {
        throw new StillImportError(
          error.code === "response_too_large" ? 413 : 400,
          error.safeMessage,
        );
      }
      if (error instanceof StillImportError) throw error;
      throw new StillImportError(422, "The image could not be downloaded.");
    }
    const still = await publish(request, metadata, image.bytes, {
      kind: "url",
      sourceUrl: url,
      resolvedUrl: image.finalUrl,
      pageUrl: metadata.pageUrl,
    });
    return reply.code(201).send(still);
  });

  app.post(
    base + "/from-file",
    { bodyLimit: MaxMultipartBytes },
    async (request, reply) => {
      const { fields, bytes } = await readMultipart(request);
      const metadata = StillUploadSchema.parse(fields);
      const still = await publish(request, metadata, bytes, {
        kind: "file",
        sourceUrl: metadata.originalUrl,
        pageUrl: metadata.pageUrl,
      });
      return reply.code(201).send(still);
    },
  );

  app.post(
    base + "/from-page-picture",
    { bodyLimit: MaxMultipartBytes },
    async (request, reply) => {
      const { fields, bytes } = await readMultipart(request);
      const { sourceId, crop, ...metadata } = StillPageCropSchema.parse(fields);
      const { actor, projectId } = writeContext(request);
      const source = await catalog.library.getSource(
        actor,
        projectId,
        sourceId,
      );
      if (source.kind !== "web_page")
        throw new StillImportError(
          400,
          "Choose a web-page source for the picture.",
        );
      const pageUrl = StillProvenanceUrlSchema.safeParse(
        source.bibliography.url?.value,
      ).data;
      const still = await publish(
        request,
        metadata,
        bytes,
        {
          kind: "page_picture",
          sourceUrl: metadata.originalUrl,
          pageUrl: metadata.pageUrl ?? pageUrl,
          crop,
        },
        sourceId,
      );
      return reply.code(201).send(still);
    },
  );

  app.post(base + "/:itemId/crop", async (request, reply) => {
    const { itemId } = StillParams.parse(request.params);
    const { crop, ...metadata } = StillCropRequestSchema.parse(request.body);
    const { actor, projectId } = writeContext(request);
    const parent = await catalog.library.getItem(actor, projectId, itemId);
    const kept = await catalog.library.getStillObject(
      actor,
      projectId,
      itemId,
      "original",
    );
    const { sourceUrl, pageUrl } = kept.provenance;
    const still = await publish(
      request,
      metadata,
      Buffer.from(kept.bytes),
      {
        kind: "still_crop",
        parentItemId: itemId,
        sourceUrl,
        pageUrl,
        crop,
      },
      parent.sourceId,
    );
    return reply.code(201).send(still);
  });

  app.get(base + "/:itemId/assets", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const { projectId, itemId } = StillParams.parse(request.params);
    return catalog.library.getStillManifest(
      await authenticate(request),
      projectId,
      itemId,
    );
  });

  app.get(base + "/:itemId/assets/:role", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const { projectId, itemId, role } = StillParams.extend({
      role: StillAssetRoleSchema,
    }).parse(request.params);
    const object = await catalog.library.getStillObject(
      await authenticate(request),
      projectId,
      itemId,
      role,
    );
    if (role === "original") reply.header("Content-Disposition", "attachment");
    return reply
      .type(object.contentType)
      .header("X-Content-Type-Options", "nosniff")
      .send(Buffer.from(object.bytes));
  });
}
