import { defineConfig, devices } from "@playwright/test";

// Playwright config (spec 004, F20). The webServer runs `astro preview`, which serves the
// static `dist/` build on port 4321 — so a build must precede a local e2e run (CI's Node-22
// e2e step builds first; see .github/workflows/validate-plugins.yml). One chromium project
// at the desktop viewport, where the full nav renders.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: "http://localhost:4321",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run preview",
    url: "http://localhost:4321",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
