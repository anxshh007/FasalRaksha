/**
 * What an image file actually is, from its first bytes (PROMPT §8.6, CAM-07). A file's name,
 * extension and declared Content-Type are claims; its magic bytes are evidence. The phone uses
 * this to catch a HEIC photograph before trying to prepare it, the server to refuse anything
 * that is not on the allowlist before buffering the rest of an upload.
 *
 * SVG is never accepted anywhere: it is a document that can carry script, not a photograph.
 */

export type ImageKind = 'jpeg' | 'png' | 'webp' | 'heic' | 'gif' | 'svg' | 'unknown';

/** The allowlist (§8.6): JPEG, PNG, WebP, HEIC. */
export const ACCEPTED_IMAGE_KINDS: readonly ImageKind[] = ['jpeg', 'png', 'webp', 'heic'];

/** Enough of the head of a file to decide. */
export const SNIFF_BYTES = 32;

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

function ascii(bytes: Uint8Array, from: number, to: number): string {
  let out = '';
  for (let i = from; i < to && i < bytes.length; i++) out += String.fromCharCode(bytes[i]!);
  return out;
}

export function sniffImage(head: Uint8Array): ImageKind {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (head.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => head[i] === b)) return 'png';
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return 'webp';
  if (ascii(head, 4, 8) === 'ftyp' && HEIC_BRANDS.has(ascii(head, 8, 12))) return 'heic';
  if (ascii(head, 0, 4) === 'GIF8') return 'gif';
  // Text that opens like XML or SVG, after an optional byte-order mark and whitespace.
  let i = head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0;
  while (i < head.length && (head[i] === 0x20 || head[i] === 0x09 || head[i] === 0x0a || head[i] === 0x0d)) i++;
  const text = ascii(head, i, i + 5).toLowerCase();
  if (text.startsWith('<?xml') || text.startsWith('<svg') || text.startsWith('<!doc')) return 'svg';
  return 'unknown';
}

export function isAcceptedImage(kind: ImageKind): boolean {
  return ACCEPTED_IMAGE_KINDS.includes(kind);
}
