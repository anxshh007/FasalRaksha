/**
 * The deal state machine (FR-12…FR-15, PROMPT §8.9). Server-authoritative: the API applies these
 * transitions inside a database transaction; a client may call `availableEvents` to decide what
 * to show, never to decide what happened. Deal transitions cannot be queued offline — they are
 * absent from the outbox type (see outbox.ts, Constitution §9).
 *
 *   LISTED → OFFERED → COUNTERED ⇄ … → ACCEPTED → SAUDA_SLIP
 *         → DELIVERY_CONFIRMED (seller and buyer, independently)
 *         → PAYMENT_CONFIRMED (seller only) → MUTUALLY_RATED
 *   OFFERED | COUNTERED → DECLINED (either party walks away before acceptance)
 *
 *   From DELIVERY_CONFIRMED onward either party may raise a reason-coded dispute:
 *   DISPUTE_OPEN → UNDER_REVIEW → RESOLVED, handled by the deal's district agriculture officer.
 *
 * `DECLINED` is the one state added to the prompt's list: without it a farmer could not say no.
 */
import type { DistrictId } from '../core/types.js';
import type { Money, Quantity } from '../units/units.js';

export type DealState =
  | 'LISTED'
  | 'OFFERED'
  | 'COUNTERED'
  | 'ACCEPTED'
  | 'SAUDA_SLIP'
  | 'DELIVERY_CONFIRMED'
  | 'PAYMENT_CONFIRMED'
  | 'MUTUALLY_RATED'
  | 'DECLINED';
export type DisputeState = 'DISPUTE_OPEN' | 'UNDER_REVIEW' | 'RESOLVED';
export type DisputeReason = 'QUANTITY_SHORT' | 'GRADE_DISPUTE' | 'PAYMENT_OVERDUE' | 'NO_SHOW' | 'OTHER';
export const DISPUTE_REASONS: readonly DisputeReason[] = ['QUANTITY_SHORT', 'GRADE_DISPUTE', 'PAYMENT_OVERDUE', 'NO_SHOW', 'OTHER'];
export type Party = 'seller' | 'buyer';

export interface Actor {
  kind: 'farmer' | 'fpo' | 'buyer' | 'officer' | 'system';
  id: string;
  /** For buyers: GSTIN/Udyam verified. Only verified buyers may offer (PROMPT §8.3). */
  verified: boolean;
  /** For officers: the district they serve. */
  district?: DistrictId | undefined;
}

export interface DealTerms {
  price: Money;
  quantity: Quantity;
}

export interface Dispute {
  state: DisputeState;
  raisedBy: Party;
  reason: DisputeReason;
  note: string;
  evidencePhotoId: string | null;
  openedAt: string;
  resolution: { outcome: 'upheld' | 'rejected' | 'settled'; note: string; at: string } | null;
}

export interface Deal {
  id: string;
  listingId: string;
  sellerId: string;
  sellerKind: 'farmer' | 'fpo';
  buyerId: string;
  district: DistrictId;
  state: DealState;
  terms: DealTerms | null;
  /** Who named the price currently on the table; only the other party may accept it. */
  lastPriceBy: Party | null;
  deliveryConfirmedBy: Record<Party, boolean>;
  ratedBy: Record<Party, boolean>;
  dispute: Dispute | null;
  /** Incremented on every transition — optimistic concurrency for the server. */
  version: number;
  events: Array<{ type: DealEvent['type']; by: Party | 'officer' | 'system'; at: string }>;
}

export type DealEvent =
  | { type: 'OFFER'; terms: DealTerms }
  | { type: 'COUNTER'; terms: DealTerms }
  | { type: 'ACCEPT' }
  | { type: 'DECLINE' }
  | { type: 'ISSUE_SLIP' }
  | { type: 'CONFIRM_DELIVERY' }
  | { type: 'CONFIRM_PAYMENT' }
  | { type: 'RATE' }
  | { type: 'RAISE_DISPUTE'; reason: DisputeReason; note: string; evidencePhotoId: string | null }
  | { type: 'START_REVIEW' }
  | { type: 'RESOLVE_DISPUTE'; outcome: 'upheld' | 'rejected' | 'settled'; note: string };

export type TransitionErrorCode =
  | 'NOT_A_PARTY'
  | 'UNVERIFIED_BUYER'
  | 'WRONG_STATE'
  | 'OWN_OFFER'
  | 'NOT_YOUR_TURN'
  | 'ALREADY_DONE'
  | 'ONLY_SELLER_CONFIRMS_PAYMENT'
  | 'DISPUTE_TOO_EARLY'
  | 'DISPUTE_ALREADY_OPEN'
  | 'NO_DISPUTE'
  | 'NOT_THE_DISTRICT_OFFICER'
  | 'SYSTEM_ONLY'
  | 'INVALID_TERMS';

export interface TransitionError {
  code: TransitionErrorCode;
  /** Plain-language explanation for logs and operators; the UI renders `code` in the farmer's language. */
  message: string;
}

export type TransitionResult = { ok: true; deal: Deal } | { ok: false; error: TransitionError };

/** Dispute is available from delivery onward, never before (SEC-11). */
export const DISPUTABLE_STATES: readonly DealState[] = ['DELIVERY_CONFIRMED', 'PAYMENT_CONFIRMED', 'MUTUALLY_RATED'];

export function newDeal(fields: { id: string; listingId: string; sellerId: string; sellerKind: 'farmer' | 'fpo'; buyerId: string; district: DistrictId }): Deal {
  return {
    ...fields,
    state: 'LISTED',
    terms: null,
    lastPriceBy: null,
    deliveryConfirmedBy: { seller: false, buyer: false },
    ratedBy: { seller: false, buyer: false },
    dispute: null,
    version: 0,
    events: [],
  };
}

export function partyOf(deal: Deal, actor: Actor): Party | null {
  if ((actor.kind === 'farmer' || actor.kind === 'fpo') && actor.kind === deal.sellerKind && actor.id === deal.sellerId) return 'seller';
  if (actor.kind === 'buyer' && actor.id === deal.buyerId) return 'buyer';
  return null;
}

export function counterparty(party: Party): Party {
  return party === 'seller' ? 'buyer' : 'seller';
}

const failWith = (code: TransitionErrorCode, message: string): TransitionResult => ({ ok: false, error: { code, message } });

function validTerms(terms: DealTerms): boolean {
  return Number.isFinite(terms.price.amount) && terms.price.amount > 0 && Number.isFinite(terms.quantity.value) && terms.quantity.value > 0;
}

function advance(deal: Deal, changes: Partial<Deal>, type: DealEvent['type'], by: Party | 'officer' | 'system', at: string): TransitionResult {
  return { ok: true, deal: { ...deal, ...changes, version: deal.version + 1, events: [...deal.events, { type, by, at }] } };
}

/** Apply `event` by `actor` at time `at`. Pure: returns a new deal or a reasoned refusal. */
export function transition(deal: Deal, event: DealEvent, actor: Actor, at: string): TransitionResult {
  const party = partyOf(deal, actor);

  switch (event.type) {
    case 'OFFER': {
      if (party !== 'buyer') return failWith('NOT_A_PARTY', 'Only the buyer on this deal can make an offer.');
      if (!actor.verified) return failWith('UNVERIFIED_BUYER', 'A buyer must be verified (GSTIN or Udyam) before making an offer.');
      if (deal.state !== 'LISTED') return failWith('WRONG_STATE', `An offer can only open a deal on a listing; this deal is ${deal.state}.`);
      if (!validTerms(event.terms)) return failWith('INVALID_TERMS', 'An offer needs a positive price and a positive quantity.');
      return advance(deal, { state: 'OFFERED', terms: event.terms, lastPriceBy: 'buyer' }, 'OFFER', 'buyer', at);
    }
    case 'COUNTER': {
      if (party === null) return failWith('NOT_A_PARTY', 'Only the two parties to this deal can counter.');
      if (party === 'buyer' && !actor.verified) return failWith('UNVERIFIED_BUYER', 'A buyer must be verified before negotiating.');
      if (deal.state !== 'OFFERED' && deal.state !== 'COUNTERED') return failWith('WRONG_STATE', `There is no open price to counter; this deal is ${deal.state}.`);
      if (deal.lastPriceBy === party) return failWith('NOT_YOUR_TURN', 'You named the current price; wait for the other party to respond.');
      if (!validTerms(event.terms)) return failWith('INVALID_TERMS', 'A counter needs a positive price and a positive quantity.');
      return advance(deal, { state: 'COUNTERED', terms: event.terms, lastPriceBy: party }, 'COUNTER', party, at);
    }
    case 'ACCEPT': {
      if (party === null) return failWith('NOT_A_PARTY', 'Only the two parties to this deal can accept.');
      if (party === 'buyer' && !actor.verified) return failWith('UNVERIFIED_BUYER', 'A buyer must be verified before accepting.');
      if (deal.state !== 'OFFERED' && deal.state !== 'COUNTERED') return failWith('WRONG_STATE', `There is no open price to accept; this deal is ${deal.state}.`);
      if (deal.lastPriceBy === party) return failWith('OWN_OFFER', 'You cannot accept a price you named yourself.');
      return advance(deal, { state: 'ACCEPTED' }, 'ACCEPT', party, at);
    }
    case 'DECLINE': {
      if (party === null) return failWith('NOT_A_PARTY', 'Only the two parties to this deal can decline it.');
      if (deal.state !== 'OFFERED' && deal.state !== 'COUNTERED') return failWith('WRONG_STATE', `Only an open negotiation can be declined; this deal is ${deal.state}.`);
      return advance(deal, { state: 'DECLINED' }, 'DECLINE', party, at);
    }
    case 'ISSUE_SLIP': {
      if (actor.kind !== 'system') return failWith('SYSTEM_ONLY', 'The sauda slip is issued by the server when a deal is accepted.');
      if (deal.state !== 'ACCEPTED') return failWith('WRONG_STATE', `A sauda slip follows acceptance; this deal is ${deal.state}.`);
      return advance(deal, { state: 'SAUDA_SLIP' }, 'ISSUE_SLIP', 'system', at);
    }
    case 'CONFIRM_DELIVERY': {
      if (party === null) return failWith('NOT_A_PARTY', 'Only the two parties to this deal can confirm delivery.');
      if (deal.state !== 'SAUDA_SLIP') return failWith('WRONG_STATE', `Delivery is confirmed after the sauda slip; this deal is ${deal.state}.`);
      if (deal.deliveryConfirmedBy[party]) return failWith('ALREADY_DONE', 'You have already confirmed delivery.');
      const confirmed = { ...deal.deliveryConfirmedBy, [party]: true };
      const both = confirmed.seller && confirmed.buyer;
      return advance(deal, { deliveryConfirmedBy: confirmed, state: both ? 'DELIVERY_CONFIRMED' : 'SAUDA_SLIP' }, 'CONFIRM_DELIVERY', party, at);
    }
    case 'CONFIRM_PAYMENT': {
      if (party !== 'seller') return failWith('ONLY_SELLER_CONFIRMS_PAYMENT', 'Only the seller can confirm that payment arrived.');
      if (deal.state !== 'DELIVERY_CONFIRMED') return failWith('WRONG_STATE', `Payment is confirmed after delivery; this deal is ${deal.state}.`);
      return advance(deal, { state: 'PAYMENT_CONFIRMED' }, 'CONFIRM_PAYMENT', 'seller', at);
    }
    case 'RATE': {
      if (party === null) return failWith('NOT_A_PARTY', 'Only the two parties to this deal can rate it.');
      if (deal.state !== 'PAYMENT_CONFIRMED') return failWith('WRONG_STATE', 'Ratings are only possible on a completed deal — after payment is confirmed.');
      if (deal.ratedBy[party]) return failWith('ALREADY_DONE', 'You have already rated this deal.');
      const rated = { ...deal.ratedBy, [party]: true };
      return advance(deal, { ratedBy: rated, state: rated.seller && rated.buyer ? 'MUTUALLY_RATED' : 'PAYMENT_CONFIRMED' }, 'RATE', party, at);
    }
    case 'RAISE_DISPUTE': {
      if (party === null) return failWith('NOT_A_PARTY', 'Only the two parties to this deal can raise a dispute.');
      if (!DISPUTABLE_STATES.includes(deal.state)) return failWith('DISPUTE_TOO_EARLY', 'A dispute can be raised once delivery is confirmed.');
      if (deal.dispute !== null && deal.dispute.state !== 'RESOLVED') return failWith('DISPUTE_ALREADY_OPEN', 'A dispute on this deal is already open.');
      const dispute: Dispute = {
        state: 'DISPUTE_OPEN',
        raisedBy: party,
        reason: event.reason,
        note: event.note,
        evidencePhotoId: event.evidencePhotoId,
        openedAt: at,
        resolution: null,
      };
      return advance(deal, { dispute }, 'RAISE_DISPUTE', party, at);
    }
    case 'START_REVIEW':
    case 'RESOLVE_DISPUTE': {
      if (actor.kind !== 'officer' || actor.district !== deal.district) {
        return failWith('NOT_THE_DISTRICT_OFFICER', "Disputes are handled by the deal's district agriculture officer.");
      }
      if (deal.dispute === null) return failWith('NO_DISPUTE', 'There is no dispute on this deal.');
      if (event.type === 'START_REVIEW') {
        if (deal.dispute.state !== 'DISPUTE_OPEN') return failWith('WRONG_STATE', `The dispute is ${deal.dispute.state}, not open.`);
        return advance(deal, { dispute: { ...deal.dispute, state: 'UNDER_REVIEW' } }, 'START_REVIEW', 'officer', at);
      }
      if (deal.dispute.state !== 'UNDER_REVIEW') return failWith('WRONG_STATE', `A dispute is resolved after review; it is ${deal.dispute.state}.`);
      return advance(
        deal,
        { dispute: { ...deal.dispute, state: 'RESOLVED', resolution: { outcome: event.outcome, note: event.note, at } } },
        'RESOLVE_DISPUTE',
        'officer',
        at,
      );
    }
  }
}

/** What this actor may do next — for deciding which buttons to show. Never authoritative. */
export function availableEvents(deal: Deal, actor: Actor): DealEvent['type'][] {
  const probe: Record<DealEvent['type'], DealEvent> = {
    OFFER: { type: 'OFFER', terms: { price: { amount: 1, unit: 'quintal' }, quantity: { value: 1, unit: 'quintal' } } },
    COUNTER: { type: 'COUNTER', terms: { price: { amount: 1, unit: 'quintal' }, quantity: { value: 1, unit: 'quintal' } } },
    ACCEPT: { type: 'ACCEPT' },
    DECLINE: { type: 'DECLINE' },
    ISSUE_SLIP: { type: 'ISSUE_SLIP' },
    CONFIRM_DELIVERY: { type: 'CONFIRM_DELIVERY' },
    CONFIRM_PAYMENT: { type: 'CONFIRM_PAYMENT' },
    RATE: { type: 'RATE' },
    RAISE_DISPUTE: { type: 'RAISE_DISPUTE', reason: 'OTHER', note: '', evidencePhotoId: null },
    START_REVIEW: { type: 'START_REVIEW' },
    RESOLVE_DISPUTE: { type: 'RESOLVE_DISPUTE', outcome: 'settled', note: '' },
  };
  return (Object.keys(probe) as DealEvent['type'][]).filter((type) => transition(deal, probe[type], actor, '').ok);
}

/** A buyer's reputation is shown as clean only when no dispute against them is open (PROMPT §8.9). */
export function hasOpenDispute(deal: Deal): boolean {
  return deal.dispute !== null && deal.dispute.state !== 'RESOLVED';
}
