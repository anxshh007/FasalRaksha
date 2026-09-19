/**
 * Photographs on their way to the server (PROMPT §7.7 CAM-12/13, §7.8).
 *
 * A photograph is saved on the phone as a Blob and queued in the outbox the moment the listing
 * is saved, so a listing never waits for its photo, and no network is needed to take one. It is
 * sent after its listing (the shared drain order), held back on 2G, and sent in 64 KB pieces:
 *
 *   open    POST /api/photos/uploads: the server says how many bytes it already has
 *   send    PUT  /api/photos/uploads/:id, each piece at the offset the server agreed
 *   resume  a dropped connection stops the drain; next time, "open" answers from where it got to
 *   done    the server has verified, hardened and stored it; asking again says so, never a copy
 *
 * The outbox's own backoff and per-entry state apply, so each photo's state is visible on the
 * farmer's listings screen.
 */
import type { OutboxEntry } from '@fasal/shared';

import { store } from './db.js';
import { request, type HttpResult } from './http.js';

export const CHUNK_BYTES = 64 * 1024;

type PhotoEntry = Extract<OutboxEntry, { kind: 'photo.upload' }>;

type UploadState = { status: 'open'; uploadId: string; offset: number; byteLength: number } | { status: 'stored'; uploadId: string; photoId: string; width: number; height: number };

export function photoKey(listingClientId: string, contentHash: string): string {
  return `photo-${contentHash.slice(0, 24)}-${listingClientId}`.slice(0, 128);
}

export async function sendPhoto(entry: PhotoEntry): Promise<HttpResult<Record<string, unknown>>> {
  const photo = await store().photos.get(entry.blobKey);
  if (photo === undefined) return { kind: 'rejected', status: 410, code: 'PHOTO_GONE', message: 'The photograph is no longer on this phone.' };

  const open = () =>
    request<UploadState>('/api/photos/uploads', {
      method: 'POST',
      body: { listingClientId: entry.listingClientId, contentHash: entry.contentHash, byteLength: entry.byteLength, proposal: entry.proposal },
      headers: { 'idempotency-key': entry.idempotencyKey },
    });

  let answer = await open();
  if (answer.kind !== 'ok') return answer as HttpResult<Record<string, unknown>>;
  let state = answer.body;
  let resyncs = 0;
  while (state.status === 'open') {
    const piece = photo.blob.slice(state.offset, state.offset + CHUNK_BYTES, 'application/octet-stream');
    const sent = await request<UploadState>(`/api/photos/uploads/${state.uploadId}`, { method: 'PUT', blob: piece, headers: { 'upload-offset': String(state.offset) }, timeoutMs: 30_000 });
    if (sent.kind === 'rejected' && sent.code === 'UPLOAD_OFFSET_MISMATCH' && resyncs++ < 3) {
      answer = await open(); // ask where the server is, and carry on from there
      if (answer.kind !== 'ok') return answer as HttpResult<Record<string, unknown>>;
      state = answer.body;
      continue;
    }
    if (sent.kind !== 'ok') return sent as HttpResult<Record<string, unknown>>;
    state = sent.body;
    await store().photos.update(photo.key, { sentBytes: state.status === 'open' ? state.offset : photo.byteLength });
  }
  await store().photos.update(photo.key, { sentBytes: photo.byteLength });
  return { kind: 'ok', status: 200, body: state as unknown as Record<string, unknown>, headers: new Headers() };
}
