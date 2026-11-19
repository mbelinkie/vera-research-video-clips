import { createHash } from "node:crypto";
import {
  AudioAssetManifestSchema,
  type AudioAssetManifest,
} from "@research-video/contracts";
import type { SqlDatabase } from "@research-video/db-cloud";
import type { TranscriptObjectStore } from "@research-video/storage";
import { CatalogNotFoundError } from "./catalog-errors.ts";

type Session = Pick<SqlDatabase, "query">;
type AudioReference = {
  manifest: AudioAssetManifest;
  versionId: string;
  byteCount: number;
};

class AudioUnavailable extends Error {
  readonly statusCode = 503;
  readonly code = "audio_unavailable";

  constructor() {
    super("The kept audio could not be verified. Try again later.");
  }
}

export const audioDigest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

function audioKey(projectId: string, sourceId: string, sha256: string) {
  return `projects/${projectId.toLowerCase()}/library/audio/${sourceId.toLowerCase()}/${sha256}`;
}

export async function readAudioReference(
  db: Session,
  projectId: string,
  sourceId: string,
): Promise<AudioReference | undefined> {
  const {
    rows: [row],
  } = await db.query<
    AudioReference & {
      playbackSha256: string;
      mimeType: string;
    }
  >(
    `SELECT manifest, object_version_id AS "versionId", byte_size AS "byteCount",
       playback_sha256 AS "playbackSha256", mime_type AS "mimeType"
     FROM library_audio_assets WHERE project_id=$1 AND source_id=$2`,
    [projectId, sourceId],
  );
  if (!row) return undefined;
  const manifest = AudioAssetManifestSchema.safeParse(row.manifest);
  if (
    !manifest.success ||
    manifest.data.playbackSha256 !== row.playbackSha256 ||
    manifest.data.mimeType !== row.mimeType
  )
    throw new AudioUnavailable();
  return {
    manifest: manifest.data,
    versionId: row.versionId,
    byteCount: row.byteCount,
  };
}

export async function readAudioPlayback(
  store: TranscriptObjectStore,
  projectId: string,
  sourceId: string,
  ref: AudioReference | undefined,
) {
  if (!ref) throw new CatalogNotFoundError("This source has no kept audio.");
  const {
    manifest: { playbackSha256, mimeType },
    versionId,
    byteCount,
  } = ref;
  const key = audioKey(projectId, sourceId, playbackSha256);
  const object = await store.get(key, versionId).catch(() => undefined);
  if (
    !object ||
    object.key !== key ||
    object.versionId !== versionId ||
    object.contentType !== mimeType ||
    object.bytes.byteLength !== byteCount ||
    object.sha256 !== playbackSha256 ||
    audioDigest(object.bytes) !== playbackSha256
  )
    throw new AudioUnavailable();
  return object;
}

export async function keepAudioAsset(
  store: TranscriptObjectStore,
  projectId: string,
  sourceId: string,
  manifest: AudioAssetManifest,
  bytes: Uint8Array,
) {
  const { playbackSha256: sha256, mimeType: contentType } = manifest;
  const key = audioKey(projectId, sourceId, sha256);
  const stored = await store
    .put({ key, bytes, contentType, sha256 })
    .catch(() => {
      throw new AudioUnavailable();
    });
  const ref = {
    manifest,
    versionId: stored.versionId,
    byteCount: bytes.byteLength,
  };
  await readAudioPlayback(store, projectId, sourceId, ref);
  return ref;
}

export async function insertAudioReference(
  tx: Session,
  projectId: string,
  sourceId: string,
  ref: AudioReference,
) {
  await tx.query(
    `INSERT INTO library_audio_assets(
       project_id,source_id,object_version_id,playback_sha256,byte_size,mime_type,manifest
     ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      projectId,
      sourceId,
      ref.versionId,
      ref.manifest.playbackSha256,
      ref.byteCount,
      ref.manifest.mimeType,
      JSON.stringify(ref.manifest),
    ],
  );
}
