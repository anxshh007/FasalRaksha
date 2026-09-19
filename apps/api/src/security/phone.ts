/**
 * Indian mobile numbers: normalised once to E.164 (+91XXXXXXXXXX), and looked up only through a
 * keyed hash — the phone index never holds a number, and the hash cannot be recomputed by anyone
 * without the API's key.
 */
import { hmacHex, type KeyRing } from './keys.js';

/** "+91 98765 43210", "09876543210", "9876543210" → "+919876543210"; anything else → null. */
export function normalisePhone(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, '');
  const match = /^(?:\+?91|0)?([6-9]\d{9})$/.exec(digits);
  return match === null ? null : `+91${match[1] ?? ''}`;
}

export function phoneHash(keys: KeyRing, e164: string): string {
  return hmacHex(keys.key('phone-index'), e164);
}

/** "+919876543210" → "••••••3210": the most any screen ever shows of someone's number. */
export function maskPhone(e164: string): string {
  return `••••••${e164.slice(-4)}`;
}
