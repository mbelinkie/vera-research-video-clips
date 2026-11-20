/** Local-only fake provider and transient TLS fixture. No live AWS or user data. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createTlsServer } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import fastifyStatic from "@fastify/static";
import { createHash, randomUUID } from "node:crypto";
import { SharedProjectCatalog } from "@research-video/catalog";
import type { TranscriptManifest } from "@research-video/contracts";
import {
  createPostgresDatabase,
  runCloudMigrations,
} from "@research-video/db-cloud";
import {
  LocalStagedUploadUrlIssuer,
  LocalTranscriptObjectStore,
} from "@research-video/storage";
import { normalizeTranscriptFixture } from "@research-video/transcript";
import { createCloudApi } from "../../apps/cloud-api/src/app.ts";
import { createBrowserAuth } from "../../apps/cloud-api/src/browser-auth/routes.ts";
import type {
  IdentityProvider,
  VerifiedTokens,
} from "../../apps/cloud-api/src/browser-auth/provider.ts";
import { request as httpRequest } from "node:http";
import wordFixture from "../fixtures/transcripts/english-word.json" with { type: "json" };

const publicOrigin = "https://127.0.0.1:43177";
const temp = mkdtempSync(join(tmpdir(), "vera-test-tls-"));
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    join(temp, "key.pem"),
    "-out",
    join(temp, "cert.pem"),
    "-subj",
    "/CN=127.0.0.1",
    "-days",
    "1",
  ],
  { stdio: "ignore" },
);
// For the native integration walkthrough, opt into an empty disposable database.
const pgUrl = process.env.VERA48_TEST_PG_URL;
if (pgUrl) {
  const url = new URL(pgUrl);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !url.pathname.startsWith("/vera48_test_")
  )
    throw new Error("A disposable loopback vera48_test_ database is required.");
}
const nativeDatabase = pgUrl ? createPostgresDatabase(pgUrl) : undefined;
if (nativeDatabase) {
  const existing = await nativeDatabase.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' LIMIT 1",
  );
  if (existing.rows.length) {
    await nativeDatabase.close();
    throw new Error("A fresh, empty browser test database is required.");
  }
}
const database = nativeDatabase ?? new PGlite();
await runCloudMigrations(database);
const objectRoot = join(temp, "objects");
const store = new LocalTranscriptObjectStore(objectRoot);
const issuer = new LocalStagedUploadUrlIssuer(
  `${publicOrigin}/cloud-api/`,
  "synthetic-fixture-signing-key-32-bytes-minimum",
);
const catalog = new SharedProjectCatalog(
  database,
  store,
  () => new Date(),
  issuer,
);
const codes = ["alice", "bob", "carol"] as const;
const subjects = new Map(codes.map((code) => [code, randomUUID()] as const));
const emails = new Map(
  codes.map((code) => [code, `${code}@example.test`] as const),
);
const subjectFor = (code: (typeof codes)[number]) => {
  const subject = subjects.get(code);
  if (!subject) throw new Error("Unknown fake subject");
  return `cognito:https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Test#${subject}`;
};
const codeForSubject = (subject: string) =>
  codes.find((code) => subject === subjectFor(code));
const tokenFor = (
  code: (typeof codes)[number],
  includeVerifiedEmail = true,
): VerifiedTokens => ({
  subject: subjectFor(code),
  accessToken: "fixture-access",
  refreshToken: "fixture-refresh",
  expiresAtMs: Date.now() + 3600_000,
  ...(includeVerifiedEmail ? { verifiedEmail: emails.get(code)! } : {}),
});
const provider: IdentityProvider = {
  authorizeUrl({ state, nonce, challenge }) {
    const url = new URL("https://idp.example/oauth2/authorize");
    url.search = new URLSearchParams({
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
      response_type: "code",
      redirect_uri: `${publicOrigin}/cloud-api/auth/callback`,
    }).toString();
    return url.toString();
  },
  logoutUrl: () => `${publicOrigin}/`, // synthetic managed logout returns to same-origin
  async exchange(code) {
    if (!codes.includes(code as (typeof codes)[number]))
      throw Error("Unknown fake code");
    return tokenFor(code as (typeof codes)[number]);
  },
  async refresh(_refresh, subject) {
    const code = codeForSubject(subject);
    if (!code) throw Error("Unknown fake subject");
    return { ...tokenFor(code, false), subject };
  },
  async revoke() {},
};
const auth = createBrowserAuth({
  publicOrigin,
  trustedProxyPeers: ["127.0.0.1"],
  catalog,
  provider,
});
const app = createCloudApi({
  catalog,
  authenticate: (request) => auth.authenticate(request),
  browserAuth: auth,
  localArtifacts: { store, issuer, objectRoot },
});
app.post<{ Params: { projectId: string } }>(
  "/__fixture/projects/:projectId/transcript",
  async (request) => {
    const actor = await auth.authenticate(request);
    const { projectId } = request.params;
    const youtubeVideoId = "r48Fixture1";
    const video = await catalog.addVideo(actor, projectId, {
      youtubeVideoId,
      canonicalUrl: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
      title: "Synthetic browser transcript",
    });
    const grant = await catalog.createTranscriptUpload(actor, {
      projectId,
      catalogVideoId: video.id,
      lineageId: randomUUID(),
      version: 1,
      artifactTypes: ["english-normalized"],
    });
    async function storeJson<T extends "english-normalized" | "manifest">(
      type: T,
      value: unknown,
    ) {
      const objectKey = grant.targets.find(
        (entry) => entry.type === type,
      )!.objectKey;
      const bytes = Buffer.from(JSON.stringify(value));
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const stored = await store.put({
        key: objectKey,
        bytes,
        contentType: "application/json",
        sha256,
      });
      return {
        type,
        objectKey,
        objectVersionId: stored.versionId,
        byteSize: bytes.length,
        sha256,
      };
    }
    const transcript = normalizeTranscriptFixture({
      ...wordFixture,
      track: { ...wordFixture.track, videoId: youtubeVideoId },
    });
    const manifest: TranscriptManifest = {
      schemaVersion: 1,
      id: randomUUID(),
      projectId,
      catalogVideoId: video.id,
      videoId: youtubeVideoId,
      lineageId: grant.lineageId,
      version: 1,
      sourceLanguage: "en",
      targetLanguage: "en",
      timingPrecision: transcript.track.timingPrecision,
      normalizationSchemaVersion: transcript.track.schemaVersion,
      provider: "fixture",
      jobId: grant.jobId,
      createdBy: actor.userId,
      createdAt: new Date().toISOString(),
      artifacts: [await storeJson("english-normalized", transcript)],
    };
    const published = await catalog.finalizeTranscript(actor, {
      uploadId: grant.uploadId,
      idempotencyKey: manifest.id,
      manifest: await storeJson("manifest", manifest),
    });
    return {
      videoId: youtubeVideoId,
      transcriptUrl: published.downloads.find(
        (entry) => entry.type === "english-normalized",
      )!.downloadUrl,
    };
  },
);
await app.register(fastifyStatic, { root: resolve("dist/web"), prefix: "/" });
const upstreamAddress = await app.listen({ host: "127.0.0.1", port: 0 });
const upstreamPort = Number(new URL(upstreamAddress).port);
const proxy = createTlsServer(
  {
    key: readFileSync(join(temp, "key.pem")),
    cert: readFileSync(join(temp, "cert.pem")),
  },
  (request, response) => {
    const upstream = httpRequest(
      {
        host: "127.0.0.1",
        port: upstreamPort,
        path: request.url,
        method: request.method,
        headers: request.headers,
      },
      (result) => {
        response.writeHead(result.statusCode ?? 502, result.headers);
        result.pipe(response);
      },
    );
    upstream.on("error", () => {
      response.writeHead(502);
      response.end("Unavailable");
    });
    request.pipe(upstream);
  },
);
proxy.listen(43177, "127.0.0.1", () =>
  process.stdout.write("browser-auth-ready\n"),
);
const shutdown = () => {
  proxy.close();
  void app
    .close()
    .then(() => database.close())
    .finally(() => {
      rmSync(temp, { recursive: true, force: true });
      process.exit(0);
    });
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
