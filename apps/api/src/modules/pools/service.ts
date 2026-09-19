/**
 * Aggregation: small lots that clear a buyer's minimum together (PROMPT §6.6; FR-09; L-3).
 *
 * Who may do what is the database's answer, not this module's:
 *   a coordinator (FPO) creates a consignment for one buyer requirement — `pools_insert`;
 *   a farmer adds their own opted-in, open listing to it, and removes it — `pool_members_join`,
 *   `pool_members_leave`. Nobody can pool another farmer's lot, so aggregation is opt-in twice
 *   over: the listing says it may be pooled, and the farmer joins. Whether the consignment has
 *   cleared belongs to neither of them: `app.pool_settle` derives it from the lots in it.
 *
 * What a consignment holds — contributors, volume, grade range, shared window — comes from
 * `app.pool_totals`, which returns sums and counts only: the membership rows themselves stay
 * private to each farmer and the coordinator, so nobody learns whose lots are in it.
 *
 * The clustering itself is @fasal/shared's `formPools`: crop is a hard filter, the grade floor
 * and the shared availability window apply, and lots are taken nearest-first around the
 * collection centre until the minimum clears — never past the buyer's maximum.
 *
 *   POST /api/pools               (fpo)    propose and open a consignment
 *   GET  /api/pools/open?listing= (farmer) consignments this lot could join, and what they need
 *   POST /api/pools/:id/join      (farmer) add my lot; the consignment clears when the volume does
 *   POST /api/pools/:id/leave     (farmer) take my lot out again
 *   GET  /api/pools/mine          (farmer) the consignments my lots are in, and my share of each
 */
import { formPools, type Grade, type PoolListing, type UnitWeights } from '@fasal/shared';
import type { PoolClient } from 'pg';
import { z } from 'zod';

import { withActor, type Actor, type Database } from '../../db/actor.js';
import { DomainError } from '../../http/errors.js';
import { cropIds } from '../listings/service.js';

/** How far from the collection centre a lot may sit and still be one consignment. */
export const POOL_RADIUS_KM = 25;

export interface PoolView {
  id: string;
  status: 'forming' | 'cleared' | 'dealt' | 'closed';
  crop: string;
  district: string;
  coordinator: { id: string; name: string; district: string } | null;
  buyer: { id: string; name: string; place: string };
  price: { amount: number; unit: string };
  /** The buyer's minimum and maximum, in kilograms. */
  needKg: number;
  maxKg: number;
  totalKg: number;
  shortfallKg: number;
  /** How many lots are in it. Whose they are is nobody else's business. */
  contributors: number;
  /** The caller's own lot in this consignment, read through their own row. */
  mine: { listingId: string; listingClientId: string; contributedKg: number; share: number } | null;
  gradeRange: { lowest: Grade; highest: Grade } | null;
  includesUngraded: boolean;
  window: { from: string; until: string } | null;
}

const KG: Readonly<Record<string, number>> = { kg: 1, quintal: 100, tonne: 1000 };

function kilograms(value: number, unit: string, weights: UnitWeights): number {
  const factor = KG[unit] ?? (unit === 'crate' ? (weights.crateKg ?? 0) : unit === 'bag' ? (weights.bagKg ?? 0) : 0);
  if (factor <= 0) throw new DomainError(422, 'UNIT_UNKNOWN', 'That quantity cannot be expressed in kilograms.');
  return value * factor;
}

interface PoolRow {
  id: string;
  status: PoolView['status'];
  crop: string;
  district: string;
  requirement_id: string;
  coordinator_id: string;
  coordinator_name: string | null;
  coordinator_district: string | null;
  buyer_id: string;
  buyer_name: string;
  buyer_place: string;
  price: string;
  price_unit: string;
  min_qty: string;
  min_qty_unit: string;
  max_qty: string;
  max_qty_unit: string;
}

const POOL_SELECT = `
  SELECT p.id, p.status, p.crop, p.district, p.requirement_id, p.coordinator_id,
         f.name AS coordinator_name, f.district AS coordinator_district,
         r.buyer_id, b.business_name AS buyer_name, b.place AS buyer_place,
         r.price, r.price_unit, r.min_qty, r.min_qty_unit, r.max_qty, r.max_qty_unit
    FROM app.aggregation_pools p
    JOIN app.buyer_requirements r ON r.id = p.requirement_id
    JOIN app.buyer_profiles b ON b.user_id = r.buyer_id
    LEFT JOIN app.fpos f ON f.user_id = p.coordinator_id`;

async function view(client: PoolClient, row: PoolRow, actor: Actor): Promise<PoolView> {
  const totals = await client.query<{ contributors: number; total_kg: string; best_grade: Grade | null; worst_grade: Grade | null; ungraded: number; window_from: string | null; window_until: string | null }>(
    'SELECT contributors, total_kg, best_grade, worst_grade, ungraded, window_from::text, window_until::text FROM app.pool_totals($1::uuid[])',
    [[row.id]],
  );
  const t = totals.rows[0];
  const own = await client.query<{ listing_id: string; client_id: string; contributed_kg: string }>(
    `SELECT m.listing_id, l.client_id, m.contributed_kg FROM app.aggregation_members m JOIN app.listings l ON l.id = m.listing_id
      WHERE m.pool_id = $1 AND m.farmer_id = $2`,
    [row.id, actor.userId],
  );
  const totalKg = Number(t?.total_kg ?? 0);
  const weights: UnitWeights = {};
  const needKg = kilograms(Number(row.min_qty), row.min_qty_unit, weights);
  const maxKg = kilograms(Number(row.max_qty), row.max_qty_unit, weights);
  return {
    id: row.id,
    status: row.status,
    crop: row.crop,
    district: row.district,
    coordinator: row.coordinator_name === null ? null : { id: row.coordinator_id, name: row.coordinator_name, district: row.coordinator_district ?? row.district },
    buyer: { id: row.buyer_id, name: row.buyer_name, place: row.buyer_place },
    price: { amount: Number(row.price), unit: row.price_unit },
    needKg,
    maxKg,
    totalKg,
    shortfallKg: Math.max(0, needKg - totalKg),
    contributors: t?.contributors ?? 0,
    mine: own.rows[0] === undefined ? null : { listingId: own.rows[0].listing_id, listingClientId: own.rows[0].client_id, contributedKg: Number(own.rows[0].contributed_kg), share: totalKg === 0 ? 0 : Number(own.rows[0].contributed_kg) / totalKg },
    // "Grade range B–A": the lowest grade in it first, as the buyer's consignment card reads.
    gradeRange: t?.best_grade == null || t.worst_grade == null ? null : { lowest: t.worst_grade, highest: t.best_grade },
    includesUngraded: (t?.ungraded ?? 0) > 0,
    window: t?.window_from == null || t.window_until == null ? null : { from: t.window_from, until: t.window_until },
  };
}

function farmerOnly(actor: Actor): void {
  if (actor.role !== 'farmer') throw new DomainError(403, 'FARMERS_ONLY', 'Only a farmer can put a lot into a consignment.');
}

/** The farmer's own listing, by the id their phone gave it. */
async function myListing(client: PoolClient, actor: Actor, clientId: string) {
  const { rows } = await client.query<{ id: string; crop: string; qty: string; qty_unit: string; grade: Grade | null; pool_opt_in: boolean; status: string; available_from: string; available_until: string; district: string }>(
    'SELECT id, crop, qty, qty_unit, grade, pool_opt_in, status, available_from::text, available_until::text, district FROM app.listings WHERE farmer_id = $1 AND client_id = $2',
    [actor.userId, clientId],
  );
  const listing = rows[0];
  if (listing === undefined) throw new DomainError(409, 'LISTING_NOT_YET_RECEIVED', 'That lot has not reached the server yet.');
  return listing;
}

export const JoinBody = z.object({ listingClientId: z.string().min(8).max(64) }).strict();
export const OpenQuery = z.object({ listing: z.string().min(8).max(64) }).strict();
export const CreateBody = z.object({ requirementId: z.uuid(), radiusKm: z.number().min(1).max(200).default(POOL_RADIUS_KM) }).strict();

/** Consignments this lot could join: forming, same crop and district, with room left. */
export async function openPools(db: Database, actor: Actor, listingClientId: string): Promise<PoolView[]> {
  farmerOnly(actor);
  return withActor(db, actor, async (client) => {
    const listing = await myListing(client, actor, listingClientId);
    if (!listing.pool_opt_in || listing.status !== 'open') return [];
    const { rows } = await client.query<PoolRow>(`${POOL_SELECT} WHERE p.status = 'forming' AND p.crop = $1 AND p.district = $2 ORDER BY p.created_at`, [listing.crop, listing.district]);
    const views = await Promise.all(rows.map((row) => view(client, row, actor)));
    const lotKg = kilograms(Number(listing.qty), listing.qty_unit, {});
    return views.filter((v) => {
      if (v.mine !== null) return false;
      if (v.totalKg >= v.maxKg) return false;
      const overlaps = v.window === null || (listing.available_from <= v.window.until && listing.available_until >= v.window.from);
      return overlaps && lotKg > 0;
    });
  });
}

export async function myPools(db: Database, actor: Actor): Promise<PoolView[]> {
  farmerOnly(actor);
  return withActor(db, actor, async (client) => {
    const { rows } = await client.query<PoolRow>(
      `${POOL_SELECT} WHERE EXISTS (SELECT 1 FROM app.aggregation_members m WHERE m.pool_id = p.id AND m.farmer_id = $1) ORDER BY p.created_at DESC`,
      [actor.userId],
    );
    return Promise.all(rows.map((row) => view(client, row, actor)));
  });
}

async function poolRow(client: PoolClient, poolId: string): Promise<PoolRow> {
  const { rows } = await client.query<PoolRow>(`${POOL_SELECT} WHERE p.id = $1`, [poolId]);
  const row = rows[0];
  if (row === undefined) throw new DomainError(404, 'NO_SUCH_POOL', 'There is no such consignment.');
  return row;
}

/** Add the farmer's lot; the consignment clears the moment the volume does. */
export async function joinPool(db: Database, actor: Actor, poolId: string, listingClientId: string): Promise<PoolView> {
  farmerOnly(actor);
  return withActor(db, actor, async (client) => {
    const row = await poolRow(client, poolId);
    if (row.status !== 'forming') throw new DomainError(409, 'POOL_CLOSED', 'That consignment is no longer taking lots.');
    const listing = await myListing(client, actor, listingClientId);
    if (!listing.pool_opt_in) throw new DomainError(422, 'NOT_OPTED_IN', 'This lot is not offered for group sale. Change the listing first.');
    if (listing.status !== 'open') throw new DomainError(422, 'LISTING_NOT_OPEN', 'This lot is no longer open.');
    if (listing.crop !== row.crop) throw new DomainError(422, 'CROP_MISMATCH', 'That consignment is for another crop.');
    const before = await view(client, row, actor);
    if (before.totalKg >= before.maxKg) throw new DomainError(409, 'POOL_FULL', 'That consignment is already full.');
    const lotKg = kilograms(Number(listing.qty), listing.qty_unit, {});
    const contributed = Math.min(lotKg, before.maxKg - before.totalKg);
    try {
      await client.query('INSERT INTO app.aggregation_members (pool_id, listing_id, farmer_id, contributed_kg) VALUES ($1, $2, $3, $4)', [poolId, listing.id, actor.userId, contributed]);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new DomainError(409, 'ALREADY_IN_POOL', 'This lot is already in that consignment.');
      throw error;
    }
    // Clearing is the database's to decide and the database's to record (migration 0010): a
    // farmer may not update a consignment, so the status is read back, never asserted here.
    await client.query('SELECT app.pool_settle($1)', [poolId]);
    return view(client, await poolRow(client, poolId), actor);
  });
}

export async function leavePool(db: Database, actor: Actor, poolId: string, listingClientId: string): Promise<PoolView> {
  farmerOnly(actor);
  return withActor(db, actor, async (client) => {
    const row = await poolRow(client, poolId);
    if (row.status === 'dealt' || row.status === 'closed') throw new DomainError(409, 'POOL_CLOSED', 'That consignment has already been sold.');
    const listing = await myListing(client, actor, listingClientId);
    const deleted = await client.query('DELETE FROM app.aggregation_members WHERE pool_id = $1 AND listing_id = $2', [poolId, listing.id]);
    if (deleted.rowCount === 0) throw new DomainError(404, 'NOT_IN_POOL', 'This lot is not in that consignment.');
    // Falling back below the minimum re-opens it: the buyer's minimum is the whole point.
    await client.query('SELECT app.pool_settle($1)', [poolId]);
    return view(client, await poolRow(client, poolId), actor);
  });
}

export interface PoolProposal {
  pool: PoolView | null;
  /** What the clustering engine says could be gathered for this requirement, from opted-in lots. */
  couldGather: { listings: number; totalKg: number; shortfallKg: number };
}

/** A coordinator opens a consignment for one requirement, having seen what could be gathered. */
export async function createPool(db: Database, actor: Actor, body: z.infer<typeof CreateBody>): Promise<PoolProposal> {
  if (actor.role !== 'fpo') throw new DomainError(403, 'COORDINATORS_ONLY', 'Only a producer company coordinates a consignment.');
  return withActor(db, actor, async (client) => {
    const fpo = await client.query<{ district: string; lat: number; lon: number }>('SELECT district, location_lat AS lat, location_lon AS lon FROM app.fpos WHERE user_id = $1', [actor.userId]);
    const centre = fpo.rows[0];
    if (centre === undefined) throw new DomainError(409, 'NO_COLLECTION_CENTRE', 'This account has no collection centre recorded.');
    const requirement = await client.query<{
      id: string; crop: string; grade_floor: Grade | null; min_qty: string; min_qty_unit: string; max_qty: string; max_qty_unit: string; price: string; price_unit: string;
      district: string; location_lat: number; location_lon: number; radius_km: string; valid_from: string; valid_until: string; buyer_id: string;
    }>(
      `SELECT id, crop, grade_floor, min_qty, min_qty_unit, max_qty, max_qty_unit, price, price_unit, district, location_lat, location_lon, radius_km,
              valid_from::text, valid_until::text, buyer_id
         FROM app.buyer_requirements WHERE id = $1 AND active`,
      [body.requirementId],
    );
    const r = requirement.rows[0];
    if (r === undefined) throw new DomainError(404, 'NO_SUCH_REQUIREMENT', 'There is no such open requirement.');
    if (!cropIds().has(r.crop)) throw new DomainError(422, 'UNKNOWN_CROP', 'That requirement names a crop this service does not know.');

    const open = await client.query<{ id: string; farmer_id: string; crop: string; variety: string | null; grade: Grade | null; qty: string; qty_unit: string; available_from: string; available_until: string; lat: number | null; lon: number | null }>(
      `SELECT l.id, l.farmer_id, l.crop, l.variety, l.grade, l.qty, l.qty_unit, l.available_from::text, l.available_until::text,
              COALESCE(l.location_lat, $2) AS lat, COALESCE(l.location_lon, $3) AS lon
         FROM app.listings l
        WHERE l.status = 'open' AND l.pool_opt_in AND l.crop = $1 AND l.district = $4`,
      [r.crop, centre.lat, centre.lon, centre.district],
    );
    const listings: PoolListing[] = open.rows.map((l) => ({
      listingId: l.id,
      farmerId: l.farmer_id,
      crop: l.crop,
      ...(l.variety === null ? {} : { variety: l.variety }),
      grade: l.grade,
      quantity: { value: Number(l.qty), unit: l.qty_unit as 'kg' | 'quintal' | 'tonne' | 'crate' | 'bag' },
      location: { lat: l.lat ?? centre.lat, lon: l.lon ?? centre.lon },
      availableFrom: l.available_from,
      availableUntil: l.available_until,
      optedIn: true,
    }));
    const result = formPools(
      listings,
      {
        id: r.id,
        buyerId: r.buyer_id,
        crop: r.crop,
        gradeFloor: r.grade_floor,
        minQuantity: { value: Number(r.min_qty), unit: r.min_qty_unit as 'kg' | 'quintal' | 'tonne' | 'crate' | 'bag' },
        maxQuantity: { value: Number(r.max_qty), unit: r.max_qty_unit as 'kg' | 'quintal' | 'tonne' | 'crate' | 'bag' },
        price: { amount: Number(r.price), unit: r.price_unit as 'kg' | 'quintal' | 'tonne' | 'crate' },
        location: { lat: r.location_lat, lon: r.location_lon },
        district: r.district,
        radiusKm: Number(r.radius_km),
        validFrom: r.valid_from,
        validUntil: r.valid_until,
      },
      { radiusKm: body.radiusKm, coordinator: { kind: 'fpo', id: actor.userId, name: '', location: { lat: centre.lat, lon: centre.lon } }, weights: {} },
    );
    const best = result.pools[0];
    const couldGather = {
      listings: best?.members.length ?? 0,
      totalKg: best?.totalKg ?? result.shortfall?.availableKg ?? 0,
      shortfallKg: best === undefined ? (result.shortfall?.neededKg ?? 0) : 0,
    };

    const existing = await client.query<PoolRow>(`${POOL_SELECT} WHERE p.requirement_id = $1 AND p.coordinator_id = $2 AND p.status IN ('forming', 'cleared')`, [r.id, actor.userId]);
    const already = existing.rows[0];
    if (already !== undefined) return { pool: await view(client, already, actor), couldGather };

    const created = await client.query<{ id: string }>(
      "INSERT INTO app.aggregation_pools (requirement_id, coordinator_id, crop, district, status) VALUES ($1, $2, $3, $4, 'forming') RETURNING id",
      [r.id, actor.userId, r.crop, centre.district],
    );
    return { pool: await view(client, await poolRow(client, created.rows[0]!.id), actor), couldGather };
  });
}
