/**
 * Out-of-distribution rejection (PROMPT §7.2): a separate stage with a hard floor, run on every
 * captured view before a grading model sees it. It must turn away a ceiling, a shoe, a wall, a
 * face, an unrelated object or an unusable background. It is a distinct code path from "the model
 * is unsure": different copy, and no confidence band at all.
 *
 * Three floors, each of which a real lot clears by a wide margin:
 *   - enough of the frame, block by block, has the family's colours and a heap's texture;
 *   - the frame as a whole has the edge density of many objects, not of one smooth surface;
 *   - a frame dominated by skin tones must also be as busy as a heap (a potato is skin-coloured,
 *     a face is smooth).
 */
import type { VisionFamily } from '../crops/types.js';
import type { FrameMeasures } from './quality.js';
import { COLOUR_SIGNATURES } from './signatures.js';

export type OutOfDistributionReason = 'too-little-crop' | 'smooth-surface' | 'skin';

export interface DistributionVerdict {
  inDistribution: boolean;
  reason: OutOfDistributionReason | null;
}

export const DISTRIBUTION_LIMITS = {
  coverageFloor: 0.45,
  skinShare: 0.35,
} as const;

export function checkDistribution(m: FrameMeasures, family: VisionFamily | null): DistributionVerdict {
  // A crop without a vision family is photographed, never graded: there is nothing to protect.
  if (family === null) return { inDistribution: true, reason: null };
  const signature = COLOUR_SIGNATURES[family];
  if ((m.coverage ?? 0) < DISTRIBUTION_LIMITS.coverageFloor) return { inDistribution: false, reason: 'too-little-crop' };
  if (m.edgeDensity < signature.textureFloor) return { inDistribution: false, reason: 'smooth-surface' };
  if (m.skin > DISTRIBUTION_LIMITS.skinShare && m.edgeDensity < 2 * signature.textureFloor) return { inDistribution: false, reason: 'skin' };
  return { inDistribution: true, reason: null };
}
