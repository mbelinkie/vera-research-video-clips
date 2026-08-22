import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { ExportRequest } from "@research-video/contracts";
import type { LocalExportQueue } from "@research-video/db-local";
import { sha256Fingerprint } from "@research-video/export-settings";
import {
  acquireExportSourceScratch,
  assertEditingFriendlySourceCompatibility,
  cleanupExportSourceScratch,
  inspectVerifiedExportSource,
  type AcquiredExportSource,
  type ExportSourceAcquisitionProvider,
  type ExportSourceInspection,
  type ExportSourceInspector,
} from "@research-video/media";

const SharedSourceAttempt = 1;
const DefaultJoinWindowMs = 20;

type SharedMember = {
  request: ExportRequest;
  attempt: number;
  signal?: AbortSignal;
  handoff(input: {
    source: AcquiredExportSource;
    inspection: ExportSourceInspection;
    sourceDirectory: string;
    stagingDirectory: string;
  }): Promise<void>;
  sourceReady(source: {
    provider: string;
    sourceIdentity: string;
    byteSize: number;
    contentSha256: string;
  }): void;
  cleanupStarted(): void;
  cleanupSucceeded(): void;
  cleanupFailed(message: string): void;
  resolve(grouped: boolean): void;
  reject(error: unknown): void;
};

type Rendezvous = {
  compatibilityKey: string;
  members: SharedMember[];
  closed: boolean;
};

/**
 * Coordinates only the physical source lifetime. Each member remains an
 * independent invocation of the existing request processor.
 */
export class LocalLoggedExportSourceGroupCoordinator {
  private readonly rendezvous = new Map<string, Rendezvous>();

  constructor(
    private readonly queue: LocalExportQueue,
    private readonly provider: ExportSourceAcquisitionProvider,
    private readonly inspector: ExportSourceInspector,
    private readonly dataRoot: string,
    private readonly acquisitionProfileFingerprint = sha256Fingerprint({
      schemaVersion: 1,
      providerProfile: "authorized-youtube-full-source",
    }),
    private readonly joinWindowMs = DefaultJoinWindowMs,
  ) {}

  async run(input: Omit<SharedMember, "resolve" | "reject">): Promise<boolean> {
    const delivery = this.queue.getAcceptedLoggedDelivery(input.request.id);
    if (
      input.request.mode !== "logged" ||
      !delivery?.sourceGroup ||
      !this.queue.getLoggedExecution(input.request.id)
    ) {
      return false;
    }
    const compatibilityKey = sha256Fingerprint({
      schemaVersion: 1,
      projectId: input.request.projectId,
      batchId: delivery.sourceGroup.batchId,
      youtubeVideoId: input.request.video.youtubeVideoId,
      canonicalUrl: input.request.video.canonicalUrl,
      workerId: delivery.workerId,
      workerEpoch: delivery.workerEpoch,
      acquisitionProfileFingerprint: this.acquisitionProfileFingerprint,
    });
    if (
      this.queue.getLoggedExportSourceGroupByCompatibilityKey(compatibilityKey)
    ) {
      return false;
    }

    return await new Promise<boolean>((resolve, reject) => {
      let group = this.rendezvous.get(compatibilityKey);
      if (group?.closed) {
        resolve(false);
        return;
      }
      if (!group) {
        group = { compatibilityKey, members: [], closed: false };
        this.rendezvous.set(compatibilityKey, group);
        setTimeout(() => void this.execute(group!), this.joinWindowMs);
      }
      if (
        group.members.some((member) => member.request.id === input.request.id)
      ) {
        reject(
          Object.assign(new Error("Shared source member is already active."), {
            code: "logged_export_source_group_member_duplicate",
          }),
        );
        return;
      }
      group.members.push({ ...input, resolve, reject });
    });
  }

  private async execute(group: Rendezvous): Promise<void> {
    group.closed = true;
    if (group.members.length < 2) {
      this.rendezvous.delete(group.compatibilityKey);
      group.members[0]?.resolve(false);
      return;
    }
    const groupId = randomUUID();
    const scratchRoot = join(this.dataRoot, "jobs", "export-source-groups");
    let acquired:
      Awaited<ReturnType<typeof acquireExportSourceScratch>> | undefined;
    let primaryError: unknown;
    let durableGroupCreated = false;
    const memberResults = new Map<SharedMember, unknown>();
    try {
      this.queue.createLoggedExportSourceGroup({
        groupId,
        compatibilityKey: group.compatibilityKey,
        acquisitionProfileFingerprint: this.acquisitionProfileFingerprint,
        members: group.members.map((member) => ({
          requestId: member.request.id,
          jobId: member.request.jobId,
          attempt: member.attempt,
        })),
      });
      durableGroupCreated = true;
      acquired = await acquireExportSourceScratch({
        scratchRoot,
        jobId: groupId,
        attempt: SharedSourceAttempt,
        provider: this.provider,
        videoId: group.members[0]!.request.video.youtubeVideoId,
        authorizationConfirmed: true,
      });
      const inspection = await inspectVerifiedExportSource({
        sourcePath: acquired.source.scratchPath,
        scratchDirectory: acquired.scratchDirectory,
        inspector: this.inspector,
      });
      assertEditingFriendlySourceCompatibility(inspection);
      this.queue.recordLoggedExportSourceGroupReady(
        groupId,
        acquired.source,
        inspection,
      );
      for (const member of group.members) member.sourceReady(acquired.source);

      await Promise.all(
        group.members.map(async (member) => {
          try {
            const stagingDirectory = join(
              acquired!.scratchDirectory,
              "members",
              member.request.jobId,
              String(member.attempt),
            );
            await mkdir(stagingDirectory, { recursive: true, mode: 0o700 });
            await member.handoff({
              source: acquired!.source,
              inspection,
              sourceDirectory: acquired!.scratchDirectory,
              stagingDirectory,
            });
          } catch (error) {
            memberResults.set(member, error);
          } finally {
            const error = memberResults.get(member);
            const outcome = member.signal?.aborted
              ? "canceled"
              : error
                ? "failed"
                : "succeeded";
            this.queue.releaseLoggedExportSourceGroupMember(
              groupId,
              member.request.id,
              outcome,
            );
          }
        }),
      );
    } catch (error) {
      primaryError = error;
      for (const member of group.members) {
        if (!memberResults.has(member)) memberResults.set(member, error);
        try {
          this.queue.releaseLoggedExportSourceGroupMember(
            groupId,
            member.request.id,
            member.signal?.aborted ? "canceled" : "failed",
          );
        } catch {
          // Creation may have failed before durable membership existed.
        }
      }
    }

    if (!durableGroupCreated) {
      const requestScratchRoot = join(
        this.dataRoot,
        "jobs",
        "export-source-scratch",
      );
      for (const member of group.members) {
        try {
          member.cleanupStarted();
          this.queue.recordSourceCleanupStarted(
            member.request.jobId,
            member.attempt,
          );
          await cleanupExportSourceScratch({
            scratchRoot: requestScratchRoot,
            jobId: member.request.jobId,
            attempt: member.attempt,
          });
          this.queue.recordSourceCleanupSucceeded(
            member.request.jobId,
            member.attempt,
          );
          member.cleanupSucceeded();
        } catch (cleanupError) {
          const message = safeMessage(cleanupError);
          try {
            this.queue.recordSourceCleanupFailed(
              member.request.jobId,
              member.attempt,
              message,
            );
          } catch {
            // The original cleanup failure remains actionable.
          }
          member.cleanupFailed(message);
          member.reject(
            Object.assign(
              new Error(`Source scratch cleanup failed: ${message}`),
              {
                code: "source_cleanup_failed",
              },
            ),
          );
          continue;
        }
        member.reject(primaryError);
      }
      this.rendezvous.delete(group.compatibilityKey);
      return;
    }

    try {
      for (const member of group.members) member.cleanupStarted();
      this.queue.recordLoggedExportSourceGroupCleanupStarted(groupId);
      await cleanupExportSourceScratch({
        scratchRoot,
        jobId: groupId,
        attempt: SharedSourceAttempt,
      });
      this.queue.recordLoggedExportSourceGroupCleanupSucceeded(groupId);
      for (const member of group.members) member.cleanupSucceeded();
    } catch (cleanupError) {
      const message = safeMessage(cleanupError);
      try {
        this.queue.recordLoggedExportSourceGroupCleanupFailed(groupId, message);
      } catch {
        // Keep the original cleanup failure actionable for each caller.
      }
      for (const member of group.members) member.cleanupFailed(message);
      const error = Object.assign(
        new Error(
          primaryError
            ? `Shared source processing and cleanup failed: ${message}`
            : `Shared source cleanup failed: ${message}`,
        ),
        { code: "source_cleanup_failed" },
      );
      for (const member of group.members) member.reject(error);
      this.rendezvous.delete(group.compatibilityKey);
      return;
    }

    for (const member of group.members) {
      const error = memberResults.get(member);
      if (error) member.reject(error);
      else member.resolve(true);
    }
    this.rendezvous.delete(group.compatibilityKey);
  }
}

function safeMessage(_error: unknown): string {
  return "Shared source scratch cleanup could not remove the exact group directory.";
}
