/**
 * Key material. One secret (AUTH_SECRET) is expanded with HKDF into independent, purpose-bound
 * keys, so a token-signing key can never verify a row MAC and a phone-hash key never signs a URL.
 * All comparisons of secrets are constant-time.
 */
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

export type KeyPurpose = 'access-token' | 'phone-index' | 'registry-id' | 'otp-mac' | 'refresh-token' | 'refresh-mac' | 'signed-url' | 'relay';

export interface KeyRing {
  key(purpose: KeyPurpose): Buffer;
  /** The key shared with PostgreSQL for signing the request context. */
  contextKey: Buffer;
}

export function createKeyRing(authSecretHex: string, contextKeyHex: string): KeyRing {
  const secret = Buffer.from(authSecretHex, 'hex');
  const contextKey = Buffer.from(contextKeyHex, 'hex');
  if (secret.length < 32 || contextKey.length < 32) throw new RangeError('Keys must be at least 32 bytes.');
  const cache = new Map<KeyPurpose, Buffer>();
  return {
    contextKey,
    key(purpose) {
      let derived = cache.get(purpose);
      if (derived === undefined) {
        derived = Buffer.from(hkdfSync('sha256', secret, Buffer.from('fasal-raksha/v3'), Buffer.from(purpose), 32));
        cache.set(purpose, derived);
      }
      return derived;
    },
  };
}

export function hmacHex(key: Buffer, message: string): string {
  return createHmac('sha256', key).update(message, 'utf8').digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}
