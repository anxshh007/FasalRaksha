/**
 * The one way the app talks to the API. Every call has a deadline, and every failure is
 * classified, because offline-first depends on one distinction (PROMPT §XI):
 *
 *   unreachable: no answer (no network, captive portal, API down, timeout). Keep working from
 *                the device and try again later. Never a reason to sign anyone out.
 *   rejected:    the server answered with a 4xx. It is reachable and said no, so act on it.
 *   failed:      the server answered with a 5xx. It is reachable but broken; retry later.
 *
 * `navigator.onLine` is never consulted: it reports true behind a captive portal (V-2 lesson).
 */
export type HttpResult<T> =
  | { kind: 'ok'; status: number; body: T; headers: Headers }
  | { kind: 'not-modified'; headers: Headers }
  | { kind: 'rejected'; status: number; code: string; message: string }
  | { kind: 'failed'; status: number; message: string }
  | { kind: 'unreachable'; reason: string };

export const DEFAULT_TIMEOUT_MS = 6_000;
export const CSRF_HEADER = 'x-fasal-csrf';

let accessToken: string | null = null;

/** The short-lived bearer token lives in memory only (see db.ts). */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function hasAccessToken(): boolean {
  return accessToken !== null;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT';
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Send the bearer token (default true when one is held). */
  auth?: boolean;
  /** Return the raw text instead of parsed JSON (bundles: the bytes are what is verified). */
  raw?: boolean;
  /** Send bytes as they are (a recording, a piece of a photograph), with the Blob's own content type. */
  blob?: Blob;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<HttpResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.blob !== undefined) headers['content-type'] = options.blob.type || 'application/octet-stream';
  if ((options.auth ?? true) && accessToken !== null) headers['authorization'] = `Bearer ${accessToken}`;
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.blob ?? (options.body === undefined ? null : JSON.stringify(options.body)),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error) {
    return { kind: 'unreachable', reason: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }

  // The service worker answers from its cache when the API is down and marks the answer as
  // such. A cached answer is not the server speaking.
  if (response.headers.get('x-fasal-from-cache') === '1') return { kind: 'unreachable', reason: 'cache' };
  if (response.status === 304) return { kind: 'not-modified', headers: response.headers };

  const text = await response.text().catch(() => '');
  if (response.ok) {
    try {
      return { kind: 'ok', status: response.status, body: (options.raw ? text : JSON.parse(text)) as T, headers: response.headers };
    } catch {
      return { kind: 'failed', status: response.status, message: 'The server sent something that could not be read.' };
    }
  }
  let code = 'UNKNOWN';
  let message = '';
  try {
    const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
    code = parsed.error?.code ?? code;
    message = parsed.error?.message ?? message;
  } catch {
    // A proxy's HTML error page: the API behind it is not answering.
  }
  // A gateway error from the dev proxy or a load balancer means the API itself is not there.
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    if (code === 'UNKNOWN') return { kind: 'unreachable', reason: `gateway ${response.status}` };
  }
  if (response.status >= 500) return { kind: 'failed', status: response.status, message };
  return { kind: 'rejected', status: response.status, code, message };
}
