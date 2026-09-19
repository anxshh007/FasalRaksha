import { defineConfig } from '@playwright/test';

/**
 * End-to-end: the built PWA (vite preview) in front of a real API over a real PostgreSQL, run by
 * the stack supervisor (apps/api/scripts/e2e-stack.ts), which a test can ask to kill the API.
 *
 * The browser is the Microsoft Edge already installed on the machine (`channel: 'msedge'`), so
 * running the suite downloads no browser binary.
 */
const PREVIEW = 4179;
const API = 8799;
const CONTROL = 8798;

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PREVIEW}`,
    channel: process.env['E2E_BROWSER_CHANNEL'] ?? 'msedge',
    headless: true,
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @fasal/api exec tsx --conditions=source scripts/e2e-stack.ts',
      url: `http://127.0.0.1:${CONTROL}/status`,
      env: { E2E_API_PORT: String(API), E2E_CONTROL_PORT: String(CONTROL) },
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'pnpm exec vite build && pnpm exec vite preview',
      url: `http://127.0.0.1:${PREVIEW}`,
      env: { FASAL_API_URL: `http://127.0.0.1:${API}`, FASAL_PREVIEW_PORT: String(PREVIEW) },
      timeout: 180_000,
      reuseExistingServer: false,
    },
  ],
});
