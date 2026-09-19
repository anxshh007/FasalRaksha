/**
 * SEC-14 · FR-08 — the strict bundle parser the API runs before serving and the device runs
 * before storing. Each refusal is its own case: a bundle that parses is one every consumer can
 * rely on without re-checking.
 */
import { describe, expect, it } from 'vitest';

import { onionBundle } from '../testing/fixtures.js';
import { computeIntegrity } from './integrity.js';
import { BundleShapeError, parseCropBundle } from './parse.js';
import type { CropBundle } from './types.js';

type Doc = Record<string, unknown>;

function sealed(overrides: Partial<CropBundle> | Doc = {}): Doc {
  const { integrity: _drop, ...content } = { ...onionBundle(), ...overrides } as Doc;
  return { ...content, integrity: computeIntegrity(content) };
}

const refusal = (document: unknown): string => {
  try {
    parseCropBundle(document);
  } catch (error) {
    if (error instanceof BundleShapeError) return error.path;
    throw error;
  }
  throw new Error('the parser accepted it');
};

describe('SEC-14 · parseCropBundle', () => {
  it('accepts a well-formed bundle and returns the same content', () => {
    const document = sealed();
    const bundle = parseCropBundle(document);
    expect(computeIntegrity(bundle as unknown as Doc)).toBe(document['integrity']);
    expect(bundle.forecast?.h7?.q50).toBe(1990);
  });

  it('accepts a bundle whose crop has no seasonal history', () => {
    expect(parseCropBundle(sealed({ seasonal: null })).seasonal).toBeNull();
  });

  it('refuses a field it does not know — a new field means a new schema version', () => {
    expect(refusal({ ...sealed(), advice: 'wait' })).toBe('bundle.advice');
  });

  it('refuses another schema version', () => {
    expect(refusal(sealed({ schemaVersion: 2 } as Doc))).toBe('bundle.schemaVersion');
  });

  it('refuses crossing quantiles', () => {
    const base = onionBundle();
    const h7 = base.forecast?.h7;
    if (!h7) throw new Error('fixture has no h7');
    expect(refusal(sealed({ forecast: { h7: { ...h7, q10: 2000 }, h14: null } }))).toBe('bundle.forecast.h7');
  });

  it('refuses an agreement below the one-third floor', () => {
    const h7 = onionBundle().forecast?.h7;
    if (!h7) throw new Error('fixture has no h7');
    expect(refusal(sealed({ forecast: { h7: { ...h7, agreement: 0.2 }, h14: null } }))).toBe('bundle.forecast.h7.agreement');
  });

  it('refuses a withheld bundle that still carries a forecast', () => {
    expect(refusal(sealed({ status: 'insufficient' }))).toBe('bundle.forecast');
  });

  it('refuses a published bundle with no forecast at either horizon', () => {
    expect(refusal(sealed({ forecast: { h7: null, h14: null } }))).toBe('bundle.forecast');
  });

  it('refuses a benchmark outside its own min–max', () => {
    expect(refusal(sealed({ benchmark: { modal: 2500, min: 1500, max: 2100, unit: 'quintal' } }))).toBe('bundle.benchmark');
  });

  it('refuses an impossible date', () => {
    expect(refusal(sealed({ asOf: '2026-02-30' }))).toBe('bundle.asOf');
  });

  it('refuses a price that is not a positive number', () => {
    expect(refusal(sealed({ benchmark: { modal: -1840, min: 1500, max: 2100, unit: 'quintal' } }))).toBe('bundle.benchmark.modal');
    expect(refusal({ ...sealed(), benchmark: { modal: '1840', min: 1500, max: 2100, unit: 'quintal' } })).toBe('bundle.benchmark.modal');
  });

  it('refuses a layer reading with negative weight — weights are max(0, skill)', () => {
    const layers = { ...onionBundle().raksha.layers, 'RK-4': { bucket: 'flat' as const, weight: -0.1, value: 0 } };
    expect(refusal(sealed({ raksha: { layers } }))).toBe('bundle.raksha.layers.RK-4.weight');
  });

  it('refuses a malformed integrity field', () => {
    expect(refusal({ ...sealed(), integrity: 'md5-abc' })).toBe('bundle.integrity');
  });
});
