/**
 * Native OAuth callback handling deliberately has no Electron dependency. The
 * Electron lifecycle owns protocol registration; it passes untrusted URL
 * strings to this small, testable boundary.
 */
export const DESKTOP_OAUTH_CALLBACK_URI =
  "research-video-clips://oauth/callback";

const MAX_CALLBACK_URL_LENGTH = 8_192;
const MAX_AUTHORIZATION_CODE_LENGTH = 4_096;
const MAX_STATE_LENGTH = 512;

export class NativeOAuthCallbackError extends Error {
  readonly code = "native_oauth_callback_rejected";

  constructor() {
    super("The sign-in callback could not be accepted. Please try again.");
  }
}

export interface NativeOAuthCallback {
  /** A normalized, exact-target callback URL. Never send this to the renderer. */
  readonly url: URL;
  /** Used only for replay de-duplication inside the trusted main process. */
  readonly replayKey: string;
}

/**
 * Parses the only native callback URI registered with Cognito. The OAuth
 * client's authorization attempt still verifies state, expiry, and consumes
 * the authorization code; this parser makes sure no other deep link reaches
 * that code path.
 */
export function parseNativeOAuthCallback(input: string): NativeOAuthCallback {
  if (input.length === 0 || input.length > MAX_CALLBACK_URL_LENGTH) {
    throw new NativeOAuthCallbackError();
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new NativeOAuthCallbackError();
  }

  if (
    url.protocol !== "research-video-clips:" ||
    url.hostname !== "oauth" ||
    url.pathname !== "/callback" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new NativeOAuthCallbackError();
  }

  const permitted = new Set(["code", "state", "error", "error_description"]);
  for (const [name] of url.searchParams) {
    if (!permitted.has(name)) {
      throw new NativeOAuthCallbackError();
    }
  }

  const code = oneRequiredQueryValue(
    url,
    "code",
    MAX_AUTHORIZATION_CODE_LENGTH,
  );
  const state = oneRequiredQueryValue(url, "state", MAX_STATE_LENGTH);
  const error = oneRequiredQueryValue(url, "error", 128);
  const errorDescription = oneOptionalQueryValue(url, "error_description", 512);
  if (
    !state ||
    Boolean(code) === Boolean(error) ||
    (code && errorDescription) ||
    (url.searchParams.has("error_description") && !errorDescription)
  ) {
    throw new NativeOAuthCallbackError();
  }

  return {
    url,
    replayKey: `${state}\u0000${code ?? `error:${error}`}`,
  };
}

function oneRequiredQueryValue(
  url: URL,
  name: string,
  maxLength: number,
): string | undefined {
  const values = url.searchParams.getAll(name);
  const value = values.length === 1 ? values[0] : undefined;
  if (
    !value ||
    value.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return undefined;
  }
  return value;
}

function oneOptionalQueryValue(
  url: URL,
  name: string,
  maxLength: number,
): string | undefined {
  if (url.searchParams.getAll(name).length === 0) {
    return undefined;
  }
  return oneRequiredQueryValue(url, name, maxLength);
}

export type NativeOAuthCallbackReceipt =
  | { readonly accepted: true }
  | {
      readonly accepted: false;
      readonly reason: "malformed" | "replayed" | "queue_full";
    };

/**
 * A finite native-event inbox. Protocol events may arrive before the
 * main-process broker is ready, but URL strings and authorization codes are
 * never retained indefinitely or forwarded to the renderer.
 */
export class NativeOAuthCallbackQueue {
  private readonly pending: NativeOAuthCallback[] = [];
  private readonly seenKeys = new Set<string>();
  private readonly seenOrder: string[] = [];

  constructor(
    private readonly maximumPending = 8,
    private readonly maximumReplayKeys = 64,
  ) {
    if (
      !Number.isSafeInteger(maximumPending) ||
      maximumPending < 1 ||
      maximumPending > 64 ||
      !Number.isSafeInteger(maximumReplayKeys) ||
      maximumReplayKeys < 1 ||
      maximumReplayKeys > 256
    ) {
      throw new RangeError("Native callback queue bounds are invalid.");
    }
  }

  get size(): number {
    return this.pending.length;
  }

  accept(input: string): NativeOAuthCallbackReceipt {
    let callback: NativeOAuthCallback;
    try {
      callback = parseNativeOAuthCallback(input);
    } catch {
      return { accepted: false, reason: "malformed" };
    }

    if (this.seenKeys.has(callback.replayKey)) {
      return { accepted: false, reason: "replayed" };
    }
    if (this.pending.length >= this.maximumPending) {
      return { accepted: false, reason: "queue_full" };
    }

    this.remember(callback.replayKey);
    this.pending.push(callback);
    return { accepted: true };
  }

  /** Removes every queued callback in arrival order. */
  takeAll(): readonly NativeOAuthCallback[] {
    return this.pending.splice(0);
  }

  private remember(key: string): void {
    this.seenKeys.add(key);
    this.seenOrder.push(key);
    if (this.seenOrder.length > this.maximumReplayKeys) {
      const oldest = this.seenOrder.shift();
      if (oldest) {
        this.seenKeys.delete(oldest);
      }
    }
  }
}
