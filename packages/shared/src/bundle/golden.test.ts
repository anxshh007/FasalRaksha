/**
 * SEC-14 · RK-6 · FR-08 — Python ↔ TypeScript parity against the golden vectors in `data/golden/`
 * (written by ml/export/golden.py), and against every bundle the pipeline has actually sealed.
 *
 * The pipeline seals bundles in Python; the device verifies them here. One differing byte in the
 * canonical form would make every honest bundle look tampered with, so parity is asserted on
 * awkward vectors and then on each real artefact committed under `data/bundles/`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { gr3Confidence } from '../decision/decision.js';
import { bandMultiplier, widenBand } from '../staleness/staleness.js';
import { canonicalJson, sha256Hex, utf8, verifyIntegrity } from './integrity.js';
import { parseCropBundle } from './parse.js';
import type { HorizonForecast } from './types.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const golden = <T>(name: string): T => JSON.parse(readFileSync(join(ROOT, 'data', 'golden', name), 'utf8')) as T;

interface CanonicalVector {
  name: string;
  value: unknown;
  canonical: string;
  sha256: string;
}

interface ConfidenceVector {
  p0: number;
  band: { q10: number; q50: number; q90: number };
  kappa: number;
  age: number;
  confidence: number;
  staleConfidence: number;
}

describe('SEC-14 · canonical JSON is byte-identical to the Python pipeline', () => {
  const vectors = golden<{ vectors: CanonicalVector[] }>('canonical.json').vectors;

  it('has vectors to check (guards against a vacuous pass)', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(7);
  });

  for (const v of vectors) {
    it(`${v.name}`, () => {
      const text = canonicalJson(v.value);
      expect(text).toBe(v.canonical);
      expect(sha256Hex(utf8(text))).toBe(v.sha256);
    });
  }
});

describe('RK-6 · GR-3 confidence means the same number in the pipeline and on the phone', () => {
  const vectors = golden<{ vectors: ConfidenceVector[] }>('confidence.json').vectors;
  const forecast = (band: ConfidenceVector['band'], kappa: number): HorizonForecast => ({
    ...band, direction: 'up', agreement: 0.7, skill: 0.1, skillSeasonal: 0.1, coverage: 0.8, bandKappa: kappa,
  });

  it('has vectors to check', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(20);
  });

  it('matches price_confidence to 1e-9 on the shipped band', () => {
    for (const v of vectors) {
      const measured = gr3Confidence(forecast(v.band, v.kappa), v.band, v.p0).measured;
      expect(measured).not.toBeNull();
      expect(Math.abs((measured ?? NaN) - v.confidence)).toBeLessThan(1e-9);
    }
  });

  it('matches after staleness widening to 1e-9', () => {
    for (const v of vectors) {
      const stale = widenBand(v.band, bandMultiplier(v.age, v.kappa));
      const measured = gr3Confidence(forecast(v.band, v.kappa), stale, v.p0).measured;
      expect(Math.abs((measured ?? NaN) - v.staleConfidence)).toBeLessThan(1e-9);
    }
  });
});

describe('SEC-14 · every committed bundle verifies and parses', () => {
  const releases = existsSync(join(ROOT, 'data', 'bundles')) ? readdirSync(join(ROOT, 'data', 'bundles')).filter((d) => /^\d{4}-\d{2}-\d{2}\.\d+$/.test(d)) : [];
  const files = (dir: string): string[] =>
    existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.json') ? [join(dir, e.name)] : [])) : [];

  it('finds at least one release', () => {
    expect(releases.length).toBeGreaterThan(0);
  });

  for (const release of releases) {
    it(`${release}: every Python-sealed pipeline document verifies in TypeScript`, () => {
      const docs = files(join(ROOT, 'data', 'bundles', release, 'pipeline'));
      expect(docs.length).toBeGreaterThan(0);
      for (const path of docs) expect(verifyIntegrity(JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>), path).toBe(true);
    });

    it(`${release}: every published bundle verifies, parses, and is served as its own canonical form`, () => {
      const docs = files(join(ROOT, 'data', 'bundles', release, 'published', 'bundles'));
      expect(docs.length).toBeGreaterThan(0);
      for (const path of docs) {
        const text = readFileSync(path, 'utf8');
        const document = JSON.parse(text) as Record<string, unknown>;
        expect(verifyIntegrity(document), path).toBe(true);
        expect(canonicalJson(document)).toBe(text);
        const bundle = parseCropBundle(document);
        expect(verifyIntegrity(bundle as unknown as Record<string, unknown>)).toBe(true); // parsing changed nothing
      }
    });
  }
});
