/**
 * The district's weather, for the phone (PROMPT §XIII; FR-13; RK-4).
 *
 * Weather is consumed, never predicted: this serves what a published source says, with the source
 * named on it, and the phone turns it into urgency itself with `weatherUrgency` from
 * @fasal/shared. That split matters twice over — the sentence a farmer reads is computed on the
 * device, so it survives the API being killed (Gate A), and the same function produces the same
 * sentence on WhatsApp, SMS and IVR (Constitution §3).
 *
 * The document is canonical JSON with an integrity hash and an ETag, exactly like a bundle and
 * the demand document, so the phone verifies it before it stores it and a revalidation costs no
 * bytes. It carries its own issue date; nothing here decides how old is too old, because that is
 * the engine's rule (`WEATHER_MAX_AGE_DAYS`) and it must be the same rule everywhere.
 */
import { canonicalJson, computeIntegrity, type DistrictForecast, type DistrictRegistry } from '@fasal/shared';

import type { WeatherAdapter } from '../../adapters/weather/weather.js';
import { DomainError } from '../../http/errors.js';
import type { ServedDocument } from '../bundles/store.js';
import { districtRegistry } from '../demand/service.js';

export interface WeatherDocument extends DistrictForecast {
  kind: 'weather';
  /** 'mock' or 'live': a screen may say which, and Judge Mode does (§14.4). */
  mode: 'mock' | 'live';
  integrity: string;
}

/** How many days ahead to publish. A week is what the operational question ever needs. */
const DAYS = 7;

export async function weatherFor(adapter: WeatherAdapter, district: string, now: Date): Promise<ServedDocument & { document: WeatherDocument }> {
  const registry: DistrictRegistry = districtRegistry();
  const entry = registry.districts.find((d) => d.id === district);
  if (entry === undefined) throw new DomainError(404, 'UNKNOWN_DISTRICT', 'That district is not in the registry.');
  const issuedDate = new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10); // the farmer's day, IST

  let forecast;
  try {
    forecast = await adapter.forecast(district, entry.centroid, issuedDate, DAYS);
  } catch {
    // A forecast that cannot be fetched is an absence, not a guess: the phone keeps what it has.
    throw new DomainError(503, 'WEATHER_UNAVAILABLE', 'The weather service cannot be reached right now.');
  }

  const body: Omit<WeatherDocument, 'integrity'> = {
    kind: 'weather',
    mode: adapter.mode,
    district: forecast.district,
    issuedDate: forecast.issuedDate,
    days: forecast.days,
    source: forecast.source,
  };
  const integrity = computeIntegrity(body as unknown as Record<string, unknown>);
  const document = { ...body, integrity } as WeatherDocument;
  return { body: canonicalJson(document), etag: `"${integrity}"`, version: forecast.issuedDate, document };
}
