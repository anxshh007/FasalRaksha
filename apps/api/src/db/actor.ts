/**
 * ARCH-03 · ownership lives in the database, not the application (PROMPT §8.1).
 *
 * Every request runs as: authenticate → begin → assert the actor for *this transaction only* →
 * query → let row-level security decide. The assertion is signed: the API computes
 * HMAC(context key, user id | role | transaction id) and the database verifies it before any
 * policy trusts the id (migration 0002). Settings made with `set_config(…, true)` are discarded
 * at COMMIT or ROLLBACK, so a pooled connection carries nothing into the next request, and a
 * signature observed in one transaction is worthless in another.
 */
import { createHmac } from 'node:crypto';

import type { Pool, PoolClient } from './pool.js';

/** Account kinds that act on the database. FPO is a first-class account (PROMPT §6.6). */
export const ACTOR_ROLES = ['farmer', 'buyer', 'fpo', 'officer'] as const;
export type ActorRole = (typeof ACTOR_ROLES)[number];

export interface Actor {
  /** The authenticated user's id (UUID). Never taken from a request body. */
  readonly userId: string;
  readonly role: ActorRole;
}

export interface Database {
  pool: Pool;
  /** Shared with PostgreSQL; signs the request context. */
  contextKey: Buffer;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ActorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActorError';
  }
}

/** The signature the database expects for this actor in this transaction. */
export function contextSignature(key: Buffer, actor: Actor, transactionId: string): string {
  return createHmac('sha256', key).update(`${actor.userId}|${actor.role}|${transactionId}`, 'utf8').digest('hex');
}

/** Assert `actor` on an open transaction. Exposed for tests; application code uses withActor. */
export async function assertActor(client: PoolClient, key: Buffer, actor: Actor): Promise<void> {
  if (!UUID.test(actor.userId)) throw new ActorError('The acting user id is not a valid identifier.');
  if (!(ACTOR_ROLES as readonly string[]).includes(actor.role)) throw new ActorError('The acting role is not a known account kind.');
  const { rows } = await client.query<{ xid: string }>('SELECT pg_current_xact_id()::text AS xid');
  const xid = rows[0]?.xid;
  if (xid === undefined) throw new ActorError('PostgreSQL did not report a transaction id.');
  await client.query(
    "SELECT set_config('app.current_user_id', $1, true), set_config('app.current_role', $2, true), set_config('app.context_sig', $3, true)",
    [actor.userId, actor.role, contextSignature(key, actor, xid)],
  );
}

/**
 * Run `work` inside a transaction scoped to `actor`. Commits on success, rolls back on any
 * error, and always returns the connection to the pool.
 */
export async function withActor<T>(db: Database, actor: Actor, work: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!UUID.test(actor.userId)) throw new ActorError('The acting user id is not a valid identifier.');
  if (!(ACTOR_ROLES as readonly string[]).includes(actor.role)) throw new ActorError('The acting role is not a known account kind.');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await assertActor(client, db.contextKey, actor);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** A transaction with no actor — for public reference data only. Policies see an anonymous caller. */
export async function withAnonymous<T>(db: Database, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
