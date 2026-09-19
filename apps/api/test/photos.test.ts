/**
 * §8.6 · CAM-14 — image hardening without a database: what reaches storage is a canonical JPEG
 * with no metadata, oriented, bounded; what must be refused is refused by its bytes, not its name.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { LocalPhotoStore, SignatureScanAdapter } from '../src/adapters/photos/photos.js';
import { hardenImage, IMAGE_LIMITS } from '../src/modules/photos/harden.js';

const FIXTURES = resolve(import.meta.dirname, '../../../data/fixtures/camera');
const exifPhoto = readFileSync(join(FIXTURES, 'onion-lot-exif-gps.jpg'));

/** A PNG whose header claims `width × height`, with almost nothing behind it. */
function claimedPng(width: number, height: number): Buffer {
  const chunk = (kind: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(kind, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc(64))), chunk('IEND', Buffer.alloc(0))]);
}

describe('§8.6 · hardening re-encodes, strips and bounds', () => {
  it('CAM-14 · the phone\'s EXIF (orientation 6, GPS) is applied, then gone: the server strips it a second time', async () => {
    const before = await sharp(exifPhoto).metadata();
    expect(before.orientation).toBe(6);
    expect(before.exif?.includes(Buffer.from([0x25, 0x88]))).toBe(true); // the GPS IFD pointer tag, 0x8825

    const result = await hardenImage(exifPhoto);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = await sharp(result.jpeg).metadata();
    expect(after.format).toBe('jpeg');
    expect(after.exif).toBeUndefined();
    expect(after.icc).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.orientation).toBeUndefined();
    expect(result.jpeg.includes(Buffer.from('Exif', 'latin1'))).toBe(false);
    // Stored sideways (480 × 640) with "rotate 90°": upright is landscape.
    expect([result.width, result.height]).toEqual([640, 480]);
  });

  it('downscales to a 1280 px long edge and never enlarges', async () => {
    const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 180, g: 60, b: 70 } } }).jpeg().toBuffer();
    const r = await hardenImage(big);
    expect(r.ok && [r.width, r.height]).toEqual([1280, 853]);
    const small = await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 180, g: 60, b: 70 } } }).png().toBuffer();
    const s = await hardenImage(small);
    expect(s.ok && [s.width, s.height]).toEqual([300, 200]); // PNG in, JPEG out, same size
    expect(s.ok && (await sharp(s.jpeg).metadata()).format).toBe('jpeg');
  });

  it('refuses SVG, whatever it claims to be', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="10" height="10"/></svg>');
    expect(await hardenImage(svg)).toMatchObject({ ok: false, code: 'NOT_AN_IMAGE' });
  });

  it('refuses a JPEG header glued onto something that is not a JPEG', async () => {
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#808080' } }).png().toBuffer();
    const forged = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), png]);
    const r = await hardenImage(forged);
    expect(r.ok).toBe(false);
  });

  it('refuses a decompression bomb from its header, before decoding a pixel', async () => {
    const bomb = claimedPng(50_000, 50_000);
    expect(bomb.byteLength).toBeLessThan(200);
    const started = performance.now();
    expect(await hardenImage(bomb)).toMatchObject({ ok: false, code: 'IMAGE_TOO_LARGE' });
    expect(performance.now() - started).toBeLessThan(2000);
    expect(await hardenImage(claimedPng(IMAGE_LIMITS.maxSide + 1, 10))).toMatchObject({ ok: false, code: 'IMAGE_TOO_LARGE' });
  });

  it('refuses more than 8 MB outright', async () => {
    const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(IMAGE_LIMITS.maxBytes)]);
    expect(await hardenImage(huge)).toMatchObject({ ok: false, code: 'IMAGE_TOO_LARGE' });
  });

  it('a HEIC this server cannot decode is refused with a clear code, never stored as-is', async () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic', 'latin1'), Buffer.alloc(200, 7)]);
    const r = await hardenImage(heic);
    expect(r).toMatchObject({ ok: false });
    expect(['IMAGE_UNDECODABLE', 'NOT_AN_IMAGE']).toContain(!r.ok && r.code);
  });
});

describe('§8.6 · the scan hook and the store', () => {
  it('the signature scanner flags the EICAR test file and passes a photograph', async () => {
    const scanner = new SignatureScanAdapter();
    const eicar = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*', 'latin1')]);
    expect(await scanner.scan(eicar)).toEqual({ clean: false, signature: 'EICAR-Test-File' });
    expect(await scanner.scan(exifPhoto)).toEqual({ clean: true, signature: null });
  });

  it('only a server-generated UUID can become a path: a user-supplied name never touches the disk', async () => {
    const store = new LocalPhotoStore(mkdtempSync(join(tmpdir(), 'fasal-photos-')));
    await expect(store.put('../../etc/passwd', new Uint8Array([1]))).rejects.toThrow(/UUID/);
    await expect(store.spoolWrite('photo.jpg', 0, new Uint8Array([1]))).rejects.toThrow(/UUID/);
    const key = crypto.randomUUID();
    await store.spoolWrite(key, 0, new Uint8Array([1, 2, 3]));
    await store.spoolWrite(key, 3, new Uint8Array([4, 5]));
    expect([...(await store.spoolRead(key))]).toEqual([1, 2, 3, 4, 5]);
    // A resent chunk at an earlier agreed offset overwrites, it does not duplicate.
    await store.spoolWrite(key, 3, new Uint8Array([4, 5]));
    expect([...(await store.spoolRead(key))]).toEqual([1, 2, 3, 4, 5]);
    await expect(store.spoolWrite(key, 9, new Uint8Array([1]))).rejects.toThrow(/shorter/);
  });
});
