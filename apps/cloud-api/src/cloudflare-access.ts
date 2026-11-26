/**
 * Defense in depth for the friends-only Mac pilot (#53).
 *
 * Cloudflare Access sits in front of the tunnel and only admits invited
 * emails. Access signs every request it forwards with a short-lived JWT in
 * `Cf-Access-Jwt-Assertion`. Verifying that token here means a deleted or
 * misconfigured Access application fails closed at the laptop instead of
 * silently exposing the sign-in page to the whole internet. This does not
 * replace Cognito sessions or project membership; both still apply.
 */
import { JwtRsaVerifier } from "aws-jwt-verify";
import type { Jwks } from "aws-jwt-verify/jwk";
import type { FastifyRequest } from "fastify";

export const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";

export type AccessTokenVerifier = (token: string) => Promise<unknown>;

export function cloudflareAccessVerifier(options: {
  teamDomain: string;
  audience: string;
  /** Tests only: preload signing keys instead of fetching them. */
  jwks?: Jwks;
}): AccessTokenVerifier {
  const verifier = JwtRsaVerifier.create({
    issuer: options.teamDomain,
    audience: options.audience,
    jwksUri: `${options.teamDomain}/cdn-cgi/access/certs`,
  });
  if (options.jwks) verifier.cacheJwks(options.jwks);
  return (token) => verifier.verify(token);
}

const accessDenied = () =>
  Object.assign(new Error("Request not permitted."), {
    statusCode: 403,
    code: "access_denied",
  });

/**
 * Returns an onRequest hook that admits only requests carrying a valid,
 * unexpired Access token for this application's audience tag.
 */
export function createCloudflareAccessGuard(verify: AccessTokenVerifier) {
  return async (request: FastifyRequest): Promise<void> => {
    const header = request.headers[ACCESS_JWT_HEADER];
    if (
      typeof header !== "string" ||
      header.length === 0 ||
      header.length > 8_192
    )
      throw accessDenied();
    try {
      await verify(header);
    } catch {
      throw accessDenied();
    }
  };
}
