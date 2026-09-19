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
}

export type OutboxEntry = ListingCreate | ListingUpdate | ListingRenewal | PriceAlert | PhotoUpload;
export type OutboxKind = OutboxEntry['kind'];

export const OUTBOX_KINDS: readonly OutboxKind[] = ['listing.create', 'listing.update', 'listing.renew', 'price-alert.create', 'photo.upload'];

/** Runtime check used by the server when draining an outbox: anything else is refused (SEC-09). */
export function isOutboxKind(kind: unknown): kind is OutboxKind {
  return typeof kind === 'string' && (OUTBOX_KINDS as readonly string[]).includes(kind);
}
