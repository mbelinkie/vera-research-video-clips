import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadDesktopRuntimeConfiguration } from "./runtime-config.ts";
import { approvedWhisperModelPin } from "./release-config.ts";

const directories = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...directories].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  directories.clear();
});

describe("desktop runtime configuration", () => {
  it("keeps approved model setup available without cloud identity values", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rvc-desktop-config-"));
    directories.add(directory);
    await expect(
      loadDesktopRuntimeConfiguration(directory, {}),
    ).resolves.toEqual({ whisperModelPin: approvedWhisperModelPin });
  });

  it("loads only a strict HTTPS public-client configuration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rvc-desktop-config-"));
    directories.add(directory);
    await writeFile(
      join(directory, "desktop-config.json"),
      JSON.stringify({
        publicApiOrigin: "https://api.example.test",
        cognitoAuthority: "https://login.example.test",
        cognitoClientId: "public-client",
        whisperModelPin: approvedWhisperModelPin,
      }),
      { mode: 0o600 },
    );
    await expect(
      loadDesktopRuntimeConfiguration(directory, {}),
    ).resolves.toMatchObject({ cognitoClientId: "public-client" });
  });

  it("uses a bundled public-client configuration when no user override exists", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rvc-desktop-config-"));
    directories.add(directory);
    const bundledPath = join(directory, "bundled-desktop-config.json");
    await writeFile(
      bundledPath,
      JSON.stringify({
        publicApiOrigin: "https://api.example.test",
        cognitoAuthority: "https://login.example.test",
        cognitoClientId: "bundled-public-client",
        whisperModelPin: approvedWhisperModelPin,
      }),
      { mode: 0o600 },
    );

    await expect(
      loadDesktopRuntimeConfiguration(
        join(directory, "user-data"),
        {},
        bundledPath,
      ),
    ).resolves.toMatchObject({ cognitoClientId: "bundled-public-client" });
  });

  it("rejects a syntactically valid but unapproved model override", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rvc-desktop-config-"));
    directories.add(directory);
    await writeFile(
      join(directory, "desktop-config.json"),
      JSON.stringify({
        publicApiOrigin: "https://api.example.test",
        cognitoAuthority: "https://login.example.test",
        cognitoClientId: "public-client",
        whisperModelPin: {
          name: "fixture-model",
          url: "https://models.example.test/fixture.bin",
          byteSize: 4,
          sha256: "a".repeat(64),
        },
      }),
      { mode: 0o600 },
    );
    await expect(
      loadDesktopRuntimeConfiguration(directory, {}),
    ).resolves.toEqual({ whisperModelPin: approvedWhisperModelPin });
  });

  it("fails closed for a non-HTTPS model pin", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rvc-desktop-config-"));
    directories.add(directory);
    await writeFile(
      join(directory, "desktop-config.json"),
      JSON.stringify({
        publicApiOrigin: "https://api.example.test",
        cognitoAuthority: "https://login.example.test",
        cognitoClientId: "public-client",
        whisperModelPin: {
          name: "fixture-model",
          url: "http://models.example.test/fixture.bin",
          byteSize: 4,
          sha256: "a".repeat(64),
        },
      }),
      { mode: 0o600 },
    );
    await expect(
      loadDesktopRuntimeConfiguration(directory, {}),
    ).resolves.toEqual({ whisperModelPin: approvedWhisperModelPin });
  });

  it("fails closed for absent or partial model metadata in file configuration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rvc-desktop-config-"));
    directories.add(directory);
    const path = join(directory, "desktop-config.json");
    const cloud = {
      publicApiOrigin: "https://api.example.test",
      cognitoAuthority: "https://login.example.test",
      cognitoClientId: "public-client",
    };
    await writeFile(path, JSON.stringify(cloud), { mode: 0o600 });
    await expect(
      loadDesktopRuntimeConfiguration(directory, {}),
    ).resolves.toEqual({ whisperModelPin: approvedWhisperModelPin });
    await writeFile(
      path,
      JSON.stringify({
        ...cloud,
        whisperModelPin: { name: "partial", byteSize: 1 },
      }),
      { mode: 0o600 },
    );
    await expect(
      loadDesktopRuntimeConfiguration(directory, {}),
    ).resolves.toEqual({ whisperModelPin: approvedWhisperModelPin });
  });

  it("keeps the approved release model immutable, complete, and SHA-256 pinned", () => {
    expect(approvedWhisperModelPin).toEqual({
      name: "Whisper large-v3-turbo",
      url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo.bin",
      byteSize: 1_624_555_275,
      sha256:
        "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
    });
  });
});
