/**
 * Where photographs live, and what inspects them (PROMPT §8.6).
 *
 * PhotoStore: a spool for bytes still arriving, and a store for finished images. Both are keyed
 * only by server-generated UUIDs, so a user-supplied filename never touches a disk path, a URL or
 * a response. This implementation is the local disk (the demonstration and tests); an object
 * store (S3-compatible, behind the same interface) is the production swap. Images are served
 * only through short-lived signed URLs (security/signed-url.ts), never from a public bucket.
 *
 * ScanAdapter: the virus-scan hook. Re-encoding with sharp already destroys any payload riding
 * inside an image; the scan runs first, on the bytes as received, so a known-bad file is refused
 * and logged, not just neutralised. The signature scanner here recognises the EICAR test file
 * (proving the hook is wired); a ClamAV or cloud scanner implements the same interface.
 */
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function key(value: string): string {
  // Defence in depth: the database generates these, but nothing else may ever become a path.
  if (!UUID.test(value)) throw new Error('A storage key must be a server-generated UUID.');
  return value;
}

export interface PhotoStore {
  /** Write `bytes` at `offset` of the spool file for `spoolKey`. */
  spoolWrite(spoolKey: string, offset: number, bytes: Uint8Array): Promise<void>;
  spoolRead(spoolKey: string): Promise<Buffer>;
  spoolDelete(spoolKey: string): Promise<void>;
  put(storageKey: string, jpeg: Uint8Array): Promise<void>;
  get(storageKey: string): Promise<Buffer | null>;
}

export class LocalPhotoStore implements PhotoStore {
  constructor(private readonly root: string) {}

  private spoolPath(spoolKey: string) {
    return join(this.root, 'spool', key(spoolKey));
  }

  private photoPath(storageKey: string) {
    return join(this.root, 'photos', `${key(storageKey)}.jpg`);
  }

  async spoolWrite(spoolKey: string, offset: number, bytes: Uint8Array): Promise<void> {
    const path = this.spoolPath(spoolKey);
    await mkdir(join(this.root, 'spool'), { recursive: true });
    const size = await stat(path).then((s) => s.size, () => 0);
    // The database's received_bytes is the truth; a spool longer than it (a crash between the
    // write and the commit) is overwritten from the agreed offset.
    if (offset > size) throw new Error('The spool is shorter than the agreed offset.');
    const handle = await open(path, size === 0 ? 'w' : 'r+');
    try {
      await handle.write(bytes, 0, bytes.byteLength, offset);
      await handle.truncate(offset + bytes.byteLength);
    } finally {
      await handle.close();
    }
  }

  async spoolRead(spoolKey: string): Promise<Buffer> {
    return readFile(this.spoolPath(spoolKey));
  }

  async spoolDelete(spoolKey: string): Promise<void> {
    await rm(this.spoolPath(spoolKey), { force: true });
  }

  async put(storageKey: string, jpeg: Uint8Array): Promise<void> {
    await mkdir(join(this.root, 'photos'), { recursive: true });
    await writeFile(this.photoPath(storageKey), jpeg, { flag: 'wx' });
  }

  async get(storageKey: string): Promise<Buffer | null> {
    return readFile(this.photoPath(storageKey)).catch(() => null);
  }
}

export interface ScanVerdict {
  clean: boolean;
  /** What was found, for the operator log. Never shown to a farmer. */
  signature: string | null;
}

export interface ScanAdapter {
  readonly name: string;
  scan(bytes: Uint8Array): Promise<ScanVerdict>;
}

/** The EICAR anti-malware test string: harmless, and recognised by every scanner as a detection. */
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export class SignatureScanAdapter implements ScanAdapter {
  readonly name = 'signature (EICAR test file)';

  async scan(bytes: Uint8Array): Promise<ScanVerdict> {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(EICAR, 0, 'latin1') ? { clean: false, signature: 'EICAR-Test-File' } : { clean: true, signature: null };
  }
}
