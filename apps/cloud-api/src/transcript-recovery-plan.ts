import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";

import {
  TranscriptArtifactSchema,
  TranscriptManifestSchema,
} from "@research-video/contracts";
import type { SqlDatabase } from "@research-video/db-cloud";

const CopySchema = z
  .object({
    transcriptVersionId: z.uuid(),
    type: TranscriptArtifactSchema.shape.type,
    objectVersionId: z.string().min(1).optional(),
    file: z.string().min(1),
  })
  .strict();

type Reference = {
  type: string;
  objectKey: string;
  objectVersionId: string;
  byteSize: number;
  sha256: string;
};
type Version = {
  id: string;
  projectId: string;
  catalogVideoId: string;
  videoId: string;
  lineageId: string;
  version: number;
  schemaVersion: number;
  sourceLanguage: string;
  targetLanguage: string;
  timingPrecision: string;
  activeVersionId: string | null;
  manifestKey: string;
  manifestVersion: string;
  manifestSha: string;
  refs: Reference[];
};

async function openInventoryFile(root: string, name: string) {
  const parts = name.split("/");
  if (
    isAbsolute(name) ||
    name.includes("\\") ||
    parts.some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Inventory file must be inside its directory.");
  }
  let path = root;
  for (const part of parts) {
    path = join(path, part);
    if ((await lstat(path)).isSymbolicLink())
      throw new Error("Inventory symlink.");
  }
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  if (!(await file.stat()).isFile()) {
    await file.close();
    throw new Error("Inventory files must be regular files.");
  }
  return file;
}

async function loadInventory(root?: string) {
  if (!root) return undefined;
  if (!(await lstat(root)).isDirectory())
    throw new Error("Invalid inventory root.");
  const index = await openInventoryFile(root, "index.json");
  try {
    const entries = z
      .array(CopySchema)
      .parse(JSON.parse(await index.readFile("utf8")));
    const copies = new Map<string, typeof entries>();
    for (const entry of entries) {
      const key = `${entry.transcriptVersionId.toLowerCase()}/${entry.type}`;
      const group = copies.get(key) ?? [];
      group.push(entry);
      copies.set(key, group);
    }
    return { root, copies };
  } finally {
    await index.close();
  }
}

async function verifyCopy(root: string, name: string, ref: Reference) {
  const file = await openInventoryFile(root, name);
  try {
    if ((await file.stat()).size !== ref.byteSize)
      throw new Error("Wrong length.");
    const hash = createHash("sha256");
    const isManifest = ref.type === "manifest";
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      length += chunk.length;
      if (length > ref.byteSize || (isManifest && length > 1024 * 1024)) {
        throw new Error("Artifact exceeds expected size.");
      }
      hash.update(chunk);
      if (isManifest) chunks.push(chunk);
    }
    if (length !== ref.byteSize || hash.digest("hex") !== ref.sha256) {
      throw new Error("Artifact failed verification.");
    }
    return isManifest
      ? TranscriptManifestSchema.parse(
          JSON.parse(Buffer.concat(chunks).toString("utf8")),
        )
      : undefined;
  } finally {
    await file.close();
  }
}

async function checkBundle(
  version: Version,
  inventory: Awaited<ReturnType<typeof loadInventory>>,
  requirePhysicalPin: boolean,
) {
  const manifestRef = version.refs.find((ref) => ref.type === "manifest");
  const tracks = version.refs.filter((ref) => ref.type !== "manifest");
  const catalogValid =
    manifestRef &&
    manifestRef.objectKey === version.manifestKey &&
    manifestRef.objectVersionId === version.manifestVersion &&
    manifestRef.sha256 === version.manifestSha &&
    version.refs.every(
      ({ objectVersionId }) => objectVersionId && objectVersionId !== "null",
    ) &&
    tracks.some((ref) => ref.type === "english-normalized") &&
    tracks.some((ref) => ref.type === "english-srt");
  const artifacts = [];
  for (const ref of version.refs) {
    const copies = inventory?.copies.get(`${version.id}/${ref.type}`) ?? [];
    let state: "missing" | "verified" | "corrupt" = "missing";
    if (inventory && copies.length) {
      const copy = copies[0]!;
      state = "corrupt";
      if (
        copies.length === 1 &&
        (!requirePhysicalPin || copy.objectVersionId === ref.objectVersionId)
      ) {
        try {
          const manifest = await verifyCopy(inventory.root, copy.file, ref);
          if (
            !manifest ||
            (manifest.id === version.id &&
              manifest.projectId === version.projectId &&
              manifest.catalogVideoId === version.catalogVideoId &&
              manifest.videoId === version.videoId &&
              manifest.lineageId === version.lineageId &&
              manifest.version === version.version &&
              manifest.schemaVersion === version.schemaVersion &&
              manifest.sourceLanguage === version.sourceLanguage &&
              manifest.targetLanguage === version.targetLanguage &&
              manifest.timingPrecision === version.timingPrecision &&
              manifest.artifacts.length === tracks.length &&
              tracks.every((expected) =>
                manifest.artifacts.some(
                  (actual) =>
                    actual.type === expected.type &&
                    actual.objectKey === expected.objectKey &&
                    actual.objectVersionId === expected.objectVersionId &&
                    actual.byteSize === expected.byteSize &&
                    actual.sha256 === expected.sha256,
                ),
              ))
          )
            state = "verified";
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT")
            state = "missing";
        }
      }
    }
    artifacts.push({ type: ref.type, state });
  }
  const state =
    !catalogValid || artifacts.some((artifact) => artifact.state === "corrupt")
      ? "corrupt"
      : artifacts.every((artifact) => artifact.state === "verified")
        ? "verified"
        : artifacts.some((artifact) => artifact.state === "verified")
          ? "partial"
          : "missing";
  return { state, artifacts };
}

/** Redacted advisory report from a scratch catalog and explicit offline inventories. */
export async function auditTranscriptRecovery(
  database: Pick<SqlDatabase, "query">,
  inventories: { retained?: string; destination?: string },
) {
  const { rows } = await database.query<Version>(`
    SELECT tv.id, tv.project_id AS "projectId", tv.video_id AS "catalogVideoId",
      v.youtube_video_id AS "videoId", tv.lineage_id AS "lineageId", tv.version,
      tv.schema_version AS "schemaVersion", tv.source_language AS "sourceLanguage",
      tv.target_language AS "targetLanguage", tv.timing_precision AS "timingPrecision",
      pv.active_transcript_version_id AS "activeVersionId",
      tv.manifest_object_key AS "manifestKey",
      tv.manifest_object_version_id AS "manifestVersion",
      tv.manifest_sha256 AS "manifestSha",
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'type', a.artifact_type, 'objectKey', a.object_key,
          'objectVersionId', a.object_version_id, 'byteSize', a.byte_size,
          'sha256', a.sha256
        ) ORDER BY a.artifact_type)
        FROM transcript_artifacts a WHERE a.transcript_version_id = tv.id
      ), '[]'::jsonb) AS refs
    FROM transcript_versions tv JOIN videos v ON v.id = tv.video_id
    LEFT JOIN project_videos pv ON pv.project_id = tv.project_id AND pv.video_id = tv.video_id
    ORDER BY tv.id`);
  const [retained, destination] = await Promise.all([
    loadInventory(inventories.retained),
    loadInventory(inventories.destination),
  ]);
  const report = [];
  for (const version of rows) {
    report.push({
      transcriptVersionId: version.id,
      active: version.activeVersionId === version.id,
      pinSetSha256: createHash("sha256")
        .update(JSON.stringify(version))
        .digest("hex"),
      retained: await checkBundle(version, retained, false),
      destinationExport: await checkBundle(version, destination, true),
    });
  }
  return report;
}
