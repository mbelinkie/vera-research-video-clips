import type { Session } from "electron";
import { describe, expect, it, vi } from "vitest";

import {
  installYouTubePlayerIdentification,
  withYouTubePlayerReferer,
  youtubePlayerReferer,
  youtubePlayerRequestFilter,
} from "./youtube-player-identification.ts";

describe("desktop YouTube player identification", () => {
  it("uses the stable installed app ID as an HTTPS Referer", () => {
    expect(youtubePlayerReferer).toBe(
      "https://com.researchvideoclips.desktop/",
    );
    expect(
      withYouTubePlayerReferer({
        Accept: "text/html",
        referer: "rvc://app/",
      }),
    ).toEqual({
      Accept: "text/html",
      Referer: youtubePlayerReferer,
    });
  });

  it.each([
    ["lowercase custom scheme", "referer", "rvc://app/"],
    ["uppercase stale HTTPS", "REFERER", "https://stale.example/"],
    ["mixed case stale HTTP", "ReFeReR", "http://stale.example/"],
  ])("replaces a %s Referer without mutating the input", (_, name, stale) => {
    const original = Object.freeze({
      Accept: "text/html",
      [name]: stale,
      "X-Test-Guard": "preserve-exactly",
    });

    expect(withYouTubePlayerReferer(original)).toEqual({
      Accept: "text/html",
      "X-Test-Guard": "preserve-exactly",
      Referer: youtubePlayerReferer,
    });
    expect(original[name]).toBe(stale);
  });

  it("removes every simultaneous stale Referer variant and preserves other headers", () => {
    const original = {
      referer: "rvc://app/",
      REFERER: "https://stale.example/",
      ReFeReR: "http://older.example/",
      Accept: "text/html",
      Cookie: "opaque-cookie-value",
      "X-Test-Guard": "preserve-exactly",
    };

    const identified = withYouTubePlayerReferer(original);
    expect(identified).toEqual({
      Accept: "text/html",
      Cookie: "opaque-cookie-value",
      "X-Test-Guard": "preserve-exactly",
      Referer: youtubePlayerReferer,
    });
    expect(
      Object.keys(identified).filter(
        (name) => name.toLowerCase() === "referer",
      ),
    ).toHaveLength(1);
    expect(original.referer).toBe("rvc://app/");
    expect(original.REFERER).toBe("https://stale.example/");
    expect(original.ReFeReR).toBe("http://older.example/");
  });

  it("restricts the session filter to the two HTTPS player hostnames", () => {
    expect(youtubePlayerRequestFilter).toEqual({
      urls: ["https://www.youtube.com/*", "https://www.youtube-nocookie.com/*"],
    });
    expect(youtubePlayerRequestFilter.urls).not.toContain(
      "https://*.youtube.com/*",
    );
    expect(youtubePlayerRequestFilter.urls).not.toContain("https://*/*");
    expect(youtubePlayerRequestFilter.urls).not.toContain(
      "http://www.youtube.com/*",
    );
  });

  it("installs a host-bounded request hook and identifies matching requests", () => {
    let listener:
      | ((
          details: { requestHeaders: Record<string, string> },
          callback: (response: {
            requestHeaders: Record<string, string>;
          }) => void,
        ) => void)
      | undefined;
    const onBeforeSendHeaders = vi.fn((filter, candidate) => {
      expect(filter).toEqual(youtubePlayerRequestFilter);
      listener = candidate;
    });
    const targetSession = {
      webRequest: { onBeforeSendHeaders },
    } as unknown as Pick<Session, "webRequest">;

    installYouTubePlayerIdentification(targetSession);

    expect(youtubePlayerRequestFilter.urls).toEqual([
      "https://www.youtube.com/*",
      "https://www.youtube-nocookie.com/*",
    ]);
    expect(onBeforeSendHeaders).toHaveBeenCalledOnce();
    const callback = vi.fn();
    expect(listener).toBeDefined();
    listener?.(
      {
        requestHeaders: {
          referer: "rvc://app/",
          REFERER: "https://stale.example/",
          Accept: "text/html",
          "X-Test-Guard": "keep",
        },
      },
      callback,
    );
    expect(callback).toHaveBeenCalledWith({
      requestHeaders: {
        Accept: "text/html",
        "X-Test-Guard": "keep",
        Referer: youtubePlayerReferer,
      },
    });
  });
});
