/**
 * The device side of the offline outbox (PROMPT §XI; Constitution §9).
 *
 * Queues what a farmer does without a network: listings, listing updates and renewals, price
 * alerts, photographs. The type admits nothing else, so an offline deal acceptance cannot even be
 * written (Gate G, compile-time, in @fasal/shared). Draining follows the shared policy: listings
 * before the photographs that refer to them, exponential backoff with deterministic jitter, and
 * photographs held back on 2G.
 *
 * How each answer is treated:
 *   2xx                 sent: the server has it (a replayed 2xx means a retry was deduplicated)
 *   4xx                 rejected: final, shown to the farmer with the server's reason. The
 *                       exception is 401: the session lapsed, so draining stops and nothing is lost
 *   5xx, 501            retrying: the server is up but cannot take it yet
 *   no answer           draining stops. The entry keeps its place and its attempt count
 */
import { deferOnSlowNetwork, drainOrder, nextBackoffMs, type OutboxEntry } from '@fasal/shared';

import { store, type QueuedEntry } from './db.js';
import { request, type HttpResult } from './http.js';

export type Sender = (entry: OutboxEntry) => Promise<HttpResult<Record<string, unknown>>>;

export const sendToServer: Sender = (entry) =>
  request<Record<string, unknown>>('/api/outbox', { method: 'POST', body: entry, headers: { 'idempotency-key': entry.idempotencyKey } });

export interface DrainResult {
  sent: number;
  rejected: number;
  retrying: number;
  deferred: number;
  stoppedBecause: 'done' | 'unreachable' | 'signed-out';
}

export async function enqueue(entry: OutboxEntry, userId: string, now = Date.now()): Promise<'queued' | 'already-queued'> {
  const db = store();
  return db.transaction('rw', db.outbox, async () => {
    if (await db.outbox.get(entry.idempotencyKey)) return 'already-queued';
    await db.outbox.add({ id: entry.idempotencyKey, userId, entry, state: 'queued', nextAttemptAt: now, lastError: null, updatedAt: now });
    return 'queued';
  });
}

export async function drain(userId: string, options: { now?: number; effectiveType?: string | null; send?: Sender } = {}): Promise<DrainResult> {
  const now = options.now ?? Date.now();
  const send = options.send ?? sendToServer;
  const db = store();
  const result: DrainResult = { sent: 0, rejected: 0, retrying: 0, deferred: 0, stoppedBecause: 'done' };
  const ready = (await db.outbox.where('userId').equals(userId).toArray()).filter((q) => q.state === 'queued' || q.state === 'retrying' || q.state === 'sending');

  for (const queued of drainOrder(ready)) {
    if (queued.nextAttemptAt > now || deferOnSlowNetwork(queued.entry, options.effectiveType ?? null)) {
      result.deferred++;
      continue;
    }
    const attempt: OutboxEntry = { ...queued.entry, attempts: queued.entry.attempts + 1 };
    await db.outbox.update(queued.id, { state: 'sending', updatedAt: now });
    const answer = await send(attempt);

    if (answer.kind === 'unreachable') {
      await db.outbox.update(queued.id, { state: 'queued', updatedAt: now });
      result.stoppedBecause = 'unreachable';
      break;
    }
    if (answer.kind === 'ok' || answer.kind === 'not-modified') {
      await db.outbox.update(queued.id, { state: 'sent', entry: attempt, lastError: null, updatedAt: now });
      result.sent++;
      continue;
    }
    if (answer.kind === 'rejected') {
      if (answer.status === 401) {
        await db.outbox.update(queued.id, { state: 'queued', updatedAt: now });
        result.stoppedBecause = 'signed-out';
        break;
      }
      await db.outbox.update(queued.id, { state: 'rejected', entry: attempt, lastError: answer.message || answer.code, updatedAt: now });
      result.rejected++;
      continue;
    }
    await db.outbox.update(queued.id, {
      state: 'retrying',
      entry: attempt,
      lastError: answer.message || `server error ${answer.status}`,
      nextAttemptAt: now + nextBackoffMs(attempt.attempts, attempt.idempotencyKey),
      updatedAt: now,
    });
    result.retrying++;
  }
  return result;
}

export interface QueueSummary {
  waiting: number;
  sent: number;
  rejected: QueuedEntry[];
}

export async function queueSummary(userId: string): Promise<QueueSummary> {
  const rows = await store().outbox.where('userId').equals(userId).toArray();
  return {
    waiting: rows.filter((r) => r.state === 'queued' || r.state === 'retrying' || r.state === 'sending').length,
    sent: rows.filter((r) => r.state === 'sent').length,
    rejected: rows.filter((r) => r.state === 'rejected'),
  };
}
