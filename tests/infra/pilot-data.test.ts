import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { restorePilot } from "../../scripts/pilot-data.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const freshFixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "vera50-corrupt-backup-"));
  roots.push(root);
  const backup = join(root, "backup");
  await mkdir(backup, { mode: 0o700 });
  const dump = Buffer.from("fake custom-format sql dump");
  await writeFile(join(backup, "catalog.dump"), dump);
  const manifest = {
    format: "VERA50_PILOT_BACKUP_V1",
    completed: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    databaseName: "vera50_test_fixture",
    schemaVersions: ["0001_foundation"],
    tableCounts: {},
    tableDigests: {},
    sqlDumpSha256: sha(dump),
    references: [] as Array<{
      object_key: string;
      object_version_id: string;
      sha256: string;
      byte_size: string;
    }>,
    objects: [],
    visibleHeads: [],
  };
  const serialize = async () => {
    const raw = Buffer.from(JSON.stringify(manifest));
    await writeFile(join(backup, "manifest.json"), raw);
    await writeFile(join(backup, "manifest.sha256"), sha(raw) + "\n");
  };
  await serialize();
  return {
    root,
    backup,
    dump,
    manifest,
    serialize,
    targetUrl: "postgresql://synthetic:pass@127.0.0.1:5432/vera50_test_fixture",
  };
};

describe("pilot backup restore preflight fails closed without contacting PostgreSQL", () => {
  it("rejects tampered manifest checksum and missing SQL dump before creating the object root", async () => {
    const fixture = await freshFixture();
    const target = join(fixture.root, "target");
    fixture.manifest.completed = false;
    await writeFile(
      join(fixture.backup, "manifest.json"),
      JSON.stringify(fixture.manifest),
    );
    await expect(
      restorePilot(fixture.backup, fixture.targetUrl, target),
    ).rejects.toThrow("checksum");
    fixture.manifest.completed = true;
    await fixture.serialize();
    await writeFile(join(fixture.backup, "catalog.dump"), "torn sql dump");
    await expect(
      restorePilot(fixture.backup, fixture.targetUrl, target),
    ).rejects.toThrow("dump");
  });

  it("rejects absent pinned versions and any non-test restore database", async () => {
    const fixture = await freshFixture();
    const target = join(fixture.root, "target");
    fixture.manifest.references.push({
      object_key: "projects/p/manifest.json",
      object_version_id: "1a957f94-f8a8-439d-a780-a9b2e0f93322",
      sha256: sha(new Uint8Array([1])),
      byte_size: "1",
    });
    await fixture.serialize();
    await expect(
      restorePilot(fixture.backup, fixture.targetUrl, target),
    ).rejects.toThrow("missing a referenced object");
    await expect(
      restorePilot(
        fixture.backup,
        "postgresql://synthetic:pass@127.0.0.1:5432/vera_real",
        target,
      ),
    ).rejects.toThrow("vera50_test_");
  });

  it("refuses a destination that already exists before modifying anything", async () => {
    const fixture = await freshFixture();
    await expect(
      restorePilot(fixture.backup, fixture.targetUrl, fixture.backup),
    ).rejects.toThrow("exists");
  });
});
