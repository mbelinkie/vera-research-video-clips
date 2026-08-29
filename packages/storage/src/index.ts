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

export type StoredObjectMetadata = Omit<StoredObject, "bytes"> & {
  byteSize: number;
};

export interface TranscriptObjectStore {
  put(input: PutObjectInput): Promise<StoredObject>;
  head?(
    key: string,
    versionId?: string,
  ): Promise<StoredObjectMetadata | undefined>;
  get(key: string, versionId?: string): Promise<StoredObject | undefined>;
  getBounded(
    key: string,
    versionId: string,
    maxBytes: number,
  ): Promise<StoredObject | undefined>;
  deleteVersion(key: string, versionId: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
}

export class ObjectStoreSizeLimitError extends Error {
  readonly code = "object_too_large";

  constructor() {
    super("The staged object exceeds its allowed size.");
    this.name = "ObjectStoreSizeLimitError";
  }
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

  async head(
    key: string,
    versionId?: string,
  ): Promise<StoredObjectMetadata | undefined> {
    const value = await this.get(key, versionId);
    if (!value) return undefined;
    const { bytes, ...metadata } = value;
    return { ...metadata, byteSize: bytes.byteLength };
  }

  async getBounded(
    key: string,
    versionId: string,
    maxBytes: number,
  ): Promise<StoredObject | undefined> {
    assertPositiveByteLimit(maxBytes);
    const value = await this.get(key, versionId);
    if (value && value.bytes.byteLength > maxBytes) {
      throw new ObjectStoreSizeLimitError();
    }
    return value;
  }

  async delete(key: string): Promise<boolean> {
    return this.#objects.delete(key);
  }

  async deleteVersion(key: string, versionId: string): Promise<boolean> {
    const versions = this.#objects.get(key);
    if (!versions) return false;
    const index = versions.findIndex(
      (candidate) => candidate.versionId === versionId,
    );
    if (index < 0) return false;
    versions.splice(index, 1);
    if (versions.length === 0) this.#objects.delete(key);
    return true;
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
    return this.load(key, versionId);
  }

  async head(
    key: string,
    versionId?: string,
  ): Promise<StoredObjectMetadata | undefined> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ...(versionId ? { VersionId: versionId } : {}),
        }),
      );
      const byteSize = response.ContentLength;
      if (byteSize === undefined || byteSize < 0) return undefined;
      return {
        key,
        versionId: response.VersionId ?? versionId ?? "unversioned",
        byteSize,
        contentType: response.ContentType ?? "application/octet-stream",
        sha256: response.Metadata?.sha256 ?? "",
      };
    } catch (error) {
      const statusCode = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (statusCode === 404) return undefined;
      throw error;
    }
  }

  async getBounded(
    key: string,
    versionId: string,
    maxBytes: number,
  ): Promise<StoredObject | undefined> {
    assertPositiveByteLimit(maxBytes);
    return this.load(key, versionId, maxBytes);
  }

  private async load(
    key: string,
    versionId?: string,
    maxBytes?: number,
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
      if (
        maxBytes !== undefined &&
        response.ContentLength !== undefined &&
        response.ContentLength > maxBytes
      ) {
        throw new ObjectStoreSizeLimitError();
      }
      const bytes =
        maxBytes === undefined
          ? await response.Body.transformToByteArray()
          : await readS3BodyBounded(response.Body, maxBytes);
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

  async deleteVersion(key: string, versionId: string): Promise<boolean> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
        VersionId: versionId,
      }),
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

function assertPositiveByteLimit(maxBytes: number) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("Object byte limit must be a positive safe integer.");
  }
}

async function readS3BodyBounded(
  body: { transformToByteArray(): Promise<Uint8Array> } & {
    [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
  },
  maxBytes: number,
): Promise<Uint8Array> {
  if (!body[Symbol.asyncIterator]) {
    const bytes = await body.transformToByteArray();
    if (bytes.byteLength > maxBytes) throw new ObjectStoreSizeLimitError();
    return bytes;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const rawChunk of body as AsyncIterable<unknown>) {
    const chunk =
      rawChunk instanceof Uint8Array
        ? rawChunk
        : typeof rawChunk === "string"
          ? new TextEncoder().encode(rawChunk)
          : Uint8Array.from(rawChunk as ArrayLike<number>);
    total += chunk.byteLength;
    if (total > maxBytes) throw new ObjectStoreSizeLimitError();
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
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
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
