/** Matching inputs: lots, buyer requirements, buyer profiles and their completed-deal history. */
import type { TransportTariff } from '../bundle/types.js';
import type { CropId, DistrictId, GeoPoint, ISODate } from '../core/types.js';
import type { VarietySubstitution } from '../crops/types.js';
import type { AmbiguousPrice, Money, Quantity, UnitWeights } from '../units/units.js';

/** Fair-average-quality grade bands. A is best. */
export type Grade = 'A' | 'B' | 'C';
export const GRADE_RANK: Readonly<Record<Grade, number>> = { A: 3, B: 2, C: 1 };

export interface Lot {
  listingId: string;
  crop: CropId;
  variety?: string | undefined;
  /** In the farmer's own unit (P1-02). */
  quantity: Quantity;
  /** Farmer-confirmed grade, or null when grading was skipped. */
  grade: Grade | null;
  location: GeoPoint;
  district: DistrictId;
  availableFrom: ISODate;
  availableUntil: ISODate;
  /**
   * The farmer's own asking price. Carried for display only — it is never an input to ranking.
   * Scoring a buyer against the ask rewards exploiting a farmer who guessed low (P1-06).
   */
  askingPrice?: Money | AmbiguousPrice | undefined;
}

export interface BuyerRequirement {
  id: string;
  buyerId: string;
  crop: CropId;
  variety?: string | undefined;
  gradeFloor: Grade | null;
  /** The buyer's minimum order quantity. */
  minQuantity: Quantity;
  maxQuantity: Quantity;
  /** The price offered, on the basis the buyer stated it. */
  price: Money;
  /** Where the buyer takes delivery. */
  location: GeoPoint;
  district: DistrictId;
  radiusKm: number;
  validFrom: ISODate;
  validUntil: ISODate;
}

/** A buyer's record from *completed* transactions only (PROMPT §8.9). */
export interface BuyerHistory {
  completedDeals: number;
  /** Days from delivery to payment, one entry per completed deal. */
  paymentDays: number[];
  /** Deals where payment never arrived. */
  defaults: number;
  /** Days of exposure accumulated on defaulted deals before the default was declared. */
  defaultExposureDays: number;
  /** Disputes currently open against this buyer. */
  openDisputes: number;
}

export interface BuyerProfile {
  id: string;
  name: string;
  /** Where the buyer operates, e.g. "Lasalgaon". */
  place: string;
  /** GSTIN/Udyam verified. Unverified buyers may browse; they may not offer (PROMPT §8.3). */
  verified: boolean;
  history: BuyerHistory;
}

export interface MatchContext {
  buyers: readonly BuyerProfile[];
  /** Today's district benchmark — the only price anything is scored against. */
  benchmark: { modalPerQtl: number; district: DistrictId; market: string; asOf: ISODate };
  tariffs: readonly TransportTariff[];
  /** The farmer's annual cost of money: what a day of waiting for payment costs them. */
  financeRateAnnual: number;
  /** The farmer's own alternative: the nearest mandi, by road. */
  nearestMandi: { name: string; roadKm: number } | null;
  /** The crop's crate/bag weights. */
  weights: UnitWeights;
  substitutions: readonly VarietySubstitution[];
  today: ISODate;
}
