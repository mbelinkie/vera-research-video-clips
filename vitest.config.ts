import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Embedded PGlite instances use substantial WASM memory. Running too many
    // database-heavy suites at once can starve each other and cause timeouts.
    maxWorkers: 2,
    include: [
      "apps/**/*.test.ts",
      "packages/**/*.test.ts",
      "scripts/**/*.test.ts",
      "tests/infra/**/*.test.ts",
      "tests/integration/**/*.test.ts",
    ],
    // Several suites create and migrate independent PGlite catalogs. Bounding
    // file workers prevents migration/FFmpeg contention from turning the
    // existing per-test timeout into a machine-load race as the schema grows.
    maxWorkers: 4,
    testTimeout: 15_000,
  },
});
