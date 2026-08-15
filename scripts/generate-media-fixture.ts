import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const outputPath = resolve("tests/fixtures/media/synthetic-4s.mp4");
mkdirSync(dirname(outputPath), { recursive: true });

const result = spawnSync(
  "ffmpeg",
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x1b2430:s=640x360:r=30:d=4",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    "-y",
    outputPath,
  ],
  { stdio: "inherit" },
);

if (result.error) throw result.error;
if (result.status !== 0)
  throw new Error(`FFmpeg exited with status ${result.status ?? "unknown"}`);
process.stdout.write(`${outputPath}\n`);
