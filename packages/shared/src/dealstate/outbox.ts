/**
 * The offline outbox (PROMPT §XI; Constitution §9).
 *
 * What a device may queue while offline, and nothing else: listing creation, listing updates,
 * listing renewal, price alerts and photo uploads. Deal-state transitions are **absent from this
 * union**, so constructing an offline offer-acceptance is a compile error — not a runtime guard a
 * missed conditional could reintroduce. `outbox.test.ts` holds the compile-time proof.
 */
import type { CropId, ISODate } from '../core/types.js';
import type { Grade } from '../matching/types.js';
import type { Money, Quantity } from '../units/units.js';

export type GradeProvenance = 'farmer-declared' | 'farmer-declared-ai-assisted';

/**
 * What the on-device grader proposed for a photograph, kept beside it on the server (§7.6): with
 * the farmer's declared grade and, at pickup, the buyer's, it becomes a field-labelled example.
 */
export interface PhotoProposal {
  grade: Grade;
  band: 'high' | 'moderate' | 'low';
  views: number;
  modelVersion: string;
}

/** A listing as the farmer composed it. District and identity come from the verified account on the server. */
export interface ListingDraft {
  /** Client-generated id, stable across retries. */
  clientId: string;
  crop: CropId;
  variety?: string | undefined;
  quantity: Quantity;
  /** Null when the farmer named no price. Never an ambiguous price: that is resolved before saving. */
  askingPrice: Money | null;
  grade: Grade | null;
  gradeProvenance: GradeProvenance | null;
  availableFrom: ISODate;
  availableUntil: ISODate;
  poolOptIn: boolean;
  note?: string | undefined;
}

interface OutboxBase {
  /** Every mutating request carries one; a 2G retry must never create a duplicate (PROMPT §8.5). */
  idempotencyKey: string;
  createdAt: string;
  attempts: number;
}

export interface ListingCreate extends OutboxBase {
  kind: 'listing.create';
  listing: ListingDraft;
}

export interface ListingUpdate extends OutboxBase {
  kind: 'listing.update';
  listingClientId: string;
  changes: Partial<Pick<ListingDraft, 'quantity' | 'askingPrice' | 'grade' | 'gradeProvenance' | 'availableUntil' | 'poolOptIn' | 'note'>>;
}

export interface ListingRenewal extends OutboxBase {
  kind: 'listing.renew';
  listingClientId: string;
  availableUntil: ISODate;
}

export interface PriceAlert extends OutboxBase {
  kind: 'price-alert.create';
  crop: CropId;
  /** Alert when the district modal reaches this price. */
  threshold: Money;
}

export interface PhotoUpload extends OutboxBase {
  kind: 'photo.upload';
  listingClientId: string;
  /** SHA-256 of the re-encoded JPEG — also the idempotency key's basis. */
  contentHash: string;
  /** Key of the Blob in the device's photo store; the bytes never live in this record. */
  blobKey: string;
  byteLength: number;
  /** Null when nothing was proposed (no grader on the phone, or the farmer skipped grading). */
  proposal: PhotoProposal | null;
}

export type OutboxEntry = ListingCreate | ListingUpdate | ListingRenewal | PriceAlert | PhotoUpload;
export type OutboxKind = OutboxEntry['kind'];

export const OUTBOX_KINDS: readonly OutboxKind[] = ['listing.create', 'listing.update', 'listing.renew', 'price-alert.create', 'photo.upload'];

/** Runtime check used by the server when draining an outbox: anything else is refused (SEC-09). */
export function isOutboxKind(kind: unknown): kind is OutboxKind {
  return typeof kind === 'string' && (OUTBOX_KINDS as readonly string[]).includes(kind);
}

// ─── Drain policy (PROMPT §XI, CAM-13). Pure, so every client drains the same way. ──────────

/** First retry after ~2 s, doubling to a ceiling of ~15 min: a 2G reconnection is not hammered. */
export const OUTBOX_BACKOFF_BASE_MS = 2_000;
export const OUTBOX_BACKOFF_CEILING_MS = 15 * 60_000;

/** A stable 0–1 fraction from a string (FNV-1a), so jitter is deterministic per entry. */
function unitHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 0x1_0000_0000;
}

/**
 * Wait before retry number `attempts` (1-based): exponential with ±25 % jitter derived from the
 * idempotency key. Jitter spreads a village's phones apart when a tower comes back; deriving it
 * from the key rather than a random source keeps this function pure and testable.
 */
export function nextBackoffMs(attempts: number, idempotencyKey: string): number {
  if (!(attempts >= 1)) throw new RangeError('Backoff is for a retry: attempts must be at least 1.');
  const exponential = Math.min(OUTBOX_BACKOFF_CEILING_MS, OUTBOX_BACKOFF_BASE_MS * 2 ** (attempts - 1));
  return Math.round(exponential * (0.75 + 0.5 * unitHash(idempotencyKey)));
}

const DRAIN_RANK: Readonly<Record<OutboxKind, number>> = {
  'listing.create': 0,
  'listing.update': 1,
  'listing.renew': 1,
  'price-alert.create': 2,
  'photo.upload': 3,
};

/**
 * Drain order: a listing is created before anything that refers to it, text before photos, and
 * otherwise first queued, first sent.
 */
export function drainOrder<T extends { entry: OutboxEntry }>(queue: readonly T[]): T[] {
  return [...queue].sort((a, b) => DRAIN_RANK[a.entry.kind] - DRAIN_RANK[b.entry.kind] || a.entry.createdAt.localeCompare(b.entry.createdAt));
}

/** Network types on which photographs wait (PROMPT §XI: photos and non-critical data sync later). */
const SLOW_NETWORKS: readonly string[] = ['slow-2g', '2g'];

/** True when this entry should wait for a better network than `effectiveType`. Unknown networks do not defer. */
export function deferOnSlowNetwork(entry: OutboxEntry, effectiveType: string | null): boolean {
  return entry.kind === 'photo.upload' && effectiveType !== null && SLOW_NETWORKS.includes(effectiveType);
}
