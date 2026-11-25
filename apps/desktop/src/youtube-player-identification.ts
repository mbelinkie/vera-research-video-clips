import type { Session } from "electron";

export const youtubePlayerAppId = "com.researchvideoclips.desktop";
export const youtubePlayerReferer = `https://${youtubePlayerAppId}/`;

export const youtubePlayerRequestFilter = {
  urls: ["https://www.youtube.com/*", "https://www.youtube-nocookie.com/*"],
};

export function withYouTubePlayerReferer(
  requestHeaders: Readonly<Record<string, string>>,
): Record<string, string> {
  const identifiedHeaders = Object.fromEntries(
    Object.entries(requestHeaders).filter(
      ([name]) => name.toLowerCase() !== "referer",
    ),
  );
  identifiedHeaders.Referer = youtubePlayerReferer;
  return identifiedHeaders;
}

/**
 * YouTube requires desktop WebViews to identify embedded-player requests with
 * an HTTPS Referer whose host is the stable installed application ID.
 */
export function installYouTubePlayerIdentification(
  targetSession: Pick<Session, "webRequest">,
): void {
  targetSession.webRequest.onBeforeSendHeaders(
    youtubePlayerRequestFilter,
    (details, callback) => {
      callback({
        requestHeaders: withYouTubePlayerReferer(details.requestHeaders),
      });
    },
  );
}
