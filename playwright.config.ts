import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PLAYWRIGHT_PORT ?? "3100";
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * The API base is intentionally unreachable (a synthetic loopback port with
 * no server behind it). Every spec installs `apiMock` before navigating, so
 * every request to this origin is answered by Playwright's route
 * interception rather than a live network call — this constant only needs
 * to be a stable, unique origin for the fixtures to key off.
 */
const MOCK_API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4010/api/v1";

export default defineConfig({
  testDir: "./e2e",
  // The accessibility suite lives under e2e/accessibility, the visual
  // regression suite lives under e2e/visual, and the live API contract
  // smoke suite lives under e2e/api, each with its own dedicated config
  // (playwright.a11y.config.ts / playwright.visual.config.ts /
  // playwright.api-smoke.config.ts) using different projects, worker
  // counts, and — for e2e/api specifically — no mocked webServer at all
  // (it talks to a real backend) — exclude all three here so they aren't
  // also picked up (and run under the wrong settings, or made to wait on
  // a webServer they don't use) by this general functional e2e config.
  testIgnore: ["**/visual/**", "**/accessibility/**", "**/api/**"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: {
    // A production build + `next start` is used instead of `next dev` so
    // Fast Refresh / on-demand Turbopack compilation never interrupts a
    // spec mid-interaction (dev-mode HMR can remount client components
    // while a test is mid-click, producing flaky "session vanished"
    // failures that have nothing to do with the app or the test).
    command: `npm run build && npm run start -- -p ${PORT} -H 127.0.0.1`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_API_URL: MOCK_API_URL,
    },
  },
});
