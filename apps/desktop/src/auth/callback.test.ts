import { describe, expect, it } from "vitest";

import {
  NativeOAuthCallbackQueue,
  NativeOAuthCallbackError,
  parseNativeOAuthCallback,
} from "./callback.ts";

const callback =
  "research-video-clips://oauth/callback?code=authorization-code&state=expected-state";

describe("native OAuth callback parser", () => {
  it("accepts only the exact registered callback with one bounded code and state", () => {
    const parsed = parseNativeOAuthCallback(callback);

    expect(parsed.url.href).toBe(callback);
    expect(parsed.replayKey).toBe("expected-state\u0000authorization-code");
  });

  it.each([
    "https://oauth/callback?code=a&state=b",
    "research-video-clips://other/callback?code=a&state=b",
    "research-video-clips://oauth/other?code=a&state=b",
    "research-video-clips://oauth/callback?code=a&state=b#fragment",
    "research-video-clips://oauth/callback?code=a&code=b&state=c",
    "research-video-clips://oauth/callback?code=a&state=b&unexpected=c",
    "research-video-clips://oauth/callback?code=a&state=b&error=access_denied",
    "research-video-clips://oauth/callback?error=access_denied",
    "research-video-clips://oauth/callback?code=a",
    "research-video-clips://oauth/callback?code=&state=b",
  ])("rejects %s", (value) => {
    expect(() => parseNativeOAuthCallback(value)).toThrow(
      NativeOAuthCallbackError,
    );
  });

  it("allows the bounded state-bearing OAuth error shape for a safe broker rejection", () => {
    expect(
      parseNativeOAuthCallback(
        "research-video-clips://oauth/callback?error=access_denied&state=expected-state&error_description=User%20cancelled",
      ).replayKey,
    ).toBe("expected-state\u0000error:access_denied");
  });
});

describe("native OAuth callback queue", () => {
  it("keeps a cold callback until the broker drains it, then rejects replay", () => {
    const queue = new NativeOAuthCallbackQueue();

    expect(queue.accept(callback)).toEqual({ accepted: true });
    expect(queue.size).toBe(1);
    expect(queue.takeAll()).toHaveLength(1);
    expect(queue.size).toBe(0);
    expect(queue.accept(callback)).toEqual({
      accepted: false,
      reason: "replayed",
    });
  });

  it("does not consume capacity for malformed callbacks and bounds queued callbacks", () => {
    const queue = new NativeOAuthCallbackQueue(1, 2);

    expect(queue.accept("https://untrusted.example/callback")).toEqual({
      accepted: false,
      reason: "malformed",
    });
    expect(queue.accept(callback)).toEqual({ accepted: true });
    expect(
      queue.accept(
        "research-video-clips://oauth/callback?code=another-code&state=another-state",
      ),
    ).toEqual({ accepted: false, reason: "queue_full" });
  });
});
