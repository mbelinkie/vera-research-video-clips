import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const fixtures = [
  {
    output: "tests/fixtures/media/synthetic-4s.mp4",
    color: "0x1b2430",
    frequency: "440",
    durationSeconds: "4",
  },
  {
    output: "tests/fixtures/media/synthetic-32s.mp4",
    color: "0x2b183f",
    frequency: "523.25",
    durationSeconds: "32",
  },
] as const;

for (const fixture of fixtures) {
  const outputPath = resolve(fixture.output);
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
      `color=c=${fixture.color}:s=640x360:r=30:d=${fixture.durationSeconds}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${fixture.frequency}:sample_rate=48000:duration=${fixture.durationSeconds}`,
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
}
