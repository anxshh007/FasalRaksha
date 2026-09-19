/**
 * Is the server reachable right now? Measured, never inferred (V-2 lesson: `navigator.onLine` is
 * true behind a captive portal, and a cached 200 looks like a live one). A probe is a real round
 * trip to /api/health, which is `no-store` on the server and bypasses the service worker's
 * caches. The field-mode strip shows the answer and when the server was last reached.
 */
import { store } from './db.js';
import { request } from './http.js';

export interface Reachability {
  reachable: boolean;
  checkedAt: number;
  /** Epoch ms of the last successful probe, from the device store; null if never. */
  lastReachedAt: number | null;
}

const LAST_REACHED = 'lastReachedAt';

export async function probe(now = Date.now(), timeoutMs = 3_000): Promise<Reachability> {
  const health = await request<{ ok: boolean }>('/api/health', { auth: false, timeoutMs });
  const reachable = health.kind === 'ok';
  if (reachable) await store().settings.put({ key: LAST_REACHED, value: now });
  const last = (await store().settings.get(LAST_REACHED))?.value;
  return { reachable, checkedAt: now, lastReachedAt: typeof last === 'number' ? last : null };
}

/** The effective network type, when the browser reports it (Chrome on Android does). */
export function effectiveType(): string | null {
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
  return connection?.effectiveType ?? null;
}
