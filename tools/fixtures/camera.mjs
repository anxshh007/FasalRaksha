#!/usr/bin/env node
/**
 * Camera fixtures for Gate C (PROMPT §7.7): the rendered scenes as JPEGs, and a photograph as a
 * phone writes it — stored sideways with EXIF orientation 6 and GPS coordinates (CAM-14).
 *
 *   node tools/py.mjs -m ml.vision.scenes     # renders data/fixtures/camera/png/*.png
 *   node tools/fixtures/camera.mjs            # writes data/fixtures/camera/*.jpg
 *
 * The EXIF block is written by hand, not by an imaging library, so the test knows exactly which
 * tags went in and can prove each one is gone after the phone and the server are done with it.
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const DIR = join(ROOT, 'data', 'fixtures', 'camera');
const require = createRequire(join(ROOT, 'apps', 'api', 'package.json'));
const sharp = require('sharp');

/** A little-endian TIFF block: IFD0 { Orientation, GPS pointer }, GPS IFD { lat/long refs and values }. */
export function exifSegment(orientation = 6) {
  const entries = [];
  const u16 = (v) => Buffer.from([v & 0xff, v >> 8]);
  const u32 = (v) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v);
    return b;
  };
  const rational = (parts) => Buffer.concat(parts.flatMap(([n, d]) => [u32(n), u32(d)]));
  // Layout: header(8) · IFD0 at 8 (2 entries) · GPS IFD · rational data
  const ifd0 = 8;
  const ifd0Size = 2 + 2 * 12 + 4;
  const gps = ifd0 + ifd0Size;
  const gpsSize = 2 + 4 * 12 + 4;
  const latAt = gps + gpsSize;
  const longAt = latAt + 24;
  const entry = (tag, type, count, value) => Buffer.concat([u16(tag), u16(type), u32(count), value.length === 4 ? value : Buffer.concat([value, Buffer.alloc(4 - value.length)])]);
  entries.push(
    Buffer.from('II*\0', 'latin1'),
    u32(ifd0),
    u16(2),
    entry(0x0112, 3, 1, u16(orientation)),
    entry(0x8825, 4, 1, u32(gps)),
    u32(0),
    u16(4),
    entry(0x0001, 2, 2, Buffer.from('N\0', 'latin1')),
    entry(0x0002, 5, 3, u32(latAt)),
    entry(0x0003, 2, 2, Buffer.from('E\0', 'latin1')),
    entry(0x0004, 5, 3, u32(longAt)),
    u32(0),
    rational([[19], [5], [3012]].map(([n], i) => [n, i === 2 ? 100 : 1])),
    rational([[74], [44], [2045]].map(([n], i) => [n, i === 2 ? 100 : 1])),
  );
  const tiff = Buffer.concat(entries);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  return Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([(body.length + 2) >> 8, (body.length + 2) & 0xff]), body]);
}

/** Insert an APP1 segment after SOI and any APP0 (JFIF) segment. */
export function withExif(jpeg, segment) {
  let at = 2;
  if (jpeg[at] === 0xff && jpeg[at + 1] === 0xe0) at += 2 + jpeg.readUInt16BE(at + 2);
  return Buffer.concat([jpeg.subarray(0, at), segment, jpeg.subarray(at)]);
}

async function main() {
  const png = join(DIR, 'png');
  for (const file of readdirSync(png).filter((f) => f.endsWith('.png')).sort()) {
    const jpeg = await sharp(join(png, file)).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    writeFileSync(join(DIR, file.replace(/\.png$/, '.jpg')), jpeg);
    console.log(file.replace(/\.png$/, '.jpg'), jpeg.length);
  }
  // As a phone stores a portrait shot: pixels sideways, orientation 6 says "rotate 90° clockwise".
  const sideways = await sharp(join(png, 'onion-lot.png')).rotate(-90).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  const exif = withExif(sideways, exifSegment(6));
  writeFileSync(join(DIR, 'onion-lot-exif-gps.jpg'), exif);
  console.log('onion-lot-exif-gps.jpg', exif.length);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) await main();
