/**
 * Electron's safeStorage is kept behind async interfaces so this module can be
 * tested without Electron and callers cannot accidentally add a plaintext-file
 * fallback. The session-file implementation belongs to the trusted main
 * process and stores only this encrypted record.
 */
export interface AsyncSafeStorage {
  isEncryptionAvailable(): Promise<boolean>;
  encryptString(plaintext: string): Promise<Uint8Array>;
  decryptString(ciphertext: Uint8Array): Promise<string>;
}

export interface EncryptedRefreshTokenRecord {
  readonly schemaVersion: 1;
  readonly ciphertext: Uint8Array;
}

export interface EncryptedRefreshTokenFile {
  read(): Promise<EncryptedRefreshTokenRecord | undefined>;
  write(record: EncryptedRefreshTokenRecord): Promise<void>;
  remove(): Promise<void>;
}

export class ProtectedStorageError extends Error {
  readonly code = "protected_storage_unavailable";

  constructor() {
    super("Protected credential storage is unavailable. Please sign in again.");
  }
}

const MAX_REFRESH_TOKEN_LENGTH = 16_384;
const MAX_CIPHERTEXT_BYTES = 64 * 1_024;

/** Main-process-only refresh-token persistence with no plaintext fallback. */
export class EncryptedRefreshTokenStore {
  constructor(
    private readonly safeStorage: AsyncSafeStorage,
    private readonly file: EncryptedRefreshTokenFile,
  ) {}

  async save(refreshToken: string): Promise<void> {
    if (!isRefreshToken(refreshToken)) {
      throw new ProtectedStorageError();
    }
    if (!(await this.encryptionAvailable())) {
      await this.clearQuietly();
      throw new ProtectedStorageError();
    }

    let encrypted: Uint8Array | undefined;
    try {
      encrypted = await this.safeStorage.encryptString(refreshToken);
      if (
        !(encrypted instanceof Uint8Array) ||
        encrypted.byteLength === 0 ||
        encrypted.byteLength > MAX_CIPHERTEXT_BYTES
      ) {
        throw new ProtectedStorageError();
      }
      // The file gets a dedicated copy; the storage adapter must never receive
      // a reference to a mutable caller buffer.
      await this.file.write({
        schemaVersion: 1,
        ciphertext: new Uint8Array(encrypted),
      });
    } catch {
      await this.clearQuietly();
      throw new ProtectedStorageError();
    } finally {
      encrypted?.fill(0);
    }
  }

  /** Returns a decrypted token only to the trusted main-process broker. */
  async load(): Promise<string | undefined> {
    if (!(await this.encryptionAvailable())) {
      return undefined;
    }

    let record: EncryptedRefreshTokenRecord | undefined;
    try {
      record = await this.file.read();
    } catch {
      return undefined;
    }
    if (!record) {
      return undefined;
    }
    if (!isRecord(record)) {
      await this.clearQuietly();
      return undefined;
    }

    try {
      const plaintext = await this.safeStorage.decryptString(
        new Uint8Array(record.ciphertext),
      );
      if (!isRefreshToken(plaintext)) {
        throw new ProtectedStorageError();
      }
      return plaintext;
    } catch {
      await this.clearQuietly();
      return undefined;
    }
  }

  async clear(): Promise<void> {
    await this.clearQuietly();
  }

  private async encryptionAvailable(): Promise<boolean> {
    try {
      return (await this.safeStorage.isEncryptionAvailable()) === true;
    } catch {
      return false;
    }
  }

  private async clearQuietly(): Promise<void> {
    try {
      await this.file.remove();
    } catch {
      // Failure to remove a ciphertext is not a reason to expose a secret.
    }
  }
}

function isRecord(value: EncryptedRefreshTokenRecord): boolean {
  return (
    value.schemaVersion === 1 &&
    value.ciphertext instanceof Uint8Array &&
    value.ciphertext.byteLength > 0 &&
    value.ciphertext.byteLength <= MAX_CIPHERTEXT_BYTES
  );
}

function isRefreshToken(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_REFRESH_TOKEN_LENGTH &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
