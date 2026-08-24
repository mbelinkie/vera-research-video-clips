import {
  DesktopTimedTranscriptUploadRequestSchema,
  DesktopTimedTranscriptUploadResponseSchema,
  type CreateManualTimedTranscriptImportRequest,
  type ManualTimedTranscriptImportUploadGrant,
  type DesktopTimedTranscriptUploadRequest,
  type DesktopTimedTranscriptUploadResponse,
} from "@research-video/contracts";
import { createHash } from "node:crypto";

type RegisteredTimedTranscriptTarget = Readonly<{
  uploadUrl: string;
  contentType: "application/x-subrip" | "text/vtt";
  byteSize: number;
  sha256: string;
  expiresAt: number;
}>;

/**
 * Main-process only capability registry. The renderer can see a presigned URL
 * in the catalog grant, but cannot make the native uploader use it unless the
 * exact create response was first observed by the authenticated proxy.
 */
export class TimedTranscriptUploadGrantRegistry {
  private readonly targets = new Map<string, RegisteredTimedTranscriptTarget>();

  register(
    grant: ManualTimedTranscriptImportUploadGrant,
    request: CreateManualTimedTranscriptImportRequest,
  ) {
    const expiresAt = Date.parse(grant.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new Error("Timed transcript upload grant has expired.");
    }
    for (const role of ["original", "english"] as const) {
      const target = grant.targets.find((candidate) => candidate.role === role);
      const descriptor = request[role];
      if (!target || target.format !== descriptor.format) {
        throw new Error(
          "Timed transcript upload grant did not match its request.",
        );
      }
      this.targets.set(this.key(grant.importId, role), {
        uploadUrl: target.uploadUrl,
        contentType:
          target.format === "srt" ? "application/x-subrip" : "text/vtt",
        byteSize: descriptor.byteSize,
        sha256: descriptor.sha256,
        expiresAt,
      });
    }
  }

  consume(input: DesktopTimedTranscriptUploadRequest): string {
    const key = this.key(input.importId, input.role);
    const target = this.targets.get(key);
    if (!target || target.expiresAt <= Date.now()) {
      this.targets.delete(key);
      throw new Error("Timed transcript upload grant is unavailable.");
    }
    const digest = createHash("sha256").update(input.bytes).digest("hex");
    if (
      target.contentType !== input.contentType ||
      target.byteSize !== input.bytes.byteLength ||
      target.sha256 !== digest
    ) {
      throw new Error(
        "Timed transcript upload did not match its catalog grant.",
      );
    }
    this.targets.delete(key);
    return target.uploadUrl;
  }

  private key(importId: string, role: "original" | "english") {
    return `${importId}:${role}`;
  }
}

export async function uploadTimedTranscript(
  rawInput: DesktopTimedTranscriptUploadRequest,
  fetcher: typeof fetch = fetch,
  grants: TimedTranscriptUploadGrantRegistry,
): Promise<DesktopTimedTranscriptUploadResponse> {
  const input = DesktopTimedTranscriptUploadRequestSchema.parse(rawInput);
  const uploadUrl = grants.consume(input);
  const response = await fetcher(uploadUrl, {
    method: "PUT",
    headers: { "content-type": input.contentType },
    body: input.bytes,
    redirect: "error",
  });
  if (!response.ok) {
    throw new Error("Timed transcript upload failed.");
  }
  const objectVersionId = response.headers.get("x-amz-version-id");
  if (!objectVersionId) {
    throw new Error(
      "Timed transcript upload did not return an object version.",
    );
  }
  return DesktopTimedTranscriptUploadResponseSchema.parse({ objectVersionId });
}
