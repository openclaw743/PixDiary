/**
 * Playwright config for PixDiary E2E.
 *
 * The suite assumes:
 *   - Backend listening on `process.env.E2E_API_BASE_URL` (default
 *     http://127.0.0.1:3000). CI provides Postgres + Azurite as service
 *     containers and runs the backend in-process before this kicks off.
 *   - Frontend served at `process.env.E2E_BASE_URL` (default
 *     http://127.0.0.1:4173) via `vite preview`. CI starts it through the
 *     `webServer` block below.
 *
 * The Playwright Chromium/Firefox/WebKit matrix runs in parallel and uploads
 * the HTML report as an artifact (see .github/workflows/ci.yml).
 */
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173';
const apiBaseURL = process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:3000';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests/e2e',
  // Sequential within a file; parallel across files. The backend is real DB-
  // backed and signup/upload paths mutate global rate limiters, so we keep
  // workers bounded.
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
  reporter: isCI
    ? [
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
        ['list'],
        ['github'],
      ]
    : [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']],
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: isCI ? 'retain-on-failure' : 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  // Frontend preview server. Backend is started by the CI job before
  // Playwright runs (see ci.yml e2e job).
  webServer: process.env.E2E_NO_WEBSERVER
    ? undefined
    : {
        // Build then preview from the frontend package.
        command: 'cd frontend && npm run build && npm run preview -- --port 4173 --strictPort',
        port: 4173,
        reuseExistingServer: !isCI,
        timeout: 180_000,
        env: {
          VITE_API_BASE_URL: apiBaseURL,
        },
      },
  outputDir: 'test-results',
});
