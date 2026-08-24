import { createHash } from "node:crypto";

import { DesktopTimedTranscriptUploadRequestSchema } from "@research-video/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  TimedTranscriptUploadGrantRegistry,
  uploadTimedTranscript,
} from "./timed-transcript-upload.ts";

const importId = "019fbb95-cd76-7920-93fa-e23ba755eaa5";
const bytes = new Uint8Array([1, 2, 3]);
const uploadUrl =
  "https://fixture.s3.us-east-1.amazonaws.com/private/catalog-issued/original?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=fixture&X-Amz-Signature=abc&X-Amz-Expires=900";

function registry() {
  const grants = new TimedTranscriptUploadGrantRegistry();
  grants.register(
    {
      importId,
      projectId: "019fbb95-cd76-7920-93fa-e23ba755eaa1",
      catalogVideoId: "019fbb95-cd76-7920-93fa-e23ba755eaa4",
      batchItemId: "019fbb95-cd76-7920-93fa-e23ba755eaa3",
      sourceLanguage: "dz",
      languageDecisionId: "019fbb95-cd76-7920-93fa-e23ba755eaa6",
      languageDecisionVersion: 1,
      expiresAt: "2099-01-01T00:00:00.000Z",
      targets: [
        { role: "original", format: "srt", objectKey: "private", uploadUrl },
        {
          role: "english",
          format: "vtt",
          objectKey: "private",
          uploadUrl: uploadUrl.replace("original", "english"),
        },
      ],
    },
    {
      idempotencyKey: "fixture",
      languageDecisionId: "019fbb95-cd76-7920-93fa-e23ba755eaa6",
      expectedDecisionVersion: 1,
      batchItemId: "019fbb95-cd76-7920-93fa-e23ba755eaa3",
      expectedBatchItemVersion: 1,
      original: {
        format: "srt",
        byteSize: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
      english: {
        format: "vtt",
        byteSize: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    },
  );
  return grants;
}

describe("desktop timed transcript upload", () => {
  it("uploads only the exact catalog-registered target and returns the pinned S3 version", async () => {
    const fetcher = vi.fn(async () =>
      Promise.resolve(
        new Response(undefined, {
          status: 200,
          headers: { "x-amz-version-id": "version-1" },
        }),
      ),
    );
    await expect(
      uploadTimedTranscript(
        {
          importId,
          role: "original",
          contentType: "application/x-subrip",
          bytes,
        },
        fetcher,
        registry(),
      ),
    ).resolves.toEqual({ objectVersionId: "version-1" });
    expect(fetcher).toHaveBeenCalledWith(uploadUrl, {
      method: "PUT",
      headers: { "content-type": "application/x-subrip" },
      body: bytes,
      redirect: "error",
    });
  });

  it("rejects a valid-looking S3 bucket/prefix that was not returned by the catalog proxy", async () => {
    const unregisteredS3Url =
      "https://other-bucket.s3.us-east-1.amazonaws.com/other-prefix/file?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=fixture&X-Amz-Signature=abc&X-Amz-Expires=900";
    expect(
      DesktopTimedTranscriptUploadRequestSchema.safeParse({
        importId,
        role: "original",
        contentType: "application/x-subrip",
        bytes,
        uploadUrl: unregisteredS3Url,
      }).success,
    ).toBe(false);
    const fetcher = vi.fn(async () => new Response(undefined, { status: 200 }));
    await expect(
      uploadTimedTranscript(
        {
          importId: "019fbb95-cd76-7920-93fa-e23ba755eab5",
          role: "original",
          contentType: "application/x-subrip",
          bytes,
        },
        fetcher,
        registry(),
      ),
    ).rejects.toThrow("grant is unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fails closed when the selected bytes do not match the registered catalog descriptor", async () => {
    const fetcher = vi.fn(async () => new Response(undefined, { status: 200 }));
    await expect(
      uploadTimedTranscript(
        {
          importId,
          role: "original",
          contentType: "application/x-subrip",
          bytes: new Uint8Array([9]),
        },
        fetcher,
        registry(),
      ),
    ).rejects.toThrow("did not match its catalog grant");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
