import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { SimpleJwksCache, type Jwk } from "aws-jwt-verify/jwk";
import { describe, expect, it } from "vitest";
import { createCognitoProvider } from "./provider.ts";

const issuer = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Test";
const options = {
  issuer,
  domain: "https://managed.example",
  clientId: "client-123",
  clientSecret: "fake-test-secret",
  callbackUrl: "https://research.example/cloud-api/auth/callback",
  logoutUrl: "https://research.example/",
};
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = {
  ...pair.publicKey.export({ format: "jwk" }),
  kid: "fixture-1",
  alg: "RS256",
  use: "sig",
} as Jwk;
const cache = () => {
  const instance = new SimpleJwksCache();
  instance.addJwks(`${issuer}/.well-known/jwks.json`, { keys: [key] });
  return instance;
};
function jwt(
  payload: Record<string, unknown>,
  privateKey: KeyObject = pair.privateKey,
  algorithm = "RS256",
) {
  const head = Buffer.from(
    JSON.stringify({ alg: algorithm, typ: "JWT", kid: "fixture-1" }),
  ).toString("base64url");
  const claims = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const content = `${head}.${claims}`;
  return `${content}.${sign("RSA-SHA256", Buffer.from(content), privateKey).toString("base64url")}`;
}
const now = Math.floor(Date.now() / 1000);
const base = {
  iss: issuer,
  sub: "d55c5734-2d6f-4dd8-9cce-0ef34b99aa41",
  iat: now - 10,
  exp: now + 600,
};
const access = (overrides: Record<string, unknown> = {}) =>
  jwt({
    ...base,
    token_use: "access",
    client_id: options.clientId,
    ...overrides,
  });
const id = (overrides: Record<string, unknown> = {}) =>
  jwt({
    ...base,
    token_use: "id",
    aud: options.clientId,
    nonce: "correct-nonce",
    ...overrides,
  });
const response = (payload: Record<string, unknown>) => async () =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const tokens = (overrides: Record<string, unknown> = {}) => ({
  token_type: "Bearer",
  access_token: access(),
  id_token: id(),
  refresh_token: "server-only-refresh",
  expires_in: 600,
  ...overrides,
});

describe("verified Cognito protocol", () => {
  it("pins exact auth and logout URLs with PKCE S256", () => {
    const provider = createCognitoProvider(options, {
      jwksCache: cache(),
      fetcher: response(tokens()),
    });
    const url = new URL(
      provider.authorizeUrl({
        state: "state",
        nonce: "nonce",
        challenge: "challenge",
      }),
    );
    expect(url.origin).toBe("https://managed.example");
    expect(url.pathname).toBe("/oauth2/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe(options.callbackUrl);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("response_type")).toBe("code");
    const logout = new URL(provider.logoutUrl());
    expect(logout.pathname).toBe("/logout");
    expect(logout.searchParams.get("logout_uri")).toBe(options.logoutUrl);
  });
  it("verifies both signed tokens, nonce, issuer, subject and client, without leaking provider tokens", async () => {
    const calls: string[] = [];
    const provider = createCognitoProvider(options, {
      jwksCache: cache(),
      fetcher: async (url, init) => {
        calls.push(String(url));
        expect(init?.body?.toString()).toContain(
          "code_verifier=secret-verifier",
        );
        expect((init?.headers as Record<string, string>).authorization).toMatch(
          /^Basic /u,
        );
        return response(tokens())();
      },
    });
    const verified = await provider.exchange(
      "fake-code",
      "secret-verifier",
      "correct-nonce",
    );
    expect(verified.subject).toBe(`cognito:${issuer}#${base.sub}`);
    expect(verified.refreshToken).toBe("server-only-refresh");
    expect(calls).toEqual(["https://managed.example/oauth2/token"]);
  });
  it.each([
    ["wrong nonce", { id_token: id({ nonce: "forged" }) }],
    ["wrong ID audience", { id_token: id({ aud: "other-client" }) }],
    [
      "wrong access client",
      { access_token: access({ client_id: "other-client" }) },
    ],
    ["wrong issuer", { access_token: access({ iss: "https://evil.example" }) }],
    ["wrong token use", { access_token: id() }],
    ["wrong identity subject", { id_token: id({ sub: "other-user" }) }],
    ["expired token", { access_token: access({ exp: now - 10 }) }],
    ["missing identity token", { id_token: undefined }],
    [
      "unsigned token",
      { access_token: "eyJhbGciOiJub25lIn0.eyJzdWIiOiJmb3JnZWQifQ." },
    ],
  ])("rejects %s", async (_name, malformed) => {
    const provider = createCognitoProvider(options, {
      jwksCache: cache(),
      fetcher: response(tokens(malformed)),
    });
    await expect(
      provider.exchange("code", "verifier", "correct-nonce"),
    ).rejects.toThrow();
  });
  it("rejects subject changes on refresh and accepts rotated refresh tokens", async () => {
    const changed = createCognitoProvider(options, {
      jwksCache: cache(),
      fetcher: response(
        tokens({
          access_token: access({ sub: "changed" }),
          id_token: undefined,
        }),
      ),
    });
    await expect(
      changed.refresh("old-refresh", `cognito:${issuer}#${base.sub}`),
    ).rejects.toThrow();
    const rotated = createCognitoProvider(options, {
      jwksCache: cache(),
      fetcher: response(
        tokens({ id_token: undefined, refresh_token: "rotated-refresh" }),
      ),
    });
    expect(
      (await rotated.refresh("old-refresh", `cognito:${issuer}#${base.sub}`))
        .refreshToken,
    ).toBe("rotated-refresh");
  });
});
