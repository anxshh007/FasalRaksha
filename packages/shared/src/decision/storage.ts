/**
 * Which warehouse can this farmer actually use? GR-7 asks for "a real, named storage mechanism
 * within reach of this farmer", so reachability is decided on the farmer's own location, crop
 * and lot size — never assumed.
 */
import type { StorageFacility } from '../bundle/types.js';
import { roadKm } from '../core/geo.js';
import type { CropId, GeoPoint } from '../core/types.js';
import { MAX_STORAGE_DISTANCE_KM } from '../constants/policy.js';

export interface StorageChoice {
  facility: StorageFacility;
  roadKm: number;
}

/** Whether a facility can take this lot, and if not, why not. */
export function storageFit(
  facility: StorageFacility,
  crop: CropId,
  quantityQtl: number,
  distance: number,
): 'fits' | 'crop-not-accepted' | 'no-capacity' | 'too-far' {
  if (!facility.crops.includes(crop) || facility.spoilageFractionPerMonth[crop] === undefined) return 'crop-not-accepted';
  if (facility.capacityAvailableQtl < quantityQtl) return 'no-capacity';
  if (distance > MAX_STORAGE_DISTANCE_KM.value) return 'too-far';
  return 'fits';
}

/**
 * The cheapest reachable facility for this lot, by total monthly holding cost (rent + expected
 * spoilage at today's price), nearest first on ties. Null when there is none — and then waiting
 * is not practical (GR-7).
 */
export function findReachableStorage(
  facilities: readonly StorageFacility[],
  farmer: GeoPoint,
  crop: CropId,
  quantityQtl: number,
  pricePerQtl: number,
): StorageChoice | null {
  const candidates = facilities
    .map((facility) => ({ facility, roadKm: roadKm(farmer, facility.location) }))
    .filter((c) => storageFit(c.facility, crop, quantityQtl, c.roadKm) === 'fits')
    .map((c) => ({
      ...c,
      monthlyCost: c.facility.ratePerQtlMonth + (c.facility.spoilageFractionPerMonth[crop] ?? 0) * pricePerQtl,
    }))
    .sort((a, b) => a.monthlyCost - b.monthlyCost || a.roadKm - b.roadKm || a.facility.id.localeCompare(b.facility.id));
  const best = candidates[0];
  return best === undefined ? null : { facility: best.facility, roadKm: best.roadKm };
}
