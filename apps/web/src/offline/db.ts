/**
 * The device's own store (PROMPT §XI; P1-11 replaces Phase 1's localStorage).
 *
 * Every number a farmer screen shows is computed from these tables and nothing else. Kill the
 * API and the home screen keeps rendering *freshly computed* values from verified bundles, not
 * a cached picture of yesterday's screen (Gate A).
 *
 * What is deliberately not here: the access token (memory only, so a script injected into the
 * page cannot lift a long-lived credential from storage) and the refresh token (an httpOnly
 * cookie the page cannot read at all).
 */
import type { CropBundle, Demand, ListingDraft, OutboxEntry } from '@fasal/shared';
import Dexie, { type Table } from 'dexie';

export interface StoredBundle {
  /** `crop|district` */
  key: string;
  crop: string;
  district: string;
  version: string;
  asOf: string;
  integrity: string;
  storedAt: number;
  bundle: CropBundle;
}

export interface StoredShared {
  /** `crops`, `districts`, `msp`, `climatology/<district>` */
  name: string;
  version: string;
  integrity: string;
  storedAt: number;
  document: Record<string, unknown>;
}

export interface ManifestEntry {
  crop: string;
  district: string;
  status: 'published' | 'insufficient';
  asOf: string;
  integrity: string;
  bytes: number;
  gzipBytes: number;
}

export interface StoredManifest {
  id: 'current';
  version: string;
  asOf: string;
  dataSource: string;
  integrity: string;
  storedAt: number;
  bundles: ManifestEntry[];
  shared: { name: string; integrity: string }[];
}

export interface StoredProfile {
  id: 'me';
  userId: string;
  role: 'farmer' | 'buyer' | 'fpo' | 'officer';
  displayName: string;
  district: string | null;
  village: string | null;
  locale: string;
  verified: boolean;
  /** When the server last confirmed this profile. Offline, the app restores it and says how old it is. */
  confirmedAt: number;
}

export type QueueState = 'queued' | 'sending' | 'retrying' | 'sent' | 'rejected';

export interface QueuedEntry {
  /** The entry's idempotency key: re-queuing the same intent is a no-op, never a duplicate. */
  id: string;
  /** Whose intent this is. An entry is only ever sent under the account that created it. */
  userId: string;
  entry: OutboxEntry;
  state: QueueState;
  /** Epoch ms before which a retry is not attempted. */
  nextAttemptAt: number;
  lastError: string | null;
  updatedAt: number;
}

export interface SyncEvent {
  id?: number;
  at: number;
  kind: 'synced' | 'not-modified' | 'integrity-rejected' | 'shape-rejected' | 'unreachable' | 'server-error';
  subject: string;
  detail: string;
}

/** A listing as the farmer composed it on this phone; its journey to the server is its outbox entry. */
export interface LocalListing {
  clientId: string;
  userId: string;
  draft: ListingDraft;
  /** What the farmer said or typed, kept so a transcript can enrich it later. */
  said: string;
  createdAt: number;
}

/** Audio a farmer recorded with no network, written down on reconnection (§10.2). */
export interface Recording {
  id: string;
  userId: string;
  /** The listing it belongs to, once one was created from the same screen. */
  listingClientId: string | null;
  blob: Blob;
  mimeType: string;
  locale: string;
  createdAt: number;
  status: 'saved' | 'transcribed' | 'unrecognised';
  transcript: string | null;
}

/**
 * A photograph of a lot, kept on the phone as a Blob until the server has it (CAM-12). The bytes
 * never live in the outbox entry; the entry names this record.
 */
export interface StoredPhoto {
  /** The outbox entry's idempotency key. */
  key: string;
  userId: string;
  listingClientId: string;
  blob: Blob;
  width: number;
  height: number;
  byteLength: number;
  contentHash: string;
  /** Bytes the server has confirmed, for the per-photo state on screen. */
  sentBytes: number;
  createdAt: number;
}

/** The district's buyer demand, verified and parsed (FR-09): what the shortlist is ranked from, offline too. */
export interface StoredDemand {
  district: string;
  asOf: string;
  integrity: string;
  storedAt: number;
  demand: Demand;
}

export interface Setting {
  key: string;
  value: unknown;
}

export class DeviceStore extends Dexie {
  bundles!: Table<StoredBundle, string>;
  shared!: Table<StoredShared, string>;
  manifest!: Table<StoredManifest, string>;
  profile!: Table<StoredProfile, string>;
  outbox!: Table<QueuedEntry, string>;
  events!: Table<SyncEvent, number>;
  settings!: Table<Setting, string>;
  listings!: Table<LocalListing, string>;
  recordings!: Table<Recording, string>;
  photos!: Table<StoredPhoto, string>;
  demand!: Table<StoredDemand, string>;

  constructor(name = 'fasal-raksha') {
    super(name);
    this.version(1).stores({
      bundles: 'key, district, crop',
      shared: 'name',
      manifest: 'id',
      profile: 'id',
      outbox: 'id, userId, state, nextAttemptAt',
      events: '++id, at, kind',
      settings: 'key',
    });
    // v2 (P11): listings composed on the phone, and recordings awaiting transcription.
    this.version(2).stores({
      listings: 'clientId, userId, createdAt',
      recordings: 'id, userId, status, listingClientId',
    });
    // v3 (P12): photographs of lots, waiting for the network.
    this.version(3).stores({
      photos: 'key, userId, listingClientId',
    });
    // v4 (P13): the district's buyer demand.
    this.version(4).stores({
      demand: 'district',
    });
  }
}

let current: DeviceStore | null = null;

export function store(): DeviceStore {
  current ??= new DeviceStore();
  return current;
}

/** Tests give each case its own database. */
export function useStore(next: DeviceStore): void {
  current = next;
}

export async function recordEvent(event: Omit<SyncEvent, 'id' | 'at'>, at = Date.now()): Promise<void> {
  await store().events.add({ ...event, at });
  // The log is for Judge Mode's "offline cache status", not an archive: keep the last 200.
  const count = await store().events.count();
  if (count > 200) {
    const oldest = await store().events.orderBy('id').limit(count - 200).primaryKeys();
    await store().events.bulkDelete(oldest);
  }
}
