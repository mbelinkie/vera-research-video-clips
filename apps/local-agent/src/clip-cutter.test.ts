import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ClipCandidateSchema,
  type ClipCandidate,
} from "@research-video/contracts";
import { hashMediaFile } from "@research-video/media";
import { normalizeTranscriptFixture } from "@research-video/transcript";
import { afterEach, describe, expect, it, vi } from "vitest";

import wordFixture from "../../../tests/fixtures/transcripts/english-word.json" with { type: "json" };
import bilingualFixture from "../../../tests/fixtures/transcripts/spanish-bilingual.json" with { type: "json" };

import {
  cutLoggedClips,
  type ClipCutterDependencies,
  type CutLoggedClipsRequest,
} from "./clip-cutter.ts";

const projectId = "019fbb95-cd76-7920-93fa-e23ba755e301";
const baseTranscript = normalizeTranscriptFixture(wordFixture);
const originalSpanish = normalizeTranscriptFixture(bilingualFixture.original);
const englishSpanish = normalizeTranscriptFixture(bilingualFixture.english);

function makeClip(
  id = randomUUID(),
  videoId = "M7lc1UVf-VE",
  language = "en",
): ClipCandidate {
  const spanish = language !== "en";
  const transcript = spanish ? originalSpanish : baseTranscript;
  return ClipCandidateSchema.parse({
    id,
    projectId,
    catalogVideoId: randomUUID(),
    video: {
      youtubeVideoId: videoId,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      title: "Authorized sample",
      sourceLanguage: language,
    },
    selection: {
      trackId: transcript.track.id,
      transcriptVersion: 1,
      firstSegmentId: transcript.segments[0]!.id,
      lastSegmentId: transcript.segments.at(-1)!.id,
      transcriptStartMs: 500,
      transcriptEndMs: 2_500,
      exportStartMs: 0,
      exportEndMs: 3_400,
      text: "authorized clip",
      timingPrecision: "word",
    },
    englishText: "authorized clip",
    notes: "",
    tags: [],
    researchStatus: "candidate",
    exportStatus: "not_requested",
    createdBy: randomUUID(),
    version: 1,
    createdAt: "2026-11-11T12:00:00.000Z",
    updatedAt: "2026-11-11T12:00:00.000Z",
  });
}

const tempRoots: string[] = [];
afterEach(async () => {
  for (const path of tempRoots.splice(0))
    await rm(path, { recursive: true, force: true });
});

async function fakeCutter(clips: ClipCandidate[]) {
  const root = await mkdtemp(join(tmpdir(), "logged-cut-"));
  tempRoots.push(root);
  const exportDirectory = join(root, "exports");
  const sources: string[] = [];
  const catalog = {
    getAuthorizedClip: vi.fn(async ({ clipId }: { clipId: string }) => {
      const clip = clips.find((candidate) => candidate.id === clipId);
      if (!clip) throw new Error("Not authorized to read the clip.");
      return clip;
    }),
  };
  const transcripts = {
    getVerifiedTracks: vi.fn(async ({ clip }: { clip: ClipCandidate }) => {
      const isForeign = clip.video.sourceLanguage === "es";
      return {
        english: {
          ...(isForeign ? englishSpanish : baseTranscript),
          track: {
            ...(isForeign ? englishSpanish.track : baseTranscript.track),
            videoId: clip.video.youtubeVideoId,
          },
        },
        ...(isForeign
          ? {
              original: {
                ...originalSpanish,
                track: {
                  ...originalSpanish.track,
                  videoId: clip.video.youtubeVideoId,
                },
              },
            }
          : {}),
        transcriptVersionId: "019fbb95-cd76-7920-93fa-e23ba755e399",
      };
    }),
  };
  const acquirer = {
    acquireAuthorizedVideo: vi.fn(
      async ({
        videoId,
        scratchDirectory,
      }: {
        videoId: string;
        scratchDirectory: string;
      }) => {
        sources.push(scratchDirectory);
        const scratchPath = join(scratchDirectory, `video-${videoId}.mp4`);
        await writeFile(scratchPath, "sample media");
        return {
          videoId,
          scratchPath,
          format: "mp4" as const,
          byteSize: 12,
          contentSha256: await hashMediaFile(scratchPath),
        };
      },
    ),
  };
  const renderer = {
    render: vi.fn(async ({ outputPath }: { outputPath: string }) => {
      await writeFile(outputPath, "rendered fixture");
    }),
  };
  const inspector = {
    inspect: vi.fn(async (path: string) =>
      path.includes(".stage-")
        ? { durationMs: 3_400, videoCodec: "h264", audioCodec: "aac" }
        : { durationMs: 10_000, videoCodec: "h264", audioCodec: "aac" },
    ),
  };
  const deps: ClipCutterDependencies = {
    catalog,
    transcripts,
    acquirer,
    renderer,
    inspector,
    exportDirectory,
  };
  const request: CutLoggedClipsRequest = {
    projectId,
    clipIds: clips.map((clip) => clip.id),
    authorization: "Bearer private-fixture",
    authorizationConfirmed: true,
  };
  return {
    root,
    exportDirectory,
    sources,
    deps,
    request,
    catalog,
    transcripts,
    acquirer,
    renderer,
    inspector,
  };
}

describe("foreground logged clip cutter", () => {
  it("pre-authorizes two same-video clips, fetches once, stages verified packages and deletes source", async () => {
    const a = makeClip(),
      b = makeClip();
    const f = await fakeCutter([a, b]);
    const result = await cutLoggedClips(f.request, f.deps);
    expect(f.catalog.getAuthorizedClip).toHaveBeenCalledTimes(2);
    expect(f.transcripts.getVerifiedTracks).toHaveBeenCalledTimes(2);
    expect(f.acquirer.acquireAuthorizedVideo).toHaveBeenCalledTimes(1);
    expect(f.renderer.render).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
    expect((await readdir(f.exportDirectory)).sort()).toEqual(
      [".locks", a.id, b.id].sort(),
    );
    for (const item of result) {
      const manifest = JSON.parse(await readFile(item.manifestPath, "utf8"));
      expect(manifest).toMatchObject({
        clipId: item.clipId,
        sourceVideoId: a.video.youtubeVideoId,
        exportStartMs: 0,
        exportEndMs: 3400,
        outputDurationMs: 3400,
      });
      expect(manifest.artifacts).toHaveLength(2);
      expect(item.subtitlePaths).toHaveLength(1);
      expect(await readFile(item.subtitlePaths[0]!, "utf8")).toContain(
        "00:00:03,400",
      );
      expect(JSON.stringify(manifest)).not.toContain(f.root);
      expect(JSON.stringify(manifest)).not.toContain("private-fixture");
    }
    expect(await readdir(f.root)).toEqual(["exports"]);
  });

  it("uses distinct acquisitions for different authorized sources", async () => {
    const f = await fakeCutter([
      makeClip(),
      makeClip(randomUUID(), "QXR6cL7eJB8"),
    ]);
    await cutLoggedClips(f.request, f.deps);
    expect(f.acquirer.acquireAuthorizedVideo).toHaveBeenCalledTimes(2);
    expect(new Set(f.sources).size).toBe(2);
    expect(
      (await readdir(f.exportDirectory)).filter((name) =>
        name.startsWith(".scratch"),
      ),
    ).toHaveLength(0);
  });

  it("refuses missing authentication, rights and repeated IDs before any source call", async () => {
    const f = await fakeCutter([makeClip()]);
    for (const change of [
      { authorization: "" },
      { authorizationConfirmed: false },
      { clipIds: [f.request.clipIds[0]!, f.request.clipIds[0]!] },
    ]) {
      await expect(
        cutLoggedClips(
          { ...f.request, ...change } as CutLoggedClipsRequest,
          f.deps,
        ),
      ).rejects.toThrow();
    }
    expect(f.catalog.getAuthorizedClip).not.toHaveBeenCalled();
    expect(f.acquirer.acquireAuthorizedVideo).not.toHaveBeenCalled();
  });

  it("preflights all clips and refuses forged catalog IDs or wrong track version", async () => {
    const f = await fakeCutter([makeClip(), makeClip()]);
    f.catalog.getAuthorizedClip.mockImplementationOnce(async () => makeClip());
    await expect(cutLoggedClips(f.request, f.deps)).rejects.toThrow(
      /identity/u,
    );
    expect(f.acquirer.acquireAuthorizedVideo).not.toHaveBeenCalled();
    const g = await fakeCutter([makeClip(), makeClip()]);
    g.transcripts.getVerifiedTracks.mockImplementationOnce(
      async ({ clip }) => ({
        english: {
          ...baseTranscript,
          track: {
            ...baseTranscript.track,
            videoId: clip.video.youtubeVideoId,
            version: 2,
          },
        },
        transcriptVersionId: randomUUID(),
      }),
    );
    await expect(cutLoggedClips(g.request, g.deps)).rejects.toThrow(
      /track and version/u,
    );
    expect(g.acquirer.acquireAuthorizedVideo).not.toHaveBeenCalled();
  });

  it("produces independently bounded Spanish and English subtitles", async () => {
    const f = await fakeCutter([makeClip(randomUUID(), "M7lc1UVf-VE", "es")]);
    const [result] = await cutLoggedClips(f.request, f.deps);
    expect(result!.subtitlePaths.map((path) => path.split("/").at(-1))).toEqual(
      [`${f.request.clipIds[0]}.en.srt`, `${f.request.clipIds[0]}.es.srt`],
    );
    expect(await readFile(result!.subtitlePaths[0]!, "utf8")).toContain(
      "This is a short example.",
    );
    expect(await readFile(result!.subtitlePaths[1]!, "utf8")).toContain(
      "Este es un ejemplo breve.",
    );
  });

  it("rejects ranges beyond the source and invalid rendered codecs", async () => {
    const f = await fakeCutter([makeClip()]);
    f.inspector.inspect.mockImplementationOnce(async () => ({
      durationMs: 500,
      videoCodec: "h264",
      audioCodec: "aac",
    }));
    await expect(cutLoggedClips(f.request, f.deps)).rejects.toThrow(/beyond/u);
    expect(f.renderer.render).not.toHaveBeenCalled();
    expect(
      (await readdir(f.exportDirectory)).filter((name) =>
        name.startsWith(".scratch"),
      ),
    ).toHaveLength(0);
    const g = await fakeCutter([makeClip()]);
    g.inspector.inspect.mockImplementation(async (path) =>
      path.includes(".stage-")
        ? { durationMs: 3_400, videoCodec: "hevc", audioCodec: "aac" }
        : { durationMs: 10_000, videoCodec: "h264", audioCodec: "aac" },
    );
    await expect(cutLoggedClips(g.request, g.deps)).rejects.toThrow(
      /verification/u,
    );
    expect(
      (await readdir(g.exportDirectory)).filter((name) =>
        name.startsWith(".stage-"),
      ),
    ).toHaveLength(0);
  });

  it("does not delete a shared source during sibling renders; failure removes scratch", async () => {
    const f = await fakeCutter([makeClip(), makeClip()]);
    f.renderer.render
      .mockImplementationOnce(async ({ outputPath }) => {
        expect(f.sources).toHaveLength(1);
        expect(await readdir(f.sources[0]!)).toHaveLength(1);
        await writeFile(outputPath, "good first output");
      })
      .mockImplementationOnce(async () => {
        expect(await readdir(f.sources[0]!)).toHaveLength(1);
        throw new Error("FFmpeg failed.");
      });
    await expect(cutLoggedClips(f.request, f.deps)).rejects.toThrow(
      /FFmpeg failed/u,
    );
    expect(
      (await readdir(f.exportDirectory)).filter((name) =>
        name.startsWith(".scratch"),
      ),
    ).toHaveLength(0);
    expect(
      (await readdir(f.exportDirectory)).filter((name) =>
        name.startsWith(".stage-"),
      ),
    ).toHaveLength(0);
    // Already verified/promoted sibling output is never erased by a later failure.
    expect(await readdir(f.exportDirectory)).toContain(f.request.clipIds[0]!);
  });

  it("cleanup failure is non-success even when render succeeded", async () => {
    const f = await fakeCutter([makeClip()]);
    f.deps.removeScratch = async () => {
      throw new Error("filesystem denied removal");
    };
    await expect(cutLoggedClips(f.request, f.deps)).rejects.toThrow(
      /cleanup failed/u,
    );
    expect(f.renderer.render).toHaveBeenCalledTimes(1);
    expect(
      (await readdir(f.exportDirectory)).filter((name) =>
        name.startsWith(".scratch"),
      ),
    ).toHaveLength(1);
  });

  it("refuses overwrite before acquisition, preserving the prior package", async () => {
    const f = await fakeCutter([makeClip()]);
    const first = await cutLoggedClips(f.request, f.deps);
    const original = await readFile(first[0]!.manifestPath, "utf8");
    await expect(cutLoggedClips(f.request, f.deps)).rejects.toThrow(
      /already exists/u,
    );
    expect(f.acquirer.acquireAuthorizedVideo).toHaveBeenCalledTimes(1);
    expect(await readFile(first[0]!.manifestPath, "utf8")).toBe(original);
  });
});
