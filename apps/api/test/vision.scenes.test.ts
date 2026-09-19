/**
 * FR-11 · CAM · §7.1 · §7.2 — the shared vision rules against the rendered camera scenes. The rules live
 * in @fasal/shared and run on the phone; they are exercised here because this workspace has a
 * JPEG decoder (sharp) and the shared package, by design, has none. Each scene is read at the
 * phone's analysis size (256 px long edge) and must produce the message it exists for, and every
 * non-crop scene must be rejected before grading for every family it could be confused with.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { checkDistribution, measureFrame, problemFor, QUALITY_LIMITS, type GuidanceProblem, type RgbaFrame, type VisionFamily } from '@fasal/shared';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const DIR = resolve(import.meta.dirname, '../../../data/fixtures/camera');

async function frame(name: string, shift = 0): Promise<RgbaFrame> {
  let image = sharp(readFileSync(join(DIR, `${name}.jpg`))).rotate();
  if (shift > 0) image = image.extract({ left: 40 + shift, top: 40 + Math.round(shift / 2), width: 560, height: 400 });
  const { data, info } = await image.resize(QUALITY_LIMITS.analysisSide, QUALITY_LIMITS.analysisSide, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

const lots: [string, VisionFamily][] = [
  ['onion-lot', 'tuber_bulb'],
  ['onion-lot-poor', 'tuber_bulb'],
  ['onion-lot-exif-gps', 'tuber_bulb'],
  ['tomato-lot', 'solanaceous_fruit'],
  ['wheat-lot', 'grain_lot'],
  ['cotton-lot', 'fibre_lot'],
];

describe('§7.1 · each viewfinder message fires on the scene it exists for', () => {
  it.each<[string, GuidanceProblem | null]>([
    ['onion-lot', null],
    ['onion-dark', 'too-dark'],
    ['onion-bright', 'too-bright'],
    ['onion-far', 'move-closer'],
    ['onion-blurred', 'hold-steady'],
    ['onion-edge', 'show-more'],
    ['wall', 'no-crop'],
    ['face', 'no-crop'],
    ['bucket', 'no-crop'],
  ])('%s → %s', async (scene, expected) => {
    expect(problemFor(measureFrame(await frame(scene), 'tuber_bulb').measures)).toBe(expected);
  });

  it('a lot that fills the frame is green for its own family', async () => {
    for (const [scene, family] of lots) expect(problemFor(measureFrame(await frame(scene), family).measures), scene).toBeNull();
  });

  it('a hand that moves between frames is told to hold steady; a still hand is not', async () => {
    const first = measureFrame(await frame('onion-lot', 1), 'tuber_bulb');
    const still = measureFrame(await frame('onion-lot', 2), 'tuber_bulb', first.thumb);
    expect(problemFor(still.measures)).toBeNull();
    const moved = measureFrame(await frame('onion-lot', 40), 'tuber_bulb', first.thumb);
    expect(problemFor(moved.measures)).toBe('hold-steady');
  });
});

describe('§7.2 · out-of-distribution rejection before grading', () => {
  it('passes every lot for its own family', async () => {
    for (const [scene, family] of lots) expect(checkDistribution(measureFrame(await frame(scene), family).measures, family), scene).toEqual({ inDistribution: true, reason: null });
  });

  it.each(['wall', 'ceiling', 'face', 'shoe', 'bucket', 'onion-far', 'onion-edge'])('rejects %s for every family', async (scene) => {
    const f = await frame(scene);
    for (const family of ['tuber_bulb', 'solanaceous_fruit', 'tropical_fruit', 'grain_lot', 'legume_lot', 'oilseed_lot', 'fibre_lot'] as VisionFamily[]) {
      expect(checkDistribution(measureFrame(f, family).measures, family).inDistribution, `${scene} as ${family}`).toBe(false);
    }
  });
});
