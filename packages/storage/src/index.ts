export type StoredObject = {
  key: string;
  versionId: string;
  bytes: Uint8Array;
  contentType: string;
  sha256: string;
};

export type PutObjectInput = Omit<StoredObject, "bytes" | "versionId"> & {
  bytes: Uint8Array;
};

export interface TranscriptObjectStore {
  put(input: PutObjectInput): Promise<StoredObject>;
  get(key: string, versionId?: string): Promise<StoredObject | undefined>;
  delete(key: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
}

export interface StagedUploadUrlIssuer {
  issuePutUrl(input: {
    objectKey: string;
    expiresInSeconds: number;
  }): Promise<string>;
  issueGetUrl(input: {
    objectKey: string;
    objectVersionId: string;
    expiresInSeconds: number;
  }): Promise<string>;
}

export class MemoryStagedUploadUrlIssuer implements StagedUploadUrlIssuer {
  async issuePutUrl(input: {
    objectKey: string;
    expiresInSeconds: number;
  }): Promise<string> {
    return `memory-upload://${encodeURIComponent(input.objectKey)}?expires=${input.expiresInSeconds}`;
  }

  async issueGetUrl(input: {
    objectKey: string;
    objectVersionId: string;
    expiresInSeconds: number;
  }): Promise<string> {
    return `memory-download://${encodeURIComponent(input.objectKey)}?versionId=${encodeURIComponent(input.objectVersionId)}&expires=${input.expiresInSeconds}`;
  }
}

export class MemoryTranscriptObjectStore implements TranscriptObjectStore {
  readonly #objects = new Map<string, StoredObject[]>();

  async put(input: PutObjectInput): Promise<StoredObject> {
    const stored = {
      ...input,
      versionId: crypto.randomUUID(),
      bytes: input.bytes.slice(),
    };
    const versions = this.#objects.get(input.key) ?? [];
    versions.push(stored);
    this.#objects.set(input.key, versions);
    return { ...stored, bytes: stored.bytes.slice() };
  }

  async get(
    key: string,
    versionId?: string,
  ): Promise<StoredObject | undefined> {
    const versions = this.#objects.get(key) ?? [];
    const value = versionId
      ? versions.find((candidate) => candidate.versionId === versionId)
      : versions.at(-1);
    return value ? { ...value, bytes: value.bytes.slice() } : undefined;
  }

  async delete(key: string): Promise<boolean> {
    return this.#objects.delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.#objects.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort();
  }
}

export class S3TranscriptObjectStore implements TranscriptObjectStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async put(input: PutObjectInput): Promise<StoredObject> {
    const response = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.bytes,
        ContentType: input.contentType,
        ChecksumSHA256: Buffer.from(input.sha256, "hex").toString("base64"),
        Metadata: { sha256: input.sha256 },
      }),
    );
    if (!response.VersionId) {
      throw new Error(
        "S3 did not return a version ID; bucket versioning is required.",
      );
    }
    return {
      ...input,
      versionId: response.VersionId,
      bytes: input.bytes.slice(),
    };
  }

  async get(
    key: string,
    versionId?: string,
  ): Promise<StoredObject | undefined> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ...(versionId ? { VersionId: versionId } : {}),
        }),
      );
      if (!response.Body) return undefined;
      const bytes = await response.Body.transformToByteArray();
      return {
        key,
        versionId: response.VersionId ?? versionId ?? "unversioned",
        bytes,
        contentType: response.ContentType ?? "application/octet-stream",
        sha256:
          response.Metadata?.sha256 ??
          createHash("sha256").update(bytes).digest("hex"),
      };
    } catch (error) {
      const statusCode = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (statusCode === 404) return undefined;
      throw error;
    }
  }

  async delete(key: string): Promise<boolean> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return true;
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ...(continuationToken
            ? { ContinuationToken: continuationToken }
            : {}),
        }),
      );
      keys.push(
        ...(response.Contents ?? []).flatMap((item) =>
          item.Key ? [item.Key] : [],
        ),
      );
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);
    return keys.sort();
  }
}

export class S3StagedUploadUrlIssuer implements StagedUploadUrlIssuer {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async issuePutUrl(input: {
    objectKey: string;
    expiresInSeconds: number;
  }): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: input.objectKey }),
      { expiresIn: input.expiresInSeconds },
    );
  }

  async issueGetUrl(input: {
    objectKey: string;
    objectVersionId: string;
    expiresInSeconds: number;
  }): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
        VersionId: input.objectVersionId,
      }),
      { expiresIn: input.expiresInSeconds },
    );
  }
}
import { createHash } from "node:crypto";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
