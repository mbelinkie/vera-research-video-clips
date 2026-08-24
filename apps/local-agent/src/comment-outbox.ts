import { z } from "zod";

import {
  ClipCommentSchema,
  CreateClipCommentRequestSchema,
  DeleteClipCommentRequestSchema,
  OfflineClipCommentCommandTypeSchema,
  UpdateClipCommentRequestSchema,
  type ClipComment,
  type CreateClipCommentRequest,
  type DeleteClipCommentRequest,
  type OfflineClipCommentCommandType,
  type OfflineClipCommentMutationResult,
  type OfflineClipCommentReplayResult,
  type UpdateClipCommentRequest,
} from "@research-video/contracts";
import { OfflineOutbox, type OutboxCommand } from "@research-video/sync";

const QueuedCommentPayloadSchema = z.discriminatedUnion("commandType", [
  z
    .object({
      commandType: z.literal("clip_comment.create.v1"),
      clipId: z.string().uuid(),
      command: CreateClipCommentRequestSchema,
    })
    .strict(),
  z
    .object({
      commandType: z.literal("clip_comment.update.v1"),
      clipId: z.string().uuid(),
      commentId: z.string().uuid(),
      command: UpdateClipCommentRequestSchema,
    })
    .strict(),
  z
    .object({
      commandType: z.literal("clip_comment.delete.v1"),
      clipId: z.string().uuid(),
      commentId: z.string().uuid(),
      command: DeleteClipCommentRequestSchema,
    })
    .strict(),
]);

export type ClipCommentCloudCommand = z.infer<
  typeof QueuedCommentPayloadSchema
> & { projectId: string; authorization: string };

export interface ClipCommentOutboxTransport {
  send(command: ClipCommentCloudCommand): Promise<ClipComment>;
  authorizationRevoked?(
    projectId: string,
    authorization: string,
    statusCode: 401 | 403,
  ): void;
}

export class ClipCommentOutboxService {
  constructor(
    private readonly outbox: OfflineOutbox,
    private readonly transport: ClipCommentOutboxTransport,
  ) {}

  create(
    projectId: string,
    clipId: string,
    authorization: string,
    request: CreateClipCommentRequest,
  ): Promise<OfflineClipCommentMutationResult> {
    const command = CreateClipCommentRequestSchema.parse(request);
    const outboxId = this.outbox.enqueueClipCommentCreate(
      projectId,
      clipId,
      command,
    );
    return this.apply(outboxId, projectId, authorization, {
      commandType: "clip_comment.create.v1",
      clipId,
      command,
    });
  }

  update(
    projectId: string,
    clipId: string,
    commentId: string,
    authorization: string,
    request: UpdateClipCommentRequest,
  ): Promise<OfflineClipCommentMutationResult> {
    const command = UpdateClipCommentRequestSchema.parse(request);
    const outboxId = this.outbox.enqueueClipCommentUpdate(
      projectId,
      clipId,
      commentId,
      command,
    );
    return this.apply(outboxId, projectId, authorization, {
      commandType: "clip_comment.update.v1",
      clipId,
      commentId,
      command,
    });
  }

  delete(
    projectId: string,
    clipId: string,
    commentId: string,
    authorization: string,
    request: DeleteClipCommentRequest,
  ): Promise<OfflineClipCommentMutationResult> {
    const command = DeleteClipCommentRequestSchema.parse(request);
    const outboxId = this.outbox.enqueueClipCommentDelete(
      projectId,
      clipId,
      commentId,
      command,
    );
    return this.apply(outboxId, projectId, authorization, {
      commandType: "clip_comment.delete.v1",
      clipId,
      commentId,
      command,
    });
  }

  async replay(
    projectId: string,
    authorization: string,
  ): Promise<OfflineClipCommentReplayResult> {
    let applied = 0;
    let queued = 0;
    let conflicts = 0;
    for (const queuedCommand of this.outbox.due(50)) {
      if (
        queuedCommand.projectId !== projectId ||
        !OfflineClipCommentCommandTypeSchema.safeParse(
          queuedCommand.commandType,
        ).success
      ) {
        continue;
      }
      const command = parseQueuedCommand(queuedCommand);
      const result = await this.apply(
        queuedCommand.id,
        projectId,
        authorization,
        command,
      );
      if (result.state === "applied") applied += 1;
      else if (result.state === "queued") queued += 1;
      else conflicts += 1;
      if (result.state === "queued") break;
    }
    return { applied, queued, conflicts };
  }

  conflicts(projectId: string) {
    return this.outbox
      .list(projectId)
      .filter(
        (command) =>
          command.conflict !== undefined &&
          OfflineClipCommentCommandTypeSchema.safeParse(command.commandType)
            .success,
      )
      .map((command) => ({
        outboxId: command.id,
        commandType: OfflineClipCommentCommandTypeSchema.parse(
          command.commandType,
        ),
        code: command.lastErrorCode ?? "conflict",
        createdAt: command.createdAt,
      }));
  }

  private async apply(
    outboxId: string,
    projectId: string,
    authorization: string,
    command: z.infer<typeof QueuedCommentPayloadSchema>,
  ): Promise<OfflineClipCommentMutationResult> {
    const persisted = this.outbox.get(outboxId);
    const commandType = OfflineClipCommentCommandTypeSchema.parse(
      command.commandType,
    );
    if (persisted?.conflict !== undefined) {
      return {
        state: "conflict",
        outboxId,
        commandType,
        code: persisted.lastErrorCode ?? "conflict",
      };
    }
    try {
      const comment = ClipCommentSchema.parse(
        await this.transport.send({ ...command, projectId, authorization }),
      );
      this.outbox.acknowledge(outboxId);
      return { state: "applied", outboxId, comment };
    } catch (error) {
      const statusCode = readStatusCode(error);
      if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
        const code = readErrorCode(error);
        this.outbox.recordConflict(outboxId, code, {
          statusCode,
          code,
        });
        if (statusCode === 401 || statusCode === 403) {
          this.transport.authorizationRevoked?.(
            projectId,
            authorization,
            statusCode,
          );
        }
        return { state: "conflict", outboxId, commandType, code };
      }
      this.outbox.retry(outboxId);
      return { state: "queued", outboxId, commandType };
    }
  }
}

function parseQueuedCommand(
  queued: OutboxCommand,
): z.infer<typeof QueuedCommentPayloadSchema> {
  const payload = z
    .object({
      clipId: z.string().uuid(),
      commentId: z.string().uuid().optional(),
      command: z.unknown(),
    })
    .passthrough()
    .parse(queued.payload);
  return QueuedCommentPayloadSchema.parse({
    commandType: queued.commandType,
    ...payload,
  });
}

function readStatusCode(error: unknown): number | undefined {
  const statusCode = (error as { statusCode?: unknown })?.statusCode;
  return typeof statusCode === "number" ? statusCode : undefined;
}

function readErrorCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" && code.length <= 160
    ? code
    : "comment_conflict";
}
