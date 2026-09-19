/**
 * FR-10 · Gate G (compile-time half) — the offline outbox cannot carry a deal transition.
 *
 * The `@ts-expect-error` lines below are the proof. They are type-checked by
 * `tsc -p tsconfig.test.json` in `pnpm typecheck`: if anyone ever widens `OutboxEntry` to accept a
 * deal transition, the expected error disappears and the typecheck fails.
 */
import { describe, expect, it } from 'vitest';

import { isOutboxKind, OUTBOX_KINDS, type OutboxEntry, type OutboxKind } from './outbox.js';

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
