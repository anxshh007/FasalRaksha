/**
 * Voice with no network (PROMPT §10.2): "speech recognition cannot work and we do not pretend it
 * does". The phone keeps the audio, the farmer finishes the listing through structured fields
 * straight away, and when the network returns the recording is written down by the server's
 * speech adapter to enrich the record. The listing is never held back waiting for this.
 */
import type { ListingDraft } from '@fasal/shared';

import { store, type Recording } from './db.js';
import { request } from './http.js';
import { enqueue } from './outbox.js';

export async function saveRecording(userId: string, blob: Blob, locale: string, now = Date.now()): Promise<Recording> {
  const recording: Recording = {
    id: `rec-${crypto.randomUUID()}`,
    userId,
    listingClientId: null,
    blob,
    mimeType: blob.type || 'audio/webm',
    locale,
    createdAt: now,
    status: 'saved',
    transcript: null,
  };
  await store().recordings.add(recording);
  return recording;
}

export async function attachRecording(recordingId: string, listingClientId: string): Promise<void> {
  await store().recordings.update(recordingId, { listingClientId });
}

/**
 * Send every saved recording for transcription. A recognised transcript becomes the listing's
 * note (through the outbox, like any other change) unless the farmer already wrote one.
 */
export async function transcribePending(userId: string, now = Date.now()): Promise<{ transcribed: number; unrecognised: number; stopped: boolean }> {
  const db = store();
  const pending = (await db.recordings.where('userId').equals(userId).toArray()).filter((r) => r.status === 'saved');
  let transcribed = 0;
  let unrecognised = 0;
  for (const recording of pending) {
    const answer = await request<{ status: 'transcribed' | 'unrecognised'; text: string | null }>(`/api/speech/transcribe?locale=${encodeURIComponent(recording.locale)}`, {
      method: 'POST',
      blob: new Blob([recording.blob], { type: recording.mimeType }),
      timeoutMs: 20_000,
    });
    if (answer.kind === 'unreachable') return { transcribed, unrecognised, stopped: true };
    if (answer.kind !== 'ok') continue;
    if (answer.body.status === 'transcribed' && answer.body.text !== null) {
      await db.recordings.update(recording.id, { status: 'transcribed', transcript: answer.body.text });
      transcribed++;
      if (recording.listingClientId !== null) {
        const listing = await db.listings.get(recording.listingClientId);
        if (listing !== undefined && (listing.draft.note === undefined || listing.draft.note === '')) {
          const note = answer.body.text.slice(0, 500);
          const draft: ListingDraft = { ...listing.draft, note };
          await db.listings.update(listing.clientId, { draft });
          await enqueue(
            { kind: 'listing.update', idempotencyKey: `note-${recording.id}`, createdAt: new Date(now).toISOString(), attempts: 0, listingClientId: listing.clientId, changes: { note } },
            userId,
            now,
          );
        }
      }
    } else {
      await db.recordings.update(recording.id, { status: 'unrecognised' });
      unrecognised++;
    }
  }
  return { transcribed, unrecognised, stopped: false };
}
