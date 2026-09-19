/**
 * Sign-in by one-time code, sessions by rotating refresh tokens (PROMPT §8.5).
 *
 *  - Codes are 6 digits, Argon2id-hashed at rest, valid 5 minutes, 5 attempts, 3 per 10 minutes.
 *  - Refresh tokens are random 256-bit values stored only as keyed hashes; every use rotates the
 *    token; presenting an already-rotated token is treated as theft and revokes the whole session
 *    family (reuse detection).
 *  - Authentication rows carry a MAC over the fields that decide who is being authenticated, so
 *    a row planted or edited with database credentials alone is rejected.
 *
 * Requesting a code never reveals whether an account exists. After the code is verified —
 * possession of the phone proven — the caller is told whether they need to sign up.
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';

import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

import type { MessagingAdapter } from '../../adapters/messaging/index.js';
import { withActor, type ActorRole, type Database } from '../../db/actor.js';
import { DomainError } from '../../http/errors.js';
import { hmacHex, safeEqualHex, type KeyRing } from '../../security/keys.js';
import { normalisePhone, phoneHash } from '../../security/phone.js';
import { issueAccessToken } from '../../security/tokens.js';

export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_PER_WINDOW = 3;
export const OTP_WINDOW_SECONDS = 10 * 60;
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Argon2id with OWASP's minimum profile (19 MiB, t=2, p=1). */
const ARGON = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export type SignupDetails =
  | { kind: 'farmer'; displayName: string; locale: 'mr' | 'hi' | 'en' | 'bn' | 'pa' }
  | { kind: 'buyer'; businessName: string; place: string; district: string; lat?: number | undefined; lon?: number | undefined }
  | { kind: 'fpo'; name: string; district: string; lat: number; lon: number };

export interface AuthDeps {
  db: Database;
  keys: KeyRing;
  messaging: MessagingAdapter;
  now: () => Date;
  /** Outside production the code is returned so a demonstration needs no SMS. */
  exposeCodes: boolean;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  user: { id: string; role: ActorRole };
}

const seconds = (d: Date): number => Math.floor(d.getTime() / 1000);

function requirePhone(input: string): string {
  const e164 = normalisePhone(input);
  if (e164 === null) throw new DomainError(422, 'PHONE_NOT_VALID', 'That is not a 10-digit Indian mobile number.');
  return e164;
}

function otpMac(keys: KeyRing, row: { id: string; phoneHash: string; codeHash: string; expiresAt: string }): string {
  return hmacHex(keys.key('otp-mac'), `${row.id}|${row.phoneHash}|${row.codeHash}|${row.expiresAt}`);
}

function refreshMac(keys: KeyRing, row: { id: string; userId: string; familyId: string; tokenHash: string; expiresAt: string }): string {
  return hmacHex(keys.key('refresh-mac'), `${row.id}|${row.userId}|${row.familyId}|${row.tokenHash}|${row.expiresAt}`);
}

export async function requestOtp(deps: AuthDeps, phoneInput: string): Promise<{ challengeId: string; expiresInSeconds: number; devCode?: string }> {
  const e164 = requirePhone(phoneInput);
  const hashOfPhone = phoneHash(deps.keys, e164);
  const now = deps.now();
  const { rows } = await deps.db.pool.query<{ n: string }>(
    'SELECT count(*) AS n FROM app_auth.otp_challenges WHERE phone_hash = $1 AND created_at > $2',
    [hashOfPhone, new Date(now.getTime() - OTP_WINDOW_SECONDS * 1000)],
  );
  if (Number(rows[0]?.n ?? 0) >= OTP_PER_WINDOW) {
    throw new DomainError(429, 'TOO_MANY_CODES', 'Several codes were sent to this number recently. Please wait ten minutes and try again.');
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const id = randomUUID();
  const codeHash = await argonHash(code, ARGON);
  const expiresAt = new Date(now.getTime() + OTP_TTL_SECONDS * 1000).toISOString();
  await deps.db.pool.query(
    'INSERT INTO app_auth.otp_challenges (id, phone_hash, code_hash, expires_at, created_at, mac) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, hashOfPhone, codeHash, expiresAt, now.toISOString(), otpMac(deps.keys, { id, phoneHash: hashOfPhone, codeHash, expiresAt })],
  );
  await deps.messaging.send(e164, `Fasal Raksha code: ${code}. It expires in 5 minutes. Do not share it.`, now);
  return deps.exposeCodes ? { challengeId: id, expiresInSeconds: OTP_TTL_SECONDS, devCode: code } : { challengeId: id, expiresInSeconds: OTP_TTL_SECONDS };
}

async function issueSession(deps: AuthDeps, userId: string, role: ActorRole, familyId: string): Promise<SessionTokens> {
  const now = deps.now();
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hmacHex(deps.keys.key('refresh-token'), token);
  const id = randomUUID();
  const expiresAt = new Date(now.getTime() + REFRESH_TTL_SECONDS * 1000).toISOString();
  await deps.db.pool.query(
    'INSERT INTO app_auth.refresh_tokens (id, user_id, family_id, token_hash, issued_at, expires_at, mac) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [id, userId, familyId, tokenHash, now.toISOString(), expiresAt, refreshMac(deps.keys, { id, userId, familyId, tokenHash, expiresAt })],
  );
  return {
    accessToken: issueAccessToken(deps.keys, { userId, role, sessionId: familyId }, seconds(now)),
    refreshToken: token,
    sessionId: familyId,
    user: { id: userId, role },
  };
}

async function createProfile(deps: AuthDeps, userId: string, e164: string, signup: SignupDetails): Promise<void> {
  await withActor(deps.db, { userId, role: signup.kind }, async (client) => {
    if (signup.kind === 'farmer') {
      await client.query('INSERT INTO app.farmer_profiles (user_id, display_name, preferred_locale) VALUES ($1, $2, $3)', [userId, signup.displayName, signup.locale]);
      await client.query('INSERT INTO app.farmer_contacts (user_id, phone_e164) VALUES ($1, $2)', [userId, e164]);
    } else if (signup.kind === 'buyer') {
      await client.query(
        'INSERT INTO app.buyer_profiles (user_id, business_name, place, district, location_lat, location_lon) VALUES ($1, $2, $3, $4, $5, $6)',
        [userId, signup.businessName, signup.place, signup.district, signup.lat ?? null, signup.lon ?? null],
      );
      await client.query('INSERT INTO app.buyer_contacts (user_id, phone_e164) VALUES ($1, $2)', [userId, e164]);
    } else {
      await client.query('INSERT INTO app.fpos (user_id, name, district, location_lat, location_lon) VALUES ($1, $2, $3, $4, $5)', [
        userId,
        signup.name,
        signup.district,
        signup.lat,
        signup.lon,
      ]);
      await client.query('INSERT INTO app.fpo_contacts (user_id, phone_e164) VALUES ($1, $2)', [userId, e164]);
    }
    await client.query("INSERT INTO app.audit_log (actor_id, actor_role, action, target_type, target_id) VALUES ($1::uuid, $2, 'account.created', 'user', $1::text)", [
      userId,
      signup.kind,
    ]);
  });
}

export async function verifyOtp(deps: AuthDeps, input: { phone: string; code: string; signup?: SignupDetails | undefined }): Promise<SessionTokens> {
  const e164 = requirePhone(input.phone);
  const hashOfPhone = phoneHash(deps.keys, e164);
  const now = deps.now();
  const { rows } = await deps.db.pool.query<{ id: string; code_hash: string; expires_at: Date; attempts: number; mac: string }>(
    `SELECT id, code_hash, expires_at, attempts, mac FROM app_auth.otp_challenges
      WHERE phone_hash = $1 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [hashOfPhone],
  );
  const challenge = rows[0];
  const wrong = new DomainError(401, 'CODE_WRONG', 'That code is not right, or it has expired. Ask for a new code.');
  if (challenge === undefined) throw wrong;
  const expected = otpMac(deps.keys, { id: challenge.id, phoneHash: hashOfPhone, codeHash: challenge.code_hash, expiresAt: challenge.expires_at.toISOString() });
  if (!safeEqualHex(expected, challenge.mac)) throw wrong;
  if (challenge.expires_at.getTime() <= now.getTime()) throw wrong;
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) throw new DomainError(429, 'TOO_MANY_ATTEMPTS', 'Too many wrong codes. Ask for a new code.');
  if (!/^\d{6}$/.test(input.code) || !(await argonVerify(challenge.code_hash, input.code))) {
    await deps.db.pool.query('UPDATE app_auth.otp_challenges SET attempts = attempts + 1 WHERE id = $1', [challenge.id]);
    throw wrong;
  }
  const consumed = await deps.db.pool.query('UPDATE app_auth.otp_challenges SET consumed_at = $2 WHERE id = $1 AND consumed_at IS NULL', [challenge.id, now]);
  if (consumed.rowCount !== 1) throw wrong;

  const account = await deps.db.pool.query<{ user_id: string; kind: ActorRole; disabled: boolean }>('SELECT user_id, kind, disabled FROM app_auth.account_for_phone($1)', [hashOfPhone]);
  let userId: string;
  let role: ActorRole;
  const existing = account.rows[0];
  if (existing !== undefined) {
    if (existing.disabled) throw new DomainError(403, 'ACCOUNT_DISABLED', 'This account has been disabled. Please contact your district agriculture office.');
    userId = existing.user_id;
    role = existing.kind;
  } else {
    if (input.signup === undefined) {
      throw new DomainError(404, 'NO_ACCOUNT', 'There is no account for this number yet. Choose whether you are a farmer, a buyer or an FPO to create one.');
    }
    const created = await deps.db.pool.query<{ id: string }>('SELECT app_auth.create_account($1, $2) AS id', [input.signup.kind, hashOfPhone]);
    userId = created.rows[0]?.id ?? '';
    role = input.signup.kind;
    await createProfile(deps, userId, e164, input.signup);
  }
  return issueSession(deps, userId, role, randomUUID());
}

export async function refreshSession(deps: AuthDeps, refreshToken: string): Promise<SessionTokens> {
  const expired = new DomainError(401, 'SESSION_EXPIRED', 'Your session has ended. Please sign in again.');
  if (!/^[A-Za-z0-9_-]{43}$/.test(refreshToken)) throw expired;
  const tokenHash = hmacHex(deps.keys.key('refresh-token'), refreshToken);
  const { rows } = await deps.db.pool.query<{
    id: string;
    user_id: string;
    family_id: string;
    expires_at: Date;
    rotated_at: Date | null;
    revoked_at: Date | null;
    mac: string;
    kind: ActorRole;
    disabled: boolean;
  }>(
    `SELECT t.id, t.user_id, t.family_id, t.expires_at, t.rotated_at, t.revoked_at, t.mac, u.kind, u.disabled
       FROM app_auth.refresh_tokens t JOIN app_auth.phone_index p ON p.user_id = t.user_id,
            LATERAL app_auth.account_for_phone(p.phone_hash) u
      WHERE t.token_hash = $1`,
    [tokenHash],
  );
  const row = rows[0];
  if (row === undefined) throw expired;
  const expected = refreshMac(deps.keys, { id: row.id, userId: row.user_id, familyId: row.family_id, tokenHash, expiresAt: row.expires_at.toISOString() });
  if (!safeEqualHex(expected, row.mac)) throw expired;
  if (row.revoked_at !== null) throw expired;
  if (row.rotated_at !== null) {
    // Reuse of a rotated token: someone else holds a copy. End the whole session.
    await revokeSession(deps, row.family_id);
    throw new DomainError(401, 'SESSION_REVOKED', 'For your safety this session was ended because it was used from two places. Please sign in again.');
  }
  if (row.expires_at.getTime() <= deps.now().getTime()) throw expired;
  if (row.disabled) throw new DomainError(403, 'ACCOUNT_DISABLED', 'This account has been disabled. Please contact your district agriculture office.');
  const rotated = await deps.db.pool.query('UPDATE app_auth.refresh_tokens SET rotated_at = $2 WHERE id = $1 AND rotated_at IS NULL AND revoked_at IS NULL', [row.id, deps.now()]);
  if (rotated.rowCount !== 1) throw expired;
  return issueSession(deps, row.user_id, row.kind, row.family_id);
}

export async function revokeSession(deps: AuthDeps, familyId: string): Promise<void> {
  await deps.db.pool.query('UPDATE app_auth.refresh_tokens SET revoked_at = coalesce(revoked_at, $2) WHERE family_id = $1', [familyId, deps.now()]);
}

/** True when the session has been revoked (checked on sensitive operations, not every read). */
export async function isSessionRevoked(deps: Pick<AuthDeps, 'db'>, familyId: string): Promise<boolean> {
  const { rows } = await deps.db.pool.query<{ live: boolean }>(
    'SELECT bool_or(revoked_at IS NULL) AS live FROM app_auth.refresh_tokens WHERE family_id = $1',
    [familyId],
  );
  return rows[0]?.live !== true;
}
