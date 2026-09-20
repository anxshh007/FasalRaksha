/**
 * Offers, the negotiation, and the sauda slip (PROMPT §8.9, §9.9.4; FR-12; Gate G).
 *
 * Every transition is applied here, on the server, by @fasal/shared's `transition` — the same
 * pure function the phone uses to decide which buttons to show. The phone's answer is advice for
 * the interface; this one is what happened. Three layers have to agree before a deal moves:
 *
 *   the engine       `transition(deal, event, actor)` — whose turn it is, and what may follow;
 *   the database     `deals_guard`, which refuses a state pair it does not recognise, a price
 *                    changed outside a counter, or a version that did not increase by one;
 *   the policies     `deals_open`, `deals_update` — a verified buyer opens a deal on an open
 *                    listing, and only the two parties touch it afterwards.
 *
 * Acceptance is not a message; it is a transaction. In the same transaction the deal becomes
 * ACCEPTED, the server issues the sauda slip (the engine's one system-only event), freezes what
 * was agreed into it, and the database closes the lot behind it (migration 0011). A client that
 * cannot reach the server cannot do any of this, which is Gate G: there is no offline path to a
 * transition, in the types (`OutboxEntry`) or here.
 */
import {
  availableEvents,
  estimateFreight,
  roadKm,
  transition,
  typicalDaysToPay,
  type Actor as DealActor,
  type Deal,
  type DealEvent,
  type DealState,
  type DealTerms,
  type DistrictRegistry,
  type Grade,
  type TransportTariff,
} from '@fasal/shared';
import type { PoolClient } from 'pg';
import { z } from 'zod';

import { withActor, type Actor, type Database } from '../../db/actor.js';
import { DomainError } from '../../http/errors.js';
import { cropBundle } from '../bundles/store.js';
import { districtRegistry } from '../demand/service.js';

const KG: Readonly<Record<string, number>> = { kg: 1, quintal: 100, tonne: 1000 };
const PRICE_UNITS = ['kg', 'quintal', 'tonne', 'crate', 'lot'] as const;
const QUANTITY_UNITS = ['kg', 'quintal', 'tonne', 'crate', 'bag'] as const;

const Terms = z
  .object({
    price: z.object({ amount: z.number().positive().max(10_000_000), unit: z.enum(PRICE_UNITS) }).strict(),
    quantity: z.object({ value: z.number().positive().max(1_000_000), unit: z.enum(QUANTITY_UNITS) }).strict(),
  })
  .strict();
export const OfferBody = Terms.extend({ listingId: z.uuid() }).strict();
export const CounterBody = Terms;
export const AcknowledgeBody = z.object({ reason: z.string().trim().min(1).max(200) }).strict();

export interface SlipParty {
  name: string;
  place: string;
}

/** Frozen at acceptance; never recomputed. What the two parties agreed, and what it was measured against. */
export interface SaudaSlip {
  slipNo: string;
  issuedAt: string;
  dealId: string;
  seller: SlipParty & { kind: 'farmer' | 'fpo' };
  buyer: SlipParty & { verified: boolean; demonstration: boolean };
  crop: string;
  quantity: { value: number; unit: string };
  grade: { grade: Grade; provenance: string } | null;
  /** The district benchmark on the day of sale: the number the price can be judged against. */
  benchmark: { modalPerQtl: number; market: string; district: string; asOf: string } | null;
  price: { amount: number; unit: string };
  grossValue: number | null;
  freight: { total: number; vehicleClass: string; trips: number; roadKm: number } | null;
  /** Not a promise by the buyer: what their completed deals show, and how many there are. */
  paymentRecord: { typicalDays: number | null; completedDeals: number };
  pickup: { arrangedBy: 'phone'; note: string };
  /** Present when the seller is a consignment: what each contributing lot is owed, by volume. */
  split: { contributors: number; totalKg: number; shares: Array<{ contributedKg: number; amount: number | null }> } | null;
  disputeFrom: 'delivery-confirmed';
  district: string;
}

export interface DealView {
  id: string;
  state: DealState;
  /** 'seller' or 'buyer' — which side of this deal the caller is on. */
  you: 'seller' | 'buyer';
  listingId: string | null;
  listingClientId: string | null;
  poolId: string | null;
  crop: string;
  buyer: { id: string; name: string; place: string; verified: boolean; demonstration: boolean };
  seller: { id: string; name: string; kind: 'farmer' | 'fpo' };
  terms: { price: { amount: number; unit: string }; quantity: { value: number; unit: string } };
  lastPriceBy: 'seller' | 'buyer';
  /** The district benchmark when the offer was made, so the price has something beside it. */
  benchmarkAtOffer: { modalPerQtl: number; asOf: string } | null;
  paymentRecord: { typicalDays: number | null; completedDeals: number };
  history: Array<{ type: string; by: 'seller' | 'buyer'; price: { amount: number; unit: string }; quantity: { value: number; unit: string }; at: string }>;
  slip: SaudaSlip | null;
  /** What this caller could do next, for the interface only. The server decides what happens. */
  youCan: DealEvent['type'][];
  version: number;
  updatedAt: string;
}

interface DealRow {
  id: string;
  listing_id: string | null;
  listing_client_id: string | null;
  listing_grade: Grade | null;
  listing_provenance: string | null;
  pool_id: string | null;
  seller_id: string;
  seller_kind: 'farmer' | 'fpo';
  seller_name: string | null;
  buyer_id: string;
  buyer_name: string;
  buyer_place: string;
  buyer_demonstration: boolean;
  buyer_verified: boolean;
  district: string;
  state: DealState;
  crop: string;
  price: string;
  price_unit: string;
  qty: string;
  qty_unit: string;
  last_price_by: 'seller' | 'buyer';
  delivery_seller: boolean;
  delivery_buyer: boolean;
  rated_seller: boolean;
  rated_buyer: boolean;
  version: number;
  updated_at: Date;
}

const DEAL_SELECT = `
  SELECT d.id, d.listing_id, l.client_id AS listing_client_id, l.grade AS listing_grade, l.grade_provenance AS listing_provenance,
         d.pool_id, d.seller_id, d.seller_kind,
         COALESCE(f.display_name, fp.name) AS seller_name,
         d.buyer_id, b.business_name AS buyer_name, b.place AS buyer_place, b.demonstration AS buyer_demonstration,
         app.is_verified_buyer(d.buyer_id) AS buyer_verified,
         d.district, d.state, COALESCE(l.crop, p.crop) AS crop,
         d.price, d.price_unit, d.qty, d.qty_unit, d.last_price_by,
         d.delivery_seller, d.delivery_buyer, d.rated_seller, d.rated_buyer, d.version, d.updated_at
    FROM app.deals d
    JOIN app.buyer_profiles b ON b.user_id = d.buyer_id
    LEFT JOIN app.listings l ON l.id = d.listing_id
    LEFT JOIN app.aggregation_pools p ON p.id = d.pool_id
    LEFT JOIN app.farmer_profiles f ON f.user_id = d.seller_id
    LEFT JOIN app.fpos fp ON fp.user_id = d.seller_id`;

/** The shared engine's view of a row: the same shape the phone reasons about. */
function asDeal(row: DealRow): Deal {
  return {
    id: row.id,
    listingId: row.listing_id ?? row.pool_id ?? '',
    sellerId: row.seller_id,
    sellerKind: row.seller_kind,
    buyerId: row.buyer_id,
    district: row.district,
    state: row.state,
    terms: {
      price: { amount: Number(row.price), unit: row.price_unit as DealTerms['price']['unit'] },
      quantity: { value: Number(row.qty), unit: row.qty_unit as DealTerms['quantity']['unit'] },
    },
    lastPriceBy: row.last_price_by,
    deliveryConfirmedBy: { seller: row.delivery_seller, buyer: row.delivery_buyer },
    ratedBy: { seller: row.rated_seller, buyer: row.rated_buyer },
    dispute: null,
    version: row.version,
    events: [],
  };
}

function dealActor(actor: Actor, row: DealRow): DealActor {
  return { kind: actor.role, id: actor.userId, verified: actor.role === 'buyer' ? row.buyer_verified : true };
}

function refuse(code: string, message: string): never {
  const status = code === 'NOT_A_PARTY' || code === 'UNVERIFIED_BUYER' ? 403 : code === 'INVALID_TERMS' ? 422 : 409;
  throw new DomainError(status, code, message);
}

function kilograms(value: number, unit: string): number | null {
  const factor = KG[unit];
  return factor === undefined ? null : value * factor;
}

/** The whole lot's value, when the price basis can be multiplied by the quantity. */
function grossValue(price: { amount: number; unit: string }, quantity: { value: number; unit: string }): number | null {
  if (price.unit === 'lot') return price.amount;
  const kg = kilograms(quantity.value, quantity.unit);
  const per = KG[price.unit];
  if (kg === null || per === undefined) return null;
  return Math.round((kg / per) * price.amount);
}

interface Bundle {
  benchmark: { modal: number };
  asOf: string;
  /** The market the benchmark was taken in, by id: 'lasalgaon'. */
  market: string;
  transport: TransportTariff[];
}

async function bundleFor(db: Database, crop: string, district: string): Promise<Bundle | null> {
  try {
    // The bundle is served as canonical JSON and its integrity is checked on the way out of the
    // store, so what is parsed here is the same verified document the phone receives.
    return JSON.parse((await cropBundle(db, crop, district)).body) as Bundle;
  } catch {
    return null; // a crop with no published bundle for this district: the slip says so by omission
  }
}

async function paymentRecord(client: PoolClient, buyerId: string): Promise<{ typicalDays: number | null; completedDeals: number }> {
  const { rows } = await client.query<{ completed_deals: number; payment_days: number[]; defaults: number; default_exposure_days: number }>(
    'SELECT * FROM app.buyer_track_records($1::uuid[])',
    [[buyerId]],
  );
  const r = rows[0];
  if (r === undefined) return { typicalDays: null, completedDeals: 0 };
  return {
    typicalDays: typicalDaysToPay({ completedDeals: r.completed_deals, paymentDays: r.payment_days, defaults: r.defaults, defaultExposureDays: r.default_exposure_days, openDisputes: 0 }),
    completedDeals: r.completed_deals,
  };
}

async function history(client: PoolClient, dealId: string): Promise<DealView['history']> {
  const offer = await client.query<{ price: string; price_unit: string; qty: string; qty_unit: string; created_at: Date }>(
    'SELECT price, price_unit, qty, qty_unit, created_at FROM app.offers WHERE deal_id = $1',
    [dealId],
  );
  const counters = await client.query<{ by_party: 'seller' | 'buyer'; price: string; price_unit: string; qty: string; qty_unit: string; created_at: Date }>(
    'SELECT by_party, price, price_unit, qty, qty_unit, created_at FROM app.counters WHERE deal_id = $1 ORDER BY created_at',
    [dealId],
  );
  const line = (type: string, by: 'seller' | 'buyer', r: { price: string; price_unit: string; qty: string; qty_unit: string; created_at: Date }) => ({
    type,
    by,
    price: { amount: Number(r.price), unit: r.price_unit },
    quantity: { value: Number(r.qty), unit: r.qty_unit },
    at: r.created_at.toISOString(),
  });
  return [...offer.rows.map((r) => line('OFFER', 'buyer' as const, r)), ...counters.rows.map((r) => line('COUNTER', r.by_party, r))];
}

async function slipOf(client: PoolClient, dealId: string): Promise<SaudaSlip | null> {
  const { rows } = await client.query<{ slip_no: string; payload: SaudaSlip; issued_at: Date }>(
    'SELECT slip_no, payload, issued_at FROM app.sauda_slips WHERE deal_id = $1',
    [dealId],
  );
  const slip = rows[0];
  return slip === undefined ? null : { ...slip.payload, slipNo: slip.slip_no, issuedAt: slip.issued_at.toISOString() };
}

async function view(client: PoolClient, row: DealRow, actor: Actor): Promise<DealView> {
  const deal = asDeal(row);
  const benchmark = await client.query<{ benchmark_modal: string | null; benchmark_as_of: string | null }>(
    'SELECT benchmark_modal, benchmark_as_of::text FROM app.offers WHERE deal_id = $1',
    [row.id],
  );
  const b = benchmark.rows[0];
  return {
    id: row.id,
    state: row.state,
    you: row.seller_id === actor.userId ? 'seller' : 'buyer',
    listingId: row.listing_id,
    listingClientId: row.listing_client_id,
    poolId: row.pool_id,
    crop: row.crop,
    buyer: { id: row.buyer_id, name: row.buyer_name, place: row.buyer_place, verified: row.buyer_verified, demonstration: row.buyer_demonstration },
    seller: { id: row.seller_id, name: row.seller_name ?? '', kind: row.seller_kind },
    terms: deal.terms ?? { price: { amount: 0, unit: 'quintal' }, quantity: { value: 0, unit: 'quintal' } },
    lastPriceBy: row.last_price_by,
    benchmarkAtOffer: b?.benchmark_modal == null || b.benchmark_as_of == null ? null : { modalPerQtl: Number(b.benchmark_modal), asOf: b.benchmark_as_of },
    paymentRecord: await paymentRecord(client, row.buyer_id),
    history: await history(client, row.id),
    slip: await slipOf(client, row.id),
    youCan: availableEvents(deal, dealActor(actor, row)),
    version: row.version,
    updatedAt: row.updated_at.toISOString(),
  };
}

async function rowById(client: PoolClient, dealId: string): Promise<DealRow> {
  const { rows } = await client.query<DealRow>(`${DEAL_SELECT} WHERE d.id = $1`, [dealId]);
  const row = rows[0];
  if (row === undefined) throw new DomainError(404, 'NO_SUCH_DEAL', 'There is no such deal, or it is not yours.');
  return row;
}

/** Apply one event through the engine, then write exactly what the engine produced. */
async function apply(client: PoolClient, row: DealRow, event: DealEvent, actor: DealActor, at: Date): Promise<Deal> {
  const result = transition(asDeal(row), event, actor, at.toISOString());
  if (!result.ok) refuse(result.error.code, result.error.message);
  const next = result.deal;
  const terms = next.terms ?? { price: { amount: Number(row.price), unit: row.price_unit }, quantity: { value: Number(row.qty), unit: row.qty_unit } };
  const { rowCount } = await client.query(
    `UPDATE app.deals SET state = $1, price = $2, price_unit = $3, qty = $4, qty_unit = $5, last_price_by = $6, version = $7
      WHERE id = $8 AND version = $9`,
    [next.state, terms.price.amount, terms.price.unit, terms.quantity.value, terms.quantity.unit, next.lastPriceBy, next.version, row.id, row.version],
  );
  if (rowCount === 0) throw new DomainError(409, 'DEAL_MOVED', 'This deal changed while you were looking at it. Open it again.');
  return next;
}

/** A buyer opens a deal by offering on an open listing (the only way a deal begins). */
export async function makeOffer(db: Database, actor: Actor, body: z.infer<typeof OfferBody>, now: Date): Promise<DealView> {
  if (actor.role !== 'buyer') throw new DomainError(403, 'BUYERS_ONLY', 'Only a buyer can make an offer on a lot.');
  const listing = await withActor(db, actor, async (client) => {
    const { rows } = await client.query<{ id: string; farmer_id: string; crop: string; district: string; status: string }>(
      'SELECT id, farmer_id, crop, district, status FROM app.listings WHERE id = $1',
      [body.listingId],
    );
    return rows[0];
  });
  if (listing === undefined) throw new DomainError(404, 'NO_SUCH_LISTING', 'There is no such lot.');
  if (listing.status !== 'open') throw new DomainError(409, 'LISTING_NOT_OPEN', 'That lot is no longer open.');
  const bundle = await bundleFor(db, listing.crop, listing.district);

  return withActor(db, actor, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO app.deals (listing_id, seller_id, seller_kind, buyer_id, district, state, price, price_unit, qty, qty_unit, last_price_by, version)
       VALUES ($1, $2, 'farmer', $3, $4, 'OFFERED', $5, $6, $7, $8, 'buyer', 1) RETURNING id`,
      [listing.id, listing.farmer_id, actor.userId, listing.district, body.price.amount, body.price.unit, body.quantity.value, body.quantity.unit],
    );
    const dealId = rows[0]!.id;
    await client.query(
      `INSERT INTO app.offers (deal_id, buyer_id, price, price_unit, qty, qty_unit, benchmark_modal, benchmark_as_of, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [dealId, actor.userId, body.price.amount, body.price.unit, body.quantity.value, body.quantity.unit, bundle?.benchmark.modal ?? null, bundle?.asOf ?? null, now],
    );
    return view(client, await rowById(client, dealId), actor);
  });
}

export async function counterOffer(db: Database, actor: Actor, dealId: string, terms: z.infer<typeof CounterBody>, now: Date): Promise<DealView> {
  return withActor(db, actor, async (client) => {
    const row = await rowById(client, dealId);
    const next = await apply(client, row, { type: 'COUNTER', terms: terms as DealTerms }, dealActor(actor, row), now);
    await client.query(
      'INSERT INTO app.counters (deal_id, by_party, by_user, price, price_unit, qty, qty_unit, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [dealId, next.lastPriceBy, actor.userId, terms.price.amount, terms.price.unit, terms.quantity.value, terms.quantity.unit, now],
    );
    return view(client, await rowById(client, dealId), actor);
  });
}

export async function declineOffer(db: Database, actor: Actor, dealId: string, now: Date): Promise<DealView> {
  return withActor(db, actor, async (client) => {
    const row = await rowById(client, dealId);
    await apply(client, row, { type: 'DECLINE' }, dealActor(actor, row), now);
    return view(client, await rowById(client, dealId), actor);
  });
}

/**
 * Acceptance, and the slip that follows it, in one transaction. `ISSUE_SLIP` is the engine's
 * system event: neither party issues the slip, the server does, the moment the price is agreed.
 */
export async function acceptOffer(db: Database, actor: Actor, dealId: string, now: Date): Promise<DealView> {
  const subject = await withActor(db, actor, async (client) => {
    const row = await rowById(client, dealId);
    return { crop: row.crop, district: row.district };
  });
  const bundle = await bundleFor(db, subject.crop, subject.district);

  return withActor(db, actor, async (client) => {
    const row = await rowById(client, dealId);
    const accepted = await apply(client, row, { type: 'ACCEPT' }, dealActor(actor, row), now);
    const issued = await apply(
      client,
      { ...row, state: accepted.state, version: accepted.version },
      { type: 'ISSUE_SLIP' },
      { kind: 'system', id: 'server', verified: true },
      now,
    );
    await client.query('INSERT INTO app.sauda_slips (deal_id, slip_no, payload, issued_at) VALUES ($1, $2, $3, $4)', [
      dealId,
      await slipNumber(client, row.district, now),
      JSON.stringify(await freeze(client, { ...row, state: issued.state }, bundle)),
      now,
    ]);
    return view(client, await rowById(client, dealId), actor);
  });
}

/** SR-NAS-20260920-0007: the district, the day, and a number no two slips can share. */
async function slipNumber(client: PoolClient, district: string, now: Date): Promise<string> {
  const { rows } = await client.query<{ n: string }>("SELECT nextval('app.sauda_slip_no')::text AS n");
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `SR-${district.slice(0, 3).toUpperCase()}-${day}-${(rows[0]?.n ?? '0').padStart(4, '0')}`;
}

/** Everything the two parties agreed, and what it was measured against, written down once. */
async function freeze(client: PoolClient, row: DealRow, bundle: Bundle | null): Promise<Omit<SaudaSlip, 'slipNo' | 'issuedAt'>> {
  const price = { amount: Number(row.price), unit: row.price_unit };
  const quantity = { value: Number(row.qty), unit: row.qty_unit };
  const kg = kilograms(quantity.value, quantity.unit);
  const registry: DistrictRegistry = districtRegistry();
  const centre = registry.districts.find((d) => d.id === row.district);
  const buyerPlace = await client.query<{ lat: number | null; lon: number | null }>(
    'SELECT location_lat AS lat, location_lon AS lon FROM app.buyer_profiles WHERE user_id = $1',
    [row.buyer_id],
  );
  const to = buyerPlace.rows[0];
  const km = centre === undefined || to?.lat == null || to.lon == null ? null : roadKm({ lat: centre.centroid.lat, lon: centre.centroid.lon }, { lat: to.lat, lon: to.lon });
  const freight = km === null || kg === null || bundle === null ? null : estimateFreight(bundle.transport, km, kg);

  return {
    dealId: row.id,
    seller: { kind: row.seller_kind, name: row.seller_name ?? '', place: row.district },
    buyer: { name: row.buyer_name, place: row.buyer_place, verified: row.buyer_verified, demonstration: row.buyer_demonstration },
    crop: row.crop,
    quantity,
    grade: row.listing_grade === null ? null : { grade: row.listing_grade, provenance: row.listing_provenance ?? 'farmer-declared' },
    benchmark: bundle === null ? null : { modalPerQtl: bundle.benchmark.modal, market: bundle.market, district: row.district, asOf: bundle.asOf },
    price,
    grossValue: grossValue(price, quantity),
    freight: freight === null || km === null ? null : { total: Math.round(freight.total), vehicleClass: freight.vehicleClass, trips: freight.trips, roadKm: Math.round(km) },
    paymentRecord: await paymentRecord(client, row.buyer_id),
    pickup: { arrangedBy: 'phone', note: 'Pickup is arranged directly between the two parties named here.' },
    split: row.pool_id === null ? null : await splitTable(client, row.pool_id, price, quantity),
    disputeFrom: 'delivery-confirmed',
    district: row.district,
  };
}

/** Proportional by contributed volume (§6.6), in kilograms and rupees — never as a percentage. */
async function splitTable(client: PoolClient, poolId: string, price: { amount: number; unit: string }, quantity: { value: number; unit: string }): Promise<SaudaSlip['split']> {
  const { rows } = await client.query<{ contributors: number; total_kg: string }>('SELECT contributors, total_kg FROM app.pool_totals($1::uuid[])', [[poolId]]);
  const totals = rows[0];
  if (totals === undefined) return null;
  const members = await client.query<{ contributed_kg: string }>(
    'SELECT contributed_kg FROM app.aggregation_members WHERE pool_id = $1 ORDER BY contributed_kg DESC',
    [poolId],
  );
  const gross = grossValue(price, quantity);
  const totalKg = Number(totals.total_kg);
  return {
    contributors: totals.contributors,
    totalKg,
    shares: members.rows.map((m) => ({
      contributedKg: Number(m.contributed_kg),
      amount: gross === null || totalKg === 0 ? null : Math.round((Number(m.contributed_kg) / totalKg) * gross),
    })),
  };
}

export async function myDeals(db: Database, actor: Actor): Promise<DealView[]> {
  return withActor(db, actor, async (client) => {
    const { rows } = await client.query<DealRow>(`${DEAL_SELECT} WHERE d.seller_id = $1 OR d.buyer_id = $1 ORDER BY d.updated_at DESC LIMIT 100`, [actor.userId]);
    return Promise.all(rows.map((row) => view(client, row, actor)));
  });
}

export async function dealById(db: Database, actor: Actor, dealId: string): Promise<DealView> {
  return withActor(db, actor, async (client) => view(client, await rowById(client, dealId), actor));
}

export async function saudaSlipOf(db: Database, actor: Actor, dealId: string): Promise<SaudaSlip> {
  return withActor(db, actor, async (client) => {
    const slip = await slipOf(client, dealId);
    if (slip === null) throw new DomainError(404, 'NO_SLIP_YET', 'This deal has no sauda slip: it has not been agreed yet.');
    return slip;
  });
}

export interface ContactGrant {
  /** An opaque handle for the masked relay. Never a phone number, on either side (§8.4). */
  relayHandle: string;
  expiresAt: string;
  buyer: { name: string; place: string };
}

/**
 * The farmer acknowledges an offer, and only then does the buyer get a way to reach them — a
 * relay handle, masked, expiring, audited and rate-limited to twenty a day per buyer by the
 * database itself (SEC-06, SEC-07). A marketplace of verified identities without this is a
 * contact-harvesting resource.
 */
export async function acknowledgeOffer(db: Database, actor: Actor, dealId: string, reason: string): Promise<ContactGrant> {
  return withActor(db, actor, async (client) => {
    const row = await rowById(client, dealId);
    if (row.seller_id !== actor.userId) throw new DomainError(403, 'NOT_THE_SELLER', 'Only the farmer selling this lot can let the buyer make contact.');
    try {
      await client.query('INSERT INTO app.contact_grants (deal_id, farmer_id, buyer_id, reason) VALUES ($1, $2, $3, $4) ON CONFLICT (deal_id) DO NOTHING', [
        dealId,
        actor.userId,
        row.buyer_id,
        reason,
      ]);
    } catch (error) {
      if ((error as { code?: string }).code === '54000') throw new DomainError(429, 'BUYER_CONTACT_LIMIT', "This buyer has reached today's limit for new farmer contacts.");
      throw error;
    }
    const { rows } = await client.query<{ relay_handle: string; expires_at: Date }>('SELECT relay_handle, expires_at FROM app.contact_grants WHERE deal_id = $1', [dealId]);
    const grant = rows[0];
    if (grant === undefined) throw new DomainError(409, 'NO_GRANT', 'That offer cannot be acknowledged.');
    return { relayHandle: grant.relay_handle, expiresAt: grant.expires_at.toISOString(), buyer: { name: row.buyer_name, place: row.buyer_place } };
  });
}
