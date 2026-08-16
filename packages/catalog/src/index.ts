import { createHash, randomUUID } from "node:crypto";

import type { PGlite } from "@electric-sql/pglite";
import { AuthorizationError, requirePermission } from "@research-video/auth";
import {
  ActiveTranscriptBundleSchema,
  BatchPreflightSummarySchema,
  ClaimedTranscriptionJobSchema,
  ClipCandidateSchema,
  CreateTranscriptionBatchResponseSchema,
  ExportRequestSchema,
  JobSchema,
  ProjectSchema,
  ReviewInboxItemSchema,
  ReviewInboxResponseSchema,
  TranscriptManifestSchema,
  TranscriptionBatchItemSchema,
  TranscriptUploadGrantSchema,
  TranscriptionBatchListResponseSchema,
  UserSchema,
  VideoSchema,
  WorkerLeaseSchema,
  type ActiveTranscriptBundle,
  type AuthenticatedActor,
  type BatchOptions,
  type BatchPreflightItem,
  type ClaimedTranscriptionJob,
  type ClipCandidate,
  type CreateClipCandidateRequest,
  type CreateClipExportRequest,
  type CreateTranscriptionBatchResponse,
  type FinalizeTranscriptRequest,
  type ExportRequest,
  type Project,
  type ProjectRole,
  type TranscriptArtifact,
  type TranscriptUploadGrant,
  type TranscriptionBatchItem,
  type TranscriptionBatchControlRequest,
  type TranscriptionBatchListResponse,
  type ReviewInboxItem,
  type ReviewInboxResponse,
  type UpdateReviewStatusRequest,
  type UpdateClipCandidateRequest,
  type TranscriptSourcePlan,
  type User,
  type Video,
  type WorkerLease,
  type WorkerFailureRequest,
  type WorkerProgressStage,
} from "@research-video/contracts";
import {
  MemoryStagedUploadUrlIssuer,
  type StagedUploadUrlIssuer,
  type TranscriptObjectStore,
} from "@research-video/storage";

export class CatalogNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = "not_found";
}

export class CatalogConflictError extends Error {
  readonly statusCode = 409;
  readonly code = "conflict";
}

export class TranscriptIntegrityError extends Error {
  readonly statusCode = 422;
  readonly code = "transcript_integrity_failed";
}

export type ArtifactType = TranscriptArtifact["type"];

export interface CreateTranscriptUploadInput {
  projectId: string;
  catalogVideoId: string;
  lineageId: string;
  version: number;
  artifactTypes: Exclude<ArtifactType, "manifest">[];
}

export interface CreateClaimedTranscriptUploadInput {
  lineageId: string;
  version: number;
  artifactTypes: Exclude<ArtifactType, "manifest">[];
}

export interface CreateTranscriptionBatchInput {
  projectId: string;
  name: string;
  options: BatchOptions;
  items: BatchPreflightItem[];
}

export type ProjectVideoTranscriptState = {
  catalogVideoId: string;
  canonicalUrl: string;
  title: string;
  channel?: string;
  durationMs?: number;
  sourceLanguage?: string;
  activeTranscriptVersionId?: string;
};

type DbRow = Record<string, unknown>;

const iso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : String(value);

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const clipCandidateSelect = "SELECT c.* FROM clip_candidates c";
const loggedExportRequestSelect = `SELECT er.*, j.state
 FROM export_requests er
 JOIN jobs j ON j.id = er.job_id`;

export class SharedProjectCatalog {
  constructor(
    private readonly database: PGlite,
    private readonly store: TranscriptObjectStore,
    private readonly now: () => Date = () => new Date(),
    private readonly uploadUrlIssuer: StagedUploadUrlIssuer = new MemoryStagedUploadUrlIssuer(),
  ) {}

  async registerUser(
    actor: AuthenticatedActor,
    displayName: string,
  ): Promise<User> {
    const now = this.now().toISOString();
    const result = await this.database.query<DbRow>(
      `INSERT INTO users (id, external_subject, display_name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (external_subject) DO UPDATE
       SET display_name = EXCLUDED.display_name, updated_at = EXCLUDED.updated_at
       RETURNING id, external_subject, display_name, created_at, updated_at`,
      [actor.userId, actor.externalSubject, displayName.trim(), now],
    );
    return mapUser(result.rows[0]);
  }

  async createProject(
    actor: AuthenticatedActor,
    input: { name: string; description?: string },
  ): Promise<Project> {
    await this.requireRegistered(actor);
    const id = randomUUID();
    const now = this.now().toISOString();
    await this.transaction(async () => {
      await this.database.query(
        `INSERT INTO projects
           (id, name, description, version, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, 1, $4, $5, $5)`,
        [
          id,
          input.name.trim(),
          input.description?.trim() ?? "",
          actor.userId,
          now,
        ],
      );
      await this.database.query(
        `INSERT INTO project_members
           (project_id, user_id, role, version, created_at, updated_at)
         VALUES ($1, $2, 'owner', 1, $3, $3)`,
        [id, actor.userId, now],
      );
    });
    return this.getProject(actor, id);
  }

  async listProjects(actor: AuthenticatedActor): Promise<Project[]> {
    await this.requireRegistered(actor);
    const result = await this.database.query<DbRow>(
      `SELECT p.id, p.name, p.description, p.version, p.created_at, p.updated_at
       FROM projects p
       JOIN project_members pm ON pm.project_id = p.id
       WHERE pm.user_id = $1
       ORDER BY p.updated_at DESC`,
      [actor.userId],
    );
    return result.rows.map(mapProject);
  }

  async createClipCandidate(
    actor: AuthenticatedActor,
    projectId: string,
    input: CreateClipCandidateRequest,
  ): Promise<ClipCandidate> {
    await this.authorize(actor, projectId, "write");
    const candidateId = randomUUID();
    const now = this.now().toISOString();
    let persistedCandidateId: string = candidateId;

    await this.transaction(async () => {
      const videoId = randomUUID();
      const videoResult = await this.database.query<DbRow>(
        `INSERT INTO videos
           (id, youtube_video_id, canonical_url, title, channel, source_language,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         ON CONFLICT (youtube_video_id) DO UPDATE
         SET canonical_url = EXCLUDED.canonical_url,
             title = EXCLUDED.title,
             channel = EXCLUDED.channel,
             source_language = COALESCE(EXCLUDED.source_language, videos.source_language),
             updated_at = EXCLUDED.updated_at
         RETURNING id`,
        [
          videoId,
          input.video.youtubeVideoId,
          input.video.canonicalUrl,
          input.video.title,
          input.video.channel ?? null,
          input.video.sourceLanguage ?? null,
          now,
        ],
      );
      const catalogVideoId = String(videoResult.rows[0]!.id);
      await this.database.query(
        `INSERT INTO project_videos
           (project_id, video_id, version, created_at, updated_at)
         VALUES ($1, $2, 1, $3, $3)
         ON CONFLICT (project_id, video_id) DO NOTHING`,
        [projectId, catalogVideoId, now],
      );

      const selection = input.selection;
      const inserted = await this.database.query<DbRow>(
        `INSERT INTO clip_candidates
           (id, project_id, video_id, youtube_video_id, canonical_url,
            video_title, video_channel, source_language, idempotency_key,
            transcript_track_id, transcript_version, first_segment_id,
            last_segment_id, first_token_id, last_token_id,
            transcript_start_ms, transcript_end_ms, export_start_ms,
            export_end_ms, timing_precision, english_text, original_text, notes,
            research_status, export_status, created_by, version, created_at,
            updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                 $14, $15, $16, $17, $18, $19, $20, $21, $22, $23,
                 'candidate', 'not_requested', $24, 1, $25, $25)
         ON CONFLICT (project_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [
          candidateId,
          projectId,
          catalogVideoId,
          input.video.youtubeVideoId,
          input.video.canonicalUrl,
          input.video.title,
          input.video.channel ?? null,
          input.video.sourceLanguage ?? null,
          input.idempotencyKey,
          selection.trackId,
          selection.transcriptVersion,
          selection.firstSegmentId,
          selection.lastSegmentId,
          selection.firstTokenId ?? null,
          selection.lastTokenId ?? null,
          selection.transcriptStartMs,
          selection.transcriptEndMs,
          selection.exportStartMs,
          selection.exportEndMs,
          selection.timingPrecision,
          input.englishText,
          input.originalText ?? null,
          input.notes,
          actor.userId,
          now,
        ],
      );
      const created = Boolean(inserted.rows[0]);
      if (!created) {
        const existing = await this.database.query<DbRow>(
          `SELECT id FROM clip_candidates
           WHERE project_id = $1 AND idempotency_key = $2`,
          [projectId, input.idempotencyKey],
        );
        persistedCandidateId = String(existing.rows[0]!.id);
        return;
      }

      for (const tagName of uniqueTagNames(input.tags)) {
        const tagResult = await this.database.query<DbRow>(
          `INSERT INTO clip_tags
             (id, project_id, name, normalized_name, created_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (project_id, normalized_name) DO UPDATE
           SET normalized_name = EXCLUDED.normalized_name
           RETURNING id`,
          [randomUUID(), projectId, tagName, normalizeTagName(tagName), now],
        );
        await this.database.query(
          `INSERT INTO clip_candidate_tags (clip_id, tag_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [candidateId, tagResult.rows[0]!.id],
        );
      }
      await this.database.query(
        `INSERT INTO sync_events
           (project_id, event_type, entity_id, server_version, payload, created_at)
         VALUES ($1, 'clip_candidate.created', $2, 1, $3, $4)`,
        [
          projectId,
          candidateId,
          JSON.stringify({
            clipId: candidateId,
            exportStatus: "not_requested",
          }),
          now,
        ],
      );
    });

    return this.getClipCandidate(actor, projectId, persistedCandidateId);
  }

  async listClipCandidates(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<ClipCandidate[]> {
    await this.authorize(actor, projectId, "read");
    const result = await this.database.query<DbRow>(
      `${clipCandidateSelect}
       WHERE c.project_id = $1
       ORDER BY c.created_at DESC, c.id
       LIMIT 500`,
      [projectId],
    );
    return Promise.all(
      result.rows.map(async (row) =>
        mapClipCandidate(row, await this.loadClipTags(String(row.id))),
      ),
    );
  }

  async exportClipCandidatesCsv(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<string> {
    const [project, clips] = await Promise.all([
      this.getProject(actor, projectId),
      this.listClipCandidates(actor, projectId),
    ]);
    const columns = [
      "project_id",
      "project_name",
      "clip_id",
      "research_status",
      "export_status",
      "youtube_video_id",
      "video_title",
      "canonical_url",
      "source_language",
      "transcript_track_id",
      "transcript_version",
      "transcript_start_ms",
      "transcript_end_ms",
      "export_start_ms",
      "export_end_ms",
      "timing_precision",
      "english_text",
      "original_text",
      "notes",
      "tags",
      "created_at",
      "updated_at",
    ];
    const rows = clips.map((clip) => [
      project.id,
      project.name,
      clip.id,
      clip.researchStatus,
      clip.exportStatus,
      clip.video.youtubeVideoId,
      clip.video.title,
      clip.video.canonicalUrl,
      clip.video.sourceLanguage ?? "",
      clip.selection.trackId,
      clip.selection.transcriptVersion,
      clip.selection.transcriptStartMs,
      clip.selection.transcriptEndMs,
      clip.selection.exportStartMs,
      clip.selection.exportEndMs,
      clip.selection.timingPrecision,
      clip.englishText,
      clip.originalText ?? "",
      clip.notes,
      clip.tags.join(" | "),
      clip.createdAt,
      clip.updatedAt,
    ]);
    return [columns, ...rows].map(csvRow).join("\r\n").concat("\r\n");
  }

  async getClipCandidate(
    actor: AuthenticatedActor,
    projectId: string,
    clipId: string,
  ): Promise<ClipCandidate> {
    await this.authorize(actor, projectId, "read");
    const result = await this.database.query<DbRow>(
      `${clipCandidateSelect}
       WHERE c.project_id = $1 AND c.id = $2`,
      [projectId, clipId],
    );
    const row = result.rows[0];
    if (!row) throw new CatalogNotFoundError("Clip candidate not found.");
    return mapClipCandidate(row, await this.loadClipTags(clipId));
  }

  async updateClipCandidate(
    actor: AuthenticatedActor,
    projectId: string,
    clipId: string,
    input: UpdateClipCandidateRequest,
  ): Promise<ClipCandidate> {
    await this.authorize(actor, projectId, "write");
    const now = this.now().toISOString();
    await this.transaction(async () => {
      const updated = await this.database.query<DbRow>(
        `UPDATE clip_candidates
         SET notes = $1, version = version + 1, updated_at = $2
         WHERE id = $3 AND project_id = $4 AND version = $5
         RETURNING id, version`,
        [input.notes, now, clipId, projectId, input.expectedVersion],
      );
      if (!updated.rows[0]) {
        const exists = await this.database.query(
          "SELECT 1 FROM clip_candidates WHERE id = $1 AND project_id = $2",
          [clipId, projectId],
        );
        if (!exists.rows[0])
          throw new CatalogNotFoundError("Clip candidate not found.");
        throw new CatalogConflictError(
          "This clip changed elsewhere. Reload it before saving edits.",
        );
      }
      await this.database.query(
        "DELETE FROM clip_candidate_tags WHERE clip_id = $1",
        [clipId],
      );
      for (const tagName of uniqueTagNames(input.tags)) {
        const tagResult = await this.database.query<DbRow>(
          `INSERT INTO clip_tags
             (id, project_id, name, normalized_name, created_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (project_id, normalized_name) DO UPDATE
           SET normalized_name = EXCLUDED.normalized_name
           RETURNING id`,
          [randomUUID(), projectId, tagName, normalizeTagName(tagName), now],
        );
        await this.database.query(
          `INSERT INTO clip_candidate_tags (clip_id, tag_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [clipId, tagResult.rows[0]!.id],
        );
      }
      await this.database.query(
        `INSERT INTO sync_events
           (project_id, event_type, entity_id, server_version, payload, created_at)
         VALUES ($1, 'clip_candidate.updated', $2, $3, $4, $5)`,
        [
          projectId,
          clipId,
          updated.rows[0]!.version,
          JSON.stringify({ clipId, fields: ["notes", "tags"] }),
          now,
        ],
      );
    });
    return this.getClipCandidate(actor, projectId, clipId);
  }

  async listProjectClipTags(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<string[]> {
    await this.authorize(actor, projectId, "read");
    const result = await this.database.query<{ name: string }>(
      `SELECT name FROM clip_tags
       WHERE project_id = $1
       ORDER BY normalized_name, id
       LIMIT 500`,
      [projectId],
    );
    return result.rows.map((row) => row.name);
  }

  async createClipExport(
    actor: AuthenticatedActor,
    projectId: string,
    clipId: string,
    input: CreateClipExportRequest,
  ): Promise<ExportRequest> {
    await this.authorize(actor, projectId, "write");
    const clip = await this.getClipCandidate(actor, projectId, clipId);
    const idempotencyKey = `clip-export:${clipId}:${input.idempotencyKey}`;
    const existing = await this.database.query<DbRow>(
      `${loggedExportRequestSelect}
       WHERE j.idempotency_key = $1 AND er.project_id = $2`,
      [idempotencyKey, projectId],
    );
    if (existing.rows[0]) return mapLoggedExportRequest(existing.rows[0]);

    const requestId = randomUUID();
    const jobId = randomUUID();
    const now = this.now().toISOString();
    const payload = {
      exportRequestId: requestId,
      mode: "logged",
      clipId,
      video: clip.video,
      selection: clip.selection,
      sourceLanguageClass: input.sourceLanguageClass,
      ...(input.subtitleTracks ? { subtitleTracks: input.subtitleTracks } : {}),
      preset: input.preset,
    };
    await this.transaction(async () => {
      await this.database.query(
        `INSERT INTO jobs
           (id, project_id, kind, state, idempotency_key, attempt, payload,
            created_at, updated_at)
         VALUES ($1, $2, 'export', 'queued', $3, 0, $4, $5, $5)`,
        [jobId, projectId, idempotencyKey, JSON.stringify(payload), now],
      );
      await this.database.query(
        `INSERT INTO export_requests
            (id, job_id, clip_id, project_id, mode, video_snapshot,
            selection_snapshot, source_language_class, subtitle_tracks_snapshot, preset_snapshot,
            requested_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'logged', $5, $6, $7, $8, $9, $10, $11, $11)`,
        [
          requestId,
          jobId,
          clipId,
          projectId,
          JSON.stringify(clip.video),
          JSON.stringify(clip.selection),
          input.sourceLanguageClass,
          input.subtitleTracks ? JSON.stringify(input.subtitleTracks) : null,
          JSON.stringify(input.preset),
          actor.userId,
          now,
        ],
      );
      await this.database.query(
        `UPDATE clip_candidates
         SET export_status = 'queued', version = version + 1, updated_at = $1
         WHERE id = $2 AND project_id = $3`,
        [now, clipId, projectId],
      );
      await this.database.query(
        `INSERT INTO sync_events
           (project_id, event_type, entity_id, server_version, payload, created_at)
         VALUES ($1, 'clip_candidate.export_queued', $2,
                 (SELECT version FROM clip_candidates WHERE id = $2), $3, $4)`,
        [
          projectId,
          clipId,
          JSON.stringify({ clipId, exportRequestId: requestId, jobId }),
          now,
        ],
      );
    });
    return this.getLoggedExportRequest(actor, projectId, requestId);
  }

  async getLoggedExportRequest(
    actor: AuthenticatedActor,
    projectId: string,
    requestId: string,
  ): Promise<ExportRequest> {
    await this.authorize(actor, projectId, "read");
    const result = await this.database.query<DbRow>(
      `${loggedExportRequestSelect}
       WHERE er.id = $1 AND er.project_id = $2`,
      [requestId, projectId],
    );
    if (!result.rows[0])
      throw new CatalogNotFoundError("Export request not found.");
    return mapLoggedExportRequest(result.rows[0]);
  }

  async getProject(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<Project> {
    await this.authorize(actor, projectId, "read");
    const result = await this.database.query<DbRow>(
      `SELECT id, name, description, version, created_at, updated_at
       FROM projects WHERE id = $1`,
      [projectId],
    );
    if (!result.rows[0]) throw new CatalogNotFoundError("Project not found.");
    return mapProject(result.rows[0]);
  }

  async addMember(
    actor: AuthenticatedActor,
    projectId: string,
    userId: string,
    role: Exclude<ProjectRole, "owner">,
  ): Promise<void> {
    await this.authorize(actor, projectId, "manage_members");
    const target = await this.database.query(
      "SELECT id FROM users WHERE id = $1",
      [userId],
    );
    if (!target.rows[0]) throw new CatalogNotFoundError("User not found.");
    const now = this.now().toISOString();
    await this.database.query(
      `INSERT INTO project_members
         (project_id, user_id, role, version, created_at, updated_at)
       VALUES ($1, $2, $3, 1, $4, $4)
       ON CONFLICT (project_id, user_id) DO UPDATE
       SET role = EXCLUDED.role,
           version = project_members.version + 1,
           updated_at = EXCLUDED.updated_at`,
      [projectId, userId, role, now],
    );
  }

  async addVideo(
    actor: AuthenticatedActor,
    projectId: string,
    input: {
      youtubeVideoId: string;
      canonicalUrl: string;
      title: string;
      channel?: string;
      durationMs?: number;
      sourceLanguage?: string;
    },
  ): Promise<Video> {
    await this.authorize(actor, projectId, "write");
    const existing = await this.database.query<DbRow>(
      "SELECT id FROM videos WHERE youtube_video_id = $1",
      [input.youtubeVideoId],
    );
    const id = String(existing.rows[0]?.id ?? randomUUID());
    const now = this.now().toISOString();
    await this.transaction(async () => {
      await this.database.query(
        `INSERT INTO videos
           (id, youtube_video_id, canonical_url, title, channel, duration_ms,
            source_language, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
         ON CONFLICT (youtube_video_id) DO UPDATE
         SET canonical_url = EXCLUDED.canonical_url,
             title = EXCLUDED.title,
             channel = EXCLUDED.channel,
             duration_ms = EXCLUDED.duration_ms,
             source_language = EXCLUDED.source_language,
             updated_at = EXCLUDED.updated_at`,
        [
          id,
          input.youtubeVideoId,
          input.canonicalUrl,
          input.title.trim(),
          input.channel?.trim() ?? null,
          input.durationMs ?? null,
          input.sourceLanguage ?? null,
          now,
        ],
      );
      await this.database.query(
        `INSERT INTO project_videos
           (project_id, video_id, version, created_at, updated_at)
         VALUES ($1, $2, 1, $3, $3)
         ON CONFLICT (project_id, video_id) DO NOTHING`,
        [projectId, id, now],
      );
    });
    const result = await this.database.query<DbRow>(
      `SELECT id, youtube_video_id, canonical_url, title, channel, duration_ms,
              source_language, created_at, updated_at
       FROM videos WHERE id = $1`,
      [id],
    );
    return mapVideo(result.rows[0]);
  }

  async listVideos(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<Video[]> {
    await this.authorize(actor, projectId, "read");
    const result = await this.database.query<DbRow>(
      `SELECT v.id, v.youtube_video_id, v.canonical_url, v.title, v.channel,
              v.duration_ms, v.source_language, v.created_at, v.updated_at
       FROM project_videos pv
       JOIN videos v ON v.id = pv.video_id
       WHERE pv.project_id = $1
       ORDER BY pv.updated_at DESC, v.id`,
      [projectId],
    );
    return result.rows.map(mapVideo);
  }

  async findProjectVideoTranscriptStates(
    actor: AuthenticatedActor,
    projectId: string,
    youtubeVideoIds: readonly string[],
  ): Promise<Map<string, ProjectVideoTranscriptState>> {
    await this.authorize(actor, projectId, "read");
    const states = new Map<string, ProjectVideoTranscriptState>();
    for (const youtubeVideoId of new Set(youtubeVideoIds)) {
      const result = await this.database.query<DbRow>(
        `SELECT v.id, v.canonical_url, v.title, v.channel, v.duration_ms,
                v.source_language, pv.active_transcript_version_id
         FROM project_videos pv
         JOIN videos v ON v.id = pv.video_id
         WHERE pv.project_id = $1 AND v.youtube_video_id = $2`,
        [projectId, youtubeVideoId],
      );
      const row = result.rows[0];
      if (row) {
        states.set(youtubeVideoId, {
          catalogVideoId: String(row.id),
          canonicalUrl: String(row.canonical_url),
          title: String(row.title),
          ...(row.channel === null ? {} : { channel: String(row.channel) }),
          ...(row.duration_ms === null
            ? {}
            : { durationMs: Number(row.duration_ms) }),
          ...(row.source_language === null
            ? {}
            : { sourceLanguage: String(row.source_language) }),
          ...(row.active_transcript_version_id === null
            ? {}
            : {
                activeTranscriptVersionId: String(
                  row.active_transcript_version_id,
                ),
              }),
        });
      }
    }
    return states;
  }

  async createTranscriptionBatch(
    actor: AuthenticatedActor,
    input: CreateTranscriptionBatchInput,
  ): Promise<CreateTranscriptionBatchResponse> {
    await this.authorize(actor, input.projectId, "write");
    const batchId = randomUUID();
    const createdAt = this.now().toISOString();
    await this.transaction(async () => {
      await this.database.query(
        `INSERT INTO transcription_batches
           (id, project_id, name, target_language, execution_location,
            transcription_profile, source_policy, priority, created_by,
            version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10, $10)`,
        [
          batchId,
          input.projectId,
          input.name.trim(),
          input.options.targetLanguage,
          input.options.executionLocation,
          input.options.transcriptionProfile,
          input.options.sourcePolicy,
          input.options.priority,
          actor.userId,
          createdAt,
        ],
      );

      for (const item of input.items) {
        let catalogVideoId = item.catalogVideoId;
        if (
          item.youtubeVideoId &&
          item.canonicalUrl &&
          item.title &&
          ["ready", "existing-transcript"].includes(item.status)
        ) {
          catalogVideoId = await this.upsertProjectVideo(
            input.projectId,
            item,
            createdAt,
          );
        }

        let persistedItem = item;
        if (
          item.status === "ready" &&
          catalogVideoId &&
          input.options.sourcePolicy !== "force-generate"
        ) {
          const active = await this.database.query<DbRow>(
            `SELECT active_transcript_version_id
             FROM project_videos
             WHERE project_id = $1 AND video_id = $2`,
            [input.projectId, catalogVideoId],
          );
          const activeTranscriptVersionId =
            active.rows[0]?.active_transcript_version_id;
          if (activeTranscriptVersionId) {
            persistedItem = {
              ...item,
              status: "existing-transcript",
              processingNeed: "reuse-shared",
              catalogVideoId,
              activeTranscriptVersionId: String(activeTranscriptVersionId),
            };
          }
        }

        let jobId: string | undefined;
        let idempotencyKey: string | undefined;
        let state: "queued" | "ready_for_review" | "blocked" | "canceled";
        if (persistedItem.status === "ready" && catalogVideoId) {
          idempotencyKey = [
            "transcription",
            input.projectId,
            catalogVideoId,
            input.options.transcriptionProfile,
            input.options.targetLanguage,
            input.options.sourcePolicy,
            "schema-1",
          ].join(":");
          const existingJob = await this.database.query<DbRow>(
            "SELECT id FROM jobs WHERE idempotency_key = $1",
            [idempotencyKey],
          );
          jobId = String(existingJob.rows[0]?.id ?? randomUUID());
          if (!existingJob.rows[0]) {
            await this.database.query(
              `INSERT INTO jobs
                 (id, project_id, kind, state, idempotency_key, attempt,
                  payload, created_at, updated_at)
               VALUES ($1, $2, 'transcription', 'queued', $3, 0, $4, $5, $5)`,
              [
                jobId,
                input.projectId,
                idempotencyKey,
                JSON.stringify({
                  batchId,
                  catalogVideoId,
                  youtubeVideoId: persistedItem.youtubeVideoId,
                  targetLanguage: input.options.targetLanguage,
                  transcriptionProfile: input.options.transcriptionProfile,
                  sourcePolicy: input.options.sourcePolicy,
                  executionLocation: input.options.executionLocation,
                  priority: input.options.priority,
                }),
                createdAt,
              ],
            );
          }
          state = "queued";
        } else if (persistedItem.status === "existing-transcript") {
          state = "ready_for_review";
        } else if (persistedItem.status === "duplicate") {
          state = "canceled";
        } else {
          state = "blocked";
        }

        await this.database.query(
          `INSERT INTO transcription_batch_items
             (id, batch_id, input_index, raw_input, youtube_video_id,
              canonical_url, catalog_video_id, active_transcript_version_id,
              title, channel, duration_ms, source_language, preflight_status,
              processing_need, duplicate_of_input_index, state, review_status,
              job_id, idempotency_key, error_code, error_message, attempt,
              version, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                   $13, $14, $15, $16, 'unreviewed', $17, $18, $19, $20,
                   0, 1, $21, $21)`,
          [
            randomUUID(),
            batchId,
            persistedItem.inputIndex,
            persistedItem.input,
            persistedItem.youtubeVideoId ?? null,
            persistedItem.canonicalUrl ?? null,
            catalogVideoId ?? null,
            persistedItem.activeTranscriptVersionId ?? null,
            persistedItem.title ?? null,
            persistedItem.channel ?? null,
            persistedItem.durationMs ?? null,
            persistedItem.sourceLanguage ?? null,
            persistedItem.status,
            persistedItem.processingNeed,
            persistedItem.duplicateOfInputIndex ?? null,
            state,
            jobId ?? null,
            idempotencyKey ?? null,
            persistedItem.error?.code ?? null,
            persistedItem.error?.message ?? null,
            createdAt,
          ],
        );
      }
    });
    return this.getTranscriptionBatch(actor, input.projectId, batchId);
  }

  async getTranscriptionBatch(
    actor: AuthenticatedActor,
    projectId: string,
    batchId: string,
  ): Promise<CreateTranscriptionBatchResponse> {
    await this.authorize(actor, projectId, "read");
    const batchResult = await this.database.query<DbRow>(
      "SELECT * FROM transcription_batches WHERE id = $1 AND project_id = $2",
      [batchId, projectId],
    );
    const batch = batchResult.rows[0];
    if (!batch)
      throw new CatalogNotFoundError("Transcription batch not found.");
    const itemResult = await this.database.query<DbRow>(
      `SELECT * FROM transcription_batch_items
       WHERE batch_id = $1 ORDER BY input_index`,
      [batchId],
    );
    const items = itemResult.rows.map(mapBatchItem);
    return CreateTranscriptionBatchResponseSchema.parse({
      batch: {
        id: batch.id,
        projectId: batch.project_id,
        name: batch.name,
        targetLanguage: batch.target_language,
        transcriptionProfile: batch.transcription_profile,
        sourcePolicy: batch.source_policy,
        executionLocation: batch.execution_location,
        priority: batch.priority,
        dispatchStatus: batch.dispatch_status,
        createdBy: batch.created_by,
        version: batch.version,
        createdAt: iso(batch.created_at),
        updatedAt: iso(batch.updated_at),
      },
      items,
      summary: summarizePreflight(items),
      progress: summarizeProgress(items),
    });
  }

  async listTranscriptionBatches(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<TranscriptionBatchListResponse> {
    await this.authorize(actor, projectId, "read");
    const result = await this.database.query<DbRow>(
      `SELECT id
       FROM transcription_batches
       WHERE project_id = $1
       ORDER BY updated_at DESC, id DESC
       LIMIT 200`,
      [projectId],
    );
    const batches = await Promise.all(
      result.rows.map(async (row) => {
        const response = await this.getTranscriptionBatch(
          actor,
          projectId,
          String(row.id),
        );
        return { batch: response.batch, progress: response.progress };
      }),
    );
    return TranscriptionBatchListResponseSchema.parse({ batches });
  }

  async listReviewInbox(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<ReviewInboxResponse> {
    await this.authorize(actor, projectId, "read");
    const result = await this.database.query<DbRow>(
      `SELECT bi.*, b.name AS batch_name
       FROM transcription_batch_items bi
       JOIN transcription_batches b ON b.id = bi.batch_id
       WHERE b.project_id = $1 AND bi.state = 'ready_for_review'
       ORDER BY
         CASE bi.review_status
           WHEN 'unreviewed' THEN 0
           WHEN 'reviewing' THEN 1
           WHEN 'reviewed' THEN 2
           ELSE 3
         END,
         bi.updated_at DESC,
         bi.id DESC
       LIMIT 500`,
      [projectId],
    );
    return ReviewInboxResponseSchema.parse({
      items: result.rows.map(mapReviewInboxItem),
    });
  }

  async updateReviewStatus(
    actor: AuthenticatedActor,
    projectId: string,
    itemId: string,
    command: UpdateReviewStatusRequest,
  ): Promise<ReviewInboxItem> {
    await this.authorize(actor, projectId, "write");
    const updatedAt = this.now().toISOString();
    let updated: DbRow | undefined;
    await this.transaction(async () => {
      const selected = await this.database.query<DbRow>(
        `SELECT bi.*, b.name AS batch_name
         FROM transcription_batch_items bi
         JOIN transcription_batches b ON b.id = bi.batch_id
         WHERE bi.id = $1 AND b.project_id = $2
         FOR UPDATE OF bi`,
        [itemId, projectId],
      );
      const item = selected.rows[0];
      if (!item) throw new CatalogNotFoundError("Review item not found.");
      if (item.state !== "ready_for_review") {
        throw new CatalogConflictError(
          "Only ready items can change review status.",
        );
      }
      if (Number(item.version) !== command.expectedVersion) {
        throw new CatalogConflictError(
          "The review item changed; reload it before trying again.",
        );
      }
      const result = await this.database.query<DbRow>(
        `UPDATE transcription_batch_items
         SET review_status = $1, version = version + 1, updated_at = $2
         WHERE id = $3
         RETURNING *`,
        [command.reviewStatus, updatedAt, itemId],
      );
      updated = { ...result.rows[0], batch_name: item.batch_name };
    });
    return mapReviewInboxItem(updated!);
  }

  async controlTranscriptionBatch(
    actor: AuthenticatedActor,
    projectId: string,
    batchId: string,
    command: TranscriptionBatchControlRequest,
  ): Promise<CreateTranscriptionBatchResponse> {
    await this.authorize(actor, projectId, "write");
    const updatedAt = this.now().toISOString();
    await this.transaction(async () => {
      const result = await this.database.query<DbRow>(
        `SELECT id, dispatch_status, version
         FROM transcription_batches
         WHERE id = $1 AND project_id = $2
         FOR UPDATE`,
        [batchId, projectId],
      );
      const batch = result.rows[0];
      if (!batch) {
        throw new CatalogNotFoundError("Transcription batch not found.");
      }
      if (Number(batch.version) !== command.expectedVersion) {
        throw new CatalogConflictError(
          "The transcription batch changed; reload it before trying again.",
        );
      }
      if (
        batch.dispatch_status === "canceled" &&
        command.action !== "cancel_unstarted"
      ) {
        throw new CatalogConflictError(
          "Canceled batch dispatch cannot be resumed or retried.",
        );
      }

      let dispatchStatus = String(batch.dispatch_status);
      if (command.action === "pause_pending") {
        dispatchStatus = "paused";
      } else if (command.action === "resume") {
        dispatchStatus = "active";
      } else if (command.action === "cancel_unstarted") {
        dispatchStatus = "canceled";
        await this.database.query(
          `UPDATE transcription_batch_items
           SET state = 'canceled', version = version + 1, updated_at = $1
           WHERE batch_id = $2 AND state = 'queued'`,
          [updatedAt, batchId],
        );
        await this.database.query(
          `UPDATE jobs j
           SET state = 'canceled', updated_at = $1
           WHERE j.project_id = $2 AND j.kind = 'transcription'
             AND j.state = 'queued'
             AND NOT EXISTS (
               SELECT 1
               FROM transcription_batch_items bi
               JOIN transcription_batches b ON b.id = bi.batch_id
               WHERE bi.job_id = j.id
                 AND b.dispatch_status = 'active'
                 AND bi.state IN (
                   'queued', 'resolving', 'acquiring', 'transcribing',
                   'translating', 'aligning', 'uploading'
                 )
             )`,
          [updatedAt, projectId],
        );
      } else if (command.action === "retry_failed") {
        dispatchStatus = "active";
        const retryJobs = await this.database.query<DbRow>(
          `SELECT DISTINCT job_id
           FROM transcription_batch_items
           WHERE batch_id = $1 AND state = 'failed'
             AND error_retryable = true AND job_id IS NOT NULL`,
          [batchId],
        );
        for (const row of retryJobs.rows) {
          await this.database.query(
            `UPDATE jobs
             SET state = 'queued', payload = payload - 'lastError',
                 updated_at = $1
             WHERE id = $2 AND state = 'failed'`,
            [updatedAt, row.job_id],
          );
        }
        await this.database.query(
          `UPDATE transcription_batch_items
           SET state = 'queued', error_code = NULL, error_message = NULL,
               error_retryable = NULL, version = version + 1,
               updated_at = $1
           WHERE batch_id = $2 AND state = 'failed'
             AND error_retryable = true`,
          [updatedAt, batchId],
        );
      }

      await this.database.query(
        `UPDATE transcription_batches
         SET dispatch_status = $1, version = version + 1, updated_at = $2
         WHERE id = $3`,
        [dispatchStatus, updatedAt, batchId],
      );
    });
    return this.getTranscriptionBatch(actor, projectId, batchId);
  }

  async claimTranscriptionJob(
    actor: AuthenticatedActor,
    executionLocation: "local" | "hosted",
    leaseSeconds: number,
  ): Promise<ClaimedTranscriptionJob | undefined> {
    await this.requireRegistered(actor);
    const claimedAt = this.now();
    const expiresAt = new Date(claimedAt.getTime() + leaseSeconds * 1_000);
    await this.database.exec("BEGIN");
    try {
      const candidate = await this.database.query<DbRow>(
        `SELECT j.*
         FROM jobs j
         JOIN project_members pm
           ON pm.project_id = j.project_id AND pm.user_id = $1
         LEFT JOIN worker_leases wl ON wl.job_id = j.id
         WHERE j.kind = 'transcription'
           AND pm.role IN ('owner', 'editor', 'researcher')
           AND j.payload->>'executionLocation' = $2
           AND EXISTS (
             SELECT 1
             FROM transcription_batch_items bi
             JOIN transcription_batches b ON b.id = bi.batch_id
             WHERE bi.job_id = j.id
               AND (
                 (b.dispatch_status = 'active' AND bi.state = 'queued')
                 OR bi.state IN (
                   'resolving', 'acquiring', 'transcribing', 'translating',
                   'aligning', 'uploading'
                 )
               )
           )
           AND (
             j.state = 'queued'
             OR (j.state IN ('claimed', 'processing') AND wl.expires_at <= $3)
           )
         ORDER BY
           CASE j.payload->>'priority'
             WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2
           END,
           j.created_at,
           j.id
         LIMIT 1
         FOR UPDATE OF j SKIP LOCKED`,
        [actor.userId, executionLocation, claimedAt.toISOString()],
      );
      const row = candidate.rows[0];
      if (!row) {
        await this.database.exec("COMMIT");
        return undefined;
      }
      const attempt = Number(row.attempt) + 1;
      await this.database.query(
        `UPDATE jobs
         SET state = 'claimed', attempt = $1, updated_at = $2
         WHERE id = $3`,
        [attempt, claimedAt.toISOString(), row.id],
      );
      await this.database.query(
        `INSERT INTO worker_leases
           (job_id, worker_id, attempt, claimed_at, heartbeat_at, expires_at)
         VALUES ($1, $2, $3, $4, $4, $5)
         ON CONFLICT (job_id) DO UPDATE
         SET worker_id = EXCLUDED.worker_id,
             attempt = EXCLUDED.attempt,
             claimed_at = EXCLUDED.claimed_at,
             heartbeat_at = EXCLUDED.heartbeat_at,
             expires_at = EXCLUDED.expires_at`,
        [
          row.id,
          actor.userId,
          attempt,
          claimedAt.toISOString(),
          expiresAt.toISOString(),
        ],
      );
      await this.database.query(
        `UPDATE transcription_batch_items
         SET state = 'resolving', attempt = $1, version = version + 1,
             updated_at = $2
         WHERE job_id = $3 AND state NOT IN ('ready_for_review', 'canceled')`,
        [attempt, claimedAt.toISOString(), row.id],
      );
      await this.database.exec("COMMIT");
      return ClaimedTranscriptionJobSchema.parse({
        job: mapJob({
          ...row,
          state: "claimed",
          attempt,
          updated_at: claimedAt.toISOString(),
        }),
        lease: {
          jobId: row.id,
          workerId: actor.userId,
          attempt,
          claimedAt: claimedAt.toISOString(),
          heartbeatAt: claimedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        },
      });
    } catch (error) {
      await this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async heartbeatTranscriptionJob(
    actor: AuthenticatedActor,
    jobId: string,
    attempt: number,
    leaseSeconds: number,
    stage: WorkerProgressStage,
  ): Promise<WorkerLease> {
    const lease = await this.requireActiveWorkerLease(actor, jobId, attempt);
    const heartbeatAt = this.now();
    const expiresAt = new Date(heartbeatAt.getTime() + leaseSeconds * 1_000);
    await this.transaction(async () => {
      await this.database.query(
        `UPDATE worker_leases
         SET heartbeat_at = $1, expires_at = $2
         WHERE job_id = $3 AND worker_id = $4 AND attempt = $5`,
        [
          heartbeatAt.toISOString(),
          expiresAt.toISOString(),
          jobId,
          actor.userId,
          attempt,
        ],
      );
      await this.database.query(
        "UPDATE jobs SET state = 'processing', updated_at = $1 WHERE id = $2",
        [heartbeatAt.toISOString(), jobId],
      );
      await this.database.query(
        `UPDATE transcription_batch_items
         SET state = $1, version = version + 1, updated_at = $2
         WHERE job_id = $3 AND attempt = $4`,
        [stage, heartbeatAt.toISOString(), jobId, attempt],
      );
    });
    return WorkerLeaseSchema.parse({
      jobId,
      workerId: actor.userId,
      attempt,
      claimedAt: iso(lease.claimed_at),
      heartbeatAt: heartbeatAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
  }

  async recordTranscriptSourcePlan(
    actor: AuthenticatedActor,
    jobId: string,
    attempt: number,
    plan: TranscriptSourcePlan,
  ): Promise<void> {
    await this.requireActiveWorkerLease(actor, jobId, attempt);
    const resolvedAt = this.now().toISOString();
    const encoded = JSON.stringify(plan);
    await this.transaction(async () => {
      await this.database.query(
        `UPDATE jobs
         SET payload = payload || jsonb_build_object('sourcePlan', $1::jsonb),
             state = 'processing', updated_at = $2
         WHERE id = $3`,
        [encoded, resolvedAt, jobId],
      );
      await this.database.query(
        `UPDATE transcription_batch_items
         SET source_plan = $1::jsonb, source_resolved_at = $2,
             version = version + 1, updated_at = $2
         WHERE job_id = $3 AND attempt = $4`,
        [encoded, resolvedAt, jobId, attempt],
      );
    });
  }

  async failTranscriptionJob(
    actor: AuthenticatedActor,
    jobId: string,
    failure: WorkerFailureRequest,
  ): Promise<void> {
    await this.requireActiveWorkerLease(actor, jobId, failure.attempt);
    const failedAt = this.now().toISOString();
    const lastError = JSON.stringify({
      code: failure.code,
      message: failure.message,
      retryable: failure.retryable,
      failedAt,
      attempt: failure.attempt,
    });
    await this.transaction(async () => {
      await this.database.query(
        `UPDATE jobs
         SET state = 'failed',
             payload = payload || jsonb_build_object('lastError', $1::jsonb),
             updated_at = $2
         WHERE id = $3`,
        [lastError, failedAt, jobId],
      );
      await this.database.query(
        `UPDATE transcription_batch_items
         SET state = 'failed', error_code = $1, error_message = $2,
             error_retryable = $3, version = version + 1, updated_at = $4
         WHERE job_id = $5 AND attempt = $6
           AND state NOT IN ('ready_for_review', 'canceled')`,
        [
          failure.code,
          failure.message,
          failure.retryable,
          failedAt,
          jobId,
          failure.attempt,
        ],
      );
      await this.database.query(
        `DELETE FROM worker_leases
         WHERE job_id = $1 AND worker_id = $2 AND attempt = $3`,
        [jobId, actor.userId, failure.attempt],
      );
    });
  }

  async createTranscriptUpload(
    actor: AuthenticatedActor,
    input: CreateTranscriptUploadInput,
  ): Promise<TranscriptUploadGrant> {
    await this.authorize(actor, input.projectId, "write");
    await this.requireProjectVideo(input.projectId, input.catalogVideoId);
    const artifactTypes = [...new Set(input.artifactTypes)];
    if (
      artifactTypes.length === 0 ||
      artifactTypes.length !== input.artifactTypes.length
    ) {
      throw new CatalogConflictError(
        "Artifact types must be non-empty and unique.",
      );
    }
    const uploadId = randomUUID();
    const jobId = randomUUID();
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + 15 * 60 * 1000);
    const allTypes: ArtifactType[] = ["manifest", ...artifactTypes];
    const prefix = `projects/${input.projectId}/videos/${input.catalogVideoId}/transcripts/${input.lineageId}/v${input.version}/${uploadId}`;
    const targets = await Promise.all(
      allTypes.map(async (type) => {
        const objectKey = `${prefix}/${type}.json`;
        return {
          type,
          objectKey,
          uploadUrl: await this.uploadUrlIssuer.issuePutUrl({
            objectKey,
            expiresInSeconds: 15 * 60,
          }),
        };
      }),
    );

    await this.transaction(async () => {
      await this.database.query(
        `INSERT INTO jobs
           (id, project_id, kind, state, idempotency_key, attempt, payload, created_at, updated_at)
         VALUES ($1, $2, 'transcription', 'processing', $3, 0, $4, $5, $5)`,
        [
          jobId,
          input.projectId,
          `transcript-upload:${uploadId}`,
          JSON.stringify(input),
          createdAt.toISOString(),
        ],
      );
      await this.database.query(
        `INSERT INTO transcript_uploads
           (id, job_id, project_id, video_id, lineage_id, version, state,
            expires_at, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'staged', $7, $8, $9)`,
        [
          uploadId,
          jobId,
          input.projectId,
          input.catalogVideoId,
          input.lineageId,
          input.version,
          expiresAt.toISOString(),
          actor.userId,
          createdAt.toISOString(),
        ],
      );
      for (const target of targets) {
        await this.database.query(
          `INSERT INTO transcript_upload_targets
             (upload_id, artifact_type, object_key)
           VALUES ($1, $2, $3)`,
          [uploadId, target.type, target.objectKey],
        );
      }
    });
    return TranscriptUploadGrantSchema.parse({
      uploadId,
      jobId,
      projectId: input.projectId,
      catalogVideoId: input.catalogVideoId,
      lineageId: input.lineageId,
      version: input.version,
      expiresAt: expiresAt.toISOString(),
      targets,
    });
  }

  async createClaimedTranscriptUpload(
    actor: AuthenticatedActor,
    jobId: string,
    attempt: number,
    input: CreateClaimedTranscriptUploadInput,
  ): Promise<TranscriptUploadGrant> {
    await this.requireActiveWorkerLease(actor, jobId, attempt);
    const jobResult = await this.database.query<DbRow>(
      "SELECT project_id, payload FROM jobs WHERE id = $1 AND kind = 'transcription'",
      [jobId],
    );
    const job = jobResult.rows[0];
    if (!job) throw new CatalogNotFoundError("Transcription job not found.");
    const payload =
      typeof job.payload === "string" ? JSON.parse(job.payload) : job.payload;
    const catalogVideoId = String(
      (payload as Record<string, unknown>).catalogVideoId ?? "",
    );
    const projectId = String(job.project_id ?? "");
    await this.authorize(actor, projectId, "write");
    await this.requireProjectVideo(projectId, catalogVideoId);
    const artifactTypes = [...new Set(input.artifactTypes)];
    if (
      artifactTypes.length === 0 ||
      artifactTypes.length !== input.artifactTypes.length
    ) {
      throw new CatalogConflictError(
        "Artifact types must be non-empty and unique.",
      );
    }

    const existingResult = await this.database.query<DbRow>(
      "SELECT * FROM transcript_uploads WHERE job_id = $1",
      [jobId],
    );
    const existing = existingResult.rows[0];
    const expiresAt = new Date(this.now().getTime() + 15 * 60 * 1_000);
    if (existing) {
      if (String(existing.state) === "finalized") {
        throw new CatalogConflictError(
          "The claimed transcription job is already finalized.",
        );
      }
      if (
        String(existing.project_id) !== projectId ||
        String(existing.video_id) !== catalogVideoId ||
        String(existing.lineage_id) !== input.lineageId ||
        Number(existing.version) !== input.version
      ) {
        throw new CatalogConflictError(
          "The claimed job already has a different transcript upload.",
        );
      }
      const targets = await this.loadTargets(String(existing.id));
      const expectedTypes = new Set(["manifest", ...artifactTypes]);
      if (
        targets.size !== expectedTypes.size ||
        [...targets.keys()].some((type) => !expectedTypes.has(type))
      ) {
        throw new CatalogConflictError(
          "The claimed job already has different artifact targets.",
        );
      }
      await this.database.query(
        "UPDATE transcript_uploads SET state = 'staged', expires_at = $1 WHERE id = $2",
        [expiresAt.toISOString(), existing.id],
      );
      return TranscriptUploadGrantSchema.parse({
        uploadId: existing.id,
        jobId,
        projectId,
        catalogVideoId,
        lineageId: input.lineageId,
        version: input.version,
        expiresAt: expiresAt.toISOString(),
        targets: await Promise.all(
          [...targets].map(async ([type, objectKey]) => ({
            type,
            objectKey,
            uploadUrl: await this.uploadUrlIssuer.issuePutUrl({
              objectKey,
              expiresInSeconds: 15 * 60,
            }),
          })),
        ),
      });
    }

    const uploadId = randomUUID();
    const createdAt = this.now();
    const allTypes: ArtifactType[] = ["manifest", ...artifactTypes];
    const prefix = `projects/${projectId}/videos/${catalogVideoId}/transcripts/${input.lineageId}/v${input.version}/${uploadId}`;
    const targets = await Promise.all(
      allTypes.map(async (type) => {
        const objectKey = `${prefix}/${type}.json`;
        return {
          type,
          objectKey,
          uploadUrl: await this.uploadUrlIssuer.issuePutUrl({
            objectKey,
            expiresInSeconds: 15 * 60,
          }),
        };
      }),
    );
    await this.transaction(async () => {
      await this.database.query(
        `INSERT INTO transcript_uploads
           (id, job_id, project_id, video_id, lineage_id, version, state,
            expires_at, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'staged', $7, $8, $9)`,
        [
          uploadId,
          jobId,
          projectId,
          catalogVideoId,
          input.lineageId,
          input.version,
          expiresAt.toISOString(),
          actor.userId,
          createdAt.toISOString(),
        ],
      );
      for (const target of targets) {
        await this.database.query(
          `INSERT INTO transcript_upload_targets
             (upload_id, artifact_type, object_key)
           VALUES ($1, $2, $3)`,
          [uploadId, target.type, target.objectKey],
        );
      }
    });
    return TranscriptUploadGrantSchema.parse({
      uploadId,
      jobId,
      projectId,
      catalogVideoId,
      lineageId: input.lineageId,
      version: input.version,
      expiresAt: expiresAt.toISOString(),
      targets,
    });
  }

  async finalizeTranscript(
    actor: AuthenticatedActor,
    request: FinalizeTranscriptRequest,
    claim?: { jobId: string; attempt: number },
  ): Promise<ActiveTranscriptBundle> {
    const upload = await this.loadUpload(request.uploadId);
    await this.authorize(actor, String(upload.project_id), "write");
    if (claim && String(upload.job_id) !== claim.jobId) {
      throw new CatalogConflictError(
        "Transcript upload does not belong to the claimed job.",
      );
    }
    if (String(upload.state) === "finalized") {
      return this.getActiveTranscript(
        actor,
        String(upload.project_id),
        String(upload.video_id),
      );
    }
    if (new Date(iso(upload.expires_at)).getTime() <= this.now().getTime()) {
      throw new CatalogConflictError("Transcript upload grant has expired.");
    }
    if (claim) {
      await this.requireActiveWorkerLease(actor, claim.jobId, claim.attempt);
    }

    const manifestBytes = await this.verifyObject(request.manifest);
    let manifestJson: unknown;
    try {
      manifestJson = JSON.parse(new TextDecoder().decode(manifestBytes));
    } catch {
      throw new TranscriptIntegrityError("Manifest is not valid JSON.");
    }
    const manifest = TranscriptManifestSchema.parse(manifestJson);
    this.assertManifestMatchesUpload(manifest, upload);

    const targets = await this.loadTargets(request.uploadId);
    const manifestTarget = targets.get("manifest");
    if (!manifestTarget || manifestTarget !== request.manifest.objectKey) {
      throw new TranscriptIntegrityError(
        "Manifest was uploaded outside its grant.",
      );
    }
    const seenTypes = new Set<string>();
    for (const artifact of manifest.artifacts) {
      if (seenTypes.has(artifact.type)) {
        throw new TranscriptIntegrityError(
          "Manifest contains duplicate artifact types.",
        );
      }
      seenTypes.add(artifact.type);
      if (
        artifact.type === "manifest" ||
        targets.get(artifact.type) !== artifact.objectKey
      ) {
        throw new TranscriptIntegrityError(
          "Manifest references an unauthorized object.",
        );
      }
      if (!artifact.objectVersionId) {
        throw new TranscriptIntegrityError(
          "Every artifact must pin an object version.",
        );
      }
      await this.verifyObject({
        ...artifact,
        objectVersionId: artifact.objectVersionId,
      });
    }
    const requiredTypes = [...targets.keys()].filter(
      (type) => type !== "manifest",
    );
    if (requiredTypes.some((type) => !seenTypes.has(type))) {
      throw new TranscriptIntegrityError(
        "Manifest does not include every granted artifact.",
      );
    }

    await this.transaction(async () => {
      if (claim) {
        const lease = await this.database.query<DbRow>(
          `SELECT 1 FROM worker_leases
           WHERE job_id = $1 AND worker_id = $2 AND attempt = $3
             AND expires_at > $4
           FOR UPDATE`,
          [claim.jobId, actor.userId, claim.attempt, this.now().toISOString()],
        );
        if (!lease.rows[0]) {
          throw new CatalogConflictError(
            "Worker lease is no longer active for this attempt.",
          );
        }
      }
      await this.database.query(
        `INSERT INTO transcript_versions
           (id, project_id, video_id, lineage_id, version, schema_version,
            source_language, target_language, timing_precision,
            manifest_object_key, manifest_object_version_id, manifest_sha256,
            idempotency_key, finalized_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          manifest.id,
          manifest.projectId,
          manifest.catalogVideoId,
          manifest.lineageId,
          manifest.version,
          manifest.schemaVersion,
          manifest.sourceLanguage,
          manifest.targetLanguage,
          manifest.timingPrecision,
          request.manifest.objectKey,
          request.manifest.objectVersionId,
          request.manifest.sha256,
          request.idempotencyKey,
          this.now().toISOString(),
          manifest.createdAt,
        ],
      );
      const artifacts = [request.manifest, ...manifest.artifacts];
      for (const artifact of artifacts) {
        await this.database.query(
          `INSERT INTO transcript_artifacts
             (transcript_version_id, artifact_type, object_key,
              object_version_id, byte_size, sha256)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            manifest.id,
            artifact.type,
            artifact.objectKey,
            artifact.objectVersionId,
            artifact.byteSize,
            artifact.sha256,
          ],
        );
      }
      await this.database.query(
        `UPDATE project_videos
         SET active_transcript_version_id = $1, version = version + 1,
             updated_at = $2
         WHERE project_id = $3 AND video_id = $4`,
        [
          manifest.id,
          this.now().toISOString(),
          manifest.projectId,
          manifest.catalogVideoId,
        ],
      );
      await this.database.query(
        "UPDATE transcript_uploads SET state = 'finalized' WHERE id = $1",
        [request.uploadId],
      );
      await this.database.query(
        "UPDATE jobs SET state = 'complete', updated_at = $1 WHERE id = $2",
        [this.now().toISOString(), upload.job_id],
      );
      if (claim) {
        await this.database.query(
          `UPDATE transcription_batch_items
           SET state = 'ready_for_review',
               active_transcript_version_id = $1,
               error_code = NULL, error_message = NULL,
               version = version + 1, updated_at = $2
           WHERE job_id = $3 AND attempt = $4 AND state <> 'canceled'`,
          [manifest.id, this.now().toISOString(), claim.jobId, claim.attempt],
        );
        await this.database.query(
          `DELETE FROM worker_leases
           WHERE job_id = $1 AND worker_id = $2 AND attempt = $3`,
          [claim.jobId, actor.userId, claim.attempt],
        );
      }
      await this.database.query(
        `INSERT INTO sync_events
           (project_id, event_type, entity_id, server_version, payload)
         VALUES ($1, 'transcript.activated', $2, 1, $3)`,
        [
          manifest.projectId,
          manifest.id,
          JSON.stringify({ videoId: manifest.catalogVideoId }),
        ],
      );
    });
    return this.getActiveTranscript(
      actor,
      manifest.projectId,
      manifest.catalogVideoId,
    );
  }

  async getActiveTranscript(
    actor: AuthenticatedActor,
    projectId: string,
    catalogVideoId: string,
  ): Promise<ActiveTranscriptBundle> {
    await this.authorize(actor, projectId, "read");
    const result = await this.database.query<DbRow>(
      `SELECT tv.id, tv.manifest_object_key, tv.manifest_object_version_id,
              tv.manifest_sha256, ta.byte_size
       FROM project_videos pv
       JOIN transcript_versions tv ON tv.id = pv.active_transcript_version_id
       JOIN transcript_artifacts ta
         ON ta.transcript_version_id = tv.id AND ta.artifact_type = 'manifest'
       WHERE pv.project_id = $1 AND pv.video_id = $2`,
      [projectId, catalogVideoId],
    );
    const row = result.rows[0];
    if (!row) throw new CatalogNotFoundError("No active transcript found.");
    const manifestObject = {
      type: "manifest" as const,
      objectKey: String(row.manifest_object_key),
      objectVersionId: String(row.manifest_object_version_id),
      byteSize: Number(row.byte_size),
      sha256: String(row.manifest_sha256),
    };
    const bytes = await this.verifyObject(manifestObject);
    const manifest = TranscriptManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    const descriptors = [manifestObject, ...manifest.artifacts].map(
      (artifact) => {
        if (!artifact.objectVersionId) {
          throw new TranscriptIntegrityError(
            "Active transcript artifact does not pin an object version.",
          );
        }
        return { ...artifact, objectVersionId: artifact.objectVersionId };
      },
    );
    const downloads = await Promise.all(
      descriptors.map(async (artifact) => ({
        ...artifact,
        downloadUrl: await this.uploadUrlIssuer.issueGetUrl({
          objectKey: artifact.objectKey,
          objectVersionId: artifact.objectVersionId,
          expiresInSeconds: 15 * 60,
        }),
      })),
    );
    return ActiveTranscriptBundleSchema.parse({
      transcriptVersionId: String(row.id),
      manifest,
      manifestObject,
      downloads,
    });
  }

  private async verifyObject(descriptor: {
    objectKey: string;
    objectVersionId: string;
    byteSize: number;
    sha256: string;
  }): Promise<Uint8Array> {
    const object = await this.store.get(
      descriptor.objectKey,
      descriptor.objectVersionId,
    );
    if (
      !object ||
      object.bytes.byteLength !== descriptor.byteSize ||
      sha256(object.bytes) !== descriptor.sha256
    ) {
      throw new TranscriptIntegrityError(
        `Object verification failed for ${descriptor.objectKey}.`,
      );
    }
    return object.bytes;
  }

  private assertManifestMatchesUpload(
    manifest: ReturnType<typeof TranscriptManifestSchema.parse>,
    upload: DbRow,
  ) {
    if (
      manifest.projectId !== String(upload.project_id) ||
      manifest.catalogVideoId !== String(upload.video_id) ||
      manifest.lineageId !== String(upload.lineage_id) ||
      manifest.version !== Number(upload.version) ||
      manifest.jobId !== String(upload.job_id) ||
      manifest.createdBy !== String(upload.created_by)
    ) {
      throw new TranscriptIntegrityError(
        "Manifest identity does not match its upload grant.",
      );
    }
  }

  private async loadUpload(uploadId: string): Promise<DbRow> {
    const result = await this.database.query<DbRow>(
      "SELECT * FROM transcript_uploads WHERE id = $1",
      [uploadId],
    );
    if (!result.rows[0]) throw new CatalogNotFoundError("Upload not found.");
    return result.rows[0];
  }

  private async loadTargets(uploadId: string): Promise<Map<string, string>> {
    const result = await this.database.query<DbRow>(
      "SELECT artifact_type, object_key FROM transcript_upload_targets WHERE upload_id = $1",
      [uploadId],
    );
    return new Map(
      result.rows.map((row) => [
        String(row.artifact_type),
        String(row.object_key),
      ]),
    );
  }

  private async requireProjectVideo(projectId: string, videoId: string) {
    const result = await this.database.query(
      "SELECT 1 FROM project_videos WHERE project_id = $1 AND video_id = $2",
      [projectId, videoId],
    );
    if (!result.rows[0])
      throw new CatalogNotFoundError("Project video not found.");
  }

  private async upsertProjectVideo(
    projectId: string,
    item: BatchPreflightItem,
    now: string,
  ): Promise<string> {
    const existing = await this.database.query<DbRow>(
      "SELECT id FROM videos WHERE youtube_video_id = $1",
      [item.youtubeVideoId],
    );
    const id = String(existing.rows[0]?.id ?? randomUUID());
    await this.database.query(
      `INSERT INTO videos
         (id, youtube_video_id, canonical_url, title, channel, duration_ms,
          source_language, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       ON CONFLICT (youtube_video_id) DO UPDATE
       SET canonical_url = EXCLUDED.canonical_url,
           title = EXCLUDED.title,
           channel = EXCLUDED.channel,
           duration_ms = EXCLUDED.duration_ms,
           source_language = EXCLUDED.source_language,
           updated_at = EXCLUDED.updated_at`,
      [
        id,
        item.youtubeVideoId,
        item.canonicalUrl,
        item.title,
        item.channel ?? null,
        item.durationMs ?? null,
        item.sourceLanguage ?? null,
        now,
      ],
    );
    await this.database.query(
      `INSERT INTO project_videos
         (project_id, video_id, version, created_at, updated_at)
       VALUES ($1, $2, 1, $3, $3)
       ON CONFLICT (project_id, video_id) DO NOTHING`,
      [projectId, id, now],
    );
    return id;
  }

  private async requireRegistered(actor: AuthenticatedActor) {
    const result = await this.database.query(
      "SELECT 1 FROM users WHERE id = $1 AND external_subject = $2",
      [actor.userId, actor.externalSubject],
    );
    if (!result.rows[0])
      throw new CatalogNotFoundError("User is not registered.");
  }

  private async loadClipTags(clipId: string): Promise<string[]> {
    const result = await this.database.query<{ name: string }>(
      `SELECT t.name
       FROM clip_candidate_tags ct
       JOIN clip_tags t ON t.id = ct.tag_id
       WHERE ct.clip_id = $1
       ORDER BY t.normalized_name, t.id`,
      [clipId],
    );
    return result.rows.map((row) => row.name);
  }

  private async requireActiveWorkerLease(
    actor: AuthenticatedActor,
    jobId: string,
    attempt: number,
  ): Promise<DbRow> {
    await this.requireRegistered(actor);
    const result = await this.database.query<DbRow>(
      "SELECT * FROM worker_leases WHERE job_id = $1",
      [jobId],
    );
    const lease = result.rows[0];
    if (!lease || String(lease.worker_id) !== actor.userId) {
      throw new AuthorizationError("This worker does not own the job lease.");
    }
    if (
      Number(lease.attempt) !== attempt ||
      new Date(iso(lease.expires_at)).getTime() <= this.now().getTime()
    ) {
      throw new CatalogConflictError("The worker lease is stale or expired.");
    }
    return lease;
  }

  private async authorize(
    actor: AuthenticatedActor,
    projectId: string,
    permission: "read" | "write" | "manage_members",
  ) {
    await this.requireRegistered(actor);
    const result = await this.database.query<{ role: ProjectRole }>(
      "SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2",
      [projectId, actor.userId],
    );
    requirePermission(result.rows[0]?.role, permission);
  }

  private async transaction(action: () => Promise<void>) {
    await this.database.exec("BEGIN");
    try {
      await action();
      await this.database.exec("COMMIT");
    } catch (error) {
      await this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function mapUser(row: DbRow | undefined): User {
  if (!row) throw new CatalogNotFoundError("User not found.");
  return UserSchema.parse({
    id: row.id,
    externalSubject: row.external_subject,
    displayName: row.display_name,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function mapProject(row: DbRow): Project {
  return ProjectSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    version: row.version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function mapClipCandidate(row: DbRow, tags: string[]): ClipCandidate {
  return ClipCandidateSchema.parse({
    id: row.id,
    projectId: row.project_id,
    catalogVideoId: row.video_id,
    video: {
      youtubeVideoId: row.youtube_video_id,
      canonicalUrl: row.canonical_url,
      title: row.video_title,
      ...(row.video_channel ? { channel: row.video_channel } : {}),
      ...(row.source_language ? { sourceLanguage: row.source_language } : {}),
    },
    selection: {
      trackId: row.transcript_track_id,
      transcriptVersion: Number(row.transcript_version),
      firstSegmentId: row.first_segment_id,
      lastSegmentId: row.last_segment_id,
      ...(row.first_token_id ? { firstTokenId: row.first_token_id } : {}),
      ...(row.last_token_id ? { lastTokenId: row.last_token_id } : {}),
      transcriptStartMs: Number(row.transcript_start_ms),
      transcriptEndMs: Number(row.transcript_end_ms),
      exportStartMs: Number(row.export_start_ms),
      exportEndMs: Number(row.export_end_ms),
      text: row.english_text,
      timingPrecision: row.timing_precision,
    },
    englishText: row.english_text,
    ...(row.original_text ? { originalText: row.original_text } : {}),
    notes: row.notes,
    tags,
    researchStatus: row.research_status,
    exportStatus: row.export_status,
    createdBy: row.created_by,
    version: Number(row.version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function mapLoggedExportRequest(row: DbRow): ExportRequest {
  return ExportRequestSchema.parse({
    id: row.id,
    jobId: row.job_id,
    mode: row.mode,
    projectId: row.project_id,
    clipId: row.clip_id,
    video: row.video_snapshot,
    selection: row.selection_snapshot,
    sourceLanguageClass: row.source_language_class,
    ...(row.subtitle_tracks_snapshot
      ? { subtitleTracks: row.subtitle_tracks_snapshot }
      : {}),
    preset: row.preset_snapshot,
    state: row.state,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function normalizeTagName(value: string) {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

function uniqueTagNames(values: readonly string[]) {
  const unique = new Map<string, string>();
  for (const value of values) {
    const normalized = normalizeTagName(value);
    if (!unique.has(normalized)) unique.set(normalized, value.trim());
  }
  return [...unique.values()];
}

function csvRow(values: readonly (string | number)[]) {
  return values.map(csvCell).join(",");
}

function csvCell(value: string | number) {
  const text = String(value);
  const formulaSafe = /^[=+\-@]/u.test(text) ? `'${text}` : text;
  return `"${formulaSafe.replaceAll('"', '""')}"`;
}

function mapVideo(row: DbRow | undefined): Video {
  if (!row) throw new CatalogNotFoundError("Video not found.");
  return VideoSchema.parse({
    id: row.id,
    youtubeVideoId: row.youtube_video_id,
    canonicalUrl: row.canonical_url,
    title: row.title,
    ...(row.channel === null ? {} : { channel: row.channel }),
    ...(row.duration_ms === null
      ? {}
      : { durationMs: Number(row.duration_ms) }),
    ...(row.source_language === null
      ? {}
      : { sourceLanguage: row.source_language }),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function mapBatchItem(row: DbRow): TranscriptionBatchItem {
  return TranscriptionBatchItemSchema.parse({
    id: row.id,
    batchId: row.batch_id,
    inputIndex: Number(row.input_index),
    input: row.raw_input,
    status: row.preflight_status,
    processingNeed: row.processing_need,
    ...(row.youtube_video_id === null
      ? {}
      : { youtubeVideoId: row.youtube_video_id }),
    ...(row.canonical_url === null ? {} : { canonicalUrl: row.canonical_url }),
    ...(row.title === null ? {} : { title: row.title }),
    ...(row.channel === null ? {} : { channel: row.channel }),
    ...(row.duration_ms === null
      ? {}
      : { durationMs: Number(row.duration_ms) }),
    ...(row.source_language === null
      ? {}
      : { sourceLanguage: row.source_language }),
    ...(row.catalog_video_id === null
      ? {}
      : { catalogVideoId: row.catalog_video_id }),
    ...(row.active_transcript_version_id === null
      ? {}
      : { activeTranscriptVersionId: row.active_transcript_version_id }),
    ...(row.duplicate_of_input_index === null
      ? {}
      : { duplicateOfInputIndex: Number(row.duplicate_of_input_index) }),
    ...(row.error_code === null
      ? {}
      : {
          error: {
            code: row.error_code,
            message: row.error_message,
            ...(row.error_retryable === null
              ? {}
              : { retryable: Boolean(row.error_retryable) }),
          },
        }),
    state: row.state,
    reviewStatus: row.review_status,
    ...(row.job_id === null ? {} : { jobId: row.job_id }),
    ...(row.idempotency_key === null
      ? {}
      : { idempotencyKey: row.idempotency_key }),
    ...(row.source_plan === null ? {} : { sourcePlan: row.source_plan }),
    ...(row.source_resolved_at === null
      ? {}
      : { sourceResolvedAt: iso(row.source_resolved_at) }),
    attempt: Number(row.attempt),
    version: Number(row.version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function mapReviewInboxItem(row: DbRow): ReviewInboxItem {
  return ReviewInboxItemSchema.parse({
    ...mapBatchItem(row),
    batchName: row.batch_name,
  });
}

function summarizeProgress(items: readonly TranscriptionBatchItem[]): {
  total: number;
  queued: number;
  active: number;
  readyForReview: number;
  blocked: number;
  failed: number;
  retryableFailed: number;
  canceled: number;
  unreviewed: number;
  reviewing: number;
  reviewed: number;
  skipped: number;
} {
  const countState = (state: TranscriptionBatchItem["state"]) =>
    items.filter((item) => item.state === state).length;
  const activeStates = new Set<TranscriptionBatchItem["state"]>([
    "resolving",
    "acquiring",
    "transcribing",
    "translating",
    "aligning",
    "uploading",
  ]);
  const countReview = (status: TranscriptionBatchItem["reviewStatus"]) =>
    items.filter(
      (item) =>
        item.state === "ready_for_review" && item.reviewStatus === status,
    ).length;
  return {
    total: items.length,
    queued: countState("queued"),
    active: items.filter((item) => activeStates.has(item.state)).length,
    readyForReview: countState("ready_for_review"),
    blocked: countState("blocked"),
    failed: countState("failed"),
    retryableFailed: items.filter(
      (item) => item.state === "failed" && item.error?.retryable === true,
    ).length,
    canceled: countState("canceled"),
    unreviewed: countReview("unreviewed"),
    reviewing: countReview("reviewing"),
    reviewed: countReview("reviewed"),
    skipped: countReview("skipped"),
  };
}

function mapJob(row: DbRow) {
  return JobSchema.parse({
    id: row.id,
    kind: row.kind,
    state: row.state,
    ...(row.project_id === null ? {} : { projectId: row.project_id }),
    idempotencyKey: row.idempotency_key,
    attempt: Number(row.attempt),
    payload:
      typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function summarizePreflight(items: readonly BatchPreflightItem[]) {
  return BatchPreflightSummarySchema.parse({
    total: items.length,
    ready: items.filter((item) => item.status === "ready").length,
    existingTranscripts: items.filter(
      (item) => item.status === "existing-transcript",
    ).length,
    duplicates: items.filter((item) => item.status === "duplicate").length,
    unsupported: items.filter((item) => item.status === "unsupported").length,
    metadataFailed: items.filter((item) => item.status === "metadata-failed")
      .length,
  });
}
