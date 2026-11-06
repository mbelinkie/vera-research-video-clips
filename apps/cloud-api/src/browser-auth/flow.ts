import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TEST_ORIGIN = "https://local.invalid";
export const LOGIN_ATTEMPT_TTL_MS = 5 * 60_000;
export const secret = () => randomBytes(32).toString("base64url");
export const digestSecret = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function constantEqual(expected: string, actual: string): boolean {
  return (
    /^[a-f0-9]{64}$/u.test(expected) &&
    /^[a-f0-9]{64}$/u.test(actual) &&
    timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"))
  );
}
export function normalizeReturnTo(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\x00-\x1f\x7f]/u.test(value) ||
    /%(?:2f|5c|0[0-9a-f]|7f)/iu.test(value)
  )
    return "/";
  try {
    const url = new URL(value, TEST_ORIGIN);
    return url.origin === TEST_ORIGIN &&
      url.pathname.startsWith("/") &&
      !url.pathname.startsWith("//") &&
      !url.hash &&
      !url.username &&
      !url.password
      ? url.pathname + url.search
      : "/";
  } catch {
    return "/";
  }
}
export type PendingLogin = Readonly<{
  stateDigest: string;
  bindingDigest: string;
  verifier: string;
  nonce: string;
  returnTo: string;
  expiresAtMs: number;
}>;
export function beginLogin(nowMs: number, returnTo: unknown) {
  const state = secret(),
    browserBinding = secret(),
    verifier = secret(),
    nonce = secret();
  return {
    state,
    browserBinding,
    challenge: createHash("sha256")
      .update(verifier, "ascii")
      .digest("base64url"),
    pending: {
      stateDigest: digestSecret(state),
      bindingDigest: digestSecret(browserBinding),
      verifier,
      nonce,
      returnTo: normalizeReturnTo(returnTo),
      expiresAtMs: nowMs + LOGIN_ATTEMPT_TTL_MS,
    } satisfies PendingLogin,
  };
}
export function matchesCallback(
  pending: PendingLogin,
  state: unknown,
  binding: unknown,
  nowMs: number,
): boolean {
  return (
    typeof state === "string" &&
    typeof binding === "string" &&
    nowMs < pending.expiresAtMs &&
    constantEqual(pending.stateDigest, digestSecret(state)) &&
    constantEqual(pending.bindingDigest, digestSecret(binding))
  );
}
export function matchesExactOrigin(
  requestOrigin: string | undefined,
  configuredOrigin: string,
) {
  return requestOrigin === configuredOrigin;
}
export interface LoginAttemptStore {
  put(pending: PendingLogin): Promise<void>;
  take(stateDigest: string): Promise<PendingLogin | undefined>;
}
export class MemoryLoginAttemptStore implements LoginAttemptStore {
  private attempts = new Map<string, PendingLogin>();
  constructor(
    private readonly now: () => number = Date.now,
    private readonly cap = 1000,
  ) {}
  async put(pending: PendingLogin) {
    for (const [key, value] of this.attempts)
      if (value.expiresAtMs <= this.now()) this.attempts.delete(key);
    if (this.attempts.size >= this.cap)
      throw new Error("Login temporarily unavailable");
    this.attempts.set(pending.stateDigest, pending);
  }
  async take(key: string) {
    const pending = this.attempts.get(key);
    this.attempts.delete(key);
    return pending;
  }
}
