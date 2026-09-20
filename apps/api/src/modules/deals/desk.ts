/**
 * The demonstration desk (CUTS C-11) — the seeded traders read their inbox.
 *
 * A farmer cannot be shown an offer that nobody made, and there is no buyer client in this build:
 * the demonstration traders of `data/reference/demo-buyers.json` have accounts, verifications and
 * completed-deal histories, but nobody signs in as them. So when a lot is listed, this desk acts
 * for each trader whose standing requirement the lot answers, and places their offer **through
 * `makeOffer`** — the same service function, the same row-level security, the same deal rows a
 * real trader's offer would produce. What is simulated is the decision to offer, not the offer.
 *
 * The rules it applies are the buyer's own requirement: the crop, the quantity band, the buying
 * radius and the validity window. The price is the one the seed placed against today's published
 * benchmark, so §16.2's three-buyer scenario arrives as three real offers, each with its own
 * payment record behind it.
 *
 * It never runs for a buyer who is not flagged `demonstration`, and every screen that shows one
 * of these offers says so, in all three languages.
 */
import { roadKm } from '@fasal/shared';

import type { Actor, Database } from '../../db/actor.js';
import { withActor } from '../../db/actor.js';
import { confirmDelivery, makeOffer, rateDeal } from './service.js';

/** At most this many traders answer one lot: a shortlist, not an auction floor. */
const MOST_OFFERS = 3;

/**
 * What a demonstration trader says about a farmer they have just finished a deal with. There is
 * no underlying datum to compute this from — no real trader typed it — so it is a constant, and
 * it is disclosed (CUTS C-11) rather than dressed up as a judgement. It exists so the farmer's
 * own reputation, and the mutual rating that closes a deal, can be demonstrated at all.
 */
const DESK_RATING = { qualityAsDescribed: 4, quantityAsDescribed: 4, availability: 4 } as const;

const KG: Readonly<Record<string, number>> = { kg: 1, quintal: 100, tonne: 1000 };

interface Candidate {
  buyer_id: string;
  price: string;
  price_unit: string;
  min_kg: number | null;
  max_kg: number | null;
  lat: number;
  lon: number;
  radius_km: string;
}

function kilograms(value: number, unit: string): number | null {
  const factor = KG[unit];
  return factor === undefined ? null : value * factor;
}

/**
 * Place the demonstration traders' offers on a lot that has just been listed. Best effort: a
 * failure here is a demonstration that is missing an offer, never a listing the farmer loses.
 */
export async function runDemonstrationDesk(db: Database, farmer: Actor, listingClientId: string, now: Date): Promise<number> {
  const lot = await withActor(db, farmer, async (client) => {
    const { rows } = await client.query<{ id: string; crop: string; district: string; qty: string; qty_unit: string; grade: string | null; status: string }>(
      'SELECT id, crop, district, qty, qty_unit, grade, status FROM app.listings WHERE farmer_id = $1 AND client_id = $2',
      [farmer.userId, listingClientId],
    );
    return rows[0];
  });
  if (lot === undefined || lot.status !== 'open') return 0;
  const kg = kilograms(Number(lot.qty), lot.qty_unit);
  if (kg === null) return 0; // a lot in crates: the traders would ask what a crate weighs here

  const candidates = await withActor(db, farmer, async (client) => {
    const { rows } = await client.query<Candidate>(
      `SELECT r.buyer_id, r.price, r.price_unit, r.location_lat AS lat, r.location_lon AS lon, r.radius_km,
              CASE r.min_qty_unit WHEN 'kg' THEN r.min_qty WHEN 'quintal' THEN r.min_qty * 100 WHEN 'tonne' THEN r.min_qty * 1000 END AS min_kg,
              CASE r.max_qty_unit WHEN 'kg' THEN r.max_qty WHEN 'quintal' THEN r.max_qty * 100 WHEN 'tonne' THEN r.max_qty * 1000 END AS max_kg
         FROM app.buyer_requirements r
         JOIN app.buyer_profiles b ON b.user_id = r.buyer_id
        WHERE r.active AND b.demonstration AND app.is_verified_buyer(r.buyer_id)
          AND r.crop = $1 AND $2::date BETWEEN r.valid_from AND r.valid_until
          -- Grades sort A, B, C with A the best, so a floor of B accepts a lot graded B or A.
          AND (r.grade_floor IS NULL OR $3::app.grade IS NULL OR r.grade_floor >= $3::app.grade)
          AND NOT EXISTS (SELECT 1 FROM app.deals d WHERE d.listing_id = $4 AND d.buyer_id = r.buyer_id)
        ORDER BY r.price DESC`,
      [lot.crop, now.toISOString().slice(0, 10), lot.grade, lot.id],
    );
    return rows;
  });

  const centre = await withActor(db, farmer, async (client) => {
    const { rows } = await client.query<{ lat: number | null; lon: number | null }>(
      'SELECT location_lat AS lat, location_lon AS lon FROM app.farmer_profiles WHERE user_id = $1',
      [farmer.userId],
    );
    return rows[0];
  });

  let placed = 0;
  for (const candidate of candidates) {
    if (placed >= MOST_OFFERS) break;
    const min = candidate.min_kg === null ? null : Number(candidate.min_kg);
    const max = candidate.max_kg === null ? null : Number(candidate.max_kg);
    if (min !== null && kg < min) continue; // below what this trader will buy
    if (max !== null && kg > max) continue;
    if (centre?.lat != null && centre.lon != null) {
      const km = roadKm({ lat: centre.lat, lon: centre.lon }, { lat: candidate.lat, lon: candidate.lon });
      if (km > Number(candidate.radius_km)) continue; // outside their buying radius
    }
    const buyer: Actor = { userId: candidate.buyer_id, role: 'buyer' };
    await makeOffer(
      db,
      buyer,
      { listingId: lot.id, price: { amount: Number(candidate.price), unit: candidate.price_unit as 'quintal' }, quantity: { value: Number(lot.qty), unit: lot.qty_unit as 'quintal' } },
      now,
    );
    placed++;
  }
  return placed;
}

/** The deal, if its buyer is a demonstration trader and the caller is the farmer selling it. */
async function demonstrationCounterparty(db: Database, farmer: Actor, dealId: string): Promise<Actor | null> {
  const buyer = await withActor(db, farmer, async (client) => {
    const { rows } = await client.query<{ buyer_id: string }>(
      `SELECT d.buyer_id FROM app.deals d JOIN app.buyer_profiles b ON b.user_id = d.buyer_id
        WHERE d.id = $1 AND d.seller_id = $2 AND b.demonstration`,
      [dealId, farmer.userId],
    );
    return rows[0];
  });
  return buyer === undefined ? null : { userId: buyer.buyer_id, role: 'buyer' };
}

/**
 * The trader confirms the pickup from their side. Delivery is two independent confirmations
 * (§8.9), so a demonstration deal would stop dead at the farmer's if nobody ever answered it.
 */
export async function answerDelivery(db: Database, farmer: Actor, dealId: string, now: Date): Promise<boolean> {
  const buyer = await demonstrationCounterparty(db, farmer, dealId);
  if (buyer === null) return false;
  await confirmDelivery(db, buyer, dealId, {}, now);
  return true;
}

/** And rates the farmer back, so a completed deal can actually reach MUTUALLY_RATED. */
export async function answerRating(db: Database, farmer: Actor, dealId: string, now: Date): Promise<boolean> {
  const buyer = await demonstrationCounterparty(db, farmer, dealId);
  if (buyer === null) return false;
  await rateDeal(db, buyer, dealId, { ...DESK_RATING }, now);
  return true;
}
