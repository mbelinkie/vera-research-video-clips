import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { SharedProjectCatalog } from "@research-video/catalog";
import type { YouTubeCaptureDetails } from "@research-video/contracts";
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
type TestIdentity = "alice" | "bob";
function identityProvider(
  now: () => number,
  emails: Record<TestIdentity, string | null>,
): IdentityProvider {
  const tokens = (code: TestIdentity): VerifiedTokens => ({
    ...(emails[code] ? { verifiedEmail: emails[code] } : {}),
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
      if (code !== "alice" && code !== "bob") throw Error("invalid code");
      return tokens(code);
    },
    async refresh(_refresh, subject) {
      return { ...tokens("alice"), subject };
    },
    async revoke() {},
  };
}
async function setup() {
  let now = 1000;
  const emails: Record<TestIdentity, string | null> = {
    alice: "alice@example.com",
    bob: "bob@example.com",
  };
  const db = new PGlite();
  dbs.push(db);
  await runCloudMigrations(db);
  const catalog = new SharedProjectCatalog(
    db,
    new MemoryTranscriptObjectStore(),
    () => new Date(now),
  );
  const auth = createBrowserAuth({
    publicOrigin: origin,
    trustedProxyPeers: ["127.0.0.1"],
    catalog,
    provider: identityProvider(() => now, emails),
    now: () => now,
  });
  const app = createCloudApi({
    catalog,
    authenticate: (request) => auth.authenticate(request),
    browserAuth: auth,
    videoMetadataProvider: {
      resolve: async (videoId) => ({ videoId, title: "Synthetic video" }),
    },
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
    emails,
    login,
    inject,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("browser BFF and catalog authorization", () => {
  it("limits exact grants to Owners and available registered verified addresses", async () => {
    const { login, emails, inject, advance } = await setup();
    const alice = await login("alice");
    const bob = await login("bob");
    const post = (session: typeof alice, path: string, payload: object) =>
      inject({
        method: "POST",
        url: "/cloud-api/api" + path,
        headers: {
          cookie: session.cookie,
          origin,
          "x-vera-csrf": session.csrf,
        },
        payload,
      });
    const register = (session: typeof alice, displayName: string) =>
      post(session, "/session/register", { displayName });
    expect((await register(alice, "Alice")).statusCode).toBe(200);
    const project = (
      await post(alice, "/projects", { name: "Email proof" })
    ).json<{ id: string }>();
    const base = `/projects/${project.id}`;
    const grant = (session: typeof alice, email: string, role = "editor") =>
      post(session, base + "/members/by-email", { email, role });
    const read = (session: typeof alice, path: string) =>
      inject({
        method: "GET",
        url: "/cloud-api/api" + base + path,
        headers: { cookie: session.cookie },
      });
    const missing = await grant(alice, "missing@example.com");
    const unregistered = await grant(alice, "bob@example.com");
    expect(missing.statusCode).toBe(404);
    expect(unregistered.json()).toEqual(missing.json());
    expect(missing.body).not.toContain("missing@example.com");
    expect((await grant(alice, "bob@example.com", "owner")).statusCode).toBe(
      400,
    );
    expect((await register(bob, "Bob")).statusCode).toBe(200);
    expect((await grant(bob, "alice@example.com")).statusCode).toBe(403);
    expect((await read(bob, "/my-membership")).statusCode).toBe(403);
    expect((await grant(alice, "BOB@EXAMPLE.COM")).statusCode).toBe(204);
    expect((await read(bob, "/my-membership")).json()).toMatchObject({
      membership: { role: "researcher" },
    });
    // Migration 0027's roster lets any reader list members, but only Owners
    // receive verified addresses.
    const bobRoster = await read(bob, "/members");
    expect(bobRoster.statusCode).toBe(200);
    expect(bobRoster.body).not.toContain("example.com");
    expect(bobRoster.body).not.toContain("verifiedEmail");
    expect((await grant(bob, "missing@example.com")).statusCode).toBe(403);
    const roster = await read(alice, "/members");
    expect(roster.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          displayName: "Bob",
          verifiedEmail: "bob@example.com",
          role: "researcher",
        }),
      ]),
    );
    expect(roster.body).not.toContain("externalSubject");

    // A second subject verified the same address. It cannot implicitly take
    // over the first account's address or receive access for a new project.
    advance(100);
    emails.bob = "alice@example.com";
    const duplicate = await login("bob");
    expect(JSON.stringify(duplicate.state)).not.toContain("alice@example.com");
    expect((await grant(alice, "alice@example.com")).json()).toEqual(
      missing.json(),
    );
    advance(100);
    emails.bob = null;
    await login("bob");
    expect((await grant(alice, "bob@example.com")).json()).toEqual(
      missing.json(),
    );
    // A still-valid older session cannot restore the old association.
    expect((await register(bob, "Bob")).statusCode).toBe(200);
    expect((await grant(alice, "bob@example.com")).json()).toEqual(
      missing.json(),
    );

    for (let i = 0; i < 4; i++) {
      expect((await grant(alice, "missing@example.com")).statusCode).toBe(404);
    }
    expect((await grant(alice, "missing@example.com")).statusCode).toBe(429);
  });

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

it("pairs once with same-origin consent, then queues an attributed video from Chrome with no VERA cookie", async () => {
  const { db, login, inject } = await setup();
  const alice = await login("alice");
  const web = { origin, cookie: alice.cookie, "x-vera-csrf": alice.csrf };
  const post = (
    url: string,
    headers: Record<string, string>,
    payload: object = {},
  ) => inject({ method: "POST", url, headers, payload });
  expect(
    (await post("/api/session/register", web, { displayName: "Researcher" }))
      .statusCode,
  ).toBe(200);
  const project = (
    await post("/api/projects", web, { name: "Documentary" })
  ).json<{ id: string }>();
  const key = randomBytes(32);
  const extOrigin = "chrome-extension://" + "a".repeat(32);
  const client = {
    origin: extOrigin,
    "x-vera-capture-key": key.toString("hex"),
  };
  const projects = "/extension/v1/projects";
  const pair = (
    await post(
      "/extension/v1/pair",
      { origin: extOrigin },
      { digest: createHash("sha256").update(key).digest("hex") },
    )
  ).json();
  expect((await post(projects, client)).statusCode).toBe(401);
  for (const headers of [
    { ...web, origin: extOrigin },
    { ...web, "x-vera-csrf": "wrong" },
  ]) {
    expect(
      (await post("/api/extension-connections", headers, pair)).statusCode,
    ).toBe(403);
  }
  expect(
    (
      await post("/api/extension-connections", web, {
        ...pair,
        code: "invalid",
      })
    ).statusCode,
  ).toBe(400);
  expect((await post("/api/extension-connections", web, pair)).statusCode).toBe(
    200,
  );
  expect((await post("/api/extension-connections", web, pair)).statusCode).toBe(
    403,
  );
  expect((await post(projects, client)).json()).toEqual([
    { id: project.id, name: "Documentary" },
  ]);
  expect(
    (
      await post(projects, {
        ...client,
        origin: "chrome-extension://" + "b".repeat(32),
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (await post(projects, { ...client, cookie: alice.cookie })).statusCode,
  ).toBe(403);
  expect(
    (await post("/api/projects", client, { name: "Not allowed" })).statusCode,
  ).toBe(403);
  const path = projects + "/" + project.id + "/captures";
  const video = {
    kind: "youtube",
    requestId: randomUUID(),
    url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
    comment: "01:42 — the camera shows the original sign.",
  };
  const [queued, simultaneous] = await Promise.all([
    post(path, client, video),
    post(path, client, video),
  ]);
  expect(simultaneous.json()).toEqual(queued.json());
  expect(queued.statusCode, queued.body).toBe(201);
  // The pilot's language gate holds the Chrome-queued video until a member
  // confirms its language; the queue is reached through that confirmation.
  expect(queued.json().status).toBe("needs_language_confirmation");
  expect((await post(path, client, video)).json()).toEqual(queued.json());
  expect(
    (await post(path, client, { ...video, comment: "changed" })).statusCode,
  ).toBe(409);
  const read = async (url: string) =>
    (
      await inject({ method: "GET", url, headers: { cookie: alice.cookie } })
    ).json();
  const base = "/api/projects/" + project.id;
  const { items } = await read(
    base + "/transcription-batches/" + queued.json().batchId,
  );
  expect(items[0].videoComments).toMatchObject([
    { text: video.comment, timecodeMs: null, authorName: "Researcher" },
  ]);
  const commentsPath =
    base + "/sources/" + items[0].catalogVideoId + "/comments";
  const second = {
    ...video,
    requestId: randomUUID(),
    comment: "Interview starts here.",
    timecodeMs: 490012,
  };
  const secondSave = await post(path, client, second);
  expect(secondSave.json()).toEqual(queued.json());
  expect((await post(path, client, second)).json()).toEqual(queued.json());
  const timestampOnly = await post(path, client, {
    kind: video.kind,
    url: video.url,
    requestId: randomUUID(),
    timecodeMs: 0,
  });
  expect(timestampOnly.json()).toEqual(queued.json());
  expect(
    (
      await post(path, client, {
        kind: video.kind,
        url: video.url,
        requestId: randomUUID(),
      })
    ).json(),
  ).toEqual(queued.json());
  const comments = await read(commentsPath);
  expect(comments).toMatchObject([
    { text: video.comment, timecodeMs: null },
    { text: second.comment, timecodeMs: 490012 },
    { text: null, timecodeMs: 0 },
  ]);
  expect(
    comments.every(
      (comment: { sourceId: string }) =>
        comment.sourceId === items[0].catalogVideoId,
    ),
  ).toBe(true);
  expect(await read(commentsPath + "?offset=2")).toEqual(comments.slice(2));
  const videoPath = base + "/videos/" + items[0].catalogVideoId;
  const gate = await read(videoPath + "/language-gate");
  const confirmation = await post(
    videoPath + "/language-decisions",
    web,
    {
      idempotencyKey: "chrome-queue:confirm-en",
      expectedDecisionVersion: gate.decision?.decisionVersion ?? 0,
      resolvedLanguage: "en",
      basis: "user_confirmation",
      ...(gate.providerEvidence?.id
        ? { evidenceId: gate.providerEvidence.id }
        : {}),
      batchItemId: items[0].id,
      expectedBatchItemVersion: items[0].version,
    },
  );
  expect(confirmation.statusCode, confirmation.body).toBe(200);
  expect(
    (await read(base + "/transcription-batches/" + queued.json().batchId))
      .items[0].state,
  ).toBe("queued");
  expect(
    (await db.query("SELECT id FROM transcription_batches")).rows,
  ).toHaveLength(1);
  expect(
    (await db.query("SELECT id FROM library_sources WHERE kind='youtube'"))
      .rows,
  ).toHaveLength(1);
  expect((await db.query("SELECT id FROM jobs")).rows).toHaveLength(1);
  await db.query(
    "UPDATE transcription_batch_items SET state='ready_for_review' WHERE batch_id=$1",
    [queued.json().batchId],
  );
  const entry = (await read(base + "/review-inbox")).items[0];
  expect(entry.videoCommentCount).toBe(3);
  expect(entry.videoComments).toMatchObject(
    comments.map(
      (comment: { sourceId: string; timecodeMs: number | null }) => ({
        sourceId: comment.sourceId,
        timecodeMs: comment.timecodeMs,
      }),
    ),
  );
  expect(
    entry.videoComments.map((comment: { id: string }) => comment.id),
  ).toEqual(comments.map((comment: { id: string }) => comment.id));
  await db.query(
    "UPDATE project_members SET role='viewer' WHERE project_id=$1",
    [project.id],
  );
  expect((await post(projects, client)).json()).toEqual([]);
  expect((await post(path, client, video)).statusCode).toBe(403);
  expect((await post("/extension/v1/disconnect", client)).statusCode).toBe(200);
  expect((await post(projects, client)).statusCode).toBe(401);
}, 60_000);

it("keeps one project reason and independent YouTube moments across replays", async () => {
  const { db, login, inject } = await setup();
  const extOrigin = "chrome-extension://" + "a".repeat(32);
  const projectsPath = "/extension/v1/projects";
  const post = (
    url: string,
    headers: Record<string, string>,
    payload: object,
  ) => inject({ method: "POST", url, headers, payload });
  async function member(identity: TestIdentity, displayName: string) {
    const session = await login(identity);
    const web = { origin, cookie: session.cookie, "x-vera-csrf": session.csrf };
    const registered = await post("/api/session/register", web, {
      displayName,
    });
    expect(registered.statusCode, registered.body).toBe(200);
    const key = randomBytes(32);
    const pair = await post(
      "/extension/v1/pair",
      { origin: extOrigin },
      { digest: createHash("sha256").update(key).digest("hex") },
    );
    expect(pair.statusCode, pair.body).toBe(200);
    const approved = await post("/api/extension-connections", web, pair.json());
    expect(approved.statusCode, approved.body).toBe(200);
    return {
      web,
      client: { origin: extOrigin, "x-vera-capture-key": key.toString("hex") },
      cookie: session.cookie,
      userId: registered.json<{ id: string }>().id,
    };
  }
  const alice = await member("alice", "Researcher Alice");
  const bob = await member("bob", "Researcher Bob");
  async function project(name: string) {
    const response = await post("/api/projects", alice.web, { name });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ id: string }>().id;
  }
  const projectId = await project("Project with moments");
  const otherId = await project("Other project");
  const itemPath = projectsPath + "/" + projectId;
  const path = itemPath + "/captures";
  const lookup = itemPath + "/youtube-source";
  const url = "https://www.youtube.com/watch?v=M7lc1UVf-VE";
  const alias = "https://youtu.be/M7lc1UVf-VE?t=20";
  const capture = (youtubeDetails: YouTubeCaptureDetails) => ({
    kind: "youtube",
    requestId: randomUUID(),
    url,
    youtubeDetails,
  });

  expect((await post(lookup, alice.client, { url })).json()).toEqual({
    reason: null,
    sourceId: null,
  });
  expect((await post(lookup, bob.client, { url })).statusCode).toBe(403);
  const blank = await post(
    path,
    alice.client,
    capture({ kind: "general", reason: "" }),
  );
  expect(blank.statusCode, blank.body).toBe(201);
  const receipt = blank.json<{ sourceId: string; batchId: string }>();
  const base = "/api/projects/" + projectId;
  const sourcePath = base + "/sources/" + receipt.sourceId;
  expect(blank.json().sourcePath).toBe(
    `/?projectId=${projectId}&sourceId=${receipt.sourceId}`,
  );
  const detailsPath = sourcePath + "/youtube-details";
  const read = async (url: string, cookie = alice.cookie) => {
    const result = await inject({ method: "GET", url, headers: { cookie } });
    expect(result.statusCode, result.body).toBe(200);
    return result.json();
  };
  expect(await read(detailsPath)).toMatchObject({
    sourceId: receipt.sourceId,
    url,
    reason: null,
    moments: [],
  });
  const first = capture({ kind: "general", reason: "Look at the opening" });
  expect((await post(path, alice.client, first)).json()).toEqual(blank.json());
  expect(
    (await post(lookup, alice.client, { url: alias })).json(),
  ).toMatchObject({
    sourceId: receipt.sourceId,
    reason: { text: "Look at the opening", updatedBy: alice.userId },
  });
  const grant = await post(base + "/members/by-email", alice.web, {
    email: "bob@example.com",
    role: "editor",
  });
  expect(grant.statusCode, grant.body).toBe(204);
  const unchanged = capture({ kind: "general", reason: "Look at the opening" });
  expect((await post(path, bob.client, unchanged)).statusCode).toBe(201);
  expect((await read(detailsPath)).reason.updatedBy).toBe(alice.userId);
  const edit = capture({ kind: "general", reason: "Use the interview" });
  expect(
    (await post(path, bob.client, { ...edit, url: alias })).json(),
  ).toEqual(blank.json());
  expect(
    (await post(path, alice.client, { ...first, url: alias })).json(),
  ).toEqual(blank.json());
  const untouched = await post(
    path,
    alice.client,
    capture({ kind: "general" }),
  );
  expect(untouched.statusCode, untouched.body).toBe(201);
  const reason = (await read(detailsPath, bob.cookie)).reason;
  expect(reason).toMatchObject({
    text: "Use the interview",
    updatedBy: bob.userId,
    updatedByName: "Researcher Bob",
  });
  const moment = capture({
    kind: "moment",
    timecodeMs: 252345,
    note: "Interview",
  });
  const replies = await Promise.all([
    post(path, alice.client, moment),
    post(path, alice.client, { ...moment, url: alias }),
  ]);
  for (const reply of replies) expect(reply.json()).toEqual(blank.json());
  const timeOnly = capture({ kind: "moment", timecodeMs: 0, note: "" });
  expect((await post(path, bob.client, timeOnly)).json()).toEqual(blank.json());
  expect(
    (
      await post(path, alice.client, {
        ...moment,
        youtubeDetails: {
          kind: "moment",
          timecodeMs: 252346,
          note: "Interview",
        },
      })
    ).statusCode,
  ).toBe(409);
  expect(await read(detailsPath)).toMatchObject({
    reason,
    moments: [
      {
        timecodeMs: 0,
        note: null,
        authorId: bob.userId,
        authorName: "Researcher Bob",
      },
      {
        timecodeMs: 252345,
        note: "Interview",
        authorId: alice.userId,
        authorName: "Researcher Alice",
      },
    ],
  });
  expect(await read(sourcePath + "/comments")).toEqual([]);
  expect((await db.query("SELECT id FROM library_items")).rows).toHaveLength(0);
  expect(
    (await db.query("SELECT id FROM transcription_batches")).rows,
  ).toHaveLength(1);

  expect(
    (
      await post(
        projectsPath + "/" + otherId + "/youtube-source",
        alice.client,
        { url },
      )
    ).json(),
  ).toEqual({
    reason: null,
    sourceId: null,
  });
  expect(
    (
      await inject({
        method: "GET",
        url: detailsPath.replace(projectId, otherId),
        headers: { cookie: alice.cookie },
      })
    ).statusCode,
  ).toBe(404);
  const otherCapture = await post(
    projectsPath + "/" + otherId + "/captures",
    alice.client,
    timeOnly,
  );
  expect(otherCapture.statusCode, otherCapture.body).toBe(201);
  expect(otherCapture.json().sourceId).toBe(receipt.sourceId);
  expect(await read(detailsPath.replace(projectId, otherId))).toMatchObject({
    reason: null,
    moments: [{ timecodeMs: 0, note: null, authorId: alice.userId }],
  });
  expect((await read(detailsPath)).moments).toHaveLength(2);
  await db.query(
    "UPDATE project_members SET role='viewer' WHERE project_id=$1 AND user_id=$2",
    [projectId, bob.userId],
  );
  expect((await read(detailsPath, bob.cookie)).reason).toEqual(reason);
  expect((await post(lookup, bob.client, { url })).statusCode).toBe(403);
  expect((await post(path, bob.client, edit)).statusCode).toBe(403);
  const cleared = await post(
    path,
    alice.client,
    capture({ kind: "general", reason: "" }),
  );
  expect(cleared.statusCode, cleared.body).toBe(201);
  expect((await read(detailsPath)).reason).toBeNull();
}, 60_000);
