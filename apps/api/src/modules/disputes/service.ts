/**
 * Disputes and where they go (PROMPT §8.9; FR-15; SEC-11).
 *
 * A marketplace without a complaint path is a marketplace that only works when nothing goes
 * wrong. From the moment both sides agree the lot changed hands, either of them can say what
 * happened — with a reason code, in their own words, and with the photograph of the lot attached
 * where there is one — and it goes to the agriculture officer of the deal's own district.
 *
 * The reason is a code, not free text, for one concrete reason: a district officer's dashboard
 * has to be able to say "eleven grade disputes in Niphad this month" without anybody parsing
 * sentences. The note is where the words go.
 *
 * Three rules the database holds, not this module: a dispute can only be raised from
 * DELIVERY_CONFIRMED onward (`disputes_raise`), only one can be open on a deal at a time
 * (`disputes_one_open`), and only the officer of that district can move it — open → under review
 * → resolved, with the record itself unrewritable (`disputes_guard`).
 *
 * While a dispute is open, the counterparty's clean record is not shown as clean. That is the
 * whole point of the mechanism: it has teeth because it is visible.
 */
import { DISPUTE_REASONS, transition, type Actor as DealActor, type Deal, type DisputeReason, type DisputeState } from '@fasal/shared';
import type { PoolClient } from 'pg';
import { z } from 'zod';

import { withActor, type Actor, type Database } from '../../db/actor.js';
import { DomainError } from '../../http/errors.js';

export const RaiseBody = z
  .object({
    reason: z.enum(DISPUTE_REASONS as unknown as [DisputeReason, ...DisputeReason[]]),
    note: z.string().trim().min(1).max(1000),
    /** Attach the photograph already on file for this lot, by its storage key. */
    evidencePhotoId: z.uuid().nullish(),
  })
  .strict();
export const ResolveBody = z.object({ outcome: z.enum(['upheld', 'rejected', 'settled']), note: z.string().trim().min(1).max(1000) }).strict();

export interface DisputeView {
  id: string;
  dealId: string;
  state: DisputeState;
  reason: DisputeReason;
  note: string;
  raisedByParty: 'seller' | 'buyer';
  district: string;
  openedAt: string;
  outcome: 'upheld' | 'rejected' | 'settled' | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  /** How many photographs are attached; the images themselves are served by the photo module. */
  evidence: number;
}

interface DisputeRow {
  id: string;
  deal_id: string;
  state: DisputeState;
  reason: DisputeReason;
  note: string;
  raised_by_party: 'seller' | 'buyer';
  district: string;
  opened_at: Date;
  outcome: 'upheld' | 'rejected' | 'settled' | null;
  resolution_note: string | null;
  resolved_at: Date | null;
  evidence: string;
}

const DISPUTE_SELECT = `
  SELECT x.id, x.deal_id, x.state, x.reason, x.note, x.raised_by_party, x.district, x.opened_at,
         x.outcome, x.resolution_note, x.resolved_at,
         (SELECT count(*) FROM app.grievance_evidence e WHERE e.dispute_id = x.id) AS evidence
    FROM app.disputes x`;

function view(row: DisputeRow): DisputeView {
  return {
    id: row.id,
    dealId: row.deal_id,
    state: row.state,
    reason: row.reason,
    note: row.note,
    raisedByParty: row.raised_by_party,
    district: row.district,
    openedAt: row.opened_at.toISOString(),
    outcome: row.outcome,
    resolutionNote: row.resolution_note,
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    evidence: Number(row.evidence),
  };
}

/** The deal as the engine sees it, enough for `transition` to judge who may complain and when. */
async function dealFor(client: PoolClient, dealId: string, actor: Actor): Promise<{ deal: Deal; party: 'seller' | 'buyer'; listingId: string | null }> {
  const { rows } = await client.query<{
    id: string; listing_id: string | null; seller_id: string; seller_kind: 'farmer' | 'fpo'; buyer_id: string; district: string; state: Deal['state'];
    price: string; price_unit: string; qty: string; qty_unit: string; last_price_by: 'seller' | 'buyer';
    delivery_seller: boolean; delivery_buyer: boolean; rated_seller: boolean; rated_buyer: boolean; version: number; open_dispute: boolean;
  }>(
    `SELECT d.*, EXISTS (SELECT 1 FROM app.disputes x WHERE x.deal_id = d.id AND x.state <> 'RESOLVED') AS open_dispute
       FROM app.deals d WHERE d.id = $1`,
    [dealId],
  );
  const row = rows[0];
  if (row === undefined) throw new DomainError(404, 'NO_SUCH_DEAL', 'There is no such deal, or it is not yours.');
  const party = row.seller_id === actor.userId ? 'seller' : row.buyer_id === actor.userId ? 'buyer' : null;
  if (party === null) throw new DomainError(403, 'NOT_A_PARTY', 'Only the two parties to this deal can raise a dispute.');
  return {
    party,
    listingId: row.listing_id,
    deal: {
      id: row.id,
      listingId: row.listing_id ?? '',
      sellerId: row.seller_id,
      sellerKind: row.seller_kind,
      buyerId: row.buyer_id,
      district: row.district,
      state: row.state,
      terms: { price: { amount: Number(row.price), unit: row.price_unit as 'quintal' }, quantity: { value: Number(row.qty), unit: row.qty_unit as 'quintal' } },
      lastPriceBy: row.last_price_by,
      deliveryConfirmedBy: { seller: row.delivery_seller, buyer: row.delivery_buyer },
      ratedBy: { seller: row.rated_seller, buyer: row.rated_buyer },
      // The open dispute is read from its own table; the engine only needs to know there is one.
      dispute: row.open_dispute ? { state: 'DISPUTE_OPEN', raisedBy: 'seller', reason: 'OTHER', note: '', evidencePhotoId: null, openedAt: '', resolution: null } : null,
      version: row.version,
      events: [],
    },
  };
}

/**
 * Raise a dispute on a deal. The engine decides whether it is too early and whether one is
 * already open; the database decides the rest. Nothing about the deal itself changes: a dispute
 * is a complaint about what happened, not a way to undo it.
 */
export async function raiseDispute(db: Database, actor: Actor, dealId: string, body: z.infer<typeof RaiseBody>, now: Date): Promise<DisputeView> {
  return withActor(db, actor, async (client) => {
    const { deal, party, listingId } = await dealFor(client, dealId, actor);
    const asActor: DealActor = { kind: actor.role, id: actor.userId, verified: true };
    const checked = transition(deal, { type: 'RAISE_DISPUTE', reason: body.reason, note: body.note, evidencePhotoId: body.evidencePhotoId ?? null }, asActor, now.toISOString());
    if (!checked.ok) {
      const status = checked.error.code === 'NOT_A_PARTY' ? 403 : 409;
      throw new DomainError(status, checked.error.code, checked.error.message);
    }

    let inserted;
    try {
      inserted = await client.query<{ id: string }>(
        'INSERT INTO app.disputes (deal_id, raised_by, raised_by_party, reason, note, district, opened_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [dealId, actor.userId, party, body.reason, body.note, deal.district, now],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new DomainError(409, 'DISPUTE_ALREADY_OPEN', 'A dispute on this deal is already open.');
      throw error;
    }
    const disputeId = inserted.rows[0]!.id;

    // The evidence is the photograph already taken of this lot, attached by reference: the bytes
    // are in the photo store and the hash was verified when they arrived (§8.6). No re-upload.
    if (body.evidencePhotoId != null && listingId !== null) {
      const photo = await client.query<{ storage_key: string; content_hash: string }>(
        'SELECT storage_key, content_hash FROM app.listing_photos WHERE storage_key = $1 AND listing_id = $2',
        [body.evidencePhotoId, listingId],
      );
      const found = photo.rows[0];
      if (found === undefined) throw new DomainError(404, 'NO_SUCH_PHOTO', 'That photograph does not belong to this lot.');
      await client.query('INSERT INTO app.grievance_evidence (dispute_id, uploaded_by, storage_key, content_hash) VALUES ($1, $2, $3, $4)', [
        disputeId,
        actor.userId,
        found.storage_key,
        found.content_hash,
      ]);
    }

    const { rows } = await client.query<DisputeRow>(`${DISPUTE_SELECT} WHERE x.id = $1`, [disputeId]);
    return view(rows[0]!);
  });
}

/** The disputes on this account's deals — a farmer's own, or everything in an officer's district. */
export async function myDisputes(db: Database, actor: Actor): Promise<DisputeView[]> {
  return withActor(db, actor, async (client) => {
    const { rows } = await client.query<DisputeRow>(`${DISPUTE_SELECT} ORDER BY x.opened_at DESC LIMIT 200`);
    return rows.map(view);
  });
}

function officerOnly(actor: Actor): void {
  if (actor.role !== 'officer') throw new DomainError(403, 'OFFICERS_ONLY', "A dispute is handled by the district's agriculture officer.");
}

async function move(db: Database, actor: Actor, disputeId: string, to: 'UNDER_REVIEW' | 'RESOLVED', outcome: string | null, note: string | null): Promise<DisputeView> {
  officerOnly(actor);
  return withActor(db, actor, async (client) => {
    const { rowCount } = await client.query(
      to === 'UNDER_REVIEW'
        ? "UPDATE app.disputes SET state = 'UNDER_REVIEW' WHERE id = $1 AND state = 'DISPUTE_OPEN'"
        : "UPDATE app.disputes SET state = 'RESOLVED', outcome = $2, resolution_note = $3 WHERE id = $1 AND state = 'UNDER_REVIEW'",
      to === 'UNDER_REVIEW' ? [disputeId] : [disputeId, outcome, note],
    );
    if (rowCount === 0) {
      // Either it is not in this officer's district (row-level security hid it) or it has moved.
      throw new DomainError(409, 'DISPUTE_NOT_THERE', 'That dispute is not open for this action in your district.');
    }
    const { rows } = await client.query<DisputeRow>(`${DISPUTE_SELECT} WHERE x.id = $1`, [disputeId]);
    return view(rows[0]!);
  });
}

export const reviewDispute = (db: Database, actor: Actor, disputeId: string): Promise<DisputeView> => move(db, actor, disputeId, 'UNDER_REVIEW', null, null);

export const resolveDispute = (db: Database, actor: Actor, disputeId: string, body: z.infer<typeof ResolveBody>): Promise<DisputeView> =>
  move(db, actor, disputeId, 'RESOLVED', body.outcome, body.note);

export interface GrievancePattern {
  district: string;
  reason: DisputeReason;
  open: number;
  underReview: number;
  resolved: number;
}

/**
 * The institutional view (§8.9): grievances counted by reason at district resolution, which is
 * what a reason code is for. No names, no notes — a pattern, not a case file.
 */
export async function grievancePatterns(db: Database, actor: Actor): Promise<GrievancePattern[]> {
  officerOnly(actor);
  return withActor(db, actor, async (client) => {
    const { rows } = await client.query<{ district: string; reason: DisputeReason; open: string; under_review: string; resolved: string }>(
      `SELECT district, reason,
              count(*) FILTER (WHERE state = 'DISPUTE_OPEN')  AS open,
              count(*) FILTER (WHERE state = 'UNDER_REVIEW')  AS under_review,
              count(*) FILTER (WHERE state = 'RESOLVED')      AS resolved
         FROM app.disputes GROUP BY district, reason ORDER BY district, reason`,
    );
    return rows.map((r) => ({ district: r.district, reason: r.reason, open: Number(r.open), underReview: Number(r.under_review), resolved: Number(r.resolved) }));
  });
}
