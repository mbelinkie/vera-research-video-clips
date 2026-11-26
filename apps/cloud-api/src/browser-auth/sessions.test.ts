import { describe, expect, it } from "vitest";
import {
  cookieHeader,
  readCookie,
  SESSION_COOKIE,
  MemorySessionStore,
} from "./sessions.ts";
import type { IdentityProvider, VerifiedTokens } from "./provider.ts";

const token = (subject: string, expiresAtMs: number): VerifiedTokens => ({
  subject,
  accessToken: "server-only",
  refreshToken: "server-only-refresh",
  expiresAtMs,
});
const provider = (
  refresher: (refresh: string, subject: string) => Promise<VerifiedTokens>,
  revoked: string[] = [],
): IdentityProvider => ({
  authorizeUrl: () => "https://login.example/auth",
  logoutUrl: () => "https://login.example/logout",
  exchange: async () => token("cognito:alice", 100000),
  refresh: refresher,
  revoke: async (value) => {
    revoked.push(value);
  },
});
describe("opaque browser sessions", () => {
  it("uses host-only Secure HttpOnly cookies and rejects cookie ambiguity", () => {
    expect(cookieHeader(SESSION_COOKIE, "secret")).toContain(
      "Secure; HttpOnly; SameSite=Lax",
    );
    expect(cookieHeader(SESSION_COOKIE, "secret")).not.toContain("Domain=");
    const value = "x".repeat(43);
    expect(readCookie(`${SESSION_COOKIE}=${value}`, SESSION_COOKIE)).toBe(
      value,
    );
    expect(
      readCookie(
        `${SESSION_COOKIE}=${value}; ${SESSION_COOKIE}=${value}`,
        SESSION_COOKIE,
      ),
    ).toBeUndefined();
    expect(
      readCookie(
        `${SESSION_COOKIE}=; ${SESSION_COOKIE}=${value}`,
        SESSION_COOKIE,
      ),
    ).toBeUndefined();
  });
  it("expires at idle and absolute bounds, and logout invalidates instantly", async () => {
    let now = 0;
    const revoked: string[] = [];
    const store = new MemorySessionStore(
      provider(async () => token("cognito:alice", 100000), revoked),
      () => now,
      1_000,
      3_000,
    );
    const first = store.create(token("cognito:alice", 100000));
    expect((await store.get(first.id))?.subject).toBe("cognito:alice");
    now = 999;
    expect(await store.get(first.id)).toBeDefined();
    now = 1999;
    expect(await store.get(first.id)).toBeUndefined();
    now = 2000;
    const next = store.create(token("cognito:alice", 100000));
    await store.invalidate(next.id);
    expect(await store.get(next.id)).toBeUndefined();
    expect(revoked).toEqual(["server-only-refresh"]);
  });
  it("does not keep idle sessions alive through background status polling", async () => {
    let now = 0;
    const store = new MemorySessionStore(
      provider(async () => token("cognito:alice", 100000)),
      () => now,
      1000,
      10000,
    );
    const { id } = store.create(token("cognito:alice", 100000));
    now = 900;
    expect(await store.get(id, false)).toBeDefined();
    now = 1000;
    expect(await store.get(id, false)).toBeUndefined();
  });
  it("supersedes older registration evidence only for the same subject", () => {
    const store = new MemorySessionStore(
      provider(async () => token("cognito:alice", 100000)),
      () => 0,
    );
    const first = store.create(
      { ...token("cognito:alice", 100000), verifiedEmail: "old@example.com" },
      5,
    );
    const other = store.create(
      { ...token("cognito:bob", 100000), verifiedEmail: "bob@example.com" },
      5,
    );
    store.create(token("cognito:alice", 100000), 10);
    expect(first.session.memberEmail).toEqual({
      email: null,
      observedAt: new Date(10),
    });
    expect(other.session.memberEmail.email).toBe("bob@example.com");
    const late = store.create(
      { ...token("cognito:alice", 100000), verifiedEmail: "old@example.com" },
      7,
    );
    expect(late.session.memberEmail).toEqual(first.session.memberEmail);
  });

  it("single-flights refresh and fails closed on changed identity", async () => {
    let now = 0,
      calls = 0;
    const store = new MemorySessionStore(
      provider(async () => {
        calls++;
        return token("cognito:alice", 100000);
      }),
      () => now,
      100000,
      200000,
    );
    const { id, session } = store.create(token("cognito:alice", 1000));
    const [first, second] = await Promise.all([store.get(id), store.get(id)]);
    expect(first).toBe(session);
    expect(second).toBe(session);
    expect(calls).toBe(1);
    expect(store.verifyCsrf(session, session.csrf)).toBe(true);
    expect(store.verifyCsrf(session, "forged")).toBe(false);
    const bad = new MemorySessionStore(
      provider(async () => token("cognito:bob", 100000)),
      () => now,
    );
    const misbound = bad.create(token("cognito:alice", 1000));
    expect(await bad.get(misbound.id)).toBeUndefined();
  });
});
