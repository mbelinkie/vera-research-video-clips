import { describe, expect, it, vi } from "vitest";

import { CognitoOAuthClient, type FetchLike } from "@research-video/auth";

import { DesktopAuthenticationBroker } from "./broker.ts";
import {
  EncryptedRefreshTokenStore,
  type AsyncSafeStorage,
  type EncryptedRefreshTokenFile,
  type EncryptedRefreshTokenRecord,
} from "./refresh-token-store.ts";

const authority = "https://tenant.auth.us-east-1.amazoncognito.com";

function makeBroker(
  options: { storageAvailable?: boolean; now?: () => number } = {},
) {
  let stored: EncryptedRefreshTokenRecord | undefined;
  const safeStorage: AsyncSafeStorage = {
    isEncryptionAvailable: vi.fn(async () => options.storageAvailable ?? true),
    encryptString: vi.fn(async (value) =>
      new TextEncoder().encode(`key:${value}`),
    ),
    decryptString: vi.fn(async (value) => {
      const decrypted = new TextDecoder().decode(value);
      if (!decrypted.startsWith("key:"))
        throw new Error("invalid encrypted token");
      return decrypted.slice(4);
    }),
  };
  const file: EncryptedRefreshTokenFile = {
    read: vi.fn(async () => stored),
    write: vi.fn(async (record) => {
      stored = {
        schemaVersion: record.schemaVersion,
        ciphertext: new Uint8Array(record.ciphertext),
      };
    }),
    remove: vi.fn(async () => {
      stored = undefined;
    }),
  };
  const fetch = vi.fn(
    async (_input: string | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          access_token: "access-token-that-must-stay-in-main",
          refresh_token: "refresh-token-that-must-stay-in-main",
          expires_in: 3_600,
          token_type: "Bearer",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
  const typedFetch: FetchLike = fetch;
  const client = new CognitoOAuthClient(
    {
      authority,
      clientId: "desktop-client",
      callbackUri: "research-video-clips://oauth/callback",
      logoutUri: "research-video-clips://oauth/signout",
    },
    {
      fetch: typedFetch,
      crypto: {
        randomBytes: (length) => new Uint8Array(length).fill(7),
        sha256: async () => new Uint8Array(32).fill(8),
      },
      now: options.now ?? (() => 1_000),
    },
  );
  const browser = { open: vi.fn(async (_url: URL) => undefined) };
  const refreshTokens = new EncryptedRefreshTokenStore(safeStorage, file);
  const broker = new DesktopAuthenticationBroker(
    client,
    refreshTokens,
    browser,
    options.now ?? (() => 1_000),
  );
  return { broker, browser, fetch, file, refreshTokens };
}

describe("desktop authentication broker", () => {
  it("exchanges an exact queued callback and exposes only a sanitized renderer status", async () => {
    const { broker, browser } = makeBroker();

    await expect(broker.beginSignIn()).resolves.toEqual({
      state: "signing_in",
    });
    const authorizationUrl = new URL(
      vi.mocked(browser.open).mock.calls[0]?.[0].href ?? "",
    );
    const callback = new URL("research-video-clips://oauth/callback");
    callback.searchParams.set("code", "one-time-code");
    callback.searchParams.set(
      "state",
      authorizationUrl.searchParams.get("state") ?? "",
    );

    expect(broker.acceptNativeCallback(callback.href)).toEqual({
      accepted: true,
    });
    await broker.drainNativeCallbacks();

    const status = broker.getRendererStatus();
    expect(status).toMatchObject({ state: "signed_in" });
    expect(JSON.stringify(status)).not.toContain("token");
    expect(await broker.getAccessTokenForTrustedProxy()).toBe(
      "access-token-that-must-stay-in-main",
    );
  });

  it("rejects malformed and replayed callback delivery without changing a signed session", async () => {
    const { broker, browser } = makeBroker();
    await broker.beginSignIn();
    const authorizationUrl = new URL(
      vi.mocked(browser.open).mock.calls[0]?.[0].href ?? "",
    );
    const callback = new URL("research-video-clips://oauth/callback");
    callback.searchParams.set("code", "one-time-code");
    callback.searchParams.set(
      "state",
      authorizationUrl.searchParams.get("state") ?? "",
    );

    expect(
      broker.acceptNativeCallback("https://untrusted.example/callback"),
    ).toEqual({
      accepted: false,
      reason: "malformed",
    });
    expect(broker.acceptNativeCallback(callback.href)).toEqual({
      accepted: true,
    });
    await broker.drainNativeCallbacks();
    expect(broker.acceptNativeCallback(callback.href)).toEqual({
      accepted: false,
      reason: "replayed",
    });
    expect(broker.getRendererStatus()).toMatchObject({ state: "signed_in" });
  });

  it("fails closed when Keychain-backed storage cannot persist the refresh token", async () => {
    const { broker, browser } = makeBroker({ storageAvailable: false });
    await broker.beginSignIn();
    const authorizationUrl = new URL(
      vi.mocked(browser.open).mock.calls[0]?.[0].href ?? "",
    );
    const callback = new URL("research-video-clips://oauth/callback");
    callback.searchParams.set("code", "one-time-code");
    callback.searchParams.set(
      "state",
      authorizationUrl.searchParams.get("state") ?? "",
    );

    broker.acceptNativeCallback(callback.href);
    await broker.drainNativeCallbacks();

    expect(broker.getRendererStatus()).toEqual({ state: "signed_out" });
    await expect(broker.getAccessTokenForTrustedProxy()).rejects.toMatchObject({
      code: "desktop_authentication_failed",
    });
  });

  it("refreshes a protected session on restore without putting credentials in status", async () => {
    const { broker, refreshTokens, fetch } = makeBroker();
    await refreshTokens.save("retained-refresh-token");

    await expect(broker.restore()).resolves.toMatchObject({
      state: "signed_in",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(broker.getRendererStatus())).not.toContain("token");
    await expect(broker.getAccessTokenForTrustedProxy()).resolves.toBe(
      "access-token-that-must-stay-in-main",
    );
  });

  it("consumes a state-bearing provider error into a signed-out state", async () => {
    const { broker, browser } = makeBroker();
    await broker.beginSignIn();
    const authorizationUrl = new URL(
      vi.mocked(browser.open).mock.calls[0]?.[0].href ?? "",
    );
    const callback = new URL("research-video-clips://oauth/callback");
    callback.searchParams.set("error", "access_denied");
    callback.searchParams.set(
      "state",
      authorizationUrl.searchParams.get("state") ?? "",
    );

    expect(broker.acceptNativeCallback(callback.href)).toEqual({
      accepted: true,
    });
    await broker.drainNativeCallbacks();

    expect(broker.getRendererStatus()).toEqual({ state: "signed_out" });
  });

  it("revokes remotely and clears protected persistence on sign-out", async () => {
    const { broker, browser, fetch, file } = makeBroker();
    await broker.beginSignIn();
    const authorizationUrl = new URL(
      vi.mocked(browser.open).mock.calls[0]?.[0].href ?? "",
    );
    const callback = new URL("research-video-clips://oauth/callback");
    callback.searchParams.set("code", "one-time-code");
    callback.searchParams.set(
      "state",
      authorizationUrl.searchParams.get("state") ?? "",
    );
    broker.acceptNativeCallback(callback.href);
    await broker.drainNativeCallbacks();

    await expect(broker.signOut()).resolves.toEqual({ state: "signed_out" });
    expect(file.remove).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(browser.open).toHaveBeenCalledTimes(2);
  });
});
