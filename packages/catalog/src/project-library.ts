import { createHash, randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { requirePermission } from "@research-video/auth";
import {
  CreateItemRequestSchema,
  CreateSourceRequestSchema,
  LibrarySourceSchema,
  LibraryItemSchema,
  type AuthenticatedActor,
  type ProjectRole,
  type CreateSourceRequest,
  type CreateItemRequest,
  type UpdateSourceRequest,
  type UpdateItemRequest,
  type CreateTranscriptClipItemRequest,
  type ItemListQuery,
  type SourceListQuery,
  type CreateClipCandidateRequest,
  type ClipCandidate,
  type StillAssetManifest,
  type StillAssetRole,
  type StillContent,
  type StillUpload,
  ExtensionCaptureRequestSchema,
  type ExtensionCaptureRequest,
} from "@research-video/contracts";
import type { SqlDatabase } from "@research-video/db-cloud";
import type { TranscriptObjectStore } from "@research-video/storage";
import {
  insertStillAssets,
  keepStillAssets,
  readStillManifest,
  readStillObject,
  type StillImages,
} from "./library-still-assets.ts";
import {
  extensionCaptureFingerprint,
  insertExtensionCaptureAssets,
  keepExtensionCaptureAssets,
  readExtensionCaptureAsset,
  readExtensionCaptureReceipt,
  type ExtensionCaptureAssetRole,
  type ExtensionCaptureReceipt,
  type ExtensionCaptureRasters,
} from "./extension-assets.ts";
import {
  CatalogConflictError,
  CatalogNotFoundError,
} from "./catalog-errors.ts";
import {
  readLibrarySource,
  readLibraryItemRow,
  listLibrarySources,
  listLibraryItems,
} from "./library-queries.ts";
import { addTopics } from "./topics.ts";
import {
  articleIdentity,
  findArticle,
  lockSourceIdentity,
} from "./library-web-source.ts";

type Session = Pick<SqlDatabase, "query">;
type Actor = AuthenticatedActor;

function createRetry(request: CreateSourceRequest | CreateItemRequest) {
  return request.idempotencyKey === undefined
    ? undefined
    : {
        key: request.idempotencyKey,
        fingerprint: createHash("sha256")
          .update(JSON.stringify(request))
          .digest("hex"),
      };
}

async function readCreateReplay(
  tx: Session,
  table: "library_sources" | "library_items",
  projectId: string,
  actorId: string,
  retry: ReturnType<typeof createRetry>,
) {
  if (!retry) return undefined;
  const actorColumn =
    table === "library_sources" ? "create_actor_id" : "created_by";
  const reuseReceipts =
    table === "library_sources"
      ? `UNION ALL SELECT source_id,create_fingerprint FROM library_source_reuse_receipts
         WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3`
      : "";
  const result = await tx.query<{ id: string; create_fingerprint: string }>(
    `SELECT id,create_fingerprint FROM ${table}
     WHERE project_id=$1 AND ${actorColumn}=$2 AND create_idempotency_key=$3
     ${reuseReceipts}`,
    [projectId, actorId, retry.key],
  );
  const existing = result.rows[0];
  if (existing && existing.create_fingerprint !== retry.fingerprint)
    throw new CatalogConflictError(
      "This idempotency key was already used for a different request.",
    );
  return existing?.id;
}

type StillPublication = {
  metadata: StillUpload;
  source: { create: CreateSourceRequest } | { id: string };
  provenance: StillAssetManifest["provenance"];
  images: StillImages;
};

function automatic<T>(value: T) {
  return { value, state: "automatic" as const };
}

function sameSite(left: string, right: string) {
  const hostname = (value: string) =>
    new URL(value).hostname.replace(/^www\./u, "").toLowerCase();
  return hostname(left) === hostname(right);
}

function captureSourceRequest(
  input: ExtensionCaptureRequest,
): CreateSourceRequest {
  if (input.kind === "audio") {
    return CreateSourceRequestSchema.parse({
      kind: "audio",
      idempotencyKey: input.requestId,
      bibliography: {
        ...(input.title ? { title: automatic(input.title) } : {}),
        url: automatic(input.url),
      },
      details: {},
    });
  }

  const metadata = input.metadata;
  const canonicalUrl =
    metadata.url && sameSite(metadata.url, input.url)
      ? metadata.url
      : input.url;
  return CreateSourceRequestSchema.parse({
    kind: "web_page",
    idempotencyKey: input.requestId,
    bibliography: {
      ...(metadata.title ? { title: automatic(metadata.title) } : {}),
      ...(metadata.authors ? { authors: automatic(metadata.authors) } : {}),
      ...(metadata.publication
        ? { publication: automatic(metadata.publication) }
        : {}),
      ...(metadata.date ? { date: automatic(metadata.date) } : {}),
      url: automatic(canonicalUrl),
    },
    details: {
      submittedUrl: input.url,
      extraction: input.articleText
        ? { status: "ready", text: input.articleText }
        : { status: "failed", reason: "no_article" },
    },
  });
}

function capturePageUrl(input: ExtensionCaptureRequest) {
  return input.kind === "audio" ? input.pageUrl : input.url;
}

function captureItemRequest(
  input: Extract<ExtensionCaptureRequest, { kind: "quote" }>,
  sourceId: string,
): CreateItemRequest {
  return CreateItemRequestSchema.parse({
    kind: "quote",
    sourceId,
    idempotencyKey: input.requestId,
    notes: input.notes,
    topics: input.topics,
    content: {
      text: input.quote.text,
      ...(input.quote.speaker ? { speaker: input.quote.speaker } : {}),
      ...(input.quote.speakerTitle
        ? { speakerTitle: input.quote.speakerTitle }
        : {}),
      ...(input.quote.surroundingWords
        ? { surroundingWords: input.quote.surroundingWords }
        : {}),
      ...(input.quote.highlight ? { highlight: input.quote.highlight } : {}),
    },
  });
}

async function insertLibrarySource(
  tx: Session,
  projectId: string,
  id: string,
  actorId: string,
  input: CreateSourceRequest,
  retry?: ReturnType<typeof createRetry>,
) {
  const { rows } = await tx.query(
    `INSERT INTO library_sources(
      project_id,id,kind,source_identity,bibliography,details,
      create_actor_id,create_idempotency_key,create_fingerprint
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id`,
    [
      projectId,
      id,
      input.kind,
      input.sourceIdentity ? JSON.stringify(input.sourceIdentity) : null,
      JSON.stringify(input.bibliography),
      JSON.stringify(input.details),
      retry ? actorId : null,
      retry?.key ?? null,
      retry?.fingerprint ?? null,
    ],
  );
  return rows.length > 0;
}

async function insertLibraryItem(
  tx: Session,
  projectId: string,
  id: string,
  actorId: string,
  now: string,
  input: CreateItemRequest,
  retry: ReturnType<typeof createRetry>,
) {
  const { rows } = await tx.query(
    `INSERT INTO library_items(
      id,project_id,source_id,kind,content,notes,created_by,created_at,updated_at,
      create_idempotency_key,create_fingerprint
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10)
    ON CONFLICT(project_id,created_by,create_idempotency_key) DO NOTHING RETURNING id`,
    [
      id,
      projectId,
      input.sourceId,
      input.kind,
      JSON.stringify(input.content),
      input.notes,
      actorId,
      now,
      retry?.key ?? null,
      retry?.fingerprint ?? null,
    ],
  );
  if (!rows.length) return false;
  await addTopics(tx, false, projectId, id, input.topics, now);
  return true;
}

// Use the transaction's actual query handle in embedded mode. Independent
// requests must never contribute statements to another request's transaction.
export function catalogTransaction<T>(
  db: SqlDatabase,
  work: (tx: Session) => Promise<T>,
): Promise<T> {
  if (db.withTransaction) return db.withTransaction(() => work(db));
  return (db as PGlite).transaction(work);
}

export class ProjectLibrary {
  constructor(
    private readonly db: SqlDatabase,
    private readonly store: TranscriptObjectStore,
    private readonly now: () => Date,
    private readonly authorizeRead: (
      actor: Actor,
      projectId: string,
    ) => Promise<void>,
    private readonly logClip: (
      actor: Actor,
      projectId: string,
      input: CreateClipCandidateRequest,
      sourceId: string,
    ) => Promise<ClipCandidate>,
  ) {}

  async getSource(actor: Actor, projectId: string, id: string) {
    await this.authorizeRead(actor, projectId);
    return readLibrarySource(this.db, projectId, id);
  }
  async listSources(actor: Actor, projectId: string, input: SourceListQuery) {
    await this.authorizeRead(actor, projectId);
    return listLibrarySources(this.db, projectId, input);
  }
  async getItem(actor: Actor, projectId: string, id: string) {
    await this.authorizeRead(actor, projectId);
    return (await readLibraryItemRow(this.db, projectId, id)).item;
  }
  async listItems(actor: Actor, projectId: string, input: ItemListQuery) {
    await this.authorizeRead(actor, projectId);
    return listLibraryItems(this.db, projectId, input);
  }
  private write<T>(
    actor: Actor,
    projectId: string,
    work: (tx: Session) => Promise<T>,
  ) {
    return catalogTransaction(this.db, async (tx) => {
      const member = await tx.query<{ role: ProjectRole }>(
        `SELECT m.role FROM project_members m
        JOIN users u ON u.id=m.user_id WHERE m.project_id=$1 AND u.id=$2 AND u.external_subject=$3
        FOR SHARE OF m`,
        [projectId, actor.userId, actor.externalSubject],
      );
      requirePermission(member.rows[0]?.role, "write");
      return work(tx);
    });
  }
  async createSource(
    actor: Actor,
    projectId: string,
    input: CreateSourceRequest,
  ) {
    return this.write(actor, projectId, async (tx) => {
      const retry =
        input.idempotencyKey === undefined
          ? undefined
          : createRetry(CreateSourceRequestSchema.parse(input));
      if (retry || input.kind === "web_page")
        await lockSourceIdentity(tx, projectId);
      const replay = () =>
        readCreateReplay(tx, "library_sources", projectId, actor.userId, retry);
      const existing = await replay();
      if (existing) return readLibrarySource(tx, projectId, existing);

      const url = input.bibliography.url?.value;
      if (input.kind === "web_page" && url !== undefined) {
        const match = await findArticle(tx, projectId, articleIdentity(url));
        if (match) {
          if (retry) {
            await tx.query(
              `INSERT INTO library_source_reuse_receipts(
                 project_id,actor_id,idempotency_key,create_fingerprint,source_id
               ) VALUES($1,$2,$3,$4,$5)`,
              [projectId, actor.userId, retry.key, retry.fingerprint, match],
            );
          }
          return readLibrarySource(tx, projectId, match);
        }
      }

      let id: string = randomUUID();
      if (input.kind === "youtube") {
        const identity = input.sourceIdentity!;
        const reserved = await tx.query<{ id: string | null }>(
          "SELECT library_youtube_id($1,$2,$3) AS id",
          [id, identity.providerMediaId, identity.canonicalUrl],
        );
        if (!reserved.rows[0]?.id)
          throw new CatalogConflictError(
            "This video ID belongs to a different provider.",
          );
        id = reserved.rows[0].id;
      }
      if (
        !(await insertLibrarySource(
          tx,
          projectId,
          id,
          actor.userId,
          input,
          retry,
        ))
      ) {
        const winner = await replay();
        if (winner) return readLibrarySource(tx, projectId, winner);
        throw new CatalogConflictError(
          "This source is already in the project.",
        );
      }
      return readLibrarySource(tx, projectId, id);
    });
  }
  async updateSource(
    actor: Actor,
    projectId: string,
    id: string,
    input: UpdateSourceRequest,
  ) {
    return this.write(actor, projectId, async (tx) => {
      const newUrl = input.bibliography?.url;
      if (newUrl !== undefined) await lockSourceIdentity(tx, projectId);
      const current = await readLibrarySource(tx, projectId, id);
      if (current.kind === "web_page" && newUrl) {
        const identity = articleIdentity(newUrl.value);
        const oldUrl = current.bibliography.url?.value;
        if (
          (oldUrl === undefined || articleIdentity(oldUrl) !== identity) &&
          (await findArticle(tx, projectId, identity, id))
        ) {
          throw new CatalogConflictError(
            "This article already has a source in the project.",
          );
        }
      }
      // The response schema checks details against the immutable source kind.
      if (input.details)
        LibrarySourceSchema.parse({ ...current, details: input.details });
      const saved = await tx.query(
        `UPDATE library_sources SET
        bibliography=CASE WHEN $4::jsonb IS NULL THEN bibliography ELSE COALESCE(bibliography,'{}'::jsonb) || $4 END,
        details=COALESCE($5::jsonb,details),version=version+1
        WHERE project_id=$1 AND id=$2 AND version=$3 RETURNING id`,
        [
          projectId,
          id,
          input.expectedVersion,
          input.bibliography ? JSON.stringify(input.bibliography) : null,
          input.details ? JSON.stringify(input.details) : null,
        ],
      );
      if (!saved.rows.length)
        throw new CatalogConflictError(
          "Reload the updated source before saving edits.",
        );
      return readLibrarySource(tx, projectId, id);
    });
  }
  async createTranscriptClip(
    actor: Actor,
    projectId: string,
    input: CreateTranscriptClipItemRequest,
  ) {
    const source = await this.getSource(actor, projectId, input.sourceId);
    if (
      source.kind !== "youtube" ||
      (source.sourceIdentity?.providerMediaId ?? source.providerMediaId) !==
        input.clip.video.youtubeVideoId
    )
      throw new CatalogConflictError(
        "Clip evidence must identify the selected YouTube source.",
      );
    const clip = await this.logClip(
      actor,
      projectId,
      input.clip,
      input.sourceId,
    );
    return this.getItem(actor, projectId, clip.id);
  }
  async createItem(actor: Actor, projectId: string, input: CreateItemRequest) {
    return this.write(actor, projectId, async (tx) => {
      const retry =
        input.idempotencyKey === undefined
          ? undefined
          : createRetry(CreateItemRequestSchema.parse(input));
      const replay = () =>
        readCreateReplay(tx, "library_items", projectId, actor.userId, retry);
      const existing = await replay();
      if (existing)
        return (await readLibraryItemRow(tx, projectId, existing)).item;

      const source = await readLibrarySource(tx, projectId, input.sourceId);
      if (input.kind === "clip" && source.kind === "youtube")
        throw new CatalogConflictError(
          "Logging a YouTube clip requires its transcript selection and idempotency key in the clip field.",
        );
      const id = randomUUID();
      const now = this.now().toISOString();
      if (
        !(await insertLibraryItem(
          tx,
          projectId,
          id,
          actor.userId,
          now,
          input,
          retry,
        ))
      ) {
        const winner = await replay();
        if (winner)
          return (await readLibraryItemRow(tx, projectId, winner)).item;
        throw new CatalogConflictError("Reload the Library before retrying.");
      }
      return (await readLibraryItemRow(tx, projectId, id)).item;
    });
  }
  async publishStill(actor: Actor, projectId: string, input: StillPublication) {
    const { idempotencyKey, title, credit, licence, usageNote, topics } =
      input.metadata;
    const content: StillContent = { title, credit, licence, usageNote };
    const { kind, crop, parentItemId, inputSha256, sourceUrl } =
      input.provenance;
    const retry = {
      key: idempotencyKey,
      fingerprint: createHash("sha256")
        .update(
          JSON.stringify({
            metadata: input.metadata,
            kind,
            crop,
            parentItemId,
            inputSha256,
            url: kind === "url" ? sourceUrl : undefined,
            sourceId: "id" in input.source ? input.source.id : undefined,
          }),
        )
        .digest("hex"),
    };
    const replay = async (tx: Session) => {
      const id = await readCreateReplay(
        tx,
        "library_items",
        projectId,
        actor.userId,
        retry,
      );
      if (id) return (await readLibraryItemRow(tx, projectId, id)).item;
    };
    const existing = await this.write(actor, projectId, replay);
    if (existing) return existing;

    const id = randomUUID();
    const references = await keepStillAssets(
      this.store,
      projectId,
      id,
      input.images,
    );

    // Only the transaction makes the verified objects reachable. A failed
    // transaction may leave unreferenced versions, never a partially saved still.
    return this.write(actor, projectId, async (tx) => {
      await lockSourceIdentity(tx, projectId);
      const winner = await replay(tx);
      if (winner) return winner;

      let sourceId: string;
      if ("id" in input.source) {
        sourceId = input.source.id;
        const source = await readLibrarySource(tx, projectId, sourceId);
        if (
          input.provenance.kind === "page_picture" &&
          source.kind !== "web_page"
        ) {
          throw new CatalogConflictError(
            "Choose a web-page source for the picture.",
          );
        }
      } else {
        sourceId = randomUUID();
        if (
          !(await insertLibrarySource(
            tx,
            projectId,
            sourceId,
            actor.userId,
            input.source.create,
          ))
        ) {
          throw new CatalogConflictError(
            "Could not create the image source. Try again.",
          );
        }
      }
      const inserted = await insertLibraryItem(
        tx,
        projectId,
        id,
        actor.userId,
        this.now().toISOString(),
        { kind: "still", sourceId, content, notes: "", topics },
        retry,
      );
      if (!inserted)
        throw new CatalogConflictError(
          "This idempotency key was already used for a different request.",
        );
      await insertStillAssets(tx, projectId, id, references, input.provenance);
      return (await readLibraryItemRow(tx, projectId, id)).item;
    });
  }

  async createExtensionCapture(
    actor: Actor,
    projectId: string,
    request: ExtensionCaptureRequest,
    rasters: ExtensionCaptureRasters,
  ): Promise<ExtensionCaptureReceipt> {
    const input = ExtensionCaptureRequestSchema.parse(request);
    const captureId = input.requestId;
    const fingerprint = extensionCaptureFingerprint(input);
    const replay = async (tx: Session) => {
      const { rows } = await tx.query<{
        actor_id: string;
        request_fingerprint: string;
      }>(
        `SELECT actor_id,request_fingerprint FROM extension_captures
         WHERE project_id=$1 AND capture_id=$2`,
        [projectId, captureId],
      );
      const existing = rows[0];
      if (!existing) return undefined;
      if (
        existing.actor_id !== actor.userId ||
        existing.request_fingerprint !== fingerprint
      )
        throw new CatalogConflictError(
          "This capture request key is already in use.",
        );
      return readExtensionCaptureReceipt(tx, projectId, captureId);
    };
    const lock = (tx: Session) =>
      tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 79))", [
        `${projectId}:${captureId}`,
      ]);

    // A successful earlier transaction should never rewrite its immutable
    // images. This check also gives retries the original receipt before any
    // object-store work occurs.
    const earlier = await this.write(actor, projectId, async (tx) => {
      await lock(tx);
      return replay(tx);
    });
    if (earlier) return earlier;

    const references = await keepExtensionCaptureAssets(
      this.store,
      projectId,
      captureId,
      rasters,
    );
    return this.write(actor, projectId, async (tx) => {
      await lock(tx);
      const alreadySaved = await replay(tx);
      if (alreadySaved) return alreadySaved;

      const sourceRequest = captureSourceRequest(input);
      let sourceId: string | undefined;
      if (input.kind !== "audio") {
        await lockSourceIdentity(tx, projectId);
        const url = sourceRequest.bibliography.url?.value;
        if (!url)
          throw new CatalogConflictError("A page capture needs its URL.");
        sourceId = await findArticle(tx, projectId, articleIdentity(url));
      }
      if (!sourceId) {
        const retry = createRetry(sourceRequest);
        sourceId = randomUUID();
        if (
          !(await insertLibrarySource(
            tx,
            projectId,
            sourceId,
            actor.userId,
            sourceRequest,
            retry,
          ))
        ) {
          sourceId = await readCreateReplay(
            tx,
            "library_sources",
            projectId,
            actor.userId,
            retry,
          );
          if (!sourceId)
            throw new CatalogConflictError(
              "The source could not be saved. Try again.",
            );
        }
      }

      let itemId: string | undefined;
      if (input.kind === "quote") {
        const itemRequest = captureItemRequest(input, sourceId);
        const itemRetry = createRetry(itemRequest);
        const existingItem = await readCreateReplay(
          tx,
          "library_items",
          projectId,
          actor.userId,
          itemRetry,
        );
        itemId = existingItem ?? randomUUID();
        if (!existingItem) {
          if (
            !(await insertLibraryItem(
              tx,
              projectId,
              itemId,
              actor.userId,
              this.now().toISOString(),
              itemRequest,
              itemRetry,
            ))
          ) {
            const winner = await readCreateReplay(
              tx,
              "library_items",
              projectId,
              actor.userId,
              itemRetry,
            );
            if (!winner)
              throw new CatalogConflictError(
                "The quote could not be saved. Try again.",
              );
            itemId = winner;
          }
        }
      }

      const now = this.now().toISOString();
      await tx.query(
        `INSERT INTO extension_captures(
             project_id,capture_id,actor_id,kind,request_fingerprint,
             source_id,item_id,page_url,created_at
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          projectId,
          captureId,
          actor.userId,
          input.kind,
          fingerprint,
          sourceId,
          itemId ?? null,
          capturePageUrl(input),
          now,
        ],
      );
      await insertExtensionCaptureAssets(
        tx,
        projectId,
        captureId,
        sourceId,
        itemId,
        references,
        input.url,
        actor.userId,
        now,
      );
      return readExtensionCaptureReceipt(tx, projectId, captureId);
    });
  }

  async getExtensionCapture(
    actor: Actor,
    projectId: string,
    captureId: string,
  ) {
    await this.authorizeRead(actor, projectId);
    return readExtensionCaptureReceipt(this.db, projectId, captureId);
  }

  async getExtensionCaptureAsset(
    actor: Actor,
    projectId: string,
    captureId: string,
    role: ExtensionCaptureAssetRole,
    revisionId?: string,
  ) {
    await this.authorizeRead(actor, projectId);
    return readExtensionCaptureAsset(
      this.db,
      this.store,
      projectId,
      captureId,
      role,
      revisionId,
    );
  }

  async getExtensionCaptureForItem(
    actor: Actor,
    projectId: string,
    itemId: string,
  ) {
    await this.authorizeRead(actor, projectId);
    const { rows } = await this.db.query<{ capture_id: string }>(
      `SELECT capture_id FROM extension_captures
       WHERE project_id=$1 AND item_id=$2 ORDER BY created_at DESC, capture_id
       LIMIT 1`,
      [projectId, itemId],
    );
    const captureId = rows[0]?.capture_id;
    if (!captureId)
      throw new CatalogNotFoundError(
        "No browser capture is linked to this item.",
      );
    return readExtensionCaptureReceipt(this.db, projectId, captureId);
  }

  async listExtensionCapturesForSource(
    actor: Actor,
    projectId: string,
    sourceId: string,
    offset: number,
  ) {
    await this.authorizeRead(actor, projectId);
    const { rows } = await this.db.query<{ capture_id: string }>(
      `SELECT capture_id FROM extension_captures
       WHERE project_id=$1 AND source_id=$2 ORDER BY created_at DESC, capture_id LIMIT 50 OFFSET $3`,
      [projectId, sourceId, offset],
    );
    return Promise.all(
      rows.map(({ capture_id }) =>
        readExtensionCaptureReceipt(this.db, projectId, capture_id),
      ),
    );
  }

  async getStillManifest(actor: Actor, projectId: string, itemId: string) {
    await this.authorizeRead(actor, projectId);
    return readStillManifest(this.db, projectId, itemId);
  }

  async getStillObject(
    actor: Actor,
    projectId: string,
    itemId: string,
    role: StillAssetRole,
  ) {
    await this.authorizeRead(actor, projectId);
    return readStillObject(this.db, this.store, projectId, itemId, role);
  }

  async updateItem(
    actor: Actor,
    projectId: string,
    id: string,
    input: UpdateItemRequest,
  ) {
    return this.write(actor, projectId, async (tx) => {
      const { item, legacy } = await readLibraryItemRow(tx, projectId, id);
      if ("latestDisplayText" in input) {
        if (item.kind !== "quote")
          throw new CatalogConflictError("Only quotes have display text.");
        const { rows } = await tx.query(
          `UPDATE library_items SET content=jsonb_set(content,'{latestDisplayText}',to_jsonb($4::text)),
             version=version+1,updated_at=$5
           WHERE project_id=$1 AND id=$2 AND version=$3 AND kind='quote' RETURNING id`,
          [
            projectId,
            id,
            input.expectedVersion,
            input.latestDisplayText,
            this.now().toISOString(),
          ],
        );
        if (!rows.length)
          throw new CatalogConflictError(
            "Reload the updated item before saving edits.",
          );
        return (await readLibraryItemRow(tx, projectId, id)).item;
      }
      const content =
        item.kind === "quote" &&
        input.content &&
        item.content.latestDisplayText !== undefined
          ? {
              ...input.content,
              latestDisplayText: item.content.latestDisplayText,
            }
          : (input.content ?? item.content);
      const updated = LibraryItemSchema.parse({
        ...item,
        content,
      });
      const now = this.now().toISOString();
      let saved;
      if (legacy && item.kind === "clip" && updated.kind === "clip") {
        const before = item.content;
        const after = updated.content;
        if (
          before.startMs !== after.startMs ||
          before.endMs !== after.endMs ||
          before.text !== after.text ||
          before.originalText !== after.originalText
        )
          throw new CatalogConflictError(
            "Existing transcript evidence is immutable.",
          );
        saved = await tx.query(
          `UPDATE clip_candidates SET library_title=$4,library_speaker=$5,notes=COALESCE($6,notes),
          version=version+1,updated_at=$7 WHERE project_id=$1 AND id=$2 AND version=$3 RETURNING id`,
          [
            projectId,
            id,
            input.expectedVersion,
            after.title ?? null,
            after.speaker ?? null,
            input.notes ?? null,
            now,
          ],
        );
      } else {
        saved = await tx.query(
          `UPDATE library_items SET content=$4,notes=COALESCE($5,notes),version=version+1,updated_at=$6
          WHERE project_id=$1 AND id=$2 AND version=$3 RETURNING id`,
          [
            projectId,
            id,
            input.expectedVersion,
            JSON.stringify(updated.content),
            input.notes ?? null,
            now,
          ],
        );
      }
      if (!saved.rows.length)
        throw new CatalogConflictError(
          "Reload the updated item before saving edits.",
        );
      if (input.topics) {
        await tx.query(
          legacy
            ? "DELETE FROM clip_candidate_tags WHERE clip_id=$1"
            : "DELETE FROM library_item_topics WHERE item_id=$1",
          [id],
        );
        await addTopics(tx, legacy, projectId, id, input.topics, now);
      }
      if (legacy) {
        const fields = [
          ...(input.notes === undefined ? [] : ["notes"]),
          ...(input.topics === undefined ? [] : ["tags"]),
          ...(input.content === undefined ? [] : ["content"]),
        ];
        await tx.query(
          `INSERT INTO sync_events(project_id,event_type,entity_id,server_version,payload,created_at)
          VALUES($1,'clip_candidate.updated',$2,$3,$4,$5)`,
          [
            projectId,
            id,
            input.expectedVersion + 1,
            JSON.stringify({ clipId: id, fields }),
            now,
          ],
        );
      }
      return (await readLibraryItemRow(tx, projectId, id)).item;
    });
  }

  async deleteQuote(
    actor: Actor,
    projectId: string,
    id: string,
    expectedVersion: number,
  ) {
    await this.write(actor, projectId, async (tx) => {
      const { item } = await readLibraryItemRow(tx, projectId, id);
      if (item.kind !== "quote")
        throw new CatalogNotFoundError("Quote not found.");
      const { rows } = await tx.query(
        `DELETE FROM library_items WHERE project_id=$1 AND id=$2 AND version=$3 AND kind='quote'
         RETURNING id`,
        [projectId, id, expectedVersion],
      );
      if (!rows.length)
        throw new CatalogConflictError(
          "Reload the updated quote before deleting it.",
        );
    });
  }
}
