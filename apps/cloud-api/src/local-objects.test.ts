import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SharedProjectCatalog } from "@research-video/catalog";
import {
  LocalStagedUploadUrlIssuer,
  LocalTranscriptObjectStore,
} from "@research-video/storage";
import { createCloudApi } from "./app.ts";
import { createBrowserAuth } from "./browser-auth/routes.ts";
import type { IdentityProvider } from "./browser-auth/provider.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const newRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "vera50-http-"));
  roots.push(root);
  return root;
};
const key = "projects/synthetic/transcripts/english-normalized.json";

describe("local signed transcript HTTP transport", () => {
  it("keeps browser BFF sessions and signed objects available together without bypassing the backup gate", async () => {
    const root = await newRoot();
    const store = new LocalTranscriptObjectStore(root);
    const issuer = new LocalStagedUploadUrlIssuer(
      "http://127.0.0.1:43111/",
      "local-objects-test-secret-at-least-32-bytes",
    );
    const catalog = {} as SharedProjectCatalog;
    const auth = createBrowserAuth({
      publicOrigin: "https://research.example",
      trustedProxyPeers: ["127.0.0.1"],
      catalog,
      // Neither login nor provider calls are needed for an anonymous session
      // status check; this verifies route registration and signed transport.
      provider: {} as IdentityProvider,
    });
    const app = createCloudApi({
      catalog,
      browserAuth: auth,
      authenticate: (request) => auth.authenticate(request),
      localArtifacts: { store, issuer, objectRoot: root },
    });
    const headers = { host: "research.example" };
    try {
      const session = await app.inject({
        method: "GET",
        url: "/cloud-api/api/session",
        headers,
      });
      expect(session.statusCode).toBe(200);
      expect(session.json()).toEqual({
        authenticated: false,
        registered: false,
      });

      const putUrl = new URL(
        await issuer.issuePutUrl({ objectKey: key, expiresInSeconds: 30 }),
      ).pathname;
      const upload = () =>
        app.inject({
          method: "PUT",
          url: putUrl,
          headers: { ...headers, "content-type": "application/octet-stream" },
          payload: Buffer.from("test object"),
        });
      expect((await upload()).statusCode).toBe(200);
      await mkdir(join(root, ".vera-backup-writes-blocked"));
      expect((await upload()).statusCode).toBe(503);
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/cloud-api/api/session",
            headers,
          })
        ).statusCode,
      ).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("uploads bytes, returns immutable version, pins GET and rejects forged or wrong-method URLs", async () => {
    const root = await newRoot();
    const store = new LocalTranscriptObjectStore(root);
    const issuer = new LocalStagedUploadUrlIssuer(
      "http://127.0.0.1:43111/",
      "local-objects-test-secret-at-least-32-bytes",
    );
    const app = createCloudApi({
      catalog: {} as SharedProjectCatalog,
      authenticate: vi.fn(),
      localArtifacts: { store, issuer, objectRoot: root },
    });
    try {
      const url = new URL(
        await issuer.issuePutUrl({ objectKey: key, expiresInSeconds: 30 }),
      ).pathname;
      const first = await app.inject({
        method: "PUT",
        url,
        headers: { "content-type": "application/json" },
        payload: Buffer.from("first content"),
      });
      expect(first.statusCode).toBe(200);
      const versionId = String(first.headers["x-amz-version-id"]);
      expect(versionId).toMatch(/^[0-9a-f-]{36}$/u);
      const found = await store.get(key, versionId);
      expect(found?.sha256).toBe(
        createHash("sha256").update("first content").digest("hex"),
      );
      const second = await app.inject({
        method: "PUT",
        url,
        headers: { "content-type": "application/json" },
        payload: Buffer.from("second content"),
      });
      expect(second.statusCode).toBe(200);
      expect(second.headers["x-amz-version-id"]).not.toBe(versionId);
      const pinned = new URL(
        await issuer.issueGetUrl({
          objectKey: key,
          objectVersionId: versionId,
          expiresInSeconds: 30,
        }),
      ).pathname;
      const read = await app.inject({ method: "GET", url: pinned });
      expect(read.statusCode).toBe(200);
      expect(read.rawPayload.toString()).toBe("first content");
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(403);
      expect(
        (await app.inject({ method: "GET", url: "/__objects/fake.forged" }))
          .statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: "PUT",
            url: pinned,
            payload: Buffer.from("bad"),
            headers: { "content-type": "application/octet-stream" },
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("blocks all mutations during an operator backup but permits pinned reads and reports drain", async () => {
    const root = await newRoot();
    const store = new LocalTranscriptObjectStore(root);
    const issuer = new LocalStagedUploadUrlIssuer(
      "http://127.0.0.1:43111/",
      "local-objects-test-secret-at-least-32-bytes",
    );
    const app = createCloudApi({
      catalog: {} as SharedProjectCatalog,
      authenticate: vi.fn(),
      localArtifacts: { store, issuer, objectRoot: root },
    });
    try {
      const published = await store.put({
        key,
        bytes: new Uint8Array([1]),
        contentType: "application/octet-stream",
        sha256: createHash("sha256")
          .update(new Uint8Array([1]))
          .digest("hex"),
      });
      await mkdir(join(root, ".vera-backup-writes-blocked"));
      const status = await app.inject({
        method: "GET",
        url: "/__maintenance/status",
      });
      expect(status.json()).toEqual({ writesBlocked: true, inFlightWrites: 0 });
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/projects",
            payload: { name: "blocked" },
          })
        ).statusCode,
      ).toBe(503);
      const put = new URL(
        await issuer.issuePutUrl({ objectKey: key, expiresInSeconds: 30 }),
      ).pathname;
      expect(
        (
          await app.inject({
            method: "PUT",
            url: put,
            headers: { "content-type": "application/octet-stream" },
            payload: Buffer.from([2]),
          })
        ).statusCode,
      ).toBe(503);
      const pinned = new URL(
        await issuer.issueGetUrl({
          objectKey: key,
          objectVersionId: published.versionId,
          expiresInSeconds: 30,
        }),
      ).pathname;
      expect(
        (await app.inject({ method: "GET", url: pinned })).rawPayload,
      ).toEqual(Buffer.from([1]));
    } finally {
      await app.close();
    }
  });
});
