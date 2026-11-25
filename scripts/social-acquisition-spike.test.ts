import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { MediaCommandRunner } from "@research-video/media";

import {
  normalizeSocialSpikeUrl,
  parseSocialSpikeCommandLine,
  runSocialAcquisitionSpike,
} from "./social-acquisition-spike.ts";

describe("social acquisition spike", () => {
  it("normalizes only canonical TikTok, Instagram, and Facebook media URLs", () => {
    expect(
      normalizeSocialSpikeUrl(
        "tiktok",
        "https://www.tiktok.com/@fixture/video/1234567890123456789?share=1",
      ),
    ).toEqual({
      providerMediaId: "1234567890123456789",
      canonicalUrl: "https://www.tiktok.com/@fixture/video/1234567890123456789",
    });
    expect(
      normalizeSocialSpikeUrl(
        "instagram",
        "https://www.instagram.com/reel/Fixture_123/?utm_source=test",
      ),
    ).toEqual({
      providerMediaId: "Fixture_123",
      canonicalUrl: "https://www.instagram.com/reel/Fixture_123/",
    });
    expect(() =>
      normalizeSocialSpikeUrl("instagram", "https://example.com/reel/nope"),
    ).toThrow("canonical public Instagram");
    expect(
      normalizeSocialSpikeUrl(
        "facebook",
        "https://www.facebook.com/reel/123456789012345/?utm_source=test",
      ),
    ).toEqual({
      providerMediaId: "123456789012345",
      canonicalUrl: "https://www.facebook.com/watch/?v=123456789012345",
    });
    expect(
      normalizeSocialSpikeUrl(
        "facebook",
        "https://www.facebook.com/watch/?v=987654321098765&ref=sharing",
      ),
    ).toEqual({
      providerMediaId: "987654321098765",
      canonicalUrl: "https://www.facebook.com/watch/?v=987654321098765",
    });
  });

  it("uses hardened yt-dlp commands, validates media, and always cleans scratch", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "social-spike-test-"));
    const removeScratch = vi.fn((path: string) =>
      rm(path, { recursive: true, force: true }),
    );
    const run = vi.fn<MediaCommandRunner["run"]>(async (executable, args) => {
      if (args[0] === "--version")
        return { stdout: "2026.08.24\n", stderr: "" };
      if (executable === "/opt/ffprobe") {
        return {
          stdout: JSON.stringify({
            format: { format_name: "mov,mp4", duration: "2.5" },
            streams: [
              { codec_type: "video", codec_name: "h264" },
              { codec_type: "audio", codec_name: "aac" },
            ],
          }),
          stderr: "",
        };
      }
      if (args.includes("--skip-download")) {
        return {
          stdout: JSON.stringify({
            id: "1234567890123456789",
            title: "Authorized fixture",
            uploader: "Fixture Creator",
            duration: 2.5,
            thumbnail: "https://cdn.example.test/thumb.jpg",
            subtitles: { en: [{ ext: "vtt" }] },
          }),
          stderr: "",
        };
      }
      const output = args[args.indexOf("--output") + 1]!;
      await writeFile(output.replace("%(ext)s", "mp4"), "fixture media");
      return { stdout: "", stderr: "" };
    });

    const result = await runSocialAcquisitionSpike(
      {
        platform: "tiktok",
        url: "https://www.tiktok.com/@fixture/video/1234567890123456789",
        authorizationConfirmed: true,
        rightsCleared: true,
        ytDlpPath: "/opt/yt-dlp",
        ffprobePath: "/opt/ffprobe",
      },
      { runner: { run }, createScratch: async () => scratch, removeScratch },
    );
    expect(result).toMatchObject({
      status: "passed",
      platform: "tiktok",
      providerMediaId: "1234567890123456789",
      media: { videoCodec: "h264", audioCodec: "aac", durationMs: 2_500 },
      cleanup: { scratchRemoved: true },
    });
    for (const call of run.mock.calls.filter(
      (call) => call[0] === "/opt/yt-dlp" && call[1][0] !== "--version",
    )) {
      expect(call[1]).toEqual(
        expect.arrayContaining([
          "--no-config",
          "--no-playlist",
          "--no-cookies",
        ]),
      );
      expect(call[1].join(" ")).not.toMatch(
        /cookies-from-browser|username|password/u,
      );
    }
    expect(removeScratch).toHaveBeenCalledWith(scratch);
  });

  it("requires affirmative live-run authorization flags", () => {
    expect(() =>
      parseSocialSpikeCommandLine([
        "--platform",
        "instagram",
        "--url",
        "https://www.instagram.com/reel/Fixture/",
      ]),
    ).toThrow("rights clearance");
  });
});
