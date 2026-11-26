import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  ExtensionCaptureRequestSchema,
  type AuthenticatedActor,
  type ExtensionCaptureRequest,
} from "@research-video/contracts";
import type {
  ExtensionCaptureRasters,
  ExtensionCaptureRaster,
  PixelCaptureRectangle,
  NormalizedCaptureRectangle,
} from "@research-video/catalog";
import {
  InvalidStillImage,
  prepareStill,
} from "@research-video/media/still-images";

import type { CloudApiDependencies } from "./app.ts";

const ProjectCaptureParams = z.object({ projectId: z.uuid() });
const CaptureParams = ProjectCaptureParams.extend({ captureId: z.uuid() });
const AssetParams = CaptureParams.extend({
  role: z.enum(["top", "passage"]),
});
const ItemParams = ProjectCaptureParams.extend({ itemId: z.uuid() });
const SourceParams = ProjectCaptureParams.extend({ sourceId: z.uuid() });

const MAX_CAPTURE_BODY_BYTES = 29 * 1024 * 1024;

export class ExtensionCaptureError extends Error {
  readonly code = "extension_capture_invalid";

  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

function pixelRectangles(
  rectangles: readonly NormalizedCaptureRectangle[],
  width: number,
  height: number,
): PixelCaptureRectangle[] {
  return rectangles.map((rectangle) => {
    const x = Math.floor(rectangle.x * width);
    const y = Math.floor(rectangle.y * height);
    const right = Math.ceil((rectangle.x + rectangle.width) * width);
    const bottom = Math.ceil((rectangle.y + rectangle.height) * height);
    if (
      x < 0 ||
      y < 0 ||
      right > width ||
      bottom > height ||
      right <= x ||
      bottom <= y
    )
      throw new ExtensionCaptureError(
        400,
        "The browser highlight does not fit inside its captured image.",
      );
    return { x, y, width: right - x, height: bottom - y };
  });
}

async function decodeRaster(
  picture: { data: string; width: number; height: number },
  normalizedRectangles: readonly NormalizedCaptureRectangle[],
): Promise<ExtensionCaptureRaster> {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(picture.data, "base64");
  } catch {
    throw new ExtensionCaptureError(
      400,
      "The captured image is not valid base64.",
    );
  }
  if (!bytes.length)
    throw new ExtensionCaptureError(400, "The captured image is empty.");
  let decoded;
  try {
    decoded = await prepareStill(bytes);
  } catch (error) {
    if (error instanceof InvalidStillImage)
      throw new ExtensionCaptureError(400, error.message);
    throw error;
  }
  if (decoded.original.mimeType !== "image/png")
    throw new ExtensionCaptureError(
      400,
      "Browser capture images must be PNGs.",
    );
  if (
    decoded.original.width !== picture.width ||
    decoded.original.height !== picture.height
  )
    throw new ExtensionCaptureError(
      400,
      "The supplied image dimensions do not match its decoded PNG.",
    );
  return {
    bytes: decoded.original.bytes,
    mimeType: "image/png",
    // These dimensions come from the decoded PNG, never from a claimed
    // device-pixel ratio or CSS viewport size.
    width: decoded.original.width,
    height: decoded.original.height,
    normalizedRectangles: [...normalizedRectangles],
    pixelRectangles: pixelRectangles(
      normalizedRectangles,
      decoded.original.width,
      decoded.original.height,
    ),
  };
}

export async function decodeExtensionCaptureRasters(
  input: ExtensionCaptureRequest,
): Promise<ExtensionCaptureRasters> {
  const result: ExtensionCaptureRasters = {};
  if (input.kind === "page" || input.kind === "quote") {
    if (input.top) result.top = await decodeRaster(input.top, []);
    if (input.passage) {
      const rectangles =
        input.kind === "quote" ? (input.quote.highlight?.rectangles ?? []) : [];
      result.passage = await decodeRaster(input.passage, rectangles);
    }
  }
  return result;
}

export async function ingestChromeCapture(
  catalog: CloudApiDependencies["catalog"],
  actor: AuthenticatedActor,
  projectId: string,
  parsed: ExtensionCaptureRequest,
) {
  const rasters = await decodeExtensionCaptureRasters(parsed);
  return catalog.library.createExtensionCapture(
    actor,
    projectId,
    parsed,
    rasters,
  );
}

export function registerExtensionCaptureRoutes(
  app: FastifyInstance,
  dependencies: CloudApiDependencies,
) {
  const { catalog, authenticate } = dependencies;
  app.post(
    "/api/projects/:projectId/extension-captures",
    {
      bodyLimit: MAX_CAPTURE_BODY_BYTES,
      onRequest: async (request) => {
        const { projectId } = ProjectCaptureParams.parse(request.params);
        await catalog.authorizeSourceWrite(
          await authenticate(request),
          projectId,
        );
      },
    },
    async (request, reply) => {
      const { projectId } = ProjectCaptureParams.parse(request.params);
      const actor = await authenticate(request);
      const parsed = ExtensionCaptureRequestSchema.parse(request.body);
      const result = await ingestChromeCapture(
        catalog,
        actor,
        projectId,
        parsed,
      );
      return reply.code(201).send(result);
    },
  );

  app.get(
    "/api/projects/:projectId/extension-captures/:captureId",
    async (request, reply) => {
      const { projectId, captureId } = CaptureParams.parse(request.params);
      reply.header("cache-control", "private, no-store");
      return catalog.library.getExtensionCapture(
        await authenticate(request),
        projectId,
        captureId,
      );
    },
  );

  app.get(
    "/api/projects/:projectId/extension-captures/:captureId/assets/:role",
    async (request, reply) => {
      const { projectId, captureId, role } = AssetParams.parse(request.params);
      const { revisionId } = z
        .strictObject({ revisionId: z.uuid().optional() })
        .parse(request.query);
      const result = await catalog.library.getExtensionCaptureAsset(
        await authenticate(request),
        projectId,
        captureId,
        role,
        revisionId,
      );
      reply
        .header("cache-control", "private, no-store")
        .header("x-content-type-options", "nosniff")
        .type(result.object.contentType);
      return reply.send(Buffer.from(result.object.bytes));
    },
  );

  // Stable Library discovery for downstream consumers (including a future
  // Timeline placement adapter) does not require callers to persist the
  // transient capture request UUID themselves.
  app.get(
    "/api/projects/:projectId/items/:itemId/extension-capture",
    async (request, reply) => {
      const { projectId, itemId } = ItemParams.parse(request.params);
      reply.header("cache-control", "private, no-store");
      return catalog.library.getExtensionCaptureForItem(
        await authenticate(request),
        projectId,
        itemId,
      );
    },
  );

  app.get(
    "/api/projects/:projectId/sources/:sourceId/extension-captures",
    async (request, reply) => {
      const { projectId, sourceId } = SourceParams.parse(request.params);
      reply.header("cache-control", "private, no-store");
      const { offset } = z
        .strictObject({
          offset: z.coerce.number().int().min(0).max(2147483647).default(0),
        })
        .parse(request.query);
      return catalog.library.listExtensionCapturesForSource(
        await authenticate(request),
        projectId,
        sourceId,
        offset,
      );
    },
  );
}
