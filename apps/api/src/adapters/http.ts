/**
 * What every Live adapter shares: an injectable transport (so the contract suite can replay
 * recorded responses in the upstream's real shape), a hard timeout (a farmer's request never
 * waits on a slow government server), and one error type whose message is a domain explanation.
 */

/** The subset of `fetch` the adapters use. Production passes the global `fetch`. */
export type Transport = (input: string, init?: RequestInit) => Promise<Response>;

export type AdapterProblem = 'upstream-unavailable' | 'upstream-rejected' | 'bad-response' | 'not-configured';

export class AdapterError extends Error {
  readonly adapter: string;
  readonly problem: AdapterProblem;

  constructor(adapter: string, problem: AdapterProblem, message: string) {
    super(message);
    this.name = 'AdapterError';
    this.adapter = adapter;
    this.problem = problem;
  }
}

export interface JsonRequest {
  adapter: string;
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

/** Fetch JSON, mapping every failure mode to an AdapterError the caller can explain. */
export async function fetchJson(transport: Transport, request: JsonRequest): Promise<unknown> {
  let response: Response;
  try {
    const init: RequestInit = {
      method: request.method ?? 'GET',
      headers: { accept: 'application/json', ...(request.body === undefined ? {} : { 'content-type': 'application/json' }), ...request.headers },
      signal: AbortSignal.timeout(request.timeoutMs ?? 8_000),
    };
    if (request.body !== undefined) init.body = JSON.stringify(request.body);
    response = await transport(request.url, init);
  } catch {
    throw new AdapterError(request.adapter, 'upstream-unavailable', `${request.adapter} could not be reached.`);
  }
  if (response.status >= 500) throw new AdapterError(request.adapter, 'upstream-unavailable', `${request.adapter} is not responding properly right now.`);
  if (response.status >= 400) throw new AdapterError(request.adapter, 'upstream-rejected', `${request.adapter} refused the request (${response.status}).`);
  try {
    return await response.json();
  } catch {
    throw new AdapterError(request.adapter, 'bad-response', `${request.adapter} returned something that is not JSON.`);
  }
}

/** A tiny deterministic PRNG (mulberry32) for mocks: the same inputs always give the same world. */
export function seededRandom(seedText: string): () => number {
  let seed = 2166136261;
  for (let i = 0; i < seedText.length; i++) seed = Math.imul(seed ^ seedText.charCodeAt(i), 16777619);
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
