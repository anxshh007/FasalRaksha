/**
 * Live registries. PM-KISAN, AgriStack, GSTIN and Udyam lookups are available to authorised
 * integrators through a gateway (API Setu–style) rather than as open endpoints, so the live
 * adapters speak one documented gateway contract, configured by environment:
 *
 *   POST {REGISTRY_GATEWAY_URL}/v1/farmer/lookup    { registry, id }  →  { found, record? }
 *   POST {REGISTRY_GATEWAY_URL}/v1/business/lookup  { method, id }    →  { found, record? }
 *   header: x-api-key: {REGISTRY_GATEWAY_KEY}
 *
 * The credential lives in server configuration only — a browser never holds it (PROMPT §8.3).
 */
import { AdapterError, fetchJson, type Transport } from '../http.js';
import type { BusinessIdKind, BusinessRecord, BuyerRegistryAdapter, FarmerRecord, FarmerRegistry, FarmerRegistryAdapter } from './types.js';

export interface GatewayConfig {
  baseUrl: string;
  apiKey: string;
  transport?: Transport;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export class LiveFarmerRegistryAdapter implements FarmerRegistryAdapter {
  readonly mode = 'live' as const;
  private readonly transport: Transport;

  constructor(private readonly config: GatewayConfig) {
    this.transport = config.transport ?? fetch;
  }

  async lookup(registry: FarmerRegistry, id: string): Promise<FarmerRecord | null> {
    const body = (await fetchJson(this.transport, {
      adapter: 'Farmer registry',
      url: `${this.config.baseUrl}/v1/farmer/lookup`,
      method: 'POST',
      headers: { 'x-api-key': this.config.apiKey },
      body: { registry, id },
    })) as { found?: unknown; record?: Record<string, unknown> };
    if (body.found === false) return null;
    const record = body.record;
    const name = str(record?.['name']);
    const district = str(record?.['district']);
    if (body.found !== true || name === null || district === null) throw new AdapterError('Farmer registry', 'bad-response', 'The farmer registry answered without a name and district.');
    return { registry, id, name, district: district.toLowerCase(), village: str(record?.['village']) };
  }
}

export class LiveBuyerRegistryAdapter implements BuyerRegistryAdapter {
  readonly mode = 'live' as const;
  private readonly transport: Transport;

  constructor(private readonly config: GatewayConfig) {
    this.transport = config.transport ?? fetch;
  }

  async lookup(method: BusinessIdKind, id: string): Promise<BusinessRecord | null> {
    const body = (await fetchJson(this.transport, {
      adapter: 'Business registry',
      url: `${this.config.baseUrl}/v1/business/lookup`,
      method: 'POST',
      headers: { 'x-api-key': this.config.apiKey },
      body: { method, id },
    })) as { found?: unknown; record?: Record<string, unknown> };
    if (body.found === false) return null;
    const record = body.record;
    const legalName = str(record?.['legalName']);
    const status = record?.['status'];
    if (body.found !== true || legalName === null || (status !== 'active' && status !== 'cancelled' && status !== 'suspended')) {
      throw new AdapterError('Business registry', 'bad-response', 'The business registry answered without a legal name and status.');
    }
    const district = str(record?.['district']);
    return { method, id, legalName, status, district: district === null ? null : district.toLowerCase() };
  }
}
