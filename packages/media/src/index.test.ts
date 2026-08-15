import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  YtDlpAudioAcquisitionProvider,
  createMediaAcquisitionProvider,
  type MediaCommandRunner,
} from "./index.ts";

describe("YtDlpAudioAcquisitionProvider", () => {
  it("is opt-in and acquires only audio into isolated scratch storage", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "audio-provider-"));
    const runner = vi.fn<MediaCommandRunner["run"]>(
      async (_executable, args) => {
        const output = args[args.indexOf("--output") + 1]!;
        await writeFile(output.replace("%(ext)s", "flac"), "fixture audio");
        return { stdout: "", stderr: "" };
      },
    );
    const provider = createMediaAcquisitionProvider(
      { mode: "yt-dlp-audio", ytDlpPath: "/opt/tools/yt-dlp" },
      { run: runner },
    );

    try {
      expect(
        createMediaAcquisitionProvider({
          mode: "disabled",
          ytDlpPath: "yt-dlp",
        }),
      ).toBeUndefined();
      const acquired = await provider!.acquireAuthorizedSource(
        "M7lc1UVf-VE",
        scratch,
      );
      expect(acquired).toMatchObject({
        videoId: "M7lc1UVf-VE",
        format: "flac",
        provider: "yt-dlp",
        byteSize: 13,
      });
      expect(acquired.contentSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(runner.mock.calls[0]?.[1]).toEqual([
        "--no-config",
        "--no-playlist",
        "--no-progress",
        "--extract-audio",
        "--audio-format",
        "flac",
        "--output",
        join(scratch, "audio-M7lc1UVf-VE.%(ext)s"),
        "--",
        "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      ]);

      await expect(
        provider!.acquireAuthorizedSource("M7lc1UVf-VE", scratch),
      ).resolves.toEqual(acquired);
      expect(runner).toHaveBeenCalledTimes(1);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("rejects invalid video IDs before invoking the tool", async () => {
    const runner = vi.fn<MediaCommandRunner["run"]>();
    const provider = new YtDlpAudioAcquisitionProvider({
      runner: { run: runner },
    });
    await expect(
      provider.acquireAuthorizedSource("invalid", "/tmp/job"),
    ).rejects.toMatchObject({ code: "media_acquisition_failed" });
    expect(runner).not.toHaveBeenCalled();
  });
});
