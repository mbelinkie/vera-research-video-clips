import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { alignEnglishCaptions } from "@research-video/providers/alignment-local";
import { ProviderExecutionError } from "@research-video/providers";
import {
  WebVttNormalizationError,
  normalizeWebVttCaption,
} from "@research-video/transcript";

const usage =
  "Usage: npm run --silent align:captions -- --audio source.wav --captions captions.vtt --video-id VIDEO_ID [--auto] --confirm-rights";

try {
  const { values } = parseArgs({
    options: {
      audio: { type: "string" },
      captions: { type: "string" },
      "video-id": { type: "string" },
      auto: { type: "boolean" },
      "confirm-rights": { type: "boolean" },
    },
  });
  const videoId = values["video-id"];
  if (
    !values.audio ||
    !values.captions ||
    !videoId ||
    !/^[A-Za-z0-9_-]{11}$/u.test(videoId) ||
    !values["confirm-rights"]
  )
    throw new Error(usage);
  const transcript = await normalizeWebVttCaption({
    videoId,
    contents: await readFile(values.captions),
    language: "en",
    provider: "local-caption-file",
    source: values.auto ? "youtube-auto" : "youtube-manual",
  });
  const result = await alignEnglishCaptions(
    transcript,
    values.audio,
    process.env.VERA_WORD_TIMING_PATH ?? "vera-word-timing",
  );
  process.stdout.write(JSON.stringify(result) + "\n");
} catch (error) {
  const message =
    error instanceof ProviderExecutionError ||
    error instanceof WebVttNormalizationError
      ? error.message
      : error instanceof Error && error.message === usage
        ? usage
        : "Could not start alignment. Check the file paths and arguments.\n" +
          usage;
  process.stderr.write(message + "\n");
  process.exitCode = 1;
}
