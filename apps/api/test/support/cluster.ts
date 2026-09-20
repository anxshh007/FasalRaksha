/**
 * A real, throwaway PostgreSQL for the `db` test project.
 *
 * If TEST_DATABASE_SUPERUSER_URL is set (CI service container, docker-compose), that server is
 * used and each run gets its own freshly created database. Otherwise an embedded PostgreSQL
 * server is started in a temporary directory on a free port and destroyed afterwards — the
 * tests never share state with a developer's `.pgdata`.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

import { resolve } from 'node:path';

import { bootstrapDatabase, installContextKey } from '../../src/db/bootstrap.js';
import { migrate } from '../../src/db/migrate.js';

export const MIGRATIONS_DIR = resolve(import.meta.dirname, '../../../../infra/migrations');

export interface TestCluster {
  superuserUrl: string;
  stop(): Promise<void>;
}

export interface TestDatabase {
  database: string;
  superuserUrl: string;
  ownerUrl: string;
  appUrl: string;
  /** Superuser connection string for *this* database — seeding only (bypasses RLS). */
  seedUrl: string;
  /** The request-context key installed in this database. */
  contextKey: Buffer;
  drop(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolvePort(port));
    });
  });
}

export async function startCluster(): Promise<TestCluster> {
  const external = process.env['TEST_DATABASE_SUPERUSER_URL'];
  if (external !== undefined && external !== '') {
    return { superuserUrl: external, stop: async () => undefined };
  }
  const dir = mkdtempSync(join(tmpdir(), 'fasal-pg-'));
  const password = randomBytes(18).toString('base64url');
  const port = await freePort();
  const server = new EmbeddedPostgres({
    databaseDir: join(dir, 'cluster'),
    user: 'postgres',
    password,
    port,
    // `persistent: false` makes embedded-postgres delete the cluster itself as it stops, and on
    // Windows that throws EBUSY often enough to fail a suite whose tests have all passed. The
    // directory is this file's to remove, patiently, below.
    persistent: true,
    onLog: () => undefined,
    onError: () => undefined,
  });
  await server.initialise();
  await server.start();
  return {
    superuserUrl: `postgres://postgres:${password}@127.0.0.1:${port}/postgres`,
    stop: async () => {
      // Tidying up is never a test result: a cluster that will not stop cleanly, or a directory
      // Windows still holds, leaves a folder in the system temp and nothing else.
      await server.stop().catch(() => undefined);
      await removeCluster(dir);
    },
  };
}

/**
 * Delete the throwaway cluster directory, patiently. On Windows the postmaster's own files can
 * stay locked for a moment after it exits (a virus scanner reading them is enough), and an
 * `EBUSY` while tidying up must never be reported as a failing test suite: the tests have already
 * run, and the directory is in the system temp folder either way.
 */
async function removeCluster(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((done) => setTimeout(done, 200 * (attempt + 1)));
    }
  }
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
  } catch {
    // Left behind in the temp folder. Not a test result.
  }
}

/** A fresh database with every migration applied and a fresh context key installed. */
export async function createTestDatabase(cluster: TestCluster): Promise<TestDatabase> {
  const database = `fasal_test_${randomBytes(4).toString('hex')}`;
  const urls = await bootstrapDatabase(cluster.superuserUrl, {
    database,
    ownerPassword: randomBytes(24).toString('base64url'),
    appPassword: randomBytes(24).toString('base64url'),
  });
  await migrate(urls.ownerUrl, MIGRATIONS_DIR);
  const contextKey = randomBytes(32);
  await installContextKey(urls.ownerUrl, contextKey.toString('hex'));
  const seed = new URL(cluster.superuserUrl);
  seed.pathname = `/${database}`;
  return {
    database,
    superuserUrl: cluster.superuserUrl,
    ownerUrl: urls.ownerUrl,
    appUrl: urls.appUrl,
    seedUrl: seed.toString(),
    contextKey,
    drop: async () => {
      const admin = new pg.Client({ connectionString: cluster.superuserUrl });
      await admin.connect();
      try {
        await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      } finally {
        await admin.end();
      }
    },
  };
}
