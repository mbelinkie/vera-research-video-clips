import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import {
  ClipCandidateSchema,
  type ClipCandidate,
} from "@research-video/contracts";
import {
  assertRegularMediaFile,
  assertSafeDirectory,
  hashMediaFile,
  type FullSourceAcquirer,
  type MediaInspector,
  type RangeRenderer,
} from "@research-video/media";
import type { VerifiedLoggedClipTracks } from "@research-video/sync";
import {
  clipRelativeSrt,
  deriveClipRelativeSrtCues,
} from "@research-video/transcript";
import { z } from "zod";

const ClipCutRequestSchema = z
  .object({
    projectId: z.uuid(),
    clipIds: z.array(z.uuid()).min(1).max(20),
    authorization: z.string().regex(/^Bearer\s+[^\s]+$/u),
    authorizationConfirmed: z.literal(true),
  })
  .refine(
    (request) => new Set(request.clipIds).size === request.clipIds.length,
    {
      message: "Duplicate clip IDs are not allowed.",
    },
  );

type SourceLanguageClass =
  "confirmed_english" | "foreign" | "mixed" | "unknown";

export interface ClipCatalogReader {
  /** Must GET through authenticated project-scoped cloud catalog, never from caller JSON. */
  getAuthorizedClip(input: {
    projectId: string;
    clipId: string;
    authorization: string;
  }): Promise<ClipCandidate>;
}

export interface TranscriptReader {
  /** Must return checked immutable artifacts bound to the logged track/version. */
  getVerifiedTracks(input: {
    clip: ClipCandidate;
    authorization: string;
    sourceLanguageClass: SourceLanguageClass;
  }): Promise<VerifiedLoggedClipTracks>;
}

export type CutLoggedClipsRequest = z.input<typeof ClipCutRequestSchema>;

export type CutClipResult = {
  clipId: string;
  videoId: string;
  folder: string;
  mediaPath: string;
  subtitlePaths: string[];
  manifestPath: string;
};

export type ClipCutterDependencies = {
  catalog: ClipCatalogReader;
  transcripts: TranscriptReader;
  acquirer: FullSourceAcquirer;
  inspector: MediaInspector;
  renderer: RangeRenderer;
  /** A fixed operator-configured absolute directory, not a request field. */
  exportDirectory: string;
  /** Test seam: failing cleanup must never be translated to success. */
  removeScratch?: (scratchDirectory: string) => Promise<void>;
};

type PreparedClip = {
  clip: ClipCandidate;
  tracks: VerifiedLoggedClipTracks;
  sourceLanguageClass: SourceLanguageClass;
};

function sourceLanguageClass(clip: ClipCandidate): SourceLanguageClass {
  const language = clip.video.sourceLanguage?.toLowerCase();
  if (language && /^en(?:-|$)/u.test(language)) return "confirmed_english";
  if (language === "mixed") return "mixed";
  if (!language || language === "und" || language === "unknown")
    return "unknown";
  return "foreign";
}

function assertPinnedTracks(item: PreparedClip): void {
  const { clip, tracks, sourceLanguageClass: kind } = item;
  const { trackId, transcriptVersion } = clip.selection;
  if (
    tracks.english.track.kind !== "english" ||
    !/^en(?:-|$)/iu.test(tracks.english.track.language) ||
    tracks.english.track.videoId !== clip.video.youtubeVideoId ||
    tracks.english.track.version !== transcriptVersion ||
    (kind !== "confirmed_english" &&
      (!tracks.original ||
        tracks.original.track.kind !== "original" ||
        tracks.original.track.videoId !== clip.video.youtubeVideoId ||
        (clip.video.sourceLanguage !== undefined &&
          kind === "foreign" &&
          tracks.original.track.language.toLowerCase() !==
            clip.video.sourceLanguage.toLowerCase()) ||
        tracks.original.track.version !== transcriptVersion ||
        tracks.original.track.id === tracks.english.track.id ||
        tracks.english.track.sourceTrackId !== tracks.original.track.id)) ||
    ![tracks.english.track.id, tracks.original?.track.id].includes(trackId)
  ) {
    throw new Error(
      "Logged clip has no matching verified original/English track and version.",
    );
  }
  // The authenticated composition is responsible for verifying the bundle's
  // project/video/manifest identity; this boundary rechecks the exposed tracks.
  const { exportStartMs, exportEndMs } = clip.selection;
  clipRelativeSrt({
    transcript: tracks.english,
    startMs: exportStartMs,
    endMs: exportEndMs,
  });
  if (kind !== "confirmed_english") {
    clipRelativeSrt({
      transcript: tracks.original!,
      startMs: exportStartMs,
      endMs: exportEndMs,
    });
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function verifyGone(path: string): Promise<void> {
  if (await exists(path)) {
    throw new Error("Full source cleanup could not be verified.");
  }
}

async function createExportRoot(root: string): Promise<void> {
  if (!isAbsolute(root) || root.includes("\0")) {
    throw new Error("Export root must be an absolute configured directory.");
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  await assertSafeDirectory(root);
}

type ManifestArtifact = {
  name: string;
  byteSize: number;
  sha256: string;
  language?: string;
  trackId?: string;
  trackVersion?: number;
  cueCount?: number;
};

async function verifiedArtifact(
  stage: string,
  name: string,
): Promise<ManifestArtifact> {
  const path = join(stage, name);
  return {
    name,
    byteSize: await assertRegularMediaFile(path),
    sha256: await hashMediaFile(path),
  };
}

async function verifyPackage(
  directory: string,
  manifestName: string,
  artifacts: ManifestArtifact[],
): Promise<void> {
  await assertSafeDirectory(directory);
  const expected = [
    manifestName,
    ...artifacts.map((artifact) => artifact.name),
  ].sort();
  const actual = (await readdir(directory)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Clip package contains missing or unverified files.");
  }
  for (const artifact of artifacts) {
    const verified = await verifiedArtifact(directory, artifact.name);
    if (
      verified.byteSize !== artifact.byteSize ||
      verified.sha256 !== artifact.sha256
    ) {
      throw new Error("Clip package bytes changed during staging.");
    }
  }
  await assertRegularMediaFile(join(directory, manifestName));
  const manifest = JSON.parse(
    await readFile(join(directory, manifestName), "utf8"),
  ) as {
    artifacts?: ManifestArtifact[];
  };
  if (JSON.stringify(manifest.artifacts) !== JSON.stringify(artifacts)) {
    throw new Error("Clip package manifest did not match verified artifacts.");
  }
}

async function renderClip(
  item: PreparedClip,
  sourcePath: string,
  sourceDurationMs: number,
  root: string,
  deps: ClipCutterDependencies,
  signal?: AbortSignal,
): Promise<CutClipResult> {
  const { clip, tracks, sourceLanguageClass: kind } = item;
  const { exportStartMs: startMs, exportEndMs: endMs } = clip.selection;
  if (endMs > sourceDurationMs) {
    throw new Error("Logged clip range is beyond the available source video.");
  }
  const target = join(root, clip.id);
  if (await exists(target))
    throw new Error("Clip package already exists; refusing overwrite.");
  const stage = await mkdtemp(join(root, ".stage-"));
  const mediaName = `${clip.id}.mp4`;
  const manifestName = `${clip.id}.json`;
  try {
    if (signal?.aborted) throw new Error("Clip cut canceled.");
    await deps.renderer.render({
      sourcePath,
      outputPath: join(stage, mediaName),
      startMs,
      endMs,
      ...(signal ? { signal } : {}),
    });
    await assertRegularMediaFile(join(stage, mediaName));
    const media = await deps.inspector.inspect(join(stage, mediaName));
    const wanted = endMs - startMs;
    if (
      media.videoCodec !== "h264" ||
      media.audioCodec !== "aac" ||
      !Number.isSafeInteger(media.durationMs) ||
      Math.abs(media.durationMs - wanted) > 500
    ) {
      throw new Error(
        "Rendered MP4 failed duration or H.264/AAC verification.",
      );
    }
    const artifacts: ManifestArtifact[] = [
      await verifiedArtifact(stage, mediaName),
    ];
    const subtitleNames: string[] = [];
    // An encoder may produce a slightly shorter actual duration. Sidecars
    // must never extend beyond it, regardless of the requested cut length.
    const subtitleEndMs = Math.min(endMs, startMs + media.durationMs);
    const sidecars = [
      { name: `${clip.id}.en.srt`, transcript: tracks.english, language: "en" },
      ...(kind === "confirmed_english"
        ? []
        : [
            {
              name: `${clip.id}.${tracks.original!.track.language}.srt`,
              transcript: tracks.original!,
              language: tracks.original!.track.language,
            },
          ]),
    ];
    for (const sidecar of sidecars) {
      if (
        !/^[A-Za-z0-9-]{2,35}$/u.test(sidecar.language) ||
        (sidecar.name === `${clip.id}.en.srt` && sidecar.language !== "en")
      ) {
        throw new Error("Required subtitle language identifier is unsafe.");
      }
      const cues = deriveClipRelativeSrtCues({
        transcript: sidecar.transcript,
        startMs,
        endMs: subtitleEndMs,
      });
      if (cues.some((cue) => cue.endMs > media.durationMs)) {
        throw new Error("Subtitle cue exceeds the verified output duration.");
      }
      await writeFile(
        join(stage, sidecar.name),
        clipRelativeSrt({
          transcript: sidecar.transcript,
          startMs,
          endMs: subtitleEndMs,
        }),
        { flag: "wx", mode: 0o600 },
      );
      const verified = await verifiedArtifact(stage, sidecar.name);
      artifacts.push({
        ...verified,
        language: sidecar.language,
        trackId: sidecar.transcript.track.id,
        trackVersion: sidecar.transcript.track.version,
        cueCount: cues.length,
      });
      subtitleNames.push(sidecar.name);
    }
    const manifest = {
      schemaVersion: 1,
      clipId: clip.id,
      projectId: clip.projectId,
      catalogVideoId: clip.catalogVideoId,
      sourceVideoId: clip.video.youtubeVideoId,
      transcriptVersionId: tracks.transcriptVersionId,
      selectionTrackId: clip.selection.trackId,
      selectionTrackVersion: clip.selection.transcriptVersion,
      sourceLanguageClass: kind,
      exportStartMs: startMs,
      exportEndMs: endMs,
      outputDurationMs: media.durationMs,
      artifacts,
    };
    await writeFile(
      join(stage, manifestName),
      JSON.stringify(manifest, null, 2) + "\n",
      {
        flag: "wx",
        mode: 0o600,
      },
    );
    await verifyPackage(stage, manifestName, artifacts);
    if (await exists(target))
      throw new Error("Clip package already exists; refusing overwrite.");
    await rename(stage, target);
    await verifyPackage(target, manifestName, artifacts);
    return {
      clipId: clip.id,
      videoId: clip.video.youtubeVideoId,
      folder: target,
      mediaPath: join(target, mediaName),
      subtitlePaths: subtitleNames.map((name) => join(target, name)),
      manifestPath: join(target, manifestName),
    };
  } finally {
    // Never touch promoted packages. A failed stage is entirely private.
    if (await exists(stage)) await rm(stage, { recursive: true });
  }
}

/**
 * Foreground, local-only owner. The caller's bearer is passed to authenticated
 * readers; no caller-supplied source URL, path or transcript bytes are trusted.
 */
export async function cutLoggedClips(
  requestInput: CutLoggedClipsRequest,
  deps: ClipCutterDependencies,
  signal?: AbortSignal,
): Promise<CutClipResult[]> {
  const request = ClipCutRequestSchema.parse(requestInput);
  if (signal?.aborted) throw new Error("Clip cut canceled.");
  const prepared: PreparedClip[] = [];
  // All authorization, pinned-track, language and cue checks happen BEFORE
  // creating any source scratch or invoking yt-dlp.
  for (const clipId of request.clipIds) {
    const clip = ClipCandidateSchema.parse(
      await deps.catalog.getAuthorizedClip({
        projectId: request.projectId,
        clipId,
        authorization: request.authorization,
      }),
    );
    if (
      clip.id !== clipId ||
      clip.projectId !== request.projectId ||
      !/^[A-Za-z0-9_-]{11}$/u.test(clip.video.youtubeVideoId)
    ) {
      throw new Error(
        "Authenticated clip identity or source video does not match.",
      );
    }
    const kind = sourceLanguageClass(clip);
    const tracks = await deps.transcripts.getVerifiedTracks({
      clip,
      authorization: request.authorization,
      sourceLanguageClass: kind,
    });
    const item = { clip, tracks, sourceLanguageClass: kind };
    assertPinnedTracks(item);
    prepared.push(item);
  }
  await createExportRoot(deps.exportDirectory);
  const lockRoot = join(deps.exportDirectory, ".locks");
  await mkdir(lockRoot, { mode: 0o700, recursive: true });
  await assertSafeDirectory(lockRoot);
  const acquiredLocks: string[] = [];
  try {
    for (const item of prepared) {
      const target = join(deps.exportDirectory, item.clip.id);
      if (await exists(target))
        throw new Error("Clip package already exists; refusing overwrite.");
      const lockPath = join(lockRoot, `${item.clip.id}.lock`);
      const handle = await open(lockPath, "wx", 0o600);
      acquiredLocks.push(lockPath);
      await handle.close();
    }
    const byVideo = new Map<string, PreparedClip[]>();
    for (const item of prepared) {
      const id = item.clip.video.youtubeVideoId;
      const group = byVideo.get(id) ?? [];
      group.push(item);
      byVideo.set(id, group);
    }
    const results: CutClipResult[] = [];
    for (const [videoId, group] of byVideo) {
      if (signal?.aborted) throw new Error("Clip cut canceled.");
      const scratch = await mkdtemp(join(deps.exportDirectory, ".scratch-"));
      let groupError: unknown;
      try {
        const video = await deps.acquirer.acquireAuthorizedVideo({
          videoId,
          scratchDirectory: scratch,
          authorizationConfirmed: true,
          ...(signal ? { signal } : {}),
        });
        if (
          video.videoId !== videoId ||
          video.format !== "mp4" ||
          video.scratchPath !== join(scratch, `video-${videoId}.mp4`) ||
          video.byteSize !==
            (await assertRegularMediaFile(video.scratchPath)) ||
          video.contentSha256 !== (await hashMediaFile(video.scratchPath)) ||
          JSON.stringify(await readdir(scratch)) !==
            JSON.stringify([`video-${videoId}.mp4`])
        ) {
          throw new Error(
            "Source media did not match the verified acquisition.",
          );
        }
        const info = await deps.inspector.inspect(video.scratchPath);
        if (!Number.isSafeInteger(info.durationMs) || info.durationMs <= 0) {
          throw new Error("Source video duration is invalid.");
        }
        for (const item of group) {
          results.push(
            await renderClip(
              item,
              video.scratchPath,
              info.durationMs,
              deps.exportDirectory,
              deps,
              signal,
            ),
          );
        }
      } catch (error) {
        groupError = error;
      }
      try {
        await (deps.removeScratch ?? ((path) => rm(path, { recursive: true })))(
          scratch,
        );
        await verifyGone(scratch);
      } catch {
        // Safety dominates even a completed, playable staged package.
        throw new Error(
          "Full source cleanup failed; clip export is not complete.",
        );
      }
      if (groupError) throw groupError;
    }
    return results;
  } finally {
    // Only remove our exclusive lock files. Existing exported folders survive.
    for (const lock of acquiredLocks.reverse()) await rm(lock);
  }
}
