/**
 * Authenticated, chunked encryption for off-laptop pilot backups (#53).
 *
 * Format `VERABK01` (all integers big-endian):
 *   header (40 bytes) = magic(8) | salt(16) | keyId(8) | chunkSize u32 | reserved u32 (0)
 *   records           = final u8 | length u32 | ciphertext(length) | GCM tag(16)
 *
 * Each file derives its own AES-256-GCM key with HKDF-SHA256(master, salt), so
 * the counter nonce (u64 index | u32 final flag) never repeats under one key.
 * The header is bound into every record as associated data. The final flag is
 * authenticated, and anything after the final record is rejected, so a
 * truncated, reordered, spliced or appended file fails to decrypt instead of
 * restoring partial data.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { constants } from "node:fs";
import { open, rename, rm, type FileHandle } from "node:fs/promises";

export const BACKUP_MAGIC = Buffer.from("VERABK01", "ascii");
const HEADER_BYTES = 40;
const TAG_BYTES = 16;
const DEFAULT_CHUNK = 1024 * 1024;
const MAX_CHUNK = 16 * 1024 * 1024;
export const MASTER_KEY_BYTES = 32;

export class BackupCryptoError extends Error {}

export function keyId(master: Buffer): Buffer {
  return createHash("sha256")
    .update("vera-research-backup-key-id-v1")
    .update(master)
    .digest()
    .subarray(0, 8);
}

function fileKey(master: Buffer, salt: Buffer): Buffer {
  if (master.length !== MASTER_KEY_BYTES)
    throw new BackupCryptoError("Backup key must be exactly 32 bytes");
  return Buffer.from(
    hkdfSync("sha256", master, salt, "vera-research-backup-v1", 32),
  );
}

function nonce(index: bigint, final: boolean): Buffer {
  const value = Buffer.alloc(12);
  value.writeBigUInt64BE(index, 0);
  value.writeUInt32BE(final ? 1 : 0, 8);
  return value;
}

async function readExactly(
  handle: FileHandle,
  length: number,
  position: number,
): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(
      buffer,
      filled,
      length - filled,
      position + filled,
    );
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return buffer.subarray(0, filled);
}

async function openNew(path: string): Promise<FileHandle> {
  return open(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
}

/**
 * Encrypts `source` into a brand-new `destination`. Writes to
 * `destination.partial` first and renames only after an fsync, so a crash
 * never leaves a complete-looking file.
 */
export async function encryptFile(
  source: string,
  destination: string,
  master: Buffer,
  chunkSize = DEFAULT_CHUNK,
): Promise<void> {
  if (chunkSize < 1 || chunkSize > MAX_CHUNK)
    throw new BackupCryptoError("Invalid chunk size");
  const salt = randomBytes(16);
  const key = fileKey(master, salt);
  const header = Buffer.alloc(HEADER_BYTES);
  BACKUP_MAGIC.copy(header, 0);
  salt.copy(header, 8);
  keyId(master).copy(header, 24);
  header.writeUInt32BE(chunkSize, 32);
  const partial = `${destination}.partial`;
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  let output: FileHandle | undefined;
  try {
    output = await openNew(partial);
    await output.write(header);
    let position = 0;
    let current = await readExactly(input, chunkSize, position);
    position += current.length;
    for (let index = 0n; ; index++) {
      const next =
        current.length === chunkSize
          ? await readExactly(input, chunkSize, position)
          : Buffer.alloc(0);
      position += next.length;
      const final = next.length === 0;
      const cipher = createCipheriv("aes-256-gcm", key, nonce(index, final));
      cipher.setAAD(header);
      const ciphertext = Buffer.concat([
        cipher.update(current),
        cipher.final(),
      ]);
      const record = Buffer.alloc(5);
      record.writeUInt8(final ? 1 : 0, 0);
      record.writeUInt32BE(ciphertext.length, 1);
      await output.write(
        Buffer.concat([record, ciphertext, cipher.getAuthTag()]),
      );
      if (final) break;
      current = next;
    }
    await output.sync();
    await output.close();
    output = undefined;
    await rename(partial, destination);
  } catch (error) {
    await output?.close().catch(() => undefined);
    await rm(partial, { force: true });
    throw error;
  } finally {
    await input.close();
  }
}

/**
 * Authenticates every record of `source`. With `destination`, also writes the
 * plaintext (to `destination.partial`, renamed only after full success).
 */
export async function decryptFile(
  source: string,
  master: Buffer,
  destination?: string,
): Promise<{ plaintextBytes: number }> {
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  const partial = destination ? `${destination}.partial` : undefined;
  let output: FileHandle | undefined;
  try {
    const header = await readExactly(input, HEADER_BYTES, 0);
    if (
      header.length !== HEADER_BYTES ||
      !header.subarray(0, 8).equals(BACKUP_MAGIC) ||
      header.readUInt32BE(36) !== 0
    )
      throw new BackupCryptoError("Not a VERA Research encrypted backup");
    if (!timingSafeEqual(header.subarray(24, 32), keyId(master)))
      throw new BackupCryptoError(
        "This backup was encrypted with a different backup key",
      );
    const chunkSize = header.readUInt32BE(32);
    if (chunkSize < 1 || chunkSize > MAX_CHUNK)
      throw new BackupCryptoError("Corrupt backup header");
    const key = fileKey(master, header.subarray(8, 24));
    if (partial) output = await openNew(partial);
    let position = HEADER_BYTES;
    let plaintextBytes = 0;
    for (let index = 0n; ; index++) {
      const record = await readExactly(input, 5, position);
      if (record.length !== 5)
        throw new BackupCryptoError("Backup is truncated");
      const flag = record.readUInt8(0);
      const length = record.readUInt32BE(1);
      if (flag > 1 || length > chunkSize)
        throw new BackupCryptoError("Corrupt backup record");
      const body = await readExactly(input, length + TAG_BYTES, position + 5);
      if (body.length !== length + TAG_BYTES)
        throw new BackupCryptoError("Backup is truncated");
      position += 5 + body.length;
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        nonce(index, flag === 1),
      );
      decipher.setAAD(header);
      decipher.setAuthTag(body.subarray(length));
      let plaintext: Buffer;
      try {
        plaintext = Buffer.concat([
          decipher.update(body.subarray(0, length)),
          decipher.final(),
        ]);
      } catch {
        throw new BackupCryptoError(
          "Backup failed its integrity check (corrupted or tampered)",
        );
      }
      plaintextBytes += plaintext.length;
      if (output) await output.write(plaintext);
      if (flag === 1) break;
    }
    if ((await readExactly(input, 1, position)).length !== 0)
      throw new BackupCryptoError("Unexpected data after the final record");
    if (output && partial && destination) {
      await output.sync();
      await output.close();
      output = undefined;
      await rename(partial, destination);
    }
    return { plaintextBytes };
  } catch (error) {
    await output?.close().catch(() => undefined);
    if (partial) await rm(partial, { force: true });
    throw error;
  } finally {
    await input.close();
  }
}

/** Creates a new private key file; never overwrites an existing key. */
export async function createKeyFile(path: string): Promise<void> {
  const handle = await openNew(path);
  try {
    await handle.writeFile(
      `${randomBytes(MASTER_KEY_BYTES).toString("base64")}\n`,
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Reads a private (0600, non-symlink, owned) base64 key file. */
export async function readKeyFile(path: string): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      (info.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && info.uid !== process.getuid())
    )
      throw new BackupCryptoError(
        "Backup key must be a private file you own (chmod 600)",
      );
    const text = (await handle.readFile("utf8")).trim();
    const key = Buffer.from(text, "base64");
    if (key.length !== MASTER_KEY_BYTES || key.toString("base64") !== text)
      throw new BackupCryptoError("Backup key file is not a valid key");
    return key;
  } finally {
    await handle.close();
  }
}
