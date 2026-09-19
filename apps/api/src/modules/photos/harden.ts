/**
 * Image upload hardening (PROMPT §8.6). Every photograph that reaches storage has been:
 *
 *   sniffed     by its magic bytes, never its Content-Type or name, against the allowlist
 *               (JPEG, PNG, WebP, HEIC; SVG never);
 *   bounded     at 8 MB (the upload refuses more while it streams), and by its declared
 *               dimensions *before* any pixel is decoded: a 50 000 × 50 000 PNG of one colour is a
 *               few kilobytes on the wire and ten gigabytes in memory (decompression bomb);
 *   agreed      the decoder's own reading of the format must match the magic bytes, so a JPEG
 *               header glued onto something else is refused;
 *   re-encoded  with sharp to a canonical JPEG (1280 px long edge, q 82), which destroys any
 *               payload riding inside the original, applies the EXIF orientation, and writes no
 *               metadata at all: EXIF, GPS, XMP and ICC are stripped a second time here, because
 *               the phone's stripping is a convenience, not something to trust.
 *
 * HEIC is on the allowlist, but the prebuilt sharp has no HEVC decoder (patents), so a HEIC that
 * reaches the server is refused as undecodable, with a clear code. The phone converts HEIC
 * itself where the browser can decode it (CAM-07), so in practice the server sees JPEG.
 */
import { isAcceptedImage, sniffImage, SNIFF_BYTES, type ImageKind } from '@fasal/shared';
import sharp from 'sharp';

export const IMAGE_LIMITS = {
  maxBytes: 8 * 1024 * 1024,
  maxSide: 12_000,
  maxPixels: 40_000_000,
  longEdge: 1280,
  quality: 82,
} as const;

export type HardeningRefusal = 'NOT_AN_IMAGE' | 'IMAGE_TOO_LARGE' | 'IMAGE_UNDECODABLE';

export type Hardened = { ok: true; jpeg: Buffer; width: number; height: number } | { ok: false; code: HardeningRefusal; detail: string };

const DECODER_FORMAT: Readonly<Record<string, ImageKind>> = { jpeg: 'jpeg', png: 'png', webp: 'webp', heif: 'heic' };

export async function hardenImage(bytes: Buffer): Promise<Hardened> {
  if (bytes.byteLength > IMAGE_LIMITS.maxBytes) return { ok: false, code: 'IMAGE_TOO_LARGE', detail: `${bytes.byteLength} bytes` };
  const kind = sniffImage(bytes.subarray(0, SNIFF_BYTES));
  if (!isAcceptedImage(kind)) return { ok: false, code: 'NOT_AN_IMAGE', detail: `magic bytes read as ${kind}` };

  const options = { limitInputPixels: IMAGE_LIMITS.maxPixels, failOn: 'error' as const, sequentialRead: true };
  let width: number | undefined;
  let height: number | undefined;
  let format: string | undefined;
  try {
    // Reads the header only: no pixel is decoded yet.
    ({ width, height, format } = await sharp(bytes, { ...options, limitInputPixels: false }).metadata());
  } catch (error) {
    return { ok: false, code: 'IMAGE_UNDECODABLE', detail: error instanceof Error ? error.message : 'unreadable header' };
  }
  if (width === undefined || height === undefined || width <= 0 || height <= 0) return { ok: false, code: 'IMAGE_UNDECODABLE', detail: 'no dimensions' };
  if (width > IMAGE_LIMITS.maxSide || height > IMAGE_LIMITS.maxSide || width * height > IMAGE_LIMITS.maxPixels) {
    return { ok: false, code: 'IMAGE_TOO_LARGE', detail: `${width}×${height} declared` };
  }
  if (format === undefined || DECODER_FORMAT[format] !== kind) return { ok: false, code: 'NOT_AN_IMAGE', detail: `magic bytes say ${kind}, decoder says ${format ?? 'nothing'}` };

  try {
    const { data, info } = await sharp(bytes, options)
      .rotate() // apply EXIF orientation, then forget it
      .resize({ width: IMAGE_LIMITS.longEdge, height: IMAGE_LIMITS.longEdge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: IMAGE_LIMITS.quality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { ok: true, jpeg: data, width: info.width, height: info.height };
  } catch (error) {
    return { ok: false, code: 'IMAGE_UNDECODABLE', detail: error instanceof Error ? error.message : 'decode failed' };
  }
}
