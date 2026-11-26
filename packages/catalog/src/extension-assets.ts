import { z } from "zod";
import { createHash } from "node:crypto";

import type { ExtensionCaptureRequest } from "@research-video/contracts";
import type { SqlDatabase } from "@research-video/db-cloud";
import type {
  StoredObject,
  TranscriptObjectStore,
} from "@research-video/storage";

import { CatalogNotFoundError } from "./catalog-errors.ts";

export type ExtensionCaptureAssetRole = "top" | "passage";

export type NormalizedCaptureRectangle = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PixelCaptureRectangle = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Bytes have already been decoded and validated by the HTTP/application
 * adapter. Keeping this type free of Fastify and Buffer makes the catalog
 * callable from the paired extension gateway as well as the ordinary API.
 */
export type ExtensionCaptureRaster = {
  bytes: Uint8Array;
  mimeType: "image/png";
  width: number;
  height: number;
  normalizedRectangles: NormalizedCaptureRectangle[];
  pixelRectangles: PixelCaptureRectangle[];
};

export type ExtensionCaptureRasters = Partial<
  Record<ExtensionCaptureAssetRole, ExtensionCaptureRaster>
>;

const SuppliedPictureProvenance = z.strictObject({
  kind: z.literal("user_supplied"),
  source: z.literal("browser_extension"),
  principal: z.strictObject({
    principalKind: z.literal("user"),
    principalId: z.uuid(),
  }),
  suppliedAt: z.iso.datetime({ offset: true }),
  sourceUrlDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
});

export type ExtensionCaptureAssetReceipt = {
  role: ExtensionCaptureAssetRole;
  revisionId: string;
  versionId: string;
  sha256: string;
  byteCount: number;
  mimeType: "image/png";
  width: number;
  height: number;
  normalizedRectangles: NormalizedCaptureRectangle[];
  pixelRectangles: PixelCaptureRectangle[];
  provenance: z.infer<typeof SuppliedPictureProvenance>;
};

export type ExtensionCaptureReceipt = {
  captureId: string;
  kind: ExtensionCaptureRequest["kind"];
  sourceId: string;
  itemId?: string;
  pageUrl?: string;
  assets: ExtensionCaptureAssetReceipt[];
  missingPictures: ExtensionCaptureAssetRole[];
};

type Session = Pick<SqlDatabase, "query">;

export class ExtensionCaptureAssetUnavailable extends Error {
  readonly statusCode = 503;
  readonly code = "extension_capture_asset_unavailable";

  constructor() {
    super("The captured browser image could not be verified. Try again later.");
  }
}

export function extensionCaptureFingerprint(
  request: ExtensionCaptureRequest,
): string {
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function extensionCaptureObjectKey(
  projectId: string,
  captureId: string,
  role: ExtensionCaptureAssetRole,
  sha256: string,
) {
  return `projects/${projectId.toLowerCase()}/extension-captures/${captureId.toLowerCase()}/${role}/${sha256}`;
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  return (
    left.byteLength === right.byteLength &&
    Buffer.from(left).equals(Buffer.from(right))
  );
}

async function verifyStored(
  store: TranscriptObjectStore,
  key: string,
  stored: StoredObject,
  expected: ExtensionCaptureRaster,
  sha256: string,
) {
  if (
    stored.key !== key ||
    stored.contentType !== expected.mimeType ||
    stored.sha256 !== sha256 ||
    stored.bytes.byteLength !== expected.bytes.byteLength ||
    digest(stored.bytes) !== sha256 ||
    !sameBytes(stored.bytes, expected.bytes)
  )
    throw new ExtensionCaptureAssetUnavailable();
  // Verify the exact immutable version returned by the store. A store may
  // return a provisional put result, and a later read is the only evidence
  // that the pinned bytes are actually available.
  const pinned = await store.get(key, stored.versionId);
  if (
    !pinned ||
    pinned.versionId !== stored.versionId ||
    pinned.key !== key ||
    pinned.contentType !== expected.mimeType ||
    pinned.bytes.byteLength !== expected.bytes.byteLength ||
    pinned.sha256 !== sha256 ||
    digest(pinned.bytes) !== sha256 ||
    !sameBytes(pinned.bytes, expected.bytes)
  )
    throw new ExtensionCaptureAssetUnavailable();
  return pinned;
}

/**
 * Put each raster under a checksum-addressed key. A prior uncommitted write
 * with the same key is safely reused; the catalog transaction below is what
 * makes the version reachable to authorized readers.
 */
export async function keepExtensionCaptureAssets(
  store: TranscriptObjectStore,
  projectId: string,
  captureId: string,
  rasters: ExtensionCaptureRasters,
) {
  const references: Array<{
    role: ExtensionCaptureAssetRole;
    key: string;
    stored: StoredObject;
    raster: ExtensionCaptureRaster;
  }> = [];
  for (const role of ["top", "passage"] as const) {
    const raster = rasters[role];
    if (!raster) continue;
    const sha256 = digest(raster.bytes);
    const key = extensionCaptureObjectKey(projectId, captureId, role, sha256);
    const object =
      (await store.get(key)) ??
      (await store.put({
        key,
        bytes: raster.bytes,
        contentType: raster.mimeType,
        sha256,
      }));
    const stored = await verifyStored(store, key, object, raster, sha256);
    references.push({ role, key, stored, raster });
  }
  return references;
}

export async function insertExtensionCaptureAssets(
  tx: Session,
  projectId: string,
  captureId: string,
  sourceId: string,
  itemId: string | undefined,
  references: Awaited<ReturnType<typeof keepExtensionCaptureAssets>>,
  sourceUrl: string,
  principal: string,
  now: string,
) {
  for (const { role, key, stored, raster } of references) {
    await tx.query(
      `INSERT INTO extension_capture_assets(
         project_id,capture_id,role,source_id,item_id,object_key,
         object_version_id,sha256,byte_size,mime_type,width,height,
         normalized_rectangles,pixel_rectangles,provenance,created_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        projectId,
        captureId,
        role,
        sourceId,
        itemId ?? null,
        key,
        stored.versionId,
        stored.sha256,
        stored.bytes.byteLength,
        raster.mimeType,
        raster.width,
        raster.height,
        JSON.stringify(raster.normalizedRectangles),
        JSON.stringify(raster.pixelRectangles),
        JSON.stringify({
          kind: "user_supplied",
          source: "browser_extension",
          principal: { principalKind: "user", principalId: principal },
          suppliedAt: now,
          sourceUrlDigest: "sha256:" + digest(Buffer.from(sourceUrl)),
        }),
        now,
      ],
    );
  }
}

function parseRectangles(value: unknown): {
  normalized: NormalizedCaptureRectangle[];
  pixels: PixelCaptureRectangle[];
} {
  if (!value || typeof value !== "object")
    return { normalized: [], pixels: [] };
  const row = value as Record<string, unknown>;
  const normalized = Array.isArray(row.normalized_rectangles)
    ? row.normalized_rectangles
    : [];
  const pixels = Array.isArray(row.pixel_rectangles)
    ? row.pixel_rectangles
    : [];
  return {
    normalized: normalized as NormalizedCaptureRectangle[],
    pixels: pixels as PixelCaptureRectangle[],
  };
}

function mapAsset(row: Record<string, unknown>): ExtensionCaptureAssetReceipt {
  const rectangles = parseRectangles(row);
  const provenance = SuppliedPictureProvenance.safeParse(row.provenance);
  if (!provenance.success) throw new ExtensionCaptureAssetUnavailable();
  return {
    role: row.role as ExtensionCaptureAssetRole,
    revisionId: String(row.revision_id),
    versionId: String(row.object_version_id),
    sha256: String(row.sha256),
    byteCount: Number(row.byte_size),
    mimeType: "image/png",
    width: Number(row.width),
    height: Number(row.height),
    normalizedRectangles: rectangles.normalized,
    pixelRectangles: rectangles.pixels,
    provenance: provenance.data,
  };
}

export async function readExtensionCaptureReceipt(
  db: Session,
  projectId: string,
  captureId: string,
): Promise<ExtensionCaptureReceipt> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT c.capture_id,c.kind,c.source_id,c.item_id,c.page_url,
       a.role,a.revision_id,a.object_version_id,a.sha256,a.byte_size,a.mime_type,a.width,a.height,
       a.normalized_rectangles,a.pixel_rectangles,a.provenance
     FROM extension_captures c
     LEFT JOIN extension_capture_assets a
       ON a.project_id=c.project_id AND a.capture_id=c.capture_id
     WHERE c.project_id=$1 AND c.capture_id=$2
     ORDER BY a.role`,
    [projectId, captureId],
  );
  const first = rows[0];
  if (!first) throw new CatalogNotFoundError("Extension capture not found.");
  const assets = rows.filter((row) => row.role != null).map(mapAsset);
  const expected: ExtensionCaptureAssetRole[] =
    first.kind === "audio" ? [] : ["top", "passage"];
  return {
    captureId: String(first.capture_id),
    kind: first.kind as ExtensionCaptureRequest["kind"],
    sourceId: String(first.source_id),
    ...(first.item_id ? { itemId: String(first.item_id) } : {}),
    ...(first.page_url ? { pageUrl: String(first.page_url) } : {}),
    assets,
    missingPictures: expected.filter(
      (role) => !assets.some((asset) => asset.role === role),
    ),
  };
}

export async function readExtensionCaptureAsset(
  db: Session,
  store: TranscriptObjectStore,
  projectId: string,
  captureId: string,
  role: ExtensionCaptureAssetRole,
  revisionId?: string,
) {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT revision_id,object_key,object_version_id,sha256,byte_size,mime_type,
       width,height,normalized_rectangles,pixel_rectangles,provenance
     FROM extension_capture_assets
     WHERE project_id=$1 AND capture_id=$2 AND role=$3 AND ($4::uuid IS NULL OR revision_id=$4)`,
    [projectId, captureId, role, revisionId ?? null],
  );
  const row = rows[0];
  if (!row) throw new CatalogNotFoundError("Captured browser image not found.");
  const key = String(row.object_key);
  const versionId = String(row.object_version_id);
  const object = await store.get(key, versionId);
  if (
    !object ||
    object.key !== key ||
    object.versionId !== versionId ||
    object.contentType !== row.mime_type ||
    object.bytes.byteLength !== Number(row.byte_size) ||
    object.sha256 !== row.sha256 ||
    digest(object.bytes) !== row.sha256
  )
    throw new ExtensionCaptureAssetUnavailable();
  return { object, receipt: mapAsset({ ...row, role }) };
}
