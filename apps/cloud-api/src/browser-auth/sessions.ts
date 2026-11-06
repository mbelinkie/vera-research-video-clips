import { secret, digestSecret, constantEqual } from "./flow.ts";
import type { IdentityProvider, VerifiedTokens } from "./provider.ts";

export const SESSION_COOKIE = "__Host-vera_session";
export const LOGIN_COOKIE = "__Host-vera_login";
const cookieFlags = "Path=/; Secure; HttpOnly; SameSite=Lax";
export const cookieHeader = (
  name: string,
  value: string,
  maxAgeSeconds?: number,
) =>
  `${name}=${value}; ${cookieFlags}${maxAgeSeconds === undefined ? "" : `; Max-Age=${maxAgeSeconds}`}`;
export const clearCookie = (name: string) => cookieHeader(name, "", 0);

/** Duplicate cookie values (including an empty first cookie) always fail closed. */
export function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header || header.length > 8192) return undefined;
  const values = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  if (values.length !== 1) return undefined;
  const value = values[0]!.slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : undefined;
}
export type ServerSession = {
  subject: string;
  tokens: VerifiedTokens;
  csrf: string;
  createdAtMs: number;
  lastSeenMs: number;
  revoked: boolean;
};
export class MemorySessionStore {
  private sessions = new Map<string, ServerSession>();
  private refreshes = new Map<string, Promise<void>>();
  constructor(
    private readonly provider: IdentityProvider,
    private readonly now: () => number = Date.now,
    private readonly idleMs = 1_800_000,
    private readonly absoluteMs = 28_800_000,
    private readonly cap = 1000,
  ) {}
  create(tokens: VerifiedTokens): { id: string; session: ServerSession } {
    const time = this.now();
    for (const [key, session] of this.sessions)
      if (session.revoked || this.expired(session, time))
        this.sessions.delete(key);
    if (this.sessions.size >= this.cap)
      throw new Error("Too many active sessions");
    const id = secret();
    const session: ServerSession = {
      subject: tokens.subject,
      tokens,
      csrf: secret(),
      createdAtMs: time,
      lastSeenMs: time,
      revoked: false,
    };
    this.sessions.set(digestSecret(id), session);
    return { id, session };
  }
  private expired(session: ServerSession, nowMs: number) {
    return (
      session.revoked ||
      nowMs >= session.createdAtMs + this.absoluteMs ||
      nowMs >= session.lastSeenMs + this.idleMs
    );
  }
  async get(
    id: string | undefined,
    touch = true,
  ): Promise<ServerSession | undefined> {
    if (!id || !/^[\w-]{43}$/u.test(id)) return undefined;
    const key = digestSecret(id);
    const session = this.sessions.get(key);
    if (!session) return undefined;
    if (this.expired(session, this.now())) {
      this.sessions.delete(key);
      return undefined;
    }
    if (session.tokens.expiresAtMs <= this.now() + 30_000) {
      let ongoing = this.refreshes.get(key);
      if (!ongoing) {
        ongoing = (async () => {
          const updated = await this.provider.refresh(
            session.tokens.refreshToken,
            session.subject,
          );
          if (
            updated.subject !== session.subject ||
            updated.expiresAtMs <= this.now()
          )
            throw new Error("Invalid refreshed identity");
          if (this.sessions.get(key) !== session || session.revoked)
            throw new Error("Session revoked");
          session.tokens = updated;
        })();
        this.refreshes.set(key, ongoing);
        void ongoing
          .finally(() => {
            if (this.refreshes.get(key) === ongoing) this.refreshes.delete(key);
          })
          .catch(() => undefined);
      }
      try {
        await ongoing;
      } catch {
        this.sessions.delete(key);
        session.revoked = true;
        return undefined;
      }
    }
    if (this.sessions.get(key) !== session || this.expired(session, this.now()))
      return undefined;
    if (touch) session.lastSeenMs = this.now();
    return session;
  }
  async invalidate(id: string | undefined) {
    if (!id) return;
    const session = this.sessions.get(digestSecret(id));
    if (!session) return;
    session.revoked = true;
    this.sessions.delete(digestSecret(id));
    try {
      await this.provider.revoke(session.tokens.refreshToken);
    } catch {
      /* Local logout is final even if remote revocation fails. */
    }
  }
  verifyCsrf(session: ServerSession, supplied: unknown): boolean {
    return (
      typeof supplied === "string" &&
      constantEqual(digestSecret(session.csrf), digestSecret(supplied))
    );
  }
}
