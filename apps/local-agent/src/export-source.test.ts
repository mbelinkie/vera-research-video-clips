import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { chmod, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ExportClipManifestSchema } from "@research-video/contracts";
import {
  LocalExportQueue,
  LocalTranscriptIndex,
  openLocalDatabase,
  runLocalMigrations,
} from "@research-video/db-local";
import { normalizeTranscriptFixture } from "@research-video/transcript";

import { LocalExportSourceProcessor } from "./export-source.ts";

const directories = new Set<string>();

afterEach(() => {
  for (const directory of directories)
    rmSync(directory, { recursive: true, force: true });
  directories.clear();
});

function fixtureQueue(
  selection: Partial<{
    transcriptStartMs: number;
    transcriptEndMs: number;
    exportStartMs: number;
    exportEndMs: number;
  }> = {},
) {
  const root = mkdtempSync(join(tmpdir(), "local-export-source-"));
  directories.add(root);
  const database = openLocalDatabase(join(root, "local.sqlite"));
  runLocalMigrations(database);
  const queue = new LocalExportQueue(
    database,
    () => new Date("2026-08-14T12:00:00.000Z"),
  );
  const request = queue.createExportOnly({
    idempotencyKey: "source-lifecycle-fixture",
    video: {
      youtubeVideoId: "M7lc1UVf-VE",
      canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      title: "Fixture source",
    },
    selection: {
      trackId: "019fbb95-cd76-7920-93fa-e23ba755e301",
      transcriptVersion: 1,
      firstSegmentId: "019fbb95-cd76-7920-93fa-e23ba755e311",
      lastSegmentId: "019fbb95-cd76-7920-93fa-e23ba755e312",
      transcriptStartMs: selection.transcriptStartMs ?? 300,
      transcriptEndMs: selection.transcriptEndMs ?? 2_900,
      exportStartMs: selection.exportStartMs ?? 0,
      exportEndMs: selection.exportEndMs ?? 3_400,
      text: "Fixture source selection",
      timingPrecision: "cue",
    },
    sourceLanguageClass: "confirmed_english",
    preset: {
      presetVersion: 1,
      name: "Editing MP4",
      settings: {
        container: "mp4",
        videoCodec: "h264",
        videoRateControl: { mode: "crf", value: 20 },
        frameRate: "source",
        audioCodec: "aac",
        omitSubtitleFilesForConfirmedEnglish: false,
        embedEnglishSubtitleTrack: false,
      },
    },
  });
  new LocalTranscriptIndex(database).replace({
    projectId: "project-fixture",
    catalogVideoId: "video-fixture",
    transcriptVersionId: "019fbb95-cd76-7920-93fa-e23ba755e391",
    transcript: normalizeTranscriptFixture({
      track: {
        id: "019fbb95-cd76-7920-93fa-e23ba755e301",
        videoId: "M7lc1UVf-VE",
        language: "en",
        kind: "english",
        source: "youtube-manual",
        provider: "fixture",
        timingPrecision: "cue",
        schemaVersion: 1,
        contentSha256: "a".repeat(64),
        version: 1,
      },
      segments: [
        {
          id: "019fbb95-cd76-7920-93fa-e23ba755e311",
          ordinal: 0,
          startMs: 0,
          endMs: 1_800,
          text: "First fixture cue.",
        },
        {
          id: "019fbb95-cd76-7920-93fa-e23ba755e312",
          ordinal: 1,
          startMs: 1_800,
          endMs: 4_000,
          text: "Second fixture cue.",
        },
      ],
    }),
  });
  return { root, database, queue, request };
}

function configureBilingualFixture(input: {
  database: ReturnType<typeof openLocalDatabase>;
  requestId: string;
  videoId: string;
  sourceLanguageClass?: "foreign" | "mixed" | "unknown";
  omitEnglishSidecars?: boolean;
}) {
  const originalTrackId = "019fbb95-cd76-7920-93fa-e23ba755e302";
  const englishTrackId = "019fbb95-cd76-7920-93fa-e23ba755e301";
  new LocalTranscriptIndex(input.database).replace({
    projectId: "project-fixture",
    catalogVideoId: "video-fixture",
    transcriptVersionId: "019fbb95-cd76-7920-93fa-e23ba755e392",
    transcript: normalizeTranscriptFixture({
      track: {
        id: originalTrackId,
        videoId: input.videoId,
        language: "es",
        kind: "original",
        source: "youtube-manual",
        provider: "fixture",
        timingPrecision: "cue",
        schemaVersion: 1,
        contentSha256: "c".repeat(64),
        version: 1,
      },
      segments: [
        {
          id: "019fbb95-cd76-7920-93fa-e23ba755e321",
          ordinal: 0,
          startMs: 0,
          endMs: 1_800,
          text: "Primera frase de prueba.",
        },
        {
          id: "019fbb95-cd76-7920-93fa-e23ba755e322",
          ordinal: 1,
          startMs: 1_800,
          endMs: 4_000,
          text: "Segunda frase de prueba.",
        },
      ],
    }),
  });
  input.database
    .prepare(
      `UPDATE transcript_tracks
       SET source = 'translated', source_track_id = ?
       WHERE id = ?`,
    )
    .run(originalTrackId, englishTrackId);
  const request = input.database
    .prepare("SELECT preset_snapshot_json FROM export_requests WHERE id = ?")
    .get(input.requestId) as { preset_snapshot_json: string };
  const preset = JSON.parse(request.preset_snapshot_json) as {
    settings: { omitSubtitleFilesForConfirmedEnglish: boolean };
  };
  preset.settings.omitSubtitleFilesForConfirmedEnglish =
    input.omitEnglishSidecars ?? false;
  input.database
    .prepare(
      `UPDATE export_requests
       SET source_language_class = ?, subtitle_tracks_snapshot_json = ?,
           preset_snapshot_json = ?
       WHERE id = ?`,
    )
    .run(
      input.sourceLanguageClass ?? "foreign",
      JSON.stringify({
        original: { trackId: originalTrackId, trackVersion: 1 },
        english: { trackId: englishTrackId, trackVersion: 1 },
      }),
      JSON.stringify(preset),
      input.requestId,
    );
  return { originalTrackId, englishTrackId };
}

function enableConfirmedEnglishOmission(
  database: ReturnType<typeof openLocalDatabase>,
  requestId: string,
) {
  const request = database
    .prepare("SELECT preset_snapshot_json FROM export_requests WHERE id = ?")
    .get(requestId) as { preset_snapshot_json: string };
  const preset = JSON.parse(request.preset_snapshot_json) as {
    settings: { omitSubtitleFilesForConfirmedEnglish: boolean };
  };
  preset.settings.omitSubtitleFilesForConfirmedEnglish = true;
  database
    .prepare("UPDATE export_requests SET preset_snapshot_json = ? WHERE id = ?")
    .run(JSON.stringify(preset), requestId);
}

const fixtureInspection = (durationMs = 2_000) => ({
  durationMs,
  containerFormat: "mov,mp4,m4a,3gp,3g2,mj2",
  videoCodec: "h264",
  audioCodec: "aac",
  ffprobeVersion: "7.1",
});

const fixtureInspector = (
  source = fixtureInspection(),
  output = fixtureInspection(),
) => ({
  inspect: async (path: string) =>
    path.endsWith("rendered-range.mp4") ? output : source,
});

const fixtureRenderer = (
  action?: (input: { outputPath: string }) => Promise<void>,
) => ({
  render: async (input: { outputPath: string }) => {
    if (action) return action(input);
    await writeFile(input.outputPath, "fixture render");
  },
});

const packageFile = (root: string, requestId: string, name: string) =>
  join(root, "exports", `clip-${requestId}`, name);

const sha256 = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

async function readPromotedManifest(root: string, requestId: string) {
  return ExportClipManifestSchema.parse(
    JSON.parse(
      await readFile(packageFile(root, requestId, "manifest.json"), "utf8"),
    ),
  );
}

const fixtureSourceProvider = (contentSha256 = "e".repeat(64)) => ({
  acquireAuthorizedFullSource: async ({
    videoId,
    scratchDirectory,
  }: {
    videoId: string;
    scratchDirectory: string;
  }) => {
    const scratchPath = join(scratchDirectory, `source-${videoId}.mp4`);
    await writeFile(scratchPath, "fixture source");
    return {
      scratchPath,
      sourceIdentity: videoId,
      byteSize: 14,
      provider: "fixture",
      contentSha256,
    };
  },
});

describe("LocalExportSourceProcessor", () => {
  it("renders a confirmed-English omission snapshot without transcript lookup or staged SRTs", async () => {
    const { root, database, queue, request } = fixtureQueue();
    enableConfirmedEnglishOmission(database, request.id);
    const getEnglish = vi.spyOn(queue, "getVerifiedEnglishTranscript");
    const getOriginal = vi.spyOn(queue, "getVerifiedOriginalTranscript");
    const processor = new LocalExportSourceProcessor(
      queue,
      fixtureSourceProvider(),
      fixtureInspector(),
      fixtureRenderer(),
      root,
    );

    await processor.process({
      requestId: request.id,
      authorizationConfirmed: true,
    });

    expect(getEnglish).not.toHaveBeenCalled();
    expect(getOriginal).not.toHaveBeenCalled();
    expect(queue.get(request.id)).toMatchObject({
      state: "complete",
      renderedMediaProvenance: {
        durationMs: 2_000,
        sourceAttempt: 1,
      },
      subtitleOmissionProvenance: {
        policy: "confirmed_english_user_setting",
        sourceAttempt: 1,
        validatedAt: "2026-08-14T12:00:00.000Z",
      },
    });
    expect(queue.get(request.id)?.englishSubtitleProvenance).toBeUndefined();
    expect(queue.get(request.id)?.subtitleSidecars).toBeUndefined();
    expect(queue.get(request.id)?.finalArtifacts).toEqual([
      expect.objectContaining({
        role: "manifest_json",
        packageIdentity: `clip-${request.id}`,
        sourceAttempt: 1,
      }),
      expect.objectContaining({
        role: "video_mp4",
        packageIdentity: `clip-${request.id}`,
        sourceAttempt: 1,
      }),
    ]);
    expect(await readdir(join(root, "exports", `clip-${request.id}`))).toEqual([
      `clip-${request.id}.mp4`,
      "manifest.json",
    ]);
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM export_subtitle_sidecars WHERE export_request_id = ?",
        )
        .get(request.id),
    ).toEqual({ count: 0 });
    expect(
      database
        .prepare(
          `SELECT subtitle_omission_policy, subtitle_omission_source_attempt,
                  subtitle_omission_validated_at
           FROM export_requests WHERE id = ?`,
        )
        .get(request.id),
    ).toEqual({
      subtitle_omission_policy: "confirmed_english_user_setting",
      subtitle_omission_source_attempt: 1,
      subtitle_omission_validated_at: "2026-08-14T12:00:00.000Z",
    });
    expect(queue.getSourceAttempt(request.jobId, 1)).toMatchObject({
      lifecycleState: "deleted",
    });
    expect(await readdir(join(root, "jobs", "export-source-scratch"))).toEqual(
      [],
    );
    database.close();
  });

  it("renders the resolved range, records safe output provenance, then cleans scratch", async () => {
    const { root, database, queue, request } = fixtureQueue();
    const processor = new LocalExportSourceProcessor(
      queue,
      {
        acquireAuthorizedFullSource: async ({ videoId, scratchDirectory }) => {
          const scratchPath = join(scratchDirectory, `source-${videoId}.mp4`);
          await writeFile(scratchPath, "fixture source");
          return {
            scratchPath,
            sourceIdentity: videoId,
            byteSize: 14,
            provider: "fixture",
            contentSha256: "b".repeat(64),
          };
        },
      },
      fixtureInspector(),
      fixtureRenderer(),
      root,
    );

    await processor.process({
      requestId: request.id,
      authorizationConfirmed: true,
    });
    expect(queue.get(request.id)).toMatchObject({ state: "complete" });
    expect(queue.get(request.id)).toMatchObject({
      mediaProvenance: {
        durationMs: 2_000,
        containerFormat: "mov,mp4,m4a,3gp,3g2,mj2",
        videoCodec: "h264",
        audioCodec: "aac",
        ffprobeVersion: "7.1",
      },
      resolvedExportBounds: {
        startMs: 0,
        endMs: 2_000,
        sourceAttempt: 1,
      },
      renderedMediaProvenance: {
        durationMs: 2_000,
        containerFormat: "mov,mp4,m4a,3gp,3g2,mj2",
        videoCodec: "h264",
        audioCodec: "aac",
        ffprobeVersion: "7.1",
        sourceAttempt: 1,
      },
      englishSubtitleProvenance: {
        trackId: "019fbb95-cd76-7920-93fa-e23ba755e301",
        trackVersion: 1,
        cueCount: 2,
        sourceAttempt: 1,
        startMs: 0,
        endMs: 2_000,
      },
      selection: {
        transcriptStartMs: 300,
        transcriptEndMs: 2_900,
        exportStartMs: 0,
        exportEndMs: 3_400,
      },
    });
    expect(queue.getSourceAttempt(request.jobId, 1)).toMatchObject({
      lifecycleState: "deleted",
      provider: "fixture",
      sourceIdentity: "M7lc1UVf-VE",
      contentSha256: "b".repeat(64),
      durationMs: 2_000,
    });
    expect(queue.get(request.id)?.finalArtifacts).toEqual([
      expect.objectContaining({ role: "english_srt", sourceAttempt: 1 }),
      expect.objectContaining({ role: "manifest_json", sourceAttempt: 1 }),
      expect.objectContaining({ role: "video_mp4", sourceAttempt: 1 }),
    ]);
    expect(await readdir(join(root, "exports", `clip-${request.id}`))).toEqual([
      `clip-${request.id}.en.srt`,
      `clip-${request.id}.mp4`,
      "manifest.json",
    ]);
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM source_scratch_assets WHERE job_id = ?",
        )
        .get(request.jobId),
    ).toEqual({ count: 1 });
    database.close();
  });

  it("stages and pair-validates zero-based original plus translated-English SRTs for foreign, mixed, and unknown requests", async () => {
    for (const sourceLanguageClass of [
      "foreign",
      "mixed",
      "unknown",
    ] as const) {
      const { root, database, queue, request } = fixtureQueue();
      const tracks = configureBilingualFixture({
        database,
        requestId: request.id,
        videoId: request.video.youtubeVideoId,
        sourceLanguageClass,
        omitEnglishSidecars: true,
      });
      const processor = new LocalExportSourceProcessor(
        queue,
        fixtureSourceProvider(),
        fixtureInspector(),
        fixtureRenderer(),
        root,
      );

      await processor.process({
        requestId: request.id,
        authorizationConfirmed: true,
      });

      expect(queue.get(request.id)).toMatchObject({
        state: "complete",
        subtitleTracks: {
          original: { trackId: tracks.originalTrackId, trackVersion: 1 },
          english: { trackId: tracks.englishTrackId, trackVersion: 1 },
        },
        subtitleSidecars: [
          {
            role: "english",
            language: "en",
            trackId: tracks.englishTrackId,
            trackVersion: 1,
            cueCount: 2,
            startMs: 0,
            endMs: 2_000,
          },
          {
            role: "original",
            language: "es",
            trackId: tracks.originalTrackId,
            trackVersion: 1,
            cueCount: 2,
            startMs: 0,
            endMs: 2_000,
          },
        ],
      });
      expect(queue.getSourceAttempt(request.jobId, 1)).toMatchObject({
        lifecycleState: "deleted",
      });
      expect(
        await readdir(join(root, "exports", `clip-${request.id}`)),
      ).toEqual([
        `clip-${request.id}.en.srt`,
        `clip-${request.id}.mp4`,
        `clip-${request.id}.original.srt`,
        "manifest.json",
      ]);
      expect(
        await readdir(join(root, "jobs", "export-source-scratch")),
      ).toEqual([]);
      database.close();
    }
  });

  it("rejects missing, wrong-version, non-English, or nonintersecting required bilingual tracks without substitution", async () => {
    const missing = fixtureQueue();
    configureBilingualFixture({
      database: missing.database,
      requestId: missing.request.id,
      videoId: missing.request.video.youtubeVideoId,
    });
    missing.database
      .prepare(
        "UPDATE export_requests SET subtitle_tracks_snapshot_json = NULL WHERE id = ?",
      )
      .run(missing.request.id);
    const missingProcessor = new LocalExportSourceProcessor(
      missing.queue,
      fixtureSourceProvider(),
      fixtureInspector(),
      fixtureRenderer(),
      missing.root,
    );
    await expect(
      missingProcessor.process({
        requestId: missing.request.id,
        authorizationConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: "subtitle_track_snapshot_missing" });
    expect(
      missing.queue.getSourceAttempt(missing.request.jobId, 1),
    ).toBeUndefined();

    const wrongVersion = fixtureQueue();
    configureBilingualFixture({
      database: wrongVersion.database,
      requestId: wrongVersion.request.id,
      videoId: wrongVersion.request.video.youtubeVideoId,
    });
    wrongVersion.database
      .prepare(
        `UPDATE export_requests
         SET subtitle_tracks_snapshot_json = ? WHERE id = ?`,
      )
      .run(
        JSON.stringify({
          original: {
            trackId: "019fbb95-cd76-7920-93fa-e23ba755e302",
            trackVersion: 1,
          },
          english: {
            trackId: "019fbb95-cd76-7920-93fa-e23ba755e301",
            trackVersion: 2,
          },
        }),
        wrongVersion.request.id,
      );
    const wrongVersionProcessor = new LocalExportSourceProcessor(
      wrongVersion.queue,
      fixtureSourceProvider(),
      fixtureInspector(),
      fixtureRenderer(),
      wrongVersion.root,
    );
    await expect(
      wrongVersionProcessor.process({
        requestId: wrongVersion.request.id,
        authorizationConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: "english_transcript_version_unavailable" });
    expect(
      wrongVersion.queue.getSourceAttempt(wrongVersion.request.jobId, 1),
    ).toBeUndefined();

    const nonEnglish = fixtureQueue();
    configureBilingualFixture({
      database: nonEnglish.database,
      requestId: nonEnglish.request.id,
      videoId: nonEnglish.request.video.youtubeVideoId,
    });
    nonEnglish.database
      .prepare("UPDATE transcript_tracks SET language = 'fr' WHERE id = ?")
      .run("019fbb95-cd76-7920-93fa-e23ba755e301");
    const nonEnglishProcessor = new LocalExportSourceProcessor(
      nonEnglish.queue,
      fixtureSourceProvider(),
      fixtureInspector(),
      fixtureRenderer(),
      nonEnglish.root,
    );
    await expect(
      nonEnglishProcessor.process({
        requestId: nonEnglish.request.id,
        authorizationConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: "english_transcript_version_mismatched" });

    const noCue = fixtureQueue({
      transcriptStartMs: 4_500,
      transcriptEndMs: 4_900,
      exportStartMs: 4_500,
      exportEndMs: 5_000,
    });
    configureBilingualFixture({
      database: noCue.database,
      requestId: noCue.request.id,
      videoId: noCue.request.video.youtubeVideoId,
    });
    const noCueProcessor = new LocalExportSourceProcessor(
      noCue.queue,
      fixtureSourceProvider(),
      fixtureInspector(fixtureInspection(5_000), fixtureInspection(500)),
      fixtureRenderer(),
      noCue.root,
    );
    await expect(
      noCueProcessor.process({
        requestId: noCue.request.id,
        authorizationConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: "original_subtitle_cue_missing" });
    expect(noCue.queue.getSourceAttempt(noCue.request.jobId, 1)).toMatchObject({
      lifecycleState: "deleted",
    });

    missing.database.close();
    wrongVersion.database.close();
    nonEnglish.database.close();
    noCue.database.close();
  });

  it("makes an unconfigured provider actionable without attempting acquisition", async () => {
    const { root, database, queue, request } = fixtureQueue();
    const processor = new LocalExportSourceProcessor(
      queue,
      undefined,
      fixtureInspector(),
      fixtureRenderer(),
      root,
    );

    await expect(
      processor.process({
        requestId: request.id,
        authorizationConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: "export_source_provider_unconfigured" });
    expect(queue.get(request.id)).toMatchObject({ state: "needs_user_action" });
    expect(queue.getSourceAttempt(request.jobId, 1)).toBeUndefined();
    database.close();
  });

  it("rejects missing snapshotted English versions and missing bilingual snapshots before acquisition", async () => {
    const { root, database, queue, request } = fixtureQueue();
    database
      .prepare(
        "UPDATE export_requests SET selection_snapshot_json = ? WHERE id = ?",
      )
      .run(
        JSON.stringify({
          ...request.selection,
          trackId: "019fbb95-cd76-7920-93fa-e23ba755e399",
        }),
        request.id,
      );
    const processor = new LocalExportSourceProcessor(
      queue,
      fixtureSourceProvider(),
      fixtureInspector(),
      fixtureRenderer(),
      root,
    );
    await expect(
      processor.process({
        requestId: request.id,
        authorizationConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: "english_transcript_version_unavailable" });
    expect(queue.get(request.id)).toMatchObject({ state: "needs_user_action" });
    expect(queue.getSourceAttempt(request.jobId, 1)).toBeUndefined();

    const second = fixtureQueue();
    second.database
      .prepare(
        "UPDATE export_requests SET source_language_class = 'foreign' WHERE id = ?",
      )
      .run(second.request.id);
    const foreignProcessor = new LocalExportSourceProcessor(
      second.queue,
      fixtureSourceProvider(),
      fixtureInspector(),
      fixtureRenderer(),
      second.root,
    );
    await expect(
      foreignProcessor.process({
        requestId: second.request.id,
        authorizationConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: "subtitle_track_snapshot_missing" });
    expect(
      second.queue.getSourceAttempt(second.request.jobId, 1),
    ).toBeUndefined();

    const mismatched = fixtureQueue();
    mismatched.database
      .prepare("UPDATE transcript_tracks SET language = 'fr' WHERE id = ?")
      .run(mismatched.request.selection.trackId);
    const mismatchedProcessor = new LocalExportSourceProcessor(
      mismatched.queue,
      fixtureSourceProvider(),
      fixtureInspector(),
      fixtureRenderer(),
      mismatched.root,
    );
    await expect(
      mismatchedProcessor.process({
        requestId: mismatched.request.id,
        authorizationConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: "english_transcript_version_mismatched" });
    expect(
      mismatched.queue.getSourceAttempt(mismatched.request.jobId, 1),
    ).toBeUndefined();
    database.close();
    second.database.close();
    mismatched.database.close();
  });

  it("fails an empty resolved range and still deletes source scratch", async () => {
    const { root, database, queue, request } = fixtureQueue({
      transcriptStartMs: 3_000,
      transcriptEndMs: 3_900,
      exportStartMs: 3_000,
      exportEndMs: 4_000,
    });
    const processor = new LocalExportSourceProcessor(
      queue,
      {
        acquireAuthorizedFullSource: async ({ videoId, scratchDirectory }) => {
          const scratchPath = join(scratchDirectory, `source-${videoId}.mp4`);
          await writeFile(scratchPath, "fixture source");
          return {
            scratchPath,
            sourceIdentity: videoId,
            byteSize: 14,
            provider: "fixture",
            contentSha256: "c".repeat(64),
          };
        },
      },
      fixtureInspector(fixtureInspection(2_000), fixtureInspection(2_000)),
      fixtureRenderer(),
      root,
    );

    await expect(
      processor.process({
        requestId: request.id,
        authorizationConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: "export_bounds_empty" });
    expect(queue.get(request.id)).toMatchObject({ state: "needs_user_action" });
    expect(queue.get(request.id)?.resolvedExportBounds).toBeUndefined();
    expect(queue.getSourceAttempt(request.jobId, 1)).toMatchObject({
      lifecycleState: "deleted",
    });
    database.close();
  });

  it("cleans source scratch after malformed inspection output or cancellation", async () => {
    const { root, database, queue, request } = fixtureQueue();
    const provider = {
      acquireAuthorizedFullSource: async ({
        videoId,
        scratchDirectory,
      }: {
        videoId: string;
        scratchDirectory: string;
      }) => {
        const scratchPath = join(scratchDirectory, `source-${videoId}.mp4`);
        await writeFile(scratchPath, "fixture source");
        return {
          scratchPath,
          sourceIdentity: videoId,
          byteSize: 14,
          provider: "fixture",
          contentSha256: "d".repeat(64),
        };
      },
    };
    const malformed = new LocalExportSourceProcessor(
      queue,
      provider,
      {
        inspect: async () => {
          throw Object.assign(new Error("malformed output"), {
            code: "ffprobe_output_malformed",
          });
        },
      },
      fixtureRenderer(),
      root,
    );
    await expect(
      malformed.process({
        requestId: request.id,
        authorizationConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: "ffprobe_output_malformed" });
    expect(queue.getSourceAttempt(request.jobId, 1)).toMatchObject({
      lifecycleState: "deleted",
    });

    const cancellation = new AbortController();
    const canceled = new LocalExportSourceProcessor(
      queue,
      provider,
      {
        inspect: async (_path, signal) => {
          cancellation.abort();
          if (signal?.aborted) {
            throw Object.assign(new Error("canceled"), {
              code: "source_inspection_canceled",
            });
          }
          throw new Error("expected cancellation");
        },
      },
      fixtureRenderer(),
      root,
    );
    await expect(
      canceled.process({
        requestId: request.id,
        authorizationConfirmed: true,
        signal: cancellation.signal,
      }),
    ).rejects.toMatchObject({ code: "source_inspection_canceled" });
    expect(queue.getSourceAttempt(request.jobId, 2)).toMatchObject({
      lifecycleState: "deleted",
    });
    database.close();
  });

  it("rejects invalid rendered codec or duration and deletes source plus temporary output", async () => {
    const { root, database, queue, request } = fixtureQueue();
    enableConfirmedEnglishOmission(database, request.id);
    const processor = new LocalExportSourceProcessor(
      queue,
      fixtureSourceProvider(),
      fixtureInspector(fixtureInspection(), {
        ...fixtureInspection(),
        videoCodec: "hevc",
      }),
      fixtureRenderer(),
      root,
    );

    await expect(
      processor.process({
        requestId: request.id,
        authorizationConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: "render_output_video_codec_mismatch" });
    expect(queue.get(request.id)).toMatchObject({ state: "needs_user_action" });
    expect(queue.get(request.id)?.renderedMediaProvenance).toBeUndefined();
    expect(queue.getSourceAttempt(request.jobId, 1)).toMatchObject({
      lifecycleState: "deleted",
    });
    expect(await readdir(join(root, "jobs", "export-source-scratch"))).toEqual(
      [],
    );
    database.close();
  });

  it("cleans source, temporary MP4, and sidecar scratch after subtitle derivation or validation failure", async () => {
    const noCue = fixtureQueue({
      transcriptStartMs: 4_500,
      transcriptEndMs: 4_900,
      exportStartMs: 4_500,
      exportEndMs: 5_000,
    });
    const noCueProcessor = new LocalExportSourceProcessor(
      noCue.queue,
      fixtureSourceProvider(),
      fixtureInspector(fixtureInspection(5_000), fixtureInspection(500)),
      fixtureRenderer(),
      noCue.root,
    );
    configureBilingualFixture({
      database: noCue.database,
      requestId: noCue.request.id,
      videoId: noCue.request.video.youtubeVideoId,
    });
    await expect(
      noCueProcessor.process({
        requestId: noCue.request.id,
        authorizationConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: "original_subtitle_cue_missing" });
    expect(noCue.queue.getSourceAttempt(noCue.request.jobId, 1)).toMatchObject({
      lifecycleState: "deleted",
    });
    expect(
      await readdir(join(noCue.root, "jobs", "export-source-scratch")),
    ).toEqual([]);

    const outOfRange = fixtureQueue();
    const validationProcessor = new LocalExportSourceProcessor(
      outOfRange.queue,
      fixtureSourceProvider(),
      fixtureInspector(fixtureInspection(), fixtureInspection(1_800)),
      fixtureRenderer(),
      outOfRange.root,
    );
    configureBilingualFixture({
      database: outOfRange.database,
      requestId: outOfRange.request.id,
      videoId: outOfRange.request.video.youtubeVideoId,
    });
    await expect(
      validationProcessor.process({
        requestId: outOfRange.request.id,
        authorizationConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: "srt_out_of_range" });
    expect(
      outOfRange.queue.getSourceAttempt(outOfRange.request.jobId, 1),
    ).toMatchObject({ lifecycleState: "deleted" });
    expect(
      await readdir(join(outOfRange.root, "jobs", "export-source-scratch")),
    ).toEqual([]);
    noCue.database.close();
    outOfRange.database.close();
  });

  it("cleans source, temporary MP4, and both staged sidecars after bilingual cancellation", async () => {
    const { root, database, queue, request } = fixtureQueue();
    configureBilingualFixture({
      database,
      requestId: request.id,
      videoId: request.video.youtubeVideoId,
    });
    let abortChecks = 0;
    const signal = {
      get aborted() {
        abortChecks += 1;
        return abortChecks >= 6;
      },
    } as AbortSignal;
    const processor = new LocalExportSourceProcessor(
      queue,
      fixtureSourceProvider(),
      fixtureInspector(),
      fixtureRenderer(),
      root,
    );
    await expect(
      processor.process({
        requestId: request.id,
        authorizationConfirmed: true,
        signal,
      }),
    ).rejects.toMatchObject({ code: "english_subtitle_canceled" });
    expect(queue.getSourceAttempt(request.jobId, 1)).toMatchObject({
      lifecycleState: "deleted",
    });
    expect(await readdir(join(root, "jobs", "export-source-scratch"))).toEqual(
      [],
    );
    database.close();
  });

  it("rejects policy-mismatched staging and rolls back a canceled final package", async () => {
    const malformed = fixtureQueue();
    const malformedProcessor = new LocalExportSourceProcessor(
      malformed.queue,
      fixtureSourceProvider(),
      fixtureInspector(),
      fixtureRenderer(async ({ outputPath }) => {
        await writeFile(outputPath, "fixture render");
        await writeFile(
          join(join(outputPath, ".."), "extra.srt"),
          "unexpected",
        );
      }),
      malformed.root,
    );
    await expect(
      malformedProcessor.process({
        requestId: malformed.request.id,
        authorizationConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: "staged_package_extra_artifact" });
    expect(
      malformed.queue.getSourceAttempt(malformed.request.jobId, 1),
    ).toMatchObject({
      lifecycleState: "deleted",
    });
    expect(
      await readdir(join(malformed.root, "jobs", "export-source-scratch")),
    ).toEqual([]);
    malformed.database.close();

    const canceled = fixtureQueue();
    enableConfirmedEnglishOmission(canceled.database, canceled.request.id);
    let checks = 0;
    const signal = {
      get aborted() {
        checks += 1;
        return checks >= 5;
      },
    } as AbortSignal;
    const canceledProcessor = new LocalExportSourceProcessor(
      canceled.queue,
      fixtureSourceProvider(),
      fixtureInspector(),
      fixtureRenderer(),
      canceled.root,
    );
    await expect(
      canceledProcessor.process({
        requestId: canceled.request.id,
        authorizationConfirmed: true,
        signal,
      }),
    ).rejects.toMatchObject({ code: "final_package_promotion_canceled" });
    expect(
      canceled.queue.getSourceAttempt(canceled.request.jobId, 1),
    ).toMatchObject({
      lifecycleState: "deleted",
    });
    expect(
      await readdir(join(canceled.root, "jobs", "export-source-scratch")),
    ).toEqual([]);
    expect(await readdir(join(canceled.root, "exports"))).toEqual([]);
    canceled.database.close();
  });

  it("rejects incomplete or malformed validated sidecars before promotion", async () => {
    for (const mutation of ["remove", "malform"] as const) {
      const { root, database, queue, request } = fixtureQueue();
      const record = queue.recordEnglishSubtitleValidation.bind(queue);
      vi.spyOn(queue, "recordEnglishSubtitleValidation").mockImplementation(
        (...input) => {
          record(...input);
          const attempt = readdirSync(
            join(root, "jobs", "export-source-scratch"),
          )[0]!;
          const sidecar = join(
            root,
            "jobs",
            "export-source-scratch",
            attempt,
            "english.srt",
          );
          if (mutation === "remove") rmSync(sidecar);
          else writeFileSync(sidecar, "not an SRT");
        },
      );
      const processor = new LocalExportSourceProcessor(
        queue,
        fixtureSourceProvider(),
        fixtureInspector(),
        fixtureRenderer(),
        root,
      );
      await expect(
        processor.process({
          requestId: request.id,
          authorizationConfirmed: true,
        }),
      ).rejects.toMatchObject({
        code:
          mutation === "remove"
            ? "staged_package_artifact_invalid"
            : "staged_package_sidecar_malformed",
      });
      expect(queue.getSourceAttempt(request.jobId, 1)).toMatchObject({
        lifecycleState: "deleted",
      });
      expect(
        await readdir(join(root, "jobs", "export-source-scratch")),
      ).toEqual([]);
      expect(await readdir(join(root, "exports"))).toEqual([]);
      database.close();
    }
  });

  it("keeps final-artifact provenance path-free and export-only projectless", async () => {
    const { root, database, queue, request } = fixtureQueue();
    enableConfirmedEnglishOmission(database, request.id);
    const processor = new LocalExportSourceProcessor(
      queue,
      fixtureSourceProvider(),
      fixtureInspector(),
      fixtureRenderer(),
      root,
    );

    await processor.process({
      requestId: request.id,
      authorizationConfirmed: true,
    });

    expect(queue.get(request.id)).toMatchObject({
      mode: "export_only",
      state: "complete",
      finalArtifacts: [
        {
          role: "manifest_json",
          packageIdentity: `clip-${request.id}`,
          sourceAttempt: 1,
        },
        {
          role: "video_mp4",
          packageIdentity: `clip-${request.id}`,
          sourceAttempt: 1,
        },
      ],
    });
    expect(
      database
        .prepare("PRAGMA table_info(export_final_artifacts)")
        .all()
        .map((column) => String(column["name"])),
    ).toEqual([
      "export_request_id",
      "role",
      "package_identity",
      "byte_size",
      "content_sha256",
      "source_attempt",
      "validated_at",
    ]);
    database.close();
  });

  it("cleans source and temporary output after FFmpeg failure or cancellation", async () => {
    const { root, database, queue, request } = fixtureQueue();
    enableConfirmedEnglishOmission(database, request.id);
    const failed = new LocalExportSourceProcessor(
      queue,
      fixtureSourceProvider(),
      fixtureInspector(),
      fixtureRenderer(async ({ outputPath }) => {
        await writeFile(outputPath, "partial render");
        throw Object.assign(new Error("FFmpeg failed"), {
          code: "ffmpeg_render_failed",
        });
      }),
      root,
    );
    await expect(
      failed.process({ requestId: request.id, authorizationConfirmed: true }),
    ).rejects.toMatchObject({ code: "ffmpeg_render_failed" });
    expect(queue.getSourceAttempt(request.jobId, 1)).toMatchObject({
      lifecycleState: "deleted",
    });

    const cancellation = new AbortController();
    const canceled = new LocalExportSourceProcessor(
      queue,
      fixtureSourceProvider("f".repeat(64)),
      fixtureInspector(),
      fixtureRenderer(async ({ outputPath }) => {
        await writeFile(outputPath, "partial render");
        cancellation.abort();
        throw Object.assign(new Error("render canceled"), {
          code: "ffmpeg_render_canceled",
        });
      }),
      root,
    );
    await expect(
      canceled.process({
        requestId: request.id,
        authorizationConfirmed: true,
        signal: cancellation.signal,
      }),
    ).rejects.toMatchObject({ code: "ffmpeg_render_canceled" });
    expect(queue.getSourceAttempt(request.jobId, 2)).toMatchObject({
      lifecycleState: "deleted",
    });
    expect(await readdir(join(root, "jobs", "export-source-scratch"))).toEqual(
      [],
    );
    database.close();
  });

  it("keeps the established source cleanup failure actionable after a valid render", async () => {
    const { root, database, queue, request } = fixtureQueue();
    enableConfirmedEnglishOmission(database, request.id);
    const processor = new LocalExportSourceProcessor(
      queue,
      fixtureSourceProvider(),
      fixtureInspector(),
      fixtureRenderer(async ({ outputPath }) => {
        await writeFile(outputPath, "fixture render");
        await chmod(join(root, "jobs", "export-source-scratch"), 0o500);
      }),
      root,
    );
    try {
      await expect(
        processor.process({
          requestId: request.id,
          authorizationConfirmed: true,
        }),
      ).rejects.toMatchObject({ code: "source_cleanup_failed" });
      expect(queue.get(request.id)).toMatchObject({
        state: "needs_user_action",
      });
      expect(queue.getSourceAttempt(request.jobId, 1)).toMatchObject({
        lifecycleState: "cleanup_failed",
        cleanupErrorCode: "source_cleanup_failed",
      });
    } finally {
      await chmod(join(root, "jobs", "export-source-scratch"), 0o700);
    }
    database.close();
  });

  it("promotes one manifest naming every verified artifact of a bilingual package", async () => {
    const { root, database, queue, request } = fixtureQueue();
    const tracks = configureBilingualFixture({
      database,
      requestId: request.id,
      videoId: request.video.youtubeVideoId,
    });
    const processor = new LocalExportSourceProcessor(
      queue,
      fixtureSourceProvider(),
      fixtureInspector(),
      fixtureRenderer(),
      root,
    );

    await processor.process({
      requestId: request.id,
      authorizationConfirmed: true,
    });

    const manifest = await readPromotedManifest(root, request.id);
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      exportRequestId: request.id,
      jobId: request.jobId,
      mode: "export_only",
      packageIdentity: `clip-${request.id}`,
      sourceAttempt: 1,
      validatedAt: "2026-08-14T12:00:00.000Z",
      video: {
        youtubeVideoId: "M7lc1UVf-VE",
        canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
        title: "Fixture source",
      },
      sourceLanguageClass: "foreign",
      resolvedExportBounds: { startMs: 0, endMs: 2_000, sourceAttempt: 1 },
      renderedDurationMs: 2_000,
      subtitlePolicy: { requiredSidecars: ["original", "english"] },
      toolVersions: { ffprobeVersion: "7.1" },
    });
    expect(manifest.toolVersions).not.toHaveProperty("ffmpegVersion");
    expect(manifest.subtitlePolicy).not.toHaveProperty(
      "subtitleSidecarsOmittedReason",
    );
    expect(manifest.artifacts.map((artifact) => artifact.filename)).toEqual([
      `clip-${request.id}.mp4`,
      `clip-${request.id}.original.srt`,
      `clip-${request.id}.en.srt`,
    ]);
    expect(manifest.artifacts[0]).not.toHaveProperty("subtitle");
    expect(manifest.artifacts[1]?.subtitle).toEqual({
      language: "es",
      trackId: tracks.originalTrackId,
      trackVersion: 1,
      timingPrecision: "cue",
      cueCount: 2,
      startMs: 0,
      endMs: 2_000,
    });
    expect(manifest.artifacts[2]?.subtitle).toMatchObject({
      language: "en",
      trackId: tracks.englishTrackId,
      trackVersion: 1,
    });
    for (const artifact of manifest.artifacts) {
      const bytes = await readFile(
        packageFile(root, request.id, artifact.filename),
      );
      expect(artifact.byteSize).toBe(bytes.byteLength);
      expect(artifact.contentSha256).toBe(sha256(bytes));
    }

    const promoted = queue.get(request.id)?.finalArtifacts ?? [];
    const manifestBytes = await readFile(
      packageFile(root, request.id, "manifest.json"),
    );
    expect(
      promoted.find((artifact) => artifact.role === "manifest_json"),
    ).toMatchObject({
      packageIdentity: `clip-${request.id}`,
      byteSize: manifestBytes.byteLength,
      contentSha256: sha256(manifestBytes),
      sourceAttempt: 1,
    });
    expect(JSON.stringify(manifest)).not.toContain(root);
    database.close();
  });

  it("records the confirmed-English sidecar policy and its explicit omission", async () => {
    const withSidecar = fixtureQueue();
    const sidecarProcessor = new LocalExportSourceProcessor(
      withSidecar.queue,
      fixtureSourceProvider(),
      fixtureInspector(),
      fixtureRenderer(),
      withSidecar.root,
    );
    await sidecarProcessor.process({
      requestId: withSidecar.request.id,
      authorizationConfirmed: true,
    });

    const englishManifest = await readPromotedManifest(
      withSidecar.root,
      withSidecar.request.id,
    );
    expect(englishManifest).toMatchObject({
      sourceLanguageClass: "confirmed_english",
      subtitlePolicy: { requiredSidecars: ["english"] },
    });
    expect(englishManifest.artifacts.map((artifact) => artifact.role)).toEqual([
      "video_mp4",
      "english_srt",
    ]);
    expect(englishManifest.artifacts[1]?.subtitle).toEqual({
      language: "en",
      trackId: withSidecar.request.selection.trackId,
      trackVersion: 1,
      timingPrecision: "cue",
      cueCount: 2,
      startMs: 0,
      endMs: 2_000,
    });
    withSidecar.database.close();

    const omitted = fixtureQueue();
    enableConfirmedEnglishOmission(omitted.database, omitted.request.id);
    const omissionProcessor = new LocalExportSourceProcessor(
      omitted.queue,
      fixtureSourceProvider(),
      fixtureInspector(),
      fixtureRenderer(),
      omitted.root,
    );
    await omissionProcessor.process({
      requestId: omitted.request.id,
      authorizationConfirmed: true,
    });

    const omittedManifest = await readPromotedManifest(
      omitted.root,
      omitted.request.id,
    );
    expect(omittedManifest.subtitlePolicy).toEqual({
      requiredSidecars: [],
      subtitleSidecarsOmittedReason: "confirmed_english_user_setting",
    });
    expect(omittedManifest.artifacts.map((artifact) => artifact.role)).toEqual([
      "video_mp4",
    ]);
    omitted.database.close();
  });

  it("leaves no package when the manifest cannot be staged or stops matching promoted bytes", async () => {
    const squatted = fixtureQueue();
    enableConfirmedEnglishOmission(squatted.database, squatted.request.id);
    const squattedProcessor = new LocalExportSourceProcessor(
      squatted.queue,
      fixtureSourceProvider(),
      fixtureInspector(),
      fixtureRenderer(async ({ outputPath }) => {
        await writeFile(outputPath, "fixture render");
        await writeFile(
          join(outputPath, "..", "manifest.json"),
          "squatted manifest",
        );
      }),
      squatted.root,
    );
    await expect(
      squattedProcessor.process({
        requestId: squatted.request.id,
        authorizationConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: "clip_manifest_staging_failed" });
    expect(squatted.queue.get(squatted.request.id)).toMatchObject({
      state: "needs_user_action",
    });
    expect(
      squatted.queue.get(squatted.request.id)?.finalArtifacts,
    ).toBeUndefined();
    expect(
      squatted.queue.getSourceAttempt(squatted.request.jobId, 1),
    ).toMatchObject({ lifecycleState: "deleted" });
    expect(await readdir(join(squatted.root, "exports"))).toEqual([]);
    expect(
      await readdir(join(squatted.root, "jobs", "export-source-scratch")),
    ).toEqual([]);
    squatted.database.close();

    const tampered = fixtureQueue();
    enableConfirmedEnglishOmission(tampered.database, tampered.request.id);
    const promotedVideo = packageFile(
      tampered.root,
      tampered.request.id,
      `clip-${tampered.request.id}.mp4`,
    );
    const signal = {
      get aborted() {
        if (existsSync(promotedVideo)) {
          writeFileSync(promotedVideo, "tampered promoted bytes");
        }
        return false;
      },
    } as AbortSignal;
    const tamperedProcessor = new LocalExportSourceProcessor(
      tampered.queue,
      fixtureSourceProvider(),
      fixtureInspector(),
      fixtureRenderer(),
      tampered.root,
    );
    await expect(
      tamperedProcessor.process({
        requestId: tampered.request.id,
        authorizationConfirmed: true,
        signal,
      }),
    ).rejects.toMatchObject({ code: "final_package_artifact_mismatched" });
    expect(
      tampered.queue.get(tampered.request.id)?.finalArtifacts,
    ).toBeUndefined();
    expect(
      tampered.queue.getSourceAttempt(tampered.request.jobId, 1),
    ).toMatchObject({ lifecycleState: "deleted" });
    expect(await readdir(join(tampered.root, "exports"))).toEqual([]);
    expect(
      await readdir(join(tampered.root, "jobs", "export-source-scratch")),
    ).toEqual([]);
    tampered.database.close();
  });
});
