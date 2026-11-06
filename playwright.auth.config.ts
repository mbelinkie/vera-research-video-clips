import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "browser-auth.spec.ts",
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "https://127.0.0.1:43177",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node --import tsx tests/e2e/browser-auth-server.ts",
    url: "https://127.0.0.1:43177",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 120000,
  },
  projects: [{ name: "chromium-auth", use: { ...devices["Desktop Chrome"] } }],
});
