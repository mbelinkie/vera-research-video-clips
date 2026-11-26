import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it, vi } from "vitest";
import { auditTranscriptRecovery } from "./transcript-recovery-plan.ts";

it("reports partial, corrupt and verified pinned copies without disclosing locators", async () => {
  const root = await mkdtemp(join(tmpdir(), "research-audit-"));
  const descriptor = (type: string, bytes: string) => ({
    type,
    objectKey: `private-key-${type}`,
    objectVersionId: `version-${type}`,
    byteSize: Buffer.byteLength(bytes),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  const track = descriptor("english-normalized", "synthetic");
  const srt = descriptor("english-srt", "subtitle");
  const identity = {
    id: randomUUID(),
    projectId: randomUUID(),
    catalogVideoId: randomUUID(),
    videoId: "AUDIT000001",
    lineageId: randomUUID(),
    version: 1,
    schemaVersion: 1,
    sourceLanguage: "en",
    targetLanguage: "en",
    timingPrecision: "cue",
  };
  const manifest = JSON.stringify({
    ...identity,
    provider: "fixture",
    normalizationSchemaVersion: 1,
    jobId: randomUUID(),
    createdBy: randomUUID(),
    createdAt: "2026-11-26T00:00:00.000Z",
    artifacts: [track, srt],
  });
  const pinned = descriptor("manifest", manifest);
  const row = {
    ...identity,
    activeVersionId: identity.id,
    manifestKey: pinned.objectKey,
    manifestVersion: pinned.objectVersionId,
    manifestSha: pinned.sha256,
    refs: [track, srt, pinned],
  };
  const database = { query: vi.fn().mockResolvedValue({ rows: [row] }) };
  const manifestEntry = {
    transcriptVersionId: identity.id,
    type: "manifest",
    file: "safe-manifest",
    objectVersionId: pinned.objectVersionId,
  };
  const entries = [
    manifestEntry,
    {
      ...manifestEntry,
      type: track.type,
      file: "safe-track",
      objectVersionId: track.objectVersionId,
    },
    {
      ...manifestEntry,
      type: srt.type,
      file: "safe-srt",
      objectVersionId: srt.objectVersionId,
    },
  ];
  const setIndex = (value: unknown) =>
    writeFile(join(root, "index.json"), JSON.stringify(value));
  const audit = async () =>
    (
      await auditTranscriptRecovery(database, {
        retained: root,
        destination: root,
      })
    )[0]!;
  try {
    await writeFile(join(root, "safe-manifest"), manifest);
    await writeFile(join(root, "safe-track"), "synthetic");
    await writeFile(join(root, "safe-srt"), "subtitle");
    await setIndex([manifestEntry]);
    expect((await audit()).retained.state).toBe("partial");

    await setIndex(entries);
    const intact = await audit();
    expect(intact.retained.state).toBe("verified");
    expect(intact.destinationExport.state).toBe("verified");
    expect(JSON.stringify(intact)).not.toMatch(
      /private-key|safe-manifest|synthetic/u,
    );
    row.activeVersionId = randomUUID();
    expect((await audit()).pinSetSha256).not.toBe(intact.pinSetSha256);

    await setIndex([
      manifestEntry,
      { ...entries[1], objectVersionId: "different" },
      entries[2],
    ]);
    expect((await audit()).retained.state).toBe("verified");
    expect((await audit()).destinationExport.state).toBe("corrupt");

    await setIndex([...entries, manifestEntry]);
    expect((await audit()).retained.state).toBe("corrupt");
    await setIndex([
      { ...manifestEntry, file: "../safe-manifest" },
      ...entries.slice(1),
    ]);
    expect((await audit()).retained.state).toBe("corrupt");
    await symlink("safe-manifest", join(root, "link"));
    await setIndex([{ ...manifestEntry, file: "link" }, ...entries.slice(1)]);
    expect((await audit()).retained.state).toBe("corrupt");

    await setIndex(entries);
    row.refs[0] = { ...track, objectVersionId: "stale-manifest-pin" };
    expect((await audit()).retained.state).toBe("corrupt");
    row.refs[0] = track;
    await writeFile(join(root, "safe-srt"), "subtitlE");
    expect((await audit()).retained.state).toBe("corrupt");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
