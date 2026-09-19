/**
 * StorageRegistryAdapter (FR-06, GR-7, RK-7). Accredited warehouses a farmer can actually reach,
 * with the figures RK-7 needs — rent per quintal per month, expected spoilage for each crop the
 * facility takes, and whether an e-NWR pledge loan is available and at what rate. "Wait" is only
 * suggested when a real, named facility is within reach; these records are that facility.
 *
 *   MockStorageRegistryAdapter — plausible facilities in the demo districts. The names are
 *                                fictional on purpose: a real corporation's name next to an
 *                                invented tariff would be a claim about that corporation.
 *                                Spoilage comes from STORAGE_SPOILAGE_PER_MONTH (sourced, flagged)
 *   LiveStorageRegistryAdapter — the registry gateway: GET {base}/v1/storage?district=…
 *                                →  { facilities: [StorageFacility] } (a WDRA registry export)
 */
import { STORAGE_SPOILAGE_PER_MONTH, type DistrictId, type StorageFacility, type StorageKind } from '@fasal/shared';

import { AdapterError, fetchJson, type Transport } from '../http.js';

export interface StorageRegistryAdapter {
  readonly mode: 'mock' | 'live';
  facilities(district: DistrictId): Promise<StorageFacility[]>;
}

interface MockFacility {
  id: string;
  name: string;
  district: DistrictId;
  kind: StorageKind;
  lat: number;
  lon: number;
  capacityAvailableQtl: number;
  ratePerQtlMonth: number;
  wdraAccredited: boolean;
  pledgeRateAnnual: number | null;
}

const MOCK_FACILITIES: readonly MockFacility[] = [
  { id: 'nsk-chawl-vinchur', name: 'Vinchur Kanda Chawl Cooperative', district: 'nashik', kind: 'ventilated-chawl', lat: 20.11, lon: 74.23, capacityAvailableQtl: 1200, ratePerQtlMonth: 22, wdraAccredited: false, pledgeRateAnnual: null },
  { id: 'nsk-wh-lasalgaon', name: 'Lasalgaon Agri Warehousing (WDRA)', district: 'nashik', kind: 'ventilated-chawl', lat: 20.155, lon: 74.24, capacityAvailableQtl: 400, ratePerQtlMonth: 30, wdraAccredited: true, pledgeRateAnnual: 0.09 },
  { id: 'nsk-cold-pimpalgaon', name: 'Pimpalgaon Cold Chain', district: 'nashik', kind: 'cold-store', lat: 20.17, lon: 73.99, capacityAvailableQtl: 250, ratePerQtlMonth: 55, wdraAccredited: true, pledgeRateAnnual: 0.095 },
  { id: 'nsk-dry-nashikroad', name: 'Nashik Road Grain Warehouse (WDRA)', district: 'nashik', kind: 'dry-warehouse', lat: 19.95, lon: 73.84, capacityAvailableQtl: 5000, ratePerQtlMonth: 8, wdraAccredited: true, pledgeRateAnnual: 0.085 },
  { id: 'ltr-dry-yard', name: 'Latur Market Yard Warehouse (WDRA)', district: 'latur', kind: 'dry-warehouse', lat: 18.4, lon: 76.58, capacityAvailableQtl: 8000, ratePerQtlMonth: 7, wdraAccredited: true, pledgeRateAnnual: 0.085 },
  { id: 'ltr-dry-ausa', name: 'Ausa Krishi Godown', district: 'latur', kind: 'dry-warehouse', lat: 18.25, lon: 76.5, capacityAvailableQtl: 1500, ratePerQtlMonth: 6, wdraAccredited: false, pledgeRateAnnual: null },
  { id: 'jlg-cold-raver', name: 'Raver Banana Cold Store', district: 'jalgaon', kind: 'cold-store', lat: 21.24, lon: 76.03, capacityAvailableQtl: 300, ratePerQtlMonth: 70, wdraAccredited: false, pledgeRateAnnual: null },
  { id: 'jlg-dry-jalgaon', name: 'Jalgaon Grain Warehouse (WDRA)', district: 'jalgaon', kind: 'dry-warehouse', lat: 21.01, lon: 75.56, capacityAvailableQtl: 3000, ratePerQtlMonth: 8, wdraAccredited: true, pledgeRateAnnual: 0.085 },
  { id: 'ngp-cold-kalamna', name: 'Kalamna Citrus Cold Store (WDRA)', district: 'nagpur', kind: 'cold-store', lat: 21.18, lon: 79.13, capacityAvailableQtl: 500, ratePerQtlMonth: 60, wdraAccredited: true, pledgeRateAnnual: 0.095 },
  { id: 'ngp-dry-nagpur', name: 'Nagpur Grain Warehouse (WDRA)', district: 'nagpur', kind: 'dry-warehouse', lat: 21.12, lon: 79.05, capacityAvailableQtl: 4000, ratePerQtlMonth: 8, wdraAccredited: true, pledgeRateAnnual: 0.085 },
  { id: 'pun-cold-narayangaon', name: 'Narayangaon Horticulture Cold Store', district: 'pune', kind: 'cold-store', lat: 19.12, lon: 73.97, capacityAvailableQtl: 300, ratePerQtlMonth: 65, wdraAccredited: false, pledgeRateAnnual: null },
  { id: 'pun-dry-pune', name: 'Pune Grain Warehouse (WDRA)', district: 'pune', kind: 'dry-warehouse', lat: 18.5, lon: 73.9, capacityAvailableQtl: 3500, ratePerQtlMonth: 9, wdraAccredited: true, pledgeRateAnnual: 0.085 },
  { id: 'ahn-chawl-rahuri', name: 'Rahuri Onion Storage Cooperative', district: 'ahilyanagar', kind: 'ventilated-chawl', lat: 19.39, lon: 74.65, capacityAvailableQtl: 900, ratePerQtlMonth: 20, wdraAccredited: false, pledgeRateAnnual: null },
  { id: 'ahn-dry-nagar', name: 'Ahilyanagar Grain Warehouse (WDRA)', district: 'ahilyanagar', kind: 'dry-warehouse', lat: 19.09, lon: 74.75, capacityAvailableQtl: 3000, ratePerQtlMonth: 8, wdraAccredited: true, pledgeRateAnnual: 0.085 },
];

function toFacility(f: MockFacility): StorageFacility {
  const spoilage = STORAGE_SPOILAGE_PER_MONTH.value[f.kind];
  return {
    id: f.id,
    name: f.name,
    district: f.district,
    location: { lat: f.lat, lon: f.lon },
    capacityAvailableQtl: f.capacityAvailableQtl,
    crops: Object.keys(spoilage),
    ratePerQtlMonth: f.ratePerQtlMonth,
    spoilageFractionPerMonth: { ...spoilage },
    wdraAccredited: f.wdraAccredited,
    // An e-NWR is issued only by a WDRA-registered warehouse.
    eNwr: f.wdraAccredited && f.pledgeRateAnnual !== null,
    pledgeRateAnnual: f.wdraAccredited ? f.pledgeRateAnnual : null,
  };
}

export class MockStorageRegistryAdapter implements StorageRegistryAdapter {
  readonly mode = 'mock' as const;

  async facilities(district: DistrictId): Promise<StorageFacility[]> {
    return MOCK_FACILITIES.filter((f) => f.district === district).map(toFacility);
  }
}

export interface StorageGatewayConfig {
  baseUrl: string;
  apiKey: string;
  transport?: Transport;
}

function isFacility(value: unknown): value is StorageFacility {
  if (typeof value !== 'object' || value === null) return false;
  const f = value as Record<string, unknown>;
  const loc = f['location'] as Record<string, unknown> | undefined;
  return (
    typeof f['id'] === 'string' &&
    typeof f['name'] === 'string' &&
    typeof f['district'] === 'string' &&
    typeof loc?.['lat'] === 'number' &&
    typeof loc['lon'] === 'number' &&
    typeof f['capacityAvailableQtl'] === 'number' &&
    Array.isArray(f['crops']) &&
    typeof f['ratePerQtlMonth'] === 'number' &&
    typeof f['spoilageFractionPerMonth'] === 'object' &&
    typeof f['wdraAccredited'] === 'boolean' &&
    typeof f['eNwr'] === 'boolean'
  );
}

export class LiveStorageRegistryAdapter implements StorageRegistryAdapter {
  readonly mode = 'live' as const;
  private readonly transport: Transport;

  constructor(private readonly config: StorageGatewayConfig) {
    this.transport = config.transport ?? fetch;
  }

  async facilities(district: DistrictId): Promise<StorageFacility[]> {
    const url = new URL(`${this.config.baseUrl}/v1/storage`);
    url.searchParams.set('district', district);
    const body = (await fetchJson(this.transport, { adapter: 'Storage registry', url: url.toString(), headers: { 'x-api-key': this.config.apiKey } })) as { facilities?: unknown };
    if (!Array.isArray(body.facilities)) throw new AdapterError('Storage registry', 'bad-response', 'The storage registry returned no facility list.');
    return body.facilities.filter(isFacility).map((f) => ({ ...f, pledgeRateAnnual: f.eNwr && typeof f.pledgeRateAnnual === 'number' ? f.pledgeRateAnnual : null }));
  }
}
