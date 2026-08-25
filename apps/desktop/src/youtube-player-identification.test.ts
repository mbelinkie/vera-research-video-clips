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
    listener?.({ requestHeaders: { Accept: "text/html" } }, callback);
    expect(callback).toHaveBeenCalledWith({
      requestHeaders: {
        Accept: "text/html",
        Referer: youtubePlayerReferer,
      },
    });
  });
});
