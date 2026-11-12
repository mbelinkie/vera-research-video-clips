import { describe, expect, it, vi } from "vitest";

import { parseClipCutArguments, runClipCutCli } from "./clip-cut-cli.ts";

const projectId = "019fbb95-cd76-7920-93fa-e23ba755e391";
const firstClip = "019fbb95-cd76-7920-93fa-e23ba755e392";
const secondClip = "019fbb95-cd76-7920-93fa-e23ba755e393";
const argv = [
  "--project-id",
  projectId,
  "--clip-id",
  firstClip,
  "--clip-id",
  secondClip,
  "--confirm-rights",
];

describe("foreground clip:cut command", () => {
  it("parses the documented fixed multi-clip argument form", () => {
    expect(parseClipCutArguments(argv)).toEqual({
      projectId,
      clipIds: [firstClip, secondClip],
      authorizationConfirmed: true,
    });
  });

  it("rejects duplicate IDs, extra arguments, missing rights and malformed IDs", () => {
    expect(() =>
      parseClipCutArguments([...argv, "--clip-id", firstClip]),
    ).toThrow();
    expect(() =>
      parseClipCutArguments(argv.filter((arg) => arg !== "--confirm-rights")),
    ).toThrow();
    expect(() =>
      parseClipCutArguments([...argv, "https://user-supplied-url"]),
    ).toThrow();
    expect(() =>
      parseClipCutArguments([
        "--project-id",
        "../../etc",
        "--clip-id",
        firstClip,
        "--confirm-rights",
      ]),
    ).toThrow();
  });

  it("refuses missing authorization before invoking a cutter and prints one sentence", async () => {
    const run = vi.fn(async () => []);
    const stderr = vi.fn();
    expect(await runClipCutCli(argv, { env: {}, run, stderr })).toBe(1);
    expect(run).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledOnce();
    expect(stderr.mock.calls[0]![0]).toMatch(
      /^Set RESEARCH_AUTHORIZATION.*\.$/u,
    );
  });

  it("forwards bearer and rights to the cutter and returns paths as JSON, without exposing credentials", async () => {
    const run = vi.fn(async () => [
      {
        clipId: firstClip,
        videoId: "M7lc1UVf-VE",
        folder: "/private/exports/clip",
        mediaPath: "/private/exports/clip/clip.mp4",
        subtitlePaths: ["/private/exports/clip/clip.en.srt"],
        manifestPath: "/private/exports/clip/clip.json",
      },
    ]);
    const stdout = vi.fn();
    const stderr = vi.fn();
    expect(
      await runClipCutCli(argv, {
        env: { RESEARCH_AUTHORIZATION: "Bearer development-secret" },
        run,
        stdout,
        stderr,
      }),
    ).toBe(0);
    expect(run).toHaveBeenCalledExactlyOnceWith({
      projectId,
      clipIds: [firstClip, secondClip],
      authorization: "Bearer development-secret",
      authorizationConfirmed: true,
    });
    expect(JSON.parse(stdout.mock.calls[0]![0]).clips[0].mediaPath).toBe(
      "/private/exports/clip/clip.mp4",
    );
    expect(stdout.mock.calls[0]![0]).not.toContain("development-secret");
    expect(stderr).not.toHaveBeenCalled();
  });

  it("fails closed without explicit full-source opt-in; no DB or network initialized", async () => {
    const stderr = vi.fn();
    expect(
      await runClipCutCli(argv, {
        env: {
          RESEARCH_AUTHORIZATION: "Bearer development-secret",
          NODE_ENV: "test",
        },
        stderr,
      }),
    ).toBe(1);
    expect(stderr.mock.calls[0]![0]).toContain("EXPORT_SOURCE_PROVIDER=yt-dlp");
  });

  it("reports unavailable media in a single sanitized sentence and exits nonzero", async () => {
    const stderr = vi.fn();
    expect(
      await runClipCutCli(argv, {
        env: { RESEARCH_AUTHORIZATION: "Bearer secret-value" },
        run: async () => {
          throw new Error(
            "Download refused for https://example.invalid/some-path\nAuthorization: Bearer secret-value",
          );
        },
        stderr,
      }),
    ).toBe(1);
    expect(stderr.mock.calls[0]![0]).toContain("[source URL]");
    expect(stderr.mock.calls[0]![0]).not.toContain("secret-value");
    expect(stderr.mock.calls[0]![0]).not.toContain("\n");
  });
});
