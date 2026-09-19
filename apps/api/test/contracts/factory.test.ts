/**
 * ARCH-06 · switching an adapter is environment configuration, never a code change — and a live
 * adapter without its credential stops the server at boot instead of quietly running the mock.
 */
import { describe, expect, it } from 'vitest';

import { createAdapters, describeAdapters } from '../../src/adapters/index.js';
import { ConfigError, loadConfig } from '../../src/config.js';

const BASE = { DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/x', DB_CONTEXT_KEY: 'a'.repeat(64), AUTH_SECRET: 'b'.repeat(64) };

describe('ARCH-06 · adapters are chosen by .env', () => {
  it('defaults every adapter to mock, and says so for Judge Mode', () => {
    const modes = describeAdapters(createAdapters(loadConfig(BASE), '/repo'));
    expect(Object.keys(modes).sort()).toEqual(['buyerRegistry', 'farmerRegistry', 'market', 'messaging', 'modelFallback', 'speech', 'storage', 'transport', 'weather']);
    expect(new Set(Object.values(modes))).toEqual(new Set(['mock']));
  });

  it('switches to live by configuration alone', () => {
    const config = loadConfig({
      ...BASE,
      WEATHER_ADAPTER: 'live',
      MODEL_FALLBACK_ADAPTER: 'live',
      ANTHROPIC_API_KEY: 'sk-test',
      STORAGE_ADAPTER: 'live',
      TRANSPORT_ADAPTER: 'live',
      LOGISTICS_GATEWAY_URL: 'https://logistics.example.in',
      LOGISTICS_GATEWAY_KEY: 'lg-key',
    });
    expect(describeAdapters(createAdapters(config, '/repo'))).toMatchObject({ weather: 'live', modelFallback: 'live', storage: 'live', transport: 'live', market: 'mock' });
  });

  it('refuses to start a live adapter without its credentials, naming each one', () => {
    const attempt = () => loadConfig({ ...BASE, MARKET_ADAPTER: 'live', REGISTRY_ADAPTER: 'live', REGISTRY_GATEWAY_URL: 'https://gw.example.in' });
    expect(attempt).toThrow(ConfigError);
    expect(attempt).toThrow(/MARKET_API_KEY is required when MARKET_ADAPTER=live/);
    expect(attempt).toThrow(/REGISTRY_GATEWAY_KEY is required when REGISTRY_ADAPTER=live/);
  });

  it('treats an empty credential as missing', () => {
    expect(() => loadConfig({ ...BASE, MODEL_FALLBACK_ADAPTER: 'live', ANTHROPIC_API_KEY: '' })).toThrow(/ANTHROPIC_API_KEY is required/);
  });
});
