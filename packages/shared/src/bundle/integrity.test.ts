/** SEC-14 · a modified bundle is rejected by the integrity check. */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { onionBundle } from '../testing/fixtures.js';
import { canonicalJson, computeIntegrity, sha256Hex, utf8, verifyIntegrity } from './integrity.js';

describe('SEC-14 · bundle integrity', () => {
  it('SHA-256 matches the standard test vectors and Node’s implementation', () => {
    expect(sha256Hex(utf8(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(utf8('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    for (const text of ['कांदा ₹1,840/क्विंटल', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), '🧅'.repeat(40)]) {
      expect(sha256Hex(utf8(text))).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    }
  });

  it('canonical JSON sorts keys at every depth and drops undefined members', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 0, y: -0 }], c: 'x' }, u: undefined })).toBe('{"a":{"c":"x","d":[1,{"y":0,"z":0}]},"b":1}');
    expect(() => canonicalJson({ n: Number.NaN })).toThrow(RangeError);
  });

  it('accepts an untouched bundle', () => {
    const bundle = onionBundle();
    const sealed = { ...bundle, integrity: computeIntegrity(bundle as unknown as Record<string, unknown>) };
    expect(verifyIntegrity(sealed as unknown as Record<string, unknown>)).toBe(true);
  });

  it('rejects a bundle whose price was changed after sealing', () => {
    const bundle = onionBundle();
    const sealed = { ...bundle, integrity: computeIntegrity(bundle as unknown as Record<string, unknown>) };
    const tampered = { ...sealed, benchmark: { ...sealed.benchmark, modal: 2840 } };
    expect(verifyIntegrity(tampered as unknown as Record<string, unknown>)).toBe(false);
  });

  it('rejects a doctored forecast, a missing seal and a malformed seal', () => {
    const bundle = onionBundle();
    const sealed = { ...bundle, integrity: computeIntegrity(bundle as unknown as Record<string, unknown>) };
    const h7 = sealed.forecast?.h7;
    if (!h7) throw new Error('fixture has h7');
    const doctored = { ...sealed, forecast: { h7: { ...h7, agreement: 0.99 }, h14: null } };
    expect(verifyIntegrity(doctored as unknown as Record<string, unknown>)).toBe(false);
    expect(verifyIntegrity({ ...bundle, integrity: undefined } as unknown as Record<string, unknown>)).toBe(false);
    expect(verifyIntegrity({ ...bundle, integrity: 'sha256-nothex' } as unknown as Record<string, unknown>)).toBe(false);
  });

  it('is independent of key order — the same content always seals the same', () => {
    const a = { x: 1, y: { p: 2, q: 3 } };
    const b = { y: { q: 3, p: 2 }, x: 1 };
    expect(computeIntegrity(a)).toBe(computeIntegrity(b));
  });
});
