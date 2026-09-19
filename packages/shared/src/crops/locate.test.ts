/**
 * P1-04 · GR-7 — the farmer's location comes from their verified village and district, never a
 * constant, and says how precise it is.
 */
import { describe, expect, it } from 'vitest';

import districts from '../../../../data/reference/districts.json' with { type: 'json' };
import { locateFarmer } from './locate.js';
import { findDistrict, type DistrictRegistry } from './types.js';

const nashik = findDistrict(districts as DistrictRegistry, 'nashik');
if (nashik === null) throw new Error('nashik missing from the registry');

describe('P1-04 · locateFarmer', () => {
  it('uses the market town a village record names', () => {
    expect(locateFarmer('Lasalgaon', nashik)).toMatchObject({ source: 'market-town', marketId: 'lasalgaon' });
    expect(locateFarmer('Vinchur (Niphad)', nashik)).toMatchObject({ source: 'market-town', marketId: 'niphad' });
  });

  it('prefers the longest match, so "Pimpalgaon Baswant" is not just "Pimpalgaon"', () => {
    expect(locateFarmer('Pimpalgaon Baswant', nashik).marketId).toBe('pimpalgaon-baswant');
  });

  it('reads a Devanagari village name', () => {
    expect(locateFarmer('लासलगाव', nashik).marketId).toBe('lasalgaon');
  });

  it('falls back to the district headquarters and says so', () => {
    expect(locateFarmer('Chandori', nashik)).toEqual({ point: nashik.centroid, source: 'district-centroid', marketId: null });
    expect(locateFarmer(null, nashik).source).toBe('district-centroid');
  });
});
