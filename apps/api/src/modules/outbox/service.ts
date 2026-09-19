/**
 * POST /api/outbox — where a phone's queued offline actions land when the network returns
 * (PROMPT §XI, §8.5; SEC-09).
 *
 * Every entry is idempotent under its key. The first delivery is applied and its response
 * recorded. A retry after a lost response (the ordinary 2G failure) replays that recorded
 * response and changes nothing. The same key sent with different content is refused, because
 * that is a client bug or a replay attack, not a retry.
 *
 * Kinds whose features arrive in later phases (listings P11, photos P12) are answered with 501,
 * which the phone treats as "keep it and try later". They are never silently accepted.
 */
import { createHash } from 'node:crypto';

import { canonicalJson, normalisePrice, type OutboxEntry } from '@fasal/shared';
import type { PoolClient } from 'pg';

import { withActor, type Actor, type Database } from '../../db/actor.js';
import { DomainError } from '../../http/errors.js';

export interface OutboxResponse {
  status: number;
  body: Record<string, unknown>;
  replayed: boolean;
}

async function applyPriceAlert(client: PoolClient, actor: Actor, entry: Extract<OutboxEntry, { kind: 'price-alert.create' }>): Promise<{ status: number; body: Record<string, unknown> }> {
  if (actor.role !== 'farmer') throw new DomainError(403, 'FARMERS_ONLY', 'Price alerts are for farmers.');
  if (entry.threshold.unit !== 'kg' && entry.threshold.unit !== 'quintal' && entry.threshold.unit !== 'tonne') {
    throw new DomainError(422, 'ALERT_NEEDS_A_WEIGHT_UNIT', 'An alert price must be per kg, per quintal or per tonne, so it can be compared with the market rate.');
  }
  const perQuintal = normalisePrice(entry.threshold, 'quintal');
  if (!perQuintal.ok) throw new DomainError(422, 'ALERT_NEEDS_A_WEIGHT_UNIT', 'That price could not be expressed per quintal.');
  const profile = await client.query<{ district: string | null }>('SELECT district FROM app.farmer_profiles WHERE user_id = $1', [actor.userId]);
  const district = profile.rows[0]?.district ?? null;
  if (district === null) throw new DomainError(409, 'DISTRICT_UNKNOWN', 'Verify your farmer ID first, so alerts can follow your district market.');
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO app.price_alerts (farmer_id, crop, district, threshold_per_quintal, stated_amount, stated_unit, client_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [actor.userId, entry.crop, district, Math.round(perQuintal.value.amount * 100) / 100, entry.threshold.amount, entry.threshold.unit, entry.idempotencyKey],
  );
  return { status: 201, body: { kind: entry.kind, id: inserted.rows[0]?.id ?? null, district, thresholdPerQuintal: perQuintal.value.amount } };
}

function notYet(entry: OutboxEntry): never {
  throw new DomainError(501, 'NOT_AVAILABLE_YET', `This server does not accept "${entry.kind}" yet. It stays on your phone and will be sent later.`);
}

export async function deliverOutboxEntry(db: Database, actor: Actor, entry: OutboxEntry, headerKey: string | undefined): Promise<OutboxResponse> {
  if (headerKey !== entry.idempotencyKey) throw new DomainError(422, 'IDEMPOTENCY_KEY_MISMATCH', 'The Idempotency-Key header must match the queued action.');
  // Attempts count changes on every retry and is not part of the intent.
  const { attempts: _attempts, ...intent } = entry;
  const requestHash = createHash('sha256').update(canonicalJson(intent)).digest('hex');
  return withActor(db, actor, async (client) => {
    const seen = await client.query<{ request_hash: string; status_code: number; response: Record<string, unknown> }>(
      'SELECT request_hash, status_code, response FROM app.idempotency_keys WHERE actor_id = $1 AND key = $2',
      [actor.userId, entry.idempotencyKey],
    );
    const previous = seen.rows[0];
    if (previous !== undefined) {
      if (previous.request_hash !== requestHash) throw new DomainError(409, 'IDEMPOTENCY_KEY_REUSED', 'This key was already used for a different action.');
      return { status: previous.status_code, body: previous.response, replayed: true };
    }
    let result: { status: number; body: Record<string, unknown> };
    switch (entry.kind) {
      case 'price-alert.create':
        result = await applyPriceAlert(client, actor, entry);
        break;
      case 'listing.create':
      case 'listing.update':
      case 'listing.renew':
      case 'photo.upload':
        notYet(entry);
    }
    await client.query('INSERT INTO app.idempotency_keys (actor_id, key, request_hash, status_code, response) VALUES ($1, $2, $3, $4, $5)', [
      actor.userId, entry.idempotencyKey, requestHash, result.status, JSON.stringify(result.body),
    ]);
    return { ...result, replayed: false };
  });
}
