/**
 * The file input: the camera's fallback, and the same pipeline downstream (CAM-01, CAM-02, CAM-05).
 *
 * The file is identified by its first bytes, never its name or type (§8.6). A HEIC photograph is
 * converted on the phone when its browser can decode HEIC (Safari can), and otherwise refused in
 * plain words (CAM-07): an undecodable file is never uploaded in the hope that something else
 * copes. The decode applies the EXIF orientation; the fresh canvas the worker draws it onto keeps
 * none of the EXIF, GPS included (CAM-14).
 */
import { sniffImage, SNIFF_BYTES } from '@fasal/shared';

export type OpenedFile = { ok: true; bitmap: ImageBitmap; kind: string } | { ok: false; reason: 'heic' | 'not-a-photo' | 'unreadable' };

export async function openPhotoFile(file: Blob, decode: (blob: Blob) => Promise<ImageBitmap> = (blob) => createImageBitmap(blob, { imageOrientation: 'from-image' })): Promise<OpenedFile> {
  const kind = sniffImage(new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer()));
  if (kind === 'svg' || kind === 'gif' || kind === 'unknown') return { ok: false, reason: 'not-a-photo' };
  try {
    return { ok: true, bitmap: await decode(file), kind };
  } catch {
    return { ok: false, reason: kind === 'heic' ? 'heic' : 'unreadable' };
  }
}

/** The photograph's fingerprint: the idempotency key's basis and the server's integrity check (§7.8). */
export async function contentHash(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
