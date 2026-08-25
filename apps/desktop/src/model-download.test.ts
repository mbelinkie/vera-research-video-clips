import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ModelDownloadCanceledError,
  downloadPinnedModel,
} from "./model-download.ts";

const directories = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...directories].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  directories.clear();
});

const pinFor = (contents: string) => ({
  name: "fixture model",
  url: "https://models.example.test/fixture.bin",
  byteSize: Buffer.byteLength(contents),
  sha256: createHash("sha256").update(contents).digest("hex"),
});

describe("pinned model download", () => {
  it("verifies a staged HTTPS response before atomically promoting it", async () => {
    const root = await mkdtemp(join(tmpdir(), "rvc-model-"));
    directories.add(root);
    const progress: number[] = [];
    const path = await downloadPinnedModel({
      modelsDirectory: join(root, "models"),
      pin: pinFor("model-data"),
      signal: new AbortController().signal,
      fetch: async () => new Response("model-data", { status: 200 }),
      onProgress: ({ bytesDownloaded }) => progress.push(bytesDownloaded),
    });
    await expect(readFile(path, "utf8")).resolves.toBe("model-data");
    expect(progress).toEqual([10]);
    await expect(readFile(join(root, "models", ".staging"))).rejects.toThrow();
  });

  it("preserves a previous model when the replacement fails checksum verification", async () => {
    const root = await mkdtemp(join(tmpdir(), "rvc-model-"));
    directories.add(root);
    const pin = pinFor("new-model");
    const destination = join(root, "models", `${pin.sha256}.bin`);
    await mkdir(join(root, "models"), { recursive: true });
    await writeFile(destination, "prior-model");
    await expect(
      downloadPinnedModel({
        modelsDirectory: join(root, "models"),
        pin,
        signal: new AbortController().signal,
        fetch: async () => new Response("wrong-dat", { status: 200 }),
      }),
    ).rejects.toThrow("checksum");
    await expect(readFile(destination, "utf8")).resolves.toBe("prior-model");
  });

  it("reuses only a pre-existing model whose bytes also match the configured hash", async () => {
    const root = await mkdtemp(join(tmpdir(), "rvc-model-"));
    directories.add(root);
    const pin = pinFor("model-data");
    const modelsDirectory = join(root, "models");
    const destination = join(modelsDirectory, `${pin.sha256}.bin`);
    await mkdir(modelsDirectory, { recursive: true });
    await writeFile(destination, "model-data");
    let called = false;
    await expect(
      downloadPinnedModel({
        modelsDirectory,
        pin,
        signal: new AbortController().signal,
        fetch: async () => {
          called = true;
          return new Response("model-data", { status: 200 });
        },
      }),
    ).resolves.toBe(destination);
    expect(called).toBe(false);
  });

  it("removes only the staged target when canceled", async () => {
    const root = await mkdtemp(join(tmpdir(), "rvc-model-"));
    directories.add(root);
    const controller = new AbortController();
    controller.abort();
    await expect(
      downloadPinnedModel({
        modelsDirectory: join(root, "models"),
        pin: pinFor("model-data"),
        signal: controller.signal,
        fetch: async () => new Response("model-data", { status: 200 }),
      }),
    ).rejects.toBeInstanceOf(ModelDownloadCanceledError);
  });

  it("cancels a partially written stream and leaves no staging file", async () => {
    const root = await mkdtemp(join(tmpdir(), "rvc-model-"));
    directories.add(root);
    const modelsDirectory = join(root, "models");
    const controller = new AbortController();
    await expect(
      downloadPinnedModel({
        modelsDirectory,
        pin: pinFor("abcdef"),
        signal: controller.signal,
        fetch: async () =>
          new Response(
            new ReadableStream({
              start(stream) {
                stream.enqueue(new TextEncoder().encode("abc"));
                stream.enqueue(new TextEncoder().encode("def"));
                stream.close();
              },
            }),
            { status: 200 },
          ),
        onProgress: () => controller.abort(),
      }),
    ).rejects.toBeInstanceOf(ModelDownloadCanceledError);
    await expect(readdir(join(modelsDirectory, ".staging"))).resolves.toEqual(
      [],
    );
  });

  it("cleans staging after a network stream interruption", async () => {
    const root = await mkdtemp(join(tmpdir(), "rvc-model-"));
    directories.add(root);
    const modelsDirectory = join(root, "models");
    await expect(
      downloadPinnedModel({
        modelsDirectory,
        pin: pinFor("abcdef"),
        signal: new AbortController().signal,
        fetch: async () =>
          new Response(
            new ReadableStream({
              start(stream) {
                stream.enqueue(new TextEncoder().encode("abc"));
                stream.error(new Error("fixture interruption"));
              },
            }),
            { status: 200 },
          ),
      }),
    ).rejects.toThrow("fixture interruption");
    await expect(readdir(join(modelsDirectory, ".staging"))).resolves.toEqual(
      [],
    );
  });

  it("allows only bounded HTTPS redirects for the immutable model host", async () => {
    const root = await mkdtemp(join(tmpdir(), "rvc-model-"));
    directories.add(root);
    const pin = {
      ...pinFor("model-data"),
      url: "https://huggingface.co/owner/repo/resolve/revision/model.bin",
    };
    const calls: string[] = [];
    await expect(
      downloadPinnedModel({
        modelsDirectory: join(root, "models"),
        pin,
        signal: new AbortController().signal,
        fetch: async (url) => {
          calls.push(url);
          return calls.length === 1
            ? new Response(undefined, {
                status: 302,
                headers: { location: "https://us.aws.cdn.hf.co/model" },
              })
            : new Response("model-data", { status: 200 });
        },
      }),
    ).resolves.toContain(pin.sha256);
    expect(calls).toHaveLength(2);
  });

  it("rejects cross-host, credentialed, and non-HTTPS model redirects", async () => {
    for (const location of [
      "https://attacker.example/model",
      "https://user:secret@huggingface.co/model",
      "http://huggingface.co/model",
    ]) {
      const root = await mkdtemp(join(tmpdir(), "rvc-model-"));
      directories.add(root);
      await expect(
        downloadPinnedModel({
          modelsDirectory: join(root, "models"),
          pin: {
            ...pinFor("model-data"),
            url: "https://huggingface.co/owner/repo/resolve/revision/model.bin",
          },
          signal: new AbortController().signal,
          fetch: async () =>
            new Response(undefined, { status: 302, headers: { location } }),
        }),
      ).rejects.toThrow("redirect policy");
    }
  });

  it("preserves a promotion collision and removes only its staging candidate", async () => {
    const root = await mkdtemp(join(tmpdir(), "rvc-model-"));
    directories.add(root);
    const pin = pinFor("model-data");
    const modelsDirectory = join(root, "models");
    const collision = join(modelsDirectory, `${pin.sha256}.bin`);
    await mkdir(collision, { recursive: true });
    await expect(
      downloadPinnedModel({
        modelsDirectory,
        pin,
        signal: new AbortController().signal,
        fetch: async () => new Response("model-data", { status: 200 }),
      }),
    ).rejects.toThrow();
    await expect(stat(collision)).resolves.toMatchObject({});
    expect((await stat(collision)).isDirectory()).toBe(true);
    await expect(readdir(join(modelsDirectory, ".staging"))).resolves.toEqual(
      [],
    );
  });
});
