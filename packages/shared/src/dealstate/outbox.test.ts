/**
 * FR-10 · Gate G (compile-time half) — the offline outbox cannot carry a deal transition.
 *
 * The `@ts-expect-error` lines below are the proof. They are type-checked by
 * `tsc -p tsconfig.test.json` in `pnpm typecheck`: if anyone ever widens `OutboxEntry` to accept a
 * deal transition, the expected error disappears and the typecheck fails.
 */
import { describe, expect, it } from 'vitest';

import {
  deferOnSlowNetwork,
  drainOrder,
  isOutboxKind,
  nextBackoffMs,
  OUTBOX_BACKOFF_BASE_MS,
  OUTBOX_BACKOFF_CEILING_MS,
  OUTBOX_KINDS,
  type OutboxEntry,
  type OutboxKind,
} from './outbox.js';

type Assert<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;
/** No outbox kind may name a deal, offer, payment, rating or dispute action. */
export type NoDealKinds = Assert<IsNever<Extract<OutboxKind, `deal.${string}` | `offer.${string}` | `payment.${string}` | `rating.${string}` | `dispute.${string}`>>>;

describe('FR-10 · Gate G · the outbox type excludes deal transitions', () => {
  it('queues exactly the five offline-safe kinds', () => {
    expect([...OUTBOX_KINDS].sort()).toEqual(['listing.create', 'listing.renew', 'listing.update', 'photo.upload', 'price-alert.create']);
  });

  it('refuses any other kind at runtime too (the server drains with this check)', () => {
    expect(isOutboxKind('listing.create')).toBe(true);
    for (const kind of ['deal.accept', 'offer.accept', 'ACCEPT', 'payment.confirm', 'dispute.raise', '', 42, null]) {
      expect(isOutboxKind(kind)).toBe(false);
    }
  });

  it('cannot construct an offline offer acceptance (compile-time)', () => {
    // `as const` keeps the literal kind, so the error below can only mean "this kind is not in the
    // union" — not merely "string is wider than the union", which would prove nothing.
    const accept = {
      kind: 'deal.accept' as const,
      idempotencyKey: 'k',
      createdAt: '2026-09-06T10:00:00Z',
      attempts: 0,
      dealId: 'deal-1',
    };
    // @ts-expect-error — a deal transition is not an OutboxEntry (Constitution §9).
    const entry: OutboxEntry = accept;
    expect(isOutboxKind(entry.kind)).toBe(false);
  });

  it('the same construction with a legitimate kind compiles — so the error above is about the kind', () => {
    const renew = { kind: 'listing.renew' as const, idempotencyKey: 'k', createdAt: '2026-09-06T10:00:00Z', attempts: 0, listingClientId: 'abc', availableUntil: '2026-09-20' };
    const entry: OutboxEntry = renew;
    expect(isOutboxKind(entry.kind)).toBe(true);
  });

  it('a listing creation is an ordinary outbox entry', () => {
    const entry: OutboxEntry = {
      kind: 'listing.create',
      idempotencyKey: 'listing-abc',
      createdAt: '2026-09-06T10:00:00Z',
      attempts: 0,
      listing: {
        clientId: 'abc',
        crop: 'onion',
        quantity: { value: 5, unit: 'quintal' },
        askingPrice: null,
        grade: 'B',
        gradeProvenance: 'farmer-declared-ai-assisted',
        availableFrom: '2026-09-05',
        availableUntil: '2026-09-15',
        poolOptIn: true,
      },
    };
    expect(isOutboxKind(entry.kind)).toBe(true);
  });
});

describe('FR-10 · the drain policy', () => {
  const at = (kind: OutboxEntry['kind'], createdAt: string, key = createdAt): { entry: OutboxEntry } => {
    const base = { idempotencyKey: key, createdAt, attempts: 0 };
    switch (kind) {
      case 'photo.upload':
        return { entry: { ...base, kind, listingClientId: 'l1', contentHash: 'h', blobKey: 'b', byteLength: 300_000, proposal: null } };
      case 'listing.renew':
        return { entry: { ...base, kind, listingClientId: 'l1', availableUntil: '2026-09-30' } };
      case 'listing.update':
        return { entry: { ...base, kind, listingClientId: 'l1', changes: {} } };
      case 'price-alert.create':
        return { entry: { ...base, kind, crop: 'onion', threshold: { amount: 2000, unit: 'quintal' } } };
      case 'listing.create':
        return {
          entry: {
            ...base, kind,
            listing: { clientId: 'l1', crop: 'onion', quantity: { value: 5, unit: 'quintal' }, askingPrice: null, grade: null, gradeProvenance: null, availableFrom: '2026-09-18', availableUntil: '2026-09-25', poolOptIn: false },
          },
        };
    }
  };

  it('backs off exponentially from ~2 s to a ~15 min ceiling, with ±25 % jitter', () => {
    const first = nextBackoffMs(1, 'k');
    expect(first).toBeGreaterThanOrEqual(OUTBOX_BACKOFF_BASE_MS * 0.75);
    expect(first).toBeLessThanOrEqual(OUTBOX_BACKOFF_BASE_MS * 1.25);
    expect(Math.abs(nextBackoffMs(3, 'k') - 4 * nextBackoffMs(1, 'k'))).toBeLessThanOrEqual(4); // same jitter, two doublings, rounding aside
    expect(nextBackoffMs(40, 'k')).toBeLessThanOrEqual(OUTBOX_BACKOFF_CEILING_MS * 1.25);
    expect(() => nextBackoffMs(0, 'k')).toThrow(RangeError);
  });

  it('jitter is deterministic per entry and differs between entries', () => {
    expect(nextBackoffMs(2, 'phone-a')).toBe(nextBackoffMs(2, 'phone-a'));
    expect(nextBackoffMs(2, 'phone-a')).not.toBe(nextBackoffMs(2, 'phone-b'));
  });

  it('drains a listing before the photo that refers to it, then oldest first', () => {
    const order = drainOrder([at('photo.upload', '2026-09-18T08:00:00Z'), at('price-alert.create', '2026-09-18T09:00:00Z'), at('listing.create', '2026-09-18T10:00:00Z'), at('listing.update', '2026-09-18T07:00:00Z')]);
    expect(order.map((q) => q.entry.kind)).toEqual(['listing.create', 'listing.update', 'price-alert.create', 'photo.upload']);
  });

  it('holds photographs on 2G and sends everything else', () => {
    expect(deferOnSlowNetwork(at('photo.upload', 't').entry, '2g')).toBe(true);
    expect(deferOnSlowNetwork(at('photo.upload', 't').entry, 'slow-2g')).toBe(true);
    expect(deferOnSlowNetwork(at('photo.upload', 't').entry, '4g')).toBe(false);
    expect(deferOnSlowNetwork(at('photo.upload', 't').entry, null)).toBe(false);
    expect(deferOnSlowNetwork(at('listing.create', 't').entry, '2g')).toBe(false);
  });
});
