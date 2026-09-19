/**
 * Short-lived access tokens: compact JWS, HS256, signed with a purpose-bound key. No library —
 * the format is small, and every byte of it is checked here: header, algorithm, signature
 * (constant-time), issue and expiry times, and the claim types.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { ActorRole } from '../db/actor.js';
import type { KeyRing } from './keys.js';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export interface AccessClaims {
  /** User id. */
  sub: string;
  role: ActorRole;
  /** Session (refresh-token family) id — revoking it ends the session. */
  sid: string;
  iat: number;
  exp: number;
}

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const ROLES: readonly string[] = ['farmer', 'buyer', 'fpo', 'officer'];

function sign(keys: KeyRing, data: string): Buffer {
  return createHmac('sha256', keys.key('access-token')).update(data).digest();
}

export function issueAccessToken(keys: KeyRing, subject: { userId: string; role: ActorRole; sessionId: string }, nowSeconds: number): string {
  const claims: AccessClaims = { sub: subject.userId, role: subject.role, sid: subject.sessionId, iat: nowSeconds, exp: nowSeconds + ACCESS_TOKEN_TTL_SECONDS };
  const body = `${HEADER}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  return `${body}.${sign(keys, body).toString('base64url')}`;
}

export type TokenProblem = 'malformed' | 'bad-signature' | 'expired' | 'not-yet-valid';

export function verifyAccessToken(keys: KeyRing, token: string, nowSeconds: number): { ok: true; claims: AccessClaims } | { ok: false; problem: TokenProblem } {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== HEADER) return { ok: false, problem: 'malformed' };
  const [header, payload, signature] = parts as [string, string, string];
  const expected = sign(keys, `${header}.${payload}`);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, problem: 'bad-signature' };
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, problem: 'malformed' };
  }
  if (typeof claims !== 'object' || claims === null) return { ok: false, problem: 'malformed' };
  const c = claims as Record<string, unknown>;
  if (typeof c['sub'] !== 'string' || typeof c['sid'] !== 'string' || typeof c['role'] !== 'string' || !ROLES.includes(c['role'])) {
    return { ok: false, problem: 'malformed' };
  }
  if (typeof c['iat'] !== 'number' || typeof c['exp'] !== 'number') return { ok: false, problem: 'malformed' };
  if (c['iat'] > nowSeconds + 60) return { ok: false, problem: 'not-yet-valid' };
  if (c['exp'] <= nowSeconds) return { ok: false, problem: 'expired' };
  return { ok: true, claims: { sub: c['sub'], role: c['role'] as ActorRole, sid: c['sid'], iat: c['iat'], exp: c['exp'] } };
}
