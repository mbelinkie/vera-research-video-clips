import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";

/** Verify the alignment input and identify its actual PCM independently of WAV tags. */
export async function readAlignmentWave(path: string) {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const initial = await file.stat();
    if (!initial.isFile())
      throw new Error("Alignment WAV must be a regular file");
    const { size } = initial;
    async function read(position: number, length: number) {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await file.read(buffer, 0, length, position);
      if (bytesRead !== length) throw new Error("Incomplete alignment WAV");
      return buffer;
    }
    const riff = await read(0, 12);
    if (
      riff.toString("ascii", 0, 4) !== "RIFF" ||
      riff.toString("ascii", 8) !== "WAVE" ||
      riff.readUInt32LE(4) + 8 !== size
    ) {
      throw new Error("Invalid alignment WAV container");
    }
    let pcm: { start: number; end: number } | undefined;
    let format = false;
    for (let position = 12; position < size;) {
      const chunk = await read(position, 8);
      const id = chunk.toString("ascii", 0, 4);
      const length = chunk.readUInt32LE(4);
      const start = position + 8;
      const end = start + length;
      position = end + (length % 2);
      if (position > size) throw new Error("Invalid alignment WAV chunk");
      if (id === "fmt ") {
        if (format || length < 16)
          throw new Error("Invalid alignment WAV format");
        const header = await read(start, 16);
        format =
          header.readUInt16LE(0) === 1 &&
          header.readUInt16LE(2) === 1 &&
          header.readUInt32LE(4) === 16000 &&
          header.readUInt16LE(12) === 2 &&
          header.readUInt16LE(14) === 16;
        if (!format)
          throw new Error(
            "Alignment WAV must be mono 16 kHz signed 16-bit PCM",
          );
      } else if (id === "data") {
        if (pcm || length === 0 || length % 2 !== 0)
          throw new Error("Invalid alignment WAV samples");
        pcm = { start, end };
      }
    }
    if (!format || !pcm) throw new Error("Alignment WAV is missing PCM");
    const container = createHash("sha256");
    const samples = createHash("sha256");
    let position = 0;
    for await (const chunk of file.createReadStream({
      start: 0,
      autoClose: false,
    })) {
      const bytes = chunk as Buffer;
      container.update(bytes);
      const from = Math.max(pcm.start, position);
      const to = Math.min(pcm.end, position + bytes.length);
      if (from < to)
        samples.update(bytes.subarray(from - position, to - position));
      position += bytes.length;
    }
    const final = await file.stat();
    if (
      position !== size ||
      final.size !== size ||
      final.mtimeMs !== initial.mtimeMs ||
      final.ctimeMs !== initial.ctimeMs
    )
      throw new Error("Alignment WAV changed during verification");
    return {
      containerHash: `sha256:${container.digest("hex")}`,
      audio: {
        hash: `sha256:${samples.digest("hex")}`,
        sampleRate: 16000 as const,
        durationSamples: (pcm.end - pcm.start) / 2,
      },
    };
  } finally {
    await file.close();
  }
}
