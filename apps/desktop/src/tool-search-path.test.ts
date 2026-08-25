import { delimiter, dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { desktopToolSearchPath } from "./tool-search-path.ts";

describe("desktopToolSearchPath", () => {
  it("puts configured tool directories before the restricted GUI path", () => {
    const ytDlp = resolve("/", "opt", "research-tools", "yt-dlp");
    const whisper = resolve("/", "opt", "speech-tools", "whisper-cli");

    expect(
      desktopToolSearchPath(
        [ytDlp, whisper],
        [resolve("/", "usr", "bin"), resolve("/", "bin")].join(delimiter),
      ).split(delimiter),
    ).toEqual([
      dirname(ytDlp),
      dirname(whisper),
      resolve("/", "usr", "bin"),
      resolve("/", "bin"),
    ]);
  });

  it("deduplicates tool directories and ignores relative executable names", () => {
    const ytDlp = resolve("/", "usr", "local", "bin", "yt-dlp");
    const inherited = [dirname(ytDlp), resolve("/", "usr", "bin")].join(
      delimiter,
    );

    expect(
      desktopToolSearchPath([ytDlp, "whisper-cli"], inherited).split(delimiter),
    ).toEqual([dirname(ytDlp), resolve("/", "usr", "bin")]);
  });
});
