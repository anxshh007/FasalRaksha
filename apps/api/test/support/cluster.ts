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

import { bootstrapDatabase } from '../../src/db/bootstrap.js';

export interface TestCluster {
  superuserUrl: string;
  stop(): Promise<void>;
}

export interface TestDatabase {
  database: string;
  superuserUrl: string;
  ownerUrl: string;
  appUrl: string;
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
    persistent: false,
    onLog: () => undefined,
    onError: () => undefined,
  });
  await server.initialise();
  await server.start();
  return {
    superuserUrl: `postgres://postgres:${password}@127.0.0.1:${port}/postgres`,
    stop: async () => {
      await server.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function createTestDatabase(cluster: TestCluster): Promise<TestDatabase> {
  const database = `fasal_test_${randomBytes(4).toString('hex')}`;
  const urls = await bootstrapDatabase(cluster.superuserUrl, {
    database,
    ownerPassword: randomBytes(24).toString('base64url'),
    appPassword: randomBytes(24).toString('base64url'),
  });
  return {
    database,
    superuserUrl: cluster.superuserUrl,
    ownerUrl: urls.ownerUrl,
    appUrl: urls.appUrl,
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
