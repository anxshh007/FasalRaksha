/**
 * A recorded-response transport for the Live adapters: each route answers with a body in the
 * upstream's real shape, and every call is kept so a test can assert the *request* the adapter
 * sent (URL, headers, body) — that it speaks the documented protocol, not just that it parses.
 * An unexpected request fails loudly instead of being answered.
 */
import type { Transport } from '../../../src/adapters/http.js';

export interface RecordedCall {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Json = string | number | boolean | null | object;

export interface Route {
  when: (call: RecordedCall) => boolean;
  status?: number;
  json: ((call: RecordedCall) => unknown) | Json;
}

export interface RecordedTransport {
  transport: Transport;
  calls: RecordedCall[];
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const h = init?.headers;
  if (h instanceof Headers) h.forEach((v, k) => (out[k.toLowerCase()] = v));
  else if (Array.isArray(h)) for (const [k, v] of h) out[String(k).toLowerCase()] = String(v);
  else if (h !== undefined) for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v);
  return out;
}

export function recorded(routes: readonly Route[]): RecordedTransport {
  const calls: RecordedCall[] = [];
  const transport = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    let body: unknown = undefined;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: RecordedCall = { url, method: init?.method ?? 'GET', headers: headersOf(init), body };
    calls.push(call);
    const route = routes.find((r) => r.when(call));
    if (route === undefined) throw new Error(`Unexpected request in contract test: ${call.method} ${url.toString()}`);
    const payload = typeof route.json === 'function' ? (route.json as (c: RecordedCall) => unknown)(call) : route.json;
    return new Response(JSON.stringify(payload), { status: route.status ?? 200, headers: { 'content-type': 'application/json', 'request-id': 'req_recorded' } });
  }) as Transport;
  return { transport, calls };
}
