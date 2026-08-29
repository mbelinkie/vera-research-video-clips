import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { build, type BuildOptions } from "esbuild";

import { DesktopRuntimeConfigurationSchema } from "../apps/desktop/src/runtime-config.ts";
import { approvedWhisperModelPin } from "../apps/desktop/src/release-config.ts";

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

const publicDesktopConfiguration = {
  publicApiOrigin: process.env.PUBLIC_API_ORIGIN,
  cognitoAuthority: process.env.COGNITO_DOMAIN,
  cognitoClientId: process.env.COGNITO_CLIENT_ID,
  whisperModelPin: approvedWhisperModelPin,
  localModelCatalogTrustRoots: parseTrustRoots(
    process.env.LOCAL_MODEL_CATALOG_TRUST_ROOTS_JSON,
  ),
  argosSidecarPath: process.env.ARGOS_SIDECAR_PATH,
  argosRuntimeVersions: (process.env.ARGOS_RUNTIME_VERSIONS ?? "1.9")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
};
const configuredDesktopValues = [
  publicDesktopConfiguration.publicApiOrigin,
  publicDesktopConfiguration.cognitoAuthority,
  publicDesktopConfiguration.cognitoClientId,
].filter(Boolean).length;
if (configuredDesktopValues > 0 && configuredDesktopValues < 3) {
  throw new Error(
    "Desktop cloud configuration is partial. Set PUBLIC_API_ORIGIN, COGNITO_DOMAIN, and COGNITO_CLIENT_ID together.",
  );
}
const configuration = DesktopRuntimeConfigurationSchema.parse(
  configuredDesktopValues === 3
    ? publicDesktopConfiguration
    : { whisperModelPin: approvedWhisperModelPin },
);
await writeFile(
  resolve(outputRoot, "desktop-config.json"),
  `${JSON.stringify(configuration, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 },
);

function parseTrustRoots(value: string | undefined): Record<string, string> {
  if (!value) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("LOCAL_MODEL_CATALOG_TRUST_ROOTS_JSON must be an object.");
  const entries = Object.entries(parsed);
  if (entries.some(([, root]) => typeof root !== "string"))
    throw new Error("Every local-model trust root must be a string.");
  return Object.fromEntries(entries) as Record<string, string>;
}
