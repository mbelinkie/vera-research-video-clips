import { readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import {
  CreateExportOnlyRequestSchema,
  ExportRequestSchema,
  NormalizedTranscriptSchema,
  type CreateExportOnlyRequest,
  type ExportRequest,
  type NormalizedTranscript,
} from "@research-video/contracts";

const defaultMigrationDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);

export function openLocalDatabase(filename: string): DatabaseSync {
  const database = new DatabaseSync(filename);
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA journal_mode = WAL;");
  return database;
}

export function runLocalMigrations(
  database: DatabaseSync,
  migrationDirectory = defaultMigrationDirectory,
): string[] {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = database
    .prepare("SELECT version FROM schema_migrations")
    .all() as Array<{
    version: string;
  }>;
  const applied = new Set(appliedRows.map((row) => row.version));
  const files = readdirSync(resolve(migrationDirectory))
    .filter((filename) => /^\d+_.+\.sql$/.test(filename))
    .sort();
  const newlyApplied: string[] = [];

  for (const filename of files) {
    const version = basename(filename, ".sql");
    if (applied.has(version)) continue;

    const sql = readFileSync(resolve(migrationDirectory, filename), "utf8");
    database.exec("BEGIN IMMEDIATE;");
    try {
      database.exec(sql);
      database
        .prepare(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        )
        .run(version, new Date().toISOString());
      database.exec("COMMIT;");
      newlyApplied.push(version);
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
  }

  return newlyApplied;
}

export class LocalExportQueue {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
  ) {}

  createExportOnly(input: CreateExportOnlyRequest): ExportRequest {
    const request = CreateExportOnlyRequestSchema.parse(input);
    const idempotencyKey = `export-only:${request.idempotencyKey}`;
    const existing = this.database
      .prepare(
        `SELECT er.*, j.state
         FROM export_requests er
         JOIN jobs j ON j.id = er.job_id
         WHERE j.idempotency_key = ?`,
      )
      .get(idempotencyKey) as Record<string, unknown> | undefined;
    if (existing) return mapLocalExportRequest(existing);

    const requestId = randomUUID();
    const jobId = randomUUID();
    const now = this.now().toISOString();
    const videoSnapshot = JSON.stringify(request.video);
    const selectionSnapshot = JSON.stringify(request.selection);
    const presetSnapshot = JSON.stringify(request.preset);
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database
        .prepare(
          `INSERT INTO jobs
             (id, project_id, kind, state, idempotency_key, attempt,
              payload_json, created_at, updated_at)
           VALUES (?, NULL, 'export', 'queued', ?, 0, ?, ?, ?)`,
        )
        .run(
          jobId,
          idempotencyKey,
          JSON.stringify({
            exportRequestId: requestId,
            mode: "export_only",
            video: request.video,
            selection: request.selection,
            sourceLanguageClass: request.sourceLanguageClass,
            preset: request.preset,
          }),
          now,
          now,
        );
      this.database
        .prepare(
          `INSERT INTO export_requests
             (id, job_id, mode, video_snapshot_json,
              selection_snapshot_json, source_language_class,
              preset_snapshot_json, created_at, updated_at)
           VALUES (?, ?, 'export_only', ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          requestId,
          jobId,
          videoSnapshot,
          selectionSnapshot,
          request.sourceLanguageClass,
          presetSnapshot,
          now,
          now,
        );
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
    return this.get(requestId)!;
  }

  get(requestId: string): ExportRequest | undefined {
    const row = this.database
      .prepare(
        `SELECT er.*, j.state
         FROM export_requests er
         JOIN jobs j ON j.id = er.job_id
         WHERE er.id = ?`,
      )
      .get(requestId) as Record<string, unknown> | undefined;
    return row ? mapLocalExportRequest(row) : undefined;
  }

  list(): ExportRequest[] {
    return (
      this.database
        .prepare(
          `SELECT er.*, j.state
           FROM export_requests er
           JOIN jobs j ON j.id = er.job_id
           ORDER BY er.created_at DESC, er.id
           LIMIT 500`,
        )
        .all() as Record<string, unknown>[]
    ).map(mapLocalExportRequest);
  }
}

function mapLocalExportRequest(row: Record<string, unknown>): ExportRequest {
  return ExportRequestSchema.parse({
    id: row.id,
    jobId: row.job_id,
    mode: row.mode,
    video: JSON.parse(String(row.video_snapshot_json)),
    selection: JSON.parse(String(row.selection_snapshot_json)),
    sourceLanguageClass: row.source_language_class,
    preset: JSON.parse(String(row.preset_snapshot_json)),
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class LocalTranscriptIndex {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
  ) {}

  replace(input: {
    projectId: string;
    catalogVideoId: string;
    transcriptVersionId: string;
    transcript: NormalizedTranscript;
  }): void {
    const transcript = NormalizedTranscriptSchema.parse(input.transcript);
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database
        .prepare(
          `DELETE FROM transcript_tracks
           WHERE transcript_version_id = ? AND id = ?`,
        )
        .run(input.transcriptVersionId, transcript.track.id);
      this.database
        .prepare(
          `INSERT INTO transcript_tracks
             (transcript_version_id, id, project_id, catalog_video_id,
              video_id, language, kind, source, provider, model,
              source_track_id, timing_precision, schema_version,
              content_sha256, version, indexed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.transcriptVersionId,
          transcript.track.id,
          input.projectId,
          input.catalogVideoId,
          transcript.track.videoId,
          transcript.track.language,
          transcript.track.kind,
          transcript.track.source,
          transcript.track.provider,
          transcript.track.model ?? null,
          transcript.track.sourceTrackId ?? null,
          transcript.track.timingPrecision,
          transcript.track.schemaVersion,
          transcript.track.contentSha256,
          transcript.track.version,
          this.now().toISOString(),
        );
      const insertSegment = this.database.prepare(
        `INSERT INTO transcript_segments
           (transcript_version_id, id, track_id, ordinal, start_ms, end_ms, text)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const segment of transcript.segments) {
        insertSegment.run(
          input.transcriptVersionId,
          segment.id,
          segment.trackId,
          segment.ordinal,
          segment.startMs,
          segment.endMs,
          segment.text,
        );
      }
      const insertToken = this.database.prepare(
        `INSERT INTO transcript_tokens
           (transcript_version_id, id, segment_id, ordinal, text,
            start_ms, end_ms, timing_confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const token of transcript.tokens) {
        insertToken.run(
          input.transcriptVersionId,
          token.id,
          token.segmentId,
          token.ordinal,
          token.text,
          token.startMs ?? null,
          token.endMs ?? null,
          token.timingConfidence ?? null,
        );
      }
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  get(
    transcriptVersionId: string,
    kind: "original" | "english",
  ): NormalizedTranscript | undefined {
    const track = this.database
      .prepare(
        `SELECT * FROM transcript_tracks
         WHERE transcript_version_id = ? AND kind = ?`,
      )
      .get(transcriptVersionId, kind) as Record<string, unknown> | undefined;
    if (!track) return undefined;
    const segments = this.database
      .prepare(
        `SELECT * FROM transcript_segments
         WHERE transcript_version_id = ? AND track_id = ? ORDER BY ordinal`,
      )
      .all(transcriptVersionId, String(track.id)) as Record<string, unknown>[];
    const tokens = this.database
      .prepare(
        `SELECT tt.* FROM transcript_tokens tt
         JOIN transcript_segments ts
           ON ts.transcript_version_id = tt.transcript_version_id
          AND ts.id = tt.segment_id
         WHERE tt.transcript_version_id = ? AND ts.track_id = ?
         ORDER BY ts.ordinal, tt.ordinal`,
      )
      .all(transcriptVersionId, String(track.id)) as Record<string, unknown>[];
    return NormalizedTranscriptSchema.parse({
      track: {
        id: track.id,
        videoId: track.video_id,
        language: track.language,
        kind: track.kind,
        source: track.source,
        provider: track.provider,
        ...(track.model === null ? {} : { model: track.model }),
        ...(track.source_track_id === null
          ? {}
          : { sourceTrackId: track.source_track_id }),
        timingPrecision: track.timing_precision,
        schemaVersion: Number(track.schema_version),
        contentSha256: track.content_sha256,
        version: Number(track.version),
      },
      segments: segments.map((segment) => ({
        id: segment.id,
        trackId: segment.track_id,
        ordinal: Number(segment.ordinal),
        startMs: Number(segment.start_ms),
        endMs: Number(segment.end_ms),
        text: segment.text,
      })),
      tokens: tokens.map((token) => ({
        id: token.id,
        segmentId: token.segment_id,
        ordinal: Number(token.ordinal),
        text: token.text,
        ...(token.start_ms === null ? {} : { startMs: Number(token.start_ms) }),
        ...(token.end_ms === null ? {} : { endMs: Number(token.end_ms) }),
        ...(token.timing_confidence === null
          ? {}
          : { timingConfidence: Number(token.timing_confidence) }),
      })),
    });
  }
}
