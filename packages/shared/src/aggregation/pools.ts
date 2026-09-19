/**
 * Small-lot aggregation (L-3; FR-09, PROMPT §6.6) — a constrained clustering problem, not a
 * prediction problem.
 *
 * Opted-in open listings are clustered on crop (hard), grade band (at or above the buyer's
 * floor), a shared availability window, and a geodesic radius around the coordinating point (an
 * FPO collection centre when there is one), then pooled greedily — nearest first — until the
 * buyer's minimum order quantity clears. The buyer sees one consignment; proceeds split in
 * proportion to contributed volume, to the paisa, recorded on the sauda slip.
 */
import { dayNumber } from '../core/dates.js';
import { distanceKm } from '../core/geo.js';
import type { CropId, GeoPoint, ISODate } from '../core/types.js';
import { GRADE_RANK, type BuyerRequirement, type Grade } from '../matching/types.js';
import { quantityToKg, type Quantity, type UnitWeights } from '../units/units.js';

export interface PoolListing {
  listingId: string;
  farmerId: string;
  crop: CropId;
  variety?: string | undefined;
  grade: Grade | null;
  quantity: Quantity;
  location: GeoPoint;
  availableFrom: ISODate;
  availableUntil: ISODate;
  /** Aggregation is opt-in. A listing that has not opted in is never pooled. */
  optedIn: boolean;
}

export interface Coordinator {
  kind: 'fpo';
  id: string;
  name: string;
  location: GeoPoint;
}

export interface PoolOptions {
  radiusKm: number;
  coordinator: Coordinator | null;
  weights: UnitWeights;
}

export interface PoolMember {
  listingId: string;
  farmerId: string;
  contributedKg: number;
  /** contributedKg / totalKg. */
  share: number;
}

export interface Pool {
  requirementId: string;
  coordinator: Coordinator | null;
  members: PoolMember[];
  totalKg: number;
  gradeRange: { lowest: Grade; highest: Grade } | null;
  includesUngraded: boolean;
  /** The days on which every member and the buyer are all available. */
  window: { from: ISODate; until: ISODate };
  /** Farthest member from the collection point, km. */
  spanKm: number;
}

export type PoolIneligibility = 'not-opted-in' | 'crop-mismatch' | 'variety-mismatch' | 'grade-below-floor' | 'ungraded' | 'not-available' | 'unit-unknown';

export interface PoolResult {
  pools: Pool[];
  /** When no pool clears: how close the best cluster came. */
  shortfall: { availableKg: number; neededKg: number } | null;
  ineligible: Array<{ listingId: string; reason: PoolIneligibility }>;
}

interface Candidate {
  listing: PoolListing;
  kg: number;
}

const latest = (a: ISODate, b: ISODate): ISODate => (dayNumber(a) >= dayNumber(b) ? a : b);
const earliest = (a: ISODate, b: ISODate): ISODate => (dayNumber(a) <= dayNumber(b) ? a : b);

export function formPools(listings: readonly PoolListing[], requirement: BuyerRequirement, options: PoolOptions): PoolResult {
  const minKg = quantityToKg(requirement.minQuantity, options.weights);
  const maxKg = quantityToKg(requirement.maxQuantity, options.weights);
  if (!minKg.ok || !maxKg.ok) throw new RangeError('The requirement quantity cannot be expressed in kilograms.');

  const ineligible: PoolResult['ineligible'] = [];
  const candidates: Candidate[] = [];
  for (const listing of listings) {
    const kg = quantityToKg(listing.quantity, options.weights);
    let reason: PoolIneligibility | null = null;
    if (!listing.optedIn) reason = 'not-opted-in';
    else if (listing.crop !== requirement.crop) reason = 'crop-mismatch';
    else if (requirement.variety !== undefined && listing.variety !== undefined && listing.variety !== requirement.variety) reason = 'variety-mismatch';
    else if (requirement.gradeFloor !== null && listing.grade === null) reason = 'ungraded';
    else if (requirement.gradeFloor !== null && listing.grade !== null && GRADE_RANK[listing.grade] < GRADE_RANK[requirement.gradeFloor]) reason = 'grade-below-floor';
    else if (dayNumber(listing.availableFrom) > dayNumber(requirement.validUntil) || dayNumber(listing.availableUntil) < dayNumber(requirement.validFrom)) reason = 'not-available';
    else if (!kg.ok) reason = 'unit-unknown';
    if (reason !== null) ineligible.push({ listingId: listing.listingId, reason });
    else if (kg.ok) candidates.push({ listing, kg: kg.value });
  }

  const pools: Pool[] = [];
  let bestShortfall: { availableKg: number; neededKg: number } | null = null;
  let remaining = [...candidates].sort((a, b) => a.listing.listingId.localeCompare(b.listing.listingId));

  while (remaining.length > 0) {
    const seed = remaining[0];
    if (seed === undefined) break;
    const center = options.coordinator?.location ?? seed.listing.location;
    const nearby = remaining
      .map((c) => ({ ...c, km: distanceKm(center, c.listing.location) }))
      .filter((c) => c.km <= options.radiusKm)
      .sort((a, b) => a.km - b.km || a.listing.listingId.localeCompare(b.listing.listingId));

    let windowFrom = requirement.validFrom;
    let windowUntil = requirement.validUntil;
    let totalKg = 0;
    const chosen: Array<Candidate & { km: number; contributedKg: number }> = [];
    for (const c of nearby) {
      if (totalKg >= minKg.value) break;
      const from = latest(windowFrom, c.listing.availableFrom);
      const until = earliest(windowUntil, c.listing.availableUntil);
      if (dayNumber(from) > dayNumber(until)) continue; // would leave no common day
      const contributedKg = Math.min(c.kg, maxKg.value - totalKg);
      if (contributedKg <= 0) break;
      windowFrom = from;
      windowUntil = until;
      totalKg += contributedKg;
      chosen.push({ ...c, contributedKg });
    }

    const used = new Set(chosen.map((c) => c.listing.listingId));
    if (totalKg >= minKg.value && chosen.length > 0) {
      const grades = chosen.map((c) => c.listing.grade).filter((g): g is Grade => g !== null);
      const sortedGrades = [...grades].sort((a, b) => GRADE_RANK[a] - GRADE_RANK[b]);
      const lowest = sortedGrades[0];
      const highest = sortedGrades[sortedGrades.length - 1];
      pools.push({
        requirementId: requirement.id,
        coordinator: options.coordinator,
        members: chosen.map((c) => ({ listingId: c.listing.listingId, farmerId: c.listing.farmerId, contributedKg: c.contributedKg, share: c.contributedKg / totalKg })),
        totalKg,
        gradeRange: lowest !== undefined && highest !== undefined ? { lowest, highest } : null,
        includesUngraded: grades.length < chosen.length,
        window: { from: windowFrom, until: windowUntil },
        spanKm: Math.max(...chosen.map((c) => c.km)),
      });
      remaining = remaining.filter((c) => !used.has(c.listing.listingId));
    } else {
      if (bestShortfall === null || totalKg > bestShortfall.availableKg) bestShortfall = { availableKg: totalKg, neededKg: minKg.value - totalKg };
      // With a fixed collection point there is only one cluster to try.
      if (options.coordinator !== null) break;
      remaining = remaining.filter((c) => c.listing.listingId !== seed.listing.listingId);
    }
  }

  return { pools, shortfall: pools.length === 0 ? bestShortfall : null, ineligible };
}

/**
 * Split whole-lot proceeds (₹) across members in proportion to contributed volume, exactly to
 * the paisa: floor each share, then hand the leftover paise to the largest remainders (ties by
 * listing id). The parts always sum to the total.
 */
export function splitProceeds(pool: Pool, totalRupees: number): Array<{ listingId: string; farmerId: string; rupees: number }> {
  const totalPaise = Math.round(totalRupees * 100);
  const raw = pool.members.map((m) => ({ member: m, exact: (totalPaise * m.contributedKg) / pool.totalKg }));
  const floors = raw.map((r) => ({ ...r, paise: Math.floor(r.exact), remainder: r.exact - Math.floor(r.exact) }));
  let leftover = totalPaise - floors.reduce((sum, f) => sum + f.paise, 0);
  const order = [...floors].sort((a, b) => b.remainder - a.remainder || a.member.listingId.localeCompare(b.member.listingId));
  for (const f of order) {
    if (leftover <= 0) break;
    f.paise += 1;
    leftover -= 1;
  }
  return floors.map((f) => ({ listingId: f.member.listingId, farmerId: f.member.farmerId, rupees: f.paise / 100 }));
}
