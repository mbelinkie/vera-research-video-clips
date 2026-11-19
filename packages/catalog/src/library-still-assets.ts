import { createHash } from "node:crypto";
import {
  StillAssetManifestSchema,
  StillAssetRoleSchema,
  StillAssetSchema,
  type StillAsset,
  type StillAssetManifest,
  type StillAssetRole,
} from "@research-video/contracts";
import type { SqlDatabase } from "@research-video/db-cloud";
import type { TranscriptObjectStore } from "@research-video/storage";
import { CatalogNotFoundError } from "./catalog-errors.ts";

type Session = Pick<SqlDatabase, "query">;
type Image = Pick<StillAsset, "mimeType" | "width" | "height"> & {
  bytes: Uint8Array;
};
export type StillImages = Record<StillAssetRole, Image>;

export class StillBytesUnavailable extends Error {
  readonly statusCode = 503;
  readonly code = "still_bytes_unavailable";

  constructor() {
    super("The kept image could not be verified. Try again later.");
  }
}

const imageDigest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

function stillKey(
  projectId: string,
  itemId: string,
  role: StillAssetRole,
  sha256: string,
) {
  return `projects/${projectId.toLowerCase()}/library/stills/${itemId.toLowerCase()}/${role}/${sha256}`;
}

export async function verifiedStillObject(
  store: TranscriptObjectStore,
  key: string,
  asset: StillAsset,
) {
  const object = await store.get(key, asset.versionId).catch(() => undefined);
  if (
    !object ||
    object.key !== key ||
    object.versionId !== asset.versionId ||
    object.contentType !== asset.mimeType ||
    object.bytes.byteLength !== asset.byteCount ||
    object.sha256 !== asset.sha256 ||
    imageDigest(object.bytes) !== asset.sha256
  )
    throw new StillBytesUnavailable();
  return object;
}

export async function keepStillAssets(
  store: TranscriptObjectStore,
  projectId: string,
  itemId: string,
  images: StillImages,
) {
  const references = [];
  for (const role of StillAssetRoleSchema.options) {
    const { bytes, mimeType, width, height } = images[role];
    const sha256 = imageDigest(bytes);
    const key = stillKey(projectId, itemId, role, sha256);
    const stored = await store
      .put({ key, bytes, contentType: mimeType, sha256 })
      .catch(() => {
        throw new StillBytesUnavailable();
      });
    const asset = StillAssetSchema.parse({
      versionId: stored.versionId,
      sha256,
      byteCount: bytes.byteLength,
      mimeType,
      width,
      height,
    });
    await verifiedStillObject(store, key, asset);
    references.push({ role, key, asset });
  }
  return references;
}

export async function insertStillAssets(
  tx: Session,
  projectId: string,
  itemId: string,
  references: Awaited<ReturnType<typeof keepStillAssets>>,
  provenance: StillAssetManifest["provenance"],
) {
  for (const { role, key, asset } of references) {
    await tx.query(
      `INSERT INTO library_still_assets(
        project_id,item_id,role,object_key,object_version_id,sha256,
        byte_size,mime_type,width,height,provenance
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        projectId,
        itemId,
        role,
        key,
        asset.versionId,
        asset.sha256,
        asset.byteCount,
        asset.mimeType,
        asset.width,
        asset.height,
        role === "original" ? JSON.stringify(provenance) : null,
      ],
    );
  }
}

export async function readStillManifest(
  db: Session,
  projectId: string,
  itemId: string,
): Promise<StillAssetManifest> {
  const { rows } = await db.query<
    StillAsset & {
      role: StillAssetRole;
      key: string;
      provenance: unknown;
    }
  >(
    `SELECT a.role, a.object_key AS key, a.object_version_id AS "versionId",
      a.sha256, a.byte_size AS "byteCount", a.mime_type AS "mimeType",
      a.width, a.height, a.provenance
     FROM library_still_assets a
     JOIN library_items i ON i.project_id=a.project_id AND i.id=a.item_id
     WHERE a.project_id=$1 AND a.item_id=$2 AND i.kind='still'`,
    [projectId, itemId],
  );
  if (!rows.length)
    throw new CatalogNotFoundError("This still has no kept copy.");
  const assets = Object.fromEntries(
    rows.map(({ key, role, provenance: _, ...asset }) => {
      if (key !== stillKey(projectId, itemId, role, asset.sha256))
        throw new StillBytesUnavailable();
      return [role, asset];
    }),
  );
  const manifest = StillAssetManifestSchema.safeParse({
    assets,
    provenance: rows.find((row) => row.role === "original")?.provenance,
  });
  if (!manifest.success) throw new StillBytesUnavailable();
  return manifest.data;
}

export async function readStillObject(
  db: Session,
  store: TranscriptObjectStore,
  projectId: string,
  itemId: string,
  role: StillAssetRole,
) {
  const manifest = await readStillManifest(db, projectId, itemId);
  const asset = manifest.assets[role];
  const object = await verifiedStillObject(
    store,
    stillKey(projectId, itemId, role, asset.sha256),
    asset,
  );
  return { ...object, provenance: manifest.provenance };
}
