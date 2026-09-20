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
  weatherUrgency,
  type Benchmark,
  type CropBundle,
  type CropDictionary,
  type Demand,
  type DistrictForecast,
  type DistrictRegistry,
  type FarmerLocation,
  type ISODate,
  type StorageChoice,
  type WaitEvaluation,
  type WeatherUrgency,
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
  /** The verified bundle this briefing was computed from (for the evidence ledger). */
  bundle: CropBundle;
  names: { en: string; mr: string; hi?: string };
  benchmark: Benchmark;
  evaluation: WaitEvaluation;
  storage: StorageChoice | null;
  /** What this week's weather means for this crop, today (§XIII). Never a price prediction. */
  urgency: WeatherUrgency;
  release: string;
}

export interface HomeBriefing {
  district: string;
  /** The district's names from the registry, or null before the registry has synced. */
  districtNames: { en: string; mr: string; hi: string } | null;
  /** The market town the farmer is placed at, when the village names one. */
  locationNames: { en: string; mr: string } | null;
  location: FarmerLocation | null;
  crops: CropBriefing[];
  /** Epoch ms: when this briefing was computed on this phone. */
  computedAt: number;
  release: string | null;
  dataSource: string | null;
  /** The crop dictionary and district registry, for the parser (null before the first sync). */
  dictionary: CropDictionary | null;
  registry: DistrictRegistry | null;
  /** The district's buyer demand, verified; null before the first signed-in sync. */
  demand: Demand | null;
  /** The district's published forecast, with its own age; null before the first sync. */
  forecast: DistrictForecast | null;
}

/** Today's date in India (IST, UTC+05:30, no daylight saving), from a clock reading. */
export function todayInIndia(now: number): ISODate {
  return new Date(now + 5.5 * 3600_000).toISOString().slice(0, 10);
}

export async function computeHome(profile: StoredProfile, context: DecisionContext = DEFAULT_CONTEXT, now = Date.now()): Promise<HomeBriefing | null> {
  if (profile.district === null) return null;
  const db = store();
  const [bundles, cropsDoc, districtsDoc, manifest, demandDoc, weatherDoc] = await Promise.all([
    db.bundles.where('district').equals(profile.district).toArray(),
    db.shared.get('crops'),
    db.shared.get('districts'),
    db.manifest.get('current'),
    db.demand.get(profile.district),
    db.weather.get(profile.district),
  ]);
  const dictionaryDoc = (cropsDoc?.document['dictionary'] as CropDictionary | undefined) ?? null;
  const dictionary = dictionaryDoc?.crops ?? [];
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
      // Weather is urgency, not prediction: the forecast is read for this crop's own sensitivity
      // and turned into one operational sentence here, on the phone (§XIII).
      const urgency = weatherUrgency(weatherDoc?.forecast ?? null, { moistureRelevant: profileEntry?.moistureRelevant ?? false }, today);
      return { crop: bundle.crop, bundle, names: profileEntry?.names ?? { en: bundle.crop, mr: bundle.crop }, benchmark, evaluation, storage, urgency, release: bundle.version };
    })
    // Crops with current prices first, stale ones last; otherwise alphabetical, so no ranking is implied.
    .sort((a, b) => Number(a.benchmark.adviceSuppressed) - Number(b.benchmark.adviceSuppressed) || a.crop.localeCompare(b.crop));

  const market = location?.marketId === null || location === null ? null : (district?.markets.find((m) => m.id === location.marketId) ?? null);
  return { district: profile.district, districtNames: district?.names ?? null, locationNames: market?.names ?? null, location, crops, computedAt: now, release: manifest?.version ?? null, dataSource: manifest?.dataSource ?? null, dictionary: dictionaryDoc, registry: registry ?? null, demand: demandDoc?.demand ?? null, forecast: weatherDoc?.forecast ?? null };
}
