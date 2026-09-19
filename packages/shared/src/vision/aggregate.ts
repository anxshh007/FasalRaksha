/**
 * Several views, one proposal (PROMPT §7.4). One deliberate press captures five frames over about
 * 1.2 seconds; each is gated, checked for distribution, and, if a model is present, scored. The
 * result is a category and a confidence *band*, never a percentage:
 *
 *     PROPOSED GRADE  Grade B · Confidence Moderate · Based on 4 stable views
 *
 * Outcomes are distinct, because each needs different words on the screen:
 *   proposed              a grade, a band, and how many views it rests on
 *   ungraded              a usable photograph, and no grading on this phone or for this crop
 *   out-of-distribution   not the crop (§7.2): distinct copy, no band, nothing attached (CAM-11).
 *                         Reached two ways: clean views that fail the distribution floor, or views
 *                         that all fail for want of crop in the frame (too far, too little, none).
 *                         A wall, a face or a shoe chosen from the gallery arrives here.
 *   no-usable-view        every view failed on image quality (too dark, too bright, blurred): no
 *                         grade; keep the best frame and say what was wrong (CAM-10)
 *
 * The model proposes; this function never writes a grade anywhere. The farmer confirms (§7.5).
 */
import type { Grade } from '../matching/types.js';
import type { DistributionVerdict } from './distribution.js';
import { GUIDANCE_ORDER, type GuidanceProblem } from './quality.js';

export const GRADES_IN_MODEL_ORDER: readonly Grade[] = ['A', 'B', 'C'];

export type ConfidenceBand = 'high' | 'moderate' | 'low';

export interface CapturedView {
  problem: GuidanceProblem | null;
  distribution: DistributionVerdict;
  /** The model's probabilities for A, B, C; null when no model ran on this view. */
  probs: readonly number[] | null;
  sharpness: number;
}

export type GradeProposal =
  | { kind: 'proposed'; grade: Grade; band: ConfidenceBand; views: number; best: number }
  | { kind: 'ungraded'; views: number; best: number }
  | { kind: 'out-of-distribution'; best: number }
  | { kind: 'no-usable-view'; problem: GuidanceProblem; best: number };

/** Gate failures that mean "not enough crop in view" rather than "a poor photograph". */
const COVERAGE_PROBLEMS: readonly GuidanceProblem[] = ['move-closer', 'show-more', 'no-crop'];

export const BAND_LIMITS = {
  highTop: 0.75,
  highAgreement: 0.8,
  highViews: 3,
  moderateTop: 0.55,
  moderateAgreement: 0.6,
} as const;

function sharpest(views: readonly CapturedView[], indices: number[]): number {
  return indices.reduce((best, i) => (views[i]!.sharpness > views[best]!.sharpness ? i : best), indices[0]!);
}

export function aggregateViews(views: readonly CapturedView[], gradingAvailable: boolean): GradeProposal {
  if (views.length === 0) throw new RangeError('no views to aggregate');
  const all = views.map((_, i) => i);
  const passing = all.filter((i) => views[i]!.problem === null);

  if (passing.length === 0) {
    // CAM-10: say the most frequent problem; keep the frame with the least severe one.
    const counts = new Map<GuidanceProblem, number>();
    for (const v of views) counts.set(v.problem!, (counts.get(v.problem!) ?? 0) + 1);
    const problem = [...GUIDANCE_ORDER].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || GUIDANCE_ORDER.indexOf(a) - GUIDANCE_ORDER.indexOf(b))[0]!;
    const severity = (i: number) => GUIDANCE_ORDER.indexOf(views[i]!.problem!);
    const least = Math.max(...all.map(severity));
    const best = sharpest(views, all.filter((i) => severity(i) === least));
    if (COVERAGE_PROBLEMS.includes(problem)) return { kind: 'out-of-distribution', best };
    return { kind: 'no-usable-view', problem, best };
  }

  const inside = passing.filter((i) => views[i]!.distribution.inDistribution);
  const outside = passing.filter((i) => !views[i]!.distribution.inDistribution);
  // The hard floor: if as many clean views say "not the crop" as say "the crop", nothing is graded.
  if (outside.length > 0 && outside.length >= inside.length) return { kind: 'out-of-distribution', best: sharpest(views, outside) };

  const best = sharpest(views, inside);
  const scored = inside.filter((i) => views[i]!.probs !== null);
  if (!gradingAvailable || scored.length === 0) return { kind: 'ungraded', views: inside.length, best };

  const mean = [0, 0, 0];
  for (const i of scored) for (let k = 0; k < 3; k++) mean[k]! += (views[i]!.probs![k] ?? 0) / scored.length;
  // Ties go to the lower grade: when unsure, never flatter the lot.
  const top = [0, 1, 2].reduce((a, k) => (mean[k]! >= mean[a]! ? k : a), 0);
  const argmax = (p: readonly number[]) => [0, 1, 2].reduce((a, k) => ((p[k] ?? 0) >= (p[a] ?? 0) ? k : a), 0);
  const agreement = scored.filter((i) => argmax(views[i]!.probs!) === top).length / scored.length;
  const L = BAND_LIMITS;
  const band: ConfidenceBand =
    scored.length >= L.highViews && mean[top]! >= L.highTop && agreement >= L.highAgreement ? 'high' : mean[top]! >= L.moderateTop && agreement >= L.moderateAgreement ? 'moderate' : 'low';
  const grade = GRADES_IN_MODEL_ORDER[top]!;
  return { kind: 'proposed', grade, band, views: scored.length, best };
}
