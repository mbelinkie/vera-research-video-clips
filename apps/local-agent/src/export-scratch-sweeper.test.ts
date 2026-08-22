import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LocalExportQueue,
  openLocalDatabase,
  runLocalMigrations,
} from "@research-video/db-local";

import { runLocalExportOnce } from "./export-run-once.ts";
import { runLocalSourceScratchSweep } from "./export-scratch-sweeper.ts";

const directories = new Set<string>();
let fixtureNumber = 0;

afterEach(() => {
  for (const directory of directories) {
    rmSync(directory, { recursive: true, force: true });
  }
  directories.clear();
});

function fixtureQueue(now = "2026-08-21T12:00:00.000Z") {
  const root = mkdtempSync(join(tmpdir(), "local-export-scratch-sweep-"));
  directories.add(root);
  const database = openLocalDatabase(join(root, "local.sqlite"));
  runLocalMigrations(database);
  const queue = new LocalExportQueue(database, () => new Date(now));
  fixtureNumber += 1;
  const request = queue.createExportOnly({
    idempotencyKey: `scratch-sweep-${fixtureNumber}`,
    video: {
      youtubeVideoId: "M7lc1UVf-VE",
      canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      title: "Scratch sweep fixture",
    },
    selection: {
      trackId: "019fbb95-cd76-7920-93fa-e23ba755e301",
      transcriptVersion: 1,
      firstSegmentId: "019fbb95-cd76-7920-93fa-e23ba755e311",
      lastSegmentId: "019fbb95-cd76-7920-93fa-e23ba755e312",
      transcriptStartMs: 300,
      transcriptEndMs: 2_900,
      exportStartMs: 0,
      exportEndMs: 3_200,
      text: "Scratch sweep fixture",
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
  return { root, database, queue, request };
}

function attemptDirectory(root: string, jobId: string, attempt: number) {
  return join(root, "jobs", "export-source-scratch", jobId, String(attempt));
}

function makeExpired(
  queue: LocalExportQueue,
  database: ReturnType<typeof openLocalDatabase>,
  requestId: string,
) {
  const started = queue.beginSourceAcquisition(requestId);
  database
    .prepare(
      "UPDATE source_scratch_assets SET expires_at = ? WHERE job_id = ? AND attempt = ?",
    )
    .run("2026-08-20T12:00:00.000Z", started.request.jobId, started.attempt);
  return started;
}

describe("runLocalSourceScratchSweep", () => {
  it("deletes only the exact claimed shared-group root and settles its durable claim", async () => {
    const root = mkdtempSync(join(tmpdir(), "local-export-group-sweep-"));
    directories.add(root);
    const groupId = "019fbb95-cd76-7920-93fa-e23ba755ef90";
    const siblingId = "019fbb95-cd76-7920-93fa-e23ba755ef91";
    const target = join(root, "jobs", "export-source-groups", groupId, "1");
    const sibling = join(root, "jobs", "export-source-groups", siblingId, "1");
    mkdirSync(target, { recursive: true, mode: 0o700 });
    mkdirSync(sibling, { recursive: true, mode: 0o700 });
    writeFileSync(join(target, "source.mp4"), "delete group");
    writeFileSync(join(sibling, "source.mp4"), "preserve sibling");
    const claim = {
      groupId,
      claimToken: "019fbb95-cd76-7920-93fa-e23ba755ef92",
    };
    const complete = vi.fn(() => ({
      restoredComplete: false,
      markedNeedsUserAction: true,
    }));
    const claimGroups = vi.fn(() => [claim]);
    const queue = {
      countLegacySourceScratchRecoveryRows: () => 0,
      claimLoggedExportSourceGroupCleanup: claimGroups,
      claimSourceScratchCleanup: () => [],
      completeLoggedExportSourceGroupCleanupClaim: complete,
      failLoggedExportSourceGroupCleanupClaim: vi.fn(),
    } as unknown as LocalExportQueue;

    await expect(
      runLocalSourceScratchSweep(
        { recoverOrphanedGroups: true },
        { queue, dataRoot: root },
      ),
    ).resolves.toEqual({
      status: "complete",
      claimed: 1,
      deleted: 1,
      cleanupFailed: 0,
      restoredComplete: 0,
      markedNeedsUserAction: 1,
      legacyUnsupported: 0,
    });
    expect(existsSync(target)).toBe(false);
    expect(readFileSync(join(sibling, "source.mp4"), "utf8")).toBe(
      "preserve sibling",
    );
    expect(complete).toHaveBeenCalledWith(claim);
    expect(claimGroups).toHaveBeenCalledWith(10, {
      recoverOrphanedJoined: true,
    });
  });

  it("deletes only the expired exact attempt child and preserves siblings and exports", async () => {
    const { root, database, queue, request } = fixtureQueue();
    const started = makeExpired(queue, database, request.id);
    const target = attemptDirectory(
      root,
      started.request.jobId,
      started.attempt,
    );
    const sibling = attemptDirectory(root, started.request.jobId, 2);
    const exportPackage = join(root, "exports", "clip-protected");
    mkdirSync(target, { recursive: true, mode: 0o700 });
    mkdirSync(sibling, { recursive: true, mode: 0o700 });
    mkdirSync(exportPackage, { recursive: true, mode: 0o700 });
    writeFileSync(join(target, "source.mp4"), "delete only this");
    writeFileSync(join(sibling, "keep.txt"), "sibling stays");
    writeFileSync(join(exportPackage, "manifest.json"), "package stays");

    await expect(
      runLocalSourceScratchSweep({}, { queue, dataRoot: root }),
    ).resolves.toEqual({
      status: "complete",
      claimed: 1,
      deleted: 1,
      cleanupFailed: 0,
      restoredComplete: 0,
      markedNeedsUserAction: 1,
      legacyUnsupported: 0,
    });
    expect(existsSync(target)).toBe(false);
    expect(readFileSync(join(sibling, "keep.txt"), "utf8")).toBe(
      "sibling stays",
    );
    expect(readFileSync(join(exportPackage, "manifest.json"), "utf8")).toBe(
      "package stays",
    );
    expect(
      queue.getSourceAttempt(started.request.jobId, started.attempt),
    ).toMatchObject({
      lifecycleState: "deleted",
    });
    expect(queue.get(request.id)).toMatchObject({ state: "needs_user_action" });
    const payload = database
      .prepare("SELECT payload_json FROM jobs WHERE id = ?")
      .get(started.request.jobId) as { payload_json: string };
    expect(JSON.parse(payload.payload_json)).toMatchObject({
      lastError: { code: "source_scratch_abandoned" },
    });
    database.close();
  });

  it("treats a missing exact directory as verified deletion and preserves active work", async () => {
    const missing = fixtureQueue();
    const started = makeExpired(
      missing.queue,
      missing.database,
      missing.request.id,
    );
    missing.queue.recordSourceCleanupFailed(
      started.request.jobId,
      started.attempt,
      "Could not delete /private/source.mp4",
    );
    await expect(
      runLocalSourceScratchSweep(
        {},
        { queue: missing.queue, dataRoot: missing.root },
      ),
    ).resolves.toMatchObject({ deleted: 1, markedNeedsUserAction: 1 });
    expect(
      missing.queue.getSourceAttempt(started.request.jobId, started.attempt),
    ).toMatchObject({ lifecycleState: "deleted" });
    const payload = missing.database
      .prepare("SELECT payload_json FROM jobs WHERE id = ?")
      .get(started.request.jobId) as { payload_json: string };
    expect(JSON.parse(payload.payload_json)).toMatchObject({
      lastError: { code: "source_scratch_cleanup_recovered" },
    });

    const active = fixtureQueue();
    const activeStarted = active.queue.beginSourceAcquisition(
      active.request.id,
    );
    await expect(
      runLocalSourceScratchSweep(
        {},
        { queue: active.queue, dataRoot: active.root },
      ),
    ).resolves.toMatchObject({ claimed: 0, deleted: 0 });
    expect(
      active.queue.getSourceAttempt(
        activeStarted.request.jobId,
        activeStarted.attempt,
      ),
    ).toMatchObject({ lifecycleState: "acquiring" });
    missing.database.close();
    active.database.close();
  });

  it("reports legacy random-layout rows without touching a lookalike deterministic directory", async () => {
    const { root, database, queue } = fixtureQueue();
    const legacyJobId = "019fbb95-cd76-7920-93fa-e23ba755ef70";
    database.exec(`
      INSERT INTO jobs
        (id, kind, state, idempotency_key, attempt, payload_json, created_at, updated_at)
      VALUES ('${legacyJobId}', 'export', 'needs_user_action', 'legacy-layout-job', 1,
              '{"lastError":{"code":"source_scratch_legacy_layout_unrecoverable","message":"Legacy source scratch requires manual cleanup."}}',
              '2026-08-20T12:00:00.000Z', '2026-08-20T12:00:00.000Z');
      INSERT INTO source_scratch_assets
        (id, job_id, attempt, lifecycle_state, created_at, expires_at, updated_at,
         cleanup_error_code, cleanup_error_message)
      VALUES ('019fbb95-cd76-7920-93fa-e23ba755ef71', '${legacyJobId}', 1,
              'cleanup_failed', '2026-08-20T12:00:00.000Z',
              '2026-08-20T12:00:00.000Z', '2026-08-20T12:00:00.000Z',
              'source_scratch_legacy_layout_unrecoverable',
              'Legacy source scratch requires manual cleanup.');
    `);
    const lookalike = attemptDirectory(root, legacyJobId, 1);
    mkdirSync(lookalike, { recursive: true, mode: 0o700 });
    writeFileSync(join(lookalike, "legacy-source.mp4"), "do not infer this");
    await expect(
      runLocalSourceScratchSweep({}, { queue, dataRoot: root }),
    ).resolves.toMatchObject({
      claimed: 0,
      deleted: 0,
      legacyUnsupported: 1,
    });
    expect(readFileSync(join(lookalike, "legacy-source.mp4"), "utf8")).toBe(
      "do not infer this",
    );
    expect(queue.getSourceAttempt(legacyJobId, 1)).toMatchObject({
      lifecycleState: "cleanup_failed",
    });
    database.close();
  });

  it("rejects malformed and symlink targets without touching external bytes or persisting paths", async () => {
    const malformed = fixtureQueue();
    malformed.database.exec(`
      INSERT INTO jobs
        (id, kind, state, idempotency_key, attempt, payload_json, created_at, updated_at)
      VALUES ('../../outside', 'export', 'processing', 'malformed-scratch-job', 1, '{}',
              '2026-08-20T12:00:00.000Z', '2026-08-20T12:00:00.000Z');
      INSERT INTO source_scratch_assets
        (id, job_id, attempt, lifecycle_state, scratch_layout_version,
         created_at, expires_at, updated_at)
      VALUES ('019fbb95-cd76-7920-93fa-e23ba755ef80', '../../outside', 1,
              'cleanup_failed', 2, '2026-08-20T12:00:00.000Z',
              '2026-08-20T12:00:00.000Z', '2026-08-20T12:00:00.000Z');
    `);
    const outside = join(malformed.root, "outside.txt");
    writeFileSync(outside, "do not touch");
    await expect(
      runLocalSourceScratchSweep(
        {},
        { queue: malformed.queue, dataRoot: malformed.root },
      ),
    ).resolves.toMatchObject({ cleanupFailed: 1 });
    expect(readFileSync(outside, "utf8")).toBe("do not touch");
    const malformedError = malformed.database
      .prepare(
        "SELECT cleanup_error_message FROM source_scratch_assets WHERE job_id = '../../outside'",
      )
      .get() as { cleanup_error_message: string };
    expect(malformedError.cleanup_error_message).not.toContain(malformed.root);

    const symlink = fixtureQueue();
    const started = makeExpired(
      symlink.queue,
      symlink.database,
      symlink.request.id,
    );
    const target = attemptDirectory(
      symlink.root,
      started.request.jobId,
      started.attempt,
    );
    const protectedFile = join(symlink.root, "protected-source.mp4");
    mkdirSync(join(target, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(protectedFile, "do not delete");
    symlinkSync(protectedFile, target);
    await expect(
      runLocalSourceScratchSweep(
        {},
        { queue: symlink.queue, dataRoot: symlink.root },
      ),
    ).resolves.toMatchObject({ cleanupFailed: 1 });
    expect(readFileSync(protectedFile, "utf8")).toBe("do not delete");
    expect(existsSync(target)).toBe(true);
    malformed.database.close();
    symlink.database.close();
  });

  it("uses durable claims for concurrent and restarted sweepers", async () => {
    const concurrent = fixtureQueue();
    const started = makeExpired(
      concurrent.queue,
      concurrent.database,
      concurrent.request.id,
    );
    const target = attemptDirectory(
      concurrent.root,
      started.request.jobId,
      started.attempt,
    );
    mkdirSync(target, { recursive: true, mode: 0o700 });
    writeFileSync(join(target, "source.mp4"), "cleanup once");
    const results = await Promise.all([
      runLocalSourceScratchSweep(
        {},
        { queue: concurrent.queue, dataRoot: concurrent.root },
      ),
      runLocalSourceScratchSweep(
        {},
        { queue: concurrent.queue, dataRoot: concurrent.root },
      ),
    ]);
    expect(results.map((result) => result.deleted).sort()).toEqual([0, 1]);
    expect(existsSync(target)).toBe(false);

    const restarted = fixtureQueue();
    const restartedStarted = makeExpired(
      restarted.queue,
      restarted.database,
      restarted.request.id,
    );
    const restartedTarget = attemptDirectory(
      restarted.root,
      restartedStarted.request.jobId,
      restartedStarted.attempt,
    );
    mkdirSync(restartedTarget, { recursive: true, mode: 0o700 });
    writeFileSync(join(restartedTarget, "source.mp4"), "recover after restart");
    expect(restarted.queue.claimSourceScratchCleanup(1)).toHaveLength(1);
    const afterClaimExpiry = new LocalExportQueue(
      restarted.database,
      () => new Date("2026-08-21T12:06:00.000Z"),
    );
    await expect(
      runLocalSourceScratchSweep(
        {},
        { queue: afterClaimExpiry, dataRoot: restarted.root },
      ),
    ).resolves.toMatchObject({ deleted: 1 });
    expect(existsSync(restartedTarget)).toBe(false);
    concurrent.database.close();
    restarted.database.close();
  });

  it("preserves cleanup-failure recovery evidence across an expired claim lease", async () => {
    const { root, database, queue, request } = fixtureQueue();
    const started = makeExpired(queue, database, request.id);
    queue.recordSourceCleanupFailed(
      started.request.jobId,
      started.attempt,
      "Could not delete /private/source.mp4",
    );
    expect(queue.claimSourceScratchCleanup(1)).toHaveLength(1);

    const afterClaimExpiry = new LocalExportQueue(
      database,
      () => new Date("2026-08-21T12:06:00.000Z"),
    );
    await expect(
      runLocalSourceScratchSweep(
        {},
        { queue: afterClaimExpiry, dataRoot: root },
      ),
    ).resolves.toMatchObject({ deleted: 1, markedNeedsUserAction: 1 });
    expect(
      afterClaimExpiry.getSourceAttempt(started.request.jobId, started.attempt),
    ).toMatchObject({ lifecycleState: "deleted" });
    const payload = database
      .prepare("SELECT payload_json FROM jobs WHERE id = ?")
      .get(started.request.jobId) as { payload_json: string };
    expect(JSON.parse(payload.payload_json)).toMatchObject({
      lastError: { code: "source_scratch_cleanup_recovered" },
    });
    database.close();
  });

  it("restores a verified package after cleanup recovery without running media again", async () => {
    const { root, database, queue, request } = fixtureQueue();
    const started = makeExpired(queue, database, request.id);
    queue.recordSourceCleanupFailed(
      started.request.jobId,
      started.attempt,
      "Could not delete /private/source.mp4",
    );
    const packageIdentity = `clip-${request.id}`;
    const artifacts: readonly (readonly [string, string])[] = [
      ["video_mp4", "1"],
      ["english_srt", "2"],
      ["clip_metadata_json", "3"],
      ["thumbnail_jpg", "4"],
      ["manifest_json", "5"],
    ];
    for (const [role, digest] of artifacts) {
      database
        .prepare(
          `INSERT INTO export_final_artifacts
             (export_request_id, role, package_identity, byte_size,
              content_sha256, source_attempt, validated_at)
           VALUES (?, ?, ?, 128, ?, ?, ?)`,
        )
        .run(
          request.id,
          role,
          packageIdentity,
          String(digest).repeat(64),
          started.attempt,
          "2026-08-21T11:00:00.000Z",
        );
    }
    const target = attemptDirectory(
      root,
      started.request.jobId,
      started.attempt,
    );
    mkdirSync(target, { recursive: true, mode: 0o700 });
    writeFileSync(join(target, "source.mp4"), "cleanup then reconcile");

    await expect(
      runLocalSourceScratchSweep({}, { queue, dataRoot: root }),
    ).resolves.toMatchObject({ deleted: 1, restoredComplete: 1 });
    expect(queue.get(request.id)).toMatchObject({ state: "complete" });
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM export_final_artifacts WHERE export_request_id = ?",
        )
        .get(request.id),
    ).toEqual({ count: 5 });
    await expect(
      runLocalExportOnce(
        { requestId: request.id, authorizationConfirmed: false },
        { queue, dataRoot: root },
      ),
    ).resolves.toMatchObject({ status: "already_complete", state: "complete" });
    database.close();
  });

  it("does not restore complete from a consistent package belonging to another request", async () => {
    const { root, database, queue, request } = fixtureQueue();
    const started = makeExpired(queue, database, request.id);
    queue.recordSourceCleanupFailed(
      started.request.jobId,
      started.attempt,
      "Could not delete /private/source.mp4",
    );
    const artifacts: readonly (readonly [string, string])[] = [
      ["video_mp4", "1"],
      ["english_srt", "2"],
      ["clip_metadata_json", "3"],
      ["thumbnail_jpg", "4"],
      ["manifest_json", "5"],
    ];
    for (const [role, digest] of artifacts) {
      database
        .prepare(
          `INSERT INTO export_final_artifacts
             (export_request_id, role, package_identity, byte_size,
              content_sha256, source_attempt, validated_at)
           VALUES (?, ?, ?, 128, ?, ?, ?)`,
        )
        .run(
          request.id,
          role,
          "clip-019fbb95-cd76-7920-93fa-e23ba755ef80",
          String(digest).repeat(64),
          started.attempt,
          "2026-08-21T11:00:00.000Z",
        );
    }

    await expect(
      runLocalSourceScratchSweep({}, { queue, dataRoot: root }),
    ).resolves.toMatchObject({
      deleted: 1,
      restoredComplete: 0,
      markedNeedsUserAction: 1,
    });
    expect(queue.get(request.id)).toMatchObject({ state: "needs_user_action" });
    const payload = database
      .prepare("SELECT payload_json FROM jobs WHERE id = ?")
      .get(started.request.jobId) as { payload_json: string };
    expect(JSON.parse(payload.payload_json)).toMatchObject({
      lastError: { code: "source_scratch_cleanup_recovered" },
    });
    database.close();
  });

  it("completes a stale processing attempt only when its exact full package is already proven", async () => {
    const { root, database, queue, request } = fixtureQueue();
    const started = makeExpired(queue, database, request.id);
    const packageIdentity = `clip-${request.id}`;
    const artifacts: readonly (readonly [string, string])[] = [
      ["video_mp4", "1"],
      ["english_srt", "2"],
      ["clip_metadata_json", "3"],
      ["thumbnail_jpg", "4"],
      ["manifest_json", "5"],
    ];
    for (const [role, digest] of artifacts) {
      database
        .prepare(
          `INSERT INTO export_final_artifacts
             (export_request_id, role, package_identity, byte_size,
              content_sha256, source_attempt, validated_at)
           VALUES (?, ?, ?, 128, ?, ?, ?)`,
        )
        .run(
          request.id,
          role,
          packageIdentity,
          String(digest).repeat(64),
          started.attempt,
          "2026-08-21T11:00:00.000Z",
        );
    }
    database
      .prepare(
        `UPDATE source_scratch_assets
         SET lifecycle_state = 'deleting'
         WHERE job_id = ? AND attempt = ?`,
      )
      .run(started.request.jobId, started.attempt);
    const target = attemptDirectory(
      root,
      started.request.jobId,
      started.attempt,
    );
    mkdirSync(target, { recursive: true, mode: 0o700 });
    writeFileSync(join(target, "source.mp4"), "cleanup after promotion crash");

    await expect(
      runLocalSourceScratchSweep({}, { queue, dataRoot: root }),
    ).resolves.toMatchObject({ deleted: 1, restoredComplete: 1 });
    expect(queue.get(request.id)).toMatchObject({ state: "complete" });
    expect(existsSync(target)).toBe(false);
    database.close();
  });
});
