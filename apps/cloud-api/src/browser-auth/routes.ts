import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthenticationError } from "@research-video/auth";
import type { SharedProjectCatalog } from "@research-video/catalog";
import type { AuthenticatedActor, User } from "@research-video/contracts";
import { z } from "zod";
import {
  beginLogin,
  digestSecret,
  matchesCallback,
  matchesExactOrigin,
  MemoryLoginAttemptStore,
  type LoginAttemptStore,
} from "./flow.ts";
import {
  LOGIN_COOKIE,
  SESSION_COOKIE,
  MemorySessionStore,
  clearCookie,
  cookieHeader,
  readCookie,
} from "./sessions.ts";
import type { IdentityProvider } from "./provider.ts";

export interface BrowserAuth {
  routes(app: FastifyInstance): void;
  onRequest(request: FastifyRequest): Promise<void>;
  authenticate(request: FastifyRequest): Promise<AuthenticatedActor>;
  register(request: FastifyRequest, displayName: string): Promise<User>;
}
export type BrowserAuthOptions = {
  publicOrigin: string;
  trustedProxyPeers: readonly string[];
  provider: IdentityProvider;
  catalog: SharedProjectCatalog;
  now?: () => number;
  attempts?: LoginAttemptStore;
  sessions?: MemorySessionStore;
  sessionIdleMs?: number;
  sessionAbsoluteMs?: number;
};
const AuthRejected = () => new AuthenticationError("Sign in to continue.");
const forbidden = () =>
  Object.assign(new Error("Request not permitted."), {
    statusCode: 403,
    code: "forbidden",
  });
const invalidCallback = () =>
  Object.assign(
    new Error("Sign-in could not be completed. Please try again."),
    { statusCode: 400, code: "invalid_callback" },
  );
export function createBrowserAuth(options: BrowserAuthOptions): BrowserAuth {
  const allowedHost = new URL(options.publicOrigin).host;
  const now = options.now ?? Date.now;
  const attempts = options.attempts ?? new MemoryLoginAttemptStore(now);
  const sessions =
    options.sessions ??
    new MemorySessionStore(
      options.provider,
      now,
      options.sessionIdleMs,
      options.sessionAbsoluteMs,
    );
  const cookieId = (request: FastifyRequest) =>
    readCookie(request.headers.cookie, SESSION_COOKIE);
  const resolveSession = async (request: FastifyRequest) => {
    const session = await sessions.get(cookieId(request));
    if (!session) throw AuthRejected();
    return session;
  };
  return {
    async onRequest(request) {
      // Never downgrade to bearer credentials in friend-facing browser mode.
      if (request.headers.authorization !== undefined) throw AuthRejected();
      // A TLS proxy must preserve the exact public Host. Forwarded headers
      // never override this allowlist or determine OAuth redirect targets.
      if (request.headers.host !== allowedHost) throw forbidden();
      // Internal transcription workers and direct transcript publication have
      // a separate trust boundary. A browser login is never worker authority.
      if (
        request.url.startsWith("/api/transcription-jobs/") ||
        request.url.startsWith("/api/transcripts/finalize") ||
        /^\/api\/projects\/[^/]+\/videos\/[^/]+\/transcript-uploads(?:\/|\?|$)/u.test(
          request.url,
        ) ||
        request.url.startsWith("/local-agent/")
      ) {
        throw Object.assign(new Error("Not found."), {
          statusCode: 404,
          code: "not_found",
        });
      }
      const forwarded = [
        "x-forwarded-for",
        "x-forwarded-host",
        "x-forwarded-proto",
        "forwarded",
      ];
      if (
        forwarded.some((header) => request.headers[header] !== undefined) &&
        !options.trustedProxyPeers.includes(request.ip)
      )
        throw forbidden();
      if (request.url.startsWith("/api/") || request.url === "/auth/logout") {
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
          if (
            typeof request.headers.origin !== "string" ||
            !matchesExactOrigin(request.headers.origin, options.publicOrigin)
          )
            throw forbidden();
          const session = await resolveSession(request);
          if (!sessions.verifyCsrf(session, request.headers["x-vera-csrf"]))
            throw forbidden();
        }
      }
    },
    async authenticate(request) {
      const session = await resolveSession(request);
      const user = await options.catalog.findUserByVerifiedSubject(
        session.subject,
      );
      if (!user) throw AuthRejected();
      return { userId: user.id, externalSubject: user.externalSubject };
    },
    async register(request, displayName) {
      const session = await resolveSession(request);
      return options.catalog.registerVerifiedSubject(
        session.subject,
        displayName,
      );
    },
    routes(app) {
      app.addHook("onRequest", (request) => this.onRequest(request));
      app.addHook("onSend", async (request, reply, payload) => {
        if (
          request.url.startsWith("/api/") ||
          request.url.startsWith("/auth/")
        ) {
          reply.header("cache-control", "no-store");
          reply.header("referrer-policy", "no-referrer");
          reply.header("x-content-type-options", "nosniff");
        }
        return payload;
      });
      app.get("/auth/login", async (request, reply) => {
        const query = z
          .object({ returnTo: z.string().optional() })
          .passthrough()
          .parse(request.query);
        const login = beginLogin(now(), query.returnTo);
        await attempts.put(login.pending);
        reply.header(
          "set-cookie",
          cookieHeader(LOGIN_COOKIE, login.browserBinding, 300),
        );
        return reply.code(303).redirect(
          options.provider.authorizeUrl({
            state: login.state,
            nonce: login.pending.nonce,
            challenge: login.challenge,
          }),
        );
      });
      app.get("/auth/callback", async (request, reply) => {
        // Clear transaction binding on *every* callback result, including failures.
        reply.header("set-cookie", clearCookie(LOGIN_COOKIE));
        const query = z
          .object({
            code: z.string().min(1).max(4096),
            state: z.string().regex(/^[\w-]{43}$/u),
          })
          .safeParse(request.query);
        if (!query.success) throw invalidCallback();
        const pending = await attempts.take(digestSecret(query.data.state)); // atomic one-time consume
        if (
          !pending ||
          !matchesCallback(
            pending,
            query.data.state,
            readCookie(request.headers.cookie, LOGIN_COOKIE),
            now(),
          )
        )
          throw invalidCallback();
        try {
          const tokens = await options.provider.exchange(
            query.data.code,
            pending.verifier,
            pending.nonce,
          );
          if (
            !tokens.subject.startsWith("cognito:") ||
            tokens.expiresAtMs <= now()
          )
            throw new Error("Invalid provider subject");
          await sessions.invalidate(cookieId(request)); // no session fixation on account switch
          const { id } = sessions.create(tokens);
          reply.header("set-cookie", [
            clearCookie(LOGIN_COOKIE),
            cookieHeader(
              SESSION_COOKIE,
              id,
              Math.ceil((options.sessionAbsoluteMs ?? 28_800_000) / 1000),
            ),
          ]);
          return reply.code(303).redirect(pending.returnTo);
        } catch {
          throw invalidCallback();
        }
      });
      app.get("/api/session", async (request) => {
        // Background status checks must not turn an idle session into an immortal one.
        const session = await sessions.get(cookieId(request), false);
        if (!session) return { authenticated: false, registered: false };
        const user = await options.catalog.findUserByVerifiedSubject(
          session.subject,
        );
        return {
          authenticated: true,
          registered: Boolean(user),
          user: user ? { id: user.id, displayName: user.displayName } : null,
          csrfToken: session.csrf,
        };
      });
      app.post("/auth/logout", async (request, reply) => {
        await sessions.invalidate(cookieId(request));
        reply.header("set-cookie", [
          clearCookie(SESSION_COOKIE),
          clearCookie(LOGIN_COOKIE),
        ]);
        return { logoutUrl: options.provider.logoutUrl() };
      });
    },
  };
}
