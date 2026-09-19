/**
 * Loading the grader on the phone (PROMPT §7.3; CAM-09).
 *
 * Lazily, only when the camera opens. Two artefacts, both pinned by SHA-256 values compiled into
 * the app: ONNX Runtime Web's WebAssembly engine (about 2.4 MB compressed) and the crop family's
 * model (a few kilobytes). Each is taken from IndexedDB if a copy there still hashes correctly,
 * otherwise fetched, checked, and stored. A cached copy that no longer matches (a corrupt cache)
 * is deleted and fetched again once.
 *
 * Every way this can fail ends in the same place: photo capture works fully, and grading is
 * simply absent, with one honest line. The reasons are kept apart only for that line:
 *   no-model       this crop is photographed, never graded (no vision family)
 *   no-simd        the phone's browser lacks WebAssembly SIMD, which the runtime needs
 *   slow-network   on 2G the runtime is not downloaded; it waits for a faster connection
 *   network        the download failed
 *   integrity      what arrived does not match the pinned hash: it is never run
 *   runtime        the runtime or the model would not start
 */
import type { VisionFamily } from '@fasal/shared';

import manifest from './models.json';

export type GraderAbsence = 'no-model' | 'no-simd' | 'slow-network' | 'network' | 'integrity' | 'runtime';

export interface PinnedFile {
  path: string;
  sha256: string;
}

export interface GradingSession {
  /** `input`: n × 3 × 224 × 224 RGB in [0, 1]. Returns n rows of [A, B, C] probabilities. */
  run(input: Float32Array, n: number): Promise<number[][]>;
}

export interface BytesCache {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface LoaderDeps {
  fetchBytes(path: string): Promise<Uint8Array>;
  cache: BytesCache;
  sha256(bytes: Uint8Array): Promise<string>;
  simd(): boolean;
  createSession(runtime: Uint8Array, model: Uint8Array): Promise<GradingSession>;
}

export type LoadResult = { ok: true; session: GradingSession; version: string } | { ok: false; reason: GraderAbsence };

export const MODEL_VERSION: string = manifest.version;
const SLOW = ['slow-2g', '2g'];

export function modelFor(family: VisionFamily | null): PinnedFile | null {
  if (family === null) return null;
  const entry = (manifest.families as Record<string, { path: string; sha256: string } | undefined>)[family];
  return entry === undefined ? null : { path: entry.path, sha256: entry.sha256 };
}

/** The bytes of a pinned file, verified, from the cache or the network. */
export async function verifiedBytes(file: PinnedFile, deps: LoaderDeps, networkAllowed: boolean): Promise<Uint8Array | 'network' | 'integrity' | 'slow-network'> {
  const cached = await deps.cache.get(file.sha256).catch(() => null);
  if (cached !== null) {
    if ((await deps.sha256(cached)) === file.sha256) return cached;
    await deps.cache.delete(file.sha256).catch(() => undefined); // corrupt: never run, fetch again
  }
  if (!networkAllowed) return 'slow-network';
  let bytes: Uint8Array;
  try {
    bytes = await deps.fetchBytes(file.path);
  } catch {
    return 'network';
  }
  if ((await deps.sha256(bytes)) !== file.sha256) return 'integrity';
  await deps.cache.put(file.sha256, bytes).catch(() => undefined); // a full disk only costs a re-download
  return bytes;
}

/** `model` defaults to the family's pinned model; tests pin stand-in bytes instead. */
export async function loadGrader(family: VisionFamily | null, runtime: PinnedFile, deps: LoaderDeps, effectiveType: string | null, model: PinnedFile | null = modelFor(family)): Promise<LoadResult> {
  if (model === null) return { ok: false, reason: 'no-model' };
  if (!deps.simd()) return { ok: false, reason: 'no-simd' };
  const networkAllowed = effectiveType === null || !SLOW.includes(effectiveType);
  const engine = await verifiedBytes(runtime, deps, networkAllowed);
  if (typeof engine === 'string') return { ok: false, reason: engine };
  const weights = await verifiedBytes(model, deps, true);
  if (typeof weights === 'string') return { ok: false, reason: weights === 'slow-network' ? 'network' : weights };
  try {
    return { ok: true, session: await deps.createSession(engine, weights), version: MODEL_VERSION };
  } catch {
    return { ok: false, reason: 'runtime' };
  }
}

/** The smallest module using a SIMD instruction (v128.const / i8x16.popcnt), as feature detection. */
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

export function hasWasmSimd(): boolean {
  try {
    return typeof WebAssembly === 'object' && WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

/** A tiny IndexedDB store for verified binaries, usable inside a worker. */
export function indexedDbCache(name = 'fasal-vision'): BytesCache {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('bytes');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
    });
  const run = async <T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const request = act(db.transaction('bytes', mode).objectStore('bytes'));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
      });
    } finally {
      db.close();
    }
  };
  return {
    get: async (key) => {
      const value = await run<unknown>('readonly', (s) => s.get(key));
      return value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : null;
    },
    put: async (key, bytes) => {
      await run('readwrite', (s) => s.put(bytes, key));
    },
    delete: async (key) => {
      await run('readwrite', (s) => s.delete(key));
    },
  };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function fetchBytes(path: string): Promise<Uint8Array> {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** The real session: ONNX Runtime Web on its WebAssembly backend, fed the verified engine bytes. */
export async function onnxSession(runtimeBytes: Uint8Array, model: Uint8Array): Promise<GradingSession> {
  const ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.wasmBinary = runtimeBytes;
  ort.env.wasm.numThreads = 1; // threads need cross-origin isolation, and one core is plenty here
  ort.env.wasm.proxy = false; // already inside a worker
  const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  return {
    async run(input, n) {
      const result = await session.run({ image: new ort.Tensor('float32', input, [n, 3, 224, 224]) });
      const data = result['grade_probs']?.data as Float32Array | undefined;
      if (data === undefined) throw new Error('the model returned no grade_probs');
      return Array.from({ length: n }, (_, i) => Array.from(data.subarray(i * 3, i * 3 + 3)));
    },
  };
}
