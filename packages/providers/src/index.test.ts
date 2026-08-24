import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  gateCaptionLanguage,
  InvalidYouTubeUrlError,
  TranscriptSourceAcquirer,
  TranscriptSourceResolver,
  YouTubeOEmbedMetadataProvider,
  normalizeYouTubeUrl,
  selectTranscriptSource,
} from "./index.ts";
import {
  YtDlpCaptionProvider,
  createCaptionProvider,
  normalizeAcquiredCaption,
  type CommandRunner,
} from "./captions-local.ts";

describe("caption language gate", () => {
  const automaticKorean = {
    id: "fixture:auto:ko",
    language: "ko",
    kind: "automatic" as const,
    translatable: false,
    downloadAccess: "available" as const,
  };

  it("rejects a conflicting automatic provider claim without relabeling its candidate", () => {
    const result = gateCaptionLanguage({
      track: automaticKorean,
      confirmedDecision: {
        schemaVersion: 1,
        decisionId: "11111111-1111-4111-8111-111111111111",
        decisionVersion: 2,
        status: "confirmed",
        basis: "user_confirmation",
        resolvedLanguage: "dz",
      },
    });

    expect(result).toMatchObject({
      state: "conflict",
      providerLanguage: "ko",
      confirmedLanguage: "dz",
      reason: "provider_confirmed_language_conflict",
    });
    expect(result.track).toBe(automaticKorean);
    expect(automaticKorean).toMatchObject({
      id: "fixture:auto:ko",
      language: "ko",
    });
  });

  it("also surfaces creator metadata conflict and preserves an exact matching decision", () => {
    expect(
      gateCaptionLanguage({ track: automaticKorean, creatorLanguage: "dz" }),
    ).toMatchObject({
      state: "conflict",
      reason: "provider_creator_language_conflict",
      providerLanguage: "ko",
      creatorLanguage: "dz",
    });

    const accepted = gateCaptionLanguage({
      track: automaticKorean,
      creatorLanguage: "dz",
      confirmedDecision: {
        schemaVersion: 1,
        decisionId: "22222222-2222-4222-8222-222222222222",
        decisionVersion: 3,
        status: "confirmed",
        basis: "user_confirmation",
        resolvedLanguage: "ko-KR",
      },
    });
    expect(accepted).toMatchObject({
      state: "accepted",
      providerLanguage: "ko",
      resolvedLanguage: "ko-KR",
    });
    expect(accepted.track).toBe(automaticKorean);
  });
});

describe("normalizeYouTubeUrl", () => {
  it.each([
    "https://www.youtube.com/watch?v=M7lc1UVf-VE&t=12s",
    "https://youtu.be/M7lc1UVf-VE?si=fixture",
    "youtube.com/shorts/M7lc1UVf-VE",
    "https://m.youtube.com/live/M7lc1UVf-VE",
    "https://www.youtube-nocookie.com/embed/M7lc1UVf-VE",
    "M7lc1UVf-VE",
  ])("normalizes %s", (input) => {
    expect(normalizeYouTubeUrl(input)).toEqual({
      videoId: "M7lc1UVf-VE",
      canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
    });
  });

  it("rejects non-video and lookalike URLs", () => {
    expect(() =>
      normalizeYouTubeUrl("https://youtube.example/watch?v=M7lc1UVf-VE"),
    ).toThrow(InvalidYouTubeUrlError);
    expect(() =>
      normalizeYouTubeUrl("https://youtube.com/playlist?list=PL123"),
    ).toThrow(InvalidYouTubeUrlError);
  });
});

describe("YtDlpCaptionProvider", () => {
  it("is opt-in through the provider configuration boundary", () => {
    expect(
      createCaptionProvider({ mode: "disabled", ytDlpPath: "yt-dlp" }),
    ).toBeUndefined();
    expect(
      createCaptionProvider({
        mode: "yt-dlp",
        ytDlpPath: "/opt/tools/yt-dlp",
      }),
    ).toBeInstanceOf(YtDlpCaptionProvider);
  });

  it("normalizes manual and automatic tracks from provider metadata", async () => {
    const run = vi.fn(async () => ({
      stdout: JSON.stringify({
        language: "en",
        subtitles: {
          es: [{ ext: "vtt" }],
          en: [{ ext: "vtt" }],
          invalid: [],
        },
        automatic_captions: { en: [{ ext: "vtt" }] },
      }),
      stderr: "",
    }));
    const provider = new YtDlpCaptionProvider({
      executable: "/opt/tools/yt-dlp",
      runner: { run },
    });

    await expect(provider.discover("M7lc1UVf-VE")).resolves.toEqual([
      {
        id: "yt-dlp:manual:en",
        language: "en",
        kind: "manual",
        translatable: false,
        downloadAccess: "available",
      },
      {
        id: "yt-dlp:manual:es",
        language: "es",
        kind: "manual",
        translatable: false,
        downloadAccess: "available",
      },
      {
        id: "yt-dlp:automatic:en",
        language: "en",
        kind: "automatic",
        translatable: false,
        downloadAccess: "available",
      },
    ]);
    expect(run).toHaveBeenCalledWith(
      "/opt/tools/yt-dlp",
      [
        "--no-config",
        "--no-playlist",
        "--skip-download",
        "--dump-single-json",
        "--no-warnings",
        "--",
        "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      ],
      { timeoutMs: 120_000 },
    );
  });

  it("does not mislabel translated automatic-caption aliases as source speech", async () => {
    const provider = new YtDlpCaptionProvider({
      runner: {
        run: vi.fn(async () => ({
          stdout: JSON.stringify({
            automatic_captions: {
              "es-orig": [{ ext: "vtt" }],
              en: [{ ext: "vtt" }],
              fr: [{ ext: "vtt" }],
            },
          }),
          stderr: "",
        })),
      },
    });

    await expect(provider.discover("M7lc1UVf-VE")).resolves.toEqual([
      {
        id: "yt-dlp:automatic:es-orig",
        language: "es",
        kind: "automatic",
        translatable: false,
        downloadAccess: "available",
      },
    ]);
  });

  it("acquires only the selected track into isolated scratch storage", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "caption-provider-"));
    const run = vi.fn<CommandRunner["run"]>(async (_executable, args) => {
      const outputIndex = args.indexOf("--output");
      const template = args[outputIndex + 1];
      expect(template).toBeDefined();
      await writeFile(
        template!.replace("%(ext)s", "es.vtt"),
        "WEBVTT\n\n00:00.000 --> 00:01.000\nHola\n",
      );
      return { stdout: "", stderr: "" };
    });
    const provider = new YtDlpCaptionProvider({ runner: { run } });
    const track = {
      id: "yt-dlp:manual:es",
      language: "es",
      kind: "manual" as const,
      translatable: false,
      downloadAccess: "available" as const,
    };

    try {
      const acquired = await provider.acquire("M7lc1UVf-VE", track, scratch);
      expect(acquired).toMatchObject({
        videoId: "M7lc1UVf-VE",
        track,
        format: "vtt",
        provider: "yt-dlp",
      });
      expect(acquired.byteSize).toBeGreaterThan(0);
      expect(acquired.path.startsWith(`${scratch}/caption-`)).toBe(true);
      expect(run.mock.calls[0]?.[1]).toEqual(
        expect.arrayContaining([
          "--write-subs",
          "--no-write-auto-subs",
          "--sub-langs",
          "es",
          "--sub-format",
          "vtt",
        ]),
      );

      await expect(
        provider.acquire("M7lc1UVf-VE", track, scratch),
      ).resolves.toEqual(acquired);
      expect(run).toHaveBeenCalledTimes(1);
      await expect(normalizeAcquiredCaption(acquired)).resolves.toMatchObject({
        track: {
          language: "es",
          kind: "original",
          source: "youtube-manual",
          timingPrecision: "cue",
        },
        segments: [{ startMs: 0, endMs: 1_000, text: "Hola" }],
      });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("refuses to acquire a track the adapter did not mark available", async () => {
    const run = vi.fn<CommandRunner["run"]>();
    const provider = new YtDlpCaptionProvider({ runner: { run } });

    await expect(
      provider.acquire(
        "M7lc1UVf-VE",
        {
          id: "owner-only",
          language: "en",
          kind: "manual",
          translatable: false,
          downloadAccess: "authorization-required",
        },
        "/tmp/not-used",
      ),
    ).rejects.toThrow("not available");
    expect(run).not.toHaveBeenCalled();
  });
});

describe("YouTubeOEmbedMetadataProvider", () => {
  it("normalizes the provider response behind the metadata boundary", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          title: "API demo",
          author_name: "Google Developers",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new YouTubeOEmbedMetadataProvider(fetcher);

    await expect(provider.resolve("M7lc1UVf-VE")).resolves.toEqual({
      videoId: "M7lc1UVf-VE",
      title: "API demo",
      channel: "Google Developers",
    });
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("format=json");
  });
});

const available = {
  translatable: true,
  downloadAccess: "available" as const,
};

describe("selectTranscriptSource", () => {
  it("uses deterministic manual/automatic target then original-language precedence", () => {
    const tracks = [
      {
        id: "es-manual",
        language: "es",
        kind: "manual" as const,
        ...available,
      },
      {
        id: "en-auto",
        language: "en",
        kind: "automatic" as const,
        ...available,
      },
      {
        id: "en-manual",
        language: "en-US",
        kind: "manual" as const,
        ...available,
      },
    ];

    expect(
      selectTranscriptSource(tracks, {
        targetLanguage: "en",
        sourceLanguage: "es",
        sourcePolicy: "prefer-existing",
      }),
    ).toMatchObject({
      strategy: "caption",
      track: { id: "en-manual" },
      requiresTranslation: false,
      reason: "manual-target-language",
    });
    expect(
      selectTranscriptSource(tracks.slice(0, 2), {
        targetLanguage: "en",
        sourceLanguage: "es",
        sourcePolicy: "captions-then-generate",
      }),
    ).toMatchObject({
      track: { id: "en-auto" },
      reason: "automatic-target-language",
    });
  });

  it("prefers a known original language and preserves it for translation", () => {
    const plan = selectTranscriptSource(
      [
        { id: "fr", language: "fr", kind: "manual", ...available },
        { id: "es", language: "es-MX", kind: "manual", ...available },
      ],
      {
        targetLanguage: "en",
        sourceLanguage: "es",
        sourcePolicy: "prefer-existing",
      },
    );

    expect(plan).toMatchObject({
      strategy: "caption",
      track: { id: "es", language: "es-MX" },
      sourceLanguage: "es-MX",
      requiresTranslation: true,
      reason: "manual-original-language",
    });
  });

  it("falls back honestly when captions are absent, inaccessible, or generation is forced", () => {
    expect(
      selectTranscriptSource([], {
        targetLanguage: "en",
        sourcePolicy: "prefer-existing",
      }),
    ).toMatchObject({
      strategy: "speech-to-text",
      reason: "no-caption-tracks",
    });
    expect(
      selectTranscriptSource(
        [
          {
            id: "owner-only",
            language: "en",
            kind: "manual",
            translatable: true,
            downloadAccess: "authorization-required",
          },
        ],
        { targetLanguage: "en", sourcePolicy: "prefer-existing" },
      ),
    ).toMatchObject({
      strategy: "speech-to-text",
      reason: "no-downloadable-caption-tracks",
    });
    expect(
      selectTranscriptSource(
        [
          {
            id: "usable",
            language: "en",
            kind: "manual",
            ...available,
          },
        ],
        { targetLanguage: "en", sourcePolicy: "force-generate" },
      ),
    ).toMatchObject({
      strategy: "speech-to-text",
      reason: "forced-generation",
    });
  });

  it("resolves through the caption-discovery provider boundary", async () => {
    const discover = vi.fn(async () => [
      {
        id: "fixture-caption",
        language: "en",
        kind: "manual" as const,
        ...available,
      },
    ]);
    const resolver = new TranscriptSourceResolver({ discover });

    await expect(
      resolver.resolve("M7lc1UVf-VE", {
        targetLanguage: "en",
        sourcePolicy: "prefer-existing",
      }),
    ).resolves.toMatchObject({
      strategy: "caption",
      track: { id: "fixture-caption" },
    });
    expect(discover).toHaveBeenCalledWith("M7lc1UVf-VE", undefined);
  });

  it("acquires only the deterministic winning caption track", async () => {
    const discover = vi.fn(async () => [
      {
        id: "yt-dlp:manual:es",
        language: "es",
        kind: "manual" as const,
        ...available,
      },
      {
        id: "yt-dlp:automatic:en",
        language: "en",
        kind: "automatic" as const,
        ...available,
      },
    ]);
    const acquire = vi.fn(async (_videoId, track) => ({
      videoId: "M7lc1UVf-VE",
      track,
      path: "/private/scratch/caption.en.vtt",
      format: "vtt" as const,
      byteSize: 120,
      provider: "fixture",
    }));
    const acquirer = new TranscriptSourceAcquirer({ discover, acquire });

    await expect(
      acquirer.resolveAndAcquire(
        "M7lc1UVf-VE",
        {
          targetLanguage: "en",
          sourceLanguage: "es",
          sourcePolicy: "prefer-existing",
        },
        "/private/scratch",
      ),
    ).resolves.toMatchObject({
      plan: {
        strategy: "caption",
        track: { id: "yt-dlp:automatic:en" },
      },
      caption: { path: "/private/scratch/caption.en.vtt" },
    });
    expect(acquire).toHaveBeenCalledWith(
      "M7lc1UVf-VE",
      expect.objectContaining({ id: "yt-dlp:automatic:en" }),
      "/private/scratch",
      undefined,
    );
  });

  it("does not acquire captions when policy requires speech recognition", async () => {
    const acquire = vi.fn();
    const acquirer = new TranscriptSourceAcquirer({
      discover: vi.fn(async () => [
        {
          id: "yt-dlp:manual:en",
          language: "en",
          kind: "manual" as const,
          ...available,
        },
      ]),
      acquire,
    });

    await expect(
      acquirer.resolveAndAcquire(
        "M7lc1UVf-VE",
        { targetLanguage: "en", sourcePolicy: "force-generate" },
        "/private/scratch",
      ),
    ).resolves.toMatchObject({
      plan: { strategy: "speech-to-text", reason: "forced-generation" },
    });
    expect(acquire).not.toHaveBeenCalled();
  });
});
