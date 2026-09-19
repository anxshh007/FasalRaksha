/**
 * Bundle storage and serving (PROMPT §5.8, §8.8; SEC-14).
 *
 * `loadRelease` writes a whole release as the owner role in one transaction, with the release
 * row last, so the current release switches atomically. The read functions run as the
 * application role with no actor: bundles are public market data, identical for every farmer.
 *
 * Every document is re-verified as it leaves the server. A row altered in the database, whether
 * by a bad migration, a restore gone wrong or a person, is refused with a 500 rather than served.
 * The device verifies again on arrival, because the server's check protects the server's
 * honesty, not the network's.
 */
import { canonicalJson, verifyIntegrity } from '@fasal/shared';
import pg from 'pg';

import { withAnonymous, type Database } from '../../db/actor.js';
import { DomainError } from '../../http/errors.js';
import type { Release } from './publish.js';

export interface ServedDocument {
  body: string;
  etag: string;
  version: string;
}

export async function loadRelease(ownerUrl: string, release: Release): Promise<void> {
  const client = new pg.Client({ connectionString: ownerUrl });
  client.on('error', () => undefined);
  await client.connect();
  try {
    await client.query('BEGIN');
    for (const b of release.bundles) {
      await client.query(
        `INSERT INTO app.forecast_bundles (crop, district, version, as_of, status, payload, integrity, generated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (crop, district, version) DO UPDATE SET as_of = EXCLUDED.as_of, status = EXCLUDED.status,
           payload = EXCLUDED.payload, integrity = EXCLUDED.integrity, generated_at = EXCLUDED.generated_at`,
        [b.bundle.crop, b.bundle.district, release.version, b.bundle.asOf, b.bundle.status, b.body, b.integrity, release.generatedAt],
      );
      await client.query('DELETE FROM app.raksha_signals WHERE crop = $1 AND district = $2 AND as_of = $3', [b.bundle.crop, b.bundle.district, b.bundle.asOf]);
      for (const [layer, reading] of Object.entries(b.bundle.raksha.layers)) {
        await client.query('INSERT INTO app.raksha_signals (crop, district, as_of, layer, bucket, weight, value) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
          b.bundle.crop, b.bundle.district, b.bundle.asOf, layer, reading.bucket, reading.weight, reading.value,
        ]);
      }
    }
    for (const s of release.shared) {
      if (s.name === 'crops') {
        await client.query(
          `INSERT INTO app.crop_profiles (version, payload, integrity) VALUES ($1, $2, $3)
           ON CONFLICT (version) DO UPDATE SET payload = EXCLUDED.payload, integrity = EXCLUDED.integrity, loaded_at = now()`,
          [release.version, s.body, s.integrity],
        );
        continue;
      }
      await client.query(
        `INSERT INTO app.shared_bundles (name, version, payload, integrity, generated_at) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (name, version) DO UPDATE SET payload = EXCLUDED.payload, integrity = EXCLUDED.integrity, generated_at = EXCLUDED.generated_at`,
        [s.name, release.version, s.body, s.integrity, release.generatedAt],
      );
    }
    await client.query(
      `INSERT INTO app.bundle_releases (version, as_of, data_source, manifest, integrity) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (version) DO UPDATE SET manifest = EXCLUDED.manifest, integrity = EXCLUDED.integrity, released_at = now()`,
      [release.version, release.asOf, release.dataSource, release.manifest.body, release.manifest.integrity],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

const NO_RELEASE = () => new DomainError(503, 'NO_BUNDLE_RELEASE', 'Prices have not been published on this server yet. The prices already on your phone still work.');

function serve(payload: unknown, version: string, what: string): ServedDocument {
  if (typeof payload !== 'object' || payload === null || !verifyIntegrity(payload as Record<string, unknown>)) {
    throw new DomainError(500, 'BUNDLE_INTEGRITY_FAILED', `The stored ${what} failed its integrity check and was not sent.`);
  }
  const integrity = (payload as { integrity: string }).integrity;
  return { body: canonicalJson(payload), etag: `"${integrity}"`, version };
}

const CURRENT = 'SELECT version FROM app.bundle_releases ORDER BY released_at DESC, version DESC LIMIT 1';

export async function currentManifest(db: Database): Promise<ServedDocument> {
  return withAnonymous(db, async (client) => {
    const { rows } = await client.query<{ version: string; manifest: unknown }>('SELECT version, manifest FROM app.bundle_releases ORDER BY released_at DESC, version DESC LIMIT 1');
    const row = rows[0];
    if (row === undefined) throw NO_RELEASE();
    return serve(row.manifest, row.version, 'manifest');
  });
}

export async function cropBundle(db: Database, crop: string, district: string): Promise<ServedDocument> {
  return withAnonymous(db, async (client) => {
    const { rows } = await client.query<{ version: string; payload: unknown }>(
      `SELECT b.version, b.payload FROM app.forecast_bundles b WHERE b.crop = $1 AND b.district = $2 AND b.version = (${CURRENT})`,
      [crop, district],
    );
    const row = rows[0];
    if (row === undefined) {
      const release = await client.query(CURRENT);
      if (release.rowCount === 0) throw NO_RELEASE();
      throw new DomainError(404, 'NO_BUNDLE', 'No prices are published for this crop in this district.');
    }
    return serve(row.payload, row.version, 'bundle');
  });
}

export async function sharedBundle(db: Database, name: string): Promise<ServedDocument> {
  return withAnonymous(db, async (client) => {
    const { rows } =
      name === 'crops'
        ? await client.query<{ version: string; payload: unknown }>(`SELECT version, payload FROM app.crop_profiles WHERE version = (${CURRENT})`)
        : await client.query<{ version: string; payload: unknown }>(`SELECT version, payload FROM app.shared_bundles WHERE name = $1 AND version = (${CURRENT})`, [name]);
    const row = rows[0];
    if (row === undefined) {
      const release = await client.query(CURRENT);
      if (release.rowCount === 0) throw NO_RELEASE();
      throw new DomainError(404, 'NO_BUNDLE', 'That reference bundle is not published.');
    }
    return serve(row.payload, row.version, 'bundle');
  });
}
