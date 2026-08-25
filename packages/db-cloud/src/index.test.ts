import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LoggedExportSuccessResultSchema,
  ProjectVideoReviewCycleSchema,
} from "../../contracts/src/index.ts";

import {
  asCloudDatabase,
  createPostgresCloudDatabase,
  PostgresCloudDatabase,
  runCloudMigrations,
  type CloudQueryRow,
  type CloudQueryResult,
  type PostgresClient,
  type PostgresPool,
} from "./index.ts";

const databases = new Set<PGlite>();
const temporaryDirectories = new Set<string>();
const cloudMigrationDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);
const postgresIntegrationUrl = process.env.CLOUD_DATABASE_TEST_URL;

afterEach(async () => {
  await Promise.all([...databases].map((database) => database.close()));
  databases.clear();
  for (const directory of temporaryDirectories)
    rmSync(directory, { recursive: true, force: true });
  temporaryDirectories.clear();
});

describe("cloud migrations", () => {
  it("reuses one serialized adapter for the same embedded connection", () => {
    const embedded = {
      query: vi.fn(),
      exec: vi.fn(),
      close: vi.fn(),
    };
    expect(asCloudDatabase(embedded)).toBe(asCloudDatabase(embedded));
  });

  it("pins every PostgreSQL transaction query to one checked-out client", async () => {
    const calls: string[] = [];
    const client = fakePostgresClient(calls, "client");
    const pool = fakePostgresPool(calls, client);
    const database = new PostgresCloudDatabase(pool);

    await database.query("SELECT outside_transaction");
    await database.transaction(
      async () => {
        await database.query("SELECT first_transaction_query");
        await database.query("SELECT second_transaction_query");
      },
      { repeatableRead: true, readOnly: true },
    );
    await database.close();

    expect(calls).toEqual([
      "pool:SELECT outside_transaction",
      "pool:connect",
      "client:BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
      "client:SELECT first_transaction_query",
      "client:SELECT second_transaction_query",
      "client:COMMIT",
      "client:release",
      "pool:end",
    ]);
  });

  it("rolls back and releases the PostgreSQL client after a transaction error", async () => {
    const calls: string[] = [];
    const client = fakePostgresClient(calls, "client");
    const database = new PostgresCloudDatabase(fakePostgresPool(calls, client));

    await expect(
      database.transaction(async () => {
        await database.query("SELECT before_failure");
        throw new Error("expected failure");
      }),
    ).rejects.toThrow("expected failure");

    expect(calls).toEqual([
      "pool:connect",
      "client:BEGIN",
      "client:SELECT before_failure",
      "client:ROLLBACK",
      "client:release",
    ]);
  });

  it("runs each migration through the PostgreSQL transaction boundary", async () => {
    const calls: string[] = [];
    const client = fakePostgresClient(calls, "client");
    const database = new PostgresCloudDatabase(fakePostgresPool(calls, client));

    const applied = await runCloudMigrations(database);

    expect(applied).toHaveLength(44);
    expect(calls.filter((call) => call === "pool:connect")).toHaveLength(45);
    expect(calls.filter((call) => call === "client:BEGIN")).toHaveLength(45);
    expect(
      calls.filter((call) =>
        call.startsWith("client:SELECT pg_advisory_xact_lock"),
      ),
    ).toHaveLength(45);
    expect(
      calls.some((call) =>
        call.startsWith("pool:INSERT INTO schema_migrations"),
      ),
    ).toBe(false);
  });

  const postgresIt = postgresIntegrationUrl ? it : it.skip;
  postgresIt(
    "optionally migrates a clean isolated PostgreSQL schema and preserves populated rows",
    async () => {
      const schema = `m7_cloud_${randomUUID().replaceAll("-", "")}`;
      const administrator = new Pool({
        connectionString: postgresIntegrationUrl,
      });
      await administrator.query(`CREATE SCHEMA ${schema}`);
      const database = createPostgresCloudDatabase({
        connectionString: postgresIntegrationUrl,
        options: `-c search_path=${schema},public`,
      });
      try {
        const directory = mkdtempSync(
          join(tmpdir(), "research-video-postgres-0010-"),
        );
        temporaryDirectories.add(directory);
        const historicalMigrations = join(directory, "migrations");
        mkdirSync(historicalMigrations);
        for (const filename of readdirSync(cloudMigrationDirectory)) {
          if (filename < "0011") {
            copyFileSync(
              resolve(cloudMigrationDirectory, filename),
              join(historicalMigrations, filename),
            );
          }
        }
        expect(
          await runCloudMigrations(database, historicalMigrations),
        ).toHaveLength(10);
        const userId = randomUUID();
        await database.query(
          `INSERT INTO users
             (id, external_subject, display_name, preferred_language, created_at, updated_at)
           VALUES ($1, $2, $3, 'en', now(), now())`,
          [userId, "fixture:postgres-populated", "PostgreSQL fixture"],
        );
        expect(await runCloudMigrations(database)).toEqual([
          "0011_resolved_export_settings_snapshots",
          "0012_registered_export_workers",
          "0013_logged_export_deliveries",
          "0014_logged_export_success_results",
          "0015_logged_export_failure_results",
          "0016_logged_export_retry_lineage",
          "0017_logged_export_safe_cancellation",
          "0018_logged_export_execution_progress",
          "0019_logged_export_batches",
          "0020_export_request_origin",
          "0021_cloud_translation_consent",
          "0022_job_queue_delivery",
          "0023_export_source_rights_snapshots",
          "0024_project_video_language_decisions",
          "0025_manual_timed_transcript_imports",
          "0026_manual_timed_transcript_activations",
          "0027_identity_project_authority_foundation",
          "0028_project_video_flags",
          "0029_project_video_review_coordination",
          "0030_project_video_triage_activity",
          "0031_hosted_transcription_approval",
          "0032_project_local_processing_policy",
          "0033_project_keyword_governance",
          "0034_project_keyword_scans",
          "0035_keyword_scan_worklist_activity",
          "0036_clip_comments",
          "0037_player_range_speech_status",
          "0038_platform_neutral_source_identity",
          "0039_clip_collaboration_authoring_snapshots",
          "0040_project_governance_lifecycle",
          "0041_keyword_alias_maintenance",
          "0042_project_bookmarks",
          "0043_workflow_notification_events",
          "0044_transcription_item_cancellation",
        ]);
        expect(
          (
            await database.query<{ id: string }>(
              "SELECT id FROM users WHERE id = $1",
              [userId],
            )
          ).rows,
        ).toEqual([{ id: userId }]);
        expect(await runCloudMigrations(database)).toEqual([]);
      } finally {
        await database.close();
        await administrator.query(`DROP SCHEMA ${schema} CASCADE`);
        await administrator.end();
      }
    },
  );

  postgresIt(
    "serializes concurrent clean PostgreSQL migration runners",
    async () => {
      const schema = `m7_cloud_concurrent_${randomUUID().replaceAll("-", "")}`;
      const administrator = new Pool({
        connectionString: postgresIntegrationUrl,
      });
      await administrator.query(`CREATE SCHEMA ${schema}`);
      const configuration = {
        connectionString: postgresIntegrationUrl,
        options: `-c search_path=${schema},public`,
      };
      const first = createPostgresCloudDatabase(configuration);
      const second = createPostgresCloudDatabase(configuration);
      try {
        const results = await Promise.all([
          runCloudMigrations(first),
          runCloudMigrations(second),
        ]);
        expect(results.flat()).toHaveLength(40);
        expect(new Set(results.flat()).size).toBe(40);
        expect(await runCloudMigrations(first)).toEqual([]);
      } finally {
        await Promise.all([first.close(), second.close()]);
        await administrator.query(`DROP SCHEMA ${schema} CASCADE`);
        await administrator.end();
      }
    },
  );

  it("migrates an empty PostgreSQL-compatible database idempotently", async () => {
    const database = new PGlite();
    databases.add(database);

    expect(await runCloudMigrations(database)).toEqual([
      "0001_foundation",
      "0002_shared_transcript_store",
      "0003_transcription_batches",
      "0004_worker_resolution_leases",
      "0005_batch_controls",
      "0006_clip_candidates",
      "0007_logged_export_requests",
      "0008_export_subtitle_track_snapshots",
      "0009_preferred_language_translations_clip_evidence",
      "0010_export_preset_catalogs",
      "0011_resolved_export_settings_snapshots",
      "0012_registered_export_workers",
      "0013_logged_export_deliveries",
      "0014_logged_export_success_results",
      "0015_logged_export_failure_results",
      "0016_logged_export_retry_lineage",
      "0017_logged_export_safe_cancellation",
      "0018_logged_export_execution_progress",
      "0019_logged_export_batches",
      "0020_export_request_origin",
      "0021_cloud_translation_consent",
      "0022_job_queue_delivery",
      "0023_export_source_rights_snapshots",
      "0024_project_video_language_decisions",
      "0025_manual_timed_transcript_imports",
      "0026_manual_timed_transcript_activations",
      "0027_identity_project_authority_foundation",
      "0028_project_video_flags",
      "0029_project_video_review_coordination",
      "0030_project_video_triage_activity",
      "0031_hosted_transcription_approval",
      "0032_project_local_processing_policy",
      "0033_project_keyword_governance",
      "0034_project_keyword_scans",
      "0035_keyword_scan_worklist_activity",
      "0036_clip_comments",
      "0037_player_range_speech_status",
      "0038_platform_neutral_source_identity",
      "0039_clip_collaboration_authoring_snapshots",
      "0040_project_governance_lifecycle",
      "0041_keyword_alias_maintenance",
      "0042_project_bookmarks",
      "0043_workflow_notification_events",
      "0044_transcription_item_cancellation",
    ]);
    expect(await runCloudMigrations(database)).toEqual([]);
    expect(
      (
        await database.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_name IN (
             'manual_timed_transcript_imports',
             'manual_timed_transcript_import_targets',
             'manual_timed_transcript_candidates',
             'manual_timed_transcript_activations'
           ) ORDER BY table_name`,
        )
      ).rows,
    ).toEqual([
      { table_name: "manual_timed_transcript_activations" },
      { table_name: "manual_timed_transcript_candidates" },
      { table_name: "manual_timed_transcript_import_targets" },
      { table_name: "manual_timed_transcript_imports" },
    ]);
    expect(
      (
        await database.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
           WHERE table_name = 'export_requests' AND column_name = 'request_origin'`,
        )
      ).rows,
    ).toEqual([{ column_name: "request_origin" }]);
    expect(
      (
        await database.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
           WHERE table_name = 'export_requests'
             AND column_name = 'source_rights_snapshot'`,
        )
      ).rows,
    ).toEqual([{ column_name: "source_rights_snapshot" }]);
    expect(
      (
        await database.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_name IN ('artifact_versions', 'export_artifact_versions')`,
        )
      ).rows,
    ).toEqual([]);
    const result = await database.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'transcription_batch_items'",
    );
    expect(result.rows).toHaveLength(1);
    const clipResult = await database.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'clip_candidates'",
    );
    expect(clipResult.rows).toHaveLength(1);
    expect(
      (
        await database.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_name IN ('clip_comments', 'clip_comment_commands')
           ORDER BY table_name`,
        )
      ).rows,
    ).toEqual([
      { table_name: "clip_comment_commands" },
      { table_name: "clip_comments" },
    ]);
    expect(
      (
        await database.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
           WHERE table_name = 'clip_candidates'
             AND column_name = 'request_sha256'`,
        )
      ).rows,
    ).toEqual([{ column_name: "request_sha256" }]);
    const flagResult = await database.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'project_video_flags'",
    );
    expect(flagResult.rows).toHaveLength(1);
    const coordinationTables = await database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name IN (
         'project_video_claims', 'project_video_claim_events',
         'project_video_governance_events', 'project_video_review_cycles',
         'project_video_review_events'
       ) ORDER BY table_name`,
    );
    expect(coordinationTables.rows).toEqual([
      { table_name: "project_video_claim_events" },
      { table_name: "project_video_claims" },
      { table_name: "project_video_governance_events" },
      { table_name: "project_video_review_cycles" },
      { table_name: "project_video_review_events" },
    ]);
    const coordinationColumns = await database.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'project_videos'
         AND column_name IN (
           'worklist_priority', 'review_completion_policy'
         ) ORDER BY column_name`,
    );
    expect(coordinationColumns.rows).toEqual([
      { column_name: "review_completion_policy" },
      { column_name: "worklist_priority" },
    ]);
    const triageTables = await database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name IN (
         'project_video_triage_commands', 'project_video_triage_events',
         'transcription_job_cancel_requests',
         'project_video_activity_events', 'project_video_activity_receipts'
       ) ORDER BY table_name`,
    );
    expect(triageTables.rows).toHaveLength(5);
    const triageColumns = await database.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'project_videos'
         AND column_name IN (
           'triage_state', 'triage_version', 'dismissed_by', 'dismissed_at',
           'dismissal_reason'
         ) ORDER BY column_name`,
    );
    expect(triageColumns.rows).toHaveLength(5);
    const hostedApprovalTables = await database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name = 'hosted_transcription_approval_commands'`,
    );
    expect(hostedApprovalTables.rows).toEqual([
      { table_name: "hosted_transcription_approval_commands" },
    ]);
    const hostedApprovalColumns = await database.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'transcription_batches'
         AND column_name IN (
           'hosted_approval_state', 'hosted_approval_version',
           'hosted_approval_by', 'hosted_approval_at'
         ) ORDER BY column_name`,
    );
    expect(hostedApprovalColumns.rows).toHaveLength(4);
    const presetTables = await database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name IN (
         'export_presets', 'export_preset_versions',
         'personal_export_preset_defaults', 'project_export_preset_defaults',
         'export_preset_command_receipts'
       )`,
    );
    expect(presetTables.rows).toHaveLength(5);
    const deliveryConstraints = await database.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = 'logged_export_deliveries'::regclass
         AND contype = 'c'`,
    );
    expect(
      deliveryConstraints.rows.map((row) => row.definition).join(" "),
    ).toContain(
      "accepted_at >= reserved_at) AND (accepted_at < reservation_expires_at)",
    );
    const resultTable = await database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name = 'logged_export_success_results'`,
    );
    expect(resultTable.rows).toHaveLength(1);
    const failureResultTable = await database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name = 'logged_export_failure_results'`,
    );
    expect(failureResultTable.rows).toHaveLength(1);
    const retryColumns = await database.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'export_requests'
         AND column_name IN (
           'retry_of_request_id', 'retry_ordinal', 'retry_idempotency_key'
         )`,
    );
    expect(retryColumns.rows).toHaveLength(3);
    const cancellationTables = await database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name IN (
         'logged_export_cancel_intents', 'logged_export_executions',
         'logged_export_canceled_results'
       )`,
    );
    expect(cancellationTables.rows).toHaveLength(3);
    const clipStatusConstraints = await database.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = 'clip_candidates'::regclass
         AND conname = 'clip_candidates_export_status_check'`,
    );
    expect(clipStatusConstraints.rows[0]!.definition).toContain("'canceled'");
  });

  it("backfills identity and project authority on a populated legacy catalog", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "research-video-pglite-0026-authority-"),
    );
    temporaryDirectories.add(directory);
    const migrations = join(directory, "migrations");
    mkdirSync(migrations);
    for (const filename of readdirSync(cloudMigrationDirectory)) {
      if (filename < "0027") {
        copyFileSync(
          resolve(cloudMigrationDirectory, filename),
          join(migrations, filename),
        );
      }
    }
    const database = new PGlite();
    databases.add(database);
    expect(await runCloudMigrations(database, migrations)).toHaveLength(26);

    const ownerId = "11111111-1111-4111-8111-111111111111";
    const extraOwnerId = "22222222-2222-4222-8222-222222222222";
    const editorId = "33333333-3333-4333-8333-333333333333";
    const viewerId = "44444444-4444-4444-8444-444444444444";
    const projectId = "55555555-5555-4555-8555-555555555555";
    const at = "2026-08-23T12:00:00.000Z";
    for (const [userId, subject, displayName] of [
      [ownerId, "fixture:legacy-owner", "Legacy Owner"],
      [extraOwnerId, "fixture:legacy-extra-owner", "Legacy Extra Owner"],
      [editorId, "fixture:legacy-editor", "Legacy Editor"],
      [viewerId, "fixture:legacy-viewer", "Legacy Viewer"],
    ]) {
      await database.query(
        `INSERT INTO users
           (id, external_subject, display_name, preferred_language, created_at, updated_at)
         VALUES ($1, $2, $3, 'en', $4, $4)`,
        [userId, subject, displayName, at],
      );
    }
    await database.query(
      `INSERT INTO projects (id, name, created_by, created_at, updated_at)
       VALUES ($1, 'Legacy shared project', $2, $3, $3)`,
      [projectId, ownerId, at],
    );
    for (const [userId, role] of [
      [ownerId, "owner"],
      [extraOwnerId, "owner"],
      [editorId, "editor"],
      [viewerId, "viewer"],
    ]) {
      await database.query(
        `INSERT INTO project_members
           (project_id, user_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4)`,
        [projectId, userId, role, at],
      );
    }

    copyFileSync(
      resolve(
        cloudMigrationDirectory,
        "0027_identity_project_authority_foundation.sql",
      ),
      join(migrations, "0027_identity_project_authority_foundation.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0027_identity_project_authority_foundation",
    ]);
    expect(
      (
        await database.query<{
          id: string;
          handle: string;
          normalized_handle: string;
        }>(`SELECT id, handle, normalized_handle FROM users ORDER BY id`)
      ).rows,
    ).toEqual([
      {
        id: ownerId,
        handle: "user_11111111111141118111",
        normalized_handle: "user_11111111111141118111",
      },
      {
        id: extraOwnerId,
        handle: "user_22222222222242228222",
        normalized_handle: "user_22222222222242228222",
      },
      {
        id: editorId,
        handle: "user_33333333333343338333",
        normalized_handle: "user_33333333333343338333",
      },
      {
        id: viewerId,
        handle: "user_44444444444444448444",
        normalized_handle: "user_44444444444444448444",
      },
    ]);
    expect(
      (
        await database.query<{ kind: string; visibility: string }>(
          "SELECT kind, visibility FROM projects WHERE id = $1",
          [projectId],
        )
      ).rows[0],
    ).toEqual({ kind: "shared", visibility: "invitation_only" });
    expect(
      (
        await database.query<{ user_id: string; role: string }>(
          `SELECT user_id, role FROM project_members
           WHERE project_id = $1 ORDER BY user_id`,
          [projectId],
        )
      ).rows,
    ).toEqual([
      { user_id: ownerId, role: "owner" },
      { user_id: extraOwnerId, role: "researcher" },
      { user_id: editorId, role: "researcher" },
      { user_id: viewerId, role: "viewer" },
    ]);
    await expect(
      database.query(
        `UPDATE project_members SET role = 'owner'
         WHERE project_id = $1 AND user_id = $2`,
        [projectId, extraOwnerId],
      ),
    ).rejects.toThrow();
    await expect(
      database.query(`UPDATE users SET normalized_handle = $1 WHERE id = $2`, [
        "user_11111111111141118111",
        extraOwnerId,
      ]),
    ).rejects.toThrow();
    expect(await runCloudMigrations(database, migrations)).toEqual([]);
  });

  it("backfills one durable creator flag per historical project video", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "research-video-pglite-0027-worklist-flags-"),
    );
    temporaryDirectories.add(directory);
    const migrations = join(directory, "migrations");
    mkdirSync(migrations);
    for (const filename of readdirSync(cloudMigrationDirectory)) {
      if (filename < "0028") {
        copyFileSync(
          resolve(cloudMigrationDirectory, filename),
          join(migrations, filename),
        );
      }
    }
    const database = new PGlite();
    databases.add(database);
    expect(await runCloudMigrations(database, migrations)).toHaveLength(27);

    const ownerId = "11111111-1111-4111-8111-111111111111";
    const researcherId = "22222222-2222-4222-8222-222222222222";
    const projectId = "33333333-3333-4333-8333-333333333333";
    const videoId = "44444444-4444-4444-8444-444444444444";
    const createdAt = "2026-08-20T12:00:00.000Z";
    const updatedAt = "2026-08-21T12:00:00.000Z";
    for (const [userId, subject, handle] of [
      [ownerId, "fixture:flag-owner", "flag_owner"],
      [researcherId, "fixture:flag-researcher", "flag_researcher"],
    ]) {
      await database.query(
        `INSERT INTO users
           (id, external_subject, handle, normalized_handle, display_name,
            preferred_language, created_at, updated_at)
         VALUES ($1, $2, $3, $3, $3, 'en', $4, $4)`,
        [userId, subject, handle, createdAt],
      );
    }
    await database.query(
      `INSERT INTO projects
         (id, name, created_by, kind, visibility, created_at, updated_at)
       VALUES ($1, 'Historical worklist', $2, 'shared', 'invitation_only', $3, $4)`,
      [projectId, ownerId, createdAt, updatedAt],
    );
    for (const [userId, role] of [
      [ownerId, "owner"],
      [researcherId, "researcher"],
    ]) {
      await database.query(
        `INSERT INTO project_members
           (project_id, user_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4)`,
        [projectId, userId, role, createdAt],
      );
    }
    await database.query(
      `INSERT INTO videos
         (id, youtube_video_id, canonical_url, title, created_at, updated_at)
       VALUES ($1, 'HistoricalFlag1',
               'https://www.youtube.com/watch?v=HistoricalFlag1',
               'Historical flag video', $2, $3)`,
      [videoId, createdAt, updatedAt],
    );
    await database.query(
      `INSERT INTO project_videos
         (project_id, video_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4)`,
      [projectId, videoId, createdAt, updatedAt],
    );

    copyFileSync(
      resolve(cloudMigrationDirectory, "0028_project_video_flags.sql"),
      join(migrations, "0028_project_video_flags.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0028_project_video_flags",
    ]);
    expect(
      (
        await database.query<{
          user_id: string;
          active: boolean;
          version: number;
          created_at: Date;
          updated_at: Date;
        }>(
          `SELECT user_id, active, version, created_at, updated_at
           FROM project_video_flags
           WHERE project_id = $1 AND video_id = $2`,
          [projectId, videoId],
        )
      ).rows.map((row) => ({
        ...row,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
      })),
    ).toEqual([
      {
        user_id: ownerId,
        active: true,
        version: 1,
        created_at: createdAt,
        updated_at: updatedAt,
      },
    ]);
    await database.query(
      `INSERT INTO project_video_flags
         (project_id, video_id, user_id, active, version, created_at,
          updated_at)
       VALUES ($1, $2, $3, true, 1, $4, $4)`,
      [projectId, videoId, researcherId, updatedAt],
    );
    await database.query(
      `DELETE FROM project_members
       WHERE project_id = $1 AND user_id = $2`,
      [projectId, researcherId],
    );
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM project_video_flags
           WHERE project_id = $1 AND video_id = $2`,
          [projectId, videoId],
        )
      ).rows[0]?.count,
    ).toBe("2");
    await database.query(
      `UPDATE project_video_flags
       SET active = false, version = version + 1, deactivated_at = $1,
           updated_at = $1
       WHERE project_id = $2 AND video_id = $3 AND user_id = $4`,
      [updatedAt, projectId, videoId, ownerId],
    );
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM project_videos
           WHERE project_id = $1 AND video_id = $2`,
          [projectId, videoId],
        )
      ).rows[0]?.count,
    ).toBe("1");
    await expect(
      database.query(
        `UPDATE project_video_flags SET active = true
         WHERE project_id = $1 AND video_id = $2 AND user_id = $3`,
        [projectId, videoId, ownerId],
      ),
    ).rejects.toThrow();
    expect(await runCloudMigrations(database, migrations)).toEqual([]);
  });

  it("backfills safe review coordination defaults on a populated worklist", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "research-video-pglite-0028-review-coordination-"),
    );
    temporaryDirectories.add(directory);
    const migrations = join(directory, "migrations");
    mkdirSync(migrations);
    for (const filename of readdirSync(cloudMigrationDirectory)) {
      if (filename < "0029") {
        copyFileSync(
          resolve(cloudMigrationDirectory, filename),
          join(migrations, filename),
        );
      }
    }
    const database = new PGlite();
    databases.add(database);
    expect(await runCloudMigrations(database, migrations)).toHaveLength(28);

    const ownerId = "11111111-1111-4111-8111-111111111111";
    const projectId = "22222222-2222-4222-8222-222222222222";
    const videoId = "33333333-3333-4333-8333-333333333333";
    const createdAt = "2026-08-20T12:00:00.000Z";
    await database.query(
      `INSERT INTO users
         (id, external_subject, handle, normalized_handle, display_name,
          preferred_language, created_at, updated_at)
       VALUES ($1, 'fixture:review-owner', 'review_owner', 'review_owner',
               'Review Owner', 'en', $2, $2)`,
      [ownerId, createdAt],
    );
    await database.query(
      `INSERT INTO projects
         (id, name, created_by, kind, visibility, created_at, updated_at)
       VALUES ($1, 'Historical review', $2, 'shared', 'invitation_only', $3, $3)`,
      [projectId, ownerId, createdAt],
    );
    await database.query(
      `INSERT INTO project_members
         (project_id, user_id, role, created_at, updated_at)
       VALUES ($1, $2, 'owner', $3, $3)`,
      [projectId, ownerId, createdAt],
    );
    await database.query(
      `INSERT INTO videos
         (id, youtube_video_id, canonical_url, title, created_at, updated_at)
       VALUES ($1, 'HistoricalReview1',
               'https://www.youtube.com/watch?v=HistoricalReview1',
               'Historical review video', $2, $2)`,
      [videoId, createdAt],
    );
    await database.query(
      `INSERT INTO project_videos
         (project_id, video_id, created_at, updated_at)
       VALUES ($1, $2, $3, $3)`,
      [projectId, videoId, createdAt],
    );
    await database.query(
      `INSERT INTO project_video_flags
         (project_id, video_id, user_id, active, version, created_at,
          updated_at)
       VALUES ($1, $2, $3, true, 1, $4, $4)`,
      [projectId, videoId, ownerId, createdAt],
    );

    copyFileSync(
      resolve(
        cloudMigrationDirectory,
        "0029_project_video_review_coordination.sql",
      ),
      join(migrations, "0029_project_video_review_coordination.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0029_project_video_review_coordination",
    ]);
    expect(
      (
        await database.query<{
          worklist_priority: string;
          review_completion_policy: string;
        }>(
          `SELECT worklist_priority, review_completion_policy
           FROM project_videos WHERE project_id = $1 AND video_id = $2`,
          [projectId, videoId],
        )
      ).rows[0],
    ).toEqual({
      worklist_priority: "normal",
      review_completion_policy: "researcher_or_administrator",
    });
    const cycle = (
      await database.query<{
        id: string;
        cycle_number: number;
        status: string;
        version: number;
        opened_by: string | null;
        opened_at: Date;
      }>(
        `SELECT id, cycle_number, status, version, opened_by, opened_at
         FROM project_video_review_cycles
         WHERE project_id = $1 AND video_id = $2`,
        [projectId, videoId],
      )
    ).rows[0]!;
    expect(cycle).toMatchObject({
      cycle_number: 1,
      status: "open",
      version: 1,
      opened_by: null,
    });
    expect(cycle.opened_at.toISOString()).toBe(createdAt);
    expect(
      ProjectVideoReviewCycleSchema.parse({
        id: cycle.id,
        cycleNumber: cycle.cycle_number,
        status: cycle.status,
        version: cycle.version,
        openedAt: cycle.opened_at.toISOString(),
      }),
    ).toMatchObject({ id: cycle.id, cycleNumber: 1, status: "open" });
    await expect(
      database.query(
        `INSERT INTO project_video_review_cycles
           (id, project_id, video_id, cycle_number, status, version,
            opened_at, updated_at)
         VALUES ($1, $2, $3, 2, 'open', 1, $4, $4)`,
        [randomUUID(), projectId, videoId, createdAt],
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `INSERT INTO project_video_claims
           (project_id, video_id, claimant_user_id, generation, version,
            claimed_at, heartbeat_at, expires_at)
         VALUES ($1, $2, $3, 1, 1, $4, $4, $4)`,
        [projectId, videoId, ownerId, createdAt],
      ),
    ).rejects.toThrow();
    expect(await runCloudMigrations(database, migrations)).toEqual([]);
  });

  it("backfills active triage without fabricating activity on a populated worklist", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "research-video-pglite-0029-triage-activity-"),
    );
    temporaryDirectories.add(directory);
    const migrations = join(directory, "migrations");
    mkdirSync(migrations);
    for (const filename of readdirSync(cloudMigrationDirectory)) {
      if (filename < "0030") {
        copyFileSync(
          resolve(cloudMigrationDirectory, filename),
          join(migrations, filename),
        );
      }
    }
    const database = new PGlite();
    databases.add(database);
    expect(await runCloudMigrations(database, migrations)).toHaveLength(29);
    const ownerId = "11111111-1111-4111-8111-111111111111";
    const projectId = "22222222-2222-4222-8222-222222222222";
    const videoId = "33333333-3333-4333-8333-333333333333";
    const createdAt = "2026-08-20T12:00:00.000Z";
    await database.query(
      `INSERT INTO users
         (id, external_subject, handle, normalized_handle, display_name,
          preferred_language, created_at, updated_at)
       VALUES ($1, 'fixture:triage-owner', 'triage_owner', 'triage_owner',
               'Triage Owner', 'en', $2, $2)`,
      [ownerId, createdAt],
    );
    await database.query(
      `INSERT INTO projects
         (id, name, created_by, kind, visibility, created_at, updated_at)
       VALUES ($1, 'Historical triage', $2, 'shared', 'invitation_only', $3, $3)`,
      [projectId, ownerId, createdAt],
    );
    await database.query(
      `INSERT INTO project_members
         (project_id, user_id, role, created_at, updated_at)
       VALUES ($1, $2, 'owner', $3, $3)`,
      [projectId, ownerId, createdAt],
    );
    await database.query(
      `INSERT INTO videos
         (id, youtube_video_id, canonical_url, title, created_at, updated_at)
       VALUES ($1, 'HistoricalTriage1',
               'https://www.youtube.com/watch?v=HistoricalTriage1',
               'Historical triage video', $2, $2)`,
      [videoId, createdAt],
    );
    await database.query(
      `INSERT INTO project_videos
         (project_id, video_id, created_at, updated_at)
       VALUES ($1, $2, $3, $3)`,
      [projectId, videoId, createdAt],
    );
    copyFileSync(
      resolve(
        cloudMigrationDirectory,
        "0030_project_video_triage_activity.sql",
      ),
      join(migrations, "0030_project_video_triage_activity.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0030_project_video_triage_activity",
    ]);
    expect(
      (
        await database.query<{
          triage_state: string;
          triage_version: number;
          dismissed_by: string | null;
        }>(
          `SELECT triage_state, triage_version, dismissed_by
           FROM project_videos WHERE project_id = $1 AND video_id = $2`,
          [projectId, videoId],
        )
      ).rows[0],
    ).toEqual({
      triage_state: "active",
      triage_version: 1,
      dismissed_by: null,
    });
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT (
             (SELECT count(*) FROM project_video_triage_commands)
             + (SELECT count(*) FROM project_video_triage_events)
             + (SELECT count(*) FROM transcription_job_cancel_requests)
             + (SELECT count(*) FROM project_video_activity_events)
             + (SELECT count(*) FROM project_video_activity_receipts)
           )::text AS count`,
        )
      ).rows[0]!.count,
    ).toBe("0");
    await expect(
      database.query(
        `UPDATE project_videos SET triage_state = 'dismissed'
         WHERE project_id = $1 AND video_id = $2`,
        [projectId, videoId],
      ),
    ).rejects.toThrow();

    const eventId = randomUUID();
    await database.query(
      `INSERT INTO project_video_activity_events
         (id, project_id, video_id, event_type, actor_id, source_key, created_at)
       VALUES ($1, $2, $3, 'video_restored', $4, 'fixture:restore', $5)`,
      [eventId, projectId, videoId, ownerId, createdAt],
    );
    await database.query(
      `INSERT INTO project_video_activity_receipts
         (event_id, user_id, state, version, created_at, updated_at)
       VALUES ($1, $2, 'unread', 1, $3, $3)`,
      [eventId, ownerId, createdAt],
    );
    await expect(
      database.query(
        `INSERT INTO project_video_activity_receipts
           (event_id, user_id, state, version, created_at, updated_at)
         VALUES ($1, $2, 'unread', 1, $3, $3)`,
        [eventId, ownerId, createdAt],
      ),
    ).rejects.toThrow();

    const jobId = randomUUID();
    await database.query(
      `INSERT INTO jobs
         (id, project_id, kind, state, idempotency_key, payload,
          created_at, updated_at)
       VALUES ($1, $2, 'transcription', 'claimed', 'fixture:cancel-lifecycle',
               '{}'::jsonb, $3, $3)`,
      [jobId, projectId, createdAt],
    );
    await expect(
      database.query(
        `INSERT INTO transcription_job_cancel_requests
           (job_id, project_id, requested_by, requested_at,
            revoked_at, completed_at)
         VALUES ($1, $2, $3, $4, $4, $4)`,
        [jobId, projectId, ownerId, createdAt],
      ),
    ).rejects.toThrow();
    expect(await runCloudMigrations(database, migrations)).toEqual([]);
  });

  it("backfills hosted approval without fabricating authority or reviving canceled work", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "research-video-pglite-0030-hosted-approval-"),
    );
    temporaryDirectories.add(directory);
    const migrations = join(directory, "migrations");
    mkdirSync(migrations);
    for (const filename of readdirSync(cloudMigrationDirectory)) {
      if (filename < "0031") {
        copyFileSync(
          resolve(cloudMigrationDirectory, filename),
          join(migrations, filename),
        );
      }
    }
    const database = new PGlite();
    databases.add(database);
    expect(await runCloudMigrations(database, migrations)).toHaveLength(30);
    const ownerId = "11111111-1111-4111-8111-111111111111";
    const projectId = "22222222-2222-4222-8222-222222222222";
    const localBatchId = "33333333-3333-4333-8333-333333333333";
    const hostedBatchId = "44444444-4444-4444-8444-444444444444";
    const canceledHostedBatchId = "55555555-5555-4555-8555-555555555555";
    const createdAt = "2026-08-20T12:00:00.000Z";
    await database.query(
      `INSERT INTO users
         (id, external_subject, handle, normalized_handle, display_name,
          preferred_language, created_at, updated_at)
       VALUES ($1, 'fixture:hosted-owner', 'hosted_owner', 'hosted_owner',
               'Hosted Owner', 'en', $2, $2)`,
      [ownerId, createdAt],
    );
    await database.query(
      `INSERT INTO projects
         (id, name, created_by, kind, visibility, created_at, updated_at)
       VALUES ($1, 'Hosted migration', $2, 'shared', 'invitation_only', $3, $3)`,
      [projectId, ownerId, createdAt],
    );
    for (const [batchId, executionLocation, dispatchStatus] of [
      [localBatchId, "local", "active"],
      [hostedBatchId, "hosted", "active"],
      [canceledHostedBatchId, "hosted", "canceled"],
    ] as const) {
      await database.query(
        `INSERT INTO transcription_batches
           (id, project_id, name, target_language, execution_location,
            dispatch_status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, 'en', $4, $5, $6, $7, $7)`,
        [
          batchId,
          projectId,
          `${executionLocation} ${dispatchStatus}`,
          executionLocation,
          dispatchStatus,
          ownerId,
          createdAt,
        ],
      );
    }
    copyFileSync(
      resolve(
        cloudMigrationDirectory,
        "0031_hosted_transcription_approval.sql",
      ),
      join(migrations, "0031_hosted_transcription_approval.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0031_hosted_transcription_approval",
    ]);
    expect(
      (
        await database.query<{
          id: string;
          hosted_approval_state: string;
          hosted_approval_version: number;
          hosted_approval_by: string | null;
          hosted_approval_at: Date | null;
          dispatch_status: string;
        }>(
          `SELECT id, hosted_approval_state, hosted_approval_version,
                  hosted_approval_by, hosted_approval_at, dispatch_status
           FROM transcription_batches ORDER BY id`,
        )
      ).rows,
    ).toEqual([
      {
        id: localBatchId,
        hosted_approval_state: "not_required",
        hosted_approval_version: 1,
        hosted_approval_by: null,
        hosted_approval_at: null,
        dispatch_status: "active",
      },
      {
        id: hostedBatchId,
        hosted_approval_state: "pending",
        hosted_approval_version: 1,
        hosted_approval_by: null,
        hosted_approval_at: null,
        dispatch_status: "paused",
      },
      {
        id: canceledHostedBatchId,
        hosted_approval_state: "pending",
        hosted_approval_version: 1,
        hosted_approval_by: null,
        hosted_approval_at: null,
        dispatch_status: "canceled",
      },
    ]);
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM hosted_transcription_approval_commands`,
        )
      ).rows[0]!.count,
    ).toBe("0");
    await expect(
      database.query(
        `UPDATE transcription_batches
         SET hosted_approval_state = 'pending'
         WHERE id = $1`,
        [localBatchId],
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `UPDATE transcription_batches
         SET hosted_approval_state = 'approved'
         WHERE id = $1`,
        [hostedBatchId],
      ),
    ).rejects.toThrow();
    expect(await runCloudMigrations(database, migrations)).toEqual([]);
  });

  it("backfills automatic local processing without fabricating policy authority", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "research-video-pglite-0031-local-processing-"),
    );
    temporaryDirectories.add(directory);
    const migrations = join(directory, "migrations");
    mkdirSync(migrations);
    for (const filename of readdirSync(cloudMigrationDirectory)) {
      if (filename < "0032") {
        copyFileSync(
          resolve(cloudMigrationDirectory, filename),
          join(migrations, filename),
        );
      }
    }
    const database = new PGlite();
    databases.add(database);
    expect(await runCloudMigrations(database, migrations)).toHaveLength(31);
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const batchId = randomUUID();
    const createdAt = "2026-08-24T12:00:00.000Z";
    await database.query(
      `INSERT INTO users
         (id, external_subject, handle, normalized_handle, display_name,
          preferred_language, created_at, updated_at)
       VALUES ($1, 'fixture:local-policy-owner', 'local_policy_owner',
               'local_policy_owner', 'Local Policy Owner', 'en', $2, $2)`,
      [ownerId, createdAt],
    );
    await database.query(
      `INSERT INTO projects
         (id, name, created_by, kind, visibility, created_at, updated_at)
       VALUES ($1, 'Local policy migration', $2, 'shared',
               'invitation_only', $3, $3)`,
      [projectId, ownerId, createdAt],
    );
    await database.query(
      `INSERT INTO transcription_batches
         (id, project_id, name, target_language, execution_location,
          created_by, hosted_approval_state, created_at, updated_at)
       VALUES ($1, $2, 'Historical manual batch', 'en', 'local', $3,
               'not_required', $4, $4)`,
      [batchId, projectId, ownerId, createdAt],
    );
    copyFileSync(
      resolve(
        cloudMigrationDirectory,
        "0032_project_local_processing_policy.sql",
      ),
      join(migrations, "0032_project_local_processing_policy.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0032_project_local_processing_policy",
    ]);
    expect(
      (
        await database.query<{
          local_processing_state: string;
          local_processing_version: number;
          local_processing_updated_by: string | null;
          local_processing_updated_at: Date | null;
        }>(
          `SELECT local_processing_state, local_processing_version,
                  local_processing_updated_by, local_processing_updated_at
           FROM projects WHERE id = $1`,
          [projectId],
        )
      ).rows[0],
    ).toEqual({
      local_processing_state: "automatic",
      local_processing_version: 1,
      local_processing_updated_by: null,
      local_processing_updated_at: null,
    });
    expect(
      (
        await database.query<{ processing_origin: string }>(
          "SELECT processing_origin FROM transcription_batches WHERE id = $1",
          [batchId],
        )
      ).rows[0],
    ).toEqual({ processing_origin: "manual" });
    expect(
      (
        await database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM project_local_processing_commands",
        )
      ).rows[0]!.count,
    ).toBe("0");
    await database.query(
      "UPDATE transcription_batches SET processing_origin = 'project_local' WHERE id = $1",
      [batchId],
    );
    await expect(
      database.query(
        `INSERT INTO transcription_batches
           (id, project_id, name, target_language, execution_location,
            created_by, hosted_approval_state, processing_origin,
            created_at, updated_at)
         VALUES ($1, $2, 'Duplicate automatic batch', 'en', 'local', $3,
                 'not_required', 'project_local', $4, $4)`,
        [randomUUID(), projectId, ownerId, createdAt],
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        "UPDATE projects SET local_processing_state = 'overnight' WHERE id = $1",
        [projectId],
      ),
    ).rejects.toThrow();
    expect(await runCloudMigrations(database, migrations)).toEqual([]);
  });

  it("adds empty keyword governance to populated projects without fabricated evidence", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "research-video-pglite-0032-keywords-"),
    );
    temporaryDirectories.add(directory);
    const migrations = join(directory, "migrations");
    mkdirSync(migrations);
    for (const filename of readdirSync(cloudMigrationDirectory)) {
      if (filename < "0033") {
        copyFileSync(
          resolve(cloudMigrationDirectory, filename),
          join(migrations, filename),
        );
      }
    }
    const database = new PGlite();
    databases.add(database);
    expect(await runCloudMigrations(database, migrations)).toHaveLength(32);
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const createdAt = "2026-08-24T12:00:00.000Z";
    await database.query(
      `INSERT INTO users
         (id, external_subject, handle, normalized_handle, display_name,
          preferred_language, created_at, updated_at)
       VALUES ($1, 'fixture:keyword-owner', 'keyword_owner',
               'keyword_owner', 'Keyword Owner', 'en', $2, $2)`,
      [ownerId, createdAt],
    );
    await database.query(
      `INSERT INTO projects
         (id, name, created_by, kind, visibility, created_at, updated_at)
       VALUES ($1, 'Keyword migration', $2, 'shared',
               'invitation_only', $3, $3)`,
      [projectId, ownerId, createdAt],
    );
    copyFileSync(
      resolve(cloudMigrationDirectory, "0033_project_keyword_governance.sql"),
      join(migrations, "0033_project_keyword_governance.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0033_project_keyword_governance",
    ]);
    expect(
      (
        await database.query<{ keyword_set_version: number }>(
          "SELECT keyword_set_version FROM projects WHERE id = $1",
          [projectId],
        )
      ).rows[0],
    ).toEqual({ keyword_set_version: 1 });
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT (
             (SELECT count(*) FROM project_keywords) +
             (SELECT count(*) FROM project_keyword_aliases) +
             (SELECT count(*) FROM project_keyword_suggestions) +
             (SELECT count(*) FROM project_keyword_commands)
           )::text AS count`,
        )
      ).rows[0]!.count,
    ).toBe("0");
    const keywordId = randomUUID();
    const aliasId = randomUUID();
    await database.query(
      `INSERT INTO project_keywords
         (id, project_id, label, normalized_label, created_by, updated_by,
          created_at, updated_at)
       VALUES ($1, $2, 'Climate change', 'climate change', $3, $3, $4, $4)`,
      [keywordId, projectId, ownerId, createdAt],
    );
    await database.query(
      `INSERT INTO project_keyword_aliases
         (id, project_id, keyword_id, language, phrase, normalized_phrase,
          created_by, updated_by, created_at, updated_at)
       VALUES ($1, $2, $3, 'en', 'Climate change', 'climate change',
               $4, $4, $5, $5)`,
      [aliasId, projectId, keywordId, ownerId, createdAt],
    );
    await expect(
      database.query(
        `INSERT INTO project_keywords
           (id, project_id, label, normalized_label, created_by, updated_by,
            created_at, updated_at)
         VALUES ($1, $2, 'Equivalent label', 'climate change', $3, $3, $4, $4)`,
        [randomUUID(), projectId, ownerId, createdAt],
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `INSERT INTO project_keyword_aliases
           (id, project_id, keyword_id, language, phrase, normalized_phrase,
            created_by, updated_by, created_at, updated_at)
         VALUES ($1, $2, $3, 'en', 'CLIMATE CHANGE', 'climate change',
                 $4, $4, $5, $5)`,
        [randomUUID(), projectId, keywordId, ownerId, createdAt],
      ),
    ).rejects.toThrow();
    const otherProjectId = randomUUID();
    await database.query(
      `INSERT INTO projects
         (id, name, created_by, kind, visibility, created_at, updated_at)
       VALUES ($1, 'Other keyword migration project', $2, 'shared',
               'invitation_only', $3, $3)`,
      [otherProjectId, ownerId, createdAt],
    );
    await expect(
      database.query(
        `INSERT INTO project_keyword_aliases
           (id, project_id, keyword_id, language, phrase, normalized_phrase,
            created_by, updated_by, created_at, updated_at)
         VALUES ($1, $2, $3, 'es', 'Cambio climático', 'cambio climático',
                 $4, $4, $5, $5)`,
        [randomUUID(), otherProjectId, keywordId, ownerId, createdAt],
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `INSERT INTO project_keyword_suggestions
           (id, project_id, proposed_label, language, phrase,
            normalized_phrase, state, proposed_by, reviewed_by, reviewed_at,
            created_at, updated_at)
         VALUES ($1, $2, 'Withdrawn', 'en', 'withdrawn', 'withdrawn',
                 'withdrawn', $3, $3, $4, $4, $4)`,
        [randomUUID(), projectId, ownerId, createdAt],
      ),
    ).rejects.toThrow();
    const pendingSuggestionId = randomUUID();
    await database.query(
      `INSERT INTO project_keyword_suggestions
         (id, project_id, proposed_label, language, phrase,
          normalized_phrase, state, proposed_by, created_at, updated_at)
       VALUES ($1, $2, 'Pending preserved', 'en', 'pending preserved',
               'pending preserved', 'pending', $3, $4, $4)`,
      [pendingSuggestionId, projectId, ownerId, createdAt],
    );
    copyFileSync(
      resolve(cloudMigrationDirectory, "0041_keyword_alias_maintenance.sql"),
      join(migrations, "0041_keyword_alias_maintenance.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0041_keyword_alias_maintenance",
    ]);
    expect(
      (
        await database.query<{
          state: string;
          withdrawn_by: string | null;
          withdrawn_at: string | null;
        }>(
          `SELECT state, withdrawn_by, withdrawn_at
           FROM project_keyword_suggestions WHERE id = $1`,
          [pendingSuggestionId],
        )
      ).rows[0],
    ).toEqual({ state: "pending", withdrawn_by: null, withdrawn_at: null });
    await database.query(
      `UPDATE project_keyword_suggestions
       SET state = 'withdrawn', version = version + 1,
           withdrawn_by = $1, withdrawn_at = $2, withdraw_reason = 'Retired'
       WHERE id = $3`,
      [ownerId, createdAt, pendingSuggestionId],
    );
    expect(
      (
        await database.query<{ state: string; withdraw_reason: string }>(
          `SELECT state, withdraw_reason
           FROM project_keyword_suggestions WHERE id = $1`,
          [pendingSuggestionId],
        )
      ).rows[0],
    ).toEqual({ state: "withdrawn", withdraw_reason: "Retired" });
    expect(await runCloudMigrations(database, migrations)).toEqual([]);
  });

  it("adds exact-input keyword scan jobs without fabricating historical results", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "research-video-pglite-0034-keyword-scans-"),
    );
    temporaryDirectories.add(directory);
    const migrations = join(directory, "migrations");
    mkdirSync(migrations);
    for (const filename of readdirSync(cloudMigrationDirectory)) {
      if (filename < "0034") {
        copyFileSync(
          resolve(cloudMigrationDirectory, filename),
          join(migrations, filename),
        );
      }
    }
    const database = new PGlite();
    databases.add(database);
    expect(await runCloudMigrations(database, migrations)).toHaveLength(33);
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const videoId = randomUUID();
    const transcriptVersionId = randomUUID();
    const createdAt = "2026-08-24T12:00:00.000Z";
    await database.query(
      `INSERT INTO users
         (id, external_subject, handle, normalized_handle, display_name,
          preferred_language, created_at, updated_at)
       VALUES ($1, 'fixture:scan-owner', 'scan_owner', 'scan_owner',
               'Scan Owner', 'en', $2, $2)`,
      [ownerId, createdAt],
    );
    await database.query(
      `INSERT INTO projects
         (id, name, created_by, kind, visibility, created_at, updated_at)
       VALUES ($1, 'Scan migration', $2, 'shared', 'invitation_only', $3, $3)`,
      [projectId, ownerId, createdAt],
    );
    await database.query(
      `INSERT INTO videos
         (id, youtube_video_id, canonical_url, title, created_at, updated_at)
       VALUES ($1, 'KeywordScanMigration',
               'https://www.youtube.com/watch?v=KeywordScanMigration',
               'Scan migration', $2, $2)`,
      [videoId, createdAt],
    );
    await database.query(
      `INSERT INTO project_videos
         (project_id, video_id, created_at, updated_at)
       VALUES ($1, $2, $3, $3)`,
      [projectId, videoId, createdAt],
    );
    await database.query(
      `INSERT INTO transcript_versions
         (id, project_id, video_id, lineage_id, version, schema_version,
          source_language, target_language, timing_precision,
          manifest_object_key, manifest_object_version_id, manifest_sha256,
          finalized_at, created_at)
       VALUES ($1, $2, $3, $4, 1, 1, 'en', 'en', 'word',
               'fixtures/scan.json', 'scan-v1', $5, $6, $6)`,
      [
        transcriptVersionId,
        projectId,
        videoId,
        randomUUID(),
        "a".repeat(64),
        createdAt,
      ],
    );
    await database.query(
      `UPDATE project_videos SET active_transcript_version_id = $1
       WHERE project_id = $2 AND video_id = $3`,
      [transcriptVersionId, projectId, videoId],
    );
    copyFileSync(
      resolve(cloudMigrationDirectory, "0034_project_keyword_scans.sql"),
      join(migrations, "0034_project_keyword_scans.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0034_project_keyword_scans",
    ]);
    expect(
      (
        await database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM project_keyword_scans",
        )
      ).rows[0]!.count,
    ).toBe("0");
    const scanId = randomUUID();
    const insertQueued = (id: string) =>
      database.query(
        `INSERT INTO project_keyword_scans
           (id, project_id, video_id, transcript_version_id,
            keyword_set_version, scanner_schema_version,
            approved_keyword_count, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 1, 1, 0, $5, $5)`,
        [id, projectId, videoId, transcriptVersionId, createdAt],
      );
    await insertQueued(scanId);
    await expect(insertQueued(randomUUID())).rejects.toThrow();
    await expect(
      database.query(
        `UPDATE project_keyword_scans
         SET state = 'completed', attempt = 1, completed_at = $1
         WHERE id = $2`,
        [createdAt, scanId],
      ),
    ).rejects.toThrow(/project_keyword_scans_lifecycle_check/u);
    const otherProjectId = randomUUID();
    await database.query(
      `INSERT INTO projects
         (id, name, created_by, kind, visibility, created_at, updated_at)
       VALUES ($1, 'Other scan project', $2, 'shared', 'invitation_only', $3, $3)`,
      [otherProjectId, ownerId, createdAt],
    );
    await database.query(
      `INSERT INTO project_videos
         (project_id, video_id, created_at, updated_at)
       VALUES ($1, $2, $3, $3)`,
      [otherProjectId, videoId, createdAt],
    );
    await expect(
      database.query(
        `INSERT INTO project_keyword_scans
           (id, project_id, video_id, transcript_version_id,
            keyword_set_version, scanner_schema_version,
            approved_keyword_count, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 1, 1, 0, $5, $5)`,
        [randomUUID(), otherProjectId, videoId, transcriptVersionId, createdAt],
      ),
    ).rejects.toThrow();
    expect(await runCloudMigrations(database, migrations)).toEqual([]);
  });

  it("widens keyword-scan activity and adds bulk priority receipts without fabricating history", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "research-video-pglite-0035-keyword-worklist-"),
    );
    temporaryDirectories.add(directory);
    const migrations = join(directory, "migrations");
    mkdirSync(migrations);
    for (const filename of readdirSync(cloudMigrationDirectory)) {
      if (filename < "0035") {
        copyFileSync(
          resolve(cloudMigrationDirectory, filename),
          join(migrations, filename),
        );
      }
    }
    const database = new PGlite();
    databases.add(database);
    expect(await runCloudMigrations(database, migrations)).toHaveLength(34);

    const ownerId = randomUUID();
    const projectId = randomUUID();
    const videoId = randomUUID();
    const transcriptVersionId = randomUUID();
    const legacyScanId = randomUUID();
    const eventId = randomUUID();
    const createdAt = "2026-08-24T12:00:00.000Z";
    await database.query(
      `INSERT INTO users
         (id, external_subject, handle, normalized_handle, display_name,
          preferred_language, created_at, updated_at)
       VALUES ($1, 'fixture:keyword-worklist-owner', 'keyword_owner',
               'keyword_owner', 'Keyword Owner', 'en', $2, $2)`,
      [ownerId, createdAt],
    );
    await database.query(
      `INSERT INTO projects
         (id, name, created_by, kind, visibility, created_at, updated_at)
       VALUES ($1, 'Keyword worklist migration', $2, 'shared',
               'invitation_only', $3, $3)`,
      [projectId, ownerId, createdAt],
    );
    await database.query(
      `INSERT INTO project_members
         (project_id, user_id, role, version, created_at, updated_at)
       VALUES ($1, $2, 'owner', 1, $3, $3)`,
      [projectId, ownerId, createdAt],
    );
    await database.query(
      `INSERT INTO videos
         (id, youtube_video_id, canonical_url, title, created_at, updated_at)
       VALUES ($1, 'KeywordWorklistMigration',
               'https://www.youtube.com/watch?v=KeywordWorklistMigration',
               'Keyword worklist migration', $2, $2)`,
      [videoId, createdAt],
    );
    await database.query(
      `INSERT INTO project_videos
         (project_id, video_id, created_at, updated_at)
       VALUES ($1, $2, $3, $3)`,
      [projectId, videoId, createdAt],
    );
    await database.query(
      `INSERT INTO transcript_versions
         (id, project_id, video_id, lineage_id, version, schema_version,
          source_language, target_language, timing_precision,
          manifest_object_key, manifest_object_version_id, manifest_sha256,
          finalized_at, created_at)
       VALUES ($1, $2, $3, $4, 1, 1, 'en', 'en', 'word',
               'fixtures/keyword-worklist.json', 'keyword-worklist-v1', $5,
               $6, $6)`,
      [
        transcriptVersionId,
        projectId,
        videoId,
        randomUUID(),
        "a".repeat(64),
        createdAt,
      ],
    );
    await database.query(
      `INSERT INTO project_keyword_scans
         (id, project_id, video_id, transcript_version_id,
          keyword_set_version, scanner_schema_version, state, attempt,
          artifact_object_key, artifact_object_version_id, artifact_sha256,
          artifact_size_bytes, artifact_schema_version, occurrence_count,
          matched_keyword_count, approved_keyword_count, duration_ms,
          terminal_actor_id, completed_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 1, 1, 'completed', 1,
               'fixtures/legacy-keyword-evidence.json', 'legacy-evidence-v1',
               $5, 123, 1, 2, 1, 1, 60000, $6, $7, $7, $7)`,
      [
        legacyScanId,
        projectId,
        videoId,
        transcriptVersionId,
        "b".repeat(64),
        ownerId,
        createdAt,
      ],
    );
    await database.query(
      `INSERT INTO project_video_activity_events
         (id, project_id, video_id, event_type, actor_id, source_key, created_at)
       VALUES ($1, $2, $3, 'video_restored', $4, 'fixture:restore', $5)`,
      [eventId, projectId, videoId, ownerId, createdAt],
    );
    await database.query(
      `INSERT INTO project_video_activity_receipts
         (event_id, user_id, state, version, created_at, updated_at)
       VALUES ($1, $2, 'unread', 1, $3, $3)`,
      [eventId, ownerId, createdAt],
    );

    copyFileSync(
      resolve(
        cloudMigrationDirectory,
        "0035_keyword_scan_worklist_activity.sql",
      ),
      join(migrations, "0035_keyword_scan_worklist_activity.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0035_keyword_scan_worklist_activity",
    ]);
    expect(
      (
        await database.query<{ event_type: string; state: string }>(
          `SELECT event.event_type, receipt.state
           FROM project_video_activity_events event
           JOIN project_video_activity_receipts receipt
             ON receipt.event_id = event.id
           WHERE event.id = $1 AND receipt.user_id = $2`,
          [eventId, ownerId],
        )
      ).rows,
    ).toEqual([{ event_type: "video_restored", state: "unread" }]);
    expect(
      (
        await database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM project_video_priority_commands",
        )
      ).rows[0]!.count,
    ).toBe("0");
    expect(
      (
        await database.query<{ keyword_counts: unknown }>(
          "SELECT keyword_counts FROM project_keyword_scans WHERE id = $1",
          [legacyScanId],
        )
      ).rows,
    ).toEqual([{ keyword_counts: null }]);
    const storedKeywordCounts = [
      { keywordId: randomUUID(), occurrenceCount: 2 },
    ];
    await database.query(
      `UPDATE project_keyword_scans
       SET keyword_counts = $1::jsonb
       WHERE id = $2`,
      [JSON.stringify(storedKeywordCounts), legacyScanId],
    );
    expect(
      (
        await database.query<{ keyword_counts: unknown }>(
          "SELECT keyword_counts FROM project_keyword_scans WHERE id = $1",
          [legacyScanId],
        )
      ).rows,
    ).toEqual([{ keyword_counts: storedKeywordCounts }]);
    await expect(
      database.query(
        `UPDATE project_keyword_scans
         SET keyword_counts = '{"not":"an-array"}'::jsonb
         WHERE id = $1`,
        [legacyScanId],
      ),
    ).rejects.toThrow();

    const scanEventId = randomUUID();
    await database.query(
      `INSERT INTO project_video_activity_events
         (id, project_id, video_id, event_type, actor_id, source_key, created_at)
       VALUES ($1, $2, $3, 'keyword_scan_completed', $4, $5, $6)`,
      [
        scanEventId,
        projectId,
        videoId,
        ownerId,
        `keyword-scan:${randomUUID()}`,
        createdAt,
      ],
    );
    const commandId = randomUUID();
    const insertCommand = (id: string, key: string, project = projectId) =>
      database.query(
        `INSERT INTO project_video_priority_commands
           (id, project_id, actor_id, requested_priority, idempotency_key,
            request_sha256, response_json, created_at)
         VALUES ($1, $2, $3, 'high', $4, $5, '{}'::jsonb, $6)`,
        [id, project, ownerId, key, "a".repeat(64), createdAt],
      );
    await insertCommand(commandId, "bulk-priority-v1");
    await expect(
      insertCommand(randomUUID(), "bulk-priority-v1"),
    ).rejects.toThrow();
    await expect(
      insertCommand(randomUUID(), "unknown-project", randomUUID()),
    ).rejects.toThrow();
    await expect(
      database.query(
        `INSERT INTO project_video_priority_commands
           (id, project_id, actor_id, requested_priority, idempotency_key,
            request_sha256, response_json, created_at)
         VALUES ($1, $2, $3, 'urgent', 'invalid-priority', $4, '{}'::jsonb, $5)`,
        [randomUUID(), projectId, ownerId, "b".repeat(64), createdAt],
      ),
    ).rejects.toThrow();
    expect(await runCloudMigrations(database, migrations)).toEqual([]);
  });

  it("adds append-only language decisions to a populated catalog with safe defaults", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "research-video-pglite-0023-language-"),
    );
    temporaryDirectories.add(directory);
    const migrations = join(directory, "migrations");
    mkdirSync(migrations);
    for (const filename of readdirSync(cloudMigrationDirectory)) {
      if (filename < "0024") {
        copyFileSync(
          resolve(cloudMigrationDirectory, filename),
          join(migrations, filename),
        );
      }
    }
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database, migrations);

    const userId = randomUUID();
    const projectId = randomUUID();
    const videoId = randomUUID();
    const at = "2026-08-23T12:00:00.000Z";
    await database.query(
      `INSERT INTO users
         (id, external_subject, display_name, preferred_language, created_at, updated_at)
       VALUES ($1, 'fixture:language-migration', 'Language migration', 'en', $2, $2)`,
      [userId, at],
    );
    await database.query(
      `INSERT INTO projects (id, name, created_by, created_at, updated_at)
       VALUES ($1, 'Language migration', $2, $3, $3)`,
      [projectId, userId, at],
    );
    await database.query(
      `INSERT INTO videos
         (id, youtube_video_id, canonical_url, title, created_at, updated_at)
       VALUES ($1, 'M7lc1UVf-VE', 'https://www.youtube.com/watch?v=M7lc1UVf-VE',
               'Language migration', $2, $2)`,
      [videoId, at],
    );
    await database.query(
      `INSERT INTO project_videos
         (project_id, video_id, created_at, updated_at)
       VALUES ($1, $2, $3, $3)`,
      [projectId, videoId, at],
    );
    const legacyBatchId = randomUUID();
    const legacyJobId = randomUUID();
    const legacyItemId = randomUUID();
    const legacyTranscriptVersionId = randomUUID();
    const legacyUploadId = randomUUID();
    await database.query(
      `INSERT INTO transcript_versions
         (id, project_id, video_id, lineage_id, version, schema_version,
          source_language, target_language, timing_precision,
          manifest_object_key, manifest_object_version_id, manifest_sha256,
          finalized_at, created_at)
       VALUES ($1, $2, $3, $4, 1, 1, 'dz', 'en', 'cue',
               'fixtures/legacy-manifest.json', 'legacy-manifest-v1', $5,
               $6, $6)`,
      [
        legacyTranscriptVersionId,
        projectId,
        videoId,
        randomUUID(),
        "c".repeat(64),
        at,
      ],
    );
    await database.query(
      `UPDATE project_videos SET active_transcript_version_id = $1
       WHERE project_id = $2 AND video_id = $3`,
      [legacyTranscriptVersionId, projectId, videoId],
    );
    await database.query(
      `INSERT INTO transcription_batches
         (id, project_id, name, target_language, execution_location,
          created_by, created_at, updated_at)
       VALUES ($1, $2, 'Legacy language batch', 'en', 'local', $3, $4, $4)`,
      [legacyBatchId, projectId, userId, at],
    );
    await database.query(
      `INSERT INTO jobs
         (id, project_id, kind, state, idempotency_key, payload, created_at,
          updated_at)
       VALUES ($1, $2, 'transcription', 'queued', 'legacy-language-job',
               '{}'::jsonb, $3, $3)`,
      [legacyJobId, projectId, at],
    );
    await database.query(
      `INSERT INTO transcript_uploads
         (id, job_id, project_id, video_id, lineage_id, version, state,
          expires_at, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, 1, 'staged', $6, $7, $6)`,
      [
        legacyUploadId,
        legacyJobId,
        projectId,
        videoId,
        randomUUID(),
        "2026-08-24T13:00:00.000Z",
        userId,
      ],
    );
    await database.query(
      `INSERT INTO transcription_batch_items
         (id, batch_id, input_index, raw_input, catalog_video_id,
          preflight_status, processing_need, state, job_id, created_at,
          updated_at)
       VALUES ($1, $2, 0, 'M7lc1UVf-VE', $3, 'ready', 'transcription',
               'queued', $4, $5, $5)`,
      [legacyItemId, legacyBatchId, videoId, legacyJobId, at],
    );

    copyFileSync(
      resolve(
        cloudMigrationDirectory,
        "0024_project_video_language_decisions.sql",
      ),
      join(migrations, "0024_project_video_language_decisions.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0024_project_video_language_decisions",
    ]);
    expect(
      (
        await database.query<{
          current_language_evidence_id: string | null;
          current_language_decision_id: string | null;
          language_gate_status: string;
        }>(
          `SELECT current_language_evidence_id, current_language_decision_id,
                  language_gate_status
           FROM project_videos WHERE project_id = $1 AND video_id = $2`,
          [projectId, videoId],
        )
      ).rows[0],
    ).toEqual({
      current_language_evidence_id: null,
      current_language_decision_id: null,
      language_gate_status: "unverified",
    });
    const itemStateConstraint = await database.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = 'transcription_batch_items'::regclass
         AND conname = 'transcription_batch_items_state_check'`,
    );
    expect(itemStateConstraint.rows[0]!.definition).toContain(
      "'needs_language_confirmation'",
    );
    expect(
      (
        await database.query<{
          state: string;
          job_id: string;
          language_gate: unknown;
          language_decision_id: string | null;
          language_decision_video_id: string | null;
        }>(
          `SELECT state, job_id, language_gate, language_decision_id,
                  language_decision_video_id
           FROM transcription_batch_items WHERE id = $1`,
          [legacyItemId],
        )
      ).rows[0],
    ).toEqual({
      state: "queued",
      job_id: legacyJobId,
      language_gate: null,
      language_decision_id: null,
      language_decision_video_id: null,
    });

    const evidenceId = randomUUID();
    const decisionId = randomUUID();
    await database.query(
      `INSERT INTO project_video_language_evidence
         (id, project_id, video_id, source, provider, reported_language, created_at)
       VALUES ($1, $2, $3, 'creator_metadata', 'fixture', 'ko', $4)`,
      [evidenceId, projectId, videoId, at],
    );
    await database.query(
      `INSERT INTO project_video_language_decisions
         (id, project_id, video_id, decision_version, status, basis,
          resolved_language, evidence_id, actor_id, idempotency_key,
          request_sha256, created_at)
       VALUES ($1, $2, $3, 1, 'confirmed', 'user_confirmation', 'dz', $4,
               $5, 'fixture-confirmation', $6, $7)`,
      [decisionId, projectId, videoId, evidenceId, userId, "a".repeat(64), at],
    );
    const otherVideoId = randomUUID();
    const batchId = randomUUID();
    await database.query(
      `INSERT INTO videos
         (id, youtube_video_id, canonical_url, title, created_at, updated_at)
       VALUES ($1, 'OtherVid001', 'https://www.youtube.com/watch?v=OtherVid001',
               'Other language video', $2, $2)`,
      [otherVideoId, at],
    );
    await database.query(
      `INSERT INTO project_videos
         (project_id, video_id, created_at, updated_at)
       VALUES ($1, $2, $3, $3)`,
      [projectId, otherVideoId, at],
    );
    await database.query(
      `INSERT INTO transcription_batches
         (id, project_id, name, target_language, execution_location,
          created_by, created_at, updated_at)
       VALUES ($1, $2, 'Language FK batch', 'en', 'local', $3, $4, $4)`,
      [batchId, projectId, userId, at],
    );
    await expect(
      database.query(
        `INSERT INTO transcription_batch_items
           (id, batch_id, input_index, raw_input, catalog_video_id,
            preflight_status, processing_need, state, language_decision_id,
            language_decision_video_id, created_at, updated_at)
         VALUES ($1, $2, 0, 'OtherVid001', $3, 'ready', 'transcription',
                 'queued', $4, $3, $5, $5)`,
        [randomUUID(), batchId, otherVideoId, decisionId, at],
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `INSERT INTO project_video_language_decisions
           (id, project_id, video_id, decision_version, status, basis,
            actor_id, idempotency_key, request_sha256, created_at)
         VALUES ($1, $2, $3, 1, 'unknown', 'provider_metadata',
                 $4, 'duplicate-version', $5, $6)`,
        [randomUUID(), projectId, videoId, userId, "b".repeat(64), at],
      ),
    ).rejects.toThrow();

    copyFileSync(
      resolve(
        cloudMigrationDirectory,
        "0025_manual_timed_transcript_imports.sql",
      ),
      join(migrations, "0025_manual_timed_transcript_imports.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0025_manual_timed_transcript_imports",
    ]);
    expect(
      (
        await database.query<{
          active_transcript_version_id: string | null;
        }>(
          `SELECT active_transcript_version_id FROM project_videos
           WHERE project_id = $1 AND video_id = $2`,
          [projectId, videoId],
        )
      ).rows[0],
    ).toEqual({ active_transcript_version_id: legacyTranscriptVersionId });
    expect(
      (
        await database.query<{ job_id: string; state: string }>(
          `SELECT job_id, state FROM transcript_uploads WHERE id = $1`,
          [legacyUploadId],
        )
      ).rows[0],
    ).toEqual({ job_id: legacyJobId, state: "staged" });
    expect(
      (
        await database.query<{
          language_decision_id: string | null;
          manual_timed_transcript_candidate_id: string | null;
        }>(
          `SELECT language_decision_id, manual_timed_transcript_candidate_id
           FROM transcription_batch_items WHERE id = $1`,
          [legacyItemId],
        )
      ).rows[0],
    ).toEqual({
      language_decision_id: null,
      manual_timed_transcript_candidate_id: null,
    });
    expect(
      (
        await database.query<{
          evidence_count: string;
          decision_count: string;
        }>(
          `SELECT
             (SELECT count(*)::text FROM project_video_language_evidence
              WHERE project_id = $1 AND video_id = $2) AS evidence_count,
             (SELECT count(*)::text FROM project_video_language_decisions
              WHERE project_id = $1 AND video_id = $2) AS decision_count`,
          [projectId, videoId],
        )
      ).rows[0],
    ).toEqual({ evidence_count: "1", decision_count: "1" });
    const populatedImportId = randomUUID();
    const populatedCandidateId = randomUUID();
    await database.query(
      `INSERT INTO manual_timed_transcript_imports
         (id, project_id, video_id, language_decision_id,
          language_decision_version, project_video_version, video_duration_ms,
          video_updated_at, batch_item_id, batch_id, batch_item_version,
          original_format, english_format, original_byte_size, english_byte_size,
          original_sha256, english_sha256, state, idempotency_key,
          request_sha256, expires_at, created_by, created_at, finalized_at)
       VALUES ($1, $2, $3, $4, 1, 1, 1000, $5, $6, $7, 1,
               'srt', 'srt', 1, 1, $8, $9, 'finalized',
               'populated-activation-import', $10, $11, $12, $5, $5)`,
      [
        populatedImportId,
        projectId,
        videoId,
        decisionId,
        at,
        legacyItemId,
        legacyBatchId,
        "e".repeat(64),
        "f".repeat(64),
        "a".repeat(64),
        "2026-08-24T13:00:00.000Z",
        userId,
      ],
    );
    await database.query(
      `INSERT INTO manual_timed_transcript_candidates
         (id, import_id, project_id, video_id, transcript_version_id,
          language_decision_id, language_decision_version, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 1, $7)`,
      [
        populatedCandidateId,
        populatedImportId,
        projectId,
        videoId,
        legacyTranscriptVersionId,
        decisionId,
        at,
      ],
    );
    copyFileSync(
      resolve(
        cloudMigrationDirectory,
        "0026_manual_timed_transcript_activations.sql",
      ),
      join(migrations, "0026_manual_timed_transcript_activations.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0026_manual_timed_transcript_activations",
    ]);
    expect(
      (
        await database.query<{
          active_transcript_version_id: string | null;
          candidate_count: string;
          activation_count: string;
        }>(
          `SELECT pv.active_transcript_version_id,
                  (SELECT count(*)::text FROM manual_timed_transcript_candidates
                   WHERE id = $3) AS candidate_count,
                  (SELECT count(*)::text FROM manual_timed_transcript_activations)
                    AS activation_count
           FROM project_videos pv
           WHERE pv.project_id = $1 AND pv.video_id = $2`,
          [projectId, videoId, populatedCandidateId],
        )
      ).rows[0],
    ).toEqual({
      active_transcript_version_id: legacyTranscriptVersionId,
      candidate_count: "1",
      activation_count: "0",
    });
    const otherDecisionId = randomUUID();
    await database.query(
      `INSERT INTO project_video_language_decisions
         (id, project_id, video_id, decision_version, status, basis,
          actor_id, idempotency_key, request_sha256, created_at)
       VALUES ($1, $2, $3, 1, 'unknown', 'provider_metadata',
               $4, 'other-video-decision', $5, $6)`,
      [otherDecisionId, projectId, otherVideoId, userId, "d".repeat(64), at],
    );
    await expect(
      database.query(
        `INSERT INTO manual_timed_transcript_imports
           (id, project_id, video_id, language_decision_id,
            language_decision_version, project_video_version, video_duration_ms,
            video_updated_at, batch_item_id, batch_id, batch_item_version,
            original_format, english_format, original_byte_size, english_byte_size,
            original_sha256, english_sha256, state, idempotency_key,
            request_sha256, expires_at, created_by, created_at)
         VALUES ($1, $2, $3, $4, 1, 1, 1000, $5, $6, $7, 1,
                 'srt', 'srt', 1, 1, $8, $8, 'staged', 'cross-video-item',
                 $9, $10, $11, $5)`,
        [
          randomUUID(),
          projectId,
          otherVideoId,
          otherDecisionId,
          at,
          legacyItemId,
          legacyBatchId,
          "e".repeat(64),
          "f".repeat(64),
          "2026-08-24T13:00:00.000Z",
          userId,
        ],
      ),
    ).rejects.toThrow();
  });

  it("backfills immutable legacy request/job snapshots from the 0010 schema", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "research-video-pglite-0010-"),
    );
    temporaryDirectories.add(directory);
    const migrations = join(directory, "migrations");
    mkdirSync(migrations);
    for (const filename of readdirSync(cloudMigrationDirectory)) {
      if (filename < "0011")
        copyFileSync(
          resolve(cloudMigrationDirectory, filename),
          join(migrations, filename),
        );
    }
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database, migrations);
    const userId = randomUUID();
    const projectId = randomUUID();
    const videoId = randomUUID();
    const clipId = randomUUID();
    const jobId = randomUUID();
    const requestId = randomUUID();
    const at = "2026-08-20T12:00:00.000Z";
    const preset = {
      presetVersion: 1,
      name: "Legacy Editing",
      settings: {
        container: "mp4",
        videoCodec: "h264",
        videoRateControl: { mode: "crf", value: 20 },
        frameRate: "source",
        audioCodec: "aac",
        omitSubtitleFilesForConfirmedEnglish: false,
        embedEnglishSubtitleTrack: false,
      },
    };
    await database.query(
      `INSERT INTO users (id, external_subject, display_name, created_at)
       VALUES ($1, 'fixture:legacy', 'Legacy', $2)`,
      [userId, at],
    );
    await database.query(
      `INSERT INTO projects (id, name, created_by, created_at, updated_at)
       VALUES ($1, 'Legacy', $2, $3, $3)`,
      [projectId, userId, at],
    );
    await database.query(
      `INSERT INTO videos
         (id, youtube_video_id, title, canonical_url, created_at)
       VALUES ($1, 'M7lc1UVf-VE', 'Legacy',
               'https://www.youtube.com/watch?v=M7lc1UVf-VE', $2)`,
      [videoId, at],
    );
    await database.query(
      `INSERT INTO clip_candidates
         (id, project_id, video_id, youtube_video_id, canonical_url,
          video_title, idempotency_key, transcript_track_id,
          transcript_version, first_segment_id, last_segment_id,
          transcript_start_ms, transcript_end_ms, export_start_ms,
          export_end_ms, timing_precision, english_text, created_by,
          created_at, updated_at)
       VALUES ($1, $2, $3, 'M7lc1UVf-VE',
               'https://www.youtube.com/watch?v=M7lc1UVf-VE', 'Legacy',
               'legacy', $4, 1, $5, $6, 100, 900, 0, 1000, 'cue',
               'Legacy clip', $7, $8, $8)`,
      [
        clipId,
        projectId,
        videoId,
        randomUUID(),
        randomUUID(),
        randomUUID(),
        userId,
        at,
      ],
    );
    await database.query(
      `INSERT INTO jobs
         (id, project_id, kind, state, idempotency_key, payload,
          created_at, updated_at)
       VALUES ($1, $2, 'export', 'queued', 'legacy-export', '{}'::jsonb, $3, $3)`,
      [jobId, projectId, at],
    );
    await database.query(
      `INSERT INTO export_requests
         (id, job_id, clip_id, project_id, mode, video_snapshot,
          selection_snapshot, source_language_class, preset_snapshot,
          requested_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'logged', '{}'::jsonb, '{}'::jsonb,
               'confirmed_english', $5, $6, $7, $7)`,
      [requestId, jobId, clipId, projectId, preset, userId, at],
    );
    copyFileSync(
      resolve(
        cloudMigrationDirectory,
        "0011_resolved_export_settings_snapshots.sql",
      ),
      join(migrations, "0011_resolved_export_settings_snapshots.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0011_resolved_export_settings_snapshots",
    ]);
    const result = await database.query<{
      request_snapshot: Record<string, unknown>;
      job_snapshot: Record<string, unknown>;
    }>(
      `SELECT er.resolved_settings_snapshot AS request_snapshot,
              j.payload->'resolvedSettingsSnapshot' AS job_snapshot
       FROM export_requests er JOIN jobs j ON j.id = er.job_id
       WHERE er.id = $1`,
      [requestId],
    );
    expect(result.rows[0]!.job_snapshot).toEqual(
      result.rows[0]!.request_snapshot,
    );
    expect(result.rows[0]!.request_snapshot).toMatchObject({
      resolutionKind: "legacy_inline",
      context: "logged",
      legacyPreset: preset,
      settings: preset.settings,
      capability: { validation: "legacy_unvalidated" },
      resolvedAt: at,
      resolutionFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    await expect(
      database.query(
        "UPDATE export_requests SET resolved_settings_snapshot = '{}'::jsonb WHERE id = $1",
        [requestId],
      ),
    ).rejects.toThrow(/immutable/);
  });

  it("adds delivery and result tables to a populated worker catalog without changing registrations", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "research-video-pglite-0012-"),
    );
    temporaryDirectories.add(directory);
    const migrations = join(directory, "migrations");
    mkdirSync(migrations);
    for (const filename of readdirSync(cloudMigrationDirectory)) {
      if (filename < "0013") {
        copyFileSync(
          resolve(cloudMigrationDirectory, filename),
          join(migrations, filename),
        );
      }
    }
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database, migrations);
    const userId = randomUUID();
    const workerId = randomUUID();
    const at = "2026-08-20T12:00:00.000Z";
    await database.query(
      `INSERT INTO users
         (id, external_subject, display_name, preferred_language, created_at, updated_at)
       VALUES ($1, 'fixture:populated-worker', 'Populated worker', 'en', $2, $2)`,
      [userId, at],
    );
    await database.query(
      `INSERT INTO registered_export_workers
         (id, owner_user_id, epoch, capability_json,
          installed_capabilities_json, advertisement_fingerprint,
          heartbeat_at, expires_at, created_at, updated_at)
       VALUES ($1, $2, 7, '{}'::jsonb, '{}'::jsonb, $3, $4, $5, $4, $4)`,
      [workerId, userId, "a".repeat(64), at, "2026-08-20T12:01:00.000Z"],
    );
    const before = (
      await database.query(
        "SELECT * FROM registered_export_workers WHERE id = $1",
        [workerId],
      )
    ).rows[0];
    copyFileSync(
      resolve(cloudMigrationDirectory, "0013_logged_export_deliveries.sql"),
      join(migrations, "0013_logged_export_deliveries.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0013_logged_export_deliveries",
    ]);
    expect(
      (
        await database.query(
          "SELECT * FROM registered_export_workers WHERE id = $1",
          [workerId],
        )
      ).rows[0],
    ).toEqual(before);
    expect(
      (
        await database.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_name = 'logged_export_deliveries'`,
        )
      ).rows,
    ).toHaveLength(1);
    copyFileSync(
      resolve(
        cloudMigrationDirectory,
        "0014_logged_export_success_results.sql",
      ),
      join(migrations, "0014_logged_export_success_results.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0014_logged_export_success_results",
    ]);
    expect(
      (
        await database.query(
          "SELECT * FROM registered_export_workers WHERE id = $1",
          [workerId],
        )
      ).rows[0],
    ).toEqual(before);
    expect(
      (
        await database.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_name = 'logged_export_success_results'`,
        )
      ).rows,
    ).toHaveLength(1);
    copyFileSync(
      resolve(
        cloudMigrationDirectory,
        "0015_logged_export_failure_results.sql",
      ),
      join(migrations, "0015_logged_export_failure_results.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0015_logged_export_failure_results",
    ]);
    expect(
      (
        await database.query(
          "SELECT * FROM registered_export_workers WHERE id = $1",
          [workerId],
        )
      ).rows[0],
    ).toEqual(before);
    expect(
      (
        await database.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_name = 'logged_export_failure_results'`,
        )
      ).rows,
    ).toHaveLength(1);
    copyFileSync(
      resolve(cloudMigrationDirectory, "0016_logged_export_retry_lineage.sql"),
      join(migrations, "0016_logged_export_retry_lineage.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0016_logged_export_retry_lineage",
    ]);
    expect(
      (
        await database.query(
          "SELECT * FROM registered_export_workers WHERE id = $1",
          [workerId],
        )
      ).rows[0],
    ).toEqual(before);
    copyFileSync(
      resolve(
        cloudMigrationDirectory,
        "0017_logged_export_safe_cancellation.sql",
      ),
      join(migrations, "0017_logged_export_safe_cancellation.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0017_logged_export_safe_cancellation",
    ]);
    expect(
      (
        await database.query(
          "SELECT * FROM registered_export_workers WHERE id = $1",
          [workerId],
        )
      ).rows[0],
    ).toEqual(before);
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM information_schema.tables
           WHERE table_name IN (
             'logged_export_cancel_intents', 'logged_export_executions',
             'logged_export_canceled_results'
           )`,
        )
      ).rows[0]!.count,
    ).toBe("3");
    copyFileSync(
      resolve(
        cloudMigrationDirectory,
        "0018_logged_export_execution_progress.sql",
      ),
      join(migrations, "0018_logged_export_execution_progress.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0018_logged_export_execution_progress",
    ]);
    expect(
      (
        await database.query(
          "SELECT * FROM registered_export_workers WHERE id = $1",
          [workerId],
        )
      ).rows[0],
    ).toEqual(before);
    expect(
      (
        await database.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_name = 'logged_export_execution_progress'`,
        )
      ).rows,
    ).toHaveLength(1);
    copyFileSync(
      resolve(cloudMigrationDirectory, "0019_logged_export_batches.sql"),
      join(migrations, "0019_logged_export_batches.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0019_logged_export_batches",
    ]);
    expect(
      (
        await database.query(
          "SELECT * FROM registered_export_workers WHERE id = $1",
          [workerId],
        )
      ).rows[0],
    ).toEqual(before);
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM information_schema.tables
           WHERE table_name IN (
             'logged_export_batches', 'logged_export_batch_items'
           )`,
        )
      ).rows[0]!.count,
    ).toBe("2");
    expect(
      (
        await database.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
           WHERE table_name = 'export_requests'
             AND column_name = 'batch_item_id'`,
        )
      ).rows,
    ).toHaveLength(1);
    const projectId = randomUUID();
    const videoId = randomUUID();
    const clipId = randomUUID();
    const jobId = randomUUID();
    const requestId = randomUUID();
    const deliveryId = randomUUID();
    const successId = randomUUID();
    await database.query(
      `INSERT INTO projects (id, name, created_by, created_at, updated_at)
       VALUES ($1, 'Legacy history', $2, $3, $3)`,
      [projectId, userId, at],
    );
    await database.query(
      `INSERT INTO videos (id, youtube_video_id, title, created_at)
       VALUES ($1, 'LegacyM6History', 'Legacy history', $2)`,
      [videoId, at],
    );
    await database.query(
      `INSERT INTO clip_candidates
         (id, project_id, video_id, youtube_video_id, canonical_url,
          video_title, idempotency_key, transcript_track_id,
          transcript_version, first_segment_id, last_segment_id,
          transcript_start_ms, transcript_end_ms, export_start_ms,
          export_end_ms, timing_precision, english_text, export_status,
          created_by, created_at, updated_at)
       VALUES ($1, $2, $3, 'LegacyM6History',
               'https://www.youtube.com/watch?v=LegacyM6History',
               'Legacy history', 'legacy-history-clip', $4, 1, $5, $6,
               0, 1000, 0, 1000, 'cue', 'Legacy selection', 'complete',
               $7, $8, $8)`,
      [
        clipId,
        projectId,
        videoId,
        randomUUID(),
        randomUUID(),
        randomUUID(),
        userId,
        at,
      ],
    );
    await database.query(
      `INSERT INTO jobs
         (id, project_id, kind, state, idempotency_key, attempt, payload,
          created_at, updated_at)
       VALUES ($1, $2, 'export', 'complete', 'legacy-history-job', 0,
               '{}'::jsonb, $3, $3)`,
      [jobId, projectId, at],
    );
    await database.query(
      `INSERT INTO export_requests
         (id, job_id, clip_id, project_id, mode, video_snapshot,
          selection_snapshot, source_language_class, preset_snapshot,
          resolved_settings_snapshot, requested_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'logged', '{}'::jsonb, '{}'::jsonb,
               'confirmed_english', '{}'::jsonb, '{}'::jsonb, $5, $6, $6)`,
      [requestId, jobId, clipId, projectId, userId, at],
    );
    await database.query(
      `INSERT INTO logged_export_deliveries
         (id, export_request_id, generation, reservation_token, worker_id,
          worker_epoch, reserved_at, reservation_expires_at, accepted_at,
          created_at, updated_at)
       VALUES ($1, $2, 1, $3, $4, 7, $5, $6, $5, $5, $5)`,
      [
        deliveryId,
        requestId,
        randomUUID(),
        workerId,
        at,
        "2026-08-20T12:00:30.000Z",
      ],
    );
    await database.query(
      `INSERT INTO logged_export_success_results
         (id, export_request_id, delivery_id, delivery_generation, worker_id,
          worker_epoch, result_schema_version, result_json,
          result_fingerprint, reconciled_at)
       VALUES ($1, $2, $3, 1, $4, 7, 1, $5::jsonb, $6, $7)`,
      [
        successId,
        requestId,
        deliveryId,
        workerId,
        JSON.stringify(
          legacyLoggedExportSuccessResult({
            requestId,
            jobId,
            projectId,
            clipId,
            trackId: randomUUID(),
            validatedAt: at,
          }),
        ),
        "b".repeat(64),
        at,
      ],
    );
    const legacySuccess = (
      await database.query<Record<string, unknown>>(
        "SELECT * FROM logged_export_success_results WHERE id = $1",
        [successId],
      )
    ).rows[0];
    copyFileSync(
      resolve(cloudMigrationDirectory, "0020_export_request_origin.sql"),
      join(migrations, "0020_export_request_origin.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0020_export_request_origin",
    ]);
    expect(
      (
        await database.query<{ request_origin: string | null }>(
          "SELECT request_origin FROM export_requests WHERE id = $1",
          [requestId],
        )
      ).rows[0],
    ).toEqual({ request_origin: null });
    copyFileSync(
      resolve(
        cloudMigrationDirectory,
        "0023_export_source_rights_snapshots.sql",
      ),
      join(migrations, "0023_export_source_rights_snapshots.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0023_export_source_rights_snapshots",
    ]);
    expect(
      (
        await database.query<{ source_rights_snapshot: unknown }>(
          "SELECT source_rights_snapshot FROM export_requests WHERE id = $1",
          [requestId],
        )
      ).rows[0],
    ).toEqual({ source_rights_snapshot: null });
    const tamperedJobId = randomUUID();
    await database.query(
      `INSERT INTO jobs
         (id, project_id, kind, state, idempotency_key, attempt, payload,
          created_at, updated_at)
       SELECT $1, project_id, kind, 'queued', 'tampered-source-rights-job',
              0, payload, created_at, updated_at
       FROM jobs WHERE id = $2`,
      [tamperedJobId, jobId],
    );
    await expect(
      database.query(
        `INSERT INTO export_requests
           (id, job_id, clip_id, project_id, mode, video_snapshot,
            selection_snapshot, source_language_class,
            subtitle_tracks_snapshot, preset_snapshot,
            source_rights_snapshot, resolved_settings_snapshot, requested_by,
            request_origin, created_at, updated_at)
         SELECT $1, $2, clip_id, project_id, mode, video_snapshot,
                selection_snapshot, source_language_class,
                subtitle_tracks_snapshot, preset_snapshot,
                '{"schemaVersion":1,"source":"youtube","youtubeVideoId":"different-video","confirmation":"authorized_to_process","disclosureVersion":1}'::jsonb,
                resolved_settings_snapshot, requested_by, request_origin,
                created_at, updated_at
         FROM export_requests WHERE id = $3`,
        [randomUUID(), tamperedJobId, requestId],
      ),
    ).rejects.toThrow(/export_requests_source_rights_exact_video/u);
    expect(
      LoggedExportSuccessResultSchema.parse(legacySuccess!.result_json),
    ).toMatchObject({
      requestId,
      jobId,
      projectId,
      clipId,
      artifacts: expect.arrayContaining([
        expect.objectContaining({ role: "manifest_json" }),
      ]),
    });
    expect(
      (
        await database.query(
          "SELECT * FROM logged_export_success_results WHERE id = $1",
          [successId],
        )
      ).rows[0],
    ).toEqual(legacySuccess);
    await expect(
      database.query(
        "UPDATE export_requests SET request_origin = 'selection_action' WHERE id = $1",
        [requestId],
      ),
    ).rejects.toThrow(/immutable/u);
    await expect(
      database.query(
        "DELETE FROM logged_export_success_results WHERE id = $1",
        [successId],
      ),
    ).rejects.toThrow(/immutable history/u);
    await expect(
      database.query("DELETE FROM export_requests WHERE id = $1", [requestId]),
    ).rejects.toThrow(/immutable history/u);
    expect(
      (
        await database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM logged_export_success_results WHERE id = $1",
          [successId],
        )
      ).rows[0]!.count,
    ).toBe("1");
  });

  it("backfills transcript selections and constrains player-range speech rows without hybrids", async () => {
    const database = new PGlite();
    databases.add(database);
    const directory = mkdtempSync(
      join(tmpdir(), "research-video-cloud-player-range-"),
    );
    temporaryDirectories.add(directory);
    const migrations = join(directory, "migrations");
    mkdirSync(migrations);
    for (const filename of readdirSync(cloudMigrationDirectory)) {
      if (filename < "0037") {
        copyFileSync(
          resolve(cloudMigrationDirectory, filename),
          join(migrations, filename),
        );
      }
    }
    expect(await runCloudMigrations(database, migrations)).toHaveLength(36);

    const userId = randomUUID();
    const projectId = randomUUID();
    const videoId = randomUUID();
    const historicalClipId = randomUUID();
    const historicalTrackId = randomUUID();
    const historicalFirstSegmentId = randomUUID();
    const historicalLastSegmentId = randomUUID();
    const at = "2026-08-24T12:00:00.000Z";
    await database.query(
      `INSERT INTO users
         (id, external_subject, handle, normalized_handle, display_name,
          preferred_language, created_at, updated_at)
       VALUES ($1, 'fixture:player-range-migration', 'player_range_migration',
               'player_range_migration', 'Player Range Migration', 'en',
               $2, $2)`,
      [userId, at],
    );
    await database.query(
      `INSERT INTO projects
         (id, name, created_by, created_at, updated_at)
       VALUES ($1, 'Player range migration', $2, $3, $3)`,
      [projectId, userId, at],
    );
    await database.query(
      `INSERT INTO videos (id, youtube_video_id, title, created_at)
       VALUES ($1, 'PlayerRangeMigration1', 'Player range migration', $2)`,
      [videoId, at],
    );
    await database.query(
      `INSERT INTO clip_candidates
         (id, project_id, video_id, youtube_video_id, canonical_url,
          video_title, idempotency_key, transcript_track_id,
          transcript_version, first_segment_id, last_segment_id,
          transcript_start_ms, transcript_end_ms, export_start_ms,
          export_end_ms, timing_precision, english_text, selection_text,
          notes, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, 'PlayerRangeMigration1',
               'https://www.youtube.com/watch?v=PlayerRangeMigration1',
               'Player range migration', 'historical-transcript-selection',
               $4, 2, $5, $6, 1000, 3000, 500, 3500, 'word',
               'Historical selection', 'Historical selection', '', $7, $8, $8)`,
      [
        historicalClipId,
        projectId,
        videoId,
        historicalTrackId,
        historicalFirstSegmentId,
        historicalLastSegmentId,
        userId,
        at,
      ],
    );

    copyFileSync(
      resolve(cloudMigrationDirectory, "0037_player_range_speech_status.sql"),
      join(migrations, "0037_player_range_speech_status.sql"),
    );
    expect(await runCloudMigrations(database, migrations)).toEqual([
      "0037_player_range_speech_status",
    ]);
    expect(
      (
        await database.query<{
          selection_kind: string;
          speech_status: string | null;
          selection_snapshot: unknown;
          language_evidence_schema_version: number;
        }>(
          `SELECT selection_kind, speech_status, selection_snapshot,
                  language_evidence_schema_version
           FROM clip_candidates WHERE id = $1`,
          [historicalClipId],
        )
      ).rows[0],
    ).toEqual({
      selection_kind: "transcript_range",
      speech_status: null,
      selection_snapshot: {
        selectionType: "transcript_range",
        trackId: historicalTrackId,
        transcriptVersion: 2,
        firstSegmentId: historicalFirstSegmentId,
        lastSegmentId: historicalLastSegmentId,
        transcriptStartMs: 1_000,
        transcriptEndMs: 3_000,
        exportStartMs: 500,
        exportEndMs: 3_500,
        text: "Historical selection",
        timingPrecision: "word",
      },
      language_evidence_schema_version: 1,
    });

    const noSpeechAttestation = {
      schemaVersion: 1,
      actor: {
        id: userId,
        handle: "player_range_migration",
        displayName: "Player Range Migration",
      },
      attestedAt: at,
    };
    const noSpeechSelection = {
      selectionType: "player_time_range",
      sourceStartMs: 4_000,
      sourceEndMs: 5_000,
      exportStartMs: 3_500,
      exportEndMs: 5_500,
      origin: "manual_player",
      speechStatus: "no_speech",
      noSpeechAttestation,
    };
    const insertPlayerRange = (input: {
      id: string;
      idempotencyKey: string;
      transcriptTrackId?: string | null;
      languageEvidenceSchemaVersion?: number;
      englishText?: string | null;
      selectionKind?: string;
      speechStatus?: string | null;
      selectionSnapshot?: unknown;
    }) =>
      database.query(
        `INSERT INTO clip_candidates
           (id, project_id, video_id, youtube_video_id, canonical_url,
            video_title, idempotency_key, transcript_track_id,
            transcript_version, first_segment_id, last_segment_id,
            first_token_id, last_token_id, transcript_start_ms,
            transcript_end_ms, export_start_ms, export_end_ms,
            timing_precision, english_text, selection_text,
            language_evidence_schema_version, notes, selection_kind,
            speech_status, selection_snapshot, no_speech_attested_by,
            no_speech_attested_handle, no_speech_attested_display_name,
            no_speech_attested_at, no_speech_attestation_version,
            created_by, created_at, updated_at)
         VALUES ($1, $2, $3, 'PlayerRangeMigration1',
                 'https://www.youtube.com/watch?v=PlayerRangeMigration1',
                 'Player range migration', $4, $5, NULL, NULL, NULL, NULL,
                 NULL, NULL, NULL, 3500, 5500, NULL, $6, NULL, $7, '', $8,
                 $9, $10::jsonb, $11, $12, $13, $14, $15, $11, $14, $14)`,
        [
          input.id,
          projectId,
          videoId,
          input.idempotencyKey,
          input.transcriptTrackId ?? null,
          input.englishText ?? null,
          input.languageEvidenceSchemaVersion ?? 3,
          input.selectionKind ?? "player_time_range",
          input.speechStatus === undefined ? "no_speech" : input.speechStatus,
          JSON.stringify(input.selectionSnapshot ?? noSpeechSelection),
          userId,
          noSpeechAttestation.actor.handle,
          noSpeechAttestation.actor.displayName,
          at,
          noSpeechAttestation.schemaVersion,
        ],
      );

    const playerClipId = randomUUID();
    await expect(
      insertPlayerRange({
        id: playerClipId,
        idempotencyKey: "valid-player-no-speech",
      }),
    ).resolves.toBeDefined();
    expect(
      (
        await database.query<{
          transcript_track_id: string | null;
          english_text: string | null;
          language_evidence_schema_version: number;
        }>(
          `SELECT transcript_track_id, english_text,
                  language_evidence_schema_version
           FROM clip_candidates WHERE id = $1`,
          [playerClipId],
        )
      ).rows[0],
    ).toEqual({
      transcript_track_id: null,
      english_text: null,
      language_evidence_schema_version: 3,
    });
    await expect(
      insertPlayerRange({
        id: randomUUID(),
        idempotencyKey: "malformed-player-hybrid",
        transcriptTrackId: randomUUID(),
      }),
    ).rejects.toThrow(/clip_candidates_selection_shape_check/u);
    await expect(
      insertPlayerRange({
        id: randomUUID(),
        idempotencyKey: "schema-three-transcript",
        selectionKind: "transcript_range",
        speechStatus: null,
        selectionSnapshot: {
          ...noSpeechSelection,
          selectionType: "transcript_range",
        },
      }),
    ).rejects.toThrow(/clip_candidates_selection_shape_check/u);
  });

  it("enforces preset ownership, scope names, fixed defaults, and immutable revisions", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const ownerId = randomUUID();
    const otherId = randomUUID();
    const presetId = randomUUID();
    for (const [id, subject] of [
      [ownerId, "fixture:preset-owner"],
      [otherId, "fixture:preset-other"],
    ]) {
      await database.query(
        `INSERT INTO users
           (id, external_subject, handle, normalized_handle, display_name,
            preferred_language, created_at, updated_at)
         VALUES ($1, $2, $3, $3, $2, 'en', now(), now())`,
        [id, subject, `preset_${id!.replaceAll("-", "").slice(0, 20)}`],
      );
    }
    await expect(
      database.query(
        `INSERT INTO export_presets
           (id, scope, owner_user_id, project_id, normalized_name,
            current_version, entity_version, created_by)
         VALUES ($1, 'personal', NULL, NULL, 'invalid', 1, 1, $2)`,
        [randomUUID(), ownerId],
      ),
    ).rejects.toThrow();
    await database.query(
      `INSERT INTO export_presets
         (id, scope, owner_user_id, project_id, normalized_name,
          current_version, entity_version, created_by)
       VALUES ($1, 'personal', $2, NULL, 'editing', 1, 1, $2)`,
      [presetId, ownerId],
    );
    await database.query(
      `INSERT INTO export_preset_versions
         (preset_id, version, name, description, settings_snapshot, created_by)
       VALUES ($1, 1, 'Editing', '', '{}'::jsonb, $2)`,
      [presetId, ownerId],
    );
    await expect(
      database.query(
        `INSERT INTO export_presets
           (id, scope, owner_user_id, project_id, normalized_name,
            current_version, entity_version, created_by)
         VALUES ($1, 'personal', $2, NULL, 'editing', 1, 1, $2)`,
        [randomUUID(), ownerId],
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `INSERT INTO personal_export_preset_defaults
           (user_id, preset_id, preset_version, entity_version, updated_by)
         VALUES ($1, $2, 1, 1, $1)`,
        [otherId, presetId],
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `UPDATE export_preset_versions SET description = 'mutated'
         WHERE preset_id = $1 AND version = 1`,
        [presetId],
      ),
    ).rejects.toThrow(/immutable/u);
  });
});

function fakePostgresClient(calls: string[], label: string): PostgresClient {
  return {
    async query<Row extends CloudQueryRow>(sql: string) {
      calls.push(`${label}:${sql}`);
      return { rows: [] } as CloudQueryResult<Row>;
    },
    release() {
      calls.push(`${label}:release`);
    },
  };
}

function fakePostgresPool(
  calls: string[],
  client: PostgresClient,
): PostgresPool {
  return {
    async query<Row extends CloudQueryRow>(sql: string) {
      calls.push(`pool:${sql}`);
      return { rows: [] } as CloudQueryResult<Row>;
    },
    async connect() {
      calls.push("pool:connect");
      return client;
    },
    async end() {
      calls.push("pool:end");
    },
  };
}

function legacyLoggedExportSuccessResult(input: {
  requestId: string;
  jobId: string;
  projectId: string;
  clipId: string;
  trackId: string;
  validatedAt: string;
}) {
  const packageIdentity = `clip-${input.requestId}`;
  const artifact = (role: string, digit: string) => ({
    role,
    packageIdentity,
    byteSize: 128,
    contentSha256: digit.repeat(64),
    sourceAttempt: 1,
    validatedAt: input.validatedAt,
  });
  return LoggedExportSuccessResultSchema.parse({
    schemaVersion: 1,
    requestId: input.requestId,
    jobId: input.jobId,
    projectId: input.projectId,
    clipId: input.clipId,
    sourceLanguageClass: "confirmed_english",
    resolvedExportBounds: {
      startMs: 0,
      endMs: 1_000,
      sourceAttempt: 1,
      resolvedAt: input.validatedAt,
    },
    renderedMediaProvenance: {
      durationMs: 1_000,
      containerFormat: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      ffprobeVersion: "8.1.2",
      ffmpegVersion: "8.1.2",
      verificationSchemaVersion: 1,
      settingsSha256: "a".repeat(64),
      observedProperties: {
        schemaVersion: 1,
        container: { formatNames: ["mp4"] },
        streamCounts: {
          total: 2,
          video: 1,
          audio: 1,
          subtitle: 0,
          data: 0,
          other: 0,
        },
        video: {
          codec: "h264",
          profile: "High",
          pixelFormat: "yuv420p",
          width: 1_920,
          height: 1_080,
          sampleAspectRatio: { numerator: 1, denominator: 1 },
          displayAspectRatio: { numerator: 16, denominator: 9 },
          averageFrameRate: { numerator: 30, denominator: 1 },
        },
        audio: {
          codec: "aac",
          sampleRate: 48_000,
          channels: 2,
          channelLayout: "stereo",
        },
        durationMs: 1_000,
        ffprobeVersion: "8.1.2",
      },
      sourceAttempt: 1,
      validatedAt: input.validatedAt,
    },
    thumbnailProvenance: {
      extractionTimeMs: 500,
      width: 640,
      height: 360,
      sourceAttempt: 1,
      validatedAt: input.validatedAt,
    },
    englishSubtitleProvenance: {
      trackId: input.trackId,
      trackVersion: 1,
      cueCount: 1,
      byteSize: 64,
      contentSha256: "e".repeat(64),
      startMs: 0,
      endMs: 1_000,
      sourceAttempt: 1,
      validatedAt: input.validatedAt,
    },
    artifacts: [
      artifact("clip_metadata_json", "1"),
      artifact("english_srt", "2"),
      artifact("manifest_json", "3"),
      artifact("thumbnail_jpg", "4"),
      artifact("video_mp4", "5"),
    ],
  });
}
