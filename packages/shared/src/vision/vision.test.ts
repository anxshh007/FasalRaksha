/**
 * FR-11 · CAM · §7.1–7.4 — the vision rules the phone runs: colour signatures, the quality gate's
 * message order, the 400 ms hysteresis and 500 ms shutter, the out-of-distribution floor, and
 * multi-frame aggregation into a grade and a band. The same rules are exercised against the
 * rendered camera scenes in apps/api/test/vision.scenes.test.ts (decoded there with sharp) and
 * through a fake camera in the Gate C walkthrough.
 */
import { describe, expect, it } from 'vitest';

import {
  aggregateViews,
  checkDistribution,
  inBox,
  isAcceptedImage,
  INITIAL_GUIDANCE,
  measureFrame,
  problemFor,
  shutterReady,
  sniffImage,
  stepGuidance,
  toHsv,
  type CapturedView,
  type FrameMeasures,
  type GuidanceProblem,
  type GuidanceState,
} from '../index.js';

const measures = (over: Partial<FrameMeasures> = {}): FrameMeasures => ({
  brightness: 0.45,
  clipped: 0,
  sharpness: 0.01,
  edgeDensity: 0.3,
  skin: 0.2,
  coverage: 0.95,
  centreCoverage: 1,
  motion: 0.01,
  ...over,
});

function solid(width: number, height: number, rgb: [number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...rgb, 255], i * 4);
  return { width, height, data };
}

describe('colour signatures', () => {
  it('converts RGB to HSV', () => {
    expect(toHsv(255, 0, 0)).toEqual([0, 1, 1]);
    expect(toHsv(0, 255, 0)[0]).toBe(120);
    expect(toHsv(128, 128, 128)[1]).toBe(0);
  });

  it('a hue range written from a negative start wraps through red', () => {
    const box = { hue: [-40, 20], sat: [0, 1], val: [0, 1] } as const;
    expect(inBox(340, 0.5, 0.5, box)).toBe(true);
    expect(inBox(10, 0.5, 0.5, box)).toBe(true);
    expect(inBox(200, 0.5, 0.5, box)).toBe(false);
  });
});

describe('§7.1 · the quality gate names one problem, in the farmer\'s order', () => {
  it('green when everything passes', () => {
    expect(problemFor(measures())).toBeNull();
  });

  it.each<[Partial<FrameMeasures>, GuidanceProblem]>([
    [{ brightness: 0.05 }, 'too-dark'],
    [{ brightness: 0.95 }, 'too-bright'],
    [{ clipped: 0.5 }, 'too-bright'],
    [{ coverage: 0.2, centreCoverage: 0.7 }, 'move-closer'],
    [{ motion: 0.2 }, 'hold-steady'],
    [{ sharpness: 0.0001 }, 'hold-steady'],
    [{ coverage: 0.2, centreCoverage: 0.1 }, 'show-more'],
    [{ coverage: 0.02, centreCoverage: 0 }, 'no-crop'],
  ])('%o → %s', (over, problem) => {
    expect(problemFor(measures(over))).toBe(problem);
  });

  it('darkness outranks everything; distance outranks shake; nothing crop-dependent fires on a blank wall', () => {
    expect(problemFor(measures({ brightness: 0.05, motion: 0.3, coverage: 0 }))).toBe('too-dark');
    expect(problemFor(measures({ coverage: 0.2, centreCoverage: 0.8, motion: 0.3 }))).toBe('move-closer');
    // A smooth wall is "no crop", never "hold steady", though it has no sharp detail.
    expect(problemFor(measures({ coverage: 0, centreCoverage: 0, sharpness: 0.00001, edgeDensity: 0 }))).toBe('no-crop');
  });

  it('a crop with no colour signature is still gated for light, shake and focus', () => {
    expect(problemFor(measures({ coverage: null, centreCoverage: null }))).toBeNull();
    expect(problemFor(measures({ coverage: null, centreCoverage: null, sharpness: 0.00001 }))).toBe('hold-steady');
  });

  it('measures a real frame: a flat beige wall is dark-free, texture-free and crop-free', () => {
    const { measures: m, thumb } = measureFrame(solid(64, 48, [205, 185, 150]), 'tuber_bulb');
    expect(m.brightness).toBeGreaterThan(0.6);
    expect(m.edgeDensity).toBe(0);
    expect(m.coverage).toBe(0); // the colour matches a potato, but a wall has no heap texture
    expect(thumb).toHaveLength(32 * 32);
    expect(problemFor(m)).toBe('no-crop');
  });

  it('motion is the change from the previous frame', () => {
    const first = measureFrame(solid(64, 48, [100, 100, 100]), null);
    expect(first.measures.motion).toBeNull();
    const same = measureFrame(solid(64, 48, [100, 100, 100]), null, first.thumb);
    expect(same.measures.motion).toBe(0);
    const moved = measureFrame(solid(64, 48, [200, 200, 200]), null, first.thumb);
    expect(moved.measures.motion).toBeGreaterThan(0.3);
  });

  it('refuses an empty or truncated frame rather than reading past it', () => {
    expect(() => measureFrame({ width: 0, height: 0, data: new Uint8ClampedArray() }, null)).toThrow(RangeError);
    expect(() => measureFrame({ width: 10, height: 10, data: new Uint8ClampedArray(12) }, null)).toThrow(RangeError);
  });
});

describe('§7.1 · 400 ms hysteresis and a 500 ms all-green shutter', () => {
  const run = (steps: [number, GuidanceProblem | null][]): GuidanceState => steps.reduce((s, [t, p]) => stepGuidance(s, p, t), INITIAL_GUIDANCE);

  it('the first verdict shows at once', () => {
    expect(run([[0, 'too-dark']]).shown).toBe('too-dark');
  });

  it('a verdict that flickers for less than 400 ms never reaches the screen', () => {
    const s = run([
      [0, 'too-dark'],
      [90, 'hold-steady'],
      [180, 'hold-steady'],
      [270, 'too-dark'],
      [360, 'hold-steady'],
      [450, 'too-dark'],
    ]);
    expect(s.shown).toBe('too-dark');
  });

  it('a verdict that holds for 400 ms replaces the message', () => {
    const steps: [number, GuidanceProblem | null][] = [[0, 'too-dark']];
    for (let t = 90; t <= 540; t += 90) steps.push([t, 'hold-steady']);
    expect(run(steps.filter(([t]) => t < 450)).shown).toBe('too-dark'); // 360 ms in
    expect(run(steps).shown).toBe('hold-steady'); // 450 ms in
  });

  it('the shutter wakes only after 500 ms of unbroken green, and one bad frame resets it', () => {
    let s = run([[0, 'hold-steady']]);
    for (let t = 90; t <= 540; t += 90) s = stepGuidance(s, null, t);
    expect(shutterReady(s, 540)).toBe(false); // green since 90: 450 ms
    s = stepGuidance(s, null, 630);
    expect(shutterReady(s, 630)).toBe(true); // 540 ms
    s = stepGuidance(s, 'hold-steady', 720);
    expect(shutterReady(s, 720)).toBe(false);
    s = stepGuidance(s, null, 810);
    expect(shutterReady(s, 1200)).toBe(false); // green again only since 810
    expect(shutterReady(s, 1310)).toBe(true);
  });
});

describe('§7.2 · out-of-distribution rejection is its own path with a hard floor', () => {
  it('passes a lot', () => {
    expect(checkDistribution(measures(), 'tuber_bulb')).toEqual({ inDistribution: true, reason: null });
  });

  it('rejects too little crop, a smooth surface, and a skin-dominated smooth frame', () => {
    expect(checkDistribution(measures({ coverage: 0.3 }), 'tuber_bulb').reason).toBe('too-little-crop');
    expect(checkDistribution(measures({ edgeDensity: 0.02 }), 'tuber_bulb').reason).toBe('smooth-surface');
    expect(checkDistribution(measures({ skin: 0.8, edgeDensity: 0.08 }), 'tuber_bulb').reason).toBe('skin');
    // A potato lot is skin-coloured, and busy: it passes.
    expect(checkDistribution(measures({ skin: 0.8, edgeDensity: 0.3 }), 'tuber_bulb').inDistribution).toBe(true);
  });

  it('a crop with no vision family has nothing to grade, so nothing to reject', () => {
    expect(checkDistribution(measures({ coverage: null }), null).inDistribution).toBe(true);
  });
});

describe('§7.4 · five views, one proposal, never a percentage', () => {
  const view = (probs: number[] | null, over: Partial<CapturedView> = {}): CapturedView => ({
    problem: null,
    distribution: { inDistribution: true, reason: null },
    probs,
    sharpness: 0.01,
    ...over,
  });

  it('agreeing, confident views give a grade with a high band and the number of views it rests on', () => {
    const p = aggregateViews([view([0.1, 0.85, 0.05]), view([0.05, 0.9, 0.05]), view([0.1, 0.8, 0.1]), view([0.2, 0.75, 0.05])], true);
    expect(p).toEqual({ kind: 'proposed', grade: 'B', band: 'high', views: 4, best: 0 });
  });

  it('views that disagree lower the band', () => {
    const p = aggregateViews([view([0.7, 0.3, 0]), view([0.3, 0.7, 0]), view([0.6, 0.4, 0]), view([0.35, 0.65, 0]), view([0.65, 0.35, 0])], true);
    expect(p.kind === 'proposed' && p.band).toBe('low');
  });

  it('one view can never be "high" (CAM-08 drops to a single frame)', () => {
    const p = aggregateViews([view([0.97, 0.02, 0.01])], true);
    expect(p).toMatchObject({ kind: 'proposed', grade: 'A', band: 'moderate', views: 1 });
  });

  it('an exact tie goes to the lower grade', () => {
    const p = aggregateViews([view([0.5, 0.5, 0]), view([0.5, 0.5, 0])], true);
    expect(p).toMatchObject({ grade: 'B' });
  });

  it('views that fail the gate are not scored, and the proposal counts only the rest', () => {
    const p = aggregateViews([view([0.9, 0.1, 0], { problem: 'hold-steady' }), view([0.1, 0.1, 0.8]), view([0.1, 0.2, 0.7])], true);
    expect(p).toMatchObject({ kind: 'proposed', grade: 'C', views: 2 });
  });

  it('CAM-11 · out of distribution is its own outcome: no grade and no band', () => {
    const ood = { inDistribution: false, reason: 'smooth-surface' } as const;
    const p = aggregateViews([view([0.9, 0.1, 0], { distribution: ood }), view([0.9, 0.1, 0], { distribution: ood }), view([0.9, 0.1, 0])], true);
    expect(p).toEqual({ kind: 'out-of-distribution', best: 0 });
    expect(p).not.toHaveProperty('band');
  });

  it('CAM-10 · every view failed: no grade, the commonest problem, and the least bad frame kept', () => {
    const p = aggregateViews(
      [view(null, { problem: 'too-dark', sharpness: 0.05 }), view(null, { problem: 'hold-steady', sharpness: 0.002 }), view(null, { problem: 'too-dark' }), view(null, { problem: 'hold-steady', sharpness: 0.004 })],
      true,
    );
    expect(p).toEqual({ kind: 'no-usable-view', problem: 'too-dark', best: 3 });
  });

  it('CAM-11 · views that all fail for want of crop in the frame are the out-of-distribution path, not CAM-10', () => {
    expect(aggregateViews([view(null, { problem: 'no-crop' }), view(null, { problem: 'no-crop' })], true)).toEqual({ kind: 'out-of-distribution', best: 0 });
    expect(aggregateViews([view(null, { problem: 'move-closer' })], true).kind).toBe('out-of-distribution');
    // Mostly dark, some empty: the photograph was the problem, so say that.
    expect(aggregateViews([view(null, { problem: 'too-dark' }), view(null, { problem: 'too-dark' }), view(null, { problem: 'no-crop' })], true).kind).toBe('no-usable-view');
  });

  it('CAM-09 · no model on the phone: a usable photograph, no grade, nothing invented', () => {
    expect(aggregateViews([view(null, { sharpness: 0.002 }), view(null, { sharpness: 0.009 })], false)).toEqual({ kind: 'ungraded', views: 2, best: 1 });
  });
});

describe('§8.6 · CAM-07 · an image is what its bytes say, not what its name says', () => {
  const bytes = (...parts: (number[] | string)[]) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));

  it.each([
    [bytes([0xff, 0xd8, 0xff, 0xe0]), 'jpeg'],
    [bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'png'],
    [bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '), 'webp'],
    [bytes([0, 0, 0, 24], 'ftypheic', [0, 0, 0, 0]), 'heic'],
    [bytes([0, 0, 0, 24], 'ftypmif1', [0, 0, 0, 0]), 'heic'],
    [bytes([0, 0, 0, 24], 'ftypavif', [0, 0, 0, 0]), 'unknown'],
    [bytes('GIF89a'), 'gif'],
    [bytes('<svg xmlns="http://www.w3.org/2000/svg">'), 'svg'],
    [bytes([0xef, 0xbb, 0xbf], '  <?xml version="1.0"?>'), 'svg'],
    [bytes('MZ', [0x90, 0]), 'unknown'],
    [bytes(), 'unknown'],
  ] as const)('%o → %s', (head, kind) => {
    expect(sniffImage(head)).toBe(kind);
  });

  it('accepts JPEG, PNG, WebP and HEIC; never SVG, GIF or anything unknown', () => {
    expect(['jpeg', 'png', 'webp', 'heic'].every((k) => isAcceptedImage(k as never))).toBe(true);
    expect(['svg', 'gif', 'unknown'].some((k) => isAcceptedImage(k as never))).toBe(false);
  });
});
