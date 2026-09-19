/**
 * Gate B, application half — SEC-09 · SEC-13 · SEC-14. Attacks that never reach PostgreSQL
 * because the API refuses them first. The database half is sec.db.test.ts.
 */
import { randomBytes } from 'node:crypto';

import { computeIntegrity, verifyIntegrity } from '@fasal/shared';
import { describe, expect, it } from 'vitest';

import { DomainError } from '../../src/http/errors.js';
import { parseOutboxEntry } from '../../src/modules/outbox/schema.js';
import { createKeyRing } from '../../src/security/keys.js';
import { SIGNED_URL_TTL_SECONDS, signPhotoUrl, verifyPhotoUrl } from '../../src/security/signed-url.js';

const keys = createKeyRing(randomBytes(32).toString('hex'), randomBytes(32).toString('hex'));
const NOW = 1_789_000_000;

function paramsOf(url: string): { storageKey: string; viewer: string; expires: string; signature: string } {
  const parsed = new URL(url, 'http://x');
  return {
    storageKey: parsed.pathname.split('/').pop() ?? '',
    viewer: parsed.searchParams.get('v') ?? '',
    expires: parsed.searchParams.get('e') ?? '',
    signature: parsed.searchParams.get('s') ?? '',
  };
}

describe('SEC-09 · an offline-constructed deal transition submitted through the outbox fails to bypass', () => {
  const base = { idempotencyKey: 'offline-accept-1', createdAt: '2026-09-06T10:00:00.000Z', attempts: 0 };

  it.each(['deal.accept', 'offer.accept', 'ACCEPT', 'payment.confirm', 'rating.create', 'dispute.raise'])('refuses kind "%s" before it reaches the database', (kind) => {
    expect(() => parseOutboxEntry({ ...base, kind, dealId: '11111111-1111-4111-8111-111111111111' })).toThrow(DomainError);
    try {
      parseOutboxEntry({ ...base, kind });
    } catch (error) {
      expect((error as DomainError).code).toBe('NOT_AN_OFFLINE_ACTION');
      expect((error as DomainError).status).toBe(422);
    }
  });

  it('refuses a listing entry smuggling an unmarked price', () => {
    expect(() =>
      parseOutboxEntry({
        ...base,
        kind: 'listing.create',
        listing: { clientId: 'abcdefgh', crop: 'onion', quantity: { value: 5, unit: 'quintal' }, askingPrice: { amount: 2500, unit: null }, grade: null, gradeProvenance: null, availableFrom: '2026-09-06', availableUntil: '2026-09-10', poolOptIn: false },
      }),
    ).toThrow();
  });

  it('accepts a genuine offline listing creation', () => {
    const entry = parseOutboxEntry({
      ...base,
      kind: 'listing.create',
      listing: { clientId: 'abcdefgh', crop: 'onion', quantity: { value: 5, unit: 'quintal' }, askingPrice: null, grade: 'B', gradeProvenance: 'farmer-declared', availableFrom: '2026-09-06', availableUntil: '2026-09-10', poolOptIn: true },
    });
    expect(entry.kind).toBe('listing.create');
  });
});

describe('SEC-13 · IDOR on a photo’s signed URL after expiry fails to bypass', () => {
  const viewer = '33333333-3333-4333-8333-333333333333';
  const url = signPhotoUrl(keys, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', viewer, NOW);

  it('serves the photo to the named viewer before expiry', () => {
    expect(verifyPhotoUrl(keys, paramsOf(url), viewer, NOW + 10)).toEqual({ ok: true });
  });

  it('refuses the same, untouched URL once it has expired', () => {
    expect(verifyPhotoUrl(keys, paramsOf(url), viewer, NOW + SIGNED_URL_TTL_SECONDS + 1)).toEqual({ ok: false, problem: 'expired' });
  });

  it('refuses another photo’s key under the same signature (IDOR)', () => {
    const swapped = { ...paramsOf(url), storageKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
    expect(verifyPhotoUrl(keys, swapped, viewer, NOW + 10)).toEqual({ ok: false, problem: 'bad-signature' });
  });

  it('refuses a stretched expiry', () => {
    const stretched = { ...paramsOf(url), expires: String(NOW + 86_400) };
    expect(verifyPhotoUrl(keys, stretched, viewer, NOW + 10)).toEqual({ ok: false, problem: 'bad-signature' });
  });

  it('refuses a URL forwarded to someone else', () => {
    expect(verifyPhotoUrl(keys, paramsOf(url), '44444444-4444-4444-8444-444444444444', NOW + 10)).toEqual({ ok: false, problem: 'wrong-viewer' });
  });

  it('refuses a URL signed with a different key', () => {
    const other = createKeyRing(randomBytes(32).toString('hex'), randomBytes(32).toString('hex'));
    expect(verifyPhotoUrl(other, paramsOf(url), viewer, NOW + 10)).toEqual({ ok: false, problem: 'bad-signature' });
  });
});

describe('SEC-14 · bundle tampering is rejected by the integrity check', () => {
  const content = { schemaVersion: 3, crop: 'onion', district: 'nashik', asOf: '2026-09-04', benchmark: { modal: 1840, min: 1500, max: 2100, unit: 'quintal' } };
  const sealed = { ...content, integrity: computeIntegrity(content) };

  it('accepts the sealed bundle', () => {
    expect(verifyIntegrity(sealed)).toBe(true);
  });

  it('rejects the bundle with a changed modal price', () => {
    expect(verifyIntegrity({ ...sealed, benchmark: { ...sealed.benchmark, modal: 1940 } })).toBe(false);
  });

  it('rejects the bundle re-dated to look fresh', () => {
    expect(verifyIntegrity({ ...sealed, asOf: '2026-09-18' })).toBe(false);
  });
});
