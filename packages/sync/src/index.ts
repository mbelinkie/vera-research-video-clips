export type QueueEnvelope<T> = {
  messageId: string;
  receipt: string;
  payload: T;
  deliveryCount: number;
};

type StoredMessage<T> = QueueEnvelope<T> & { visible: boolean };

export interface JobQueue<T> {
  send(messageId: string, payload: T): Promise<void>;
  receive(): Promise<QueueEnvelope<T> | undefined>;
  acknowledge(receipt: string): Promise<boolean>;
  release(receipt: string): Promise<boolean>;
  extendVisibility(
    receipt: string,
    visibilitySeconds: number,
  ): Promise<boolean>;
}

export class MemoryJobQueue<T> implements JobQueue<T> {
  readonly #messages: StoredMessage<T>[] = [];

  async send(messageId: string, payload: T): Promise<void> {
    this.#messages.push({
      messageId,
      receipt: crypto.randomUUID(),
      payload,
      deliveryCount: 0,
      visible: true,
    });
  }

  async receive(): Promise<QueueEnvelope<T> | undefined> {
    const message = this.#messages.find((candidate) => candidate.visible);
    if (!message) return undefined;

    message.visible = false;
    message.deliveryCount += 1;
    message.receipt = crypto.randomUUID();
    const { visible: _visible, ...envelope } = message;
    return { ...envelope };
  }

  async acknowledge(receipt: string): Promise<boolean> {
    const index = this.#messages.findIndex(
      (message) => message.receipt === receipt,
    );
    if (index === -1) return false;
    this.#messages.splice(index, 1);
    return true;
  }

  async release(receipt: string): Promise<boolean> {
    const message = this.#messages.find(
      (candidate) => candidate.receipt === receipt,
    );
    if (!message) return false;
    message.visible = true;
    return true;
  }

  async extendVisibility(
    receipt: string,
    visibilitySeconds: number,
  ): Promise<boolean> {
    if (!Number.isInteger(visibilitySeconds) || visibilitySeconds < 1) {
      throw new RangeError("Visibility duration must be a positive integer.");
    }
    return this.#messages.some(
      (candidate) => candidate.receipt === receipt && !candidate.visible,
    );
  }
}

export class LocalCacheIntegrityError extends Error {
  readonly statusCode = 422;
  readonly code = "local_cache_integrity_failed";
}

export interface TranscriptArtifactDownloader {
  download(target: TranscriptDownloadTarget): Promise<Uint8Array>;
}

export class ObjectStoreArtifactDownloader implements TranscriptArtifactDownloader {
  constructor(private readonly store: TranscriptObjectStore) {}

  async download(target: TranscriptDownloadTarget): Promise<Uint8Array> {
    const object = await this.store.get(
      target.objectKey,
      target.objectVersionId,
    );
    if (!object) {
      throw new LocalCacheIntegrityError(
        `Object is missing: ${target.objectKey}.`,
      );
    }
    return object.bytes;
  }
}

export class HttpArtifactDownloader implements TranscriptArtifactDownloader {
  async download(target: TranscriptDownloadTarget): Promise<Uint8Array> {
    const response = await fetch(target.downloadUrl, {
      method: "GET",
      redirect: "error",
    });
    if (!response.ok) {
      throw new LocalCacheIntegrityError(
        `Artifact download failed with HTTP ${response.status}.`,
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  }
}

export class VerifiedTranscriptCache {
  constructor(
    private readonly database: DatabaseSync,
    private readonly downloader: TranscriptArtifactDownloader,
    private readonly rootDirectory: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  findVerified(bundle: ActiveTranscriptBundle): string | undefined {
    const row = this.database
      .prepare(
        `SELECT cache_path, manifest_sha256
         FROM verified_transcript_cache
         WHERE project_id = ? AND video_id = ? AND transcript_version_id = ?
           AND sync_state = 'verified'`,
      )
      .get(
        bundle.manifest.projectId,
        bundle.manifest.catalogVideoId,
        bundle.transcriptVersionId,
      ) as { cache_path: string; manifest_sha256: string } | undefined;
    if (!row || row.manifest_sha256 !== bundle.manifestObject.sha256)
      return undefined;

    try {
      const manifestBytes = readFileSync(join(row.cache_path, "manifest.json"));
      const digest = createHash("sha256").update(manifestBytes).digest("hex");
      const manifest = TranscriptManifestSchema.parse(
        JSON.parse(manifestBytes.toString("utf8")),
      );
      if (
        digest !== bundle.manifestObject.sha256 ||
        manifest.id !== bundle.transcriptVersionId
      ) {
        throw new LocalCacheIntegrityError("Cached manifest identity changed.");
      }
      return row.cache_path;
    } catch {
      this.database
        .prepare(
          `UPDATE verified_transcript_cache SET sync_state = 'failed'
           WHERE project_id = ? AND video_id = ? AND transcript_version_id = ?`,
        )
        .run(
          bundle.manifest.projectId,
          bundle.manifest.catalogVideoId,
          bundle.transcriptVersionId,
        );
      return undefined;
    }
  }

  async download(bundle: ActiveTranscriptBundle): Promise<string> {
    const { manifest, manifestObject } = bundle;
    const targets = new Map(
      bundle.downloads.map((target) => [target.type, target]),
    );
    const parent = join(
      this.rootDirectory,
      manifest.projectId,
      manifest.catalogVideoId,
    );
    const destination = join(parent, bundle.transcriptVersionId);
    const staging = join(parent, `.staging-${randomUUID()}`);
    mkdirSync(staging, { recursive: true });

    try {
      const manifestTarget = targets.get("manifest");
      if (!manifestTarget) {
        throw new LocalCacheIntegrityError(
          "Manifest download target is missing.",
        );
      }
      const manifestBytes = await this.verifiedBytes(manifestTarget);
      const parsedManifest = TranscriptManifestSchema.parse(
        JSON.parse(new TextDecoder().decode(manifestBytes)),
      );
      if (parsedManifest.id !== bundle.transcriptVersionId) {
        throw new LocalCacheIntegrityError(
          "Downloaded manifest does not identify the active transcript.",
        );
      }
      writeFileSync(join(staging, "manifest.json"), manifestBytes);

      for (const artifact of manifest.artifacts) {
        if (!artifact.objectVersionId) {
          throw new LocalCacheIntegrityError(
            "Transcript artifact does not pin an object version.",
          );
        }
        const target = targets.get(artifact.type);
        if (!target) {
          throw new LocalCacheIntegrityError(
            `Download target is missing for ${artifact.type}.`,
          );
        }
        const bytes = await this.verifiedBytes(target);
        const extension = extname(artifact.objectKey) || ".bin";
        writeFileSync(join(staging, `${artifact.type}${extension}`), bytes);
      }

      mkdirSync(parent, { recursive: true });
      if (existsSync(destination)) {
        rmSync(staging, { recursive: true });
      } else {
        renameSync(staging, destination);
      }
      this.database
        .prepare(
          `INSERT INTO verified_transcript_cache
             (project_id, video_id, transcript_version_id, manifest_sha256,
              cache_path, sync_state, server_version, verified_at)
           VALUES (?, ?, ?, ?, ?, 'verified', 1, ?)
           ON CONFLICT (project_id, video_id, transcript_version_id) DO UPDATE SET
             manifest_sha256 = excluded.manifest_sha256,
             cache_path = excluded.cache_path,
             sync_state = 'verified',
             verified_at = excluded.verified_at`,
        )
        .run(
          manifest.projectId,
          manifest.catalogVideoId,
          bundle.transcriptVersionId,
          manifestObject.sha256,
          destination,
          this.now().toISOString(),
        );
      return destination;
    } catch (error) {
      if (existsSync(staging)) rmSync(staging, { recursive: true });
      throw error;
    }
  }

  private async verifiedBytes(
    descriptor: TranscriptDownloadTarget,
  ): Promise<Uint8Array> {
    const bytes = await this.downloader.download(descriptor);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (
      bytes.byteLength !== descriptor.byteSize ||
      digest !== descriptor.sha256
    ) {
      throw new LocalCacheIntegrityError(
        `Cache verification failed for ${descriptor.objectKey}.`,
      );
    }
    return bytes;
  }
}

export interface ActiveTranscriptCatalogClient {
  getActiveTranscript(
    projectId: string,
    catalogVideoId: string,
  ): Promise<ActiveTranscriptBundle>;
}

export type TranscriptResolution = {
  bundle: ActiveTranscriptBundle;
  cachePath: string;
  source: "verified-local-cache" | "shared-store";
};

export class SharedFirstTranscriptResolver {
  constructor(
    private readonly catalog: ActiveTranscriptCatalogClient,
    private readonly cache: VerifiedTranscriptCache,
  ) {}

  async resolve(
    projectId: string,
    catalogVideoId: string,
  ): Promise<TranscriptResolution> {
    const bundle = await this.catalog.getActiveTranscript(
      projectId,
      catalogVideoId,
    );
    const existing = this.cache.findVerified(bundle);
    if (existing) {
      return { bundle, cachePath: existing, source: "verified-local-cache" };
    }
    return {
      bundle,
      cachePath: await this.cache.download(bundle),
      source: "shared-store",
    };
  }
}

export interface DerivedTranslationCatalogClient {
  getDerivedTranslation(
    identity: DerivedTranslationIdentity,
  ): Promise<DerivedTranslation | undefined>;
}

export type DerivedTranslationResolution = {
  transcript: NormalizedTranscript;
  source: "verified-local-cache" | "shared-store";
};

export class SharedDerivedTranslationResolver {
  constructor(
    private readonly catalog: DerivedTranslationCatalogClient,
    private readonly index: LocalTranscriptIndex,
  ) {}

  async resolve(
    identity: DerivedTranslationIdentity,
  ): Promise<DerivedTranslationResolution | undefined> {
    const local = this.index.findDerivedTranslation(identity);
    if (local) {
      return {
        source: "verified-local-cache",
        transcript: local,
      };
    }
    const shared = await this.catalog.getDerivedTranslation(identity);
    if (!shared) return undefined;
    const translation = DerivedTranslationSchema.parse(shared);
    const normalizedArtifact = translation.manifest.artifacts.find(
      (artifact) => artifact.type === "translated-normalized",
    );
    const normalizedEncoded = JSON.stringify(translation.transcript);
    if (
      !normalizedArtifact ||
      createHash("sha256").update(normalizedEncoded).digest("hex") !==
        normalizedArtifact.sha256 ||
      translation.manifest.identity.baseTranscriptVersionId !==
        identity.baseTranscriptVersionId ||
      translation.manifest.identity.originalTrackId !== identity.originalTrackId
    ) {
      throw new LocalCacheIntegrityError(
        "Shared derived translation failed identity or checksum verification.",
      );
    }
    const manifestSha256 = createHash("sha256")
      .update(JSON.stringify(translation.manifest))
      .digest("hex");
    this.index.promoteDerivedTranslation({
      identity,
      translationVersionId: translation.manifest.id,
      manifestSha256,
      normalizedSha256: normalizedArtifact.sha256,
      transcript: translation.transcript,
    });
    return { source: "shared-store", transcript: translation.transcript };
  }
}

export class CachedTranscriptDocumentReader {
  constructor(private readonly index: LocalTranscriptIndex) {}

  read(resolution: TranscriptResolution): NormalizedTranscript {
    const artifact = readdirSync(resolution.cachePath).find((filename) =>
      filename.startsWith("english-normalized."),
    );
    if (!artifact) {
      throw new LocalCacheIntegrityError(
        "Verified bundle does not contain an English normalized transcript.",
      );
    }
    const artifactPath = join(resolution.cachePath, artifact);
    const stored = readFileSync(artifactPath);
    const bytes = artifact.endsWith(".gz") ? gunzipSync(stored) : stored;
    let transcript: NormalizedTranscript;
    try {
      transcript = NormalizedTranscriptSchema.parse(
        JSON.parse(bytes.toString("utf8")),
      );
    } catch {
      throw new LocalCacheIntegrityError(
        "Cached English transcript does not match the normalized schema.",
      );
    }
    if (
      transcript.track.videoId !== resolution.bundle.manifest.videoId ||
      transcript.track.kind !== "english" ||
      transcript.track.timingPrecision !==
        resolution.bundle.manifest.timingPrecision
    ) {
      throw new LocalCacheIntegrityError(
        "Cached English transcript identity does not match its manifest.",
      );
    }
    this.index.replace({
      projectId: resolution.bundle.manifest.projectId,
      catalogVideoId: resolution.bundle.manifest.catalogVideoId,
      transcriptVersionId: resolution.bundle.transcriptVersionId,
      transcript,
    });
    return transcript;
  }
}

export type WorkspaceTranscriptResolution = TranscriptResolution & {
  transcript: NormalizedTranscript;
};

export class SharedTranscriptWorkspaceService {
  constructor(
    private readonly resolver: SharedFirstTranscriptResolver,
    private readonly reader: CachedTranscriptDocumentReader,
  ) {}

  async resolve(
    projectId: string,
    catalogVideoId: string,
  ): Promise<WorkspaceTranscriptResolution> {
    const resolution = await this.resolver.resolve(projectId, catalogVideoId);
    return { ...resolution, transcript: this.reader.read(resolution) };
  }
}

export class HttpActiveTranscriptCatalogClient implements ActiveTranscriptCatalogClient {
  constructor(
    private readonly baseUrl: string,
    private readonly authorization: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async getActiveTranscript(
    projectId: string,
    catalogVideoId: string,
  ): Promise<ActiveTranscriptBundle> {
    const response = await this.fetcher(
      `${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/videos/${encodeURIComponent(catalogVideoId)}/transcripts/active`,
      {
        headers: {
          accept: "application/json",
          authorization: this.authorization,
        },
      },
    );
    if (!response.ok) {
      throw new Error(
        `Shared transcript catalog request failed (${response.status}).`,
      );
    }
    return ActiveTranscriptBundleSchema.parse(await response.json());
  }
}

export interface OutboxCommand {
  id: string;
  projectId?: string;
  commandType: string;
  idempotencyKey: string;
  payload: unknown;
  attempt: number;
  nextAttemptAt?: string;
  createdAt: string;
}

export class OfflineOutbox {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
  ) {}

  enqueue(input: {
    projectId?: string;
    commandType: string;
    idempotencyKey: string;
    payload: unknown;
  }): string {
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO sync_outbox
           (id, project_id, command_type, idempotency_key, payload_json,
            attempt, next_attempt_at, created_at)
         VALUES (?, ?, ?, ?, ?, 0, NULL, ?)
         ON CONFLICT (idempotency_key) DO NOTHING`,
      )
      .run(
        id,
        input.projectId ?? null,
        input.commandType,
        input.idempotencyKey,
        JSON.stringify(input.payload),
        this.now().toISOString(),
      );
    const existing = this.database
      .prepare("SELECT id FROM sync_outbox WHERE idempotency_key = ?")
      .get(input.idempotencyKey) as { id: string };
    return existing.id;
  }

  enqueueClipCandidate(
    projectId: string,
    input: CreateClipCandidateRequest,
  ): string {
    const command = CreateClipCandidateRequestSchema.parse(input);
    return this.enqueue({
      projectId,
      commandType: "clip_candidate.create.v2",
      idempotencyKey: command.idempotencyKey,
      payload: command,
    });
  }

  due(limit = 50): OutboxCommand[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM sync_outbox
         WHERE next_attempt_at IS NULL OR next_attempt_at <= ?
         ORDER BY created_at LIMIT ?`,
      )
      .all(this.now().toISOString(), limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id),
      ...(row.project_id === null ? {} : { projectId: String(row.project_id) }),
      commandType: String(row.command_type),
      idempotencyKey: String(row.idempotency_key),
      payload: JSON.parse(String(row.payload_json)),
      attempt: Number(row.attempt),
      ...(row.next_attempt_at === null
        ? {}
        : { nextAttemptAt: String(row.next_attempt_at) }),
      createdAt: String(row.created_at),
    }));
  }

  acknowledge(id: string): void {
    this.database.prepare("DELETE FROM sync_outbox WHERE id = ?").run(id);
  }

  retry(id: string, baseDelayMs = 1_000): void {
    const row = this.database
      .prepare("SELECT attempt FROM sync_outbox WHERE id = ?")
      .get(id) as { attempt: number } | undefined;
    if (!row) return;
    const attempt = row.attempt + 1;
    const boundedDelay = Math.min(baseDelayMs * 2 ** (attempt - 1), 60_000);
    const nextAttemptAt = new Date(
      this.now().getTime() + boundedDelay,
    ).toISOString();
    this.database
      .prepare(
        "UPDATE sync_outbox SET attempt = ?, next_attempt_at = ? WHERE id = ?",
      )
      .run(attempt, nextAttemptAt, id);
  }
}
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { extname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";

import {
  ActiveTranscriptBundleSchema,
  CreateClipCandidateRequestSchema,
  DerivedTranslationSchema,
  NormalizedTranscriptSchema,
  TranscriptManifestSchema,
  type ActiveTranscriptBundle,
  type CreateClipCandidateRequest,
  type DerivedTranslation,
  type DerivedTranslationIdentity,
  type NormalizedTranscript,
  type TranscriptDownloadTarget,
} from "@research-video/contracts";
import { LocalTranscriptIndex } from "@research-video/db-local";
import type { TranscriptObjectStore } from "@research-video/storage";
