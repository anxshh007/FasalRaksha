import { defaultClientConditions } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Device-side unit tests run in Node against an in-memory IndexedDB (fake-indexeddb), with the
 * network replaced by a fake server. They exercise the same modules the phone runs. The browser
 * itself is proven by the Playwright suite in e2e/ (Gate A).
 */
export default defineConfig({
  resolve: { conditions: ['source', ...defaultClientConditions] },
  test: {
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto'],
    include: ['src/**/*.test.ts'],
  },
});
