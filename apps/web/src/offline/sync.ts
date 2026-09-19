/**
 * Progressive, district-first bundle sync (PROMPT §5.8, §XI; SEC-14 on the device).
 *
 * 1. Ask for the manifest, revalidating with its integrity as the ETag. An unchanged release
 *    costs a 304 and no bytes.
 * 2. Fetch the farmer's own district first: only bundles whose integrity differs from what the
 *    phone holds. Each one must verify its hash, match the integrity the manifest lists (so two
 *    releases are never mixed), and pass the strict shared parser before it replaces anything.
 * 3. Then the shared bundles this district needs: crop dictionary, district registry, MSP and
 *    its climatology.
 *
 * A document that fails any check is dropped and logged. The phone keeps what it had, because
 * yesterday's verified price is better than today's unverifiable one. Other districts are not
 * fetched unless asked for.
 */
import { parseCropBundle, parseDemand, verifyIntegrity } from '@fasal/shared';

import { recordEvent, store, type ManifestEntry, type StoredManifest } from './db.js';
import { request } from './http.js';

export interface SyncReport {
  reached: boolean;
  release: string | null;
  fetched: string[];
  unchanged: string[];
  rejected: { name: string; reason: string }[];
  bytes: number;
}

type Doc = Record<string, unknown>;

const isRecord = (value: unknown): value is Doc => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Parse the served manifest, or null. Its integrity has already been verified. */
export function parseManifest(doc: Doc): Omit<StoredManifest, 'id' | 'storedAt'> | null {
  if (doc['kind'] !== 'manifest' || doc['schemaVersion'] !== 3) return null;
  const { version, asOf, dataSource, integrity, bundles, shared } = doc;
  if (typeof version !== 'string' || typeof asOf !== 'string' || typeof dataSource !== 'string' || typeof integrity !== 'string') return null;
  if (!Array.isArray(bundles) || !Array.isArray(shared)) return null;
  const entries: ManifestEntry[] = [];
  for (const b of bundles) {
    if (!isRecord(b) || typeof b['crop'] !== 'string' || typeof b['district'] !== 'string' || typeof b['integrity'] !== 'string' || typeof b['asOf'] !== 'string') return null;
    if (b['status'] !== 'published' && b['status'] !== 'insufficient') return null;
    entries.push({ crop: b['crop'], district: b['district'], status: b['status'], asOf: b['asOf'], integrity: b['integrity'], bytes: Number(b['bytes']) || 0, gzipBytes: Number(b['gzipBytes']) || 0 });
  }
  const sharedEntries: { name: string; integrity: string }[] = [];
  for (const s of shared) {
    if (!isRecord(s) || typeof s['name'] !== 'string' || typeof s['integrity'] !== 'string') return null;
    sharedEntries.push({ name: s['name'], integrity: s['integrity'] });
  }
  return { version, asOf, dataSource, integrity, bundles: entries, shared: sharedEntries };
}

const SLUG = /^[a-z0-9-]+$/;

/** Verify raw bytes: parseable JSON object whose content matches its own integrity and the manifest's. */
function verified(raw: string, expected: string): { ok: true; doc: Doc } | { ok: false; reason: string } {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'not JSON' };
  }
  if (!isRecord(doc)) return { ok: false, reason: 'not an object' };
  if (!verifyIntegrity(doc)) return { ok: false, reason: 'content does not match its integrity hash' };
  if (doc['integrity'] !== expected) return { ok: false, reason: 'not the document the manifest lists' };
  return { ok: true, doc };
}

/**
 * The district's buyer demand (FR-09), for a shortlist computed on the phone. Signed-in only.
 * Revalidated by its integrity as the ETag; a document is stored only after its hash verifies
 * and the strict shared parser accepts every field. Otherwise the phone keeps what it had.
 */
export async function syncDemand(district: string, now = Date.now()): Promise<'synced' | 'unchanged' | 'unreachable' | 'rejected'> {
  if (!SLUG.test(district)) throw new Error('A district id is a lower-case slug.');
  const db = store();
  const held = await db.demand.get(district);
  const got = await request<string>(`/api/demand/${district}`, { raw: true, headers: held ? { 'if-none-match': `"${held.integrity}"` } : {} });
  if (got.kind === 'unreachable') return 'unreachable';
  if (got.kind === 'not-modified') return 'unchanged';
  if (got.kind !== 'ok') {
    await recordEvent({ kind: 'server-error', subject: `demand/${district}`, detail: `${got.status} ${got.message}` }, now);
    return 'rejected';
  }
  let doc: unknown;
  try {
    doc = JSON.parse(got.body);
  } catch {
    doc = null;
  }
  if (!isRecord(doc) || !verifyIntegrity(doc)) {
    await recordEvent({ kind: 'integrity-rejected', subject: `demand/${district}`, detail: 'content does not match its integrity hash' }, now);
    return 'rejected';
  }
  try {
    const demand = parseDemand(doc);
    if (demand.district !== district) throw new Error('a document for another district');
    await db.demand.put({ district, asOf: demand.asOf, integrity: demand.integrity, storedAt: now, demand });
    return 'synced';
  } catch (error) {
    await recordEvent({ kind: 'shape-rejected', subject: `demand/${district}`, detail: error instanceof Error ? error.message : 'unreadable' }, now);
    return 'rejected';
  }
}

export async function syncDistrict(district: string, now = Date.now()): Promise<SyncReport> {
  const report: SyncReport = { reached: false, release: null, fetched: [], unchanged: [], rejected: [], bytes: 0 };
  if (!SLUG.test(district)) throw new Error('A district id is a lower-case slug.');
  const db = store();
  const held = await db.manifest.get('current');

  const response = await request<string>('/api/bundles/manifest', { raw: true, auth: false, headers: held ? { 'if-none-match': `"${held.integrity}"` } : {} });
  if (response.kind === 'unreachable') {
    await recordEvent({ kind: 'unreachable', subject: 'manifest', detail: response.reason }, now);
    return report;
  }
  if (response.kind === 'rejected' || response.kind === 'failed') {
    report.reached = true;
    await recordEvent({ kind: 'server-error', subject: 'manifest', detail: `${response.status} ${response.message}` }, now);
    return report;
  }
  report.reached = true;

  let manifest: Omit<StoredManifest, 'id' | 'storedAt'>;
  if (response.kind === 'not-modified') {
    if (held === undefined) return report;
    manifest = held;
  } else {
    report.bytes += response.body.length;
    let doc: unknown;
    try {
      doc = JSON.parse(response.body);
    } catch {
      doc = null;
    }
    const parsed = isRecord(doc) && verifyIntegrity(doc) ? parseManifest(doc) : null;
    if (parsed === null) {
      report.rejected.push({ name: 'manifest', reason: 'failed its integrity or shape check' });
      await recordEvent({ kind: 'integrity-rejected', subject: 'manifest', detail: 'the manifest failed its integrity or shape check' }, now);
      return report;
    }
    manifest = parsed;
    await db.manifest.put({ id: 'current', ...manifest, storedAt: now });
  }
  report.release = manifest.version;

  // 1 · the farmer's own district
  const wanted = manifest.bundles.filter((b) => b.district === district);
  for (const entry of wanted) {
    const key = `${entry.crop}|${entry.district}`;
    const have = await db.bundles.get(key);
    if (have?.integrity === entry.integrity) {
      report.unchanged.push(key);
      continue;
    }
    const got = await request<string>(`/api/bundles/${entry.crop}/${entry.district}`, { raw: true, auth: false });
    if (got.kind !== 'ok') {
      report.rejected.push({ name: key, reason: got.kind });
      continue;
    }
    report.bytes += got.body.length;
    const check = verified(got.body, entry.integrity);
    if (!check.ok) {
      report.rejected.push({ name: key, reason: check.reason });
      await recordEvent({ kind: 'integrity-rejected', subject: key, detail: check.reason }, now);
      continue;
    }
    try {
      const bundle = parseCropBundle(check.doc);
      await db.bundles.put({ key, crop: bundle.crop, district: bundle.district, version: bundle.version, asOf: bundle.asOf, integrity: bundle.integrity, storedAt: now, bundle });
      report.fetched.push(key);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unreadable';
      report.rejected.push({ name: key, reason });
      await recordEvent({ kind: 'shape-rejected', subject: key, detail: reason }, now);
    }
  }
  // A bundle the current release no longer lists belongs to another release: never mix them.
  const listed = new Set(wanted.map((b) => `${b.crop}|${b.district}`));
  const stale = (await db.bundles.where('district').equals(district).primaryKeys()).filter((key) => !listed.has(key));
  await db.bundles.bulkDelete(stale);

  // 2 · the shared bundles this district needs
  const sharedWanted = new Set(['crops', 'districts', 'msp', `climatology/${district}`]);
  for (const entry of manifest.shared.filter((s) => sharedWanted.has(s.name))) {
    const have = await db.shared.get(entry.name);
    if (have?.integrity === entry.integrity) {
      report.unchanged.push(entry.name);
      continue;
    }
    const got = await request<string>(`/api/bundles/shared/${entry.name}`, { raw: true, auth: false });
    if (got.kind !== 'ok') {
      report.rejected.push({ name: entry.name, reason: got.kind });
      continue;
    }
    report.bytes += got.body.length;
    const check = verified(got.body, entry.integrity);
    if (!check.ok) {
      report.rejected.push({ name: entry.name, reason: check.reason });
      await recordEvent({ kind: 'integrity-rejected', subject: entry.name, detail: check.reason }, now);
      continue;
    }
    await db.shared.put({ name: entry.name, version: String(check.doc['version']), integrity: entry.integrity, storedAt: now, document: check.doc });
    report.fetched.push(entry.name);
  }

  await recordEvent({ kind: report.fetched.length > 0 ? 'synced' : 'not-modified', subject: district, detail: `release ${manifest.version}: ${report.fetched.length} fetched, ${report.unchanged.length} unchanged, ${report.rejected.length} rejected` }, now);
  return report;
}
