import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "apps/**/*.test.ts",
      "packages/**/*.test.ts",
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
