/**
 * Freight from a real hired-vehicle tariff (PROMPT §6.5, §XIII) — not `distance × ₹/km` and not
 * Phase 1's "same city +20". A trip costs the greater of the per-km charge and the vehicle's
 * minimum; a lot larger than one vehicle needs several trips; the cheapest workable vehicle
 * class wins (ties: the smaller vehicle, then the tariff id, so the answer is deterministic).
 */
import type { TransportTariff } from '../bundle/types.js';

export interface FreightEstimate {
  total: number;
  vehicleClass: string;
  tariffId: string;
  trips: number;
}

export function tripCost(tariff: TransportTariff, roadKm: number): number {
  return Math.max(tariff.minimumCharge, tariff.ratePerKm * roadKm);
}

export function estimateFreight(tariffs: readonly TransportTariff[], roadKm: number, kg: number): FreightEstimate | null {
  if (!(roadKm >= 0) || !(kg > 0)) throw new RangeError('Freight needs a non-negative distance and a positive load.');
  const options = tariffs
    .filter((tariff) => tariff.capacityKg > 0)
    .map((tariff) => {
      const trips = Math.ceil(kg / tariff.capacityKg);
      return { tariff, trips, total: trips * tripCost(tariff, roadKm) };
    })
    .sort((a, b) => a.total - b.total || a.tariff.capacityKg - b.tariff.capacityKg || a.tariff.id.localeCompare(b.tariff.id));
  const best = options[0];
  return best === undefined ? null : { total: best.total, vehicleClass: best.tariff.vehicleClass, tariffId: best.tariff.id, trips: best.trips };
}
