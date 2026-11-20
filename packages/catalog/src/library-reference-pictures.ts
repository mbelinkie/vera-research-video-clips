import { createHash, randomUUID } from "node:crypto";
import {
  StillAssetSchema,
  StillAssetRoleSchema,
  type StillAsset,
  type StillAssetRole,
} from "@research-video/contracts";
import type { SqlDatabase } from "@research-video/db-cloud";
import type { TranscriptObjectStore } from "@research-video/storage";
import type { StillImages } from "./library-still-assets.ts";
import {
  CatalogConflictError,
  CatalogNotFoundError,
} from "./catalog-errors.ts";

export type ReferencePictureOwnerKind = "source" | "quote";
type Session = Pick<SqlDatabase, "query">;
export type ReferencePictureManifest = {
  revisionId: string;
  assets: Record<StillAssetRole, StillAsset>;
};

export class ReferencePictureUnavailable extends Error {
  readonly statusCode = 503;
  readonly code = "reference_picture_unavailable";
  constructor() {
    super("The retained picture could not be verified. Try again later.");
  }
}

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function referencePictureKey(
  projectId: string,
  kind: ReferencePictureOwnerKind,
  ownerId: string,
  revisionId: string,
  role: StillAssetRole,
  sha256: string,
) {
  return `projects/${projectId.toLowerCase()}/library/reference-pictures/${kind}/${ownerId.toLowerCase()}/${revisionId.toLowerCase()}/${role}/${sha256}`;
}

export async function assertReferencePictureOwner(
  tx: Session,
  projectId: string,
  kind: ReferencePictureOwnerKind,
  ownerId: string,
  forUpdate = false,
) {
  const table = kind === "source" ? "library_sources" : "library_items";
  const allowedKind = kind === "source" ? "offline" : "quote";
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM ${table} WHERE project_id=$1 AND id=$2 AND kind=$3${forUpdate ? " FOR UPDATE" : ""}`,
    [projectId, ownerId, allowedKind],
  );
  if (!rows.length) throw new CatalogNotFoundError("Picture owner not found.");
}

export async function keepReferencePictureAssets(
  store: TranscriptObjectStore,
  projectId: string,
  kind: ReferencePictureOwnerKind,
  ownerId: string,
  images: StillImages,
) {
  const revisionId = randomUUID();
  const references = [];
  for (const role of StillAssetRoleSchema.options) {
    const image = images[role];
    const sha256 = digest(image.bytes);
    const key = referencePictureKey(
      projectId,
      kind,
      ownerId,
      revisionId,
      role,
      sha256,
    );
    let object;
    try {
      object = await store.put({
        key,
        bytes: image.bytes,
        contentType: image.mimeType,
        sha256,
      });
      const pinned = await store.get(key, object.versionId);
      if (
        !pinned ||
        pinned.key !== key ||
        pinned.versionId !== object.versionId ||
        pinned.contentType !== image.mimeType ||
        pinned.sha256 !== sha256 ||
        pinned.bytes.byteLength !== image.bytes.byteLength ||
        digest(pinned.bytes) !== sha256
      )
        throw new ReferencePictureUnavailable();
    } catch {
      throw new ReferencePictureUnavailable();
    }
    const asset = StillAssetSchema.parse({
      versionId: object.versionId,
      sha256,
      byteCount: image.bytes.byteLength,
      mimeType: image.mimeType,
      width: image.width,
      height: image.height,
    });
    references.push({ role, key, asset });
  }
  return { revisionId, references };
}

export async function replaceReferencePictureRows(
  tx: Session,
  projectId: string,
  kind: ReferencePictureOwnerKind,
  ownerId: string,
  expectedRevisionId: string | null,
  kept: Awaited<ReturnType<typeof keepReferencePictureAssets>>,
) {
  // Caller locks the parent row first; competing replacements on the same
  // owner are serialized, including the empty-picture case.
  await checkReferencePictureRevision(
    tx,
    projectId,
    kind,
    ownerId,
    expectedRevisionId,
  );
  await tx.query(
    `DELETE FROM library_reference_pictures WHERE project_id=$1 AND owner_kind=$2 AND owner_id=$3`,
    [projectId, kind, ownerId],
  );
  for (const { role, key, asset } of kept.references) {
    await tx.query(
      `INSERT INTO library_reference_pictures(
        project_id,owner_kind,owner_id,source_id,item_id,role,revision_id,
        object_key,object_version_id,sha256,byte_size,mime_type,width,height
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        projectId,
        kind,
        ownerId,
        kind === "source" ? ownerId : null,
        kind === "quote" ? ownerId : null,
        role,
        kept.revisionId,
        key,
        asset.versionId,
        asset.sha256,
        asset.byteCount,
        asset.mimeType,
        asset.width,
        asset.height,
      ],
    );
  }
}

export async function checkReferencePictureRevision(
  tx: Session,
  projectId: string,
  kind: ReferencePictureOwnerKind,
  ownerId: string,
  expectedRevisionId: string | null,
) {
  const { rows } = await tx.query<{ revision_id: string }>(
    `SELECT revision_id FROM library_reference_pictures
     WHERE project_id=$1 AND owner_kind=$2 AND owner_id=$3 LIMIT 1`,
    [projectId, kind, ownerId],
  );
  if ((rows[0]?.revision_id ?? null) !== expectedRevisionId)
    throw new CatalogConflictError(
      "The picture changed. Reload before saving.",
    );
}

export async function readReferencePictureManifest(
  db: Session,
  projectId: string,
  kind: ReferencePictureOwnerKind,
  ownerId: string,
): Promise<ReferencePictureManifest> {
  const { rows } = await db.query<{
    role: StillAssetRole;
    revision_id: string;
    object_key: string;
    object_version_id: string;
    sha256: string;
    byte_size: number;
    mime_type: string;
    width: number;
    height: number;
  }>(
    `SELECT role,revision_id,object_key,object_version_id,sha256,byte_size,mime_type,width,height
     FROM library_reference_pictures WHERE project_id=$1 AND owner_kind=$2 AND owner_id=$3`,
    [projectId, kind, ownerId],
  );
  if (!rows.length) throw new CatalogNotFoundError("Picture not found.");
  const revisionId = rows[0]!.revision_id;
  if (
    rows.length !== StillAssetRoleSchema.options.length ||
    rows.some((row) => row.revision_id !== revisionId)
  )
    throw new ReferencePictureUnavailable();
  const entries = rows.map((row) => {
    const asset = StillAssetSchema.safeParse({
      versionId: row.object_version_id,
      sha256: row.sha256,
      byteCount: row.byte_size,
      mimeType: row.mime_type,
      width: row.width,
      height: row.height,
    });
    if (
      !asset.success ||
      !StillAssetRoleSchema.safeParse(row.role).success ||
      row.object_key !==
        referencePictureKey(
          projectId,
          kind,
          ownerId,
          revisionId,
          row.role,
          row.sha256,
        )
    )
      throw new ReferencePictureUnavailable();
    return [row.role, asset.data] as const;
  });
  const assets = Object.fromEntries(entries) as Record<
    StillAssetRole,
    StillAsset
  >;
  if (StillAssetRoleSchema.options.some((role) => !assets[role]))
    throw new ReferencePictureUnavailable();
  return { revisionId, assets };
}

export async function readReferencePictureObject(
  db: Session,
  store: TranscriptObjectStore,
  projectId: string,
  kind: ReferencePictureOwnerKind,
  ownerId: string,
  role: StillAssetRole,
) {
  const manifest = await readReferencePictureManifest(
    db,
    projectId,
    kind,
    ownerId,
  );
  const asset = manifest.assets[role];
  const key = referencePictureKey(
    projectId,
    kind,
    ownerId,
    manifest.revisionId,
    role,
    asset.sha256,
  );
  try {
    const object = await store.get(key, asset.versionId);
    if (
      !object ||
      object.key !== key ||
      object.versionId !== asset.versionId ||
      object.contentType !== asset.mimeType ||
      object.sha256 !== asset.sha256 ||
      object.bytes.byteLength !== asset.byteCount ||
      digest(object.bytes) !== asset.sha256
    )
      throw new ReferencePictureUnavailable();
    return object;
  } catch {
    throw new ReferencePictureUnavailable();
  }
}
