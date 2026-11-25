import {
  ChangeProjectBookmarkStateRequestSchema,
  CreateProjectBookmarkRequestSchema,
  LocalProjectBookmarkPageSchema,
  OfflineProjectBookmarkMutationResultSchema,
  OfflineProjectBookmarkReplayResultSchema,
  ProjectBookmarkPageSchema,
  ProjectBookmarkQuerySchema,
  ProjectBookmarkSchema,
  UpdateProjectBookmarkRequestSchema,
  type ChangeProjectBookmarkStateRequest,
  type CreateProjectBookmarkRequest,
  type LocalProjectBookmarkPage,
  type OfflineProjectBookmarkMutationResult,
  type OfflineProjectBookmarkReplayResult,
  type ProjectBookmark,
  type ProjectBookmarkPage,
  type ProjectBookmarkQuery,
  type UpdateProjectBookmarkRequest,
} from "@research-video/contracts";
import {
  LocalProjectBookmarkRepository,
  clipLibraryAuthorizationScope,
  type LocalBookmarkOutboxRecord,
} from "@research-video/db-local";

export type BookmarkOutboxCommand =
  | {
      commandType: "bookmark.create.v1";
      projectId: string;
      command: CreateProjectBookmarkRequest;
    }
  | {
      commandType: "bookmark.update.v1";
      projectId: string;
      bookmarkId: string;
      command: UpdateProjectBookmarkRequest;
    }
  | {
      commandType: "bookmark.archive.v1" | "bookmark.restore.v1";
      projectId: string;
      bookmarkId: string;
      command: ChangeProjectBookmarkStateRequest;
    };

export interface BookmarkOutboxTransport {
  list(input: {
    projectId: string;
    query: ProjectBookmarkQuery;
    authorization: string;
  }): Promise<ProjectBookmarkPage>;
  send(
    command: BookmarkOutboxCommand,
    authorization: string,
  ): Promise<ProjectBookmark>;
}

export class LocalProjectBookmarkUnavailableError extends Error {
  readonly statusCode = 503;
  readonly code = "project_bookmarks_unavailable";

  constructor() {
    super("Bookmarks are unavailable and no matching authorized cache exists.");
  }
}

/** Authorized cache plus ordered, restart-safe bookmark mutation replay. */
export class BookmarkOutboxService {
  constructor(
    private readonly repository: LocalProjectBookmarkRepository,
    private readonly transport: BookmarkOutboxTransport,
  ) {}

  async list(
    projectId: string,
    authorization: string,
    input: ProjectBookmarkQuery,
  ): Promise<LocalProjectBookmarkPage> {
    const query = ProjectBookmarkQuerySchema.parse(input);
    const authorizationScopeSha256 =
      clipLibraryAuthorizationScope(authorization);
    try {
      const page = ProjectBookmarkPageSchema.parse(
        await this.transport.list({ projectId, query, authorization }),
      );
      const cached = this.repository.storeAuthorizedPage({
        authorizationScopeSha256,
        projectId,
        query,
        page,
      });
      return LocalProjectBookmarkPageSchema.parse({
        ...cached.page,
        freshness: "fresh",
        cachedAt: cached.cachedAt,
        outbox: this.repository.list({
          authorizationScopeSha256,
          projectId,
        }),
      });
    } catch (error) {
      const statusCode = readStatusCode(error);
      if (statusCode === 401) {
        this.repository.purgeAuthorizationScope(authorizationScopeSha256);
        throw error;
      }
      if (statusCode === 403) {
        this.repository.purgeScope(projectId, authorizationScopeSha256);
        throw error;
      }
      if (statusCode !== undefined && statusCode < 500) throw error;
      const cached = this.repository.getAuthorizedPage({
        authorizationScopeSha256,
        projectId,
        query,
      });
      if (!cached) throw new LocalProjectBookmarkUnavailableError();
      return LocalProjectBookmarkPageSchema.parse({
        ...cached.page,
        freshness: "stale",
        cachedAt: cached.cachedAt,
        outbox: this.repository.list({
          authorizationScopeSha256,
          projectId,
        }),
      });
    }
  }

  create(
    projectId: string,
    authorization: string,
    input: CreateProjectBookmarkRequest,
  ): Promise<OfflineProjectBookmarkMutationResult> {
    const command = CreateProjectBookmarkRequestSchema.parse(input);
    return this.enqueue(
      { commandType: "bookmark.create.v1", projectId, command },
      authorization,
    );
  }

  update(
    projectId: string,
    bookmarkId: string,
    authorization: string,
    input: UpdateProjectBookmarkRequest,
  ): Promise<OfflineProjectBookmarkMutationResult> {
    const command = UpdateProjectBookmarkRequestSchema.parse(input);
    return this.enqueue(
      { commandType: "bookmark.update.v1", projectId, bookmarkId, command },
      authorization,
    );
  }

  changeState(
    projectId: string,
    bookmarkId: string,
    action: "archive" | "restore",
    authorization: string,
    input: ChangeProjectBookmarkStateRequest,
  ): Promise<OfflineProjectBookmarkMutationResult> {
    const command = ChangeProjectBookmarkStateRequestSchema.parse(input);
    return this.enqueue(
      { commandType: `bookmark.${action}.v1`, projectId, bookmarkId, command },
      authorization,
    );
  }

  async replay(
    projectId: string,
    authorization: string,
  ): Promise<OfflineProjectBookmarkReplayResult> {
    const authorizationScopeSha256 =
      clipLibraryAuthorizationScope(authorization);
    let applied = 0;
    let conflicts = 0;
    let queued = 0;
    for (const persisted of this.repository.due({
      authorizationScopeSha256,
      projectId,
      limit: 50,
    })) {
      const result = await this.apply(persisted, authorization);
      if (result.state === "applied") applied += 1;
      else if (result.state === "conflict") conflicts += 1;
      else {
        queued += 1;
        break;
      }
    }
    return OfflineProjectBookmarkReplayResultSchema.parse({
      applied,
      conflicts,
      queued,
    });
  }

  listOutbox(projectId: string, authorization: string) {
    return this.repository.list({
      authorizationScopeSha256: clipLibraryAuthorizationScope(authorization),
      projectId,
    });
  }

  private async enqueue(
    command: BookmarkOutboxCommand,
    authorization: string,
  ): Promise<OfflineProjectBookmarkMutationResult> {
    const authorizationScopeSha256 =
      clipLibraryAuthorizationScope(authorization);
    const outboxId = this.repository.enqueue({
      authorizationScopeSha256,
      projectId: command.projectId,
      ...(command.commandType === "bookmark.create.v1"
        ? {}
        : { bookmarkId: command.bookmarkId }),
      commandType: command.commandType,
      idempotencyKey: command.command.idempotencyKey,
      request: command.command,
    });
    const persisted = this.repository.get(outboxId);
    if (!persisted) throw new Error("Persisted bookmark command is missing.");
    return this.apply(persisted, authorization);
  }

  private async apply(
    persisted: LocalBookmarkOutboxRecord,
    authorization: string,
  ): Promise<OfflineProjectBookmarkMutationResult> {
    if (persisted.state === "conflict") {
      return this.retainedResult("conflict", persisted);
    }
    const command = parsePersistedCommand(persisted);
    try {
      const bookmark = ProjectBookmarkSchema.parse(
        await this.transport.send(command, authorization),
      );
      this.repository.storeBookmark({
        authorizationScopeSha256: persisted.accountId,
        bookmark,
      });
      this.repository.acknowledge(persisted.outboxId);
      return OfflineProjectBookmarkMutationResultSchema.parse({
        state: "applied",
        outboxId: persisted.outboxId,
        bookmark,
      });
    } catch (error) {
      const statusCode = readStatusCode(error);
      if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
        this.repository.recordConflict(
          persisted.outboxId,
          readErrorCode(error),
          error instanceof Error ? error.message : "Bookmark command conflict.",
        );
        if (statusCode === 401) {
          this.repository.purgeAuthorizationScope(persisted.accountId);
        } else if (statusCode === 403) {
          this.repository.purgeScope(persisted.projectId, persisted.accountId);
        }
        return this.retainedResult("conflict", persisted);
      }
      this.repository.retry(persisted.outboxId);
      return this.retainedResult("queued", persisted);
    }
  }

  private retainedResult(
    state: "queued" | "conflict",
    persisted: LocalBookmarkOutboxRecord,
  ): OfflineProjectBookmarkMutationResult {
    const command = this.repository
      .list({
        authorizationScopeSha256: persisted.accountId,
        projectId: persisted.projectId,
      })
      .find((entry) => entry.outboxId === persisted.outboxId);
    return OfflineProjectBookmarkMutationResultSchema.parse({
      state,
      outboxId: persisted.outboxId,
      command,
    });
  }
}

function parsePersistedCommand(
  persisted: LocalBookmarkOutboxRecord,
): BookmarkOutboxCommand {
  if (persisted.commandType === "bookmark.create.v1") {
    return {
      commandType: persisted.commandType,
      projectId: persisted.projectId,
      command: CreateProjectBookmarkRequestSchema.parse(persisted.request),
    };
  }
  if (!persisted.bookmarkId) {
    throw new Error("Bookmark mutation is missing its stable bookmark ID.");
  }
  if (persisted.commandType === "bookmark.update.v1") {
    return {
      commandType: persisted.commandType,
      projectId: persisted.projectId,
      bookmarkId: persisted.bookmarkId,
      command: UpdateProjectBookmarkRequestSchema.parse(persisted.request),
    };
  }
  return {
    commandType: persisted.commandType,
    projectId: persisted.projectId,
    bookmarkId: persisted.bookmarkId,
    command: ChangeProjectBookmarkStateRequestSchema.parse(persisted.request),
  };
}

function readStatusCode(error: unknown): number | undefined {
  const statusCode = (error as { statusCode?: unknown })?.statusCode;
  return typeof statusCode === "number" ? statusCode : undefined;
}

function readErrorCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" && code.length <= 160
    ? code
    : "bookmark_conflict";
}
