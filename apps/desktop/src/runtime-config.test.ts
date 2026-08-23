import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadDesktopRuntimeConfiguration } from "./runtime-config.ts";

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
  it("fails closed when no approved cloud identity values exist", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rvc-desktop-config-"));
    directories.add(directory);
    await expect(
      loadDesktopRuntimeConfiguration(directory, {}),
    ).resolves.toBeUndefined();
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
      }),
      { mode: 0o600 },
    );
    await expect(
      loadDesktopRuntimeConfiguration(directory, {}),
    ).resolves.toMatchObject({ cognitoClientId: "public-client" });
  });
});
