/**
 * One deliberate press, several views, one outcome (PROMPT §7.4), with the degradation ladder of
 * CAM-08: five frames over about 1.2 s; if the phone cannot allocate them, one frame; if it cannot
 * manage even that, a plain still with no grading at all. The outcome always says which of these
 * happened, so the screen can be honest about it.
 *
 * Pure orchestration over injected capabilities, so every rung of the ladder is testable without
 * a camera.
 */
import { aggregateViews, type CapturedView, type GradeProposal } from '@fasal/shared';

import { WorkerFault, type Encoded } from './protocol';

export const BURST = { frames: 5, spacingMs: 300 } as const;

export interface BurstDeps {
  /** A frame from the live stream, at most 1280 px on its long edge. */
  grab(): Promise<ImageBitmap>;
  view(bitmap: ImageBitmap): Promise<{ id: number; view: CapturedView; modelVersion: string | null }>;
  encode(id: number): Promise<Encoded>;
  /** The last rung: a small still drawn straight from the video, never analysed. */
  still(): Promise<Encoded | null>;
  wait(ms: number): Promise<void>;
  gradingAvailable(): boolean;
}

export interface CaptureOutcome {
  proposal: GradeProposal;
  /** The photograph to keep, or null (out of distribution: nothing to attach). */
  photo: Encoded | null;
  degraded: null | 'single-frame' | 'photo-only';
  modelVersion: string | null;
}

class SingleFrame extends Error {}

function isMemory(error: unknown): boolean {
  return (error instanceof WorkerFault && error.kind === 'memory') || error instanceof RangeError || (error instanceof DOMException && /memory|allocat/i.test(error.message));
}

async function burst(deps: BurstDeps, frames: number): Promise<{ proposal: GradeProposal; ids: number[]; modelVersion: string | null }> {
  const ids: number[] = [];
  const views: CapturedView[] = [];
  let modelVersion: string | null = null;
  for (let i = 0; i < frames; i++) {
    if (i > 0) await deps.wait(BURST.spacingMs);
    const result = await deps.view(await deps.grab());
    ids.push(result.id);
    views.push(result.view);
    modelVersion ??= result.modelVersion;
  }
  return { proposal: aggregateViews(views, deps.gradingAvailable()), ids, modelVersion };
}

/** `frames`: five from the camera; one for a chosen file, which then has no single-frame rung. */
export async function capture(deps: BurstDeps, frames: number = BURST.frames): Promise<CaptureOutcome> {
  let degraded: CaptureOutcome['degraded'] = null;
  let result: Awaited<ReturnType<typeof burst>>;
  try {
    if (frames === 1) throw new SingleFrame();
    result = await burst(deps, frames);
  } catch (error) {
    if (!(error instanceof SingleFrame) && !isMemory(error)) throw error;
    if (!(error instanceof SingleFrame)) degraded = 'single-frame';
    try {
      result = await burst(deps, 1);
    } catch (again) {
      if (!isMemory(again)) throw again;
      const photo = await deps.still();
      return { proposal: { kind: 'ungraded', views: photo === null ? 0 : 1, best: 0 }, photo, degraded: 'photo-only', modelVersion: null };
    }
  }
  const { proposal, ids, modelVersion } = result;
  // Out of distribution: nothing is attached. Everything else keeps the best frame (CAM-10 too).
  const photo = proposal.kind === 'out-of-distribution' ? null : await deps.encode(ids[proposal.best] ?? ids[0] ?? 0);
  return { proposal, photo, degraded, modelVersion: proposal.kind === 'proposed' ? modelVersion : null };
}
