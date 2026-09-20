/**
 * Demand for the phone (PROMPT §6.5; FR-09; Gates A and F).
 *
 * GET /api/demand/:district answers with the buyer requirements a farmer in that district could
 * be shortlisted against, and, for each buyer, the name, place, verification and track record
 * the explanation needs. The phone ranks them itself with @fasal/shared's `rankBuyers`, joined to
 * its own lot, which never leaves the phone, so the shortlist renders offline with fresh
 * numbers.
 *
 * What is in the document, and what is not:
 *   requirements   currently valid ones whose buying radius could reach the district: crop,
 *                  grade floor, quantities, price with its unit, delivery point, radius, dates
 *   buyers         business name, market town, verified or not, demonstration or not, and the
 *                  aggregates `app.buyer_track_records` computes from completed deals
 *   never          a phone number, a GSTIN, a deal, a counterparty (contacts are P15's, behind
 *                  an offer and the farmer's acknowledgement)
 *
 * The body is canonical JSON with an integrity field, served with an ETag, so the phone verifies
 * it like a bundle and revalidates with a 304 when nothing changed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { computeIntegrity, canonicalJson, distanceKm, type DistrictRegistry } from '@fasal/shared';

import { withActor, type Actor, type Database } from '../../db/actor.js';
import { DomainError } from '../../http/errors.js';
import type { ServedDocument } from '../bundles/store.js';

/** A buyer this far outside the district centroid can still reach its farthest villages. */
const DISTRICT_REACH_KM = 60;

let registry: DistrictRegistry | null = null;

/** The shipped district registry, read once. Shared with the deals module for its centroids. */
export function districtRegistry(): DistrictRegistry {
  if (registry === null) {
    const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../../../data/reference/districts.json'), 'utf8')) as { registry?: DistrictRegistry } & DistrictRegistry;
    registry = raw.registry ?? raw;
  }
  return registry;
}

export interface DemandRequirement {
  id: string;
  buyerId: string;
  crop: string;
  variety?: string;
  gradeFloor: 'A' | 'B' | 'C' | null;
  minQuantity: { value: number; unit: string };
  maxQuantity: { value: number; unit: string };
  price: { amount: number; unit: string };
  location: { lat: number; lon: number };
  district: string;
  radiusKm: number;
  validFrom: string;
  validUntil: string;
}

export interface DemandBuyer {
  id: string;
  name: string;
  place: string;
  verified: boolean;
  demonstration: boolean;
  history: { completedDeals: number; paymentDays: number[]; defaults: number; defaultExposureDays: number; openDisputes: number };
}

export interface DemandDocument {
  kind: 'demand';
  district: string;
  /** The day (IST) the requirements were filtered for. */
  asOf: string;
  requirements: DemandRequirement[];
  buyers: DemandBuyer[];
  integrity: string;
}

export function todayIst(now: Date): string {
  return new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

export async function demandFor(db: Database, actor: Actor, district: string, now: Date): Promise<ServedDocument & { document: DemandDocument }> {
  const entry = districtRegistry().districts.find((d) => d.id === district);
  if (entry === undefined) throw new DomainError(404, 'UNKNOWN_DISTRICT', 'That district is not in the registry.');
  const asOf = todayIst(now);

  const { requirements, buyers } = await withActor(db, actor, async (client) => {
    const rows = await client.query<{
      id: string; buyer_id: string; crop: string; variety: string | null; grade_floor: 'A' | 'B' | 'C' | null; min_qty: string; min_qty_unit: string; max_qty: string; max_qty_unit: string;
      price: string; price_unit: string; district: string; location_lat: number; location_lon: number; radius_km: string; valid_from: string; valid_until: string;
    }>(
      `SELECT id, buyer_id, crop, variety, grade_floor, min_qty, min_qty_unit, max_qty, max_qty_unit, price, price_unit, district,
              location_lat, location_lon, radius_km, valid_from::text, valid_until::text
         FROM app.buyer_requirements
        WHERE active AND valid_until >= $1::date AND valid_from <= $1::date
        ORDER BY id`,
      [asOf],
    );
    const reach = rows.rows.filter((r) => distanceKm(entry.centroid, { lat: r.location_lat, lon: r.location_lon }) <= Number(r.radius_km) + DISTRICT_REACH_KM);
    const ids = [...new Set(reach.map((r) => r.buyer_id))].sort();
    if (ids.length === 0) return { requirements: [], buyers: [] };
    const profiles = await client.query<{ user_id: string; business_name: string; place: string; demonstration: boolean; verified: boolean }>(
      'SELECT user_id, business_name, place, demonstration, app.is_verified_buyer(user_id) AS verified FROM app.buyer_profiles WHERE user_id = ANY($1::uuid[]) ORDER BY user_id',
      [ids],
    );
    const records = await client.query<{ buyer_id: string; completed_deals: number; payment_days: number[]; defaults: number; default_exposure_days: number; open_disputes: number }>(
      'SELECT * FROM app.buyer_track_records($1::uuid[])',
      [ids],
    );
    const record = new Map(records.rows.map((r) => [r.buyer_id, r]));
    return {
      requirements: reach.map((r): DemandRequirement => ({
        id: r.id,
        buyerId: r.buyer_id,
        crop: r.crop,
        ...(r.variety === null ? {} : { variety: r.variety }),
        gradeFloor: r.grade_floor,
        minQuantity: { value: Number(r.min_qty), unit: r.min_qty_unit },
        maxQuantity: { value: Number(r.max_qty), unit: r.max_qty_unit },
        price: { amount: Number(r.price), unit: r.price_unit },
        location: { lat: r.location_lat, lon: r.location_lon },
        district: r.district,
        radiusKm: Number(r.radius_km),
        validFrom: r.valid_from,
        validUntil: r.valid_until,
      })),
      buyers: profiles.rows.map((p): DemandBuyer => {
        const h = record.get(p.user_id);
        return {
          id: p.user_id,
          name: p.business_name,
          place: p.place,
          verified: p.verified,
          demonstration: p.demonstration,
          history: {
            completedDeals: h?.completed_deals ?? 0,
            paymentDays: h?.payment_days ?? [],
            defaults: h?.defaults ?? 0,
            defaultExposureDays: h?.default_exposure_days ?? 0,
            openDisputes: h?.open_disputes ?? 0,
          },
        };
      }),
    };
  });

  const unsealed = { kind: 'demand' as const, district, asOf, requirements, buyers };
  const document: DemandDocument = { ...unsealed, integrity: computeIntegrity(unsealed) };
  return { document, body: canonicalJson(document), etag: `"${document.integrity}"`, version: asOf };
}
