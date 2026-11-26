import { describe, expect, it, vi } from "vitest";

import {
  EncryptedRefreshTokenStore,
  ProtectedStorageError,
  type AsyncSafeStorage,
  type EncryptedRefreshTokenFile,
  type EncryptedRefreshTokenRecord,
} from "./refresh-token-store.ts";

function fixture(options: { available?: boolean } = {}) {
  let record: EncryptedRefreshTokenRecord | undefined;
  const safeStorage: AsyncSafeStorage = {
    isEncryptionAvailable: vi
      .fn<AsyncSafeStorage["isEncryptionAvailable"]>()
      .mockResolvedValue(options.available ?? true),
    encryptString: vi
      .fn<AsyncSafeStorage["encryptString"]>()
      .mockImplementation(async (plaintext) =>
        new TextEncoder().encode(`encrypted:${plaintext}`),
      ),
    decryptString: vi
      .fn<AsyncSafeStorage["decryptString"]>()
      .mockImplementation(async (ciphertext) => {
        const value = new TextDecoder().decode(ciphertext);
        if (!value.startsWith("encrypted:")) {
          throw new Error("invalid ciphertext");
        }
        return value.slice("encrypted:".length);
      }),
  };
  const file: EncryptedRefreshTokenFile = {
    read: vi.fn(async () => record),
    write: vi.fn(async (next) => {
      record = {
        schemaVersion: next.schemaVersion,
        ciphertext: new Uint8Array(next.ciphertext),
      };
    }),
    remove: vi.fn(async () => {
      record = undefined;
    }),
  };
  return {
    store: new EncryptedRefreshTokenStore(safeStorage, file),
    safeStorage,
    file,
    getRecord: () => record,
  };
}

describe("encrypted refresh-token store", () => {
  it("writes only a versioned ciphertext record and reloads through safeStorage", async () => {
    const { store, file, getRecord } = fixture();

    await store.save("refresh-token-value");

    expect(file.write).toHaveBeenCalledWith({
      schemaVersion: 1,
      ciphertext: expect.any(Uint8Array),
    });
    const record = getRecord();
    expect(record?.schemaVersion).toBe(1);
    expect(new TextDecoder().decode(record?.ciphertext)).not.toBe(
      "refresh-token-value",
    );
    await expect(store.load()).resolves.toBe("refresh-token-value");
  });

  it("fails closed and removes retained ciphertext when protection is unavailable on save", async () => {
    const { store, file } = fixture({ available: false });

    await expect(store.save("refresh-token-value")).rejects.toBeInstanceOf(
      ProtectedStorageError,
    );
    expect(file.write).not.toHaveBeenCalled();
    expect(file.remove).toHaveBeenCalledTimes(1);
    await expect(store.load()).resolves.toBeUndefined();
  });

  it("never returns corrupt or undecryptable storage and clears it", async () => {
    const { store, file, safeStorage } = fixture();
    await store.save("refresh-token-value");
    vi.mocked(safeStorage.decryptString).mockRejectedValueOnce(
      new Error("keychain unavailable"),
    );

    await expect(store.load()).resolves.toBeUndefined();
    expect(file.remove).toHaveBeenCalledTimes(1);
  });

  it("removes any partial write when encryption or file storage fails", async () => {
    const { store, file, safeStorage } = fixture();
    vi.mocked(safeStorage.encryptString).mockResolvedValueOnce(
      new Uint8Array(),
    );

    await expect(store.save("refresh-token-value")).rejects.toBeInstanceOf(
      ProtectedStorageError,
    );
    expect(file.remove).toHaveBeenCalledTimes(1);
  });
});
