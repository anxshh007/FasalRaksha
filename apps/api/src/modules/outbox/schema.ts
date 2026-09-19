/**
 * The server side of the offline outbox (PROMPT §XI; SEC-09).
 *
 * The device's outbox type cannot hold a deal transition (Constitution §9, compile-time). But a
 * device is a client, and a client can send anything — so the drain endpoint parses every entry
 * against exactly the five offline-safe kinds and refuses the rest before any of it reaches the
 * database. A deal accepted "offline" is not queued, replayed or half-applied: it is refused, and
 * the farmer's screen keeps saying "Waiting for server confirmation".
 */
import { isOutboxKind, OUTBOX_KINDS, type OutboxEntry } from '@fasal/shared';
import { z } from 'zod';

import { DomainError } from '../../http/errors.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const quantity = z.object({ value: z.number().positive().finite(), unit: z.enum(['kg', 'quintal', 'tonne', 'crate', 'bag']) });
const money = z.object({ amount: z.number().positive().finite(), unit: z.enum(['kg', 'quintal', 'tonne', 'crate', 'lot']) });
const base = {
  idempotencyKey: z.string().min(8).max(128),
  createdAt: z.string().datetime(),
  attempts: z.number().int().min(0),
};

const listingDraft = z.object({
  clientId: z.string().min(8).max(64),
  crop: z.string().min(1).max(40),
  variety: z.string().max(40).optional(),
  quantity,
  askingPrice: money.nullable(),
  grade: z.enum(['A', 'B', 'C']).nullable(),
  gradeProvenance: z.enum(['farmer-declared', 'farmer-declared-ai-assisted']).nullable(),
  availableFrom: isoDate,
  availableUntil: isoDate,
  poolOptIn: z.boolean(),
  note: z.string().max(500).optional(),
});

const OutboxEntrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('listing.create'), ...base, listing: listingDraft }),
  z.object({
    kind: z.literal('listing.update'),
    ...base,
    listingClientId: z.string().min(8).max(64),
    changes: listingDraft.pick({ quantity: true, askingPrice: true, grade: true, gradeProvenance: true, availableUntil: true, poolOptIn: true, note: true }).partial(),
  }),
  z.object({ kind: z.literal('listing.renew'), ...base, listingClientId: z.string().min(8).max(64), availableUntil: isoDate }),
  z.object({ kind: z.literal('price-alert.create'), ...base, crop: z.string().min(1).max(40), threshold: money }),
  z.object({
    kind: z.literal('photo.upload'),
    ...base,
    listingClientId: z.string().min(8).max(64),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    blobKey: z.string().min(1).max(128),
    byteLength: z.number().int().positive().max(8 * 1024 * 1024),
  }),
]);

/** Parse one drained entry. Anything that is not one of the five offline-safe kinds is refused. */
export function parseOutboxEntry(input: unknown): OutboxEntry {
  const kind = typeof input === 'object' && input !== null ? (input as { kind?: unknown }).kind : undefined;
  if (!isOutboxKind(kind)) {
    throw new DomainError(
      422,
      'NOT_AN_OFFLINE_ACTION',
      `Only ${OUTBOX_KINDS.join(', ')} can be queued offline. Offers, acceptances, payments, ratings and disputes are confirmed with the server, never offline.`,
    );
  }
  return OutboxEntrySchema.parse(input) as OutboxEntry;
}
