/**
 * What the viewfinder says, and when the shutter wakes (PROMPT §7.1).
 *
 * Frames arrive about eleven times a second, and their verdicts flicker. The farmer sees one
 * message, which changes only after a new verdict has held for 400 ms. The shutter is enabled only
 * after every gate has been green for 500 ms without a break. Time is an input, so the behaviour
 * is exactly reproducible in tests.
 */
import type { GuidanceProblem } from './quality.js';

export const GUIDANCE_TIMING = {
  /** ~11 fps: at most one frame analysed per this many ms. */
  frameIntervalMs: 90,
  hysteresisMs: 400,
  greenForMs: 500,
} as const;

export interface GuidanceState {
  /** The message on screen; null is "ready"; undefined before the first frame. */
  shown: GuidanceProblem | null | undefined;
  candidate: GuidanceProblem | null;
  candidateSince: number;
  /** Start of the current unbroken run of all-green frames. */
  greenSince: number | null;
}

export const INITIAL_GUIDANCE: GuidanceState = { shown: undefined, candidate: null, candidateSince: 0, greenSince: null };

export function stepGuidance(state: GuidanceState, problem: GuidanceProblem | null, now: number): GuidanceState {
  const greenSince = problem === null ? (state.greenSince ?? now) : null;
  if (state.shown === undefined) return { shown: problem, candidate: problem, candidateSince: now, greenSince };
  if (problem === state.shown) return { shown: problem, candidate: problem, candidateSince: now, greenSince };
  const candidateSince = problem === state.candidate ? state.candidateSince : now;
  const shown = now - candidateSince >= GUIDANCE_TIMING.hysteresisMs ? problem : state.shown;
  return { shown, candidate: problem, candidateSince, greenSince };
}

export function shutterReady(state: GuidanceState, now: number): boolean {
  return state.greenSince !== null && now - state.greenSince >= GUIDANCE_TIMING.greenForMs;
}
