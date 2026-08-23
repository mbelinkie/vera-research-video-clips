import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { build, type BuildOptions } from "esbuild";

const repositoryRoot = process.cwd();
const outputRoot = resolve(repositoryRoot, "dist/desktop");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(resolve(outputRoot, "services"), { recursive: true });

const common: BuildOptions = {
  absWorkingDir: repositoryRoot,
  bundle: true,
  platform: "node",
  target: "node22",
  sourcemap: false,
  legalComments: "none",
  logLevel: "info",
};

await Promise.all([
  build({
    ...common,
    entryPoints: ["apps/desktop/src/main.ts"],
    outfile: resolve(outputRoot, "main.cjs"),
    format: "cjs",
    external: ["electron"],
  }),
  build({
    ...common,
    entryPoints: ["apps/desktop/src/preload.ts"],
    outfile: resolve(outputRoot, "preload.cjs"),
    format: "cjs",
    external: ["electron"],
  }),
  build({
    ...common,
    entryPoints: ["apps/local-agent/src/main.ts"],
    outfile: resolve(outputRoot, "services/local-agent.mjs"),
    format: "esm",
    define: { "import.meta.main": "false" },
    banner: {
      js: 'import { createRequire as __rvcCreateRequire } from "node:module"; const require = __rvcCreateRequire(import.meta.url);',
    },
  }),
  build({
    ...common,
    entryPoints: ["apps/worker/src/main.ts"],
    outfile: resolve(outputRoot, "services/transcription-worker.mjs"),
    format: "esm",
    define: { "import.meta.main": "false" },
    banner: {
      js: 'import { createRequire as __rvcCreateRequire } from "node:module"; const require = __rvcCreateRequire(import.meta.url);',
    },
  }),
]);

await cp(
  resolve(repositoryRoot, "packages/db-local/migrations"),
  resolve(outputRoot, "migrations"),
  { recursive: true },
);
