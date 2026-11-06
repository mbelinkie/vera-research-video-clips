import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { JwksCache } from "aws-jwt-verify/jwk";

export type VerifiedTokens = Readonly<{
  subject: string;
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
}>;
export interface IdentityProvider {
  authorizeUrl(input: {
    state: string;
    nonce: string;
    challenge: string;
  }): string;
  logoutUrl(): string;
  exchange(
    code: string,
    verifier: string,
    nonce: string,
  ): Promise<VerifiedTokens>;
  refresh(
    refreshToken: string,
    expectedSubject: string,
  ): Promise<VerifiedTokens>;
  revoke(refreshToken: string): Promise<void>;
}
export type CognitoOptions = Readonly<{
  issuer: string;
  domain: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  logoutUrl: string;
}>;
type CognitoTokenResponse = {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
};

/** The sole production construction path creates pinned Cognito JWKS verifiers. */
export function createCognitoProvider(
  options: CognitoOptions,
  /** Private fixture seams; main.ts never supplies these. */
  testDependencies?: { jwksCache?: JwksCache; fetcher?: typeof fetch },
): IdentityProvider {
  const userPoolId = new URL(options.issuer).pathname.slice(1);
  const accessVerifier = CognitoJwtVerifier.create(
    { userPoolId, tokenUse: "access", clientId: options.clientId },
    testDependencies?.jwksCache
      ? { jwksCache: testDependencies.jwksCache }
      : undefined,
  );
  const idVerifier = CognitoJwtVerifier.create(
    { userPoolId, tokenUse: "id", clientId: options.clientId },
    testDependencies?.jwksCache
      ? { jwksCache: testDependencies.jwksCache }
      : undefined,
  );
  const basic = `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64")}`;
  const request = async (
    endpoint: "/oauth2/token" | "/oauth2/revoke",
    params: URLSearchParams,
  ) => {
    const response = await (testDependencies?.fetcher ?? fetch)(
      `${options.domain}${endpoint}`,
      {
        method: "POST",
        headers: {
          authorization: basic,
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: params,
        signal: AbortSignal.timeout(8_000),
        redirect: "error",
      },
    );
    if (!response.ok) throw new Error("Identity provider request failed");
    if (endpoint === "/oauth2/revoke") return undefined;
    const json: unknown = await response.json();
    if (!json || typeof json !== "object")
      throw new Error("Invalid identity provider response");
    return json as CognitoTokenResponse;
  };
  const validate = async (
    tokens: CognitoTokenResponse,
    previousRefresh?: string,
    nonce?: string,
  ): Promise<VerifiedTokens> => {
    if (
      tokens.token_type !== "Bearer" ||
      !tokens.access_token ||
      !Number.isFinite(tokens.expires_in) ||
      tokens.expires_in < 1 ||
      tokens.expires_in > 86_400
    ) {
      throw new Error("Invalid identity provider response");
    }
    if (!tokens.refresh_token && !previousRefresh)
      throw new Error("Missing refresh authorization");
    const access = await accessVerifier.verify(tokens.access_token);
    if (access.iss !== options.issuer || !access.sub)
      throw new Error("Invalid identity provider issuer");
    if (nonce && !tokens.id_token) throw new Error("Missing identity token");
    if (tokens.id_token) {
      const id = await idVerifier.verify(tokens.id_token);
      if (
        id.iss !== options.issuer ||
        id.sub !== access.sub ||
        (nonce && id.nonce !== nonce)
      ) {
        throw new Error("Invalid identity token");
      }
    }
    return {
      subject: `cognito:${options.issuer}#${access.sub}`,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? previousRefresh!,
      expiresAtMs: Math.min(
        access.exp * 1000,
        Date.now() + tokens.expires_in * 1000,
      ),
    };
  };
  return {
    authorizeUrl({ state, nonce, challenge }) {
      const url = new URL(`${options.domain}/oauth2/authorize`);
      url.search = new URLSearchParams({
        client_id: options.clientId,
        response_type: "code",
        redirect_uri: options.callbackUrl,
        scope: "openid",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
        nonce,
      }).toString();
      return url.toString();
    },
    logoutUrl() {
      const url = new URL(`${options.domain}/logout`);
      url.search = new URLSearchParams({
        client_id: options.clientId,
        logout_uri: options.logoutUrl,
      }).toString();
      return url.toString();
    },
    async exchange(code, verifier, nonce) {
      const result = await request(
        "/oauth2/token",
        new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          redirect_uri: options.callbackUrl,
        }),
      );
      return validate(result!, undefined, nonce);
    },
    async refresh(refreshToken, expectedSubject) {
      const result = await request(
        "/oauth2/token",
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      );
      const verified = await validate(result!, refreshToken);
      if (verified.subject !== expectedSubject)
        throw new Error("Refreshed identity changed");
      return verified;
    },
    async revoke(refreshToken) {
      await request(
        "/oauth2/revoke",
        new URLSearchParams({ token: refreshToken }),
      );
    },
  };
}
