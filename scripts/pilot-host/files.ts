/** Private env file, rotating logs and small JSON state for the Mac pilot (#53). */
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

/** Parses KEY=VALUE lines. Values are literal: no quotes, expansion or export. */
export function parseEnvFile(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [index, raw] of text.split(/\r?\n/u).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (!match?.[1] || match[2] === undefined)
      throw new Error(`Pilot env file line ${index + 1} is not KEY=VALUE`);
    if (match[1] in env)
      throw new Error(`Pilot env file repeats ${match[1]} (line ${index + 1})`);
    env[match[1]] = match[2];
  }
  return env;
}

/** Reads the env file only if it is a private regular file owned by this user. */
export async function readPrivateEnvFile(
  path: string,
): Promise<Record<string, string>> {
  if (!path.startsWith("/"))
    throw new Error("PILOT_ENV_FILE must be an absolute path");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      (info.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && info.uid !== process.getuid())
    )
      throw new Error(
        "Pilot env file must be a private file you own (chmod 600)",
      );
    return parseEnvFile(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}

export async function ensurePrivateDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw new Error(`${path} must be a private, non-symlink directory (0700)`);
}

/** Size-capped log: `name.log`, then `name.log.1` ... `name.log.<keep>`. */
export class RotatingLog {
  private size = -1;
  private queue: Promise<void> = Promise.resolve();
  constructor(
    private readonly path: string,
    private readonly maxBytes = 5 * 1024 * 1024,
    private readonly keep = 5,
  ) {}

  write(chunk: string | Buffer): Promise<void> {
    this.queue = this.queue.then(() => this.append(Buffer.from(chunk)));
    return this.queue;
  }

  private async append(bytes: Buffer): Promise<void> {
    if (this.size < 0) {
      try {
        this.size = (await stat(this.path)).size;
      } catch {
        this.size = 0;
      }
    }
    if (this.size > 0 && this.size + bytes.length > this.maxBytes) {
      await rm(`${this.path}.${this.keep}`, { force: true });
      for (let index = this.keep - 1; index >= 1; index--)
        await rename(
          `${this.path}.${index}`,
          `${this.path}.${index + 1}`,
        ).catch(() => undefined);
      await rename(this.path, `${this.path}.1`).catch(() => undefined);
      this.size = 0;
    }
    await writeFile(this.path, bytes, { flag: "a", mode: 0o600 });
    this.size += bytes.length;
  }
}

/** Atomic JSON state write (temp file + rename) so status never reads half a file. */
export async function writeState(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = join(dirname(path), `.${Date.now()}-${process.pid}.tmp`);
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, path);
}

export async function readState<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}
