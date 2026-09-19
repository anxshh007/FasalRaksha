/**
 * ARCH-06 · FR-05 · FR-06 — StorageRegistryAdapter and TransportTariffAdapter, Mock and Live. The
 * facilities they return are exactly what RK-7 prices waiting against, so every field is checked
 * for being usable, not just present.
 */
import { findReachableStorage } from '@fasal/shared';
import { describe, expect, it } from 'vitest';

import { LiveStorageRegistryAdapter, MockStorageRegistryAdapter, type StorageRegistryAdapter } from '../../src/adapters/storage-registry/storage-registry.js';
import { LiveTransportTariffAdapter, MockTransportTariffAdapter, type TransportTariffAdapter } from '../../src/adapters/transport-tariff/transport-tariff.js';
import { recorded } from './support/recorded.js';

async function snapshotOf<T>(load: () => Promise<T>): Promise<T> {
  return load();
}

/** The live gateway replays exactly what the mock holds, in the gateway's JSON shape. */
async function logisticsGateway() {
  const storage = new MockStorageRegistryAdapter();
  const transport = new MockTransportTariffAdapter();
  const snapshots = {
    storage: { nashik: await snapshotOf(() => storage.facilities('nashik')), latur: await snapshotOf(() => storage.facilities('latur')) },
    tariffs: { nashik: await transport.tariffs('nashik'), latur: await transport.tariffs('latur') },
    transporters: { nashik: await transport.transporters('nashik'), latur: await transport.transporters('latur') },
  };
  return recorded([
    {
      when: (c) => c.url.pathname === '/v1/storage' && c.headers['x-api-key'] === 'lg-key',
      json: (c) => ({ facilities: snapshots.storage[c.url.searchParams.get('district') as 'nashik' | 'latur'] ?? [] }),
    },
    {
      when: (c) => c.url.pathname === '/v1/transport' && c.headers['x-api-key'] === 'lg-key',
      json: (c) => {
        const d = c.url.searchParams.get('district') as 'nashik' | 'latur';
        return { tariffs: snapshots.tariffs[d] ?? [], transporters: snapshots.transporters[d] ?? [] };
      },
    },
  ]);
}

const storages: Array<[string, () => Promise<StorageRegistryAdapter>]> = [
  ['mock', async () => new MockStorageRegistryAdapter()],
  ['live', async () => new LiveStorageRegistryAdapter({ baseUrl: 'https://logistics.test', apiKey: 'lg-key', transport: (await logisticsGateway()).transport })],
];

describe.each(storages)('ARCH-06 · FR-06 · StorageRegistryAdapter contract (%s)', (_mode, make) => {
  it('returns only facilities in the requested district, each usable by RK-7', async () => {
    const facilities = await (await make()).facilities('nashik');
    expect(facilities.length).toBeGreaterThan(0);
    for (const f of facilities) {
      expect(f.district).toBe('nashik');
      expect(f.capacityAvailableQtl).toBeGreaterThanOrEqual(0);
      expect(f.ratePerQtlMonth).toBeGreaterThanOrEqual(0);
      for (const crop of f.crops) {
        const loss = f.spoilageFractionPerMonth[crop];
        expect(loss !== undefined && loss >= 0 && loss < 1).toBe(true);
      }
      // An e-NWR exists only at a WDRA-registered warehouse, and always carries a pledge rate.
      if (f.eNwr) expect(f.wdraAccredited && typeof f.pledgeRateAnnual === 'number').toBe(true);
      else expect(f.pledgeRateAnnual).toBeNull();
    }
  });

  it('gives a Nashik onion farmer a real place to wait, and a Latur soybean farmer one too', async () => {
    const adapter = await make();
    const onion = findReachableStorage(await adapter.facilities('nashik'), { lat: 20.1, lon: 74.15 }, 'onion', 5, 1840);
    const soy = findReachableStorage(await adapter.facilities('latur'), { lat: 18.4, lon: 76.56 }, 'soybean', 20, 4650);
    expect(onion?.facility.crops).toContain('onion');
    expect(soy?.facility.crops).toContain('soybean');
  });

  it('returns nothing for a district it has no facilities in', async () => {
    expect(await (await make()).facilities('gadchiroli')).toEqual([]);
  });
});

const transports: Array<[string, () => Promise<TransportTariffAdapter>]> = [
  ['mock', async () => new MockTransportTariffAdapter()],
  ['live', async () => new LiveTransportTariffAdapter({ baseUrl: 'https://logistics.test', apiKey: 'lg-key', transport: (await logisticsGateway()).transport })],
];

describe.each(transports)('ARCH-06 · FR-05 · TransportTariffAdapter contract (%s)', (_mode, make) => {
  it('returns hired-vehicle tariffs with positive capacity and rates, in the district asked for', async () => {
    const tariffs = await (await make()).tariffs('nashik');
    expect(tariffs.length).toBeGreaterThanOrEqual(3);
    for (const t of tariffs) {
      expect(t.district).toBe('nashik');
      expect(t.capacityKg).toBeGreaterThan(0);
      expect(t.ratePerKm).toBeGreaterThan(0);
      expect(t.minimumCharge).toBeGreaterThanOrEqual(0);
    }
  });

  it('lists transporters a farmer can phone, each with a vehicle a tariff exists for', async () => {
    const adapter = await make();
    const classes = new Set((await adapter.tariffs('nashik')).map((t) => t.vehicleClass));
    const directory = await adapter.transporters('nashik');
    expect(directory.length).toBeGreaterThan(0);
    for (const t of directory) expect(classes.has(t.vehicleClass)).toBe(true);
  });

  it('returns nothing for a district it has no tariffs for', async () => {
    expect(await (await make()).tariffs('gadchiroli')).toEqual([]);
  });
});
