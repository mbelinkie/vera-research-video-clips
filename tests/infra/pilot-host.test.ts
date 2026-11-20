import { randomBytes } from "node:crypto";
import {
  chmod,
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
  BackupCryptoError,
  createKeyFile,
  decryptFile,
  encryptFile,
  readKeyFile,
} from "../../scripts/pilot-host/backup-crypto.ts";
import {
  parseEnvFile,
  readPrivateEnvFile,
  RotatingLog,
  writeState,
} from "../../scripts/pilot-host/files.ts";
import { renderPlist } from "../../scripts/pilot-host/launchd.ts";
import {
  clearStaleBackupGate,
  collectStatus,
  ownerStillRunning,
  processStartMs,
  destinationKind,
  formatStatus,
  hostSettings,
} from "../../scripts/pilot-host/operations.ts";
import {
  backupName,
  backupsToPrune,
  parseBackupName,
} from "../../scripts/pilot-host/retention.ts";
import { renderTunnelConfig } from "../../scripts/pilot-host/tunnel.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const newRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "vera53-host-"));
  roots.push(root);
  return root;
};

describe("encrypted backup files", () => {
  const key = randomBytes(32);
  const roundTrip = async (size: number, chunk = 64) => {
    const root = await newRoot();
    const plain = randomBytes(size);
    await writeFile(join(root, "in"), plain);
    await encryptFile(join(root, "in"), join(root, "enc"), key, chunk);
    expect(await readdir(root)).not.toContain("enc.partial");
    const encrypted = await readFile(join(root, "enc"));
    if (size >= 16)
      expect(encrypted.includes(plain.subarray(0, 16))).toBe(false);
    await decryptFile(join(root, "enc"), key, join(root, "out"));
    expect((await readFile(join(root, "out"))).equals(plain)).toBe(true);
    expect((await stat(join(root, "enc"))).mode & 0o777).toBe(0o600);
    return { root, encrypted };
  };

  it("round-trips empty, partial, exact-multiple and multi-chunk files", async () => {
    for (const size of [0, 1, 63, 64, 128, 1000]) await roundTrip(size);
  });

  it("detects tampering, truncation, appended data, reordering and the wrong key", async () => {
    const { root, encrypted } = await roundTrip(300);
    const attempt = async (bytes: Buffer, withKey = key) => {
      const path = join(root, `bad-${randomBytes(4).toString("hex")}`);
      await writeFile(path, bytes);
      const out = `${path}.out`;
      await expect(decryptFile(path, withKey, out)).rejects.toBeInstanceOf(
        BackupCryptoError,
      );
      // Nothing restorable is left behind after a failed decrypt.
      await expect(stat(out)).rejects.toThrow();
      await expect(stat(`${out}.partial`)).rejects.toThrow();
    };
    const flipped = Buffer.from(encrypted);
    flipped[60] = (flipped[60] ?? 0) ^ 1;
    await attempt(flipped);
    await attempt(encrypted.subarray(0, encrypted.length - 1));
    // Drop the whole final record: earlier records alone are not a backup.
    const recordBytes = 5 + 64 + 16;
    await attempt(encrypted.subarray(0, 40 + recordBytes * 4));
    await attempt(Buffer.concat([encrypted, Buffer.from([0])]));
    const swapped = Buffer.concat([
      encrypted.subarray(0, 40),
      encrypted.subarray(40 + recordBytes, 40 + 2 * recordBytes),
      encrypted.subarray(40, 40 + recordBytes),
      encrypted.subarray(40 + 2 * recordBytes),
    ]);
    await attempt(swapped);
    const headerEdit = Buffer.from(encrypted);
    headerEdit[10] = (headerEdit[10] ?? 0) ^ 1; // salt
    await attempt(headerEdit);
    await expect(
      decryptFile(join(root, "enc"), randomBytes(32)),
    ).rejects.toThrow("different backup key");
    await attempt(Buffer.from("not a backup at all, definitely not"));
  });

  it("never overwrites an existing backup or key", async () => {
    const root = await newRoot();
    await writeFile(join(root, "in"), "x");
    await writeFile(join(root, "enc.partial"), "someone else's");
    await expect(
      encryptFile(join(root, "in"), join(root, "enc"), key),
    ).rejects.toThrow();
    // A finished file with the target name is never replaced either.
    await writeFile(join(root, "done"), "existing verified backup");
    await expect(
      encryptFile(join(root, "in"), join(root, "done"), key),
    ).rejects.toThrow("Refusing to replace");
    expect(await readFile(join(root, "done"), "utf8")).toBe(
      "existing verified backup",
    );
    expect(await readdir(root)).not.toContain("done.partial");
    await createKeyFile(join(root, "key"));
    await expect(createKeyFile(join(root, "key"))).rejects.toThrow();
    expect((await readKeyFile(join(root, "key"))).length).toBe(32);
    await chmod(join(root, "key"), 0o644);
    await expect(readKeyFile(join(root, "key"))).rejects.toThrow("chmod 600");
  });
});

describe("backup retention", () => {
  it("names backups sortably and parses only exact names", () => {
    const name = backupName(new Date("2026-11-20T03:15:07.123Z"), "0a1b2c3d");
    expect(name).toBe("vera-research-20261120T031507Z-0a1b2c3d.verabk");
    // Two backups in the same second get different names.
    const at = new Date("2026-11-20T03:15:07Z");
    expect(backupName(at)).not.toBe(backupName(at));
    expect(parseBackupName(name)?.toISOString()).toBe(
      "2026-11-20T03:15:07.000Z",
    );
    for (const bad of [
      `${name}.partial`,
      "vera-research-20261340T031507Z-0a1b2c3d.verabk",
      "vera-research-20261120T031507Z.verabk",
      "vera-research-20261120T031507Z-0A1B2C3D.verabk",
      "notes.txt",
      "../vera-research-20261120T031507Z-0a1b2c3d.verabk",
    ])
      expect(parseBackupName(bad)).toBeUndefined();
  });

  it("keeps newest, daily, weekly and monthly backups and never touches other files", () => {
    const now = new Date("2026-11-20T04:00:00Z");
    const names: string[] = ["readme.txt", "vera-research-x.verabk"];
    // Two backups a day for 400 days.
    for (let hour = 0; hour < 400 * 24; hour += 12)
      names.push(backupName(new Date(now.getTime() - hour * 3_600_000)));
    const doomed = backupsToPrune(names, now);
    const kept = names.filter((n) => !doomed.includes(n));
    expect(doomed).not.toContain("readme.txt");
    expect(doomed).not.toContain("vera-research-x.verabk");
    const keptBackups = kept.filter((n) => parseBackupName(n));
    // newest 3 + ~14 daily + ~8 weekly + ~12 monthly, with overlaps.
    expect(keptBackups.length).toBeGreaterThanOrEqual(25);
    expect(keptBackups.length).toBeLessThanOrEqual(37);
    expect(kept).toContain(names[2]); // the newest
    const oldest = keptBackups
      .map((n) => parseBackupName(n)!.getTime())
      .sort((a, b) => a - b)[0]!;
    expect(now.getTime() - oldest).toBeGreaterThan(300 * 86_400_000);
    // A single backup is always kept no matter how old.
    expect(backupsToPrune([backupName(new Date("2020-01-01"))], now)).toEqual(
      [],
    );
  });
});

describe("tunnel configuration", () => {
  const settings = {
    tunnelId: "6ff42ae2-765d-4adf-8112-31c55c1551ef",
    credentialsFile: "/Users/test/.cloudflared/6ff42ae2.json",
    hostname: "research.example.com",
    originPort: 43_211,
    operatorPort: 43_114,
    metricsPort: 43_113,
    accessTeamName: "vera-test",
    accessAud: "d".repeat(64),
  };
  it("forwards one exact hostname to loopback, blocks operator paths and ends in 404", () => {
    const text = renderTunnelConfig(settings);
    expect(text).toContain("service: http://127.0.0.1:43211");
    expect(text).not.toContain("43114");
    expect(text).toContain(
      "path: ^/(cloud-api/)?__(maintenance|operator)(/|$)",
    );
    expect(text).toContain("required: true");
    expect(text.trimEnd().endsWith("- service: http_status:404")).toBe(true);
    expect(text).toContain("metrics: 127.0.0.1:43113");
    expect(text).not.toMatch(/0\.0\.0\.0|\*/u);
  });
  it("rejects wildcards, apex-only, bad ids and port reuse", () => {
    for (const bad of [
      { hostname: "*.example.com" },
      { hostname: "example.com" },
      { hostname: "Research.Example.com" },
      { hostname: "research.example.com\nservice: http://evil" },
      { tunnelId: "not-a-uuid" },
      { credentialsFile: "relative.json" },
      { operatorPort: 43_211 },
      { originPort: 80 },
      { accessAud: "short" },
    ])
      expect(() => renderTunnelConfig({ ...settings, ...bad })).toThrow(
        "Invalid tunnel settings",
      );
  });
});

describe("launchd jobs", () => {
  const settings = {
    nodePath: "/usr/local/bin/node",
    repoRoot: "/Users/test/VERA Research <app> & co",
    envFile:
      "/Users/test/Library/Application Support/VERA Research Pilot/pilot.env",
    logDir: "/Users/test/Library/Application Support/VERA Research Pilot/logs",
    path: "/Applications/Postgres.app/Contents/Versions/18/bin:/usr/bin:/bin",
    cloudflaredPath: "/usr/local/bin/cloudflared",
    backupHour: 3,
    drillWeekday: 0,
  };
  it("keeps the API and tunnel alive, schedules backups gently and never embeds secrets", () => {
    const api = renderPlist("api", settings);
    expect(api).toContain("<key>KeepAlive</key><true/>");
    expect(api).toContain("<string>run-api</string>");
    expect(api).toContain("VERA Research &lt;app&gt; &amp; co");
    expect(api).toContain("<key>PILOT_ENV_FILE</key>");
    expect(api).not.toMatch(/PASSWORD|SECRET|PILOT_PG_URL/u);
    const tunnel = renderPlist("tunnel", settings);
    // The tunnel runs under the supervisor that checks the pilot API is the origin.
    expect(tunnel).toContain("<string>run-tunnel</string>");
    expect(tunnel).toContain("<key>PILOT_CLOUDFLARED</key>");
    expect(tunnel).toContain("<key>KeepAlive</key><true/>");
    const backup = renderPlist("backup", settings);
    expect(backup).toContain("<key>StartCalendarInterval</key>");
    expect(backup).toContain("<key>LowPriorityIO</key><true/>");
    expect(backup).not.toContain("KeepAlive");
    expect(renderPlist("drill", settings)).toContain(
      "<key>Weekday</key><integer>0</integer>",
    );
  });
  it("rejects relative paths and line breaks", () => {
    expect(() =>
      renderPlist("api", { ...settings, repoRoot: "relative" }),
    ).toThrow();
    expect(() => renderPlist("api", { ...settings, path: "a\nb" })).toThrow();
    expect(() =>
      renderPlist("backup", { ...settings, backupHour: 24 }),
    ).toThrow();
  });
});

describe("private env file, logs and settings", () => {
  it("parses literal KEY=VALUE lines and rejects anything else", () => {
    expect(parseEnvFile("# c\nA=1\n\nB=x=y z\n")).toEqual({
      A: "1",
      B: "x=y z",
    });
    expect(() => parseEnvFile("export A=1")).toThrow("line 1");
    expect(() => parseEnvFile("A=1\nA=2")).toThrow("repeats A");
  });
  it("refuses an env file other people can read", async () => {
    const root = await newRoot();
    const file = join(root, "pilot.env");
    await writeFile(file, "A=1\n", { mode: 0o644 });
    await expect(readPrivateEnvFile(file)).rejects.toThrow("chmod 600");
    await chmod(file, 0o600);
    expect(await readPrivateEnvFile(file)).toEqual({ A: "1" });
  });
  it("rotates logs at the size cap and keeps a bounded number", async () => {
    const root = await newRoot();
    const log = new RotatingLog(join(root, "api.log"), 100, 2);
    for (let i = 0; i < 10; i++) await log.write("x".repeat(60));
    const files = (await readdir(root)).sort();
    expect(files).toEqual(["api.log", "api.log.1", "api.log.2"]);
    for (const file of files)
      expect((await stat(join(root, file))).size).toBeLessThanOrEqual(100);
  });
  it("keeps the key away from the backups and the backups away from the data", () => {
    const base = {
      PILOT_HOME: "/p/home",
      PILOT_PG_URL: "postgresql://a:b@127.0.0.1:5432/vera",
      PILOT_OBJECT_ROOT: "/p/objects",
      PILOT_BACKUP_DESTINATION: "/icloud/backups",
      PILOT_BACKUP_KEY_FILE: "/p/home/backup.key",
    };
    expect(hostSettings(base).destination).toBe("/icloud/backups");
    expect(() =>
      hostSettings({ ...base, PILOT_BACKUP_KEY_FILE: "/icloud/backups/key" }),
    ).toThrow("must not be inside the backup destination");
    expect(() =>
      hostSettings({ ...base, PILOT_BACKUP_DESTINATION: "/p/objects/bk" }),
    ).toThrow("separate from pilot data");
    expect(() => hostSettings({ ...base, PILOT_HOME: "relative" })).toThrow(
      "absolute",
    );
    expect(
      destinationKind(
        "/Users/m/Library/Mobile Documents/com~apple~CloudDocs/VERA",
        "/Users/m",
      ),
    ).toContain("iCloud");
    expect(destinationKind("/Volumes/Backup/VERA")).toBe("external drive");
    expect(destinationKind("/Users/m/Desktop/VERA", "/Users/m")).toContain(
      "WARNING",
    );
  });
});

describe("status report", () => {
  it("reports unavailability and stale or failed backups honestly", async () => {
    const root = await newRoot();
    await mkdir(join(root, "objects"));
    const settings = hostSettings({
      PILOT_HOME: root,
      // Nothing listens on these ports in the test.
      PILOT_PG_URL: "postgresql://a:b@127.0.0.1:1/vera",
      PILOT_OBJECT_ROOT: join(root, "objects"),
      PILOT_BACKUP_DESTINATION: "/Volumes/VERA-test-backups",
      PILOT_BACKUP_KEY_FILE: join(root, "backup.key"),
      OPERATOR_PORT: "1",
      PILOT_TUNNEL_METRICS_PORT: "2",
      BROWSER_PUBLIC_ORIGIN: "https://research.example.com",
    });
    const now = new Date("2026-11-20T12:00:00Z");
    await writeState(join(root, "state", "backup.json"), {
      lastSuccess: { at: "2026-11-17T03:15:00Z" },
      lastFailure: {
        at: "2026-11-20T03:15:00Z",
        message: "Backup destination is missing",
      },
    });
    await writeState(join(root, "state", "api-starts.json"), {
      starts: [
        "2026-11-20T11:00:00Z",
        "2026-11-20T11:30:00Z",
        "2026-11-10T00:00:00Z",
      ],
    });
    const status = await collectStatus(settings, now, async (job) => ({
      loaded: job === "tunnel",
      running: job === "tunnel",
    }));
    expect(status.reachableByFriends).toBe(false);
    expect(status.restartsLast24h).toBe(2);
    expect(status.problems).toEqual(
      expect.arrayContaining([
        "Research API is not running",
        "PostgreSQL is not reachable",
        "Tunnel is loaded but not connected to Cloudflare",
        "Last good backup is 81 hours old",
        "Latest backup FAILED: Backup destination is missing",
        "No successful restore drill yet",
      ]),
    );
    const text = formatStatus(status);
    expect(text).toContain("Friends can reach it right now: NO");
    expect(text).toContain("No uptime guarantee");
    expect(text).toContain("Needs attention");
  });
});

describe("stale backup write gate", () => {
  const settingsFor = (root: string) =>
    hostSettings({
      PILOT_HOME: join(root, "home"),
      PILOT_PG_URL: "postgresql://a:b@127.0.0.1:5432/vera",
      PILOT_OBJECT_ROOT: join(root, "objects"),
      PILOT_BACKUP_DESTINATION: "/Volumes/VERA-test-backups",
      PILOT_BACKUP_KEY_FILE: join(root, "home", "backup.key"),
    });
  const gate = (root: string) =>
    join(root, "objects", ".vera-backup-writes-blocked");

  it("removes a gate left by a backup process that no longer exists", async () => {
    const root = await newRoot();
    await mkdir(gate(root), { recursive: true });
    const settings = settingsFor(root);
    // A pid that cannot exist on macOS.
    await writeState(join(root, "home", "state", "backup-gate-owner.json"), {
      pid: 99_999_999,
      startedAtMs: Date.now(),
      bootAtMs: Date.now() - 3_600_000,
    });
    const lines: string[] = [];
    await clearStaleBackupGate(settings, async (line) => {
      lines.push(line);
    });
    await expect(stat(gate(root))).rejects.toThrow();
    expect(lines.join("")).toContain("removed a stale backup write gate");
  });

  it("waits for a live backup and never removes a gate with no recorded owner", async () => {
    const root = await newRoot();
    await mkdir(gate(root), { recursive: true });
    const settings = settingsFor(root);
    await expect(
      clearStaleBackupGate(settings, async () => undefined),
    ).rejects.toThrow("no recorded owner");
    expect((await stat(gate(root))).isDirectory()).toBe(true);
    await writeState(join(root, "home", "state", "backup-gate-owner.json"), {
      pid: process.pid,
      startedAtMs: Date.now(),
      bootAtMs: Date.now(),
    });
    await expect(
      clearStaleBackupGate(settings, async () => undefined, {
        waitMs: 50,
        pollMs: 10,
        stillRunning: async () => true,
      }),
    ).rejects.toThrow("still holding the write gate");
    expect((await stat(gate(root))).isDirectory()).toBe(true);
  });

  it("does nothing when there is no gate", async () => {
    const root = await newRoot();
    await clearStaleBackupGate(settingsFor(root), async () => undefined);
  });
});

describe("backup owner identity", () => {
  const owner = { pid: 4242, startedAtMs: 1_000_000, bootAtMs: 500_000 };
  it("is the same process only with the same boot, pid and start time", async () => {
    expect(
      await ownerStillRunning(
        owner,
        async () => 1_002_000,
        () => 500_500,
      ),
    ).toBe(true);
  });
  it("treats a reused pid (different start time) as not running", async () => {
    expect(
      await ownerStillRunning(
        owner,
        async () => 9_000_000,
        () => 500_500,
      ),
    ).toBe(false);
  });
  it("treats any owner from a previous boot as not running", async () => {
    expect(
      await ownerStillRunning(
        owner,
        async () => 1_000_000,
        () => 9_000_000,
      ),
    ).toBe(false);
  });
  it("treats a pid that isn't running as not running", async () => {
    expect(
      await ownerStillRunning(
        owner,
        async () => undefined,
        () => 500_500,
      ),
    ).toBe(false);
  });
  it("reads this process's real start time from the OS", async () => {
    const started = await processStartMs(process.pid);
    expect(started).toBeDefined();
    expect(
      Math.abs(started! - (Date.now() - process.uptime() * 1000)),
    ).toBeLessThan(5_000);
    expect(await processStartMs(99_999_999)).toBeUndefined();
  });
});
