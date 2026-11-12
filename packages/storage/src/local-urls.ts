import { createHmac, timingSafeEqual } from "node:crypto";

import { assertTranscriptObjectKey } from "./local.ts";
import type { StagedUploadUrlIssuer } from "./index.ts";

type Capability = {
  method: "PUT" | "GET";
  key: string;
  versionId?: string;
  expiresAt: number;
};

export class InvalidLocalObjectCapability extends Error {
  readonly statusCode = 403;
  readonly code = "invalid_object_capability";
  constructor() {
    super("Invalid or expired object capability");
  }
}

/** Signed, single-purpose, short-lived URLs, issued only by authorized catalog operations. */
export class LocalStagedUploadUrlIssuer implements StagedUploadUrlIssuer {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
    private readonly now: () => number = Date.now,
  ) {
    const parsed = new URL(baseUrl);
    const loopbackHttp =
      parsed.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) &&
      parsed.pathname === "/";
    // Only the browser BFF may expose signed local objects at an HTTPS public
    // origin. Its /cloud-api prefix is rewritten to this internal endpoint.
    const browserBffHttps =
      parsed.protocol === "https:" && parsed.pathname === "/cloud-api/";
    if (
      (!loopbackHttp && !browserBffHttps) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error(
        "Local object transport requires loopback HTTP or browser BFF HTTPS /cloud-api/",
      );
    }
    if (Buffer.byteLength(secret) < 32)
      throw new Error("Local object URL signing secret is too short");
  }

  private sign(message: string): Buffer {
    return createHmac("sha256", this.secret).update(message).digest();
  }

  private issue(
    method: Capability["method"],
    key: string,
    expiresInSeconds: number,
    versionId?: string,
  ) {
    assertTranscriptObjectKey(key);
    if (
      !Number.isInteger(expiresInSeconds) ||
      expiresInSeconds < 1 ||
      expiresInSeconds > 900
    ) {
      throw new Error("Local object capability TTL must be 1–900 seconds");
    }
    const body = Buffer.from(
      JSON.stringify({
        method,
        key,
        versionId,
        expiresAt: this.now() + expiresInSeconds * 1000,
      }),
    ).toString("base64url");
    return new URL(
      "__objects/" + body + "." + this.sign(body).toString("base64url"),
      this.baseUrl,
    ).toString();
  }

  async issuePutUrl(input: { objectKey: string; expiresInSeconds: number }) {
    return this.issue("PUT", input.objectKey, input.expiresInSeconds);
  }

  async issueGetUrl(input: {
    objectKey: string;
    objectVersionId: string;
    expiresInSeconds: number;
  }) {
    if (!input.objectVersionId)
      throw new Error("A pinned object version is required");
    return this.issue(
      "GET",
      input.objectKey,
      input.expiresInSeconds,
      input.objectVersionId,
    );
  }

  verify(token: string, method: "PUT" | "GET"): Capability {
    try {
      if (token.length > 4096) throw new Error();
      const parts = token.split(".");
      const [body, signature] = parts;
      if (
        parts.length !== 2 ||
        !body ||
        !signature ||
        !/^[A-Za-z0-9_-]+$/u.test(body) ||
        !/^[A-Za-z0-9_-]+$/u.test(signature)
      )
        throw new Error();
      const provided = Buffer.from(signature, "base64url");
      if (
        provided.toString("base64url") !== signature ||
        Buffer.from(body, "base64url").toString("base64url") !== body
      )
        throw new Error();
      const expected = this.sign(body);
      if (
        provided.length !== expected.length ||
        !timingSafeEqual(provided, expected)
      )
        throw new Error();
      const payload: Capability = JSON.parse(
        Buffer.from(body, "base64url").toString("utf8"),
      );
      if (
        payload.method !== method ||
        payload.expiresAt <= this.now() ||
        payload.expiresAt > this.now() + 900_000 ||
        (method === "GET" && !payload.versionId) ||
        (method === "PUT" && payload.versionId !== undefined)
      )
        throw new Error();
      assertTranscriptObjectKey(payload.key);
      return payload;
    } catch {
      throw new InvalidLocalObjectCapability();
    }
  }
}
