import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
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
import {
  cloudflareAccessVerifier,
  createCloudflareAccessGuard,
} from "./cloudflare-access.ts";
import {
  createOperatorApi,
  DiskSpaceMonitor,
  OperatorCounters,
  PilotWriteGate,
} from "./pilot-operations.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const newRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "vera53-ops-"));
  roots.push(root);
  return root;
};

const team = "https://vera-test.cloudflareaccess.com";
const audience = "b".repeat(64);
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const kid = "test-key";
const jwks = {
  keys: [
    {
      ...(publicKey.export({ format: "jwk" }) as { n: string; e: string }),
      kty: "RSA",
      kid,
      alg: "RS256",
      use: "sig",
    },
  ],
};
const b64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
function accessToken(claims: Record<string, unknown>, key = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: "RS256", kid, typ: "JWT" })}.${b64({
    iss: team,
    aud: [audience],
    sub: randomUUID(),
    email: "friend@example.test",
    iat: now,
    exp: now + 300,
    ...claims,
  })}`;
  const signature = createSign("RSA-SHA256").update(body).sign(key);
  return `${body}.${signature.toString("base64url")}`;
}

describe("Cloudflare Access verification at the laptop", () => {
  const verify = cloudflareAccessVerifier({ teamDomain: team, audience, jwks });
  const guard = createCloudflareAccessGuard(verify);
  const run = (headers: Record<string, string>) =>
    guard({ headers } as never).then(
      () => "admitted",
      (error: { statusCode?: number; code?: string }) =>
        `${error.statusCode}:${error.code}`,
    );

  it("admits a valid token for this application only", async () => {
    expect(await run({ "cf-access-jwt-assertion": accessToken({}) })).toBe(
      "admitted",
    );
  });

  it("denies missing, forged, expired, foreign-audience and foreign-team tokens", async () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const past = Math.floor(Date.now() / 1000) - 3600;
    for (const headers of [
      {},
      { "cf-access-jwt-assertion": "" },
      { "cf-access-jwt-assertion": "not-a-jwt" },
      { "cf-access-jwt-assertion": accessToken({}, other.privateKey) },
      { "cf-access-jwt-assertion": accessToken({ exp: past, iat: past - 60 }) },
      { "cf-access-jwt-assertion": accessToken({ aud: ["c".repeat(64)] }) },
      {
        "cf-access-jwt-assertion": accessToken({
          iss: "https://attacker.cloudflareaccess.com",
        }),
      },
      // A copied cookie name is not the signed assertion header.
      { cookie: `CF_Authorization=${accessToken({})}` },
    ])
      expect(await run(headers)).toBe("403:access_denied");
  });

  it("runs before browser auth, so an uninvited visitor never reaches sign-in", async () => {
    const root = await newRoot();
    const catalog = {} as SharedProjectCatalog;
    const auth = createBrowserAuth({
      publicOrigin: "https://research.example",
      trustedProxyPeers: ["127.0.0.1"],
      catalog,
      provider: {} as IdentityProvider,
    });
    const counters = new OperatorCounters();
    const app = createCloudApi({
      catalog,
      browserAuth: auth,
      authenticate: (request) => auth.authenticate(request),
      ingressGuard: guard,
      counters,
      localArtifacts: {
        store: new LocalTranscriptObjectStore(root),
        issuer: new LocalStagedUploadUrlIssuer(
          "https://research.example/cloud-api/",
          "pilot-operations-test-secret-at-least-32-bytes",
        ),
        objectRoot: root,
      },
    });
    const tunnel = {
      host: "research.example",
      "x-forwarded-for": "203.0.113.9",
      "x-forwarded-proto": "https",
      "cf-connecting-ip": "203.0.113.9",
    };
    try {
      const denied = await app.inject({
        method: "GET",
        url: "/cloud-api/auth/login",
        headers: tunnel,
      });
      expect(denied.statusCode).toBe(403);
      const session = await app.inject({
        method: "GET",
        url: "/cloud-api/api/session",
        headers: { ...tunnel, "cf-access-jwt-assertion": accessToken({}) },
      });
      expect(session.statusCode).toBe(200);
      expect(session.json()).toMatchObject({ authenticated: false });
      // Maintenance state is never served on the tunnel-facing listener,
      // even to an invited friend, because the tunnel connects from loopback.
      for (const url of [
        "/__maintenance/status",
        "/cloud-api/__maintenance/status",
      ])
        expect(
          (
            await app.inject({
              method: "GET",
              url,
              headers: {
                ...tunnel,
                "cf-access-jwt-assertion": accessToken({}),
              },
            })
          ).statusCode,
        ).toBe(404);
      expect(counters.snapshot().counts.accessDenied).toBe(1);
    } finally {
      await app.close();
    }
  });
});

describe("loopback operator listener", () => {
  it("serves status only to direct, un-proxied loopback GETs", async () => {
    const root = await newRoot();
    const gate = new PilotWriteGate(root);
    const counters = new OperatorCounters();
    counters.record(401, "/api/projects");
    counters.record(403, "/api/projects", "access_denied");
    counters.record(400, "/auth/callback?code=secret");
    const app = createOperatorApi({ port: 43114, gate, counters });
    try {
      const direct = await app.inject({
        method: "GET",
        url: "/__operator/diagnostics",
        headers: { host: "127.0.0.1:43114" },
      });
      expect(direct.statusCode).toBe(200);
      const body = direct.json();
      expect(body.process.counts).toMatchObject({
        signedOut: 1,
        accessDenied: 1,
        callbackFailed: 1,
      });
      // Counters never retain URLs, codes or identities.
      expect(JSON.stringify(body)).not.toContain("secret");
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/__maintenance/status",
            headers: { host: "localhost:43114" },
          })
        ).json(),
      ).toEqual({ writesBlocked: false, inFlightWrites: 0, diskPaused: false });
      for (const headers of [
        { host: "127.0.0.1:43114", "cf-connecting-ip": "203.0.113.9" },
        { host: "127.0.0.1:43114", "x-forwarded-for": "203.0.113.9" },
        { host: "127.0.0.1:43114", forwarded: "for=203.0.113.9" },
        { host: "research.example" },
        { host: "attacker.example:43114" },
      ])
        expect(
          (
            await app.inject({
              method: "GET",
              url: "/__operator/diagnostics",
              headers,
            })
          ).statusCode,
        ).toBe(404);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/__maintenance/status",
            headers: { host: "127.0.0.1:43114" },
          })
        ).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });
});

describe("disk-space pause", () => {
  it("refuses new writes below the threshold but keeps reads working", async () => {
    const root = await newRoot();
    let free = 10 * 1024 ** 3;
    let clock = 0;
    const disk = new DiskSpaceMonitor(
      root,
      2 * 1024 ** 3,
      () => clock,
      async () => free,
    );
    const counters = new OperatorCounters();
    const app = createCloudApi({
      catalog: {
        listProjects: vi.fn(async () => []),
      } as unknown as SharedProjectCatalog,
      authenticate: async () => ({
        userId: randomUUID(),
        externalSubject: "test",
      }),
      counters,
      localArtifacts: {
        store: new LocalTranscriptObjectStore(root),
        issuer: new LocalStagedUploadUrlIssuer(
          "http://127.0.0.1:43111/",
          "pilot-operations-test-secret-at-least-32-bytes",
        ),
        objectRoot: root,
        gate: new PilotWriteGate(root, disk),
      },
    });
    try {
      expect(await disk.paused()).toBe(false);
      free = 1024 ** 3;
      // The cached reading still says "plenty" until the cache expires.
      expect(await disk.paused()).toBe(false);
      clock += 16_000;
      const write = await app.inject({
        method: "POST",
        url: "/api/projects",
        payload: { name: "while full" },
      });
      expect(write.statusCode).toBe(507);
      expect(write.json().error.code).toBe("host_disk_low");
      expect(write.json().error.message).toContain("Reading still works");
      expect(counters.snapshot().counts.writesPaused).toBe(1);
      const read = await app.inject({ method: "GET", url: "/health" });
      expect(read.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("fails closed when the volume cannot be measured", async () => {
    const disk = new DiskSpaceMonitor("/nonexistent", 1, Date.now, async () => {
      throw new Error("statfs failed");
    });
    expect(await disk.paused()).toBe(true);
  });

  it("still honours the backup write gate first", async () => {
    const root = await newRoot();
    const gate = new PilotWriteGate(root);
    await mkdir(join(root, ".vera-backup-writes-blocked"));
    expect(await gate.status()).toMatchObject({ writesBlocked: true });
  });
});

describe("development bearer API behind a tunnel", () => {
  it("refuses any request that carries Cloudflare tunnel headers", async () => {
    const app = createCloudApi({
      catalog: {
        listProjects: vi.fn(async () => []),
      } as unknown as SharedProjectCatalog,
      authenticate: async () => ({
        userId: randomUUID(),
        externalSubject: "forged-by-a-friend",
      }),
    });
    try {
      for (const header of [
        "cf-connecting-ip",
        "cf-ray",
        "cf-visitor",
        "cf-access-jwt-assertion",
      ]) {
        const response = await app.inject({
          method: "GET",
          url: "/api/projects",
          headers: { host: "research.example.com", [header]: "x" },
        });
        expect(response.statusCode).toBe(403);
        expect(response.json().error.code).toBe("tunnel_refused");
      }
      const local = await app.inject({ method: "GET", url: "/api/projects" });
      expect(local.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
