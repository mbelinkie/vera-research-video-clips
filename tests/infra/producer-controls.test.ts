import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseEnvFile } from "../../scripts/pilot-host/files.ts";
import {
  acceptanceComment,
  ALL_ITEMS,
  newRecord,
  recordItem,
  signOff,
  undoItem,
  type AcceptanceRecord,
} from "../../scripts/producer-controls/acceptance.ts";
import {
  configuredUrl,
  createDatabaseAccounts,
} from "../../scripts/producer-controls/database-accounts.ts";
import {
  DemoProvider,
  readySnapshot,
  scenario,
  SCENARIOS,
  type ScenarioId,
} from "../../scripts/producer-controls/demo.ts";
import {
  classifySettingsProblems,
  compareMemberships,
  completeSettings,
  LiveProvider,
  probeEdge,
  setEnvValue,
  settingsTemplate,
} from "../../scripts/producer-controls/live.ts";
import {
  diagnosticSummary,
  openAccessGate,
  overview,
  scrub,
  setupSteps,
  type Snapshot,
} from "../../scripts/producer-controls/model.ts";
import {
  launcherScript,
  startControls,
} from "../../scripts/producer-controls/server.ts";

const now = new Date("2026-11-20T12:00:00Z");
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("overview answers the Producer's three questions", () => {
  const expected: Record<ScenarioId, [RegExp, string]> = {
    "first-run": [/Remote access is off/u, "open-filevault"],
    "recovery-needed": [/Remote access is off/u, "test-recovery"],
    ready: [/Remote access is off/u, "open-access"],
    "access-on": [/Invited testers can connect/u, "pause-access"],
    paused: [/Remote access is off/u, "open-access"],
    "wrong-sign-in": [/something needs fixing/u, "open-cognito"],
    "backup-stale": [/something needs fixing/u, "choose-backup-folder"],
    offline: [/Cloudflare isn't connected/u, "check-again"],
    "research-stopped": [/Research stopped/u, "start-research"],
  };
  for (const id of Object.keys(SCENARIOS) as ScenarioId[])
    it(`${id}: one headline and one next action`, () => {
      const o = overview(scenario(id, now), now);
      expect(o.headline).toMatch(expected[id][0]);
      expect(o.primary?.action).toBe(expected[id][1]);
      expect(o.areas.map((a) => a.label)).toEqual([
        "Mac protection",
        "Research storage",
        "Website and invitation settings",
        "Encrypted backup",
        "Remote access",
      ]);
    });

  it("labels an untested backup exactly as the brief does", () => {
    const o = overview(scenario("recovery-needed", now), now);
    expect(o.detail).toBe(
      "Local Research is ready. Test recovery before inviting friends in.",
    );
    expect(o.areas.find((a) => a.id === "backup")?.badge).toBe(
      "Recovery test needed",
    );
  });

  it("calls an on-Mac or unknown backup folder what it is", () => {
    const onMac = readySnapshot(now);
    onMac.settings.destinationOffDevice = "no";
    expect(setupSteps(onMac, now).find((s) => s.id === "backup")?.state).toBe(
      "attention",
    );
    const unknown = readySnapshot(now);
    unknown.settings.destinationOffDevice = "unknown";
    const step = setupSteps(unknown, now).find((s) => s.id === "backup")!;
    expect(step.state).toBe("unverified");
    expect(step.summary).toMatch(/^Unverified/u);
  });

  it("shows the exact Cognito sign-in and sign-out values", () => {
    const values = setupSteps(readySnapshot(now), now).find(
      (s) => s.id === "website-address",
    )?.values;
    expect(values).toContainEqual({
      label: "Cognito allowed callback URL",
      value: "https://research.example-producer.test/cloud-api/auth/callback",
    });
    expect(values).toContainEqual({
      label: "Cognito allowed sign-out URL",
      value: "https://research.example-producer.test/",
    });
  });
});

describe("outside access stays off until setup and recovery evidence pass", () => {
  it("allows opening only when every step passes", () => {
    expect(openAccessGate(readySnapshot(now), now).allowed).toBe(true);
    for (const id of [
      "first-run",
      "recovery-needed",
      "wrong-sign-in",
      "backup-stale",
    ] as const)
      expect(openAccessGate(scenario(id, now), now).allowed).toBe(false);
  });

  it("refuses a stale recovery test and an unconfirmed key", () => {
    const stale = readySnapshot(now);
    stale.recovery.lastDrillAt = "2026-11-01T00:00:00Z";
    expect(openAccessGate(stale, now).allowed).toBe(false);
    const key = readySnapshot(now);
    delete key.confirmations["backup-key-saved"];
    expect(openAccessGate(key, now).reasons[0]).toMatch(/backup key/iu);
  });

  it("the server-side action refuses too, whatever the page sends", async () => {
    const demo = new DemoProvider("recovery-needed");
    const result = await demo.act("open-access", {});
    expect(result.ok).toBe(false);
    expect((await demo.snapshot()).service.remoteLoaded).toBe(false);
    expect((await demo.act("test-recovery", {})).ok).toBe(true);
    expect((await demo.act("open-access", {})).ok).toBe(true);
    expect((await demo.snapshot()).service.reachableByFriends).toBe(true);
    expect((await demo.act("pause-access", {})).ok).toBe(true);
    expect((await demo.snapshot()).service.remoteLoaded).toBe(false);
  });
});

describe("#48 walkthrough record", () => {
  const live = (patch: Partial<Snapshot["service"]> = {}): Snapshot => {
    const s = readySnapshot(now);
    s.service = { ...s.service, ...patch };
    return s;
  };
  const on = live({
    remoteLoaded: true,
    remoteConnected: true,
    reachableByFriends: true,
  });

  it("needs remote access on for tester observations", () => {
    expect(() => recordItem(live(), newRecord(now), "tester-a", now)).toThrow(
      /remote access on/u,
    );
    const r = recordItem(on, newRecord(now), "tester-a", now);
    expect(r.items["tester-a"]?.remoteOn).toBe(true);
  });

  it("enforces order and records check evidence", () => {
    expect(() =>
      recordItem(on, newRecord(now), "owner-sees-clip", now),
    ).toThrow(/first/u);
    const r = recordItem(on, newRecord(now), "setup-complete", now);
    expect(r.items["setup-complete"]?.evidence).toMatch(/setup steps passed/u);
    expect(() =>
      recordItem(
        scenario("recovery-needed", now),
        newRecord(now),
        "setup-complete",
        now,
      ),
    ).toThrow(/Test your backup/u);
  });

  it("undo removes the item and anything recorded after it", () => {
    let r = newRecord(now);
    r = recordItem(on, r, "tester-a", new Date(now.getTime() + 1));
    r = recordItem(on, r, "tester-b", new Date(now.getTime() + 2));
    r = undoItem(r, "tester-a");
    expect(Object.keys(r.items)).toEqual([]);
  });

  it("sign-off needs every item, a name, and then freezes the record", async () => {
    const demo = new DemoProvider("ready");
    expect((await demo.acceptance("sign-off", { by: "P" })).ok).toBe(false);
    await demo.act("open-access", {});
    let tick = 0;
    const step = async () => {
      const state = await demo.state();
      return state.acceptance;
    };
    for (const item of ALL_ITEMS) {
      if (item.id === "restore-copy") await demo.act("restore-test-copy", {});
      if (item.id === "back-online") {
        demo.simulate("sleep");
        demo.simulate("wake");
      }
      if (item.id === "paused") await demo.act("pause-access", {});
      const result = await demo.acceptance("record", { id: item.id });
      expect(result, item.id).toMatchObject({ ok: true });
      tick++;
    }
    expect(tick).toBe(ALL_ITEMS.length);
    expect((await demo.acceptance("sign-off", { by: " " })).ok).toBe(false);
    const signed = await demo.acceptance("sign-off", { by: "Producer" });
    expect(signed.ok).toBe(true);
    const record: AcceptanceRecord = await step();
    expect(record.signOff?.by).toBe("Producer");
    expect(() => undoItem(record, "cut-off")).toThrow(/Signed off/u);
    expect(() =>
      signOff({ startedAt: record.startedAt, items: {} }, "P"),
    ).toThrow(/Every walkthrough step/u);
    const comment = acceptanceComment(await demo.snapshot(), record);
    expect(comment).toContain("signed off");
    expect(comment).not.toContain("example-producer.test");
    expect(comment).not.toMatch(/@example\.test/u);
    expect(comment).toContain("1 revoked since backup");
  });
});

describe("secrets and personal data stay out of what the page shows", () => {
  it("scrubs URL passwords, keys, tokens and emails", () => {
    const text = scrub(
      "postgresql://vera_pilot:hunter2@127.0.0.1/vera key=QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlq tester@example.com eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlc2lnbmF0dXJl COGNITO_CLIENT_SECRET=abc",
    );
    expect(text).not.toMatch(/hunter2|QUJDREVG|tester@|eyJhbGci|=abc/u);
    expect(text).toContain("postgresql://vera_pilot:•••@");
  });

  it("the diagnostic summary carries no secrets", () => {
    const s = scenario("backup-stale", now);
    s.backup.lastFailureMessage = "failed for owner@example.com";
    const summary = diagnosticSummary(s, now);
    expect(summary).toMatch(/Encrypted backup/u);
    expect(summary).not.toMatch(/owner@example\.com/u);
  });
});

describe("edge checks", () => {
  const origin = "https://research.example.test";
  const fake =
    (routes: Record<string, [number, string?]>) => async (url: string) => {
      const match = Object.entries(routes).find(([prefix]) =>
        url.startsWith(prefix),
      );
      if (!match) throw new Error("offline");
      const [status, location] = match[1];
      return { status, headers: { get: () => location ?? null } };
    };

  it("passes when Access guards the site and Cognito returns to it", async () => {
    const edge = await probeEdge(
      { origin, cognitoDomain: "https://pool.auth.test", clientId: "c" },
      fake({
        [`${origin}/`]: [
          302,
          "https://team.cloudflareaccess.com/cdn-cgi/access/login/x",
        ],
        "https://pool.auth.test/oauth2/authorize": [
          302,
          "https://pool.auth.test/login?x",
        ],
        "https://pool.auth.test/logout": [302, `${origin}/`],
      }),
      now,
    );
    expect(edge).toMatchObject({ access: "ok", signIn: "ok", signOut: "ok" });
  });

  it("names the exact fix for an open site or a wrong callback", async () => {
    const edge = await probeEdge(
      { origin, cognitoDomain: "https://pool.auth.test", clientId: "c" },
      fake({
        [`${origin}/`]: [200],
        "https://pool.auth.test/oauth2/authorize": [
          302,
          "https://pool.auth.test/error?error=redirect_mismatch",
        ],
        "https://pool.auth.test/logout": [302, "https://pool.auth.test/error"],
      }),
      now,
    );
    expect(edge.access).toBe("problem");
    expect(edge.accessDetail).toMatch(/without Cloudflare Access/u);
    expect(edge.signInDetail).toContain(`${origin}/cloud-api/auth/callback`);
    expect(edge.signOut).toBe("problem");
  });

  it("reports unknown, not ok, when nothing answers", async () => {
    const edge = await probeEdge(
      { origin, cognitoDomain: "https://pool.auth.test", clientId: "c" },
      fake({}),
      now,
    );
    expect(edge).toMatchObject({
      access: "unknown",
      signIn: "unknown",
      signOut: "unknown",
    });
  });
});

describe("restore reconciliation", () => {
  it("finds grants revoked or changed since the backup", () => {
    const row = (user: string, role: string) => ({
      project: "P",
      member: user,
      role,
      project_id: "p1",
      user_id: user,
    });
    const result = compareMemberships(
      [row("a", "owner"), row("b", "editor"), row("c", "editor")],
      [row("a", "owner"), row("c", "viewer"), row("d", "viewer")],
    );
    expect(result.unchanged).toBe(1);
    expect(result.restoredOnly.map((r) => r.member)).toEqual(["b"]);
    expect(result.roleChanged).toEqual([
      { project: "P", member: "c", role: "editor", liveRole: "viewer" },
    ]);
    expect(result.liveOnly.map((r) => r.member)).toEqual(["d"]);
  });
});

describe("settings file", () => {
  it("fills in modes and a signing secret without touching other values", () => {
    const text =
      "NODE_ENV=production\n# keep me\nLOCAL_UPLOAD_SIGNING_SECRET=short\n";
    const next = parseEnvFile(completeSettings(text));
    expect(next.DATABASE_MODE).toBe("postgres");
    expect(next.OBJECT_STORE_MODE).toBe("local");
    expect(next.LOCAL_UPLOAD_SIGNING_SECRET).toMatch(/^[0-9a-f]{96}$/u);
    expect(completeSettings(text)).toContain("# keep me");
    const done = completeSettings(text);
    expect(completeSettings(done)).toBe(done);
  });

  it("separates this Mac's settings from Cognito and Cloudflare values", () => {
    const zod = new Error(
      JSON.stringify([
        {
          path: ["cognitoDomain"],
          message: "COGNITO_DOMAIN must be a bare HTTPS Managed Login origin",
        },
        {
          path: ["cloudflareAccessAud"],
          message:
            "CF_ACCESS_AUD must be the Access application's 64-character audience tag",
        },
        {
          path: ["runtimeMode"],
          message: "Mac pilot requires PostgreSQL and local durable objects",
        },
      ]),
    );
    const split = classifySettingsProblems(zod, {
      PILOT_PG_URL: "postgresql://vera_pilot:CHANGE_ME@127.0.0.1/vera_pilot",
      COGNITO_CLIENT_ID: "CHANGE_ME",
    });
    expect(split.provider).toHaveLength(2);
    expect(split.local[0]).toMatch(/VERA fills this in/u);
    // Database passwords are step 3's job, not a step-2 problem.
    expect(split.local).toHaveLength(1);
    expect(split.local.join(" ")).not.toMatch(/\[|\{|"code"/u);
  });

  it("template parses and keeps derived sign-in URLs in step", () => {
    const text = settingsTemplate("/private/pilot");
    const env = parseEnvFile(text);
    expect(env.BROWSER_CALLBACK_URL).toBe(
      `${env.BROWSER_PUBLIC_ORIGIN}/cloud-api/auth/callback`,
    );
    const next = setEnvValue(
      text,
      "PILOT_BACKUP_DESTINATION",
      "/Volumes/Drive/VERA",
    );
    expect(parseEnvFile(next).PILOT_BACKUP_DESTINATION).toBe(
      "/Volumes/Drive/VERA",
    );
    expect(next).toContain("# Private: keep this file chmod 600.");
    expect(() => setEnvValue(text, "X", "a\nB=c")).toThrow();
  });

  it("the live provider creates a private file once and validates it", async () => {
    const root = await mkdtemp(join(tmpdir(), "vera107-"));
    roots.push(root);
    const envFile = join(root, "pilot.env");
    const live = new LiveProvider(envFile);
    expect((await live.snapshot()).settingsFile.exists).toBe(false);
    expect((await live.act("create-settings-file", {})).ok).toBe(true);
    expect((await stat(envFile)).mode & 0o777).toBe(0o600);
    expect((await live.act("create-settings-file", {})).ok).toBe(false);
    const snap = await live.snapshot();
    // A fresh file passes step 2 by itself; database passwords (step 3) and
    // Cognito/Cloudflare values (step 4) are reported where they belong.
    expect(snap.settingsFile.problem).toBeUndefined();
    expect(snap.settings.databaseAccountsConfigured).toBe(false);
    expect(snap.settings.providerProblems?.length).toBeGreaterThan(0);
    const steps = setupSteps(snap);
    expect(steps.find((s) => s.id === "settings-file")?.state).toBe("done");
    expect(steps.find((s) => s.id === "website-address")?.summary).toMatch(
      /Fill in the settings file from Cognito and Cloudflare/u,
    );
    const written = parseEnvFile(await readFile(envFile, "utf8"));
    expect(written.DATABASE_MODE).toBe("postgres");
    expect(written.LOCAL_UPLOAD_SIGNING_SECRET).toMatch(/^[0-9a-f]{96}$/u);
    expect(JSON.stringify(snap)).not.toMatch(
      /COGNITO_CLIENT_SECRET|CHANGE_ME@/u,
    );
    expect((await live.act("confirm", { id: "cache-bypass" })).ok).toBe(true);
    expect((await live.act("confirm", { id: "anything" })).ok).toBe(false);
    const state = join(root, "state", "producer-controls.json");
    expect((await stat(state)).mode & 0o777).toBe(0o600);
    expect(
      JSON.parse(await readFile(state, "utf8")).confirmations,
    ).toHaveProperty("cache-bypass");
    expect((await live.act("open-access", {})).ok).toBe(false);
  }, 30_000);
});

describe("local-only server", () => {
  const call = (
    port: number,
    options: {
      path: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    },
  ) =>
    new Promise<{
      status: number;
      body: string;
      headers: Record<string, unknown>;
    }>((done, fail) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path: options.path,
          method: options.method ?? "GET",
          headers: { host: `127.0.0.1:${port}`, ...options.headers },
        },
        (res) => {
          let body = "";
          res.on("data", (c: Buffer) => (body += c.toString()));
          res.on("end", () =>
            done({ status: res.statusCode ?? 0, body, headers: res.headers }),
          );
        },
      );
      req.on("error", fail);
      req.end(options.body);
    });

  it("serves the page with a token and refuses anything not from this Mac's page", async () => {
    const controls = await startControls({
      provider: new DemoProvider(),
      port: 0,
      token: "t".repeat(32),
    });
    try {
      const port = controls.port;
      const page = await call(port, { path: "/" });
      expect(page.status).toBe(200);
      expect(page.body).toContain("t".repeat(32));
      expect(String(page.headers["content-security-policy"])).toContain(
        "frame-ancestors 'none'",
      );
      expect(page.headers["cache-control"]).toBe("no-store");

      expect((await call(port, { path: "/api/state" })).status).toBe(403);
      const auth = { "x-controls-token": "t".repeat(32) };
      const state = await call(port, { path: "/api/state", headers: auth });
      expect(state.status).toBe(200);
      expect(JSON.parse(state.body).overview.headline).toBeTruthy();

      expect(
        (await call(port, { path: "/", headers: { host: "evil.example:80" } }))
          .status,
      ).toBe(421);
      expect(
        (
          await call(port, {
            path: "/",
            headers: { "cf-connecting-ip": "1.2.3.4" },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call(port, {
            path: "/",
            headers: { "x-forwarded-for": "1.2.3.4" },
          })
        ).status,
      ).toBe(403);

      const post = (body: unknown, headers: Record<string, string> = {}) =>
        call(port, {
          path: "/api/action",
          method: "POST",
          headers: { ...auth, "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        });
      expect(
        (
          await post(
            { action: "check-again" },
            { origin: "https://evil.example" },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await call(port, {
            path: "/api/action",
            method: "POST",
            headers: auth,
            body: "{}",
          })
        ).status,
      ).toBe(415);
      expect((await post({ action: "rm -rf" })).status).toBe(400);
      expect(
        (
          await post(
            { action: "check-again" },
            { origin: `http://127.0.0.1:${port}` },
          )
        ).status,
      ).toBe(202);
    } finally {
      await controls.close();
    }
  });

  it("the launcher only ever opens the loopback page", () => {
    const script = launcherScript({
      repoRoot: "/repo with space",
      nodePath: "/usr/local/bin/node",
      port: 43115,
      logFile: "/tmp/l.log",
    });
    expect(script).toContain('open location "http://127.0.0.1:43115/"');
    expect(script).toContain('set repoPath to "/repo with space"');
    expect(script).toContain("quoted form of repoPath");
    // The launcher must not wait on the background server (it froze when
    // the whole `cd && nohup …` list was backgrounded with its pipe open).
    expect(script).toContain(
      'quoted form of repoPath & " || exit 1; /usr/bin/nohup',
    );
    expect(script).toContain(
      '--no-open < /dev/null >> " & quoted form of logPath & " 2>&1 &"',
    );
  });
});

describe("Create database accounts", () => {
  type Call = { sql: string; params?: unknown[] };
  // A fake Postgres.app administrator: answers catalog lookups, expands
  // format() like PostgreSQL would, and records every statement.
  const fakeAdmin = (state: {
    superuser?: boolean;
    roles?: string[];
    dbOwner?: string;
  }) => {
    const calls: Call[] = [];
    const roles = new Set(state.roles ?? []);
    let dbOwner = state.dbOwner;
    const admin = async (sql: string, params?: unknown[]) => {
      calls.push({ sql, ...(params ? { params } : {}) });
      if (sql.includes("rolsuper"))
        return [{ name: "producer", rolsuper: state.superuser ?? true }];
      if (sql.includes("pg_get_userbyid"))
        return dbOwner ? [{ owner: dbOwner }] : [];
      if (sql.startsWith("SELECT 1 FROM pg_roles"))
        return roles.has(String(params?.[0])) ? [{ "?column?": 1 }] : [];
      if (sql.startsWith("SELECT format(")) {
        const [a, b] = (params ?? []).map(String);
        const verb = /'(\w+) (ROLE|DATABASE)/u.exec(sql)!;
        const text = sql.includes("DATABASE")
          ? `CREATE DATABASE "${a}" OWNER "${b}"`
          : `${verb[1]} ROLE "${a}" WITH LOGIN ${/LOGIN (.*) PASSWORD/u.exec(sql)![1]} PASSWORD '${b}'`;
        return [{ sql: text }];
      }
      if (sql.startsWith("CREATE ROLE")) roles.add(/"(\w+)"/u.exec(sql)![1]!);
      if (sql.startsWith("CREATE DATABASE")) dbOwner = "vera_pilot";
      return [];
    };
    return {
      admin,
      calls,
      executed: () =>
        calls.filter((c) => !c.sql.startsWith("SELECT")).map((c) => c.sql),
    };
  };
  let n = 0;
  const deps = (
    admin: (
      sql: string,
      params?: unknown[],
    ) => Promise<Array<Record<string, unknown>>>,
    canLogin = async () => true,
  ) => ({
    admin,
    canLogin,
    host: "127.0.0.1",
    port: 5432,
    password: () => `generated-${++n}`,
  });

  it("creates both least-privileged accounts and the database, then hands back URLs", async () => {
    const fake = fakeAdmin({});
    const result = await createDatabaseAccounts(
      {
        pilotUrl: "postgresql://vera_pilot:CHANGE_ME@127.0.0.1:5432/vera_pilot",
      },
      deps(fake.admin),
    );
    expect(result.changed).toBe(true);
    const sql = fake.executed();
    expect(sql[0]).toMatch(
      /^CREATE ROLE "vera_pilot" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD/u,
    );
    expect(sql[1]).toMatch(
      /^CREATE ROLE "vera_drill" WITH LOGIN NOSUPERUSER CREATEDB NOCREATEROLE PASSWORD/u,
    );
    expect(sql[2]).toBe('CREATE DATABASE "vera_pilot" OWNER "vera_pilot"');
    expect(sql.join(" ")).not.toMatch(/DROP|SUPERUSER(?! )|GRANT/u);
    expect(configuredUrl(result.settings!.PILOT_PG_URL, "vera_pilot")).toBe(
      true,
    );
    expect(new URL(result.settings!.PILOT_DRILL_PG_URL).pathname).toBe(
      "/postgres",
    );
    // The page only ever sees the message, never a password.
    expect(result.message).not.toMatch(/generated-/u);
  });

  it("changes nothing when the saved accounts already work", async () => {
    const fake = fakeAdmin({});
    const result = await createDatabaseAccounts(
      {
        pilotUrl: "postgresql://vera_pilot:ok@127.0.0.1:5432/vera_pilot",
        drillUrl: "postgresql://vera_drill:ok@127.0.0.1:5432/postgres",
      },
      deps(fake.admin),
    );
    expect(result).toMatchObject({ changed: false });
    expect(fake.calls).toHaveLength(0);
  });

  it("resets only VERA's own accounts when the saved passwords don't work", async () => {
    const fake = fakeAdmin({
      roles: ["vera_pilot", "vera_drill"],
      dbOwner: "vera_pilot",
    });
    let first = true;
    const result = await createDatabaseAccounts(
      {
        pilotUrl: "postgresql://vera_pilot:stale@127.0.0.1:5432/vera_pilot",
        drillUrl: "postgresql://vera_drill:stale@127.0.0.1:5432/postgres",
      },
      deps(fake.admin, async () => (first ? ((first = false), false) : true)),
    );
    expect(result.changed).toBe(true);
    expect(fake.executed().map((sql) => sql.split(" WITH")[0])).toEqual([
      'ALTER ROLE "vera_pilot"',
      'ALTER ROLE "vera_drill"',
    ]);
  });

  it("refuses without administrator rights or when the database is someone else's", async () => {
    await expect(
      createDatabaseAccounts({}, deps(fakeAdmin({ superuser: false }).admin)),
    ).rejects.toThrow(/can't create accounts/u);
    const taken = fakeAdmin({ dbOwner: "someone_else" });
    await expect(createDatabaseAccounts({}, deps(taken.admin))).rejects.toThrow(
      /belongs to someone else/u,
    );
    expect(taken.executed()).toEqual([]);
  });

  it("reports failure if the new accounts can't sign in", async () => {
    await expect(
      createDatabaseAccounts(
        {},
        deps(fakeAdmin({}).admin, async () => false),
      ),
    ).rejects.toThrow(/couldn't sign in/u);
  });

  it("step 3 offers the button once PostgreSQL is running", async () => {
    const demo = new DemoProvider("first-run");
    await demo.act("open-postgres", {});
    const before = setupSteps(await demo.snapshot(), now).find(
      (s) => s.id === "research-storage",
    )!;
    expect(before.actions).toContain("create-database-accounts");
    expect(before.help).toBeUndefined();
    expect((await demo.act("create-database-accounts", {})).ok).toBe(true);
    const after = setupSteps(await demo.snapshot(), now).find(
      (s) => s.id === "research-storage",
    )!;
    expect(after.state).toBe("done");
  });
});
