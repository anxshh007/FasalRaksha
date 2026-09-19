/**
 * The demonstration buyers (PROMPT §16.1–16.2): data/reference/demo-buyers.json, written into the
 * real tables with the owner role, so the buyer shortlist and its track records are computed
 * exactly as they would be for real traders.
 *
 *   accounts     a buyer account per trader, GSTIN-verified through the mock registry unless the
 *                file says otherwise, flagged `demonstration`
 *   history      completed deals (listing → deal → both deliveries → payment), one per payment day
 *                in the file, spread over the past year; a `default` is a delivered deal left
 *                unpaid for 120 days; an `openDispute` is a recent unpaid deal with a payment-overdue
 *                dispute open. Sellers are demonstration farmers of the buyer's district.
 *   demand       every run: the demonstration requirements are replaced, priced against the
 *                current release's benchmark and valid around its date, so they stay current.
 *
 * Accounts and history are created once (identities are stable UUIDs derived from the file);
 * demand is refreshed on every call. Idempotent.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import pg from 'pg';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const SEED_FILE = join(REPO_ROOT, 'data', 'reference', 'demo-buyers.json');
const DISTRICTS_FILE = join(REPO_ROOT, 'data', 'reference', 'districts.json');

interface Price {
  scenario?: number;
  relative?: number;
  absolute?: number;
}

interface RequirementSpec {
  crop: string;
  price: Price;
  min: number;
  max: number;
  radiusKm: number;
  gradeFloor: 'A' | 'B' | 'C' | null;
}

interface BuyerSpec {
  key: string;
  name: string;
  district: string;
  market: string;
  verified: boolean;
  gstinLast4: string | null;
  history: { paymentDays: [number, number][]; defaults: number; openDisputes: number };
  requirements: RequirementSpec[];
}

interface SeedFile {
  scenarioBenchmarkPerQtl: number;
  buyers: BuyerSpec[];
}

interface Market {
  id: string;
  names: { en: string };
  location: { lat: number; lon: number };
}

/** A stable UUID (version 5 layout) for a demonstration identity, so every seed agrees. */
export function demoId(name: string): string {
  const h = createHash('sha256').update(`fasal-demo:${name}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

const DAY = 86_400_000;

function markets(): Map<string, { district: string; market: Market }> {
  const raw = JSON.parse(readFileSync(DISTRICTS_FILE, 'utf8')) as { registry?: { districts: { id: string; markets: Market[] }[] }; districts?: { id: string; markets: Market[] }[] };
  const districts = raw.registry?.districts ?? raw.districts ?? [];
  const out = new Map<string, { district: string; market: Market }>();
  for (const d of districts) for (const m of d.markets) out.set(m.id, { district: d.id, market: m });
  return out;
}

function benchmark(version: string, crop: string, district: string): { modal: number; asOf: string } | null {
  const file = join(REPO_ROOT, 'data', 'bundles', version, 'published', 'bundles', `${crop}__${district}.json`);
  if (!existsSync(file)) return null;
  const bundle = JSON.parse(readFileSync(file, 'utf8')) as { benchmark: { modal: number }; asOf: string };
  return { modal: bundle.benchmark.modal, asOf: bundle.asOf };
}

function priceFor(spec: RequirementSpec, bench: { modal: number } | null, scenarioBase: number): number | null {
  const round10 = (x: number) => Math.round(x / 10) * 10;
  if (spec.price.absolute !== undefined) return spec.price.absolute;
  if (bench === null) return null;
  if (spec.price.scenario !== undefined) return round10((spec.price.scenario * bench.modal) / scenarioBase);
  if (spec.price.relative !== undefined) return round10(spec.price.relative * bench.modal);
  return null;
}

export interface DemandSeedResult {
  created: boolean;
  buyers: number;
  requirements: number;
  completedDeals: number;
}

export async function seedDemand(ownerUrl: string, version: string, now: Date = new Date()): Promise<DemandSeedResult> {
  const seed = JSON.parse(readFileSync(SEED_FILE, 'utf8')) as SeedFile;
  const places = markets();
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  let created = false;
  let completedDeals = 0;
  let requirements = 0;
  try {
    await client.query('BEGIN');
    const existing = await client.query<{ n: string }>('SELECT count(*) AS n FROM app.buyer_profiles WHERE demonstration');
    if (Number(existing.rows[0]?.n ?? 0) === 0) {
      created = true;
      const sellers = new Map<string, string[]>();
      const sellersOf = async (district: string): Promise<string[]> => {
        const known = sellers.get(district);
        if (known !== undefined) return known;
        const ids: string[] = [];
        for (let i = 1; i <= 3; i++) {
          const id = demoId(`seller:${district}:${i}`);
          await client.query("INSERT INTO app.users (id, kind) VALUES ($1, 'farmer')", [id]);
          await client.query('INSERT INTO app.farmer_profiles (user_id, display_name, district, verified_at) VALUES ($1, $2, $3, $4)', [id, `Demonstration farmer ${i}`, district, new Date(now.getTime() - 400 * DAY)]);
          ids.push(id);
        }
        sellers.set(district, ids);
        return ids;
      };

      for (const buyer of seed.buyers) {
        const place = places.get(buyer.market);
        if (place === undefined) throw new Error(`demo-buyers.json: unknown market "${buyer.market}"`);
        const buyerId = demoId(`buyer:${buyer.key}`);
        await client.query("INSERT INTO app.users (id, kind) VALUES ($1, 'buyer')", [buyerId]);
        await client.query(
          'INSERT INTO app.buyer_profiles (user_id, business_name, place, district, location_lat, location_lon, demonstration) VALUES ($1, $2, $3, $4, $5, $6, true)',
          [buyerId, buyer.name, place.market.names.en, buyer.district, place.market.location.lat, place.market.location.lon],
        );
        if (buyer.verified) {
          await client.query(
            "INSERT INTO app.buyer_verifications (user_id, method, identifier_hash, identifier_last4, legal_name, status, adapter_mode) VALUES ($1, 'gstin', $2, $3, $4, 'verified', 'mock')",
            [buyerId, `demo:${createHash('sha256').update(buyer.key).digest('hex')}`, buyer.gstinLast4 ?? '0000', buyer.name],
          );
        }

        const crop = buyer.requirements[0]?.crop ?? 'onion';
        const farmerIds = await sellersOf(buyer.district);
        const days = buyer.history.paymentDays.flatMap(([count, d]) => Array.from({ length: count }, () => d));
        const deal = async (index: number, ageDays: number, state: string) => {
          const seller = farmerIds[index % farmerIds.length]!;
          const opened = new Date(now.getTime() - ageDays * DAY);
          const listing = await client.query<{ id: string }>(
            `INSERT INTO app.listings (client_id, farmer_id, crop, qty, qty_unit, available_from, available_until, status, created_at)
             VALUES ($1, $2, $3, 10, 'quintal', $4, $5, 'sold', $6) RETURNING id`,
            [`demo-history-${buyer.key}-${index}`, seller, crop, opened.toISOString().slice(0, 10), new Date(opened.getTime() + 7 * DAY).toISOString().slice(0, 10), opened],
          );
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO app.deals (listing_id, seller_id, seller_kind, buyer_id, district, state, price, price_unit, qty, qty_unit, last_price_by, delivery_seller, delivery_buyer, created_at, updated_at)
             VALUES ($1, $2, 'farmer', $3, $4, $5, 2000, 'quintal', 10, 'quintal', 'buyer', true, true, $6, $6) RETURNING id`,
            [listing.rows[0]!.id, seller, buyerId, buyer.district, state, opened],
          );
          const dealId = inserted.rows[0]!.id;
          const delivered = new Date(opened.getTime() + 2 * DAY);
          await client.query("INSERT INTO app.deliveries (deal_id, party, confirmed_by, confirmed_at) VALUES ($1, 'seller', $2, $3), ($1, 'buyer', $4, $3)", [dealId, seller, delivered, buyerId]);
          return { dealId, seller, delivered };
        };

        for (let i = 0; i < days.length; i++) {
          const ageDays = 20 + Math.round(((i + 1) / (days.length + 1)) * 330);
          const { dealId, seller, delivered } = await deal(i, ageDays, 'PAYMENT_CONFIRMED');
          const d = days[i]!;
          await client.query('INSERT INTO app.payments (deal_id, amount, confirmed_by, confirmed_at, days_after_delivery) VALUES ($1, 20000, $2, $3, $4)', [dealId, seller, new Date(delivered.getTime() + d * DAY), d]);
          completedDeals++;
        }
        for (let i = 0; i < buyer.history.defaults; i++) await deal(days.length + i, 122, 'DELIVERY_CONFIRMED'); // delivered 120 days ago, never paid
        for (let i = 0; i < buyer.history.openDisputes; i++) {
          const { dealId, seller } = await deal(days.length + buyer.history.defaults + i, 14, 'DELIVERY_CONFIRMED');
          await client.query(
            "INSERT INTO app.disputes (deal_id, raised_by, raised_by_party, reason, note, district, state, opened_at) VALUES ($1, $2, 'seller', 'PAYMENT_OVERDUE', 'Payment not received after delivery.', $3, 'DISPUTE_OPEN', $4)",
            [dealId, seller, buyer.district, new Date(now.getTime() - 3 * DAY)],
          );
        }
      }
    }

    // Demand, refreshed every run against the current release.
    const buyerIds = seed.buyers.map((b) => demoId(`buyer:${b.key}`));
    await client.query('DELETE FROM app.buyer_requirements WHERE buyer_id = ANY($1::uuid[])', [buyerIds]);
    for (const buyer of seed.buyers) {
      const place = places.get(buyer.market)!;
      for (const spec of buyer.requirements) {
        const bench = benchmark(version, spec.crop, buyer.district);
        const price = priceFor(spec, bench, seed.scenarioBenchmarkPerQtl);
        if (price === null) continue; // no published price to place this offer against
        const anchor = new Date(`${bench?.asOf ?? now.toISOString().slice(0, 10)}T00:00:00Z`).getTime();
        await client.query(
          `INSERT INTO app.buyer_requirements (buyer_id, crop, grade_floor, min_qty, min_qty_unit, max_qty, max_qty_unit, price, price_unit, district, location_lat, location_lon, radius_km, valid_from, valid_until)
           VALUES ($1, $2, $3, $4, 'quintal', $5, 'quintal', $6, 'quintal', $7, $8, $9, $10, $11, $12)`,
          [
            demoId(`buyer:${buyer.key}`), spec.crop, spec.gradeFloor, spec.min, spec.max, price, buyer.district, place.market.location.lat, place.market.location.lon, spec.radiusKm,
            new Date(anchor - 30 * DAY).toISOString().slice(0, 10), new Date(anchor + 90 * DAY).toISOString().slice(0, 10),
          ],
        );
        requirements++;
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
  return { created, buyers: seed.buyers.length, requirements, completedDeals };
}
