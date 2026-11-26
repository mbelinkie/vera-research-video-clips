import { access, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  normalizeGeneratedTranscript,
  normalizeWebVttCaption,
} from "@research-video/transcript";
import { describe, expect, it } from "vitest";

import {
  alignEnglishCaptions,
  alignLocalRecognition,
} from "./alignment-local.ts";
import type { CommandRunner } from "./captions-local.ts";

const hash = (digit: string) => `sha256:${digit.repeat(64)}`;
const audio = { hash: hash("a"), sampleRate: 16_000, durationSamples: 160_000 };
const alignmentIdentity = {
  recognitionArtifactId: hash("b"),
  audio,
  aligner: {
    name: "montreal-forced-aligner",
    version: "3.4.3",
    acousticModel: "english_us_arpa",
    parametersHash: hash("d"),
  },
};

async function captions() {
  return normalizeWebVttCaption({
    contents: [
      "WEBVTT",
      "",
      "00:00:01.000 --> 00:00:04.000",
      "Today<00:00:02.000><c> 1998</c><00:00:02.900><c> returns</c>",
      "",
      "00:00:05.000 --> 00:00:06.000",
      "[audience applause]",
      "",
      "00:00:07.000 --> 00:00:08.000",
      "Hello",
    ].join("\n"),
    videoId: "fixture0001",
    language: "en",
    source: "youtube-auto",
    provider: "fixture",
  });
}

function mockCli(
  words: unknown[],
  identity = alignmentIdentity,
  recognitionDisplays = [
    "Today",
    "1998",
    "returns",
    "[audience applause]",
    "Hello",
  ],
  usePython = false,
) {
  const calls: string[] = [];
  let scratch = "";
  let handoff: unknown;
  const runner: CommandRunner = {
    async run(executable, args) {
      expect(executable).toBe(
        usePython ? "word-timing-python" : "vera-word-timing",
      );
      const arg = (name: string) => args[args.indexOf(name) + 1]!;
      const out = arg("--out");
      scratch = dirname(out);
      const operation = args.includes("--input")
        ? "recognise-generated"
        : args[usePython ? 2 : 0]!;
      calls.push(operation);
      if (operation !== "align") {
        if (usePython) expect(args[0]).toMatch(/word-timing-recognition\.py$/u);
        else expect(arg("--engine")).toBe("youtube");
        handoff = JSON.parse(
          await readFile(arg(usePython ? "--input" : "--captions"), "utf8"),
        );
        await writeFile(
          out,
          JSON.stringify({
            schemaVersion: "recognition-artifact/v1",
            artifactId: hash("b"),
            identity: { audio },
            tokens: recognitionDisplays.map((display, index) => ({
              index,
              display,
              kind: display.startsWith("[") ? "event" : "word",
            })),
          }),
        );
      } else {
        if (usePython)
          expect(args.slice(0, 2)).toEqual(["-m", "vera_word_timing.cli"]);
        await access(arg("--recognition"));
        await writeFile(
          out,
          JSON.stringify({
            schemaVersion: "alignment-artifact/v1",
            artifactId: hash("c"),
            identity,
            words,
          }),
        );
      }
      return { stdout: "", stderr: "" };
    },
  };
  return {
    runner,
    calls,
    assertCleaned: () =>
      expect(access(scratch)).rejects.toMatchObject({ code: "ENOENT" }),
    handoff: () => handoff,
  };
}

const acoustic = (
  tokenIndex: number,
  sub: number,
  startMs: number,
  endMs: number,
) => ({
  tokenIndex,
  sub,
  status: "acoustic",
  startMs,
  endMs,
});

describe("local recognition word alignment", () => {
  it("passes through the existing recognizer and its segment anchors", async () => {
    const transcript = await normalizeGeneratedTranscript({
      videoId: "fixture0001",
      language: "en-US",
      provider: "whisper.cpp",
      model: "small.en",
      segments: [
        { text: "Generated words", startMs: 1_000, endMs: 3_000 },
        { text: "remain", startMs: 4_000, endMs: 5_000 },
      ],
    });
    const cli = mockCli(
      [acoustic(0, 0, 1_050, 1_400), acoustic(1, 0, 2_100, 2_280)],
      alignmentIdentity,
      ["Generated", "words", "remain"],
      true,
    );
    const result = await alignLocalRecognition(
      transcript,
      "local.wav",
      "word-timing-python",
      cli.runner,
    );
    expect(cli.calls).toEqual(["recognise-generated", "align"]);
    expect(cli.handoff()).toEqual({
      language: "en-us",
      provider: "whisper.cpp",
      model: "small.en",
      tokens: [
        { display: "Generated", startMs: 1_000, endMs: 3_000 },
        { display: "words", startMs: 1_000, endMs: 3_000 },
        { display: "remain", startMs: 4_000, endMs: 5_000 },
      ],
    });
    expect(result.tokens).toMatchObject([
      { tokenId: transcript.tokens[0]!.id, status: "acoustic" },
      { tokenId: transcript.tokens[1]!.id, status: "acoustic" },
      {
        tokenId: transcript.tokens[2]!.id,
        status: "unaligned",
        startMs: null,
        endMs: null,
      },
    ]);
    await cli.assertCleaned();
  });
});

describe("local caption word alignment", () => {
  it("keeps caption anchors separate from acoustic timing and marks missing and partial words", async () => {
    const transcript = await captions();
    const cli = mockCli([
      acoustic(0, 0, 1_250, 1_700),
      acoustic(1, 0, 1_950, 2_100),
      {
        tokenIndex: 1,
        sub: 1,
        status: "unaligned",
        startMs: null,
        endMs: null,
      },
      acoustic(2, 0, 2_650, 3_000),
      acoustic(2, 1, 3_010, 3_150),
    ]);
    const result = await alignEnglishCaptions(
      transcript,
      "local.wav",
      "vera-word-timing",
      cli.runner,
    );
    expect(cli.calls).toEqual(["recognise", "align"]);
    expect(cli.handoff()).toEqual({
      events: [
        { tStartMs: 1_000, dDurationMs: 500, segs: [{ utf8: "Today" }] },
        { tStartMs: 2_000, dDurationMs: 500, segs: [{ utf8: "1998" }] },
        { tStartMs: 2_900, dDurationMs: 500, segs: [{ utf8: "returns" }] },
        {
          tStartMs: 5_000,
          dDurationMs: 1_000,
          segs: [{ utf8: "[audience applause]" }],
        },
        { tStartMs: 7_000, dDurationMs: 1_000, segs: [{ utf8: "Hello" }] },
      ],
    });
    expect(result.audioSeconds).toBe(10);
    expect(result.tokens).toEqual(
      transcript.tokens.map((token, index) => ({
        tokenId: token.id,
        status: index === 0 || index === 2 ? "acoustic" : "unaligned",
        startMs: [1_250, null, 2_650][index] ?? null,
        endMs: [1_700, null, 3_150][index] ?? null,
      })),
    );
    await cli.assertCleaned();
  });

  it.each([
    [
      "an unrelated recognition artifact",
      [],
      { ...alignmentIdentity, recognitionArtifactId: hash("e") },
    ],
    [
      "an out-of-source time",
      [acoustic(0, 0, 9_990, 10_010)],
      alignmentIdentity,
    ],
    [
      "a duplicate unit",
      [acoustic(0, 0, 1_250, 1_700), acoustic(0, 0, 1_800, 1_900)],
      alignmentIdentity,
    ],
    ["a non-speech unit", [acoustic(3, 0, 5_100, 5_300)], alignmentIdentity],
    [
      "reversed word timing",
      [acoustic(0, 0, 2_100, 2_400), acoustic(1, 0, 1_400, 1_900)],
      alignmentIdentity,
    ],
    [
      "an unaligned unit with invented bounds",
      [{ ...acoustic(0, 0, 1_250, 1_700), status: "unaligned" }],
      alignmentIdentity,
    ],
    [
      "out-of-source interpolation",
      [{ ...acoustic(0, 0, 9_990, 10_010), status: "interpolated" }],
      alignmentIdentity,
    ],
  ] as const)(
    "rejects %s and cleans scratch",
    async (_description, words, identity) => {
      const cli = mockCli([...words], identity);
      await expect(
        alignEnglishCaptions(
          await captions(),
          "local.wav",
          "vera-word-timing",
          cli.runner,
        ),
      ).rejects.toThrow("invalid or mismatched artifact");
      await cli.assertCleaned();
    },
  );

  it("rejects reordered caption text before invoking the aligner", async () => {
    const cli = mockCli([], alignmentIdentity, [
      "1998",
      "Today",
      "returns",
      "[audience applause]",
      "Hello",
    ]);
    await expect(
      alignEnglishCaptions(
        await captions(),
        "local.wav",
        "vera-word-timing",
        cli.runner,
      ),
    ).rejects.toThrow("invalid or mismatched artifact");
    expect(cli.calls).toEqual(["recognise"]);
    await cli.assertCleaned();
  });
});
