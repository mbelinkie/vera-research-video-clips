import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  AuthenticationError,
  AuthorizationError,
  CognitoOAuthClient,
  OAuthProtocolError,
  createCognitoAccessTokenVerifier,
  createCognitoSessionProvider,
  requirePermission,
  requireProjectRoleAssignment,
  type ProjectPermission,
  type CognitoAccessTokenVerifier,
  type OAuthCrypto,
} from "./index.ts";

const issuer = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Example";
const clientId = "public-client-id";
const subject = "b5602ca3-98b9-4e82-bd22-e896fe7cab40";

describe("project authorization", () => {
  it("enforces the complete closed permission matrix", () => {
    const permissions: ProjectPermission[] = [
      "read",
      "write",
      "manage_members",
      "manage_researchers",
      "manage_administrators",
      "manage_project",
    ];
    const allowed = {
      owner: permissions,
      administrator: ["read", "write", "manage_researchers", "manage_project"],
      researcher: ["read", "write"],
      editor: ["read", "write"],
      viewer: ["read"],
    } satisfies Record<string, ProjectPermission[]>;

    for (const [role, rolePermissions] of Object.entries(allowed)) {
      for (const permission of permissions) {
        const assertion = expect(() =>
          requirePermission(role as keyof typeof allowed, permission),
        );
        if ((rolePermissions as ProjectPermission[]).includes(permission))
          assertion.not.toThrow();
        else assertion.toThrow(AuthorizationError);
      }
    }
  });

  it("denies users without membership", () => {
    expect(() => requirePermission(undefined, "read")).toThrow(
      AuthorizationError,
    );
  });

  it("allows only the exact target-role assignment matrix", () => {
    const expectations = {
      owner: { administrator: true, researcher: true },
      administrator: { administrator: false, researcher: true },
      researcher: { administrator: false, researcher: false },
      editor: { administrator: false, researcher: false },
      viewer: { administrator: false, researcher: false },
    } as const;
    for (const [actorRole, targets] of Object.entries(expectations)) {
      for (const [targetRole, permitted] of Object.entries(targets)) {
        const assertion = expect(() =>
          requireProjectRoleAssignment(
            actorRole as keyof typeof expectations,
            targetRole as "administrator" | "researcher",
          ),
        );
        if (permitted) assertion.not.toThrow();
        else assertion.toThrow(AuthorizationError);
      }
    }
    for (const targetRole of ["administrator", "researcher"] as const) {
      expect(() => requireProjectRoleAssignment(undefined, targetRole)).toThrow(
        AuthorizationError,
      );
    }
  });
});

describe("Cognito access-token boundary", () => {
  const configuration = {
    userPoolId: "us-east-1_Example",
    clientId,
    issuer,
  };

  function providerFor(
    claims: Partial<{
      client_id: string;
      exp: number;
      iss: string;
      sub: string;
      token_use: "access";
    }> = {},
  ) {
    const verifier: CognitoAccessTokenVerifier = {
      verify: vi.fn().mockResolvedValue({
        client_id: clientId,
        exp: 2_000_000_000,
        iss: issuer,
        sub: subject,
        token_use: "access",
        ...claims,
      }),
    };
    return {
      provider: createCognitoSessionProvider({
        configuration,
        verifier,
        getAuthorizationHeader: (request: { authorization?: string }) =>
          request.authorization,
        now: () => 1_000_000_000_000,
      }),
      verifier,
    };
  }

  it("derives the actor only from a verified Cognito UUID subject", async () => {
    const { provider, verifier } = providerFor();
    await expect(
      provider.authenticate({ authorization: "Bearer a.b.c" }),
    ).resolves.toEqual({
      userId: subject,
      externalSubject: `cognito:${issuer}:${subject}`,
    });
    expect(verifier.verify).toHaveBeenCalledWith("a.b.c");
  });

  it.each([
    ["wrong issuer", { iss: "https://unexpected.example" }],
    ["wrong client", { client_id: "other-client" }],
    ["ID token", { token_use: "id" as never }],
    ["expired", { exp: 999_999_999 }],
    ["non-UUID subject", { sub: "not-a-uuid" }],
  ])("rejects %s without exposing token details", async (_name, claims) => {
    const { provider } = providerFor(claims);
    await expect(
      provider.authenticate({ authorization: "Bearer a.b.c" }),
    ).rejects.toMatchObject({
      code: "authentication_required",
      message: "Invalid authentication credentials.",
    });
  });

  it("rejects malformed bearer values before verification", async () => {
    const { provider, verifier } = providerFor();
    await expect(
      provider.authenticate({ authorization: "Bearer user|subject" }),
    ).rejects.toBeInstanceOf(AuthenticationError);
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it("fails closed when issuer and user-pool configuration disagree", () => {
    expect(() =>
      createCognitoAccessTokenVerifier({
        ...configuration,
        issuer: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Other",
      }),
    ).toThrow("Cognito issuer does not match");
  });
});

describe("Cognito public-client OAuth", () => {
  const clock = vi.fn(() => 1_000);
  const crypto: OAuthCrypto = {
    randomBytes: vi.fn((length: number) =>
      Uint8Array.from({ length }, (_value, index) => index),
    ),
    sha256: vi.fn(
      async (input: string) =>
        new Uint8Array(createHash("sha256").update(input).digest()),
    ),
  };

  function client(fetch = vi.fn()) {
    return new CognitoOAuthClient(
      {
        authority: "https://research.auth.us-east-1.amazoncognito.com",
        clientId,
        callbackUri: "research-video-clips://oauth/callback",
        logoutUri: "research-video-clips://oauth/logout",
        scopes: ["openid", "profile"],
      },
      { fetch, crypto, now: clock },
    );
  }

  it("creates a high-entropy S256 PKCE authorization URL with the exact callback", async () => {
    const attempt = await client().createAuthorizationAttempt();
    const url = attempt.authorizationUrl;
    const verifier = Buffer.from(
      Uint8Array.from({ length: 64 }, (_value, index) => index),
    ).toString("base64url");
    const expectedChallenge = createHash("sha256")
      .update(verifier)
      .digest("base64url");

    expect(url.origin + url.pathname).toBe(
      "https://research.auth.us-east-1.amazoncognito.com/oauth2/authorize",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(
      "research-video-clips://oauth/callback",
    );
    expect(url.searchParams.get("scope")).toBe("openid profile");
    expect(url.searchParams.get("code_challenge")).toBe(expectedChallenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toHaveLength(43);
  });

  it("uses a form-only, secret-free authorization-code exchange and consumes callbacks", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access-token",
          expires_in: 3_600,
          id_token: "id-token",
          refresh_token: "refresh-token",
          token_type: "Bearer",
        }),
        { status: 200 },
      ),
    );
    const attempt = await client(fetch).createAuthorizationAttempt();
    const callback = new URL("research-video-clips://oauth/callback");
    callback.searchParams.set("code", "authorization-code");
    callback.searchParams.set(
      "state",
      attempt.authorizationUrl.searchParams.get("state") as string,
    );

    await expect(attempt.exchange(callback)).resolves.toMatchObject({
      accessToken: "access-token",
      refreshToken: "refresh-token",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetch.mock.calls[0] as [URL, RequestInit];
    expect(endpoint.href).toBe(
      "https://research.auth.us-east-1.amazoncognito.com/oauth2/token",
    );
    expect(init.headers).toEqual({
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    });
    const form = new URLSearchParams(init.body as string);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("client_id")).toBe(clientId);
    expect(form.get("code")).toBe("authorization-code");
    expect(form.get("redirect_uri")).toBe(
      "research-video-clips://oauth/callback",
    );
    await expect(attempt.exchange(callback)).rejects.toBeInstanceOf(
      OAuthProtocolError,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a mismatched state, target, expired, or replayed callback without exchanging its code", async () => {
    const fetch = vi.fn();
    const oauth = client(fetch);
    const attempt = await oauth.createAuthorizationAttempt();
    const wrongTarget = new URL("research-video-clips://other/callback");
    wrongTarget.searchParams.set(
      "state",
      attempt.authorizationUrl.searchParams.get("state") as string,
    );
    wrongTarget.searchParams.set("code", "code");

    await expect(attempt.exchange(wrongTarget)).rejects.toBeInstanceOf(
      OAuthProtocolError,
    );
    await expect(attempt.exchange(wrongTarget)).rejects.toBeInstanceOf(
      OAuthProtocolError,
    );
    expect(fetch).not.toHaveBeenCalled();

    const wrongStateAttempt = await oauth.createAuthorizationAttempt();
    const wrongState = new URL("research-video-clips://oauth/callback");
    wrongState.searchParams.set("state", "not-the-generated-state");
    wrongState.searchParams.set("code", "code");
    await expect(wrongStateAttempt.exchange(wrongState)).rejects.toBeInstanceOf(
      OAuthProtocolError,
    );

    clock.mockReturnValue(1_000 + 5 * 60 * 1_000);
    const expired = await oauth.createAuthorizationAttempt();
    clock.mockReturnValue(1_000 + 10 * 60 * 1_000);
    const expiredCallback = new URL("research-video-clips://oauth/callback");
    expiredCallback.searchParams.set(
      "state",
      expired.authorizationUrl.searchParams.get("state") as string,
    );
    expiredCallback.searchParams.set("code", "code");
    await expect(expired.exchange(expiredCallback)).rejects.toBeInstanceOf(
      OAuthProtocolError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retains a refresh token unless Cognito rotates it, and revokes with a form body", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "renewed-access",
            expires_in: 3_600,
            token_type: "Bearer",
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "rotated-access",
            expires_in: 3_600,
            refresh_token: "rotated-refresh",
            token_type: "Bearer",
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const oauth = client(fetch);

    await expect(oauth.refresh("current-refresh")).resolves.toMatchObject({
      refreshToken: "current-refresh",
    });
    await expect(oauth.refresh("current-refresh")).resolves.toMatchObject({
      refreshToken: "rotated-refresh",
    });
    await expect(oauth.revoke("rotated-refresh")).resolves.toBeUndefined();
    const [revokeEndpoint, revokeInit] = fetch.mock.calls[2] as [
      URL,
      RequestInit,
    ];
    expect(revokeEndpoint.pathname).toBe("/oauth2/revoke");
    const revokeForm = new URLSearchParams(revokeInit.body as string);
    expect(revokeForm.get("client_id")).toBe(clientId);
    expect(revokeForm.get("token")).toBe("rotated-refresh");
  });

  it("returns the registered logout URL and bounds remote failures", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("sensitive provider error", { status: 400 }),
      );
    const oauth = client(fetch);
    expect(oauth.createLogoutUrl().href).toBe(
      `https://research.auth.us-east-1.amazoncognito.com/logout?client_id=${clientId}&logout_uri=research-video-clips%3A%2F%2Foauth%2Flogout`,
    );
    await expect(oauth.refresh("current-refresh")).rejects.toMatchObject({
      message: "Authentication could not be completed. Please try again.",
    });
  });

  it("requires custom-scheme callback and logout URIs", () => {
    expect(
      () =>
        new CognitoOAuthClient({
          authority: "https://research.auth.us-east-1.amazoncognito.com",
          clientId,
          callbackUri: "https://example.test/callback",
          logoutUri: "research-video-clips://oauth/logout",
        }),
    ).toThrow("custom-scheme");
  });
});
