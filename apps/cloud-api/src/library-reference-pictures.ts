import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  StillAssetRoleSchema,
  type AuthenticatedActor,
} from "@research-video/contracts";
import {
  InvalidStillImage,
  MAX_STILL_BYTES,
  prepareStill,
} from "@research-video/media/still-images";
import type { CloudApiDependencies } from "./app.ts";

const OwnerParams = z.strictObject({
  projectId: z.uuid(),
  ownerKind: z.enum(["source", "quote"]),
  ownerId: z.uuid(),
});
const AssetParams = OwnerParams.extend({ role: StillAssetRoleSchema });
const UploadMetadata = z.strictObject({
  expectedRevisionId: z.uuid().nullable(),
});
const DeleteMetadata = z.strictObject({ expectedRevisionId: z.uuid() });
const maxMetadataBytes = 4096;
const maxMultipartBytes = MAX_STILL_BYTES + 2 * maxMetadataBytes;
const base =
  "/api/projects/:projectId/library-reference-pictures/:ownerKind/:ownerId";

class ReferencePictureUploadError extends Error {
  readonly code = "invalid_reference_picture_upload";
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

async function readUpload(request: FastifyRequest) {
  const type = request.headers["content-type"];
  if (
    !type?.startsWith("multipart/form-data;") ||
    !Buffer.isBuffer(request.body)
  )
    throw new ReferencePictureUploadError(
      400,
      "Send one picture and JSON metadata as multipart form data.",
    );
  let data: FormData;
  try {
    data = await new Response(new Uint8Array(request.body), {
      headers: { "content-type": type },
    }).formData();
  } catch {
    throw new ReferencePictureUploadError(
      400,
      "The picture upload is malformed.",
    );
  }
  const metadata = data.get("metadata");
  const image = data.get("image");
  let count = 0;
  data.forEach(() => count++);
  if (
    count !== 2 ||
    typeof metadata !== "string" ||
    !image ||
    typeof image === "string" ||
    Buffer.byteLength(metadata) > maxMetadataBytes
  )
    throw new ReferencePictureUploadError(
      400,
      "Send exactly one picture and one JSON metadata field.",
    );
  if (image.size > MAX_STILL_BYTES)
    throw new ReferencePictureUploadError(
      413,
      "The picture exceeds the 20 MiB limit.",
    );
  let fields: unknown;
  try {
    fields = JSON.parse(metadata);
  } catch {
    throw new ReferencePictureUploadError(
      400,
      "The picture metadata is not valid JSON.",
    );
  }
  return {
    metadata: UploadMetadata.parse(fields),
    bytes: Buffer.from(await image.arrayBuffer()),
  };
}

export function registerLibraryReferencePictureRoutes(
  app: FastifyInstance,
  { catalog, authenticate }: CloudApiDependencies,
) {
  const writes = new WeakMap<FastifyRequest, { actor: AuthenticatedActor }>();
  let inFlight = 0;
  function finish(request: FastifyRequest) {
    if (writes.delete(request)) inFlight--;
  }
  app.addContentTypeParser(
    "multipart/form-data",
    { parseAs: "buffer", bodyLimit: maxMultipartBytes },
    (_request, body, done) => done(null, body),
  );
  app.addHook("onRequest", async (request) => {
    if (request.method !== "POST") return;
    const { projectId, ownerKind, ownerId } = OwnerParams.parse(request.params);
    const actor = await authenticate(request);
    // Reject view-only/foreign-owner uploads before parsing image data.
    await catalog.library.authorizeReferencePictureWrite(
      actor,
      projectId,
      ownerKind,
      ownerId,
    );
    if (inFlight >= 2)
      throw new ReferencePictureUploadError(
        429,
        "Other pictures are uploading. Try again shortly.",
      );
    writes.set(request, { actor });
    inFlight++;
  });
  app.addHook("onResponse", async (request) => finish(request));
  app.addHook("onRequestAbort", async (request) => finish(request));

  app.post(base, { bodyLimit: maxMultipartBytes }, async (request, reply) => {
    const { projectId, ownerKind, ownerId } = OwnerParams.parse(request.params);
    const actor = writes.get(request)?.actor;
    if (!actor)
      throw new ReferencePictureUploadError(400, "The upload was interrupted.");
    const { metadata, bytes } = await readUpload(request);
    let images;
    try {
      images = await prepareStill(bytes);
    } catch (error) {
      if (error instanceof InvalidStillImage)
        throw new ReferencePictureUploadError(400, error.message);
      throw error;
    }
    const manifest = await catalog.library.putReferencePicture(
      actor,
      projectId,
      ownerKind,
      ownerId,
      metadata.expectedRevisionId,
      images,
    );
    return reply
      .header("Cache-Control", "private, no-store")
      .code(201)
      .send(manifest);
  });

  app.get(base, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const { projectId, ownerKind, ownerId } = OwnerParams.parse(request.params);
    return catalog.library.getReferencePictureManifest(
      await authenticate(request),
      projectId,
      ownerKind,
      ownerId,
    );
  });

  app.get(base + "/:role", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const { projectId, ownerKind, ownerId, role } = AssetParams.parse(
      request.params,
    );
    const object = await catalog.library.getReferencePictureObject(
      await authenticate(request),
      projectId,
      ownerKind,
      ownerId,
      role,
    );
    if (role === "original") reply.header("Content-Disposition", "attachment");
    return reply
      .type(object.contentType)
      .header("X-Content-Type-Options", "nosniff")
      .send(Buffer.from(object.bytes));
  });

  app.delete(base, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const { projectId, ownerKind, ownerId } = OwnerParams.parse(request.params);
    const { expectedRevisionId } = DeleteMetadata.parse(request.body);
    await catalog.library.deleteReferencePicture(
      await authenticate(request),
      projectId,
      ownerKind,
      ownerId,
      expectedRevisionId,
    );
    return reply.code(204).send();
  });
}
