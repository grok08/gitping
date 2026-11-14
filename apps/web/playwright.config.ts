import { defineConfig, devices } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const configDirectory = dirname(fileURLToPath(import.meta.url));
const apiDirectory = resolve(configDirectory, "../api");
const e2eDatabase = resolve(
  configDirectory,
  "test-results",
  "gitping-e2e.db",
);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  expect: {
    toHaveScreenshot: {
      pathTemplate:
        "{testDir}/../../../../evidence/phase-1/parity/{arg}{ext}",
      animations: "disabled",
      caret: "hide",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "bun run scripts/start-e2e.ts",
      cwd: apiDirectory,
      env: {
        ...(process.env as Record<string, string>),
        PORT: "3000",
        GITPING_DB_PATH: e2eDatabase,
      },
      url: "http://localhost:3000/health",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "bun run dev --host 127.0.0.1 --port 4173 --strictPort",
      cwd: configDirectory,
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
