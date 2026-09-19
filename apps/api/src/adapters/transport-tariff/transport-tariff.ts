/**
 * TransportTariffAdapter (FR-05, FR-13). Hired-vehicle tariffs by district and vehicle class —
 * the numbers freight in net realisation is computed from — and the district transporter
 * directory attached to a sauda slip at acceptance. Not a booking engine (PROMPT §XIII):
 * coordinating a pickup is a phone call between two verified parties; this makes it informed.
 *
 *   MockTransportTariffAdapter — indicative tariffs for the demo districts and fictional operators
 *   LiveTransportTariffAdapter — the logistics gateway: GET {base}/v1/transport?district=…
 *                                →  { tariffs: [TransportTariff], transporters: [Transporter] }
 */
import type { DistrictId, TransportTariff } from '@fasal/shared';

import { AdapterError, fetchJson, type Transport } from '../http.js';

export interface Transporter {
  id: string;
  name: string;
  district: DistrictId;
  vehicleClass: string;
  capacityKg: number;
  ratePerKm: number;
  minimumCharge: number;
  available: boolean;
}

export interface TransportTariffAdapter {
  readonly mode: 'mock' | 'live';
  tariffs(district: DistrictId): Promise<TransportTariff[]>;
  transporters(district: DistrictId): Promise<Transporter[]>;
}

/** Vehicle classes and indicative rates; districts differ slightly with fuel and haul patterns. */
const CLASSES = [
  { key: 'ace', vehicleClass: 'Mini-truck (≈0.75 t)', capacityKg: 750, ratePerKm: 18, minimumCharge: 350 },
  { key: 'pickup', vehicleClass: 'Pickup (≈1.5 t)', capacityKg: 1500, ratePerKm: 22, minimumCharge: 600 },
  { key: '407', vehicleClass: 'LCV (≈3.5 t)', capacityKg: 3500, ratePerKm: 30, minimumCharge: 1200 },
  { key: '9t', vehicleClass: 'Truck (≈9 t)', capacityKg: 9000, ratePerKm: 45, minimumCharge: 3000 },
] as const;

const DISTRICT_FACTOR: Readonly<Record<string, number>> = { nashik: 1, latur: 0.95, jalgaon: 0.97, nagpur: 1.03, pune: 1.08, ahilyanagar: 0.98 };
const PREFIX: Readonly<Record<string, string>> = { nashik: 'nsk', latur: 'ltr', jalgaon: 'jlg', nagpur: 'ngp', pune: 'pun', ahilyanagar: 'ahn' };

const OPERATORS: Readonly<Record<string, readonly string[]>> = {
  nashik: ['Godavari Goods Carriers', 'Niphad Tempo Seva', 'Lasalgaon Road Lines'],
  latur: ['Manjra Transport', 'Ausa Goods Service'],
  jalgaon: ['Tapi Valley Carriers', 'Raver Truck Seva'],
  nagpur: ['Vidarbha Freight Lines', 'Kalamna Tempo Service'],
  pune: ['Sahyadri Goods Movers', 'Junnar Pickup Seva'],
  ahilyanagar: ['Pravara Carriers', 'Rahuri Transport Co.'],
};

export class MockTransportTariffAdapter implements TransportTariffAdapter {
  readonly mode = 'mock' as const;

  async tariffs(district: DistrictId): Promise<TransportTariff[]> {
    const factor = DISTRICT_FACTOR[district];
    const prefix = PREFIX[district];
    if (factor === undefined || prefix === undefined) return [];
    return CLASSES.map((c) => ({
      id: `${prefix}-${c.key}`,
      vehicleClass: c.vehicleClass,
      capacityKg: c.capacityKg,
      ratePerKm: Math.round(c.ratePerKm * factor * 10) / 10,
      minimumCharge: Math.round(c.minimumCharge * factor),
      district,
    }));
  }

  async transporters(district: DistrictId): Promise<Transporter[]> {
    const tariffs = await this.tariffs(district);
    const names = OPERATORS[district] ?? [];
    return names.flatMap((name, i) =>
      tariffs
        .filter((_, j) => (i + j) % 2 === 0)
        .map((t) => ({
          id: `${t.id}-op${i + 1}`,
          name,
          district,
          vehicleClass: t.vehicleClass,
          capacityKg: t.capacityKg,
          ratePerKm: t.ratePerKm,
          minimumCharge: t.minimumCharge,
          available: true,
        })),
    );
  }
}

export interface TransportGatewayConfig {
  baseUrl: string;
  apiKey: string;
  transport?: Transport;
}

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

export class LiveTransportTariffAdapter implements TransportTariffAdapter {
  readonly mode = 'live' as const;
  private readonly transport: Transport;

  constructor(private readonly config: TransportGatewayConfig) {
    this.transport = config.transport ?? fetch;
  }

  private async load(district: DistrictId): Promise<{ tariffs: unknown[]; transporters: unknown[] }> {
    const url = new URL(`${this.config.baseUrl}/v1/transport`);
    url.searchParams.set('district', district);
    const body = (await fetchJson(this.transport, { adapter: 'Transport directory', url: url.toString(), headers: { 'x-api-key': this.config.apiKey } })) as {
      tariffs?: unknown;
      transporters?: unknown;
    };
    if (!Array.isArray(body.tariffs) || !Array.isArray(body.transporters)) throw new AdapterError('Transport directory', 'bad-response', 'The transport directory returned no tariff list.');
    return { tariffs: body.tariffs, transporters: body.transporters };
  }

  async tariffs(district: DistrictId): Promise<TransportTariff[]> {
    return (await this.load(district)).tariffs
      .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
      .filter((t) => typeof t['id'] === 'string' && typeof t['vehicleClass'] === 'string' && positive(t['capacityKg']) && positive(t['ratePerKm']) && typeof t['minimumCharge'] === 'number')
      .map((t) => ({ id: String(t['id']), vehicleClass: String(t['vehicleClass']), capacityKg: Number(t['capacityKg']), ratePerKm: Number(t['ratePerKm']), minimumCharge: Number(t['minimumCharge']), district }));
  }

  async transporters(district: DistrictId): Promise<Transporter[]> {
    return (await this.load(district)).transporters
      .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
      .filter((t) => typeof t['id'] === 'string' && typeof t['name'] === 'string' && positive(t['capacityKg']) && positive(t['ratePerKm']))
      .map((t) => ({
        id: String(t['id']),
        name: String(t['name']),
        district,
        vehicleClass: String(t['vehicleClass'] ?? ''),
        capacityKg: Number(t['capacityKg']),
        ratePerKm: Number(t['ratePerKm']),
        minimumCharge: Number(t['minimumCharge'] ?? 0),
        available: t['available'] !== false,
      }));
  }
}
