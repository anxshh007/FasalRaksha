/**
 * Crop-family colour signatures (PROMPT §7.2): the colours a family's produce can plausibly be
 * under daylight, as hue/saturation/value boxes. They drive two things: the viewfinder's "is
 * there crop in view, and how much" (§7.1 subject coverage), and the out-of-distribution floor
 * that rejects a ceiling, a wall, a face or a shoe before any grade is proposed.
 *
 * Written from descriptions of the produce (Nashik red onion, tan potato, red-to-green tomato,
 * golden wheat, cream jowar, white cotton…), deliberately wider than the renderer's palettes so
 * that real light does not push a real lot out. They are priors, not measurements, and are
 * listed as such in CUTS until field photographs exist to fit them.
 */
import type { VisionFamily } from '../crops/types.js';

export interface HsvBox {
  /** Degrees. A range that crosses 0 is written with a negative start: [-30, 20] is 330°–20°. */
  hue: readonly [number, number];
  sat: readonly [number, number];
  val: readonly [number, number];
}

export interface ColourSignature {
  boxes: readonly HsvBox[];
  /**
   * Edge density a real lot of this family shows at 256 px (many object boundaries), below which
   * the frame is a smooth surface — a wall, a ceiling, skin — whatever its colour.
   */
  textureFloor: number;
}

export const COLOUR_SIGNATURES: Readonly<Record<VisionFamily, ColourSignature>> = {
  tuber_bulb: {
    boxes: [
      { hue: [-40, 20], sat: [0.2, 0.95], val: [0.22, 1] }, // red, pink and purple onion
      { hue: [15, 52], sat: [0.15, 0.85], val: [0.28, 1] }, // golden onion, potato
    ],
    textureFloor: 0.06,
  },
  solanaceous_fruit: {
    boxes: [
      { hue: [-25, 35], sat: [0.35, 1], val: [0.2, 1] }, // red to orange
      { hue: [50, 145], sat: [0.25, 1], val: [0.15, 1] }, // green fruit, green chilli
    ],
    textureFloor: 0.06,
  },
  tropical_fruit: {
    boxes: [{ hue: [25, 115], sat: [0.28, 1], val: [0.3, 1] }],
    textureFloor: 0.05,
  },
  grain_lot: {
    boxes: [{ hue: [15, 65], sat: [0.05, 0.95], val: [0.33, 1] }],
    textureFloor: 0.1,
  },
  legume_lot: {
    boxes: [{ hue: [8, 62], sat: [0.15, 0.95], val: [0.2, 1] }],
    textureFloor: 0.1,
  },
  oilseed_lot: {
    boxes: [{ hue: [22, 68], sat: [0.1, 0.65], val: [0.42, 1] }],
    textureFloor: 0.1,
  },
  fibre_lot: {
    boxes: [{ hue: [0, 360], sat: [0, 0.24], val: [0.58, 1] }],
    textureFloor: 0.05,
  },
};

/** RGB bytes to hue in degrees [0, 360), saturation and value in [0, 1]. */
export function toHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max / 255;
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  if (d === 0) return [0, s, v];
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return [h < 0 ? h + 360 : h, s, v];
}

export function inBox(h: number, s: number, v: number, box: HsvBox): boolean {
  if (s < box.sat[0] || s > box.sat[1] || v < box.val[0] || v > box.val[1]) return false;
  const [lo, hi] = box.hue;
  if (lo < 0) return h >= 360 + lo || h <= hi;
  return h >= lo && h <= hi;
}

export function matchesSignature(r: number, g: number, b: number, signature: ColourSignature): boolean {
  const [h, s, v] = toHsv(r, g, b);
  return signature.boxes.some((box) => inBox(h, s, v, box));
}
