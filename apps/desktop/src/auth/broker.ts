import {
  CognitoOAuthClient,
  type CognitoAuthorizationAttempt,
  type CognitoTokenSet,
} from "@research-video/auth";
import { randomBytes } from "node:crypto";

import {
  NativeOAuthCallbackQueue,
  type NativeOAuthCallbackReceipt,
} from "./callback.ts";
import { EncryptedRefreshTokenStore } from "./refresh-token-store.ts";

const REFRESH_SKEW_MS = 60_000;

export type RendererAuthStatus =
  | { readonly state: "signed_out" }
  | { readonly state: "signing_in" }
  | { readonly state: "signed_in"; readonly expiresAt: number };

/** A narrow seam around shell.openExternal or an equivalent trusted opener. */
export interface OAuthBrowserLauncher {
  open(url: URL): Promise<void>;
}

export class DesktopAuthenticationError extends Error {
  readonly code = "desktop_authentication_failed";

  constructor() {
    super("Authentication could not be completed. Please sign in again.");
  }
}

/**
 * Main-process authentication owner. Its renderer-facing status intentionally
 * has no access token, ID token, refresh token, authorization code, or URL.
 */
export class DesktopAuthenticationBroker {
  private readonly callbackQueue: NativeOAuthCallbackQueue;
  private status: RendererAuthStatus = { state: "signed_out" };
  private activeAttempt: CognitoAuthorizationAttempt | undefined;
  private accessToken: string | undefined;
  private refreshToken: string | undefined;
  private offlineReviewCapability: string | undefined;
  private callbackDrain: Promise<void> | undefined;

  constructor(
    private readonly oauth: CognitoOAuthClient,
    private readonly refreshTokens: EncryptedRefreshTokenStore,
    private readonly browser: OAuthBrowserLauncher,
    private readonly now: () => number = Date.now,
    callbackQueue = new NativeOAuthCallbackQueue(),
  ) {
    this.callbackQueue = callbackQueue;
  }

  getRendererStatus(): RendererAuthStatus {
    return this.status;
  }

  /** Restores a protected refresh token, if available, without exposing it. */
  async restore(): Promise<RendererAuthStatus> {
    this.resetEphemeralSession();
    const refreshToken = await this.refreshTokens.load();
    if (!refreshToken) {
      this.status = { state: "signed_out" };
      return this.status;
    }
    try {
      const tokens = await this.oauth.refresh(refreshToken);
      await this.establishSession(tokens);
    } catch {
      await this.refreshTokens.clear();
      this.resetEphemeralSession();
      this.status = { state: "signed_out" };
    }
    return this.status;
  }

  /** Opens Cognito managed login. The authorization URL is never returned. */
  async beginSignIn(): Promise<RendererAuthStatus> {
    if (this.status.state === "signed_in") {
      return this.status;
    }
    if (this.activeAttempt) {
      return this.status;
    }
    this.resetEphemeralSession();
    this.status = { state: "signing_in" };
    try {
      const attempt = await this.oauth.createAuthorizationAttempt();
      // Set this before opening the browser: an OS callback can be delivered
      // immediately by a test double or a previously running browser.
      this.activeAttempt = attempt;
      await this.browser.open(attempt.authorizationUrl);
    } catch {
      this.resetEphemeralSession();
      this.status = { state: "signed_out" };
    }
    return this.status;
  }

  /** Called by native open-url/second-instance handlers; never by the renderer. */
  acceptNativeCallback(input: string): NativeOAuthCallbackReceipt {
    const receipt = this.callbackQueue.accept(input);
    if (receipt.accepted) {
      void this.drainNativeCallbacks();
    }
    return receipt;
  }

  /** Allows lifecycle code/tests to wait until all callbacks observed so far settle. */
  async drainNativeCallbacks(): Promise<void> {
    if (this.callbackDrain) {
      return this.callbackDrain;
    }
    const drain = this.processQueuedCallbacks();
    this.callbackDrain = drain;
    try {
      await drain;
    } finally {
      if (this.callbackDrain === drain) {
        this.callbackDrain = undefined;
      }
    }
  }

  /**
   * Returns an access token only to another trusted main-process adapter (for
   * example, the authenticated loopback cloud proxy). It is not an IPC API.
   */
  async getAccessTokenForTrustedProxy(): Promise<string> {
    if (!this.accessToken || !this.refreshToken) {
      throw new DesktopAuthenticationError();
    }
    const expiresAt =
      this.status.state === "signed_in" ? this.status.expiresAt : 0;
    if (expiresAt - this.now() <= REFRESH_SKEW_MS) {
      try {
        const tokens = await this.oauth.refresh(this.refreshToken);
        await this.establishSession(tokens);
      } catch {
        await this.refreshTokens.clear();
        this.resetEphemeralSession();
        this.status = { state: "signed_out" };
        throw new DesktopAuthenticationError();
      }
    }
    if (!this.accessToken) {
      throw new DesktopAuthenticationError();
    }
    return this.accessToken;
  }

  /**
   * Returns a volatile capability only to trusted Electron main-process code.
   * It is neither a user identity nor a credential and is never IPC-exposed.
   */
  getOfflineReviewCapability(): string {
    if (this.status.state !== "signed_in" || !this.offlineReviewCapability) {
      throw new DesktopAuthenticationError();
    }
    return this.offlineReviewCapability;
  }

  /** Clears protected/local sessions before best-effort remote revoke/logout. */
  async signOut(): Promise<RendererAuthStatus> {
    const refreshToken = this.refreshToken;
    this.resetEphemeralSession();
    this.status = { state: "signed_out" };
    await this.refreshTokens.clear();
    if (refreshToken) {
      await this.oauth.revoke(refreshToken).catch(() => undefined);
    }
    await this.browser
      .open(this.oauth.createLogoutUrl())
      .catch(() => undefined);
    return this.status;
  }

  private async processQueuedCallbacks(): Promise<void> {
    while (true) {
      const callbacks = this.callbackQueue.takeAll();
      if (callbacks.length === 0) {
        return;
      }
      for (const callback of callbacks) {
        const attempt = this.activeAttempt;
        if (!attempt) {
          continue;
        }
        // An authorization attempt is one-shot even if persistence fails.
        this.activeAttempt = undefined;
        try {
          const tokens = await attempt.exchange(callback.url);
          await this.establishSession(tokens);
        } catch {
          await this.refreshTokens.clear();
          this.resetEphemeralSession();
          this.status = { state: "signed_out" };
        }
      }
    }
  }

  private async establishSession(tokens: CognitoTokenSet): Promise<void> {
    // Persist the refresh credential first. If Keychain storage fails, discard
    // all tokens rather than creating a non-restorable plaintext session.
    await this.refreshTokens.save(tokens.refreshToken);
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
    this.offlineReviewCapability ??= randomBytes(32).toString("base64url");
    this.status = {
      state: "signed_in",
      expiresAt: this.now() + tokens.expiresIn * 1_000,
    };
  }

  private resetEphemeralSession(): void {
    this.activeAttempt = undefined;
    this.accessToken = undefined;
    this.refreshToken = undefined;
    this.offlineReviewCapability = undefined;
  }
}
