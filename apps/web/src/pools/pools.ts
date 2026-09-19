/**
 * Group sales on the phone (PROMPT §6.6; FR-09).
 *
 * A consignment is the one thing in this build a farmer cannot do offline: joining changes what
 * another buyer is promised, and two phones joining the same last place with no network would
 * both be told yes. So joining and leaving need a network and say so, while what the phone
 * already knows — the consignments your lots are in — is kept in the device store and shown
 * offline like everything else.
 */
import { store, type StoredPool } from '../offline/db.js';
import { request, type HttpResult } from '../offline/http.js';

export interface ConsignmentView {
  id: string;
  status: 'forming' | 'cleared' | 'dealt' | 'closed';
  crop: string;
  district: string;
  coordinator: { id: string; name: string; district: string } | null;
  buyer: { id: string; name: string; place: string };
  price: { amount: number; unit: string };
  needKg: number;
  maxKg: number;
  totalKg: number;
  shortfallKg: number;
  contributors: number;
  mine: { listingId: string; listingClientId: string; contributedKg: number; share: number } | null;
  gradeRange: { lowest: 'A' | 'B' | 'C'; highest: 'A' | 'B' | 'C' } | null;
  includesUngraded: boolean;
  window: { from: string; until: string } | null;
}

/** The consignments this farmer's lots are in, refreshed when the server is reachable. */
export async function refreshMyPools(userId: string, now = Date.now()): Promise<'refreshed' | 'kept'> {
  const answer = await request<{ pools: ConsignmentView[] }>('/api/pools/mine');
  if (answer.kind !== 'ok') return 'kept';
  const db = store();
  const rows: StoredPool[] = answer.body.pools.map((pool) => ({ id: pool.id, userId, listingClientId: null, fetchedAt: now, pool }));
  await db.transaction('rw', db.pools, async () => {
    await db.pools.where('userId').equals(userId).delete();
    if (rows.length > 0) await db.pools.bulkPut(rows);
  });
  return 'refreshed';
}

export async function storedPools(userId: string): Promise<ConsignmentView[]> {
  return (await store().pools.where('userId').equals(userId).toArray()).map((row) => row.pool);
}

/** Consignments this lot could join. Needs the network: it is the server's answer, not the phone's. */
export async function openConsignments(listingClientId: string): Promise<HttpResult<{ pools: ConsignmentView[] }>> {
  return request<{ pools: ConsignmentView[] }>(`/api/pools/open?listing=${encodeURIComponent(listingClientId)}`);
}

export function joinConsignment(poolId: string, listingClientId: string): Promise<HttpResult<ConsignmentView>> {
  return request<ConsignmentView>(`/api/pools/${poolId}/join`, { method: 'POST', body: { listingClientId } });
}

export function leaveConsignment(poolId: string, listingClientId: string): Promise<HttpResult<ConsignmentView>> {
  return request<ConsignmentView>(`/api/pools/${poolId}/leave`, { method: 'POST', body: { listingClientId } });
}
