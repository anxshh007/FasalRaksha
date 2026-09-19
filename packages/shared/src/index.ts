/**
 * @fasal/shared — the one implementation of every Fasal Raksha domain rule.
 *
 * Imported by the PWA for on-device computation, by the API so that server responses mirror
 * the device, and by the WhatsApp / SMS / IVR channels; mirrored by the Python pipeline under
 * parity tests against golden vectors in `data/golden/`. Constitution §3: a WhatsApp reply and
 * an offline home screen must produce the identical number.
 *
 * Purity is enforced by `purity.test.ts` (ARCH-01): zero runtime dependencies, no I/O, no
 * clock, no randomness, no framework imports. Anything time-dependent takes `today` as input.
 */
export * from './core/types.js';
export * from './core/dates.js';
export * from './core/geo.js';
export * from './constants/policy.js';
export * from './crops/types.js';
export * from './units/units.js';
export * from './staleness/staleness.js';
export * from './bundle/types.js';
export * from './bundle/integrity.js';
export * from './benchmark/benchmark.js';
export * from './decision/storage.js';
export * from './decision/decision.js';
export * from './matching/types.js';
export * from './matching/freight.js';
export * from './matching/risk.js';
export * from './matching/rank.js';
export * from './aggregation/pools.js';
export * from './dealstate/dealstate.js';
export * from './dealstate/outbox.js';
export * from './parser/lexicon.js';
export * from './parser/parse.js';
