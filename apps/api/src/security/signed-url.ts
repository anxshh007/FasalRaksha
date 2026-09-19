/**
 * Short-lived signed URLs for photographs (PROMPT §8.6; SEC-13).
 *
 * A photo is served only through a URL that names one storage key, one viewer and an expiry,
 * signed with the API's key. Changing any of the three — another photo's key (IDOR), another
 * viewer, a later expiry — breaks the signature; an expired URL is refused even if intact.
 */
import { hmacHex, safeEqualHex, type KeyRing } from './keys.js';

export const SIGNED_URL_TTL_SECONDS = 5 * 60;

function payload(storageKey: string, viewerId: string, expires: number): string {
  return `photo|${storageKey}|${viewerId}|${expires}`;
}

export function signPhotoUrl(keys: KeyRing, storageKey: string, viewerId: string, nowSeconds: number): string {
  const expires = nowSeconds + SIGNED_URL_TTL_SECONDS;
  const sig = hmacHex(keys.key('signed-url'), payload(storageKey, viewerId, expires));
  return `/api/photos/${storageKey}?v=${encodeURIComponent(viewerId)}&e=${expires}&s=${sig}`;
}

export type SignedUrlProblem = 'malformed' | 'bad-signature' | 'expired' | 'wrong-viewer';

export function verifyPhotoUrl(
  keys: KeyRing,
  params: { storageKey: string; viewer: string; expires: string; signature: string },
  requestingViewerId: string,
  nowSeconds: number,
): { ok: true } | { ok: false; problem: SignedUrlProblem } {
  const expires = Number(params.expires);
  if (!Number.isInteger(expires) || !/^[0-9a-f]{64}$/.test(params.signature)) return { ok: false, problem: 'malformed' };
  const expected = hmacHex(keys.key('signed-url'), payload(params.storageKey, params.viewer, expires));
  if (!safeEqualHex(expected, params.signature)) return { ok: false, problem: 'bad-signature' };
  if (expires <= nowSeconds) return { ok: false, problem: 'expired' };
  if (params.viewer !== requestingViewerId) return { ok: false, problem: 'wrong-viewer' };
  return { ok: true };
}
