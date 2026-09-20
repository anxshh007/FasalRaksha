/**
 * Offers and deals on the phone (PROMPT §8.9; FR-12; Gate G).
 *
 * The one part of this product a phone may not decide by itself. Everything else here —
 * the benchmark, the sell-or-wait answer, the buyer shortlist, a lot written in a field with no
 * signal — is computed on the device and is true whether or not a server can be reached. A deal
 * is different: accepting a price commits a farmer to a buyer and a buyer to a farmer, and two
 * phones accepting the same lot with no network would both have been told yes.
 *
 * So there is no queued transition and no optimistic state. What the phone keeps is what the
 * server last told it — the offers on its lots, the agreed price, the sauda slip — so all of it
 * can be read, and shown, and quoted down a phone line, with no network at all. Acting on it
 * needs one, and the screen says so in the farmer's own language.
 */
import { store, type StoredDeal } from '../offline/db.js';
import { request, type HttpResult } from '../offline/http.js';

export type PriceUnit = 'kg' | 'quintal' | 'tonne' | 'crate' | 'lot';
export type QuantityUnit = 'kg' | 'quintal' | 'tonne' | 'crate' | 'bag';

export type DealState = 'OFFERED' | 'COUNTERED' | 'ACCEPTED' | 'SAUDA_SLIP' | 'DELIVERY_CONFIRMED' | 'PAYMENT_CONFIRMED' | 'MUTUALLY_RATED' | 'DECLINED';

export interface SaudaSlipView {
  slipNo: string;
  issuedAt: string;
  dealId: string;
  seller: { kind: 'farmer' | 'fpo'; name: string; place: string };
  buyer: { name: string; place: string; verified: boolean; demonstration: boolean };
  crop: string;
  quantity: { value: number; unit: QuantityUnit };
  grade: { grade: 'A' | 'B' | 'C'; provenance: string } | null;
  benchmark: { modalPerQtl: number; market: string; district: string; asOf: string } | null;
  price: { amount: number; unit: PriceUnit };
  grossValue: number | null;
  freight: { total: number; vehicleClass: string; trips: number; roadKm: number } | null;
  paymentRecord: { typicalDays: number | null; completedDeals: number };
  pickup: { arrangedBy: 'phone'; note: string };
  split: { contributors: number; totalKg: number; shares: Array<{ contributedKg: number; amount: number | null }> } | null;
  disputeFrom: 'delivery-confirmed';
  district: string;
}

export interface DealView {
  id: string;
  state: DealState;
  you: 'seller' | 'buyer';
  listingId: string | null;
  listingClientId: string | null;
  poolId: string | null;
  crop: string;
  buyer: { id: string; name: string; place: string; verified: boolean; demonstration: boolean };
  seller: { id: string; name: string; kind: 'farmer' | 'fpo' };
  terms: { price: { amount: number; unit: PriceUnit }; quantity: { value: number; unit: QuantityUnit } };
  lastPriceBy: 'seller' | 'buyer';
  benchmarkAtOffer: { modalPerQtl: number; asOf: string } | null;
  paymentRecord: { typicalDays: number | null; completedDeals: number };
  history: Array<{ type: string; by: 'seller' | 'buyer'; price: { amount: number; unit: PriceUnit }; quantity: { value: number; unit: QuantityUnit }; at: string }>;
  slip: SaudaSlipView | null;
  youCan: string[];
  version: number;
  updatedAt: string;
}

/** Deals still being negotiated, newest first, then the ones already struck. */
export function sortDeals(deals: readonly DealView[]): DealView[] {
  const open = (d: DealView) => (d.state === 'OFFERED' || d.state === 'COUNTERED' ? 0 : d.state === 'DECLINED' ? 2 : 1);
  return [...deals].sort((a, b) => open(a) - open(b) || b.updatedAt.localeCompare(a.updatedAt));
}

export async function refreshDeals(userId: string, now = Date.now()): Promise<'refreshed' | 'kept'> {
  const answer = await request<{ deals: DealView[] }>('/api/deals/mine');
  if (answer.kind !== 'ok') return 'kept';
  const db = store();
  const rows: StoredDeal[] = answer.body.deals.map((deal) => ({
    id: deal.id,
    userId,
    listingClientId: deal.listingClientId,
    state: deal.state,
    fetchedAt: now,
    deal,
  }));
  await db.transaction('rw', db.deals, async () => {
    await db.deals.where('userId').equals(userId).delete();
    if (rows.length > 0) await db.deals.bulkPut(rows);
  });
  return 'refreshed';
}

export async function storedDeals(userId: string): Promise<DealView[]> {
  return sortDeals((await store().deals.where('userId').equals(userId).toArray()).map((row) => row.deal));
}

/**
 * The three things a farmer can do with an offer. Each is a request, never a queued intent: if
 * it does not reach the server it did not happen, and the caller says so rather than pretending.
 */
export function acceptOffer(dealId: string): Promise<HttpResult<DealView>> {
  return request<DealView>(`/api/offers/${dealId}/accept`, { method: 'POST', body: {} });
}

export function declineOffer(dealId: string): Promise<HttpResult<DealView>> {
  return request<DealView>(`/api/offers/${dealId}/decline`, { method: 'POST', body: {} });
}

export function counterOffer(dealId: string, price: { amount: number; unit: PriceUnit }, quantity: { value: number; unit: QuantityUnit }): Promise<HttpResult<DealView>> {
  return request<DealView>(`/api/offers/${dealId}/counter`, { method: 'POST', body: { price, quantity } });
}

/** The farmer lets this buyer make contact: a masked relay handle, never a phone number (§8.4). */
export function acknowledgeOffer(dealId: string, reason: string): Promise<HttpResult<{ relayHandle: string; expiresAt: string; buyer: { name: string; place: string } }>> {
  return request(`/api/offers/${dealId}/acknowledge`, { method: 'POST', body: { reason } });
}
