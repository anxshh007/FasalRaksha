/**
 * ARCH-06 · P1-09 — FarmerRegistryAdapter, BuyerRegistryAdapter and MessagingAdapter: one
 * contract each, Mock and Live.
 */
import { describe, expect, it } from 'vitest';

import { LiveSmsMessagingAdapter, MockMessagingAdapter, type MessagingAdapter } from '../../src/adapters/messaging/index.js';
import { LiveBuyerRegistryAdapter, LiveFarmerRegistryAdapter } from '../../src/adapters/registry/live.js';
import { MOCK_BUSINESSES, MOCK_FARMERS, MockBuyerRegistryAdapter, MockFarmerRegistryAdapter } from '../../src/adapters/registry/mock.js';
import type { BuyerRegistryAdapter, FarmerRegistryAdapter } from '../../src/adapters/registry/types.js';
import { recorded } from './support/recorded.js';

const MAHARASHTRA = new Set(['nashik', 'latur', 'jalgaon', 'nagpur', 'pune', 'ahilyanagar']);
const GODAVARI = MOCK_BUSINESSES.find((b) => b.legalName === 'Godavari Agro Traders');
const CANCELLED = MOCK_BUSINESSES.find((b) => b.status === 'cancelled');

function gateway() {
  return recorded([
    {
      when: (c) => c.url.pathname === '/v1/farmer/lookup' && c.headers['x-api-key'] === 'gw-key',
      json: (c) => {
        const { registry, id } = c.body as { registry: string; id: string };
        const hit = MOCK_FARMERS.find((f) => f.registry === registry && f.id === id);
        return hit === undefined ? { found: false } : { found: true, record: { name: hit.name, district: hit.district.toUpperCase(), village: hit.village } };
      },
    },
    {
      when: (c) => c.url.pathname === '/v1/business/lookup' && c.headers['x-api-key'] === 'gw-key',
      json: (c) => {
        const { method, id } = c.body as { method: string; id: string };
        const hit = MOCK_BUSINESSES.find((b) => b.method === method && b.id === id);
        return hit === undefined ? { found: false } : { found: true, record: { legalName: hit.legalName, status: hit.status, district: hit.district } };
      },
    },
    { when: () => true, status: 401, json: { error: 'invalid key' } },
  ]);
}

const farmerRegistries: Array<[string, () => FarmerRegistryAdapter]> = [
  ['mock', () => new MockFarmerRegistryAdapter()],
  ['live', () => new LiveFarmerRegistryAdapter({ baseUrl: 'https://gateway.test', apiKey: 'gw-key', transport: gateway().transport })],
];

describe.each(farmerRegistries)('ARCH-06 · P1-09 · FarmerRegistryAdapter contract (%s)', (_mode, make) => {
  it('finds a registered farmer with their name and Maharashtra district', async () => {
    const record = await make().lookup('pm-kisan', 'PMK-MH-2003-11427');
    expect(record).toMatchObject({ registry: 'pm-kisan', id: 'PMK-MH-2003-11427', name: 'Sunil Ramrao Bhosale', district: 'nashik' });
    expect(MAHARASHTRA.has(record?.district ?? '')).toBe(true);
  });

  it('returns nothing — not an error — for an identifier the registry does not hold', async () => {
    expect(await make().lookup('pm-kisan', 'PMK-MH-9999-99999')).toBeNull();
  });

  it('keeps the two registries apart', async () => {
    expect(await make().lookup('agristack', 'PMK-MH-2003-11427')).toBeNull();
    expect((await make().lookup('agristack', '27010203045'))?.district).toBe('nashik');
  });
});

const buyerRegistries: Array<[string, () => BuyerRegistryAdapter]> = [
  ['mock', () => new MockBuyerRegistryAdapter()],
  ['live', () => new LiveBuyerRegistryAdapter({ baseUrl: 'https://gateway.test', apiKey: 'gw-key', transport: gateway().transport })],
];

describe.each(buyerRegistries)('ARCH-06 · P1-09 · BuyerRegistryAdapter contract (%s)', (_mode, make) => {
  it('finds an active GSTIN registration with its legal name', async () => {
    expect(await make().lookup('gstin', GODAVARI?.id ?? '')).toMatchObject({ legalName: 'Godavari Agro Traders', status: 'active', district: 'nashik' });
  });

  it('reports a cancelled registration as cancelled, so it can be refused', async () => {
    expect((await make().lookup('gstin', CANCELLED?.id ?? ''))?.status).toBe('cancelled');
  });

  it('finds Udyam registrations and returns nothing for unknown ones', async () => {
    expect((await make().lookup('udyam', 'UDYAM-MH-26-0012345'))?.legalName).toBe('Shree Sai Onion Traders');
    expect(await make().lookup('udyam', 'UDYAM-MH-01-0000001')).toBeNull();
  });
});

describe('ARCH-06 · registries, live-only behaviour', () => {
  it('a wrong gateway key is a refusal, not an empty answer', async () => {
    const adapter = new LiveFarmerRegistryAdapter({ baseUrl: 'https://gateway.test', apiKey: 'wrong', transport: gateway().transport });
    await expect(adapter.lookup('pm-kisan', 'PMK-MH-2003-11427')).rejects.toMatchObject({ problem: 'upstream-rejected' });
  });

  it('an answer without a name and district is refused rather than half-trusted', async () => {
    const odd = recorded([{ when: () => true, json: { found: true, record: { name: 'Someone' } } }]);
    await expect(new LiveFarmerRegistryAdapter({ baseUrl: 'https://g.test', apiKey: 'k', transport: odd.transport }).lookup('pm-kisan', 'PMK-MH-2003-11427')).rejects.toMatchObject({
      problem: 'bad-response',
    });
  });
});

function smsGateway() {
  return recorded([
    {
      when: (c) => c.url.hostname === 'sms.test' && c.headers['authkey'] === 'sms-key',
      json: () => ({ type: 'success', message: '3563747a6b4d3930313532' }),
    },
  ]);
}

const messengers: Array<[string, () => MessagingAdapter]> = [
  ['mock', () => new MockMessagingAdapter()],
  ['live', () => new LiveSmsMessagingAdapter({ url: 'https://sms.test/api/v5/flow', authKey: 'sms-key', templateId: 'tmpl-otp', transport: smsGateway().transport })],
];

describe.each(messengers)('ARCH-06 · MessagingAdapter contract (%s)', (_mode, make) => {
  it('sends to an Indian mobile number and returns a message id', async () => {
    const { id } = await make().send('+919876543210', 'Fasal Raksha code: 123456.', new Date('2026-09-06T06:00:00Z'));
    expect(id.length).toBeGreaterThan(0);
  });

  it('refuses a number that is not an Indian mobile', async () => {
    await expect(make().send('+15551234567', 'hello', new Date())).rejects.toMatchObject({ problem: 'upstream-rejected' });
  });
});

describe('ARCH-06 · MessagingAdapter, live-only behaviour', () => {
  it('sends under the DLT template, with the number in the gateway’s format', async () => {
    const gw = smsGateway();
    await new LiveSmsMessagingAdapter({ url: 'https://sms.test/api/v5/flow', authKey: 'sms-key', templateId: 'tmpl-otp', transport: gw.transport }).send('+919876543210', 'hi', new Date());
    expect(gw.calls[0]?.body).toEqual({ template_id: 'tmpl-otp', recipients: [{ mobiles: '919876543210', body: 'hi' }] });
  });
});
