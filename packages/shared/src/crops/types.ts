/**
 * The shapes of the two reference registries shipped in the data bundle: the crop dictionary
 * (`crops.json`) and the district registry (`districts.json`). Both are data, passed into the
 * pure functions that need them — never compiled into this package (PROMPT §6.1).
 */
import type { CropId, DistrictId, GeoPoint } from '../core/types.js';

export type CropClass = 'perishable' | 'grain';

/** Per-crop-family on-device grading models (PROMPT §7.3). `null`: photo capture only. */
export type VisionFamily = 'tuber_bulb' | 'solanaceous_fruit' | 'tropical_fruit' | 'grain_lot' | 'legume_lot' | 'oilseed_lot' | 'fibre_lot';

export interface CropProfile {
  id: CropId;
  names: { en: string; mr: string; hi: string };
  class: CropClass;
  stalenessLimitDays: number;
  visionFamily: VisionFamily | null;
  moistureRelevant: boolean;
  crateKg?: number;
  bagKg?: number;
  mspKey: string | null;
  synonyms: string[];
  /** 0–1: how strongly an unseasonal-rain anomaly moves this crop's price (RK-4). */
  weatherSensitivity?: number;
}

export interface VarietySubstitution {
  crop: CropId;
  requested: string;
  offered: string;
  note: string;
}

export interface CropDictionary {
  version: string;
  crops: CropProfile[];
  varietySubstitutions: VarietySubstitution[];
}

export interface MarketEntry {
  id: string;
  names: { en: string; mr: string };
  synonyms: string[];
  location: GeoPoint;
}

export interface DistrictEntry {
  id: DistrictId;
  names: { en: string; mr: string; hi: string };
  synonyms: string[];
  centroid: GeoPoint;
  markets: MarketEntry[];
}

export interface DistrictRegistry {
  version: string;
  state: string;
  districts: DistrictEntry[];
}

export function findCrop(dictionary: CropDictionary, id: CropId): CropProfile | null {
  return dictionary.crops.find((crop) => crop.id === id) ?? null;
}

export function findDistrict(registry: DistrictRegistry, id: DistrictId): DistrictEntry | null {
  return registry.districts.find((district) => district.id === id) ?? null;
}
