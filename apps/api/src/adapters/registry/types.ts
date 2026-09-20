/**
 * Registry adapters (PROMPT §3.4, §8.3; P1-09). Every government or business registry lookup
 * happens here, server-side — a browser never holds a registry credential. Each adapter has a
 * Mock and a Live implementation of one interface; switching is REGISTRY_ADAPTER in `.env`.
 */
import type { DistrictId } from '@fasal/shared';

export type FarmerRegistry = 'pm-kisan' | 'agristack';

export interface FarmerRecord {
  registry: FarmerRegistry;
  id: string;
  name: string;
  district: DistrictId;
  village: string | null;
}

export interface FarmerRegistryAdapter {
  readonly mode: 'mock' | 'live';
  /** The registry's record for this identifier, or null when there is none. */
  lookup(registry: FarmerRegistry, id: string): Promise<FarmerRecord | null>;
  /**
   * The records this adapter is willing to show as examples. Only the mock has any: a real
   * registry cannot hand out a list of farmers, and nobody has to remember to turn this off in
   * a live deployment because there is nothing to turn off (PROMPT §16.1; CUTS C-14).
   */
  samples?(): readonly FarmerRecord[];
}

export type BusinessIdKind = 'gstin' | 'udyam';

export interface BusinessRecord {
  method: BusinessIdKind;
  id: string;
  legalName: string;
  status: 'active' | 'cancelled' | 'suspended';
  district: DistrictId | null;
}

export interface BuyerRegistryAdapter {
  readonly mode: 'mock' | 'live';
  lookup(method: BusinessIdKind, id: string): Promise<BusinessRecord | null>;
}

const GSTIN_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The GSTIN check character (mod-36, alternating weights 1 and 2) for the first 14 characters. */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = GSTIN_CHARSET.indexOf(first14[i] ?? '');
    if (value < 0) return '';
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARSET[(36 - (sum % 36)) % 36] ?? '';
}

/** Shape and checksum — a GSTIN that fails here is never sent to any registry. */
export function isValidGstin(value: string): boolean {
  const gstin = value.trim().toUpperCase();
  return /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin) && gstinCheckChar(gstin.slice(0, 14)) === gstin[14];
}

export function isValidUdyam(value: string): boolean {
  return /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/.test(value.trim().toUpperCase());
}

export function isPlausibleFarmerId(registry: FarmerRegistry, value: string): boolean {
  const id = value.trim().toUpperCase();
  return registry === 'pm-kisan' ? /^PMK-[A-Z]{2}-\d{4}-\d{5}$/.test(id) : /^\d{11}$/.test(id);
}
