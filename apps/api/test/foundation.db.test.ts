/**
 * ARCH-03 · ARCH-05 · P1-11 — the database foundation, against a real PostgreSQL server.
 *
 * P3 builds the schema and the adversarial security suite on top of exactly these properties, so they are
 * proven here first: the application role cannot step around row-level security, the request
 * context is scoped to one transaction and never leaks through the pool, the API refuses to
 * start with excess privilege, and migrations are ordered, idempotent and immutable.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withActor, type Database } from '../src/db/actor.js';
import { assertLeastPrivilege, PrivilegeError } from '../src/db/guard.js';
import { loadMigrations, migrate, MigrationError } from '../src/db/migrate.js';
import { createPool, type Pool } from '../src/db/pool.js';
import { createTestDatabase, startCluster, type TestCluster, type TestDatabase } from './support/cluster.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../../infra/migrations');
const FARMER_A = '11111111-1111-4111-8111-111111111111';
const FARMER_B = '22222222-2222-4222-8222-222222222222';

let cluster: TestCluster;
let db: TestDatabase;
let appPool: Pool;
let appDb: Database;

beforeAll(async () => {
  cluster = await startCluster();
  db = await createTestDatabase(cluster);

  // A scratch table shaped like every P3 table: owned by fasal_owner, RLS forced, one policy
  // keyed on the request context. Created in this throwaway database only.
  // Rows are seeded *before* RLS is forced: once forced, the policy binds the owner too (which
  // the first run of this file demonstrated — the owner's own seed INSERT was refused).
  const owner = new pg.Client({ connectionString: db.ownerUrl });
  owner.on('error', () => undefined);
  await owner.connect();
  try {
    await owner.query(`
      CREATE TABLE app.scratch_contacts (owner_id uuid NOT NULL, phone text NOT NULL);
      INSERT INTO app.scratch_contacts VALUES ('${FARMER_A}', 'phone-of-a'), ('${FARMER_B}', 'phone-of-b');
      ALTER TABLE app.scratch_contacts ENABLE ROW LEVEL SECURITY;
      ALTER TABLE app.scratch_contacts FORCE ROW LEVEL SECURITY;
      CREATE POLICY own_rows ON app.scratch_contacts USING (owner_id = app.actor_id()) WITH CHECK (owner_id = app.actor_id());
      GRANT SELECT, INSERT ON app.scratch_contacts TO fasal_app;
    `);
  } finally {
    await owner.end();
  }
  appPool = createPool(db.appUrl, { max: 1 });
  appDb = { pool: appPool, contextKey: db.contextKey };
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await db?.drop();
  await cluster?.stop();
});

describe('ARCH-03 · the application role cannot step around row-level security', () => {
  it('connects as fasal_app, which is not a superuser, has no BYPASSRLS and owns nothing', async () => {
    const report = await assertLeastPrivilege(appPool);
    expect(report).toMatchObject({ role: 'fasal_app', superuser: false, bypassRls: false, createRole: false, createDb: false, ownedRelations: 0 });
  });

  it('binds even the table owner once RLS is forced', async () => {
    const owner = new pg.Client({ connectionString: db.ownerUrl });
    await owner.connect();
    try {
      const { rows } = await owner.query('SELECT phone FROM app.scratch_contacts');
      expect(rows).toEqual([]);
    } finally {
      await owner.end();
    }
  });

  it('refuses to run as the owner role (owners bypass RLS on tables that do not force it)', async () => {
    const ownerPool = createPool(db.ownerUrl, { max: 1 });
    try {
      await expect(assertLeastPrivilege(ownerPool)).rejects.toBeInstanceOf(PrivilegeError);
    } finally {
      await ownerPool.end();
    }
  });

  it('refuses to run as a superuser', async () => {
    const superPool = createPool(db.superuserUrl.replace(/\/postgres$/, `/${db.database}`), { max: 1 });
    try {
      await expect(assertLeastPrivilege(superPool)).rejects.toThrow(/superuser/);
    } finally {
      await superPool.end();
    }
  });

  it('sees only the acting farmer’s rows inside withActor', async () => {
    const rows = await withActor(appDb, { userId: FARMER_A, role: 'farmer' }, async (client) =>
      (await client.query<{ phone: string }>('SELECT phone FROM app.scratch_contacts')).rows,
    );
    expect(rows).toEqual([{ phone: 'phone-of-a' }]);
  });

  it('sees nothing when a client skips the API and queries with no identity', async () => {
    const { rows } = await appPool.query('SELECT phone FROM app.scratch_contacts');
    expect(rows).toEqual([]);
  });

  it('cannot write a row on behalf of another farmer', async () => {
    await expect(
      withActor(appDb, { userId: FARMER_A, role: 'farmer' }, (client) =>
        client.query(`INSERT INTO app.scratch_contacts VALUES ('${FARMER_B}', 'forged')`),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('discards the request context at commit, so a pooled connection carries nothing forward', async () => {
    await withActor(appDb, { userId: FARMER_B, role: 'farmer' }, async () => undefined);
    // Same single pooled connection, next "request", no withActor:
    const { rows } = await appPool.query<{ id: string | null; role: string | null }>('SELECT app.actor_id() AS id, app.actor_role() AS role');
    expect(rows[0]).toEqual({ id: null, role: null });
  });

  it('discards the request context on rollback too', async () => {
    await expect(
      withActor(appDb, { userId: FARMER_A, role: 'farmer' }, async () => {
        throw new Error('handler failed');
      }),
    ).rejects.toThrow('handler failed');
    const { rows } = await appPool.query<{ id: string | null }>('SELECT app.actor_id() AS id');
    expect(rows[0]?.id).toBeNull();
  });

  it('rejects a malformed identity before it reaches the database', async () => {
    await expect(withActor(appDb, { userId: "x' OR '1'='1", role: 'farmer' }, async () => undefined)).rejects.toThrow(/not a valid identifier/);
  });

  it('raises on an identity set directly in the database without the API’s signature', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_id', $1, true), set_config('app.current_role', 'farmer', true)", [FARMER_A]);
      await expect(client.query('SELECT phone FROM app.scratch_contacts')).rejects.toThrow(/signature is invalid/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

describe('ARCH-05 · migrations are ordered, idempotent and immutable', () => {
  it('applies nothing the second time', async () => {
    const again = await migrate(db.ownerUrl, MIGRATIONS);
    expect(again.applied).toEqual([]);
    const all = (await loadMigrations(MIGRATIONS)).map((m) => m.file);
    expect(all.slice(0, 6)).toEqual(['0001_baseline.sql', '0002_identity.sql', '0003_marketplace.sql', '0004_public_data.sql', '0005_bundle_releases.sql', '0006_price_alerts.sql']);
    expect(again.alreadyApplied).toEqual(all); // every migration in the repository, in order, and nothing else
  });

  it('stops when an applied migration has been edited', async () => {
    const copy = mkdtempSync(join(tmpdir(), 'fasal-mig-'));
    try {
      cpSync(MIGRATIONS, copy, { recursive: true });
      const file = join(copy, '0001_baseline.sql');
      writeFileSync(file, `${readFileSync(file, 'utf8')}\n-- an innocent-looking edit\n`);
      await expect(migrate(db.ownerUrl, copy)).rejects.toThrow(MigrationError);
      await expect(migrate(db.ownerUrl, copy)).rejects.toThrow(/edited after it was applied/);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });

  it('stops when an applied migration has been deleted from disk', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'fasal-mig-'));
    try {
      await expect(migrate(db.ownerUrl, empty)).rejects.toThrow(/missing from/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('rejects a migration file whose order is ambiguous', async () => {
    const copy = mkdtempSync(join(tmpdir(), 'fasal-mig-'));
    try {
      cpSync(MIGRATIONS, copy, { recursive: true });
      writeFileSync(join(copy, '2_add_things.sql'), 'SELECT 1;');
      await expect(migrate(db.ownerUrl, copy)).rejects.toThrow(/NNNN_description\.sql/);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });
});
