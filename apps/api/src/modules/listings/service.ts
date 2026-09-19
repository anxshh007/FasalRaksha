/**
 * Listings (FR-10; P1-02, P1-03, P1-04). A listing arrives through the outbox, often composed
 * offline hours earlier, and is stored exactly as the farmer stated it:
 *
 *   the quantity keeps its own unit: 5 quintal stays 5 quintal, never 500 kg (P1-02);
 *   a price is stored only with the basis it was stated on, since the schema forbids a bare
 *   number, and the app has already asked the farmer when the basis was unclear (P1-03);
 *   the district is the farmer's verified district, set by the database trigger, never the
 *   phone's claim (P1-04).
 *
 * The crop must be one the dictionary knows, and the client's id is the idempotency anchor:
 * the same draft sent twice is the same listing.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { CropProfile, OutboxEntry } from '@fasal/shared';
import type { PoolClient } from 'pg';

import { withActor, type Actor, type Database } from '../../db/actor.js';
import { DomainError } from '../../http/errors.js';

let knownCrops: Set<string> | null = null;

/** Crop ids from the shipped dictionary (data/reference/crops.json), read once. */
export function cropIds(): Set<string> {
  if (knownCrops === null) {
    const path = resolve(import.meta.dirname, '../../../../../data/reference/crops.json');
    const dictionary = JSON.parse(readFileSync(path, 'utf8')) as { crops: CropProfile[] };
    knownCrops = new Set(dictionary.crops.map((c) => c.id));
  }
  return knownCrops;
}

function farmerOnly(actor: Actor): void {
  if (actor.role !== 'farmer') throw new DomainError(403, 'FARMERS_ONLY', 'Only a farmer can list a crop for sale.');
}

type ListingEntry = Extract<OutboxEntry, { kind: 'listing.create' | 'listing.update' | 'listing.renew' }>;

export async function applyListing(client: PoolClient, actor: Actor, entry: ListingEntry): Promise<{ status: number; body: Record<string, unknown> }> {
  farmerOnly(actor);
  if (entry.kind === 'listing.create') {
    const l = entry.listing;
    if (!cropIds().has(l.crop)) throw new DomainError(422, 'UNKNOWN_CROP', `"${l.crop}" is not a crop this service knows. Choose one from the list.`);
    if (l.availableUntil < l.availableFrom) throw new DomainError(422, 'DATES_REVERSED', 'The last day the crop is available is before the first.');
    try {
      const { rows } = await client.query<{ id: string; district: string }>(
        `INSERT INTO app.listings (client_id, farmer_id, crop, variety, qty, qty_unit, asking_price, asking_unit, grade, grade_provenance,
                                   available_from, available_until, pool_opt_in, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id, district`,
        [
          l.clientId, actor.userId, l.crop, l.variety ?? null, l.quantity.value, l.quantity.unit, l.askingPrice?.amount ?? null, l.askingPrice?.unit ?? null,
          l.grade, l.gradeProvenance, l.availableFrom, l.availableUntil, l.poolOptIn, l.note ?? null,
        ],
      );
      const row = rows[0];
      return { status: 201, body: { kind: entry.kind, id: row?.id ?? null, clientId: l.clientId, district: row?.district ?? null } };
    } catch (error) {
      if ((error as { code?: string }).code === '42501') {
        throw new DomainError(403, 'VERIFY_FIRST', 'Verify your farmer ID first, so the listing is tied to your district.');
      }
      if ((error as { code?: string }).code === '23505') throw new DomainError(409, 'LISTING_EXISTS', 'This listing was already received.');
      throw error;
    }
  }

  const found = await client.query<{ id: string }>('SELECT id FROM app.listings WHERE farmer_id = $1 AND client_id = $2', [actor.userId, entry.listingClientId]);
  const id = found.rows[0]?.id;
  // The create may still be queued behind this entry: 409 keeps the update on the phone for a retry.
  if (id === undefined) throw new DomainError(409, 'LISTING_NOT_YET_RECEIVED', 'The listing this change belongs to has not reached the server yet.');

  if (entry.kind === 'listing.renew') {
    await client.query("UPDATE app.listings SET available_until = $2, status = 'open' WHERE id = $1", [id, entry.availableUntil]);
    return { status: 200, body: { kind: entry.kind, id, availableUntil: entry.availableUntil } };
  }

  const c = entry.changes;
  const sets: string[] = [];
  const values: unknown[] = [id];
  const set = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if (c.quantity !== undefined) {
    set('qty', c.quantity.value);
    set('qty_unit', c.quantity.unit);
  }
  if (c.askingPrice !== undefined) {
    set('asking_price', c.askingPrice?.amount ?? null);
    set('asking_unit', c.askingPrice?.unit ?? null);
  }
  if (c.grade !== undefined) set('grade', c.grade);
  if (c.gradeProvenance !== undefined) set('grade_provenance', c.gradeProvenance);
  if (c.availableUntil !== undefined) set('available_until', c.availableUntil);
  if (c.poolOptIn !== undefined) set('pool_opt_in', c.poolOptIn);
  if (c.note !== undefined) set('note', c.note ?? null);
  if (sets.length > 0) await client.query(`UPDATE app.listings SET ${sets.join(', ')} WHERE id = $1`, values);
  return { status: 200, body: { kind: entry.kind, id, changed: sets.length } };
}

export interface ListingView {
  id: string;
  clientId: string;
  crop: string;
  quantity: { value: number; unit: string };
  askingPrice: { amount: number; unit: string } | null;
  district: string;
  availableFrom: string;
  availableUntil: string;
  poolOptIn: boolean;
  status: string;
  createdAt: string;
}

export async function listMine(db: Database, actor: Actor): Promise<ListingView[]> {
  farmerOnly(actor);
  return withActor(db, actor, async (client) => {
    const { rows } = await client.query<{
      id: string; client_id: string; crop: string; qty: string; qty_unit: string; asking_price: string | null; asking_unit: string | null;
      district: string; available_from: string; available_until: string; pool_opt_in: boolean; status: string; created_at: Date;
    }>(
      // Dates as text: node-pg turns a DATE into local midnight, which is the previous day in UTC.
      `SELECT id, client_id, crop, qty, qty_unit, asking_price, asking_unit, district, available_from::text, available_until::text, pool_opt_in, status, created_at
         FROM app.listings WHERE farmer_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [actor.userId],
    );
    return rows.map((r) => ({
      id: r.id,
      clientId: r.client_id,
      crop: r.crop,
      quantity: { value: Number(r.qty), unit: r.qty_unit },
      askingPrice: r.asking_price === null || r.asking_unit === null ? null : { amount: Number(r.asking_price), unit: r.asking_unit },
      district: r.district,
      availableFrom: r.available_from,
      availableUntil: r.available_until,
      poolOptIn: r.pool_opt_in,
      status: r.status,
      createdAt: r.created_at.toISOString(),
    }));
  });
}
