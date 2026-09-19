import { defineConfig } from 'vitest/config';

/**
 * Two projects. `unit` needs nothing but Node. `db` starts a real, throwaway PostgreSQL
 * server (see test/support/cluster.ts) — it is slower and is run by `pnpm test:db`.
 */
export default defineConfig({
  resolve: { conditions: ['source'] },
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['test/**/*.test.ts'], exclude: ['test/**/*.db.test.ts'], environment: 'node' },
      },
      {
        extends: true,
        test: {
          name: 'db',
          include: ['test/**/*.db.test.ts'],
          environment: 'node',
          hookTimeout: 120_000,
          testTimeout: 30_000,
          // One cluster per file is expensive; files run one after another.
          fileParallelism: false,
        },
      },
    ],
  },
});
