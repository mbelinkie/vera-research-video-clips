import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { SharedProjectCatalog } from "@research-video/catalog";
import { runCloudMigrations } from "@research-video/db-cloud";
import { MemoryTranscriptObjectStore } from "@research-video/storage";
import { createCloudApi } from "../app.ts";
import { createBrowserAuth } from "./routes.ts";
import { LOGIN_COOKIE, SESSION_COOKIE } from "./sessions.ts";
import type { IdentityProvider, VerifiedTokens } from "./provider.ts";

const apps: ReturnType<typeof createCloudApi>[] = [];
const dbs: PGlite[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(dbs.splice(0).map((db) => db.close()));
});
const origin = "https://research.example";
const names = [randomUUID(), randomUUID()];
function identityProvider(now: () => number): IdentityProvider {
  const tokens = (code: string): VerifiedTokens => ({
    subject: `cognito:https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Test#${code === "alice" ? names[0] : names[1]}`,
    accessToken: "hidden",
    refreshToken: "hidden-refresh",
    expiresAtMs: now() + 300000,
  });
  return {
    authorizeUrl({ state, nonce, challenge }) {
      return `https://idp.example/oauth2/authorize?${new URLSearchParams({ state, nonce, code_challenge: challenge, code_challenge_method: "S256", response_type: "code", redirect_uri: `${origin}/cloud-api/auth/callback` })}`;
    },
    logoutUrl() {
      return "https://idp.example/logout";
    },
    async exchange(code) {
      if (!["alice", "bob"].includes(code)) throw Error("invalid code");
      return tokens(code);
    },
    async refresh(_refresh, subject) {
      return { ...tokens("alice"), subject };
    },
    async revoke() {},
  };
}
async function setup() {
  const db = new PGlite();
  dbs.push(db);
  await runCloudMigrations(db);
  const catalog = new SharedProjectCatalog(
    db,
    new MemoryTranscriptObjectStore(),
  );
  let now = 1000;
  const auth = createBrowserAuth({
    publicOrigin: origin,
    trustedProxyPeers: ["127.0.0.1"],
    catalog,
    provider: identityProvider(() => now),
    now: () => now,
  });
  const app = createCloudApi({
    catalog,
    authenticate: (request) => auth.authenticate(request),
    browserAuth: auth,
  });
  apps.push(app);
  const inject = (options: {
    method: "GET" | "POST";
    url: string;
    headers?: Record<string, string>;
    payload?: object;
  }) =>
    app.inject({
      ...options,
      headers: { host: new URL(origin).host, ...options.headers },
    });
  async function login(code: "alice" | "bob") {
    const begun = await inject({
      method: "GET",
      url: "/cloud-api/auth/login?returnTo=%2F",
    });
    expect(begun.statusCode).toBe(303);
    const url = new URL(begun.headers.location as string);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const binding = begun.cookies.find(
      (cookie) => cookie.name === LOGIN_COOKIE,
    )!.value;
    const callback = `/cloud-api/auth/callback?state=${url.searchParams.get("state")}&code=${code}`;
    const completed = await inject({
      method: "GET",
      url: callback,
      headers: { cookie: `${LOGIN_COOKIE}=${binding}` },
    });
    expect(completed.statusCode).toBe(303);
    const session = completed.cookies.find(
      (cookie) => cookie.name === SESSION_COOKIE,
    )!;
    expect(session).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
    });
    expect(session.domain).toBeUndefined();
    const cookie = `${SESSION_COOKIE}=${session.value}`;
    const state = (
      await inject({
        method: "GET",
        url: "/cloud-api/api/session",
        headers: { cookie },
      })
    ).json<{
      csrfToken: string;
      registered: boolean;
      user: { id: string } | null;
    }>();
    return { cookie, csrf: state.csrfToken, callback, state };
  }
  return {
    app,
    db,
    catalog,
    login,
    inject,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("browser BFF and catalog authorization", () => {
  it("binds two invited identities to distinct stable actors and live membership checks", async () => {
    const { db, catalog, login, inject } = await setup();
    const alice = await login("alice");
    expect(alice.state.registered).toBe(false);
    expect(JSON.stringify(alice.state)).not.toContain("cognito:");
    expect(
      (
        await inject({
          method: "POST",
          url: "/cloud-api/api/transcription-jobs/claim",
          headers: { cookie: alice.cookie, origin, "x-vera-csrf": alice.csrf },
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await inject({
          method: "POST",
          url: "/cloud-api/api/transcripts/finalize",
          headers: { cookie: alice.cookie, origin, "x-vera-csrf": alice.csrf },
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await inject({
          method: "POST",
          url: "/cloud-api/local-agent/api/exports",
          headers: { cookie: alice.cookie, origin, "x-vera-csrf": alice.csrf },
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await inject({
          method: "GET",
          url: "/cloud-api/api/projects",
          headers: { cookie: alice.cookie },
        })
      ).statusCode,
    ).toBe(401);
    const post = (
      cookie: string,
      csrf: string,
      url: string,
      payload: object,
      originValue = origin,
    ) =>
      inject({
        method: "POST",
        url,
        headers: { cookie, origin: originValue, "x-vera-csrf": csrf },
        payload,
      });
    expect(
      (
        await post(
          alice.cookie,
          alice.csrf,
          "/cloud-api/api/session/register",
          { displayName: "Alice" },
          "https://evil.example",
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post(alice.cookie, "forged", "/cloud-api/api/session/register", {
          displayName: "Alice",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post(
          alice.cookie,
          alice.csrf,
          "/cloud-api/api/session/register",
          { displayName: "Alice", userId: randomUUID() },
        )
      ).statusCode,
    ).toBe(400);
    const registeredA = await post(
      alice.cookie,
      alice.csrf,
      "/cloud-api/api/session/register",
      { displayName: "Alice" },
    );
    expect(registeredA.statusCode).toBe(200);
    const aId = registeredA.json<{ id: string }>().id;
    expect(
      (
        await post(
          alice.cookie,
          alice.csrf,
          "/cloud-api/api/session/register",
          { displayName: "Alice again" },
        )
      ).json<{ id: string }>().id,
    ).toBe(aId);
    const firstProject = await post(
      alice.cookie,
      alice.csrf,
      "/cloud-api/api/projects",
      { name: "Alice project" },
    );
    expect(firstProject.statusCode).toBe(201);
    const projectId = firstProject.json<{ id: string }>().id;
    const bob = await login("bob");
    const [registeredB, concurrentRegistration] = await Promise.all([
      post(bob.cookie, bob.csrf, "/cloud-api/api/session/register", {
        displayName: "Bob",
      }),
      post(bob.cookie, bob.csrf, "/cloud-api/api/session/register", {
        displayName: "Bob concurrent",
      }),
    ]);
    expect(concurrentRegistration.statusCode).toBe(200);
    const bId = registeredB.json<{ id: string }>().id;
    expect(concurrentRegistration.json<{ id: string }>().id).toBe(bId);
    expect(bId).not.toBe(aId);
    expect(
      (
        await inject({
          method: "GET",
          url: "/cloud-api/api/projects",
          headers: { cookie: bob.cookie },
        })
      ).json(),
    ).toEqual([]);
    expect(
      (
        await inject({
          method: "GET",
          url: `/cloud-api/api/projects/${projectId}/clips`,
          headers: { cookie: bob.cookie },
        })
      ).statusCode,
    ).toBe(403);
    await catalog.addMember(
      {
        userId: aId,
        externalSubject: (await catalog.findUserByVerifiedSubject(
          `cognito:https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Test#${names[0]}`,
        ))!.externalSubject,
      },
      projectId,
      bId,
      "viewer",
    );
    expect(
      (
        await inject({
          method: "GET",
          url: `/cloud-api/api/projects/${projectId}/clips`,
          headers: { cookie: bob.cookie },
        })
      ).statusCode,
    ).toBe(200);
    await db.query(
      "DELETE FROM project_members WHERE project_id = $1 AND user_id = $2",
      [projectId, bId],
    );
    expect(
      (
        await inject({
          method: "GET",
          url: `/cloud-api/api/projects/${projectId}/clips`,
          headers: { cookie: bob.cookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await inject({
          method: "GET",
          url: "/cloud-api/api/projects",
          headers: {
            authorization: `Bearer ${bId}|anything`,
            cookie: bob.cookie,
          },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await inject({
          method: "GET",
          url: alice.callback,
          headers: { cookie: alice.cookie },
        })
      ).statusCode,
    ).toBe(400);
    const logout = await inject({
      method: "POST",
      url: "/cloud-api/auth/logout",
      headers: { cookie: alice.cookie, origin, "x-vera-csrf": alice.csrf },
    });
    expect(logout.statusCode).toBe(200);
    expect(
      logout.cookies.find((cookie) => cookie.name === SESSION_COOKIE)?.value,
    ).toBe("");
    expect(
      (
        await inject({
          method: "GET",
          url: "/cloud-api/api/session",
          headers: { cookie: alice.cookie },
        })
      ).json(),
    ).toMatchObject({ authenticated: false });
  }, 60_000);
  it("rejects wrong callback binding and an expired state even after a login attempt exists", async () => {
    const { login, advance, inject } = await setup();
    const hostileHost = await inject({
      method: "GET",
      url: "/cloud-api/auth/login",
      headers: {
        host: "evil.example",
        "x-forwarded-host": "research.example",
        "x-forwarded-proto": "https",
      },
    });
    expect(hostileHost.statusCode).toBe(403);
    const first = await inject({
      method: "GET",
      url: "/cloud-api/auth/login?returnTo=https://evil.example",
    });
    const uri = new URL(first.headers.location as string);
    const callback = `/cloud-api/auth/callback?code=alice&state=${uri.searchParams.get("state")}`;
    expect(
      (
        await inject({
          method: "GET",
          url: callback,
          headers: { cookie: `${LOGIN_COOKIE}=${"x".repeat(43)}` },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await inject({
          method: "GET",
          url: callback,
          headers: { cookie: `${LOGIN_COOKIE}=${first.cookies[0]!.value}` },
        })
      ).statusCode,
    ).toBe(400);
    const fresh = await inject({
      method: "GET",
      url: "/cloud-api/auth/login",
    });
    advance(300000);
    expect(
      (
        await inject({
          method: "GET",
          url: `/cloud-api/auth/callback?code=alice&state=${new URL(fresh.headers.location as string).searchParams.get("state")}`,
          headers: { cookie: `${LOGIN_COOKIE}=${fresh.cookies[0]!.value}` },
        })
      ).statusCode,
    ).toBe(400);
    expect((await login("alice")).state.registered).toBe(false);
  }, 60_000);
});
