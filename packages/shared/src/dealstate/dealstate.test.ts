/** FR-12 · FR-14 · FR-15 — the server-authoritative deal state machine, disputes included. */
import { describe, expect, it } from 'vitest';

import { availableEvents, hasOpenDispute, newDeal, transition, type Actor, type Deal, type DealEvent, type DealTerms } from './dealstate.js';

const FARMER: Actor = { kind: 'farmer', id: 'farmer-1', verified: true };
const BUYER: Actor = { kind: 'buyer', id: 'buyer-a', verified: true };
const UNVERIFIED_BUYER: Actor = { kind: 'buyer', id: 'buyer-a', verified: false };
const STRANGER: Actor = { kind: 'buyer', id: 'buyer-z', verified: true };
const SYSTEM: Actor = { kind: 'system', id: 'server', verified: true };
const NASHIK_OFFICER: Actor = { kind: 'officer', id: 'dao-nashik', verified: true, district: 'nashik' };
const LATUR_OFFICER: Actor = { kind: 'officer', id: 'dao-latur', verified: true, district: 'latur' };

const TERMS: DealTerms = { price: { amount: 1950, unit: 'quintal' }, quantity: { value: 5, unit: 'quintal' } };
const COUNTER_TERMS: DealTerms = { price: { amount: 2000, unit: 'quintal' }, quantity: { value: 5, unit: 'quintal' } };

const fresh = (): Deal => newDeal({ id: 'deal-1', listingId: 'lot-1', sellerId: 'farmer-1', sellerKind: 'farmer', buyerId: 'buyer-a', district: 'nashik' });

function run(deal: Deal, ...steps: Array<[DealEvent, Actor]>): Deal {
  let current = deal;
  for (const [event, actor] of steps) {
    const result = transition(current, event, actor, '2026-09-06T10:00:00Z');
    if (!result.ok) throw new Error(`${event.type} by ${actor.kind} failed: ${result.error.code}`);
    current = result.deal;
  }
  return current;
}

const refused = (deal: Deal, event: DealEvent, actor: Actor): string => {
  const result = transition(deal, event, actor, '2026-09-06T10:00:00Z');
  return result.ok ? 'ACCEPTED-UNEXPECTEDLY' : result.error.code;
};

const accepted = (): Deal => run(fresh(), [{ type: 'OFFER', terms: TERMS }, BUYER], [{ type: 'ACCEPT' }, FARMER]);
const slipped = (): Deal => run(accepted(), [{ type: 'ISSUE_SLIP' }, SYSTEM]);
const delivered = (): Deal => run(slipped(), [{ type: 'CONFIRM_DELIVERY' }, FARMER], [{ type: 'CONFIRM_DELIVERY' }, BUYER]);
const paid = (): Deal => run(delivered(), [{ type: 'CONFIRM_PAYMENT' }, FARMER]);

describe('FR-12 · offer → counter → accept', () => {
  it('walks the whole lifecycle to MUTUALLY_RATED, versioned and logged', () => {
    const done = run(paid(), [{ type: 'RATE' }, BUYER], [{ type: 'RATE' }, FARMER]);
    expect(done.state).toBe('MUTUALLY_RATED');
    expect(done.version).toBe(8);
    expect(done.events.map((e) => e.type)).toEqual(['OFFER', 'ACCEPT', 'ISSUE_SLIP', 'CONFIRM_DELIVERY', 'CONFIRM_DELIVERY', 'CONFIRM_PAYMENT', 'RATE', 'RATE']);
  });

  it('only a verified buyer may make an offer', () => {
    expect(refused(fresh(), { type: 'OFFER', terms: TERMS }, UNVERIFIED_BUYER)).toBe('UNVERIFIED_BUYER');
    expect(refused(fresh(), { type: 'OFFER', terms: TERMS }, FARMER)).toBe('NOT_A_PARTY');
  });

  it('a buyer cannot accept its own offer', () => {
    const offered = run(fresh(), [{ type: 'OFFER', terms: TERMS }, BUYER]);
    expect(refused(offered, { type: 'ACCEPT' }, BUYER)).toBe('OWN_OFFER');
  });

  it('counters alternate: only the party who did not name the current price may counter or accept', () => {
    const countered = run(fresh(), [{ type: 'OFFER', terms: TERMS }, BUYER], [{ type: 'COUNTER', terms: COUNTER_TERMS }, FARMER]);
    expect(countered).toMatchObject({ state: 'COUNTERED', lastPriceBy: 'seller', terms: COUNTER_TERMS });
    expect(refused(countered, { type: 'COUNTER', terms: TERMS }, FARMER)).toBe('NOT_YOUR_TURN');
    expect(refused(countered, { type: 'ACCEPT' }, FARMER)).toBe('OWN_OFFER');
    expect(run(countered, [{ type: 'ACCEPT' }, BUYER]).state).toBe('ACCEPTED');
  });

  it('either party may decline an open negotiation, and nothing follows a decline', () => {
    const declined = run(fresh(), [{ type: 'OFFER', terms: TERMS }, BUYER], [{ type: 'DECLINE' }, FARMER]);
    expect(declined.state).toBe('DECLINED');
    expect(refused(declined, { type: 'ACCEPT' }, FARMER)).toBe('WRONG_STATE');
  });

  it('rejects invalid terms and non-parties', () => {
    expect(refused(fresh(), { type: 'OFFER', terms: { ...TERMS, price: { amount: 0, unit: 'quintal' } } }, BUYER)).toBe('INVALID_TERMS');
    const offered = run(fresh(), [{ type: 'OFFER', terms: TERMS }, BUYER]);
    expect(refused(offered, { type: 'ACCEPT' }, STRANGER)).toBe('NOT_A_PARTY');
  });

  it('the sauda slip is issued by the server only, and only after acceptance', () => {
    expect(refused(accepted(), { type: 'ISSUE_SLIP' }, FARMER)).toBe('SYSTEM_ONLY');
    expect(refused(run(fresh(), [{ type: 'OFFER', terms: TERMS }, BUYER]), { type: 'ISSUE_SLIP' }, SYSTEM)).toBe('WRONG_STATE');
    expect(slipped().state).toBe('SAUDA_SLIP');
  });
});

describe('FR-14 · delivery and payment', () => {
  it('delivery is confirmed by both sides independently', () => {
    const half = run(slipped(), [{ type: 'CONFIRM_DELIVERY' }, FARMER]);
    expect(half).toMatchObject({ state: 'SAUDA_SLIP', deliveryConfirmedBy: { seller: true, buyer: false } });
    expect(refused(half, { type: 'CONFIRM_DELIVERY' }, FARMER)).toBe('ALREADY_DONE');
    expect(run(half, [{ type: 'CONFIRM_DELIVERY' }, BUYER]).state).toBe('DELIVERY_CONFIRMED');
  });

  it('only the farmer confirms that payment arrived, and only after delivery', () => {
    expect(refused(delivered(), { type: 'CONFIRM_PAYMENT' }, BUYER)).toBe('ONLY_SELLER_CONFIRMS_PAYMENT');
    expect(refused(slipped(), { type: 'CONFIRM_PAYMENT' }, FARMER)).toBe('WRONG_STATE');
    expect(paid().state).toBe('PAYMENT_CONFIRMED');
  });

  it('a deal that never completed cannot be rated; each party rates once', () => {
    expect(refused(delivered(), { type: 'RATE' }, BUYER)).toBe('WRONG_STATE');
    const once = run(paid(), [{ type: 'RATE' }, FARMER]);
    expect(refused(once, { type: 'RATE' }, FARMER)).toBe('ALREADY_DONE');
  });

  it('an FPO sells as the counterparty of record', () => {
    const fpo: Actor = { kind: 'fpo', id: 'fpo-sahyadri', verified: true };
    const pooled = newDeal({ id: 'deal-2', listingId: 'pool-1', sellerId: 'fpo-sahyadri', sellerKind: 'fpo', buyerId: 'buyer-a', district: 'nashik' });
    const done = run(pooled, [{ type: 'OFFER', terms: TERMS }, BUYER], [{ type: 'ACCEPT' }, fpo]);
    expect(done.state).toBe('ACCEPTED');
    // A farmer with the same id is not the FPO.
    expect(refused(run(pooled, [{ type: 'OFFER', terms: TERMS }, BUYER]), { type: 'ACCEPT' }, { kind: 'farmer', id: 'fpo-sahyadri', verified: true })).toBe('NOT_A_PARTY');
  });
});

describe('FR-15 · reason-coded disputes, routed to the district officer', () => {
  const raise: DealEvent = { type: 'RAISE_DISPUTE', reason: 'GRADE_DISPUTE', note: 'Buyer re-graded to C at the yard', evidencePhotoId: 'photo-9' };

  it('cannot be raised before delivery is confirmed', () => {
    expect(refused(slipped(), raise, FARMER)).toBe('DISPUTE_TOO_EARLY');
    expect(refused(accepted(), raise, BUYER)).toBe('DISPUTE_TOO_EARLY');
  });

  it('can be raised by either party from delivery onward, with reason, note and evidence', () => {
    const disputed = run(delivered(), [raise, FARMER]);
    expect(disputed.dispute).toMatchObject({ state: 'DISPUTE_OPEN', raisedBy: 'seller', reason: 'GRADE_DISPUTE', evidencePhotoId: 'photo-9' });
    expect(hasOpenDispute(disputed)).toBe(true);
    expect(refused(disputed, raise, BUYER)).toBe('DISPUTE_ALREADY_OPEN');
  });

  it('is reviewed and resolved only by the deal’s own district officer', () => {
    const disputed = run(paid(), [raise, BUYER]);
    expect(refused(disputed, { type: 'START_REVIEW' }, LATUR_OFFICER)).toBe('NOT_THE_DISTRICT_OFFICER');
    expect(refused(disputed, { type: 'START_REVIEW' }, FARMER)).toBe('NOT_THE_DISTRICT_OFFICER');
    const review = run(disputed, [{ type: 'START_REVIEW' }, NASHIK_OFFICER]);
    expect(review.dispute?.state).toBe('UNDER_REVIEW');
    const resolved = run(review, [{ type: 'RESOLVE_DISPUTE', outcome: 'settled', note: 'Re-weighed; ₹300 adjusted' }, NASHIK_OFFICER]);
    expect(resolved.dispute).toMatchObject({ state: 'RESOLVED', resolution: { outcome: 'settled' } });
    expect(hasOpenDispute(resolved)).toBe(false);
  });

  it('must be reviewed before it is resolved', () => {
    const disputed = run(delivered(), [raise, FARMER]);
    expect(refused(disputed, { type: 'RESOLVE_DISPUTE', outcome: 'upheld', note: '' }, NASHIK_OFFICER)).toBe('WRONG_STATE');
  });

  it('does not freeze the deal: payment can still be confirmed while a dispute is open', () => {
    const disputed = run(delivered(), [raise, BUYER]);
    expect(run(disputed, [{ type: 'CONFIRM_PAYMENT' }, FARMER]).state).toBe('PAYMENT_CONFIRMED');
  });
});

describe('FR-12 · what each actor may do next', () => {
  it('offers the buyer only an offer on a fresh listing, and the farmer nothing', () => {
    expect(availableEvents(fresh(), BUYER)).toEqual(['OFFER']);
    expect(availableEvents(fresh(), FARMER)).toEqual([]);
  });

  it('after an offer: the farmer may counter, accept or decline; the buyer may only decline', () => {
    const offered = run(fresh(), [{ type: 'OFFER', terms: TERMS }, BUYER]);
    expect(availableEvents(offered, FARMER)).toEqual(['COUNTER', 'ACCEPT', 'DECLINE']);
    expect(availableEvents(offered, BUYER)).toEqual(['DECLINE']);
  });

  it('is pure: a refused transition leaves the deal untouched', () => {
    const deal = fresh();
    const snapshot = JSON.stringify(deal);
    transition(deal, { type: 'ACCEPT' }, FARMER, 'now');
    expect(JSON.stringify(deal)).toBe(snapshot);
  });
});
