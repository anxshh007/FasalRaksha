/**
 * ARCH-03 · ownership lives in the database, not the application (PROMPT §8.1).
 *
 * Every request runs as: authenticate → begin → set the acting user and role for *this
 * transaction only* → query → let row-level security decide. `set_config(name, value, true)`
 * is the parameterisable form of `SET LOCAL`: the setting is discarded at COMMIT or ROLLBACK,
 * so a pooled connection handed to the next request carries nothing of the previous one.
 *
 * The policies that read these settings (through `app.actor_id()` / `app.actor_role()`,
 * migration 0001) arrive with the schema in P3. This module is the only way application code
 * obtains a database client for request work.
 */
import type { Pool, PoolClient } from './pool.js';

/** Account kinds that act on the database. FPO is a first-class account (PROMPT §6.6). */
export const ACTOR_ROLES = ['farmer', 'buyer', 'fpo', 'officer'] as const;
export type ActorRole = (typeof ACTOR_ROLES)[number];

export interface Actor {
  /** The authenticated user's id (UUID). Never taken from a request body. */
  readonly userId: string;
  readonly role: ActorRole;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ActorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActorError';
  }
}

/**
 * Run `work` inside a transaction scoped to `actor`. Commits on success, rolls back on any
 * error, and always returns the connection to the pool.
 */
export async function withActor<T>(pool: Pool, actor: Actor, work: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!UUID.test(actor.userId)) throw new ActorError('The acting user id is not a valid identifier.');
  if (!(ACTOR_ROLES as readonly string[]).includes(actor.role)) throw new ActorError('The acting role is not a known account kind.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_user_id', $1, true), set_config('app.current_role', $2, true)", [
      actor.userId,
      actor.role,
    ]);
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
