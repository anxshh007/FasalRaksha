/**
 * Photograph uploads: resumable, idempotent, hardened (PROMPT §7.7 CAM-12/13, §7.8, §8.6).
 *
 *   POST /api/photos/uploads          open, or reopen, the session for (listing, content hash).
 *                                     Answers how many bytes already arrived, so a phone that
 *                                     lost its connection mid-photo resumes where it stopped,
 *                                     and a phone that retries a finished photo is told it is
 *                                     stored: never a second copy.
 *   PUT  /api/photos/uploads/:id      append one chunk at the agreed offset. The first chunk's
 *                                     magic bytes are checked before anything else is taken, the
 *                                     declared size (≤ 8 MB) is enforced as bytes arrive, and the
 *                                     last chunk triggers verification, the virus-scan hook,
 *                                     hardening and storage.
 *   GET  /api/photos/:storageKey      only through a short-lived URL signed for one viewer
 *                                     (security/signed-url.ts), as an attachment, nosniff.
 *
 * Per account: at most 30 upload sessions an hour and 200 stored photographs; per listing, 5.
 * The grader's proposal, if any, travels with the photo and is kept beside it (§7.6).
 */
import { createHash } from 'node:crypto';

import { isAcceptedImage, sniffImage, SNIFF_BYTES } from '@fasal/shared';
import type { PoolClient } from 'pg';
import { z } from 'zod';

import type { PhotoStore, ScanAdapter } from '../../adapters/photos/photos.js';
import { withActor, type Actor, type Database } from '../../db/actor.js';
import { DomainError } from '../../http/errors.js';
import type { Logger } from '../../log/logger.js';
import type { KeyRing } from '../../security/keys.js';
import { verifyPhotoUrl } from '../../security/signed-url.js';
import { hardenImage, IMAGE_LIMITS, type HardeningRefusal } from './harden.js';

export const PHOTO_LIMITS = {
  /** Largest chunk one request may carry. */
  chunkBytes: 256 * 1024,
  perListing: 5,
  perAccount: 200,
  sessionsPerHour: 30,
} as const;

export interface PhotoDeps {
  db: Database;
  store: PhotoStore;
  scanner: ScanAdapter;
  keys: KeyRing;
  now: () => Date;
  log: Logger;
}

const Proposal = z
  .object({
    grade: z.enum(['A', 'B', 'C']),
    band: z.enum(['high', 'moderate', 'low']),
    views: z.number().int().min(1).max(5),
    modelVersion: z.string().regex(/^[0-9A-Za-z.-]{1,40}$/),
  })
  .strict();

export const OpenUploadBody = z
  .object({
    listingClientId: z.string().min(8).max(64),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    byteLength: z.number().int().min(1).max(IMAGE_LIMITS.maxBytes),
    proposal: Proposal.nullable().default(null),
  })
  .strict();

export type UploadState =
  | { status: 'open'; uploadId: string; offset: number; byteLength: number }
  | { status: 'stored'; uploadId: string; photoId: string; width: number; height: number };

const REFUSALS: Readonly<Record<HardeningRefusal | 'HASH_MISMATCH' | 'REFUSED_BY_SCAN', { status: number; message: string }>> = {
  NOT_AN_IMAGE: { status: 415, message: 'This file is not a photograph the service accepts (JPEG, PNG, WebP or HEIC).' },
  IMAGE_TOO_LARGE: { status: 413, message: 'This photograph is too large. Take it again with the camera in the app.' },
  IMAGE_UNDECODABLE: { status: 415, message: 'This photograph could not be opened. Take it again with the camera in the app.' },
  HASH_MISMATCH: { status: 422, message: 'The photograph arrived damaged. Take it again.' },
  REFUSED_BY_SCAN: { status: 422, message: 'This file was refused.' },
};

function refuse(code: keyof typeof REFUSALS): never {
  const r = REFUSALS[code];
  throw new DomainError(r.status, code, r.message);
}

function farmerOnly(actor: Actor): void {
  if (actor.role !== 'farmer') throw new DomainError(403, 'FARMERS_ONLY', 'Only a farmer adds photographs to a listing.');
}

interface UploadRow {
  id: string;
  listing_id: string;
  content_hash: string;
  declared_bytes: number;
  received_bytes: number;
  spool_key: string;
  proposal: z.infer<typeof Proposal> | null;
  status: 'open' | 'stored' | 'refused';
  refusal: string | null;
  photo_id: string | null;
}

async function storedState(client: PoolClient, row: UploadRow): Promise<UploadState> {
  const photo = await client.query<{ width: number; height: number }>('SELECT width, height FROM app.listing_photos WHERE id = $1', [row.photo_id]);
  return { status: 'stored', uploadId: row.id, photoId: row.photo_id ?? '', width: photo.rows[0]?.width ?? 0, height: photo.rows[0]?.height ?? 0 };
}

function stateOf(row: UploadRow): UploadState | null {
  if (row.status === 'open') return { status: 'open', uploadId: row.id, offset: row.received_bytes, byteLength: row.declared_bytes };
  if (row.status === 'refused') refuse((row.refusal ?? 'NOT_AN_IMAGE') as keyof typeof REFUSALS);
  return null;
}

export async function openUpload(deps: PhotoDeps, actor: Actor, input: unknown): Promise<UploadState> {
  farmerOnly(actor);
  const body = OpenUploadBody.parse(input);
  return withActor(deps.db, actor, async (client) => {
    const listing = await client.query<{ id: string }>('SELECT id FROM app.listings WHERE farmer_id = $1 AND client_id = $2', [actor.userId, body.listingClientId]);
    const listingId = listing.rows[0]?.id;
    if (listingId === undefined) throw new DomainError(409, 'LISTING_NOT_YET_RECEIVED', 'The listing this photograph belongs to has not reached the server yet.');

    const existing = await client.query<UploadRow>('SELECT * FROM app.photo_uploads WHERE farmer_id = $1 AND listing_id = $2 AND content_hash = $3', [actor.userId, listingId, body.contentHash]);
    const found = existing.rows[0];
    if (found !== undefined) {
      if (found.declared_bytes !== body.byteLength) throw new DomainError(409, 'UPLOAD_CONFLICT', 'A photograph with this fingerprint was announced with a different size.');
      return stateOf(found) ?? storedState(client, found);
    }

    const counts = await client.query<{ hour: string; listing: string; stored: string }>(
      `SELECT (SELECT count(*) FROM app.photo_uploads WHERE farmer_id = $1 AND created_at > now() - interval '1 hour') AS hour,
              (SELECT count(*) FROM app.photo_uploads WHERE listing_id = $2 AND status <> 'refused') AS listing,
              (SELECT count(*) FROM app.listing_photos WHERE farmer_id = $1) AS stored`,
      [actor.userId, listingId],
    );
    const c = counts.rows[0];
    if (Number(c?.hour ?? 0) >= PHOTO_LIMITS.sessionsPerHour) throw new DomainError(429, 'PHOTO_RATE_LIMIT', 'Too many photographs this hour. The rest wait on your phone and go later.');
    if (Number(c?.listing ?? 0) >= PHOTO_LIMITS.perListing) throw new DomainError(422, 'PHOTO_LIMIT_LISTING', `A listing can have ${PHOTO_LIMITS.perListing} photographs.`);
    if (Number(c?.stored ?? 0) >= PHOTO_LIMITS.perAccount) throw new DomainError(403, 'PHOTO_QUOTA', 'This account has reached its photograph limit.');

    const inserted = await client.query<UploadRow>(
      'INSERT INTO app.photo_uploads (farmer_id, listing_id, content_hash, declared_bytes, proposal) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [actor.userId, listingId, body.contentHash, body.byteLength, body.proposal === null ? null : JSON.stringify(body.proposal)],
    );
    const row = inserted.rows[0]!;
    return { status: 'open', uploadId: row.id, offset: 0, byteLength: row.declared_bytes };
  });
}

type ChunkOutcome = { kind: 'state'; state: UploadState } | { kind: 'refused'; code: keyof typeof REFUSALS };

export async function appendChunk(deps: PhotoDeps, actor: Actor, uploadId: string, offsetHeader: unknown, bytes: unknown): Promise<UploadState> {
  farmerOnly(actor);
  if (!z.uuid().safeParse(uploadId).success) throw new DomainError(404, 'UPLOAD_NOT_FOUND', 'No such upload.');
  const offset = Number(offsetHeader);
  if (!Number.isInteger(offset) || offset < 0) throw new DomainError(422, 'UPLOAD_OFFSET_REQUIRED', 'Each piece of a photograph says where it starts (Upload-Offset).');
  if (!(bytes instanceof Buffer) || bytes.byteLength === 0) throw new DomainError(422, 'EMPTY_CHUNK', 'This piece of the photograph was empty.');

  const outcome = await withActor<ChunkOutcome>(deps.db, actor, async (client) => {
    // Row lock: two retries of the same chunk racing each other append once.
    const locked = await client.query<UploadRow>('SELECT * FROM app.photo_uploads WHERE id = $1 FOR UPDATE', [uploadId]);
    const row = locked.rows[0];
    if (row === undefined) throw new DomainError(404, 'UPLOAD_NOT_FOUND', 'No such upload.');
    if (row.status === 'stored') return { kind: 'state', state: await storedState(client, row) };
    if (row.status === 'refused') return { kind: 'refused', code: (row.refusal ?? 'NOT_AN_IMAGE') as keyof typeof REFUSALS };
    if (offset !== row.received_bytes) throw new DomainError(409, 'UPLOAD_OFFSET_MISMATCH', `The server has ${row.received_bytes} bytes of this photograph; send from there.`);
    if (row.received_bytes + bytes.byteLength > row.declared_bytes) throw new DomainError(413, 'UPLOAD_TOO_LARGE', 'More bytes arrived than the photograph was announced with.');

    const markRefused = async (code: keyof typeof REFUSALS): Promise<ChunkOutcome> => {
      await client.query("UPDATE app.photo_uploads SET status = 'refused', refusal = $2, updated_at = now() WHERE id = $1", [row.id, code]);
      await deps.store.spoolDelete(row.spool_key);
      return { kind: 'refused', code };
    };

    // The first bytes decide whether anything more is taken at all.
    if (offset === 0 && !isAcceptedImage(sniffImage(bytes.subarray(0, SNIFF_BYTES)))) return markRefused('NOT_AN_IMAGE');

    await deps.store.spoolWrite(row.spool_key, offset, bytes);
    const received = row.received_bytes + bytes.byteLength;
    await client.query('UPDATE app.photo_uploads SET received_bytes = $2, updated_at = now() WHERE id = $1', [row.id, received]);
    if (received < row.declared_bytes) return { kind: 'state', state: { status: 'open', uploadId: row.id, offset: received, byteLength: row.declared_bytes } };

    // Complete: is it what the phone hashed, is it clean, and what does it become?
    const original = await deps.store.spoolRead(row.spool_key);
    if (createHash('sha256').update(original).digest('hex') !== row.content_hash) return markRefused('HASH_MISMATCH');
    const scan = await deps.scanner.scan(original);
    if (!scan.clean) {
      deps.log.warn({ uploadId: row.id, signature: scan.signature, scanner: deps.scanner.name }, 'photo refused by scan');
      return markRefused('REFUSED_BY_SCAN');
    }
    const hardened = await hardenImage(original);
    if (!hardened.ok) {
      deps.log.info({ uploadId: row.id, code: hardened.code, detail: hardened.detail }, 'photo refused by hardening');
      return markRefused(hardened.code);
    }
    const p = row.proposal;
    const photo = await client.query<{ id: string; storage_key: string }>(
      `INSERT INTO app.listing_photos (listing_id, farmer_id, content_hash, byte_length, width, height, proposed_grade, proposal_band, proposal_views, model_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, storage_key`,
      [row.listing_id, actor.userId, row.content_hash, hardened.jpeg.byteLength, hardened.width, hardened.height, p?.grade ?? null, p?.band ?? null, p?.views ?? null, p?.modelVersion ?? null],
    );
    const stored = photo.rows[0]!;
    await deps.store.put(stored.storage_key, hardened.jpeg);
    await client.query("UPDATE app.photo_uploads SET status = 'stored', photo_id = $2, updated_at = now() WHERE id = $1", [row.id, stored.id]);
    await deps.store.spoolDelete(row.spool_key);
    return { kind: 'state', state: { status: 'stored', uploadId: row.id, photoId: stored.id, width: hardened.width, height: hardened.height } };
  });

  if (outcome.kind === 'refused') refuse(outcome.code);
  return outcome.state;
}

export interface ServedPhoto {
  bytes: Buffer;
}

/** A photograph, only through a URL signed for this viewer and still in date, and only if RLS lets them see it. */
export async function readPhoto(deps: PhotoDeps, actor: Actor, storageKey: string, query: unknown): Promise<ServedPhoto> {
  if (!z.uuid().safeParse(storageKey).success) throw new DomainError(404, 'PHOTO_NOT_FOUND', 'No such photograph.');
  const q = z.object({ v: z.string().max(64), e: z.string().max(16), s: z.string().max(64) }).parse(query);
  const verdict = verifyPhotoUrl(deps.keys, { storageKey, viewer: q.v, expires: q.e, signature: q.s }, actor.userId, Math.floor(deps.now().getTime() / 1000));
  if (!verdict.ok) {
    if (verdict.problem === 'expired') throw new DomainError(410, 'PHOTO_LINK_EXPIRED', 'This photograph link has expired. Open the listing again.');
    throw new DomainError(403, 'PHOTO_LINK_INVALID', 'This photograph link is not valid for you.');
  }
  const visible = await withActor(deps.db, actor, async (client) => (await client.query('SELECT 1 FROM app.listing_photos WHERE storage_key = $1', [storageKey])).rowCount);
  if (visible === 0) throw new DomainError(404, 'PHOTO_NOT_FOUND', 'No such photograph.');
  const bytes = await deps.store.get(storageKey);
  if (bytes === null) throw new DomainError(404, 'PHOTO_NOT_FOUND', 'No such photograph.');
  return { bytes };
}
