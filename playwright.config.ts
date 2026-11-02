import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  use: {
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    },
    baseURL: "http://localhost:4517",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node --import tsx tests/browser-server.ts",
    url: "http://localhost:4517/api/works",
    reuseExistingServer: false,
  },
});
