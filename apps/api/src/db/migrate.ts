/**
 * ARCH-05 · schema migrations: ordered, checksummed, immutable once applied.
 *
 * Plain SQL files in `infra/migrations/`, named `NNNN_description.sql`, applied in order, each
 * in its own transaction, recorded in `app_meta.schema_migrations` with a SHA-256 of its text.
 * An applied migration that has since been edited — or deleted — stops the run: the database
 * and the repository disagree about history, and silently carrying on would make the next
 * environment built from the repository different from the one already running.
 *
 * Runs as the owner role, never as the application role.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

export const MIGRATION_FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

/** Arbitrary constant key for the session-level advisory lock that serialises migrators. */
const MIGRATION_LOCK_KEY = 7_302_026;

export interface Migration {
  version: string;
  name: string;
  file: string;
  checksum: string;
  sql: string;
}

export class MigrationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MigrationError';
  }
}

/** SHA-256 over the text with line endings normalised, so a CRLF checkout hashes the same. */
export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

export async function loadMigrations(dir: string): Promise<Migration[]> {
  const entries = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  const migrations: Migration[] = [];
  const seen = new Set<string>();
  for (const file of entries) {
    const match = MIGRATION_FILE.exec(file);
    if (match === null) {
      throw new MigrationError(`"${file}" is not named NNNN_description.sql, so its place in the order is ambiguous.`);
    }
    const version = match[1] ?? '';
    if (seen.has(version)) throw new MigrationError(`Two migrations share version ${version}.`);
    seen.add(version);
    const sql = await readFile(join(dir, file), 'utf8');
    migrations.push({ version, name: match[2] ?? '', file, checksum: checksumOf(sql), sql });
  }
  return migrations;
}

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

export async function migrate(ownerUrl: string, dir: string): Promise<MigrationResult> {
  const migrations = await loadMigrations(dir);
  const client = new pg.Client({ connectionString: ownerUrl, application_name: 'fasal-migrate' });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query('CREATE SCHEMA IF NOT EXISTS app_meta');
    await client.query(
      `CREATE TABLE IF NOT EXISTS app_meta.schema_migrations (
         version    text PRIMARY KEY,
         name       text NOT NULL,
         checksum   text NOT NULL,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );

    const { rows } = await client.query<{ version: string; name: string; checksum: string }>(
      'SELECT version, name, checksum FROM app_meta.schema_migrations ORDER BY version',
    );
    const onDisk = new Map(migrations.map((m) => [m.version, m]));
    for (const row of rows) {
      const local = onDisk.get(row.version);
      if (local === undefined) {
        throw new MigrationError(`Migration ${row.version}_${row.name} is applied to this database but missing from ${dir}.`);
      }
      if (local.checksum !== row.checksum) {
        throw new MigrationError(
          `Migration ${local.file} was edited after it was applied. Applied migrations are immutable — add a new migration instead.`,
        );
      }
    }

    const appliedVersions = new Set(rows.map((row) => row.version));
    const result: MigrationResult = { applied: [], alreadyApplied: [] };
    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) {
        result.alreadyApplied.push(migration.file);
        continue;
      }
      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query('INSERT INTO app_meta.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
          migration.version,
          migration.name,
          migration.checksum,
        ]);
        await client.query('COMMIT');
        result.applied.push(migration.file);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        const reason = error instanceof Error ? error.message : String(error);
        throw new MigrationError(`Migration ${migration.file} failed and was rolled back: ${reason}`, { cause: error });
      }
    }
    return result;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}
