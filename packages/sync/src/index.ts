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

/** A catalog failure classified before any stale local-cache decision. */
export class TranscriptCatalogError extends Error {
  constructor(
    readonly statusCode: 401 | 403 | 404 | 502,
    readonly code:
      | "authentication_required"
      | "authorization_denied"
      | "not_found"
      | "transcript_catalog_unavailable",
  ) {
    super("The shared transcript catalog is unavailable.");
  }

  get permitsOfflineCache(): boolean {
    return this.statusCode === 502;
  }
}

export class OfflineTranscriptUnavailableError extends Error {
  readonly statusCode = 503;
  readonly code = "offline_transcript_not_authorized";

  constructor() {
    super(
      "Reconnect to verify access before reviewing this cached transcript.",
    );
  }
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
  private readonly authorizations: LocalTranscriptCacheAuthorizationRepository;

  constructor(
    private readonly database: DatabaseSync,
    private readonly downloader: TranscriptArtifactDownloader,
    private readonly rootDirectory: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.authorizations = new LocalTranscriptCacheAuthorizationRepository(
      database,
      now,
    );
  }

  findVerified(bundle: ActiveTranscriptBundle): string | undefined {
    this.assertBundleBinding(bundle);
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
      return this.assertCachedBundle(row.cache_path, bundle);
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
    this.assertBundleBinding(bundle);
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
      if (!isDeepStrictEqual(parsedManifest, manifest)) {
        throw new LocalCacheIntegrityError(
          "Downloaded manifest does not match the active transcript manifest.",
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
        this.assertCachedBundle(destination, bundle);
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

  authorize(input: {
    resolution: TranscriptResolution;
    authorizationScopeSha256: string | undefined;
  }): void {
    if (!input.authorizationScopeSha256) return;
    this.authorizations.authorize({
      projectId: input.resolution.bundle.manifest.projectId,
      catalogVideoId: input.resolution.bundle.manifest.catalogVideoId,
      transcriptVersionId: input.resolution.bundle.transcriptVersionId,
      authorizationScopeSha256: input.authorizationScopeSha256,
    });
  }

  findOfflineAuthorized(input: {
    projectId: string;
    catalogVideoId: string;
    authorizationScopeSha256: string;
  }): CachedTranscriptBundleResolution {
    const row = this.database
      .prepare(
        `SELECT cache.cache_path, cache.manifest_sha256,
                cache.transcript_version_id
         FROM verified_transcript_cache cache
         JOIN verified_transcript_cache_authorizations authorization
           ON authorization.project_id = cache.project_id
          AND authorization.video_id = cache.video_id
          AND authorization.transcript_version_id = cache.transcript_version_id
         WHERE cache.project_id = ? AND cache.video_id = ?
           AND cache.sync_state = 'verified'
           AND authorization.authorization_scope_sha256 = ?
         ORDER BY authorization.authorized_at DESC
         LIMIT 1`,
      )
      .get(
        input.projectId,
        input.catalogVideoId,
        input.authorizationScopeSha256,
      ) as
      | {
          cache_path: string;
          manifest_sha256: string;
          transcript_version_id: string;
        }
      | undefined;
    if (!row) throw new OfflineTranscriptUnavailableError();

    try {
      const cachePath = this.assertCacheDirectory(row.cache_path);
      const manifestBytes = this.readContainedRegularFile(
        cachePath,
        "manifest.json",
      );
      if (sha256(manifestBytes) !== row.manifest_sha256) {
        throw new LocalCacheIntegrityError("Cached manifest identity changed.");
      }
      const manifest = TranscriptManifestSchema.parse(
        JSON.parse(manifestBytes.toString("utf8")),
      );
      if (
        manifest.id !== row.transcript_version_id ||
        manifest.projectId !== input.projectId ||
        manifest.catalogVideoId !== input.catalogVideoId
      ) {
        throw new LocalCacheIntegrityError("Cached manifest identity changed.");
      }
      for (const type of requiredNormalizedArtifactTypes(manifest)) {
        const descriptor = manifest.artifacts.find(
          (artifact) => artifact.type === type,
        );
        if (!descriptor) {
          throw new LocalCacheIntegrityError(
            `Cached ${type} transcript is missing.`,
          );
        }
        const filename = `${type}${extname(descriptor.objectKey) || ".bin"}`;
        const bytes = this.readContainedRegularFile(cachePath, filename);
        if (
          bytes.byteLength !== descriptor.byteSize ||
          sha256(bytes) !== descriptor.sha256
        ) {
          throw new LocalCacheIntegrityError(
            `Cached ${type} transcript checksum does not match its manifest.`,
          );
        }
      }
      return {
        bundle: { transcriptVersionId: manifest.id, manifest },
        cachePath,
      };
    } catch (error) {
      const integrityError =
        error instanceof LocalCacheIntegrityError
          ? error
          : new LocalCacheIntegrityError(
              "Cached transcript verification failed.",
            );
      this.database
        .prepare(
          `UPDATE verified_transcript_cache SET sync_state = 'failed'
           WHERE project_id = ? AND video_id = ? AND transcript_version_id = ?`,
        )
        .run(input.projectId, input.catalogVideoId, row.transcript_version_id);
      throw integrityError;
    }
  }

  private assertCacheDirectory(value: string): string {
    return assertContainedCacheDirectory(this.rootDirectory, value);
  }

  private readContainedRegularFile(
    cachePath: string,
    filename: string,
  ): Buffer {
    return readContainedRegularCacheFile(
      this.rootDirectory,
      cachePath,
      filename,
    );
  }

  private assertCachedBundle(
    cacheDirectory: string,
    bundle: ActiveTranscriptBundle,
  ): string {
    const cachePath = this.assertCacheDirectory(cacheDirectory);
    const manifestBytes = this.readContainedRegularFile(
      cachePath,
      "manifest.json",
    );
    const manifest = TranscriptManifestSchema.parse(
      JSON.parse(manifestBytes.toString("utf8")),
    );
    if (
      sha256(manifestBytes) !== bundle.manifestObject.sha256 ||
      !isDeepStrictEqual(manifest, bundle.manifest)
    ) {
      throw new LocalCacheIntegrityError(
        "Cached manifest does not match the active transcript manifest.",
      );
    }
    for (const artifact of manifest.artifacts) {
      const extension = extname(artifact.objectKey) || ".bin";
      const bytes = this.readContainedRegularFile(
        cachePath,
        `${artifact.type}${extension}`,
      );
      if (
        bytes.byteLength !== artifact.byteSize ||
        sha256(bytes) !== artifact.sha256
      ) {
        throw new LocalCacheIntegrityError(
          `Cached ${artifact.type} artifact does not match its manifest.`,
        );
      }
    }
    return cachePath;
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

  private assertBundleBinding(bundle: ActiveTranscriptBundle): void {
    const { manifest, manifestObject, downloads } = bundle;
    if (bundle.transcriptVersionId !== manifest.id) {
      throw new LocalCacheIntegrityError(
        "Active transcript version does not match its manifest.",
      );
    }

    const targets = new Map(
      downloads.map((target) => [target.type, target] as const),
    );
    const artifacts = new Map(
      manifest.artifacts.map((artifact) => [artifact.type, artifact] as const),
    );
    if (
      targets.size !== downloads.length ||
      artifacts.size !== manifest.artifacts.length ||
      targets.size !== artifacts.size + 1
    ) {
      throw new LocalCacheIntegrityError(
        "Active transcript download targets are not unique and complete.",
      );
    }

    const manifestTarget = targets.get("manifest");
    if (
      !manifestTarget ||
      !sameFinalizedObject(manifestTarget, manifestObject)
    ) {
      throw new LocalCacheIntegrityError(
        "Manifest download target does not match the active manifest object.",
      );
    }

    for (const artifact of manifest.artifacts) {
      const target = targets.get(artifact.type);
      if (
        !artifact.objectVersionId ||
        !target ||
        !sameFinalizedObject(target, artifact)
      ) {
        throw new LocalCacheIntegrityError(
          `Download target does not match the manifest descriptor for ${artifact.type}.`,
        );
      }
    }
  }
}

export interface ActiveTranscriptCatalogClient {
  getActiveTranscript(
    projectId: string,
    catalogVideoId: string,
  ): Promise<ActiveTranscriptBundle>;
}

export type TranscriptResolution = {
  bundle: ResolvedTranscriptBundle;
  cachePath: string;
  source: "verified-local-cache" | "shared-store";
  catalogState: "active_verified" | "offline_cached";
  authorizationScopeSha256?: string;
};

export type ResolvedTranscriptBundle = Pick<
  ActiveTranscriptBundle,
  "transcriptVersionId" | "manifest"
>;

type CachedTranscriptBundleResolution = Pick<
  TranscriptResolution,
  "bundle" | "cachePath"
>;

export class SharedFirstTranscriptResolver {
  constructor(
    private readonly catalog: ActiveTranscriptCatalogClient,
    private readonly cache: VerifiedTranscriptCache,
  ) {}

  async resolve(
    projectId: string,
    catalogVideoId: string,
    offlineReviewCapability?: string,
  ): Promise<TranscriptResolution> {
    const authorizationScopeSha256 = offlineReviewCapability
      ? sha256(Buffer.from(offlineReviewCapability, "utf8"))
      : undefined;
    try {
      const bundle = await this.catalog.getActiveTranscript(
        projectId,
        catalogVideoId,
      );
      const existing = this.cache.findVerified(bundle);
      if (existing) {
        return {
          bundle,
          cachePath: existing,
          source: "verified-local-cache",
          catalogState: "active_verified",
          ...(authorizationScopeSha256 ? { authorizationScopeSha256 } : {}),
        };
      }
      return {
        bundle,
        cachePath: await this.cache.download(bundle),
        source: "shared-store",
        catalogState: "active_verified",
        ...(authorizationScopeSha256 ? { authorizationScopeSha256 } : {}),
      };
    } catch (error) {
      if (
        !(error instanceof TranscriptCatalogError) ||
        !error.permitsOfflineCache ||
        !authorizationScopeSha256
      ) {
        throw error;
      }
      const cached = this.cache.findOfflineAuthorized({
        projectId,
        catalogVideoId,
        authorizationScopeSha256,
      });
      return {
        ...cached,
        source: "verified-local-cache",
        catalogState: "offline_cached",
        authorizationScopeSha256,
      };
    }
  }

  authorize(resolution: TranscriptResolution): void {
    this.cache.authorize({
      resolution,
      authorizationScopeSha256: resolution.authorizationScopeSha256,
    });
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
  constructor(
    private readonly index: LocalTranscriptIndex,
    private readonly cacheRootDirectory?: string,
  ) {}

  read(resolution: TranscriptResolution): CachedBaseTranscriptTracks {
    const { manifest } = resolution.bundle;
    const english = this.readNormalizedArtifact(
      resolution,
      "english-normalized",
    );
    if (!english) {
      throw new LocalCacheIntegrityError(
        "Verified bundle does not contain an English normalized transcript.",
      );
    }
    this.assertTrack({
      transcript: english,
      resolution,
      kind: "english",
      language: "en",
    });

    const original = isEnglish(manifest.sourceLanguage)
      ? english
      : this.readNormalizedArtifact(resolution, "original-normalized");
    if (!original) {
      throw new LocalCacheIntegrityError(
        "A foreign-language bundle does not contain an original normalized transcript.",
      );
    }
    if (!isEnglish(manifest.sourceLanguage)) {
      this.assertTrack({
        transcript: original,
        resolution,
        kind: "original",
        language: manifest.sourceLanguage,
      });
      if (
        english.track.sourceTrackId !== original.track.id ||
        english.track.timingPrecision !== original.track.timingPrecision
      ) {
        throw new LocalCacheIntegrityError(
          "Cached English transcript is not time-linked to the exact original track.",
        );
      }
    }

    this.indexTrack(resolution, english);
    if (original !== english) this.indexTrack(resolution, original);
    return { original, english };
  }

  private readNormalizedArtifact(
    resolution: TranscriptResolution,
    type: "original-normalized" | "english-normalized",
  ): NormalizedTranscript | undefined {
    const descriptor = resolution.bundle.manifest.artifacts.find(
      (artifact) => artifact.type === type,
    );
    if (!descriptor) return undefined;
    const extension = extname(descriptor.objectKey) || ".bin";
    let stored: Buffer;
    try {
      stored = this.cacheRootDirectory
        ? readContainedRegularCacheFile(
            this.cacheRootDirectory,
            resolution.cachePath,
            `${type}${extension}`,
          )
        : readFileSync(join(resolution.cachePath, `${type}${extension}`));
    } catch {
      throw new LocalCacheIntegrityError(
        `Cached ${type} transcript is missing.`,
      );
    }
    if (
      stored.byteLength !== descriptor.byteSize ||
      createHash("sha256").update(stored).digest("hex") !== descriptor.sha256
    ) {
      throw new LocalCacheIntegrityError(
        `Cached ${type} transcript checksum does not match its manifest.`,
      );
    }
    try {
      const bytes = extension === ".gz" ? gunzipSync(stored) : stored;
      return NormalizedTranscriptSchema.parse(
        JSON.parse(bytes.toString("utf8")),
      );
    } catch {
      throw new LocalCacheIntegrityError(
        `Cached ${type} transcript does not match the normalized schema.`,
      );
    }
  }

  private assertTrack(input: {
    transcript: NormalizedTranscript;
    resolution: TranscriptResolution;
    kind: "original" | "english";
    language: string;
  }): void {
    const { transcript, resolution, kind, language } = input;
    const manifest = resolution.bundle.manifest;
    if (
      transcript.track.videoId !== manifest.videoId ||
      transcript.track.kind !== kind ||
      !sameLanguage(transcript.track.language, language) ||
      transcript.track.timingPrecision !== manifest.timingPrecision ||
      transcript.track.schemaVersion !== manifest.normalizationSchemaVersion
    ) {
      throw new LocalCacheIntegrityError(
        `Cached ${kind} transcript identity does not match its manifest.`,
      );
    }
  }

  private indexTrack(
    resolution: TranscriptResolution,
    transcript: NormalizedTranscript,
  ): void {
    this.index.replace({
      projectId: resolution.bundle.manifest.projectId,
      catalogVideoId: resolution.bundle.manifest.catalogVideoId,
      transcriptVersionId: resolution.bundle.transcriptVersionId,
      transcript,
    });
  }
}

function requiredNormalizedArtifactTypes(manifest: {
  sourceLanguage: string;
}): Array<"original-normalized" | "english-normalized"> {
  return isEnglish(manifest.sourceLanguage)
    ? ["english-normalized"]
    : ["original-normalized", "english-normalized"];
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sameFinalizedObject(
  left: FinalizedObjectIdentity,
  right: FinalizedObjectIdentity,
): boolean {
  return (
    left.type === right.type &&
    left.objectKey === right.objectKey &&
    left.objectVersionId === right.objectVersionId &&
    left.byteSize === right.byteSize &&
    left.sha256 === right.sha256
  );
}

type FinalizedObjectIdentity = {
  type: TranscriptDownloadTarget["type"];
  objectKey: string;
  objectVersionId?: string | undefined;
  byteSize: number;
  sha256: string;
};

function isContainedPath(root: string, candidate: string): boolean {
  const relativePath = relative(resolve(root), resolve(candidate));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function assertContainedCacheDirectory(
  rootDirectory: string,
  value: string,
): string {
  const root = realpathSync(rootDirectory);
  const candidate = resolve(value);
  const real = realpathSync(candidate);
  if (!isContainedPath(root, real)) {
    throw new LocalCacheIntegrityError("Cached transcript path is invalid.");
  }
  const stat = lstatSync(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new LocalCacheIntegrityError("Cached transcript path is invalid.");
  }
  return real;
}

function readContainedRegularCacheFile(
  rootDirectory: string,
  cachePath: string,
  filename: string,
): Buffer {
  const directory = assertContainedCacheDirectory(rootDirectory, cachePath);
  const target = join(directory, filename);
  const root = realpathSync(rootDirectory);
  const real = realpathSync(target);
  if (!isContainedPath(root, real)) {
    throw new LocalCacheIntegrityError("Cached transcript path is invalid.");
  }
  const descriptor = openSync(
    real,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
  );
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) {
      throw new LocalCacheIntegrityError("Cached transcript file is invalid.");
    }
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export type CachedBaseTranscriptTracks = {
  original: NormalizedTranscript;
  english: NormalizedTranscript;
};

export type PreferredTranscriptResolverInput = {
  projectId: string;
  catalogVideoId: string;
  transcriptVersionId: string;
  preferredLanguage: string;
  original: NormalizedTranscript;
  english: NormalizedTranscript;
};

/** Extension points for local-cache, shared-store, and generated preferred tracks. */
export interface PreferredTranscriptResolver {
  findLocal?(
    input: PreferredTranscriptResolverInput,
  ): Promise<NormalizedTranscript | undefined>;
  findShared?(
    input: PreferredTranscriptResolverInput,
  ): Promise<NormalizedTranscript | undefined>;
  requestTranslation?(
    input: PreferredTranscriptResolverInput,
  ): Promise<NormalizedTranscript | undefined>;
}

/**
 * Internal compatibility projection. Its `workspace` member is the only
 * renderer-safe contract; cache and download metadata remain local-only until
 * the existing route moves to `resolveWorkspace`.
 */
export type WorkspaceTranscriptResolution = TranscriptResolution & {
  transcript: NormalizedTranscript;
  workspace: TranscriptWorkspaceResponse;
};

export class SharedTranscriptWorkspaceService {
  constructor(
    private readonly resolver: SharedFirstTranscriptResolver,
    private readonly reader: CachedTranscriptDocumentReader,
    private readonly preferredResolver?: PreferredTranscriptResolver,
  ) {}

  async resolve(
    projectId: string,
    catalogVideoId: string,
    preferredLanguage = "en",
    offlineReviewCapability?: string,
  ): Promise<WorkspaceTranscriptResolution> {
    return this.resolveInternal(
      projectId,
      catalogVideoId,
      preferredLanguage,
      offlineReviewCapability,
    );
  }

  async resolveWorkspace(
    projectId: string,
    catalogVideoId: string,
    preferredLanguage = "en",
    offlineReviewCapability?: string,
  ): Promise<TranscriptWorkspaceResponse> {
    return (
      await this.resolveInternal(
        projectId,
        catalogVideoId,
        preferredLanguage,
        offlineReviewCapability,
      )
    ).workspace;
  }

  private async resolveInternal(
    projectId: string,
    catalogVideoId: string,
    preferredLanguage: string,
    offlineReviewCapability?: string,
  ): Promise<WorkspaceTranscriptResolution> {
    const language = LanguageTagSchema.parse(preferredLanguage);
    const resolution = await this.resolver.resolve(
      projectId,
      catalogVideoId,
      offlineReviewCapability,
    );
    const tracks = this.reader.read(resolution);
    this.resolver.authorize(resolution);
    const preferredInput: PreferredTranscriptResolverInput & {
      offlineCached: boolean;
    } = {
      projectId,
      catalogVideoId,
      transcriptVersionId: resolution.bundle.transcriptVersionId,
      preferredLanguage: language,
      original: tracks.original,
      english: tracks.english,
      offlineCached: resolution.catalogState === "offline_cached",
    };
    const preferred = await this.resolvePreferred(preferredInput);
    const workspace = TranscriptWorkspaceResponseSchema.parse({
      schemaVersion: 1,
      projectId,
      catalogVideoId,
      youtubeVideoId: resolution.bundle.manifest.videoId,
      transcriptVersionId: resolution.bundle.transcriptVersionId,
      source: resolution.source,
      catalogState: resolution.catalogState,
      original: tracks.original,
      english: tracks.english,
      preferred,
    });
    return { ...resolution, transcript: workspace.english, workspace };
  }

  private async resolvePreferred(
    input: PreferredTranscriptResolverInput & {
      offlineCached: boolean;
    },
  ): Promise<PreferredTranscriptResolution> {
    const local = this.preferredResolver?.findLocal;
    const shared = this.preferredResolver?.findShared;
    const requested = this.preferredResolver?.requestTranslation;
    return resolvePreferredTranscript({
      preferredLanguage: input.preferredLanguage,
      original: input.original,
      english: input.english,
      ...(local
        ? {
            findLocal: (targetLanguage: string) =>
              local({
                ...input,
                preferredLanguage: targetLanguage,
              }),
          }
        : {}),
      ...(shared && !input.offlineCached
        ? {
            findShared: (targetLanguage: string) =>
              shared({
                ...input,
                preferredLanguage: targetLanguage,
              }),
          }
        : {}),
      ...(requested && !input.offlineCached
        ? {
            requestTranslation: (targetLanguage: string) =>
              requested({
                ...input,
                preferredLanguage: targetLanguage,
              }),
          }
        : {}),
    });
  }
}

function isEnglish(language: string): boolean {
  return sameLanguage(language, "en");
}

function sameLanguage(left: string, right: string): boolean {
  return (
    left.toLocaleLowerCase() === right.toLocaleLowerCase() ||
    left.split("-", 1)[0]!.toLocaleLowerCase() ===
      right.split("-", 1)[0]!.toLocaleLowerCase()
  );
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
    let response: Response;
    try {
      response = await this.fetcher(
        `${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/videos/${encodeURIComponent(catalogVideoId)}/transcripts/active`,
        {
          headers: {
            accept: "application/json",
            authorization: this.authorization,
          },
        },
      );
    } catch {
      throw new TranscriptCatalogError(502, "transcript_catalog_unavailable");
    }
    if (!response.ok) {
      if (response.status === 401)
        throw new TranscriptCatalogError(401, "authentication_required");
      if (response.status === 403)
        throw new TranscriptCatalogError(403, "authorization_denied");
      if (response.status === 404)
        throw new TranscriptCatalogError(404, "not_found");
      throw new TranscriptCatalogError(502, "transcript_catalog_unavailable");
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
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { gunzipSync } from "node:zlib";

import {
  ActiveTranscriptBundleSchema,
  CreateClipCandidateRequestSchema,
  DerivedTranslationSchema,
  LanguageTagSchema,
  NormalizedTranscriptSchema,
  TranscriptWorkspaceResponseSchema,
  TranscriptManifestSchema,
  type ActiveTranscriptBundle,
  type CreateClipCandidateRequest,
  type DerivedTranslation,
  type DerivedTranslationIdentity,
  type NormalizedTranscript,
  type PreferredTranscriptResolution,
  type TranscriptDownloadTarget,
  type TranscriptWorkspaceResponse,
} from "@research-video/contracts";
import {
  LocalTranscriptCacheAuthorizationRepository,
  LocalTranscriptIndex,
} from "@research-video/db-local";
import type { TranscriptObjectStore } from "@research-video/storage";
import { resolvePreferredTranscript } from "@research-video/transcript";
