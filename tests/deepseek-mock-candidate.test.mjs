import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const fixturePath = join(
  repoRoot,
  "tests/fixtures/deepseek/mock-candidate.json",
);
const verifierPath = join(
  repoRoot,
  "scripts/verify-research-mock-candidate.mjs",
);
const baseline = {
  fixture: "vera-research-synthetic-candidate",
  status: "draft",
};
const mockOutput = {
  fixture: "vera-research-synthetic-candidate",
  status: "mock-verified",
};

test("rejects the baseline and accepts only the isolated synthetic mock output", () => {
  assert.deepEqual(JSON.parse(readFileSync(fixturePath, "utf8")), baseline);

  const root = mkdtempSync(join(tmpdir(), "vera-research-mock-"));
  const isolatedFixture = join(
    root,
    "tests/fixtures/deepseek/mock-candidate.json",
  );
  const isolatedVerifier = join(
    root,
    "scripts/verify-research-mock-candidate.mjs",
  );

  try {
    mkdirSync(join(root, "scripts"), { recursive: true });
    mkdirSync(join(root, "tests/fixtures/deepseek"), { recursive: true });
    copyFileSync(verifierPath, isolatedVerifier);
    copyFileSync(fixturePath, isolatedFixture);

    const rejected = spawnSync(process.execPath, [isolatedVerifier], {
      encoding: "utf8",
    });
    assert.notEqual(
      rejected.status,
      0,
      "the unmodified draft must fail the host check",
    );

    writeFileSync(isolatedFixture, JSON.stringify(mockOutput, null, 2) + "\n");
    const accepted = spawnSync(process.execPath, [isolatedVerifier], {
      encoding: "utf8",
    });
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.match(accepted.stdout, /matches the frozen mock output/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
