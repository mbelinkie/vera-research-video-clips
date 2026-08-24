import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { loadConfig, type AppConfig } from "@research-video/config";
import {
  ExportClipManifestSchema,
  ExportClipMetadataSchema,
  TranscriptSegmentSchema,
  TranscriptTokenSchema,
  TranscriptTrackSchema,
  type ExportSettings,
  type NormalizedTranscript,
} from "@research-video/contracts";
import {
  LocalExportQueue,
  LocalTranscriptIndex,
  openLocalDatabase,
  runLocalMigrations,
} from "@research-video/db-local";
import {
  FfprobeMediaInspector,
  RenderDurationToleranceMs,
} from "@research-video/media";
import {
  deriveClipRelativeSrtCues,
  parseSrt,
  validateClipRelativeSrtCues,
} from "@research-video/transcript";
import { z } from "zod";

import {
  runConfiguredLocalExportOnce,
  type LocalExportOnceResult,
} from "./export-run-once.ts";

const execFile = promisify(execFileCallback);
const YouTubeVideoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/u);
const SafeCodeSchema = z.string().regex(/^[a-z0-9_]{1,80}$/u);
const StrictNormalizedTranscriptSchema = z
  .object({
    track: TranscriptTrackSchema.strict(),
    segments: z.array(TranscriptSegmentSchema.strict()),
    tokens: z.array(TranscriptTokenSchema.strict()).default([]),
  })
  .strict();

export const LiveYouTubeSmokeDescriptorSchema = z
  .object({
    schemaVersion: z.literal(1),
    authorization: z.object({ rightsCleared: z.literal(true) }).strict(),
    youtubeVideoId: YouTubeVideoIdSchema,
    selection: z
      .object({
        exportStartMs: z.number().int().nonnegative(),
        exportEndMs: z.number().int().positive(),
      })
      .strict(),
    originalTranscript: StrictNormalizedTranscriptSchema,
    englishTranscript: StrictNormalizedTranscriptSchema,
  })
  .strict()
  .superRefine((descriptor, context) => {
    const durationMs =
      descriptor.selection.exportEndMs - descriptor.selection.exportStartMs;
    if (durationMs < 1_000 || durationMs > 30_000) {
      context.addIssue({
        code: "custom",
        path: ["selection"],
        message: "The live smoke range must be between 1 and 30 seconds.",
      });
    }
    const original = descriptor.originalTranscript;
    const english = descriptor.englishTranscript;
    if (
      original.track.videoId !== descriptor.youtubeVideoId ||
      english.track.videoId !== descriptor.youtubeVideoId
    ) {
      context.addIssue({
        code: "custom",
        path: ["youtubeVideoId"],
        message: "Both transcript tracks must match the authorized video.",
      });
    }
    if (
      original.track.kind !== "original" ||
      primaryLanguage(original.track.language) === "en"
    ) {
      context.addIssue({
        code: "custom",
        path: ["originalTranscript", "track"],
        message: "The original track must be non-English original speech.",
      });
    }
    if (
      english.track.kind !== "english" ||
      primaryLanguage(english.track.language) !== "en" ||
      english.track.sourceTrackId !== original.track.id
    ) {
      context.addIssue({
        code: "custom",
        path: ["englishTranscript", "track"],
        message: "The English track must link to the exact original track.",
      });
    }
    for (const [name, transcript] of [
      ["originalTranscript", original],
      ["englishTranscript", english],
    ] as const) {
      if (!transcriptLinkageValid(transcript)) {
        context.addIssue({
          code: "custom",
          path: [name],
          message: "Transcript segment and token linkage must be exact.",
        });
      }
      if (!overlappingSegments(transcript, descriptor.selection).length) {
        context.addIssue({
          code: "custom",
          path: [name, "segments"],
          message: "Each track must contain a cue in the smoke range.",
        });
      }
    }
  });

export type LiveYouTubeSmokeDescriptor = z.infer<
  typeof LiveYouTubeSmokeDescriptorSchema
>;

export type LiveYouTubeSmokeEvidence = {
  artifacts: readonly {
    role: string;
    byteSize: number;
    contentSha256: string;
  }[];
  media: {
    durationMs: number;
    videoCodec: string;
    audioCodec: string;
    width: number;
    height: number;
  };
  subtitles: {
    policy: "original_and_english";
    original: { cueCount: number; startMs: number; endMs: number };
    english: { cueCount: number; startMs: number; endMs: number };
  };
  sourceScratchAbsent: true;
};

export type LiveYouTubeSmokeResult =
  | {
      status: "passed";
      evidence: LiveYouTubeSmokeEvidence;
      cleanup: { temporaryWorkspaceRemoved: true };
    }
  | {
      status: "blocked" | "failed";
      code: string;
      cleanup: { temporaryWorkspaceRemoved: boolean };
    };

type LiveYouTubeSmokeOutcome =
  | { status: "passed"; evidence: LiveYouTubeSmokeEvidence }
  | { status: "blocked" | "failed"; code: string };

type LiveSmokeDependencies = {
  preflightTools?: (config: AppConfig, signal?: AbortSignal) => Promise<void>;
  executeExport?: typeof runConfiguredLocalExportOnce;
  verifyExport?: typeof verifyLiveSmokeExport;
  createTemporaryRoot?: () => Promise<string>;
  removeTemporaryRoot?: (root: string) => Promise<void>;
};

export type LiveYouTubeSmokeAuthorization = {
  authorizationConfirmed: true;
  liveSmokeAuthorized: true;
};

export async function runLiveYouTubeSmoke(
  descriptorInput: unknown,
  authorization: LiveYouTubeSmokeAuthorization,
  config: AppConfig,
  dependencies: LiveSmokeDependencies = {},
  signal?: AbortSignal,
): Promise<LiveYouTubeSmokeResult> {
  if (!hasLiveSmokeAuthorization(authorization)) {
    return blocked("live_smoke_authorization_required", true);
  }
  if (signal?.aborted) return failed("live_smoke_interrupted", true);
  if (config.exportSourceProvider !== "yt-dlp") {
    return blocked("live_smoke_provider_disabled", true);
  }
  const parsed = LiveYouTubeSmokeDescriptorSchema.safeParse(descriptorInput);
  if (!parsed.success) return blocked("live_smoke_descriptor_invalid", true);
  try {
    await (dependencies.preflightTools ?? preflightLiveSmokeTools)(
      config,
      signal,
    );
  } catch {
    if (signal?.aborted) return failed("live_smoke_interrupted", true);
    return blocked("live_smoke_prerequisite_unavailable", true);
  }

  const createRoot =
    dependencies.createTemporaryRoot ?? createPrivateTemporaryRoot;
  const removeRoot = dependencies.removeTemporaryRoot ?? removeTemporaryRoot;
  let root: string | undefined;
  let result: LiveYouTubeSmokeOutcome;
  try {
    root = await createRoot();
    const requestId = prepareLiveSmokeRequest(root, parsed.data);
    const smokeConfig = { ...config, dataDir: root };
    const execution = await (
      dependencies.executeExport ?? runConfiguredLocalExportOnce
    )(
      {
        requestId,
        authorizationConfirmed: true,
        ...(signal ? { signal } : {}),
      },
      { config: smokeConfig },
    );
    if (signal?.aborted) {
      result = { status: "failed", code: "live_smoke_interrupted" };
    } else if (execution.status !== "complete") {
      result = {
        status: isProviderBlock(execution) ? "blocked" : "failed",
        code: safeResultCode(execution.error?.code, "live_smoke_export_failed"),
      };
    } else {
      const evidence = await (
        dependencies.verifyExport ?? verifyLiveSmokeExport
      )(root, requestId, parsed.data, execution);
      result = { status: "passed", evidence };
    }
  } catch (error) {
    result = {
      status: "failed",
      code: signal?.aborted
        ? "live_smoke_interrupted"
        : safeResultCode(
            (error as { code?: unknown })?.code,
            "live_smoke_failed",
          ),
    };
  }

  let removed = true;
  if (root) {
    try {
      await removeRoot(root);
      removed = await pathAbsent(root);
    } catch {
      removed = false;
    }
  }
  if (!removed) {
    return {
      status: "failed",
      code: "live_smoke_workspace_cleanup_failed",
      cleanup: { temporaryWorkspaceRemoved: false },
    };
  }
  return { ...result, cleanup: { temporaryWorkspaceRemoved: true } };
}

export async function runLiveYouTubeSmokeFromConfig(
  descriptorPath: string,
  authorization: LiveYouTubeSmokeAuthorization,
  env: NodeJS.ProcessEnv = process.env,
  dependencies: LiveSmokeDependencies = {},
  signal?: AbortSignal,
): Promise<LiveYouTubeSmokeResult> {
  if (!hasLiveSmokeAuthorization(authorization)) {
    return blocked("live_smoke_authorization_required", true);
  }
  let externalPath: string;
  try {
    externalPath = await resolveExternalDescriptorPath(
      descriptorPath,
      process.cwd(),
    );
  } catch {
    return blocked("live_smoke_config_must_be_external", true);
  }
  let descriptor: unknown;
  try {
    const descriptorInfo = await lstat(externalPath);
    if (!descriptorInfo.isFile() || descriptorInfo.size > 1024 * 1024) {
      return blocked("live_smoke_config_unreadable", true);
    }
    descriptor = JSON.parse(await readFile(externalPath, "utf8"));
  } catch {
    return blocked("live_smoke_config_unreadable", true);
  }
  let config: AppConfig;
  try {
    config = loadConfig(env);
  } catch {
    return blocked("live_smoke_environment_invalid", true);
  }
  return runLiveYouTubeSmoke(
    descriptor,
    authorization,
    config,
    dependencies,
    signal,
  );
}

export function parseLiveYouTubeSmokeCommandLine(
  argv: readonly string[],
): { descriptorPath: string } | { error: string } {
  let descriptorPath: string | undefined;
  let authorizationConfirmed = false;
  let liveSmokeAuthorized = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--authorization-confirmed") {
      authorizationConfirmed = true;
    } else if (argument === "--live-smoke-authorized") {
      liveSmokeAuthorized = true;
    } else if (argument === "--smoke-config") {
      const value = argv[index + 1];
      if (!value || descriptorPath)
        return { error: "live_smoke_arguments_invalid" };
      descriptorPath = value;
      index += 1;
    } else {
      return { error: "live_smoke_arguments_invalid" };
    }
  }
  if (!authorizationConfirmed || !liveSmokeAuthorized) {
    return { error: "live_smoke_authorization_required" };
  }
  if (!descriptorPath) return { error: "live_smoke_config_required" };
  return { descriptorPath };
}

export async function runLiveYouTubeSmokeCommand(
  argv: readonly string[] = process.argv.slice(2),
  options: {
    execute?: typeof runLiveYouTubeSmokeFromConfig;
    write?: (value: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<number> {
  const parsed = parseLiveYouTubeSmokeCommandLine(argv);
  let result: LiveYouTubeSmokeResult;
  if ("error" in parsed) {
    result = blocked(parsed.error, true);
  } else {
    result = await (options.execute ?? runLiveYouTubeSmokeFromConfig)(
      parsed.descriptorPath,
      { authorizationConfirmed: true, liveSmokeAuthorized: true },
      process.env,
      {},
      options.signal,
    );
  }
  (options.write ?? ((value) => process.stdout.write(value)))(
    `${JSON.stringify(result)}\n`,
  );
  return result.status === "passed" ? 0 : result.status === "blocked" ? 2 : 1;
}

async function preflightLiveSmokeTools(
  config: AppConfig,
  signal?: AbortSignal,
): Promise<void> {
  await Promise.all([
    toolVersion(config.ytDlpPath, ["--version"], signal),
    toolVersion("ffmpeg", ["-version"], signal),
    toolVersion("ffprobe", ["-version"], signal),
  ]);
}

async function toolVersion(
  executable: string,
  args: readonly string[],
  signal?: AbortSignal,
) {
  await execFile(executable, [...args], {
    timeout: 10_000,
    maxBuffer: 256 * 1024,
    ...(signal ? { signal } : {}),
  });
}

function prepareLiveSmokeRequest(
  root: string,
  descriptor: LiveYouTubeSmokeDescriptor,
): string {
  const database = openLocalDatabase(join(root, "local.sqlite"));
  try {
    runLocalMigrations(database);
    const queue = new LocalExportQueue(database);
    const index = new LocalTranscriptIndex(database);
    const projectId = randomUUID();
    const catalogVideoId = randomUUID();
    index.replace({
      projectId,
      catalogVideoId,
      transcriptVersionId: randomUUID(),
      transcript: descriptor.originalTranscript,
    });
    index.replace({
      projectId,
      catalogVideoId,
      transcriptVersionId: randomUUID(),
      transcript: descriptor.englishTranscript,
    });
    const englishSegments = overlappingSegments(
      descriptor.englishTranscript,
      descriptor.selection,
    );
    const request = queue.createExportOnly({
      idempotencyKey: `live-youtube-smoke:${randomUUID()}`,
      video: {
        youtubeVideoId: descriptor.youtubeVideoId,
        canonicalUrl: `https://www.youtube.com/watch?v=${descriptor.youtubeVideoId}`,
        title: "Authorized live smoke source",
      },
      sourceRights: {
        schemaVersion: 1,
        source: "youtube",
        youtubeVideoId: descriptor.youtubeVideoId,
        confirmation: "authorized_to_process",
        disclosureVersion: 1,
      },
      selection: {
        trackId: descriptor.englishTranscript.track.id,
        transcriptVersion: descriptor.englishTranscript.track.version,
        firstSegmentId: englishSegments[0]!.id,
        lastSegmentId: englishSegments.at(-1)!.id,
        transcriptStartMs: descriptor.selection.exportStartMs,
        transcriptEndMs: descriptor.selection.exportEndMs,
        exportStartMs: descriptor.selection.exportStartMs,
        exportEndMs: descriptor.selection.exportEndMs,
        text: englishSegments.map((segment) => segment.text).join(" "),
        timingPrecision: descriptor.englishTranscript.track.timingPrecision,
      },
      sourceLanguageClass: "foreign",
      subtitleTracks: {
        original: {
          trackId: descriptor.originalTranscript.track.id,
          trackVersion: descriptor.originalTranscript.track.version,
        },
        english: {
          trackId: descriptor.englishTranscript.track.id,
          trackVersion: descriptor.englishTranscript.track.version,
        },
      },
      preset: {
        presetVersion: 1,
        name: "Authorized live smoke H.264",
        settings: liveSmokeSettings,
      },
    });
    return request.id;
  } finally {
    database.close();
  }
}

const liveSmokeSettings: ExportSettings = {
  container: "mp4",
  videoCodec: "h264",
  videoRateControl: { mode: "crf", value: 20 },
  frameRate: "source",
  audioCodec: "aac",
  omitSubtitleFilesForConfirmedEnglish: false,
  embedEnglishSubtitleTrack: false,
};

async function verifyLiveSmokeExport(
  root: string,
  requestId: string,
  descriptor: LiveYouTubeSmokeDescriptor,
  execution: LocalExportOnceResult,
): Promise<LiveYouTubeSmokeEvidence> {
  const packageIdentity = execution.packageIdentity;
  if (!packageIdentity || packageIdentity !== `clip-${requestId}`) {
    throw codedError("live_smoke_package_invalid");
  }
  const packageDirectory = join(root, "exports", packageIdentity);
  const expectedEntries = [
    `${packageIdentity}.en.srt`,
    `${packageIdentity}.jpg`,
    `${packageIdentity}.json`,
    `${packageIdentity}.mp4`,
    `${packageIdentity}.original.srt`,
    "manifest.json",
  ].sort();
  if (
    JSON.stringify((await readdir(packageDirectory)).sort()) !==
    JSON.stringify(expectedEntries)
  ) {
    throw codedError("live_smoke_package_invalid");
  }
  const inspector = new FfprobeMediaInspector();
  const media = await inspector.inspect(
    join(packageDirectory, `${packageIdentity}.mp4`),
  );
  const expectedDuration =
    descriptor.selection.exportEndMs - descriptor.selection.exportStartMs;
  if (
    media.videoCodec !== "h264" ||
    media.audioCodec !== "aac" ||
    Math.abs(media.durationMs - expectedDuration) > RenderDurationToleranceMs ||
    !media.observedProperties?.video
  ) {
    throw codedError("live_smoke_media_invalid");
  }
  const originalCues = parseSrt(
    await readFile(
      join(packageDirectory, `${packageIdentity}.original.srt`),
      "utf8",
    ),
  );
  const englishCues = parseSrt(
    await readFile(join(packageDirectory, `${packageIdentity}.en.srt`), "utf8"),
  );
  validateClipRelativeSrtCues(originalCues, media.durationMs);
  validateClipRelativeSrtCues(englishCues, media.durationMs);
  const expectedOriginalCues = deriveClipRelativeSrtCues({
    transcript: descriptor.originalTranscript,
    startMs: descriptor.selection.exportStartMs,
    endMs: descriptor.selection.exportEndMs,
  });
  const expectedEnglishCues = deriveClipRelativeSrtCues({
    transcript: descriptor.englishTranscript,
    startMs: descriptor.selection.exportStartMs,
    endMs: descriptor.selection.exportEndMs,
  });
  if (
    JSON.stringify(originalCues) !== JSON.stringify(expectedOriginalCues) ||
    JSON.stringify(englishCues) !== JSON.stringify(expectedEnglishCues)
  ) {
    throw codedError("live_smoke_subtitle_provenance_invalid");
  }
  const metadata = ExportClipMetadataSchema.parse(
    JSON.parse(
      await readFile(join(packageDirectory, `${packageIdentity}.json`), "utf8"),
    ),
  );
  const manifest = ExportClipManifestSchema.parse(
    JSON.parse(await readFile(join(packageDirectory, "manifest.json"), "utf8")),
  );
  const original = cueBounds(originalCues);
  const english = cueBounds(englishCues);
  if (
    metadata.video.youtubeVideoId !== descriptor.youtubeVideoId ||
    manifest.video.youtubeVideoId !== descriptor.youtubeVideoId ||
    metadata.sourceLanguageClass !== "foreign" ||
    manifest.sourceLanguageClass !== "foreign" ||
    metadata.selection.exportStartMs !== descriptor.selection.exportStartMs ||
    metadata.selection.exportEndMs !== descriptor.selection.exportEndMs ||
    metadata.resolvedExportBounds.startMs !==
      descriptor.selection.exportStartMs ||
    metadata.resolvedExportBounds.endMs !== descriptor.selection.exportEndMs ||
    manifest.resolvedExportBounds.startMs !==
      descriptor.selection.exportStartMs ||
    manifest.resolvedExportBounds.endMs !== descriptor.selection.exportEndMs ||
    metadata.renderedDurationMs !== media.durationMs ||
    manifest.renderedDurationMs !== media.durationMs ||
    JSON.stringify(manifest.subtitlePolicy.requiredSidecars) !==
      JSON.stringify(["original", "english"]) ||
    metadata.subtitleTracks?.original.trackId !==
      descriptor.originalTranscript.track.id ||
    metadata.subtitleTracks.original.trackVersion !==
      descriptor.originalTranscript.track.version ||
    metadata.subtitleTracks.english.trackId !==
      descriptor.englishTranscript.track.id ||
    metadata.subtitleTracks.english.trackVersion !==
      descriptor.englishTranscript.track.version
  ) {
    throw codedError("live_smoke_provenance_invalid");
  }
  const manifestOriginal = manifest.artifacts.find(
    (artifact) => artifact.role === "original_srt",
  );
  const manifestEnglish = manifest.artifacts.find(
    (artifact) => artifact.role === "english_srt",
  );
  const manifestRoles = manifest.artifacts
    .map((artifact) => artifact.role)
    .sort();
  if (
    JSON.stringify(manifestRoles) !==
      JSON.stringify(
        [
          "clip_metadata_json",
          "english_srt",
          "original_srt",
          "thumbnail_jpg",
          "video_mp4",
        ].sort(),
      ) ||
    manifestOriginal?.subtitle?.language !==
      descriptor.originalTranscript.track.language ||
    manifestOriginal?.subtitle?.trackId !==
      descriptor.originalTranscript.track.id ||
    manifestOriginal.subtitle.trackVersion !==
      descriptor.originalTranscript.track.version ||
    manifestOriginal.subtitle.cueCount !== original.cueCount ||
    manifestOriginal.subtitle.startMs !== original.startMs ||
    manifestOriginal.subtitle.endMs !== original.endMs ||
    manifestEnglish?.subtitle?.language !==
      descriptor.englishTranscript.track.language ||
    manifestEnglish?.subtitle?.trackId !==
      descriptor.englishTranscript.track.id ||
    manifestEnglish.subtitle.trackVersion !==
      descriptor.englishTranscript.track.version ||
    manifestEnglish.subtitle.cueCount !== english.cueCount ||
    manifestEnglish.subtitle.startMs !== english.startMs ||
    manifestEnglish.subtitle.endMs !== english.endMs
  ) {
    throw codedError("live_smoke_provenance_invalid");
  }
  for (const artifact of manifest.artifacts) {
    const expectedFilename = artifactFilename(artifact.role, packageIdentity);
    if (artifact.filename !== expectedFilename) {
      throw codedError("live_smoke_manifest_filename_invalid");
    }
    const bytes = await readFile(join(packageDirectory, expectedFilename));
    if (
      artifact.byteSize !== bytes.byteLength ||
      artifact.contentSha256 !== sha256(bytes)
    ) {
      throw codedError("live_smoke_manifest_hash_invalid");
    }
  }
  const database = openLocalDatabase(join(root, "local.sqlite"));
  let artifacts: Array<LiveYouTubeSmokeEvidence["artifacts"][number]>;
  try {
    const queue = new LocalExportQueue(database);
    const request = queue.get(requestId);
    if (
      request?.state !== "complete" ||
      request.finalArtifacts?.length !== 6 ||
      queue.getSourceAttempt(request.jobId, 1)?.lifecycleState !== "deleted"
    ) {
      throw codedError("live_smoke_terminal_evidence_invalid");
    }
    artifacts = [];
    for (const artifact of request.finalArtifacts) {
      const filename = artifactFilename(artifact.role, packageIdentity);
      const bytes = await readFile(join(packageDirectory, filename));
      if (
        artifact.byteSize !== bytes.byteLength ||
        artifact.contentSha256 !== sha256(bytes)
      ) {
        throw codedError("live_smoke_artifact_hash_invalid");
      }
      artifacts.push({
        role: artifact.role,
        byteSize: artifact.byteSize,
        contentSha256: artifact.contentSha256,
      });
    }
  } finally {
    database.close();
  }
  if (
    !(await directoryEmptyOrAbsent(join(root, "jobs", "export-source-scratch")))
  ) {
    throw codedError("live_smoke_source_cleanup_invalid");
  }
  return {
    artifacts: [...artifacts].sort((left, right) =>
      left.role.localeCompare(right.role),
    ),
    media: {
      durationMs: media.durationMs,
      videoCodec: media.videoCodec,
      audioCodec: media.audioCodec,
      width: media.observedProperties.video.width,
      height: media.observedProperties.video.height,
    },
    subtitles: {
      policy: "original_and_english",
      original,
      english,
    },
    sourceScratchAbsent: true,
  };
}

function cueBounds(cues: ReturnType<typeof parseSrt>) {
  if (!cues.length) throw codedError("live_smoke_subtitle_invalid");
  return {
    cueCount: cues.length,
    startMs: Math.min(...cues.map((cue) => cue.startMs)),
    endMs: Math.max(...cues.map((cue) => cue.endMs)),
  };
}

function artifactFilename(role: string, packageIdentity: string): string {
  const names: Record<string, string> = {
    video_mp4: `${packageIdentity}.mp4`,
    original_srt: `${packageIdentity}.original.srt`,
    english_srt: `${packageIdentity}.en.srt`,
    thumbnail_jpg: `${packageIdentity}.jpg`,
    clip_metadata_json: `${packageIdentity}.json`,
    manifest_json: "manifest.json",
  };
  const filename = names[role];
  if (!filename) throw codedError("live_smoke_package_invalid");
  return filename;
}

function overlappingSegments(
  transcript: NormalizedTranscript,
  selection: { exportStartMs: number; exportEndMs: number },
) {
  return transcript.segments.filter(
    (segment) =>
      segment.endMs > selection.exportStartMs &&
      segment.startMs < selection.exportEndMs,
  );
}

function transcriptLinkageValid(transcript: NormalizedTranscript) {
  const segmentIds = new Set<string>();
  const segmentOrdinals = new Set<number>();
  for (let index = 0; index < transcript.segments.length; index += 1) {
    const segment = transcript.segments[index]!;
    if (
      segment.trackId !== transcript.track.id ||
      segmentIds.has(segment.id) ||
      segmentOrdinals.has(segment.ordinal) ||
      segment.ordinal !== index ||
      (index > 0 && transcript.segments[index - 1]!.startMs > segment.startMs)
    ) {
      return false;
    }
    segmentIds.add(segment.id);
    segmentOrdinals.add(segment.ordinal);
  }
  const tokenIds = new Set<string>();
  const tokenOrdinals = new Set<string>();
  for (const token of transcript.tokens) {
    const segment = transcript.segments.find(
      (candidate) => candidate.id === token.segmentId,
    );
    const ordinalIdentity = `${token.segmentId}:${token.ordinal}`;
    if (
      !segment ||
      tokenIds.has(token.id) ||
      tokenOrdinals.has(ordinalIdentity) ||
      (token.startMs === undefined) !== (token.endMs === undefined) ||
      (token.startMs !== undefined &&
        (token.startMs < segment.startMs || token.endMs! > segment.endMs))
    ) {
      return false;
    }
    tokenIds.add(token.id);
    tokenOrdinals.add(ordinalIdentity);
  }
  return true;
}

async function resolveExternalDescriptorPath(
  path: string,
  repositoryRoot: string,
) {
  if (!isAbsolute(path)) throw codedError("live_smoke_config_must_be_external");
  const resolvedPath = await realpath(path);
  if (pathIsWithinRoot(repositoryRoot, resolvedPath)) {
    throw codedError("live_smoke_config_must_be_external");
  }
  return resolvedPath;
}

export function pathIsWithinRoot(root: string, target: string) {
  const relativePath = relative(resolve(root), resolve(target));
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath))
  );
}

async function createPrivateTemporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "research-video-live-smoke-"));
  try {
    await chmod(root, 0o700);
    return root;
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

async function removeTemporaryRoot(root: string) {
  await rm(root, { recursive: true, force: true });
}

async function pathAbsent(path: string) {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

async function directoryEmptyOrAbsent(path: string) {
  try {
    return (await readdir(path)).length === 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function primaryLanguage(language: string) {
  return language.toLowerCase().split("-")[0];
}

function safeResultCode(value: unknown, fallback: string) {
  return SafeCodeSchema.safeParse(value).success ? String(value) : fallback;
}

function hasLiveSmokeAuthorization(
  authorization: LiveYouTubeSmokeAuthorization,
) {
  return (
    authorization.authorizationConfirmed === true &&
    authorization.liveSmokeAuthorized === true
  );
}

function isProviderBlock(result: LocalExportOnceResult) {
  return new Set([
    "source_provider_failed",
    "source_output_missing",
    "source_authorization_required",
  ]).has(result.error?.code ?? "");
}

function blocked(code: string, removed: boolean): LiveYouTubeSmokeResult {
  return {
    status: "blocked",
    code: safeResultCode(code, "live_smoke_blocked"),
    cleanup: { temporaryWorkspaceRemoved: removed },
  };
}

function failed(code: string, removed: boolean): LiveYouTubeSmokeResult {
  return {
    status: "failed",
    code: safeResultCode(code, "live_smoke_failed"),
    cleanup: { temporaryWorkspaceRemoved: removed },
  };
}

function codedError(code: string) {
  return Object.assign(new Error("Live smoke verification failed."), { code });
}

export async function runLiveYouTubeSmokeMain() {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.on("SIGINT", abort);
  process.on("SIGTERM", abort);
  try {
    return await runLiveYouTubeSmokeCommand(process.argv.slice(2), {
      signal: controller.signal,
    });
  } finally {
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
}

if (import.meta.main) {
  process.exitCode = await runLiveYouTubeSmokeMain();
}
