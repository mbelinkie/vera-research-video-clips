import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:43112",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev:web -- --host 127.0.0.1 --port 43112",
    url: "http://127.0.0.1:43112",
    reuseExistingServer: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
