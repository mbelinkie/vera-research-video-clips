import { CognitoJwtVerifier } from "aws-jwt-verify";

import type {
  AuthenticatedActor,
  ProjectRole,
} from "@research-video/contracts";

export type ProjectPermission = "read" | "write" | "manage_members";

export interface SessionProvider<Request = unknown> {
  authenticate(request: Request): Promise<AuthenticatedActor>;
}

export class AuthenticationError extends Error {
  readonly statusCode = 401;
  readonly code = "authentication_required";
}

export class AuthorizationError extends Error {
  readonly statusCode = 403;
  readonly code = "project_access_denied";
}

const permissions: Record<ProjectRole, ReadonlySet<ProjectPermission>> = {
  owner: new Set(["read", "write", "manage_members"]),
  editor: new Set(["read", "write"]),
  researcher: new Set(["read", "write"]),
  viewer: new Set(["read"]),
};

export function requirePermission(
  role: ProjectRole | undefined,
  permission: ProjectPermission,
): asserts role is ProjectRole {
  if (!role || !permissions[role].has(permission)) {
    throw new AuthorizationError("You do not have access to this project.");
  }
}

/** The claims this package needs from a verified Cognito access token. */
export interface CognitoAccessTokenClaims {
  client_id: string;
  exp: number;
  iss: string;
  sub: string;
  token_use: "access";
}

/**
 * A narrow seam around AWS' verifier. Production uses
 * {@link createCognitoAccessTokenVerifier}; tests can inject a deterministic
 * verifier without weakening the production implementation.
 */
export interface CognitoAccessTokenVerifier {
  verify(token: string): Promise<CognitoAccessTokenClaims>;
}

export interface CognitoAccessTokenVerifierConfiguration {
  /** Cognito pool ID, for example `us-east-1_Example`. */
  userPoolId: string;
  /** The public OAuth app-client ID expected in access-token `client_id`. */
  clientId: string;
  /** The exact issuer derived from the configured Cognito user pool. */
  issuer: string;
}

/**
 * Creates a production Cognito verifier. `aws-jwt-verify` derives the issuer
 * and JWKS URI from the pool ID and verifies the signature, expiry, issuer,
 * token use, and client ID before returning claims.
 */
export function createCognitoAccessTokenVerifier(
  configuration: CognitoAccessTokenVerifierConfiguration,
): CognitoAccessTokenVerifier {
  const expectedIssuer = CognitoJwtVerifier.parseUserPoolId(
    configuration.userPoolId,
  ).issuer;
  if (configuration.issuer !== expectedIssuer) {
    throw new RangeError(
      "Cognito issuer does not match the configured user pool.",
    );
  }

  const verifier = CognitoJwtVerifier.create({
    userPoolId: configuration.userPoolId,
    clientId: configuration.clientId,
    tokenUse: "access",
  });

  return {
    verify: async (token) => verifier.verify(token),
  };
}

export interface CognitoSessionProviderOptions<Request> {
  configuration: CognitoAccessTokenVerifierConfiguration;
  /** Optional only to support deterministic tests and alternate trusted hosts. */
  verifier?: CognitoAccessTokenVerifier;
  getAuthorizationHeader(request: Request): string | undefined;
  now?: () => number;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Derives the catalog actor solely from a verified Cognito subject. It never
 * reads a user ID or external subject supplied by the client request.
 */
export function createCognitoSessionProvider<Request>(
  options: CognitoSessionProviderOptions<Request>,
): SessionProvider<Request> {
  const verifier =
    options.verifier ?? createCognitoAccessTokenVerifier(options.configuration);
  const now = options.now ?? Date.now;

  return {
    async authenticate(request) {
      const token = parseBearerToken(options.getAuthorizationHeader(request));
      let claims: CognitoAccessTokenClaims;
      try {
        claims = await verifier.verify(token);
      } catch {
        throw invalidCredentials();
      }

      if (
        claims.iss !== options.configuration.issuer ||
        claims.client_id !== options.configuration.clientId ||
        claims.token_use !== "access" ||
        !Number.isFinite(claims.exp) ||
        claims.exp * 1_000 <= now() ||
        !isUuid(claims.sub)
      ) {
        throw invalidCredentials();
      }

      return {
        userId: claims.sub,
        externalSubject: `cognito:${claims.iss}:${claims.sub}`,
      };
    },
  };
}

function parseBearerToken(authorization: string | undefined): string {
  const match =
    /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(
      authorization ?? "",
    );
  if (!match?.[1]) {
    throw invalidCredentials();
  }
  return match[1];
}

function invalidCredentials(): AuthenticationError {
  return new AuthenticationError("Invalid authentication credentials.");
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export class OAuthProtocolError extends Error {
  readonly code = "oauth_protocol_error";

  constructor() {
    super("Authentication could not be completed. Please try again.");
  }
}

export interface FetchLike {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

export interface OAuthCrypto {
  randomBytes(length: number): Uint8Array;
  sha256(input: string): Promise<Uint8Array>;
}

export interface CognitoOAuthClientConfiguration {
  /** Cognito managed-login origin, for example `https://example.auth.us-east-1.amazoncognito.com`. */
  authority: string;
  clientId: string;
  /** A single, registered native-app custom-scheme callback URI. */
  callbackUri: string;
  /** A single, registered native-app custom-scheme sign-out URI. */
  logoutUri: string;
  /** Defaults to `openid profile`. Include only scopes registered for this app client. */
  scopes?: readonly string[];
}

export interface CognitoOAuthClientDependencies {
  fetch?: FetchLike;
  crypto?: OAuthCrypto;
  now?: () => number;
}

export interface CognitoTokenSet {
  accessToken: string;
  expiresIn: number;
  idToken?: string;
  refreshToken: string;
  tokenType: "Bearer";
}

const ATTEMPT_LIFETIME_MS = 5 * 60 * 1_000;
const STATE_BYTES = 32;
const VERIFIER_BYTES = 64;

/**
 * A one-shot authorization request. It deliberately contains no storage or
 * browser-launch behavior; M7-02 owns persistence and native shell plumbing.
 */
export class CognitoAuthorizationAttempt {
  readonly authorizationUrl: URL;
  readonly createdAt: number;
  private consumed = false;

  constructor(
    private readonly client: CognitoOAuthClient,
    private readonly state: string,
    private readonly verifier: string,
    createdAt: number,
    authorizationUrl: URL,
  ) {
    this.createdAt = createdAt;
    this.authorizationUrl = authorizationUrl;
  }

  /** Validates and consumes a callback before its code can be exchanged. */
  async exchange(callback: string | URL): Promise<CognitoTokenSet> {
    if (this.consumed) {
      throw new OAuthProtocolError();
    }
    this.consumed = true;

    const code = this.claimCallback(callback);
    return this.client.exchangeAuthorizationCode(code, this.verifier);
  }

  private claimCallback(callback: string | URL): string {
    if (this.client.now() - this.createdAt >= ATTEMPT_LIFETIME_MS) {
      throw new OAuthProtocolError();
    }

    let parsed: URL;
    try {
      parsed = new URL(callback);
    } catch {
      throw new OAuthProtocolError();
    }
    if (!sameCallbackTarget(parsed, this.client.callbackUri)) {
      throw new OAuthProtocolError();
    }

    const state = oneQueryValue(parsed, "state");
    const code = oneQueryValue(parsed, "code");
    if (!state || !code || state !== this.state || code.length > 4_096) {
      throw new OAuthProtocolError();
    }
    return code;
  }
}

/** Public-client Cognito OAuth protocol implementation with S256 PKCE. */
export class CognitoOAuthClient {
  readonly callbackUri: URL;
  readonly logoutUri: URL;
  readonly now: () => number;
  private readonly authority: URL;
  private readonly clientId: string;
  private readonly scopes: readonly string[];
  private readonly fetch: FetchLike;
  private readonly crypto: OAuthCrypto;

  constructor(
    configuration: CognitoOAuthClientConfiguration,
    dependencies: CognitoOAuthClientDependencies = {},
  ) {
    this.authority = parseAuthority(configuration.authority);
    this.callbackUri = parseCustomSchemeUri(configuration.callbackUri);
    this.logoutUri = parseCustomSchemeUri(configuration.logoutUri);
    this.clientId = requireNonEmpty(configuration.clientId);
    this.scopes = configuration.scopes ?? ["openid", "profile"];
    if (
      this.scopes.length === 0 ||
      this.scopes.some((scope) => !isScope(scope))
    ) {
      throw new RangeError(
        "OAuth scopes must be non-empty registered scope names.",
      );
    }
    this.fetch = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
    this.crypto = dependencies.crypto ?? defaultOAuthCrypto();
    this.now = dependencies.now ?? Date.now;
  }

  async createAuthorizationAttempt(): Promise<CognitoAuthorizationAttempt> {
    let state: string;
    let verifier: string;
    let challenge: string;
    try {
      const stateBytes = this.crypto.randomBytes(STATE_BYTES);
      const verifierBytes = this.crypto.randomBytes(VERIFIER_BYTES);
      if (
        stateBytes.byteLength !== STATE_BYTES ||
        verifierBytes.byteLength !== VERIFIER_BYTES
      ) {
        throw new OAuthProtocolError();
      }
      state = base64Url(stateBytes);
      verifier = base64Url(verifierBytes);
      challenge = base64Url(await this.crypto.sha256(verifier));
    } catch {
      throw new OAuthProtocolError();
    }
    if (state.length < 43 || verifier.length < 43 || verifier.length > 128) {
      throw new OAuthProtocolError();
    }
    const authorizationUrl = this.endpoint("/oauth2/authorize");
    authorizationUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: this.callbackUri.href,
      scope: this.scopes.join(" "),
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();

    return new CognitoAuthorizationAttempt(
      this,
      state,
      verifier,
      this.now(),
      authorizationUrl,
    );
  }

  async refresh(refreshToken: string): Promise<CognitoTokenSet> {
    const currentRefreshToken = requireToken(refreshToken);
    return this.requestTokens(
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.clientId,
        refresh_token: currentRefreshToken,
      }),
      currentRefreshToken,
    );
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.postForm(
      "/oauth2/revoke",
      new URLSearchParams({
        client_id: this.clientId,
        token: requireToken(refreshToken),
      }),
      false,
    );
  }

  /** The exact registered managed-login sign-out redirect. */
  createLogoutUrl(): URL {
    const url = this.endpoint("/logout");
    url.search = new URLSearchParams({
      client_id: this.clientId,
      logout_uri: this.logoutUri.href,
    }).toString();
    return url;
  }

  async exchangeAuthorizationCode(
    code: string,
    verifier: string,
  ): Promise<CognitoTokenSet> {
    return this.requestTokens(
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.clientId,
        code: requireToken(code),
        redirect_uri: this.callbackUri.href,
        code_verifier: verifier,
      }),
      undefined,
      true,
    );
  }

  private endpoint(pathname: string): URL {
    return new URL(pathname, this.authority);
  }

  private async requestTokens(
    form: URLSearchParams,
    previousRefreshToken: string | undefined,
    requireRefreshToken = false,
  ): Promise<CognitoTokenSet> {
    const response = await this.postForm("/oauth2/token", form, true);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new OAuthProtocolError();
    }
    return parseTokenSet(payload, previousRefreshToken, requireRefreshToken);
  }

  private async postForm(
    pathname: string,
    form: URLSearchParams,
    expectJson: boolean,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetch(this.endpoint(pathname), {
        method: "POST",
        headers: {
          Accept: expectJson ? "application/json" : "*/*",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      });
    } catch {
      throw new OAuthProtocolError();
    }
    if (!response.ok) {
      throw new OAuthProtocolError();
    }
    return response;
  }
}

function parseTokenSet(
  payload: unknown,
  previousRefreshToken: string | undefined,
  requireRefreshToken: boolean,
): CognitoTokenSet {
  if (!payload || typeof payload !== "object") {
    throw new OAuthProtocolError();
  }
  const candidate = payload as Record<string, unknown>;
  const refreshToken =
    readToken(candidate.refresh_token) ??
    (!requireRefreshToken ? previousRefreshToken : undefined);
  const accessToken = readToken(candidate.access_token);
  const expiresIn = candidate.expires_in;
  if (
    !refreshToken ||
    !accessToken ||
    candidate.token_type !== "Bearer" ||
    typeof expiresIn !== "number" ||
    !Number.isSafeInteger(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new OAuthProtocolError();
  }

  const idToken = readToken(candidate.id_token);
  return {
    accessToken,
    expiresIn,
    refreshToken,
    tokenType: "Bearer",
    ...(idToken ? { idToken } : {}),
  };
}

function parseAuthority(value: string): URL {
  let authority: URL;
  try {
    authority = new URL(value);
  } catch {
    throw new RangeError("Cognito authority must be an HTTPS origin.");
  }
  if (
    authority.protocol !== "https:" ||
    authority.username ||
    authority.password ||
    authority.pathname !== "/" ||
    authority.search ||
    authority.hash
  ) {
    throw new RangeError("Cognito authority must be an HTTPS origin.");
  }
  return authority;
}

function parseCustomSchemeUri(value: string): URL {
  let uri: URL;
  try {
    uri = new URL(value);
  } catch {
    throw new RangeError(
      "OAuth callback and logout URIs must be custom-scheme URIs.",
    );
  }
  if (
    uri.protocol === "http:" ||
    uri.protocol === "https:" ||
    !uri.hostname ||
    uri.username ||
    uri.password ||
    uri.search ||
    uri.hash
  ) {
    throw new RangeError(
      "OAuth callback and logout URIs must be custom-scheme URIs.",
    );
  }
  return uri;
}

function sameCallbackTarget(actual: URL, expected: URL): boolean {
  return (
    actual.protocol === expected.protocol &&
    actual.username === expected.username &&
    actual.password === expected.password &&
    actual.hostname === expected.hostname &&
    actual.port === expected.port &&
    actual.pathname === expected.pathname &&
    !actual.hash
  );
}

function oneQueryValue(url: URL, name: string): string | undefined {
  const values = url.searchParams.getAll(name);
  return values.length === 1 && values[0] ? values[0] : undefined;
}

function requireNonEmpty(value: string): string {
  if (!value.trim()) {
    throw new RangeError("OAuth client ID must not be empty.");
  }
  return value;
}

function requireToken(value: string): string {
  if (!readToken(value)) {
    throw new OAuthProtocolError();
  }
  return value;
}

function readToken(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 16_384
    ? value
    : undefined;
}

function isScope(value: string): boolean {
  return /^[A-Za-z0-9_./:-]+$/.test(value);
}

function base64Url(value: Uint8Array): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let output = "";
  for (let index = 0; index < value.length; index += 3) {
    const first = value[index] ?? 0;
    const second = value[index + 1];
    const third = value[index + 2];
    output += alphabet.charAt(first >> 2);
    output += alphabet.charAt(((first & 0b11) << 4) | ((second ?? 0) >> 4));
    if (second !== undefined) {
      output += alphabet.charAt(((second & 0b1111) << 2) | ((third ?? 0) >> 6));
    }
    if (third !== undefined) {
      output += alphabet.charAt(third & 0b111111);
    }
  }
  return output;
}

function defaultOAuthCrypto(): OAuthCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new OAuthProtocolError();
  }
  return {
    randomBytes(length) {
      return globalThis.crypto.getRandomValues(new Uint8Array(length));
    },
    async sha256(input) {
      return new Uint8Array(
        await globalThis.crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(input),
        ),
      );
    },
  };
}
