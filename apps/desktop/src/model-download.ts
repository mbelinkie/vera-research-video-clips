import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { finished } from "node:stream/promises";

export type PinnedWhisperModel = Readonly<{
  name: string;
  url: string;
  byteSize: number;
  sha256: string;
}>;

export type ModelDownloadUpdate = Readonly<{
  bytesDownloaded: number;
  expectedBytes: number;
}>;

export type DownloadPinnedModelOptions = Readonly<{
  modelsDirectory: string;
  pin: PinnedWhisperModel;
  signal: AbortSignal;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  onProgress?(update: ModelDownloadUpdate): void;
}>;

export class ModelDownloadCanceledError extends Error {
  constructor() {
    super("Model download canceled.");
  }
}

/**
 * Downloads only a configured, checksum-pinned model to a private app-owned
 * staging file. It never accepts a renderer path and promotes only a fully
 * verified candidate, leaving any prior model version untouched.
 */
export async function downloadPinnedModel(
  options: DownloadPinnedModelOptions,
): Promise<string> {
  assertPin(options.pin);
  if (options.signal.aborted) throw new ModelDownloadCanceledError();
  const modelsDirectory = options.modelsDirectory;
  const stagingDirectory = join(modelsDirectory, ".staging");
  const destination = join(modelsDirectory, `${options.pin.sha256}.bin`);
  await mkdir(stagingDirectory, { recursive: true, mode: 0o700 });

  // A completed exact-hash model is immutable content-addressed state. A file
  // with the right length alone is never enough to reuse after a crash or a
  // hostile replacement.
  if (await hasExpectedModel(destination, options.pin)) {
    return destination;
  }

  const stagingPath = join(
    stagingDirectory,
    `${options.pin.sha256}.${randomBytes(16).toString("hex")}.part`,
  );
  try {
    const fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    const response = await fetchPinnedResponse(
      fetch,
      options.pin.url,
      options.signal,
    );
    if (!response.ok || !response.body) {
      throw new Error("Pinned model download is unavailable.");
    }
    const contentLength = response.headers.get("content-length");
    if (
      contentLength !== null &&
      (!/^\d+$/u.test(contentLength) ||
        Number(contentLength) !== options.pin.byteSize)
    ) {
      throw new Error("Pinned model download size is invalid.");
    }

    const output = createWriteStream(stagingPath, {
      flags: "wx",
      mode: 0o600,
    });
    const hash = createHash("sha256");
    let downloadedBytes = 0;
    try {
      const reader = response.body.getReader();
      for (;;) {
        if (options.signal.aborted) throw new ModelDownloadCanceledError();
        const next = await reader.read();
        if (next.done) break;
        const chunk = next.value;
        downloadedBytes += chunk.byteLength;
        if (downloadedBytes > options.pin.byteSize) {
          throw new Error("Pinned model download exceeds its configured size.");
        }
        hash.update(chunk);
        if (!output.write(chunk)) await onceDrain(output, options.signal);
        options.onProgress?.({
          bytesDownloaded: downloadedBytes,
          expectedBytes: options.pin.byteSize,
        });
      }
      output.end();
      await finished(output);
    } catch (error) {
      output.destroy();
      await finished(output).catch(() => undefined);
      throw error;
    }

    if (options.signal.aborted) throw new ModelDownloadCanceledError();
    if (
      downloadedBytes !== options.pin.byteSize ||
      hash.digest("hex") !== options.pin.sha256
    ) {
      throw new Error("Pinned model checksum verification failed.");
    }
    await mkdir(modelsDirectory, { recursive: true, mode: 0o700 });
    await rename(stagingPath, destination);
    return destination;
  } catch (error) {
    await rm(stagingPath, { force: true });
    if (
      options.signal.aborted &&
      !(error instanceof ModelDownloadCanceledError)
    ) {
      throw new ModelDownloadCanceledError();
    }
    throw error;
  }
}

const hasExpectedModel = async (path: string, pin: PinnedWhisperModel) => {
  try {
    const candidate = await stat(path);
    if (!candidate.isFile() || candidate.size !== pin.byteSize) return false;
    const hash = createHash("sha256");
    const input = createReadStream(path);
    input.on("data", (chunk: Buffer) => hash.update(chunk));
    await finished(input);
    return hash.digest("hex") === pin.sha256;
  } catch {
    return false;
  }
};

async function fetchPinnedResponse(
  fetch: (input: string, init?: RequestInit) => Promise<Response>,
  pinnedUrl: string,
  signal: AbortSignal,
): Promise<Response> {
  const origin = new URL(pinnedUrl);
  let current = origin;
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    const response = await fetch(current.href, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: { accept: "application/octet-stream" },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location || redirectCount === 5) {
      throw new Error("Pinned model redirect policy rejected the response.");
    }
    const next = new URL(location, current);
    if (!approvedModelRedirect(origin, next)) {
      throw new Error("Pinned model redirect policy rejected the response.");
    }
    current = next;
  }
  throw new Error("Pinned model redirect policy rejected the response.");
}

function approvedModelRedirect(origin: URL, candidate: URL): boolean {
  if (
    candidate.protocol !== "https:" ||
    candidate.username ||
    candidate.password
  ) {
    return false;
  }
  if (candidate.origin === origin.origin) return true;
  return (
    origin.hostname === "huggingface.co" &&
    (candidate.hostname === "huggingface.co" ||
      candidate.hostname.endsWith(".hf.co"))
  );
}

const onceDrain = (
  stream: ReturnType<typeof createWriteStream>,
  signal: AbortSignal,
) =>
  new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      stream.removeListener("drain", onDrain);
      stream.removeListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      cleanup();
      reject(new ModelDownloadCanceledError());
    };
    stream.once("drain", onDrain);
    stream.once("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
  });

const assertPin = (pin: PinnedWhisperModel) => {
  const url = new URL(pin.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !Number.isSafeInteger(pin.byteSize) ||
    pin.byteSize < 1 ||
    pin.byteSize > 100 * 1024 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/u.test(pin.sha256)
  ) {
    throw new RangeError("Pinned model configuration is invalid.");
  }
};
