/**
 * On-device computation (PROMPT §XI; Constitution §3, §4).
 *
 * Every number on the home screen is computed here, now, from verified bundles in the device
 * store, by the same @fasal/shared functions the API and the channels use. Nothing in this file
 * touches the network. The farmer's own inputs (lot size, cost of money, tolerable loss) are
 * joined to the market data only on the phone and never leave it.
 */
import {
  computeBenchmark,
  evaluateWait,
  findDistrict,
  findReachableStorage,
  FINANCE_RATE_ANNUAL_DEFAULT,
  locateFarmer,
  TOLERABLE_LOSS_FRACTION_DEFAULT,
  type Benchmark,
  type CropProfile,
  type DistrictRegistry,
  type FarmerLocation,
  type ISODate,
  type StorageChoice,
  type WaitEvaluation,
} from '@fasal/shared';

import { store, type StoredProfile } from './db.js';

/** The farmer's own decision inputs. Defaults are the specification's; every one is theirs to change. */
export interface DecisionContext {
  quantityQtl: number;
  financeRateAnnual: number;
  tolerableLossFraction: number;
  horizon: 7 | 14;
}

export const DEFAULT_CONTEXT: DecisionContext = {
  quantityQtl: 5,
  financeRateAnnual: FINANCE_RATE_ANNUAL_DEFAULT.value,
  tolerableLossFraction: TOLERABLE_LOSS_FRACTION_DEFAULT.value,
  horizon: 7,
};

export interface CropBriefing {
  crop: string;
  names: { en: string; mr: string; hi?: string };
  benchmark: Benchmark;
  evaluation: WaitEvaluation;
  storage: StorageChoice | null;
  release: string;
}

export interface HomeBriefing {
  district: string;
  /** The district's names from the registry, or null before the registry has synced. */
  districtNames: { en: string; mr: string; hi: string } | null;
  location: FarmerLocation | null;
  crops: CropBriefing[];
  /** Epoch ms: when this briefing was computed on this phone. */
  computedAt: number;
  release: string | null;
  dataSource: string | null;
}

/** Today's date in India (IST, UTC+05:30, no daylight saving), from a clock reading. */
export function todayInIndia(now: number): ISODate {
  return new Date(now + 5.5 * 3600_000).toISOString().slice(0, 10);
}

export async function computeHome(profile: StoredProfile, context: DecisionContext = DEFAULT_CONTEXT, now = Date.now()): Promise<HomeBriefing | null> {
  if (profile.district === null) return null;
  const db = store();
  const [bundles, cropsDoc, districtsDoc, manifest] = await Promise.all([
    db.bundles.where('district').equals(profile.district).toArray(),
    db.shared.get('crops'),
    db.shared.get('districts'),
    db.manifest.get('current'),
  ]);
  const dictionary = (cropsDoc?.document['dictionary'] as { crops?: CropProfile[] } | undefined)?.crops ?? [];
  const registry = districtsDoc?.document['registry'] as DistrictRegistry | undefined;
  const district = registry === undefined ? null : findDistrict(registry, profile.district);
  const location = district === null ? null : locateFarmer(profile.village, district);
  const today = todayInIndia(now);

  const crops: CropBriefing[] = bundles
    .map(({ bundle }) => {
      const benchmark = computeBenchmark(bundle, today);
      const storage = location === null ? null : findReachableStorage(bundle.storage, location.point, bundle.crop, context.quantityQtl, bundle.benchmark.modal);
      const evaluation = evaluateWait({
        bundle,
        horizon: context.horizon,
        quantityQtl: context.quantityQtl,
        storage,
        financeRateAnnual: context.financeRateAnnual,
        tolerableLossFraction: context.tolerableLossFraction,
        today,
      });
      const profileEntry = dictionary.find((c) => c.id === bundle.crop);
      return { crop: bundle.crop, names: profileEntry?.names ?? { en: bundle.crop, mr: bundle.crop }, benchmark, evaluation, storage, release: bundle.version };
    })
    // Crops with current prices first, stale ones last; otherwise alphabetical, so no ranking is implied.
    .sort((a, b) => Number(a.benchmark.adviceSuppressed) - Number(b.benchmark.adviceSuppressed) || a.crop.localeCompare(b.crop));

  return { district: profile.district, districtNames: district?.names ?? null, location, crops, computedAt: now, release: manifest?.version ?? null, dataSource: manifest?.dataSource ?? null };
}
