import { defineConfig } from "@playwright/test";

/**
 * Dedicated Playwright configuration for the live frontend API contract
 * smoke suite (e2e/api, #334).
 *
 * Unlike playwright.config.ts (and the a11y/visual configs), this suite is
 * **opt-in** and talks to a real, deployed-or-ephemeral backend rather than
 * Playwright's route-interception mocks: it exists to prove a *built*
 * frontend can execute representative requests against a real server with
 * real headers, status codes, and response bodies — something a schema
 * drift check (tests/contracts/schema-drift.test.ts) or the unit-mocked
 * e2e suites can't prove.
 *
 * It requires `EARNPROOF_API_SMOKE_URL` (the backend origin to hit) and
 * does not start a Next.js webServer at all: these specs talk directly to
 * the API over HTTP via Playwright's `request` fixture, not through pages
 * rendered by this frontend. Every spec checks for required env/
 * credentials itself and calls `test.skip()` with a clear reason when
 * they're absent (see e2e/api/README.md), so a developer running the
 * default `npm run test:e2e` never hits this suite, and CI only runs it
 * when explicitly invoked with the right environment configured.
 */
export default defineConfig({
  testDir: "./e2e/api",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [
        [
          "html",
          { outputFolder: "playwright-report-api-smoke", open: "never" },
        ],
        ["list"],
      ]
    : "list",
  timeout: 30_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    trace: "retain-on-failure",
  },
});
