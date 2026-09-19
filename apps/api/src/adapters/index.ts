/**
 * The nine adapters (PROMPT §3.4), chosen by environment configuration and nothing else.
 * `describeAdapters` is what Judge Mode prints, so nobody can mistake a mock for a live feed.
 */
import { resolve } from 'node:path';

import type { Config } from '../config.js';
import { AgmarknetMarketDataAdapter, MockMarketDataAdapter, type MarketDataAdapter } from './market-data/market-data.js';
import { LiveSmsMessagingAdapter, MockMessagingAdapter, type MessagingAdapter } from './messaging/index.js';
import { ClaudeModelFallbackAdapter, MockModelFallbackAdapter, type ModelFallbackAdapter } from './model-fallback/model-fallback.js';
import { LiveBuyerRegistryAdapter, LiveFarmerRegistryAdapter } from './registry/live.js';
import { MockBuyerRegistryAdapter, MockFarmerRegistryAdapter } from './registry/mock.js';
import type { BuyerRegistryAdapter, FarmerRegistryAdapter } from './registry/types.js';
import { BhashiniSpeechAdapter, MockSpeechAdapter, type SpeechAdapter } from './speech/speech.js';
import { LiveStorageRegistryAdapter, MockStorageRegistryAdapter, type StorageRegistryAdapter } from './storage-registry/storage-registry.js';
import { LiveTransportTariffAdapter, MockTransportTariffAdapter, type TransportTariffAdapter } from './transport-tariff/transport-tariff.js';
import { MockWeatherAdapter, OpenMeteoWeatherAdapter, type WeatherAdapter } from './weather/weather.js';

export interface Adapters {
  market: MarketDataAdapter;
  weather: WeatherAdapter;
  farmerRegistry: FarmerRegistryAdapter;
  buyerRegistry: BuyerRegistryAdapter;
  messaging: MessagingAdapter;
  speech: SpeechAdapter;
  modelFallback: ModelFallbackAdapter;
  storage: StorageRegistryAdapter;
  transport: TransportTariffAdapter;
}

const need = (value: string | undefined, name: string): string => {
  if (value === undefined) throw new Error(`${name} is required for the live adapter.`);
  return value;
};

/** Build the adapters named by `config`. `repoRoot` anchors the mock market file. */
export function createAdapters(config: Config, repoRoot: string): Adapters {
  const gateway = (url: string | undefined, key: string | undefined, names: [string, string]) => ({ baseUrl: need(url, names[0]), apiKey: need(key, names[1]) });
  return {
    market:
      config.MARKET_ADAPTER === 'live'
        ? new AgmarknetMarketDataAdapter({ apiKey: need(config.MARKET_API_KEY, 'MARKET_API_KEY'), resourceId: config.MARKET_RESOURCE_ID })
        : new MockMarketDataAdapter({
            path: resolve(repoRoot, config.MARKET_MOCK_FILE),
            source: 'agmarknet',
            columns: { state: 'State', district: 'District', commodity: 'Commodity', date: 'Arrival_Date' },
          }),
    weather: config.WEATHER_ADAPTER === 'live' ? new OpenMeteoWeatherAdapter() : new MockWeatherAdapter(),
    farmerRegistry:
      config.REGISTRY_ADAPTER === 'live'
        ? new LiveFarmerRegistryAdapter(gateway(config.REGISTRY_GATEWAY_URL, config.REGISTRY_GATEWAY_KEY, ['REGISTRY_GATEWAY_URL', 'REGISTRY_GATEWAY_KEY']))
        : new MockFarmerRegistryAdapter(),
    buyerRegistry:
      config.REGISTRY_ADAPTER === 'live'
        ? new LiveBuyerRegistryAdapter(gateway(config.REGISTRY_GATEWAY_URL, config.REGISTRY_GATEWAY_KEY, ['REGISTRY_GATEWAY_URL', 'REGISTRY_GATEWAY_KEY']))
        : new MockBuyerRegistryAdapter(),
    messaging:
      config.MESSAGING_ADAPTER === 'live'
        ? new LiveSmsMessagingAdapter({
            url: need(config.SMS_GATEWAY_URL, 'SMS_GATEWAY_URL'),
            authKey: need(config.SMS_GATEWAY_KEY, 'SMS_GATEWAY_KEY'),
            templateId: need(config.SMS_TEMPLATE_ID, 'SMS_TEMPLATE_ID'),
          })
        : new MockMessagingAdapter(),
    speech:
      config.SPEECH_ADAPTER === 'live'
        ? new BhashiniSpeechAdapter({
            url: need(config.BHASHINI_URL, 'BHASHINI_URL'),
            inferenceKey: need(config.BHASHINI_KEY, 'BHASHINI_KEY'),
            serviceIds: JSON.parse(need(config.BHASHINI_SERVICE_IDS, 'BHASHINI_SERVICE_IDS')) as Record<string, string>,
          })
        : new MockSpeechAdapter(),
    modelFallback:
      config.MODEL_FALLBACK_ADAPTER === 'live' ? new ClaudeModelFallbackAdapter({ apiKey: need(config.ANTHROPIC_API_KEY, 'ANTHROPIC_API_KEY') }) : new MockModelFallbackAdapter(),
    storage:
      config.STORAGE_ADAPTER === 'live'
        ? new LiveStorageRegistryAdapter(gateway(config.LOGISTICS_GATEWAY_URL, config.LOGISTICS_GATEWAY_KEY, ['LOGISTICS_GATEWAY_URL', 'LOGISTICS_GATEWAY_KEY']))
        : new MockStorageRegistryAdapter(),
    transport:
      config.TRANSPORT_ADAPTER === 'live'
        ? new LiveTransportTariffAdapter(gateway(config.LOGISTICS_GATEWAY_URL, config.LOGISTICS_GATEWAY_KEY, ['LOGISTICS_GATEWAY_URL', 'LOGISTICS_GATEWAY_KEY']))
        : new MockTransportTariffAdapter(),
  };
}

/** For Judge Mode: which adapter is live and which is a mock. */
export function describeAdapters(adapters: Adapters): Record<keyof Adapters, 'mock' | 'live'> {
  return Object.fromEntries(Object.entries(adapters).map(([name, adapter]) => [name, (adapter as { mode: 'mock' | 'live' }).mode])) as Record<keyof Adapters, 'mock' | 'live'>;
}
