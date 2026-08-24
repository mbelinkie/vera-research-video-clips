import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const compatibilityAllowlist = new Set([
  "apps/cloud-api/src/app.ts",
  "apps/local-agent/src/artifact-locators.ts",
  "apps/local-agent/src/export-source.ts",
  "apps/local-agent/src/export-storage-preflight.ts",
  "apps/local-agent/src/live-youtube-smoke.ts",
  "apps/local-agent/src/shared-source-group.ts",
  "apps/web/src/batch-workspace.tsx",
  "apps/web/src/clip-queue.tsx",
  "apps/web/src/main.tsx",
  "apps/web/src/selection-command-panel.tsx",
  "apps/worker/src/pipeline.ts",
  "packages/catalog/src/index.ts",
  "packages/contracts/src/index.ts",
  "packages/db-local/src/index.ts",
  "packages/sync/src/index.ts",
]);

describe("provider-neutral source boundary", () => {
  it("does not spread the legacy YouTube identity field into new generic modules", async () => {
    const root = process.cwd();
    const files = [
      ...(await sourceFiles(join(root, "apps"))),
      ...(await sourceFiles(join(root, "packages"))),
    ];
    const legacyField = ["youtube", "Video", "Id"].join("");
    const offenders: string[] = [];
    for (const path of files) {
      if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) continue;
      if (!(await readFile(path, "utf8")).includes(legacyField)) continue;
      const workspacePath = relative(root, path).replaceAll("\\", "/");
      if (!compatibilityAllowlist.has(workspacePath))
        offenders.push(workspacePath);
    }
    expect(offenders).toEqual([]);
  });
});

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (/\.tsx?$/u.test(entry.name)) files.push(path);
  }
  return files;
}
