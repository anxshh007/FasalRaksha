/** Identifiers and primitives shared by every module. */

/** A crop id from the crop dictionary (`crops.json`), e.g. `onion`. */
export type CropId = string;

/** A district id from the district registry (`districts.json`), e.g. `nashik`. */
export type DistrictId = string;

/** A calendar date, `YYYY-MM-DD`. Validated by `parseIsoDate`. */
export type ISODate = string;

/** Interface languages. Marathi leads (PROMPT §10); Bengali and Punjabi resources are retained. */
export const LOCALES = ['mr', 'hi', 'en', 'bn', 'pa'] as const;
export type Locale = (typeof LOCALES)[number];

export interface GeoPoint {
  lat: number;
  lon: number;
}

/** A result that says *why* it failed, so every caller can explain it (Constitution §16). */
export type Result<T, E extends string> = { ok: true; value: T } | { ok: false; reason: E };

export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export function fail<E extends string>(reason: E): { ok: false; reason: E } {
  return { ok: false, reason };
}
