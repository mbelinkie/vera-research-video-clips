import { describe, expect, it } from "vitest";
import {
  beginLogin,
  digestSecret,
  matchesCallback,
  matchesExactOrigin,
  MemoryLoginAttemptStore,
  normalizeReturnTo,
} from "./flow.ts";

describe("one-time browser login", () => {
  it("creates unguessable S256 PKCE, nonce, state and bound browser cookie", () => {
    const first = beginLogin(1000, "/projects?sort=recent");
    const second = beginLogin(1000, "/projects");
    expect(first.state).toMatch(/^[\w-]{43}$/u);
    expect(first.pending.verifier).toMatch(/^[\w-]{43}$/u);
    expect(first.pending.verifier).not.toBe(first.pending.nonce);
    expect(first.pending.bindingDigest).not.toBe(first.pending.stateDigest);
    expect(first.challenge).toMatch(/^[\w-]{43}$/u);
    expect(first.state).not.toBe(second.state);
    expect(first.pending.returnTo).toBe("/projects?sort=recent");
    expect(
      matchesCallback(
        first.pending,
        first.state,
        first.browserBinding,
        299_999,
      ),
    ).toBe(true);
    expect(
      matchesCallback(
        first.pending,
        first.state,
        first.browserBinding,
        301_000,
      ),
    ).toBe(false);
    expect(
      matchesCallback(first.pending, second.state, first.browserBinding, 1500),
    ).toBe(false);
    expect(
      matchesCallback(first.pending, first.state, second.browserBinding, 1500),
    ).toBe(false);
  });
  it("atomically consumes attempts even on invalid binding", async () => {
    const store = new MemoryLoginAttemptStore(() => 1000);
    const login = beginLogin(1000, "/");
    await store.put(login.pending);
    expect(await store.take(digestSecret(login.state))).toEqual(login.pending);
    expect(await store.take(digestSecret(login.state))).toBeUndefined();
  });
  it("rejects open redirect and noncanonical origins", () => {
    for (const target of [
      "https://evil.test",
      "//evil.test",
      "/%2e%2e//evil.test",
      "/x/../%2e%2e//evil.test",
      "/\\evil.test",
      "/%2f%2fevil.test",
      "/%5cevil.test",
      "/x#fragment",
      "/x\r\nLocation: evil",
    ])
      expect(normalizeReturnTo(target)).toBe("/");
    expect(
      matchesExactOrigin(
        "https://research.example",
        "https://research.example",
      ),
    ).toBe(true);
    expect(
      matchesExactOrigin("http://research.example", "https://research.example"),
    ).toBe(false);
    expect(matchesExactOrigin(undefined, "https://research.example")).toBe(
      false,
    );
  });
});
