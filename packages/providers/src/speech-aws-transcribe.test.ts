import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";

import {
  AwsS3PrivateTranscriptionStorage,
  AwsTranscribeOperationPendingError,
  AwsTranscribeSpeechToTextProvider,
  DatabaseAwsTranscribeOperationStore,
  type AwsTranscribeOperationStore,
  InMemoryAwsTranscribeOperationStore,
  type AwsS3Sender,
  type AwsTranscribeSender,
} from "./speech-aws-transcribe.ts";

const successfulOutput = new TextEncoder().encode(
  JSON.stringify({
    results: {
      language_code: "es-US",
      items: [
        {
          type: "pronunciation",
          start_time: "0.10",
          end_time: "0.45",
          alternatives: [{ content: "Hola" }],
        },
        { type: "punctuation", alternatives: [{ content: "!" }] },
        {
          type: "pronunciation",
          start_time: "0.50",
          end_time: "0.90",
          alternatives: [{ content: "mundo" }],
        },
        { type: "punctuation", alternatives: [{ content: "." }] },
      ],
    },
  }),
);

async function withAudio(
  run: (inputPath: string) => Promise<void>,
  extension = "m4a",
) {
  const directory = await mkdtemp(join(tmpdir(), "aws-transcribe-provider-"));
  const inputPath = join(directory, `authorized-audio.${extension}`);
  await writeFile(inputPath, "authorized fixture audio");
  try {
    await run(inputPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function fixture(options?: {
  statuses?: AwsTranscribeSender["get"];
  output?: Uint8Array;
  deleteFailure?: boolean;
  operationStore?: AwsTranscribeOperationStore;
}) {
  const s3: AwsS3Sender = {
    put: vi.fn(async () => undefined),
    get: vi.fn(async () => options?.output ?? successfulOutput),
    delete: vi.fn(async () => {
      if (options?.deleteFailure) throw new Error("storage is unavailable");
    }),
  };
  const transcribe: AwsTranscribeSender = {
    start: vi.fn(async () => undefined),
    get:
      options?.statuses ??
      vi.fn(async () => ({ status: "completed" as const })),
    delete: vi.fn(async () => undefined),
  };
  const storage = new AwsS3PrivateTranscriptionStorage({
    bucket: "private-transcription-fixtures",
    sender: s3,
  });
  const provider = new AwsTranscribeSpeechToTextProvider({
    region: "us-east-1",
    storage,
    transcribeSender: transcribe,
    operationStore:
      options?.operationStore ?? new InMemoryAwsTranscribeOperationStore(),
    maxPollAttempts: 1,
    pollIntervalMs: 1,
  });
  return { provider, s3, transcribe };
}

describe("AwsTranscribeSpeechToTextProvider", () => {
  it("recovers provider-private operation state from PostgreSQL storage", async () => {
    const database = new PGlite();
    await database.exec(`
      CREATE TABLE amazon_transcribe_operations (
        id text PRIMARY KEY,
        job_name text NOT NULL UNIQUE,
        video_id text NOT NULL,
        language text,
        media_format text NOT NULL,
        input_bucket text NOT NULL,
        input_key text NOT NULL,
        output_bucket text NOT NULL,
        output_key text NOT NULL,
        state text NOT NULL,
        normalized_result jsonb,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      )
    `);
    const store = new DatabaseAwsTranscribeOperationStore(database);
    const seed = {
      id: "a".repeat(48),
      jobName: `research-video-transcribe-${"a".repeat(40)}`,
      videoId: "M7lc1UVf-VE",
      mediaFormat: "m4a" as const,
      input: { bucket: "private", key: "operation/input.m4a" },
      output: { bucket: "private", key: "operation/output.json" },
      state: "created" as const,
    };

    await expect(store.getOrCreate(seed)).resolves.toMatchObject({
      created: true,
      operation: seed,
    });
    await store.save({ ...seed, state: "running" });
    await expect(store.getOrCreate(seed)).resolves.toMatchObject({
      created: false,
      operation: { id: seed.id, state: "running" },
    });
    await database.close();
  });

  it("stages authorized local audio in job-scoped private storage and preserves canonical word timing", async () => {
    const { provider, s3, transcribe } = fixture();

    await withAudio(async (inputPath) => {
      const transcript = await provider.transcribe({
        videoId: "M7lc1UVf-VE",
        inputPath,
        language: "es-US",
      });

      expect(transcript).toMatchObject({
        track: {
          provider: "amazon-transcribe",
          model: "amazon-transcribe-standard",
          language: "es-US",
          timingPrecision: "word",
        },
        segments: [
          { startMs: 100, endMs: 450, text: "Hola!" },
          { startMs: 500, endMs: 900, text: "mundo." },
        ],
      });
      expect(transcript.tokens).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            text: "Hola!",
            startMs: 100,
            endMs: 450,
            timingConfidence: 1,
          }),
          expect.objectContaining({
            text: "mundo.",
            startMs: 500,
            endMs: 900,
            timingConfidence: 1,
          }),
        ]),
      );
    });

    expect(s3.put).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: "audio/m4a",
        key: expect.stringMatching(
          /^research-video-transcribe\/[a-f0-9]{48}\/input\.m4a$/u,
        ),
      }),
    );
    expect(transcribe.start).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaFileUri: expect.stringMatching(
          /^s3:\/\/private-transcription-fixtures\//u,
        ),
        outputBucket: "private-transcription-fixtures",
        outputKey: expect.stringMatching(
          /^research-video-transcribe\/[a-f0-9]{48}\/output\.json$/u,
        ),
        language: "es-US",
      }),
    );
    expect(s3.delete).toHaveBeenCalledTimes(2);
    expect(transcribe.delete).toHaveBeenCalledTimes(1);
  });

  it("resumes its deterministic operation without starting another paid job", async () => {
    const statuses = vi
      .fn<AwsTranscribeSender["get"]>()
      .mockResolvedValueOnce({ status: "running" })
      .mockResolvedValueOnce({ status: "completed" });
    const { provider, transcribe } = fixture({ statuses });

    await withAudio(async (inputPath) => {
      await expect(
        provider.transcribe({ videoId: "M7lc1UVf-VE", inputPath }),
      ).rejects.toBeInstanceOf(AwsTranscribeOperationPendingError);
      await expect(
        provider.transcribe({ videoId: "M7lc1UVf-VE", inputPath }),
      ).resolves.toMatchObject({ track: { provider: "amazon-transcribe" } });
    });

    expect(transcribe.start).toHaveBeenCalledTimes(1);
    expect(statuses).toHaveBeenCalledTimes(2);
  });

  it("recovers a pre-existing vendor job after a crash at the start boundary", async () => {
    const store: AwsTranscribeOperationStore = {
      getOrCreate: vi.fn(async (operation) => ({
        operation: { ...operation, state: "staged" as const },
        created: false,
      })),
      save: vi.fn(async () => undefined),
    };
    const { provider, s3, transcribe } = fixture({ operationStore: store });
    vi.mocked(transcribe.start).mockRejectedValueOnce({
      name: "ConflictException",
    });

    await withAudio(async (inputPath) => {
      await expect(
        provider.transcribe({ videoId: "M7lc1UVf-VE", inputPath }),
      ).resolves.toMatchObject({ track: { provider: "amazon-transcribe" } });
    });

    // Amazon already owns this deterministic name, so the conflict is read
    // back instead of creating a second paid job.  The staged input is also
    // not uploaded again during recovery.
    expect(transcribe.start).toHaveBeenCalledTimes(1);
    expect(transcribe.get).toHaveBeenCalledTimes(2);
    expect(s3.put).not.toHaveBeenCalled();
  });

  it("cleans input, output, and vendor job after a failed remote job and signals local fallback", async () => {
    const { provider, s3, transcribe } = fixture({
      statuses: vi.fn(async () => ({ status: "failed" as const })),
    });

    await withAudio(async (inputPath) => {
      await expect(
        provider.transcribe({ videoId: "M7lc1UVf-VE", inputPath }),
      ).rejects.toMatchObject({
        code: "provider_execution_failed",
        message: expect.stringContaining("configured local speech provider"),
      });
      await expect(
        provider.transcribe({ videoId: "M7lc1UVf-VE", inputPath }),
      ).rejects.toMatchObject({ code: "provider_execution_failed" });
    });

    expect(s3.get).not.toHaveBeenCalled();
    expect(s3.delete).toHaveBeenCalledTimes(2);
    expect(transcribe.delete).toHaveBeenCalledTimes(1);
    expect(transcribe.start).toHaveBeenCalledTimes(1);
  });

  it("keeps a completed result pending until terminal cleanup succeeds, without rerunning recognition", async () => {
    let failCleanup = true;
    const { provider, s3, transcribe } = fixture();
    vi.mocked(s3.delete).mockImplementation(async () => {
      if (failCleanup) throw new Error("temporary delete failure");
    });

    await withAudio(async (inputPath) => {
      await expect(
        provider.transcribe({ videoId: "M7lc1UVf-VE", inputPath }),
      ).rejects.toBeInstanceOf(AwsTranscribeOperationPendingError);
      failCleanup = false;
      await expect(
        provider.transcribe({ videoId: "M7lc1UVf-VE", inputPath }),
      ).resolves.toMatchObject({ track: { timingPrecision: "word" } });
    });

    expect(transcribe.start).toHaveBeenCalledTimes(1);
    expect(s3.get).toHaveBeenCalledTimes(1);
    expect(transcribe.delete).toHaveBeenCalledTimes(2);
  });

  it.each([
    "https://www.youtube.com/watch?v=M7lc1UVf-VE",
    "https://youtu.be/M7lc1UVf-VE",
    "s3://someone-else/audio.mp3",
    "file:///private/audio.mp3",
  ])(
    "rejects a remote or YouTube URL instead of sending it to Amazon: %s",
    async (inputPath) => {
      const { provider, s3, transcribe } = fixture();

      await expect(
        provider.transcribe({ videoId: "M7lc1UVf-VE", inputPath }),
      ).rejects.toMatchObject({ code: "provider_execution_failed" });
      expect(s3.put).not.toHaveBeenCalled();
      expect(transcribe.start).not.toHaveBeenCalled();
    },
  );
});
