import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { safeStorage, shell } from "electron";

import type {
  AsyncSafeStorage,
  EncryptedRefreshTokenFile,
  EncryptedRefreshTokenRecord,
} from "./auth/refresh-token-store.ts";

export const electronSafeStorage: AsyncSafeStorage = {
  isEncryptionAvailable: async () => safeStorage.isEncryptionAvailable(),
  encryptString: async (plaintext) =>
    new Uint8Array(await safeStorage.encryptStringAsync(plaintext)),
  decryptString: async (ciphertext) =>
    (await safeStorage.decryptStringAsync(Buffer.from(ciphertext))).result,
};

export class MainProcessRefreshTokenFile implements EncryptedRefreshTokenFile {
  readonly #path: string;
  readonly #temporaryPath: string;

  constructor(userDataDirectory: string) {
    this.#path = join(userDataDirectory, "protected-session.json");
    this.#temporaryPath = join(userDataDirectory, ".protected-session.tmp");
  }

  async read(): Promise<EncryptedRefreshTokenRecord | undefined> {
    try {
      const value = JSON.parse(await readFile(this.#path, "utf8")) as {
        schemaVersion?: unknown;
        ciphertext?: unknown;
      };
      if (
        value.schemaVersion !== 1 ||
        typeof value.ciphertext !== "string" ||
        value.ciphertext.length === 0 ||
        value.ciphertext.length > 128 * 1_024
      ) {
        return undefined;
      }
      return {
        schemaVersion: 1,
        ciphertext: new Uint8Array(Buffer.from(value.ciphertext, "base64")),
      };
    } catch {
      return undefined;
    }
  }

  async write(record: EncryptedRefreshTokenRecord): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
    await writeFile(
      this.#temporaryPath,
      JSON.stringify({
        schemaVersion: 1,
        ciphertext: Buffer.from(record.ciphertext).toString("base64"),
      }),
      { encoding: "utf8", mode: 0o600 },
    );
    await rename(this.#temporaryPath, this.#path);
  }

  async remove(): Promise<void> {
    await Promise.all([
      rm(this.#path, { force: true }),
      rm(this.#temporaryPath, { force: true }),
    ]);
  }
}

export const managedLoginBrowser = {
  async open(url: URL): Promise<void> {
    if (url.protocol !== "https:") {
      throw new Error("Managed login must use HTTPS.");
    }
    await shell.openExternal(url.href);
  },
};
