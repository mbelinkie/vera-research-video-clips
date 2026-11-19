/** Local-only fake provider and transient TLS fixture. No live AWS or user data. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createTlsServer } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import fastifyStatic from "@fastify/static";
import { randomUUID } from "node:crypto";
import { SharedProjectCatalog } from "@research-video/catalog";
import { runCloudMigrations } from "@research-video/db-cloud";
import { MemoryTranscriptObjectStore } from "@research-video/storage";
import { createCloudApi } from "../../apps/cloud-api/src/app.ts";
import { createBrowserAuth } from "../../apps/cloud-api/src/browser-auth/routes.ts";
import type {
  IdentityProvider,
  VerifiedTokens,
} from "../../apps/cloud-api/src/browser-auth/provider.ts";
import { request as httpRequest } from "node:http";

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
const database = new PGlite();
await runCloudMigrations(database);
const catalog = new SharedProjectCatalog(
  database,
  new MemoryTranscriptObjectStore(),
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
});
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
