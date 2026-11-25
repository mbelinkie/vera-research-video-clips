import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LocalDesktopSetupRepository,
  openLocalDatabase,
  runLocalMigrations,
} from "@research-video/db-local";
import type { MediaCommandRunner } from "@research-video/media";

import {
  DesktopSetupValidationError,
  LocalDesktopSetupService,
  recommendedToolCandidates,
  type DesktopSetupStatfs,
  type RecommendedToolCandidate,
} from "./desktop-setup.ts";

const directories = new Set<string>();
const now = () => new Date("2026-08-23T12:00:00.000Z");

afterEach(() => {
  for (const directory of directories)
    rmSync(directory, { recursive: true, force: true });
  directories.clear();
});

function fixture(
  options: {
    runner?: MediaCommandRunner;
    statfs?: DesktopSetupStatfs;
    measuredOperationBytes?: (target: "output_root" | "cache_root") => number;
    recommendedRoots?: () => { outputRoot: string; cacheRoot: string };
    recommendedToolCandidates?: (
      target: "ffmpeg" | "ffprobe" | "yt_dlp" | "whisper_cli",
    ) => readonly RecommendedToolCandidate[];
    exportWorkerStatus?: () => {
      available: boolean;
      issue?: "authentication_required" | "cloud_unavailable";
    };
  } = {},
) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "desktop-setup-"));
  directories.add(temporaryRoot);
  const root = realpathSync(temporaryRoot);
  const database = openLocalDatabase(join(root, "local.sqlite"));
  runLocalMigrations(database);
  const repository = new LocalDesktopSetupRepository(database, now);
  return {
    root,
    repository,
    service: new LocalDesktopSetupService(repository, {
      ...(options.runner ? { commandRunner: options.runner } : {}),
      statfs:
        options.statfs ??
        (async () => ({ bavail: 32n * 1024n * 1024n, bsize: 1024n })),
      ...(options.measuredOperationBytes
        ? { measuredOperationBytes: options.measuredOperationBytes }
        : {}),
      ...(options.recommendedRoots
        ? { recommendedRoots: options.recommendedRoots }
        : {}),
      ...(options.recommendedToolCandidates
        ? { recommendedToolCandidates: options.recommendedToolCandidates }
        : {}),
      ...(options.exportWorkerStatus
        ? { exportWorkerStatus: options.exportWorkerStatus }
        : {}),
      now,
    }),
  };
}

function executable(root: string, name: string) {
  const path = join(root, name);
  writeFileSync(path, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}

function capableRunner(): MediaCommandRunner {
  return {
    run: vi.fn(async (_executable, args) => {
      if (args.includes("-encoders")) {
        return {
          stdout:
            " V..... libx264\n V..... libx265\n V..... prores_ks\n A..... aac\n A..... pcm_s16le\n S..... mov_text\n S..... srt\n",
          stderr: "",
        };
      }
      if (args.includes("-muxers"))
        return { stdout: " E mp4\n E matroska\n E mov\n", stderr: "" };
      if (args.includes("-filters"))
        return { stdout: " .. scale\n .. fps\n", stderr: "" };
      if (args.includes("-show_program_version")) {
        return {
          stdout: JSON.stringify({ program_version: { version: "8.1" } }),
          stderr: "",
        };
      }
      if (args.includes("--help")) {
        return args.includes("--ignore-config")
          ? { stdout: "--simulate\n--dump-single-json\n", stderr: "" }
          : {
              stdout: "-m FNAME, --model FNAME\n-f FNAME, --file FNAME\n",
              stderr: "",
            };
      }
      if (args.includes("--version"))
        return { stdout: "2026.08.23\n", stderr: "" };
      return { stdout: "ffmpeg version 8.1.2\n", stderr: "" };
    }),
  };
}

function recommendedToolFixture(root: string) {
  mkdirSync(root, { recursive: true });
  const bin = join(root, "bin");
  const cellar = join(root, "Cellar");
  mkdirSync(bin);
  mkdirSync(cellar);
  const names = {
    ffmpeg: "ffmpeg",
    ffprobe: "ffprobe",
    yt_dlp: "yt-dlp",
    whisper_cli: "whisper-cli",
  } as const;
  const canonical = {} as Record<keyof typeof names, string>;
  const candidates = {} as Record<
    keyof typeof names,
    RecommendedToolCandidate[]
  >;
  for (const [target, name] of Object.entries(names) as Array<
    [keyof typeof names, string]
  >) {
    const versionRoot = join(cellar, `${name}-version`, "bin");
    mkdirSync(versionRoot, { recursive: true });
    canonical[target] = executable(versionRoot, name);
    const entrypoint = join(bin, name);
    symlinkSync(canonical[target], entrypoint);
    candidates[target] = [{ entrypoint, allowedCanonicalRoots: [cellar] }];
  }
  return {
    canonical,
    candidates: (target: keyof typeof names) => candidates[target],
  };
}

describe("local desktop setup service", () => {
  it("keeps Intel, Apple-Silicon, and app-owned entrypoints closed and deterministic", () => {
    expect(
      recommendedToolCandidates(
        "yt_dlp",
        "/Applications/Research Video Clips/tools",
      ),
    ).toEqual([
      {
        entrypoint: "/usr/local/bin/yt-dlp",
        allowedCanonicalRoots: ["/usr/local/bin", "/usr/local/Cellar"],
      },
      {
        entrypoint: "/opt/homebrew/bin/yt-dlp",
        allowedCanonicalRoots: ["/opt/homebrew/bin", "/opt/homebrew/Cellar"],
      },
      {
        entrypoint: "/Applications/Research Video Clips/tools/yt-dlp",
        allowedCanonicalRoots: ["/Applications/Research Video Clips/tools"],
      },
    ]);
  });

  it("proposes and applies path-free recommended roots and canonical tool targets", async () => {
    const base = realpathSync(
      mkdtempSync(join(tmpdir(), "desktop-recommended-")),
    );
    directories.add(base);
    const outputParent = join(base, "Movies");
    const cacheParent = join(base, "Caches");
    mkdirSync(outputParent);
    mkdirSync(cacheParent);
    const outputRoot = join(outputParent, "Research Video Clips Exports");
    const cacheRoot = join(cacheParent, "Research Video Clips");
    const tools = recommendedToolFixture(base);
    const { service, repository } = fixture({
      runner: capableRunner(),
      recommendedRoots: () => ({ outputRoot, cacheRoot }),
      recommendedToolCandidates: tools.candidates,
    });
    const model = { displayName: "Whisper large-v3-turbo", byteSize: 123 };

    const proposed = await service.checkRecommendedSetup(model);
    expect(proposed).toMatchObject({
      state: "ready_to_setup",
      roots: [
        { target: "output_root", state: "will_create" },
        { target: "cache_root", state: "will_create" },
      ],
      tools: [
        { target: "ffmpeg", state: "detected" },
        { target: "ffprobe", state: "detected" },
        { target: "yt_dlp", state: "detected" },
        { target: "whisper_cli", state: "detected" },
      ],
      model: { state: "download_required" },
    });
    expect(JSON.stringify(proposed)).not.toContain(base);

    const completed = await service.applyRecommendedSetup(model);
    expect(completed.state).toBe("completed");
    expect(repository.getSetup()).toMatchObject({
      workerEnabled: true,
      captionProvider: "yt_dlp",
      mediaProvider: "yt_dlp_audio",
      exportSourceProvider: "yt_dlp",
      speechToTextProvider: "whisper_cpp",
      rightsAcknowledged: false,
      privacyAcknowledged: false,
    });
    for (const target of [
      "ffmpeg",
      "ffprobe",
      "yt_dlp",
      "whisper_cli",
    ] as const) {
      expect(
        repository.getTrustedActiveComponentReference(target)?.absolutePath,
      ).toBe(tools.canonical[target]);
    }
    expect(
      repository.getTrustedActiveComponentReference("output_root")
        ?.absolutePath,
    ).toBe(outputRoot);
    expect(
      repository.getTrustedActiveComponentReference("cache_root")?.absolutePath,
    ).toBe(cacheRoot);
    expect(JSON.stringify(service.getSnapshot())).not.toContain(base);
  });

  it("uses deterministic closed candidates and ignores broken, looping, and escaped links", async () => {
    const base = realpathSync(
      mkdtempSync(join(tmpdir(), "desktop-discovery-")),
    );
    directories.add(base);
    const approved = join(base, "approved");
    const outside = join(base, "outside");
    const entries = join(base, "entries");
    mkdirSync(approved);
    mkdirSync(outside);
    mkdirSync(entries);
    const preferred = executable(approved, "preferred-ffmpeg");
    const duplicate = executable(approved, "duplicate-ffmpeg");
    const escaped = executable(outside, "escaped-ffmpeg");
    const broken = join(entries, "broken");
    const loopA = join(entries, "loop-a");
    const loopB = join(entries, "loop-b");
    const escapedLink = join(entries, "escaped");
    const preferredLink = join(entries, "preferred");
    const duplicateLink = join(entries, "duplicate");
    symlinkSync(join(approved, "missing"), broken);
    symlinkSync(loopB, loopA);
    symlinkSync(loopA, loopB);
    symlinkSync(escaped, escapedLink);
    symlinkSync(preferred, preferredLink);
    symlinkSync(duplicate, duplicateLink);
    const toolSet = recommendedToolFixture(join(base, "other-tools"));
    const outputParent = join(base, "Movies");
    const cacheParent = join(base, "Caches");
    mkdirSync(outputParent);
    mkdirSync(cacheParent);
    const candidates = (
      target: "ffmpeg" | "ffprobe" | "yt_dlp" | "whisper_cli",
    ) =>
      target === "ffmpeg"
        ? [broken, loopA, escapedLink, preferredLink, duplicateLink].map(
            (entrypoint) => ({ entrypoint, allowedCanonicalRoots: [approved] }),
          )
        : toolSet.candidates(target);
    const { service, repository } = fixture({
      runner: capableRunner(),
      recommendedRoots: () => ({
        outputRoot: join(outputParent, "Exports"),
        cacheRoot: join(cacheParent, "Cache"),
      }),
      recommendedToolCandidates: candidates,
    });

    await service.applyRecommendedSetup({
      displayName: "Whisper",
      byteSize: 4,
    });
    expect(
      repository.getTrustedActiveComponentReference("ffmpeg")?.absolutePath,
    ).toBe(preferred);
  });

  it("preserves prior tools and existing folder content when re-detection fails", async () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "desktop-preserve-")));
    directories.add(base);
    const { service, repository } = fixture({ runner: capableRunner() });
    const prior = executable(base, "prior-ffmpeg");
    await service.selectTool({ target: "ffmpeg", absolutePath: prior });
    const priorId = repository.getTrustedActiveComponentReference("ffmpeg")?.id;
    const outputRoot = join(base, "existing-output");
    const cacheRoot = join(base, "existing-cache");
    mkdirSync(outputRoot);
    mkdirSync(cacheRoot);
    writeFileSync(join(outputRoot, "keep.txt"), "preserve me");

    const missingCandidate = join(base, "missing-ffmpeg");
    const failing = new LocalDesktopSetupService(repository, {
      commandRunner: capableRunner(),
      recommendedRoots: () => ({ outputRoot, cacheRoot }),
      recommendedToolCandidates: () => [
        { entrypoint: missingCandidate, allowedCanonicalRoots: [base] },
      ],
      now,
    });
    await expect(
      failing.applyRecommendedSetup({ displayName: "Whisper", byteSize: 4 }),
    ).rejects.toMatchObject({ code: "invalid_tool" });
    expect(repository.getTrustedActiveComponentReference("ffmpeg")?.id).toBe(
      priorId,
    );
    expect(() =>
      writeFileSync(join(outputRoot, "keep.txt"), "still here"),
    ).not.toThrow();
  });

  it("keeps valid advanced roots and tools when completing missing recommended setup", async () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "desktop-mixed-")));
    directories.add(base);
    const customOutput = join(base, "custom-output");
    const customFfmpeg = executable(base, "custom-ffmpeg");
    mkdirSync(customOutput);
    const toolSet = recommendedToolFixture(join(base, "recommended-tools"));
    const { service, repository } = fixture({
      runner: capableRunner(),
      recommendedRoots: () => ({
        outputRoot: join(base, "recommended-output"),
        cacheRoot: join(base, "recommended-cache"),
      }),
      recommendedToolCandidates: toolSet.candidates,
    });
    await service.selectRoot({
      target: "output_root",
      absolutePath: customOutput,
    });
    await service.selectTool({
      target: "ffmpeg",
      absolutePath: customFfmpeg,
    });
    const outputId =
      repository.getTrustedActiveComponentReference("output_root")?.id;

    await service.applyRecommendedSetup({
      displayName: "Whisper",
      byteSize: 4,
    });

    expect(
      repository.getTrustedActiveComponentReference("output_root")?.id,
    ).toBe(outputId);
    expect(
      repository.getTrustedActiveComponentReference("ffmpeg")?.absolutePath,
    ).toBe(customFfmpeg);
    expect(
      repository.getTrustedActiveComponentReference("cache_root")?.absolutePath,
    ).toBe(join(base, "recommended-cache"));
  });

  it("rejects a canonical target replacement race and preserves the prior active reference", async () => {
    const { root, service, repository } = fixture({ runner: capableRunner() });
    const prior = executable(root, "ffmpeg-prior");
    await service.selectTool({ target: "ffmpeg", absolutePath: prior });
    const priorId = repository.getTrustedActiveComponentReference("ffmpeg")?.id;
    const replacement = executable(root, "ffmpeg-replacement");
    const base = capableRunner();
    let changed = false;
    const racing = new LocalDesktopSetupService(repository, {
      commandRunner: {
        run: vi.fn(async (path, args, options) => {
          const result = await base.run(path, args, options);
          if (!changed) {
            changed = true;
            writeFileSync(replacement, "#!/bin/sh\necho changed\n", {
              mode: 0o700,
            });
          }
          return result;
        }),
      },
      now,
    });

    await expect(
      racing.selectTool({ target: "ffmpeg", absolutePath: replacement }),
    ).rejects.toMatchObject({ code: "invalid_tool" });
    expect(repository.getTrustedActiveComponentReference("ffmpeg")?.id).toBe(
      priorId,
    );
  });

  it("keeps cache and output capacity evidence operation-specific", async () => {
    let output = "";
    let cache = "";
    const measuredOperationBytes = vi.fn(
      (target: "output_root" | "cache_root") =>
        target === "output_root"
          ? 3 * 1024 * 1024 * 1024
          : 1 * 1024 * 1024 * 1024,
    );
    const { root, service } = fixture({
      statfs: async (path) => ({
        bavail:
          path === output
            ? 4n * 1024n * 1024n
            : path === cache
              ? 32n * 1024n * 1024n
              : 0n,
        bsize: 1024n,
      }),
      measuredOperationBytes,
    });
    output = join(root, "output-volume");
    cache = join(root, "cache-volume");
    mkdirSync(output);
    mkdirSync(cache);
    await service.selectRoot({ target: "output_root", absolutePath: output });
    await service.selectRoot({ target: "cache_root", absolutePath: cache });

    const report = await service.getReadinessReport();
    expect(
      report.components.find(
        (component) => component.component === "output_storage",
      ),
    ).toMatchObject({ state: "blocked", reason: "storage_insufficient" });
    expect(
      report.components.find(
        (component) => component.component === "cache_storage",
      ),
    ).toMatchObject({ state: "ready", reason: "ready" });
    expect(
      report.operations.find(
        (operation) => operation.operation === "transcript_processing",
      )?.blockingComponents,
    ).not.toContain("output_storage");
    expect(
      report.operations.find(
        (operation) => operation.operation === "export_processing",
      )?.blockingComponents,
    ).toContain("output_storage");
    expect(measuredOperationBytes).toHaveBeenCalledWith("output_root");
    expect(measuredOperationBytes).toHaveBeenCalledWith("cache_root");
  });

  it("validates an exact writable root and keeps prior active state after an invalid replacement", async () => {
    const { root, service, repository } = fixture();
    const output = join(root, "output");
    const cache = join(root, "cache");
    writeFileSync(join(root, "placeholder"), "fixture");
    mkdirSync(output);
    mkdirSync(cache);

    await service.selectRoot({ target: "output_root", absolutePath: output });
    const previous =
      repository.getTrustedActiveComponentReference("output_root");
    const alias = join(root, "output-alias");
    symlinkSync(output, alias);
    await expect(
      service.selectRoot({ target: "output_root", absolutePath: alias }),
    ).rejects.toMatchObject({
      code: "invalid_path",
    });
    expect(
      repository.getTrustedActiveComponentReference("output_root")?.id,
    ).toBe(previous?.id);

    await service.selectRoot({ target: "cache_root", absolutePath: cache });
    expect(JSON.stringify(service.getSnapshot())).not.toContain(output);
    expect(JSON.stringify(service.getSnapshot())).not.toContain(cache);
    expect(service.getTrustedRuntimeConfig().outputRoot).toBe(output);
  });

  it("requires the fixed ffmpeg capability vocabulary and rejects malformed probe output", async () => {
    const { root, service, repository } = fixture({ runner: capableRunner() });
    const path = executable(root, "ffmpeg");
    await service.selectTool({ target: "ffmpeg", absolutePath: path });
    const previous = repository.getTrustedActiveComponentReference("ffmpeg");
    expect(previous?.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
    const malformed = fixture({
      runner: {
        run: vi.fn(async () => ({ stdout: "ffmpeg version 8\n", stderr: "" })),
      },
    });
    const second = executable(malformed.root, "ffmpeg");
    await expect(
      malformed.service.selectTool({ target: "ffmpeg", absolutePath: second }),
    ).rejects.toBeInstanceOf(DesktopSetupValidationError);
    expect(repository.getTrustedActiveComponentReference("ffmpeg")?.id).toBe(
      previous?.id,
    );
  });

  it("rejects empty, incompatible, and failed tool probes before recording candidates", async () => {
    const empty = fixture({
      runner: { run: vi.fn(async () => ({ stdout: "", stderr: "" })) },
    });
    await expect(
      empty.service.selectTool({
        target: "whisper_cli",
        absolutePath: executable(empty.root, "whisper-cli"),
      }),
    ).rejects.toMatchObject({ code: "tool_probe_failed" });
    expect(
      empty.repository.getTrustedActiveComponentReference("whisper_cli"),
    ).toBeUndefined();

    const incompatible = fixture({
      runner: {
        run: vi.fn(async () => ({
          stdout: JSON.stringify({ version: "8.1" }),
          stderr: "",
        })),
      },
    });
    await expect(
      incompatible.service.selectTool({
        target: "ffprobe",
        absolutePath: executable(incompatible.root, "ffprobe"),
      }),
    ).rejects.toMatchObject({ code: "tool_probe_failed" });
    expect(
      incompatible.repository.getTrustedActiveComponentReference("ffprobe"),
    ).toBeUndefined();

    const failed = fixture({
      runner: {
        run: vi.fn(async () => Promise.reject(new Error("probe failed"))),
      },
    });
    await expect(
      failed.service.selectTool({
        target: "yt_dlp",
        absolutePath: executable(failed.root, "yt-dlp"),
      }),
    ).rejects.toMatchObject({ code: "tool_probe_failed" });
    expect(
      failed.repository.getTrustedActiveComponentReference("yt_dlp"),
    ).toBeUndefined();
  });

  it("checks an exact model pin with no public path leak and detects post-activation changes", async () => {
    const { root, service } = fixture();
    const model = join(root, "model.bin");
    const bytes = Buffer.from("pinned whisper fixture");
    writeFileSync(model, bytes, { mode: 0o600 });
    const pin = {
      displayName: "Fixture Whisper",
      expectedBytes: bytes.length,
      expectedSha256: createHash("sha256").update(bytes).digest("hex"),
      version: "fixture-v1",
    };
    await service.activateWhisperModel({ absolutePath: model, pin });
    expect(JSON.stringify(service.getSnapshot())).not.toContain(model);
    writeFileSync(model, Buffer.from("changed whisper fixture"));
    const report = await service.getReadinessReport();
    expect(
      report.components.find(
        (component) => component.component === "whisper_model",
      ),
    ).toMatchObject({
      state: "needs_action",
      reason: "model_changed",
    });
  });

  it("persists every closed setup action and keeps local readiness explicitly non-global", async () => {
    const { service, repository } = fixture();
    const actions = [
      { action: "set_rights_acknowledgement", acknowledged: true },
      { action: "set_privacy_acknowledgement", acknowledged: true },
      { action: "set_worker_enabled", enabled: true },
      { action: "set_translation_consent", consented: true },
      { action: "set_caption_provider", provider: "yt_dlp" },
      { action: "set_media_provider", provider: "yt_dlp_audio" },
      { action: "set_export_source_provider", provider: "yt_dlp" },
      { action: "set_speech_to_text_provider", provider: "whisper_cpp" },
      { action: "set_translation_provider", provider: "aws_translate" },
    ] as const;
    for (const action of actions) service.updateSetup(action);
    expect(repository.getSetup()).toMatchObject({
      rightsAcknowledged: true,
      privacyAcknowledged: true,
      workerEnabled: true,
      translationConsent: true,
      captionProvider: "yt_dlp",
      mediaProvider: "yt_dlp_audio",
      exportSourceProvider: "yt_dlp",
      speechToTextProvider: "whisper_cpp",
      translationProvider: "aws_translate",
    });
    const report = await service.getReadinessReport();
    expect(
      report.components.find(
        (component) => component.component === "export_worker",
      ),
    ).toMatchObject({
      state: "needs_action",
      reason: "worker_unavailable",
    });
    expect(
      report.operations.find(
        (operation) => operation.operation === "project_browsing",
      ),
    ).toMatchObject({
      state: "blocked",
      blockingComponents: expect.arrayContaining([
        "authentication",
        "cloud_api",
      ]),
    });
  });

  it("reports the in-agent export scheduler without inventing a separate service", async () => {
    let available = false;
    const { service } = fixture({
      exportWorkerStatus: () => ({ available }),
    });
    service.updateSetup({ action: "set_worker_enabled", enabled: true });
    expect(
      (await service.getReadinessReport()).components.find(
        (component) => component.component === "export_worker",
      ),
    ).toMatchObject({ state: "needs_action", reason: "worker_unavailable" });

    available = true;
    expect(
      (await service.getReadinessReport()).components.find(
        (component) => component.component === "export_worker",
      ),
    ).toMatchObject({ state: "ready", reason: "ready" });

    available = false;
    const cloudFailure = fixture({
      exportWorkerStatus: () => ({
        available: false,
        issue: "cloud_unavailable",
      }),
    }).service;
    cloudFailure.updateSetup({ action: "set_worker_enabled", enabled: true });
    expect(
      (await cloudFailure.getReadinessReport()).components.find(
        (component) => component.component === "export_worker",
      ),
    ).toMatchObject({
      state: "blocked",
      reason: "cloud_unavailable",
      remediation: "retry",
    });
  });
});
