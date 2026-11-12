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
    testTimeout: 15_000,
  },
});
