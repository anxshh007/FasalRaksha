/**
 * Where a farmer is, for distance questions only: which warehouse is within reach (GR-7) and
 * what freight to the mandi costs. The registry gives a village name, not coordinates, and the
 * district registry holds coordinates for district headquarters and market towns, not villages.
 * So the farmer is placed at the market town their village names, or at the district
 * headquarters, and the answer says which. A screen can then say "distances from Niphad" rather
 * than implying a precision nobody has (P1-04: never an arbitrary constant location).
 */
import type { GeoPoint } from '../core/types.js';
import type { DistrictEntry } from './types.js';

export interface FarmerLocation {
  point: GeoPoint;
  /** `market-town`: the village record names a market town; `district-centroid`: it does not. */
  source: 'market-town' | 'district-centroid';
  /** The market town used, or null for the district centroid. */
  marketId: string | null;
}

const fold = (text: string): string => text.normalize('NFC').toLowerCase();

export function locateFarmer(village: string | null, district: DistrictEntry): FarmerLocation {
  if (village !== null && village.trim() !== '') {
    const text = fold(village);
    let best: { id: string; point: GeoPoint; length: number } | null = null;
    for (const market of district.markets) {
      for (const name of [market.names.en, market.names.mr, ...market.synonyms]) {
        const needle = fold(name);
        if (needle.length >= 3 && text.includes(needle) && (best === null || needle.length > best.length)) {
          best = { id: market.id, point: market.location, length: needle.length };
        }
      }
    }
    if (best !== null) return { point: best.point, source: 'market-town', marketId: best.id };
  }
  return { point: district.centroid, source: 'district-centroid', marketId: null };
}
