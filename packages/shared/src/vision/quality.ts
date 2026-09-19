/**
 * The quality gate (PROMPT §7.1): cheap checks that run on every viewfinder frame, before
 * anything is scored. A frame that fails any of them is never graded.
 *
 * Input is a frame already downscaled to at most 256 px on its long edge (the worker does that on
 * an OffscreenCanvas). Output is at most one problem, in the order the farmer should fix them:
 *
 *   TOO DARK · (TOO BRIGHT) · MOVE CLOSER · HOLD STEADY · SHOW MORE OF THE CROP · NO CROP DETECTED
 *
 * TOO BRIGHT is not in §7.1's list; a washed-out frame is outside the acceptable brightness range
 * the section requires, and calling it "too dark" would be false.
 *
 * Subject coverage is measured against the crop family's colour signature, block by block: a
 * block counts as crop when most of its pixels have the family's colours *and* it has the texture
 * of a heap of produce rather than a painted surface. (§7.1 describes coverage against the border
 * colour; a lot that correctly fills the frame has no border to compare against, so the
 * signature is used instead. ARCHITECTURE, P12 decisions.)
 *
 * No percentage leaves this module for the screen: the viewfinder shows a message, never
 * "Image Quality 82%".
 */
import type { VisionFamily } from '../crops/types.js';
import { COLOUR_SIGNATURES, matchesSignature, type ColourSignature } from './signatures.js';

/** RGBA bytes, row-major, as `ImageData` holds them. */
export interface RgbaFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export type GuidanceProblem = 'too-dark' | 'too-bright' | 'move-closer' | 'hold-steady' | 'show-more' | 'no-crop';

/** One message at a time, in this order. */
export const GUIDANCE_ORDER: readonly GuidanceProblem[] = ['too-dark', 'too-bright', 'move-closer', 'hold-steady', 'show-more', 'no-crop'];

export const QUALITY_LIMITS = {
  /** Frames are analysed at this long edge. */
  analysisSide: 256,
  /** Mean luminance (0–1) below which the lot cannot be seen. */
  darkBelow: 0.14,
  /** Mean luminance above which, or share of blown-out pixels above which, detail is lost. */
  brightAbove: 0.86,
  clippedAbove: 0.3,
  /** Laplacian variance of luminance below which the frame is soft (shake or focus). */
  sharpnessFloor: 0.0012,
  /** Mean change of a 32×32 luminance thumbnail between frames above which the phone is moving. */
  motionAbove: 0.045,
  /** Share of blocks that are crop below which nothing is in view. */
  noCropBelow: 0.1,
  /** Share of blocks that must be crop for the frame to be "the lot". */
  coverageFloor: 0.5,
  /** A small patch of crop that sits in the centre means "too far away", not "aim elsewhere". */
  centredAt: 0.5,
  /** A block is crop when this share of its pixels has the family's colours… */
  blockColourShare: 0.5,
  /** …and its luminance varies at least this much (a heap, not a painted wall). */
  blockTexture: 0.03,
} as const;

const GRID = 8;
const THUMB = 32;

export interface FrameMeasures {
  brightness: number;
  clipped: number;
  sharpness: number;
  /** Share of pixels on a strong edge. */
  edgeDensity: number;
  /** Share of pixels in the usual skin-tone range (YCbCr). */
  skin: number;
  /** Null when the family has no colour signature (photo capture only). */
  coverage: number | null;
  centreCoverage: number | null;
  /** Null for the first frame. */
  motion: number | null;
}

export interface FrameAssessment {
  measures: FrameMeasures;
  problem: GuidanceProblem | null;
  /** Keep and pass back with the next frame, for the stability check. */
  thumb: Float32Array;
}

export function signatureFor(family: VisionFamily | null): ColourSignature | null {
  return family === null ? null : COLOUR_SIGNATURES[family];
}

/** Everything the gate and the distribution check need, in one pass over the pixels. */
export function measureFrame(frame: RgbaFrame, family: VisionFamily | null, previousThumb: Float32Array | null = null): { measures: FrameMeasures; thumb: Float32Array } {
  const { width: w, height: h, data } = frame;
  const n = w * h;
  if (n === 0 || data.length < n * 4) throw new RangeError('empty or truncated frame');
  const signature = signatureFor(family);
  const luma = new Float32Array(n);
  const blockMatch = new Uint32Array(GRID * GRID);
  const blockCount = new Uint32Array(GRID * GRID);
  const blockSum = new Float64Array(GRID * GRID);
  const blockSq = new Float64Array(GRID * GRID);
  let sum = 0;
  let clipped = 0;
  let skin = 0;

  for (let y = 0; y < h; y++) {
    const by = Math.min(GRID - 1, Math.floor((y * GRID) / h));
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const r = data[i * 4] ?? 0;
      const g = data[i * 4 + 1] ?? 0;
      const b = data[i * 4 + 2] ?? 0;
      const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      luma[i] = l;
      sum += l;
      if (l >= 0.97) clipped++;
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      if (cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173) skin++;
      const block = by * GRID + Math.min(GRID - 1, Math.floor((x * GRID) / w));
      blockCount[block]!++;
      blockSum[block]! += l;
      blockSq[block]! += l * l;
      if (signature !== null && matchesSignature(r, g, b, signature)) blockMatch[block]!++;
    }
  }

  // Laplacian variance and edge density over the interior.
  let lapSum = 0;
  let lapSq = 0;
  let edges = 0;
  let interior = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const c = luma[i]!;
      const left = luma[i - 1]!;
      const right = luma[i + 1]!;
      const up = luma[i - w]!;
      const down = luma[i + w]!;
      const lap = left + right + up + down - 4 * c;
      lapSum += lap;
      lapSq += lap * lap;
      if (Math.abs(right - left) + Math.abs(down - up) > 0.1) edges++;
      interior++;
    }
  }
  const lapMean = interior === 0 ? 0 : lapSum / interior;
  const sharpness = interior === 0 ? 0 : lapSq / interior - lapMean * lapMean;

  let coverage: number | null = null;
  let centreCoverage: number | null = null;
  if (signature !== null) {
    let crop = 0;
    let centre = 0;
    for (let block = 0; block < GRID * GRID; block++) {
      const count = blockCount[block]!;
      if (count === 0) continue;
      const mean = blockSum[block]! / count;
      const std = Math.sqrt(Math.max(0, blockSq[block]! / count - mean * mean));
      const isCrop = blockMatch[block]! / count >= QUALITY_LIMITS.blockColourShare && std >= QUALITY_LIMITS.blockTexture;
      if (!isCrop) continue;
      crop++;
      const bx = block % GRID;
      const by = Math.floor(block / GRID);
      if (bx >= GRID / 4 && bx < (3 * GRID) / 4 && by >= GRID / 4 && by < (3 * GRID) / 4) centre++;
    }
    coverage = crop / (GRID * GRID);
    centreCoverage = centre / ((GRID * GRID) / 4);
  }

  const thumb = thumbnail(luma, w, h);
  let motion: number | null = null;
  if (previousThumb !== null && previousThumb.length === thumb.length) {
    let diff = 0;
    for (let i = 0; i < thumb.length; i++) diff += Math.abs(thumb[i]! - previousThumb[i]!);
    motion = diff / thumb.length;
  }

  return {
    measures: { brightness: sum / n, clipped: clipped / n, sharpness, edgeDensity: interior === 0 ? 0 : edges / interior, skin: skin / n, coverage, centreCoverage, motion },
    thumb,
  };
}

function thumbnail(luma: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(THUMB * THUMB);
  const count = new Uint32Array(THUMB * THUMB);
  for (let y = 0; y < h; y++) {
    const ty = Math.min(THUMB - 1, Math.floor((y * THUMB) / h));
    for (let x = 0; x < w; x++) {
      const t = ty * THUMB + Math.min(THUMB - 1, Math.floor((x * THUMB) / w));
      out[t]! += luma[y * w + x]!;
      count[t]!++;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = count[i]! === 0 ? 0 : out[i]! / count[i]!;
  return out;
}

/** The single problem to show for these measures, or null when every gate is green. */
export function problemFor(m: FrameMeasures): GuidanceProblem | null {
  const L = QUALITY_LIMITS;
  if (m.brightness < L.darkBelow) return 'too-dark';
  if (m.brightness > L.brightAbove || m.clipped > L.clippedAbove) return 'too-bright';
  const someCrop = m.coverage === null || m.coverage >= L.noCropBelow;
  const partial = m.coverage !== null && m.coverage >= L.noCropBelow && m.coverage < L.coverageFloor;
  if (partial && (m.centreCoverage ?? 0) >= L.centredAt) return 'move-closer';
  if (m.motion !== null && m.motion > L.motionAbove) return 'hold-steady';
  if (someCrop && m.sharpness < L.sharpnessFloor) return 'hold-steady';
  if (partial) return 'show-more';
  if (!someCrop) return 'no-crop';
  return null;
}

export function assessFrame(frame: RgbaFrame, family: VisionFamily | null, previousThumb: Float32Array | null = null): FrameAssessment {
  const { measures, thumb } = measureFrame(frame, family, previousThumb);
  return { measures, problem: problemFor(measures), thumb };
}
