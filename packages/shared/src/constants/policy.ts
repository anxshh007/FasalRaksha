/**
 * THE policy-constants module (PROMPT §0.4). Every number here that comes from outside the
 * codebase names the source it must be confirmed against and carries `verified`. Nothing else
 * in the repository may declare a second copy of any of these (ARCH-01 checks declarations).
 *
 * `verified: false` means: entered from a public source by the build, not yet confirmed by the
 * team against the gazette / release. Judge Mode lists every unverified constant in use, and the
 * farmer UI shows the MSP season with the figure so an outdated value is visible, not silent.
 *
 * Design parameters (thresholds of the decision rule, the default-risk prior) are not
 * government policy; they are marked `kind: 'design'` and justified in their note.
 */

export interface PolicyConstant<T> {
  readonly value: T;
  readonly kind: 'policy' | 'design' | 'specification';
  readonly source: string;
  readonly verified: boolean;
  readonly note?: string;
}

// ─── Minimum Support Prices (₹ per quintal) ────────────────────────────────────────────────

export interface MspEntry {
  readonly key: string;
  readonly label: string;
  readonly amountPerQuintal: number;
  readonly season: string;
}

const KMS_2025_26 = 'CACP / PIB release "MSP for Kharif crops for Marketing Season 2025-26", Cabinet decision of 28 May 2025';
const RMS_2025_26 = 'CACP / PIB release "MSP for Rabi crops for Marketing Season 2025-26", Cabinet decision of 16 October 2024';

export const MSP_TABLE: PolicyConstant<readonly MspEntry[]> = {
  kind: 'policy',
  verified: false,
  source: `${KMS_2025_26}; ${RMS_2025_26}`,
  note:
    'Latest seasons the build could cite with confidence. The Kharif 2026-27 and Rabi 2026-27 figures must be ' +
    'confirmed and substituted by the team; the season is shown beside every MSP figure so a stale season is visible.',
  value: [
    { key: 'paddy-common', label: 'Paddy (common)', amountPerQuintal: 2369, season: 'KMS 2025-26' },
    { key: 'jowar-hybrid', label: 'Jowar (hybrid)', amountPerQuintal: 3699, season: 'KMS 2025-26' },
    { key: 'maize', label: 'Maize', amountPerQuintal: 2400, season: 'KMS 2025-26' },
    { key: 'tur', label: 'Tur (arhar)', amountPerQuintal: 8000, season: 'KMS 2025-26' },
    { key: 'soybean-yellow', label: 'Soybean (yellow)', amountPerQuintal: 5328, season: 'KMS 2025-26' },
    { key: 'cotton-medium', label: 'Cotton (medium staple)', amountPerQuintal: 7710, season: 'KMS 2025-26' },
    { key: 'wheat', label: 'Wheat', amountPerQuintal: 2425, season: 'RMS 2025-26' },
    { key: 'gram', label: 'Gram', amountPerQuintal: 5650, season: 'RMS 2025-26' },
  ],
};

/** The MSP entry for an `mspKey`, or null. Crops with no declared MSP (onion, tomato…) have no key. */
export function mspEntry(key: string | null | undefined): MspEntry | null {
  if (key === null || key === undefined) return null;
  return MSP_TABLE.value.find((entry) => entry.key === key) ?? null;
}

// ─── Staleness (specification) ─────────────────────────────────────────────────────────────

export const STALENESS_LIMIT_DAYS: PolicyConstant<{ perishable: number; grain: number }> = {
  kind: 'specification',
  verified: true,
  source: 'PROMPT.md Constitution §10: suppressed past 7 days (perishables) / 14 days (grains)',
  value: { perishable: 7, grain: 14 },
};

// ─── RAKSHA decision rule ──────────────────────────────────────────────────────────────────

export const TOLERABLE_LOSS_FRACTION_DEFAULT: PolicyConstant<number> = {
  kind: 'specification',
  verified: true,
  source: 'PROMPT.md §5.5: τ_loss default 0.02, farmer-adjustable',
  value: 0.02,
};

export const AGREEMENT_MIN: PolicyConstant<number> = {
  kind: 'design',
  verified: false,
  source: 'RAKSHA-QAD design parameter (GR-4)',
  note:
    'Agreement is the winning bucket’s share of measured skill weight, in [1/3, 1]. 0.6 requires the winning ' +
    'direction to hold a clear majority of the evidence. P6 checked it against held-out precision on "wait" ' +
    '(0.44–0.85 across the published crop × horizons of the synthetic run, 0.60 or better in 20 of 21) and left ' +
    'it unchanged: synthetic ' +
    'data can confirm the gate works, not justify moving it. Re-check on real data.',
  value: 0.6,
};

export const STRONG_AGREEMENT: PolicyConstant<number> = {
  kind: 'design',
  verified: false,
  source: 'RAKSHA-QAD design parameter (evidence-strength label)',
  note: 'Agreement at or above this is described to the farmer as "strong"; between AGREEMENT_MIN and this, "moderate".',
  value: 0.8,
};

export const CONFIDENCE_FLOOR: PolicyConstant<number> = {
  kind: 'design',
  verified: false,
  source: 'RAKSHA-QAD design parameter (GR-3, the policy half of "the higher of two thresholds")',
  note:
    'Forecast confidence = expected move (q50 − today) divided by the staleness-widened band width (q90 − q10). ' +
    'GR-3 requires it to clear max(this floor, the crop’s own calibrated threshold shipped in the bundle).',
  value: 0.25,
};

export const FINANCE_RATE_ANNUAL_DEFAULT: PolicyConstant<number> = {
  kind: 'policy',
  verified: false,
  source: 'RBI Kisan Credit Card norms (7% p.a. nominal before subvention) and NSS 77th round evidence of informal credit at far higher rates',
  note:
    'The smallholder’s effective annual cost of short-term money, used when no e-NWR pledge is available and to cost ' +
    'payment delay. 12% sits between subsidised KCC credit and informal lending; the farmer may override it.',
  value: 0.12,
};

export const MAX_STORAGE_DISTANCE_KM: PolicyConstant<number> = {
  kind: 'design',
  verified: false,
  source: 'RAKSHA-QAD design parameter (GR-7 "within reach")',
  note: 'A warehouse farther than this by road is not treated as a real option for a smallholder lot.',
  value: 60,
};

// ─── Matching ──────────────────────────────────────────────────────────────────────────────

export const ROAD_DISTANCE_FACTOR: PolicyConstant<number> = {
  kind: 'design',
  verified: false,
  source: 'Circuity factor for rural Indian road networks (typically 1.2–1.4 in the transport literature)',
  note: 'Road km ≈ great-circle km × this factor, until a routing adapter supplies real road distance.',
  value: 1.3,
};

export const MANDI_CHARGES_FRACTION: PolicyConstant<number> = {
  kind: 'policy',
  verified: false,
  source: 'Maharashtra APMC market fee, weighing and hamali charges (MSAMB); to be confirmed per market',
  note: 'Deducted from the district modal to price the farmer’s own alternative: taking the lot to the nearest mandi.',
  value: 0.02,
};

export const DEFAULT_RISK_PRIOR: PolicyConstant<{ defaults: number; exposureDays: number }> = {
  kind: 'design',
  verified: false,
  source: 'Bayesian shrinkage prior for the default hazard (Gamma–Poisson), RAKSHA matching design',
  note:
    'Default risk is modelled as a hazard per day that money is outstanding, estimated from the buyer’s own history ' +
    'and shrunk toward one default per 1,000 exposure-days so a new buyer with no history is not treated as risk-free. ' +
    'Risk therefore grows with payment delay, which is why a slow payer offering more can rank below a prompt one.',
  value: { defaults: 1, exposureDays: 1000 },
};

export const PAYMENT_DAYS_PRIOR: PolicyConstant<number> = {
  kind: 'design',
  verified: false,
  source: 'Matching design parameter',
  note: 'Expected days-to-pay assumed for a buyer with no completed deal, so an unknown payer is costed, not trusted.',
  value: 30,
};

export const MAX_DEFAULT_PROBABILITY: PolicyConstant<number> = {
  kind: 'design',
  verified: false,
  source: 'Matching design parameter (the payment-risk half of the workable threshold)',
  note: 'A buyer whose estimated chance of not paying for this lot exceeds this is not shortlisted, whatever the price.',
  value: 0.15,
};

// ─── Storage economics (feed RK-7 through the storage registry) ─────────────────────────────

export type StorageKind = 'dry-warehouse' | 'ventilated-chawl' | 'cold-store';

export const STORAGE_SPOILAGE_PER_MONTH: PolicyConstant<Readonly<Record<StorageKind, Readonly<Record<string, number>>>>> = {
  kind: 'policy',
  verified: false,
  source:
    'Storage-stage loss shares in NABCONS "Study to determine post-harvest losses of agri produces in India" (MoFPI, 2022) and ICAR-CIPHET storage guidance; per-month figures are the build’s reading of them',
  note:
    'Expected fraction of the lot lost per month of storage (weight loss, rot, sprouting, pests), by storage type and crop. ' +
    'A crop missing from a storage type is not stored there. To be confirmed with the team before any figure is presented as authoritative.',
  value: {
    'dry-warehouse': { soybean: 0.003, tur: 0.003, wheat: 0.002, gram: 0.003, maize: 0.004, jowar: 0.003, paddy: 0.003, cotton: 0.002 },
    'ventilated-chawl': { onion: 0.03, potato: 0.04 },
    'cold-store': { potato: 0.01, onion: 0.015, tomato: 0.12, banana: 0.1, orange: 0.06, pomegranate: 0.04, grapes: 0.05, chilli: 0.08, mango: 0.09 },
  },
};

/** Every constant above, for Judge Mode and the policy review sheet. */
export const ALL_POLICY_CONSTANTS: Readonly<Record<string, PolicyConstant<unknown>>> = {
  MSP_TABLE,
  STALENESS_LIMIT_DAYS,
  TOLERABLE_LOSS_FRACTION_DEFAULT,
  AGREEMENT_MIN,
  STRONG_AGREEMENT,
  CONFIDENCE_FLOOR,
  FINANCE_RATE_ANNUAL_DEFAULT,
  MAX_STORAGE_DISTANCE_KM,
  ROAD_DISTANCE_FACTOR,
  MANDI_CHARGES_FRACTION,
  DEFAULT_RISK_PRIOR,
  PAYMENT_DAYS_PRIOR,
  MAX_DEFAULT_PROBABILITY,
  STORAGE_SPOILAGE_PER_MONTH,
};
