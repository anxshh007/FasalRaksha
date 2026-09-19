/**
 * CAM-01 … CAM-13 on the device side, without a camera: the grader's loader and every way it
 * degrades (CAM-09), the burst and its memory ladder (CAM-08), the outcomes that keep or refuse a
 * photograph (CAM-10, CAM-11), the camera's constraint ladder and permission reading (CAM-01 …
 * CAM-05), the file input's sniffing (CAM-07), and resumable, idempotent photo uploads through the
 * outbox (CAM-12, CAM-13). The same paths are walked in a real browser by e2e/gate-c.spec.ts.
 */
import { createHash } from 'node:crypto';

import type { CapturedView, OutboxEntry } from '@fasal/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DeviceStore, store, useStore } from '../offline/db';
import { setAccessToken } from '../offline/http';
import { drain, enqueue } from '../offline/outbox';
import { CHUNK_BYTES, photoKey } from '../offline/photos';
import { capture, type BurstDeps } from './capture';
import { openPhotoFile } from './file';
import { CONSTRAINT_LADDER, openCamera, type CameraEnv } from './media';
import { WorkerFault } from './protocol';
import { loadGrader, modelFor, MODEL_VERSION, type BytesCache, type LoaderDeps } from './runtime';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

// ── the grader's loader (CAM-09) ───────────────────────────────────────────────────────────

const ENGINE = new Uint8Array([0, 97, 115, 109, 1, 2, 3]);
const runtime = { path: '/ort/engine.wasm', sha256: sha(ENGINE) };

function memoryCache(): BytesCache & { map: Map<string, Uint8Array> } {
  const map = new Map<string, Uint8Array>();
  return { map, get: async (k) => map.get(k) ?? null, put: async (k, b) => void map.set(k, b), delete: async (k) => void map.delete(k) };
}

function loader(files: Record<string, Uint8Array | 'fail'>, over: Partial<LoaderDeps> = {}): LoaderDeps & { fetched: string[] } {
  const fetched: string[] = [];
  return {
    fetched,
    fetchBytes: async (path) => {
      fetched.push(path);
      const file = files[path];
      if (file === undefined || file === 'fail') throw new TypeError('Failed to fetch');
      return file;
    },
    cache: memoryCache(),
    sha256: async (b) => sha(b),
    simd: () => true,
    createSession: async () => ({ run: async (_input, n) => Array.from({ length: n }, () => [0.1, 0.8, 0.1]) }),
    ...over,
  };
}

describe('CAM-09 · the grader loads lazily and verified, or is honestly absent', () => {
  const model = modelFor('tuber_bulb')!;
  const MODEL = new Uint8Array([8, 8, 8]);
  const pinnedModel = { ...model, sha256: sha(MODEL) };

  it('every family with a model is pinned by the manifest; a crop without one is photographed only', async () => {
    expect(modelFor('tuber_bulb')?.path).toMatch(/^\/models\/tuber_bulb\.[0-9a-f]{8}\.onnx$/);
    expect(MODEL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(await loadGrader(null, runtime, loader({}), null)).toEqual({ ok: false, reason: 'no-model' });
  });

  it('loads, verifies, caches, and the second time touches no network', async () => {
    const deps = loader({ [runtime.path]: ENGINE, [model.path]: MODEL });
    // The committed model's real hash would not match these stand-in bytes: pin the stand-in.
    const result = await loadGrader('tuber_bulb', runtime, deps, null, pinnedModel);
    expect(result.ok).toBe(true);
    expect(deps.fetched).toEqual([runtime.path, model.path]);
    const again = await loadGrader('tuber_bulb', runtime, { ...deps, fetchBytes: async () => Promise.reject(new TypeError('offline')) }, null, pinnedModel);
    expect(again.ok).toBe(true);
  });

  it('no WebAssembly SIMD: absent, nothing downloaded', async () => {
    const deps = loader({ [runtime.path]: ENGINE }, { simd: () => false });
    expect(await loadGrader('tuber_bulb', runtime, deps, null)).toEqual({ ok: false, reason: 'no-simd' });
    expect(deps.fetched).toEqual([]);
  });

  it('on 2G the 2.4 MB runtime is not downloaded; a cached copy is still used', async () => {
    const deps = loader({ [runtime.path]: ENGINE, [model.path]: MODEL });
    expect(await loadGrader('tuber_bulb', runtime, deps, '2g', pinnedModel)).toEqual({ ok: false, reason: 'slow-network' });
    expect(deps.fetched).toEqual([]);
    await deps.cache.put(runtime.sha256, ENGINE);
    expect((await loadGrader('tuber_bulb', runtime, deps, '2g', pinnedModel)).ok).toBe(true);
  });

  it('a failed download, bytes that do not match the pin, or a runtime that will not start: absent', async () => {
    expect(await loadGrader('tuber_bulb', runtime, loader({ [runtime.path]: 'fail' }), '4g')).toEqual({ ok: false, reason: 'network' });
    expect(await loadGrader('tuber_bulb', runtime, loader({ [runtime.path]: new Uint8Array([6, 6, 6]) }), '4g')).toEqual({ ok: false, reason: 'integrity' });
    const broken = loader({ [runtime.path]: ENGINE, [model.path]: MODEL }, { createSession: async () => Promise.reject(new Error('no wasm')) });
    expect(await loadGrader('tuber_bulb', runtime, broken, null, pinnedModel)).toEqual({ ok: false, reason: 'runtime' });
  });

  it('a corrupt cached copy is thrown away and fetched again, never run', async () => {
    const deps = loader({ [runtime.path]: ENGINE, [model.path]: MODEL });
    await deps.cache.put(runtime.sha256, new Uint8Array([1, 1, 1])); // bit rot
    expect((await loadGrader('tuber_bulb', runtime, deps, null, pinnedModel)).ok).toBe(true);
    expect(deps.fetched).toContain(runtime.path);
    expect(sha((await deps.cache.get(runtime.sha256))!)).toBe(runtime.sha256);
  });
});

// ── the burst and its ladder (CAM-08, CAM-10, CAM-11) ─────────────────────────────────────

const bitmap = () => ({ close() {}, width: 1280, height: 960 }) as unknown as ImageBitmap;
const clean = (probs: number[] | null = [0.1, 0.8, 0.1], sharpness = 0.01): CapturedView => ({ problem: null, distribution: { inDistribution: true, reason: null }, probs, sharpness });

function burstDeps(views: (CapturedView | 'memory')[], over: Partial<BurstDeps> = {}): BurstDeps & { encoded: number[]; grabs: number } {
  let i = 0;
  const encoded: number[] = [];
  const deps = {
    encoded,
    grabs: 0,
    grab: async () => {
      deps.grabs++;
      return bitmap();
    },
    view: async () => {
      const v = views[i++ % views.length];
      if (v === 'memory') throw new WorkerFault('memory', 'canvas allocation failed');
      return { id: i, view: v!, modelVersion: v!.probs === null ? null : '2026-09-19.1' };
    },
    encode: async (id: number) => {
      encoded.push(id);
      return { blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), width: 1280, height: 960 };
    },
    still: async () => ({ blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), width: 800, height: 600 }),
    wait: async () => undefined,
    gradingAvailable: () => true,
    ...over,
  };
  return deps;
}

describe('§7.4 · CAM-08 · one press, five views, and a ladder down when memory runs out', () => {
  it('five clean views: a grade, a band, the model version, and the sharpest frame kept', async () => {
    const deps = burstDeps([clean([0.1, 0.8, 0.1], 0.01), clean([0.1, 0.85, 0.05], 0.03), clean(), clean(), clean()]);
    const outcome = await capture(deps);
    expect(deps.grabs).toBe(5);
    expect(outcome).toMatchObject({ proposal: { kind: 'proposed', grade: 'B', band: 'high', views: 5 }, degraded: null, modelVersion: '2026-09-19.1' });
    expect(deps.encoded).toEqual([2]); // the second view was the sharpest
  });

  it('memory fails the burst: one frame instead, and the proposal can never be "high"', async () => {
    const deps = burstDeps(['memory', clean([0.9, 0.05, 0.05])]);
    const outcome = await capture(deps);
    expect(outcome).toMatchObject({ degraded: 'single-frame', proposal: { kind: 'proposed', grade: 'A', views: 1, band: 'moderate' } });
  });

  it('memory fails even one frame: a plain still, ungraded, and it says so', async () => {
    const outcome = await capture(burstDeps(['memory']));
    expect(outcome).toMatchObject({ degraded: 'photo-only', proposal: { kind: 'ungraded' }, modelVersion: null });
    expect(outcome.photo?.width).toBe(800);
  });

  it('CAM-11 · not the crop: nothing is attached', async () => {
    const ood: CapturedView = { problem: null, distribution: { inDistribution: false, reason: 'smooth-surface' }, probs: null, sharpness: 0.01 };
    const deps = burstDeps([ood]);
    const outcome = await capture(deps);
    expect(outcome.proposal).toEqual({ kind: 'out-of-distribution', best: 0 });
    expect(outcome.photo).toBeNull();
    expect(deps.encoded).toEqual([]);
  });

  it('CAM-10 · every view failed the gate: no grade, but the least-bad frame is kept', async () => {
    const dark: CapturedView = { problem: 'too-dark', distribution: { inDistribution: false, reason: 'too-little-crop' }, probs: null, sharpness: 0.001 };
    const blurred: CapturedView = { ...dark, problem: 'hold-steady', sharpness: 0.0005 };
    const deps = burstDeps([dark, dark, blurred, dark, dark]);
    const outcome = await capture(deps);
    expect(outcome.proposal).toMatchObject({ kind: 'no-usable-view', problem: 'too-dark' });
    expect(outcome.photo).not.toBeNull();
    expect(deps.encoded).toEqual([3]); // hold-steady is less severe than too-dark
  });

  it('a chosen file is one frame through the same pipeline, and a failure that is not memory is not hidden', async () => {
    const deps = burstDeps([clean([0.05, 0.15, 0.8])]);
    expect(await capture(deps, 1)).toMatchObject({ degraded: null, proposal: { kind: 'proposed', grade: 'C', views: 1 } });
    await expect(capture(burstDeps([clean()], { grab: async () => Promise.reject(new Error('camera gone')) }))).rejects.toThrow('camera gone');
  });
});

// ── the camera and the constraint ladder (CAM-01 … CAM-05) ─────────────────────────────────

function camera(errors: (string | null)[], permission: PermissionState | 'unavailable' = 'prompt', message = ''): CameraEnv & { asked: MediaStreamConstraints[] } {
  const asked: MediaStreamConstraints[] = [];
  let call = 0;
  return {
    asked,
    cameraContext: true,
    mediaDevices: {
      getUserMedia: async (constraints) => {
        asked.push(constraints!);
        const name = errors[call++] ?? null;
        if (name === null) return { getTracks: () => [] } as unknown as MediaStream;
        throw Object.assign(new Error(message || name), { name });
      },
    },
    permissions:
      permission === 'unavailable'
        ? { query: async () => Promise.reject(new TypeError('camera is not a valid permission name')) }
        : { query: async () => ({ state: permission }) as PermissionStatus },
  };
}

describe('CAM-01 … CAM-05 · a camera, or exactly why not', () => {
  it('CAM-05 · the ladder: rear at 1920, then rear, then any camera', async () => {
    const env = camera(['OverconstrainedError', 'OverconstrainedError', null]);
    const result = await openCamera(env);
    expect(result).toMatchObject({ ok: true, rung: 2 });
    expect(env.asked).toEqual([...CONSTRAINT_LADDER]);
    expect(CONSTRAINT_LADDER[0]).toEqual({ audio: false, video: { facingMode: 'environment', width: 1920 } });
  });

  it('CAM-05 · no rung satisfied: the file input', async () => {
    expect(await openCamera(camera(['OverconstrainedError', 'OverconstrainedError', 'OverconstrainedError']))).toEqual({ ok: false, failure: 'constraints' });
  });

  it('CAM-02 · denied is read from the permission state, and asked once only', async () => {
    const env = camera(['NotAllowedError'], 'denied');
    expect(await openCamera(env)).toEqual({ ok: false, failure: 'denied' });
    expect(env.asked).toHaveLength(1); // no loop down the ladder
  });

  it('CAM-03 · dismissed is not denied: the permission is still undecided', async () => {
    expect(await openCamera(camera(['NotAllowedError'], 'prompt'))).toEqual({ ok: false, failure: 'dismissed' });
    // Where the permission cannot be queried, the browser's message decides.
    expect(await openCamera(camera(['NotAllowedError'], 'unavailable', 'Permission dismissed'))).toEqual({ ok: false, failure: 'dismissed' });
    expect(await openCamera(camera(['NotAllowedError'], 'unavailable', 'Permission denied'))).toEqual({ ok: false, failure: 'denied' });
  });

  it('CAM-01 · no camera, or no camera API at all; CAM-04 · busy', async () => {
    expect(await openCamera(camera(['NotFoundError']))).toEqual({ ok: false, failure: 'no-camera' });
    expect(await openCamera({ cameraContext: true, mediaDevices: undefined, permissions: undefined })).toEqual({ ok: false, failure: 'unsupported' });
    expect(await openCamera({ ...camera([null]), cameraContext: false })).toEqual({ ok: false, failure: 'unsupported' });
    expect(await openCamera(camera(['NotReadableError']))).toEqual({ ok: false, failure: 'busy' });
  });
});

// ── the file input (CAM-07) ────────────────────────────────────────────────────────────────

describe('CAM-07 · the file input believes bytes, not names', () => {
  const heic = new Blob([new Uint8Array([0, 0, 0, 24, ...[...'ftypheic'].map((c) => c.charCodeAt(0)), 0, 0, 0, 0])], { type: 'image/jpeg' });
  const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], { type: 'image/heic' });
  const svg = new Blob(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], { type: 'image/png' });
  const ok = async () => ({ width: 10, height: 10 }) as unknown as ImageBitmap;
  const fail = async () => Promise.reject(new DOMException('The source image could not be decoded.', 'InvalidStateError'));

  it('a HEIC this browser cannot decode is refused as HEIC, whatever its declared type', async () => {
    expect(await openPhotoFile(heic, fail)).toEqual({ ok: false, reason: 'heic' });
  });

  it('a HEIC the browser can decode (Safari) is converted on the phone', async () => {
    expect(await openPhotoFile(heic, ok)).toMatchObject({ ok: true, kind: 'heic' });
  });

  it('SVG and unknown files are not photographs; an undecodable JPEG is unreadable', async () => {
    expect(await openPhotoFile(svg, ok)).toEqual({ ok: false, reason: 'not-a-photo' });
    expect(await openPhotoFile(new Blob(['hello']), ok)).toEqual({ ok: false, reason: 'not-a-photo' });
    expect(await openPhotoFile(jpeg, fail)).toEqual({ ok: false, reason: 'unreadable' });
    expect(await openPhotoFile(jpeg, ok)).toMatchObject({ ok: true, kind: 'jpeg' });
  });
});

// ── resumable, idempotent uploads through the outbox (CAM-12, CAM-13) ──────────────────────

const USER = '22222222-2222-4222-8222-222222222222';

interface PhotoServer {
  up: boolean;
  received: Uint8Array;
  declared: number;
  stored: boolean;
  /** Drop the connection after this many chunk requests. */
  dropAfter: number | null;
  chunkRequests: number;
  opens: number;
  listingKnown: boolean;
}

let server: PhotoServer;
const realFetch = globalThis.fetch;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function photoFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
  if (!server.up) throw new TypeError('Failed to fetch');
  if (url === '/api/photos/uploads' && init?.method === 'POST') {
    server.opens++;
    if (!server.listingKnown) return json(409, { error: { code: 'LISTING_NOT_YET_RECEIVED', message: 'not yet' } });
    const body = JSON.parse(String(init.body)) as { byteLength: number };
    server.declared = body.byteLength;
    return json(200, server.stored ? { status: 'stored', uploadId: 'u1', photoId: 'p1', width: 1280, height: 960 } : { status: 'open', uploadId: 'u1', offset: server.received.byteLength, byteLength: body.byteLength });
  }
  if (url === '/api/photos/uploads/u1' && init?.method === 'PUT') {
    server.chunkRequests++;
    if (server.dropAfter !== null && server.chunkRequests > server.dropAfter) {
      server.up = false;
      throw new TypeError('Failed to fetch');
    }
    const offset = Number(new Headers(init.headers).get('upload-offset'));
    if (offset !== server.received.byteLength) return json(409, { error: { code: 'UPLOAD_OFFSET_MISMATCH', message: 'offset' } });
    const piece = new Uint8Array(await (init.body as Blob).arrayBuffer());
    const next = new Uint8Array(server.received.byteLength + piece.byteLength);
    next.set(server.received);
    next.set(piece, server.received.byteLength);
    server.received = next;
    if (next.byteLength === server.declared) {
      server.stored = true;
      return json(200, { status: 'stored', uploadId: 'u1', photoId: 'p1', width: 1280, height: 960 });
    }
    return json(200, { status: 'open', uploadId: 'u1', offset: next.byteLength, byteLength: server.declared });
  }
  return json(404, { error: { code: 'NOT_FOUND', message: url } });
}

describe('CAM-12 · CAM-13 · a photograph waits on the phone, then goes in resumable pieces', () => {
  const bytes = new Uint8Array(CHUNK_BYTES * 3 + 1234).map((_, i) => (i * 31) % 251);
  const hash = sha(bytes);
  const key = photoKey('listing-abcdef12', hash);
  const entry: OutboxEntry = { kind: 'photo.upload', idempotencyKey: key, createdAt: '2026-09-19T08:00:00.000Z', attempts: 0, listingClientId: 'listing-abcdef12', contentHash: hash, blobKey: key, byteLength: bytes.byteLength, proposal: { grade: 'B', band: 'moderate', views: 4, modelVersion: '2026-09-19.1' } };

  beforeEach(async () => {
    useStore(new DeviceStore(`camera-test-${Math.random()}`));
    setAccessToken('token');
    server = { up: true, received: new Uint8Array(), declared: 0, stored: false, dropAfter: null, chunkRequests: 0, opens: 0, listingKnown: true };
    globalThis.fetch = photoFetch as typeof fetch;
    await store().photos.put({ key, userId: USER, listingClientId: 'listing-abcdef12', blob: new Blob([bytes], { type: 'image/jpeg' }), width: 1280, height: 960, byteLength: bytes.byteLength, contentHash: hash, sentBytes: 0, createdAt: 0 });
    await enqueue(entry, USER, 0);
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    setAccessToken(null);
  });

  it('CAM-12 · with no network, the photo stays queued as a Blob on the phone', async () => {
    server.up = false;
    expect(await drain(USER, { now: 1 })).toMatchObject({ sent: 0, stoppedBecause: 'unreachable' });
    expect((await store().outbox.get(key))?.state).toBe('queued');
    expect((await store().photos.get(key))?.blob.size).toBe(bytes.byteLength);
  });

  it('CAM-13 · a connection dropped mid-photo resumes from the server\'s offset; the bytes arrive exactly once', async () => {
    server.dropAfter = 2;
    expect(await drain(USER, { now: 1 })).toMatchObject({ stoppedBecause: 'unreachable' });
    expect(server.received.byteLength).toBe(2 * CHUNK_BYTES);
    expect((await store().photos.get(key))?.sentBytes).toBe(2 * CHUNK_BYTES); // visible as "sending"
    server.up = true;
    server.dropAfter = null;
    expect(await drain(USER, { now: 2 })).toMatchObject({ sent: 1 });
    expect(sha(server.received)).toBe(hash);
    expect((await store().outbox.get(key))?.state).toBe('sent');
    expect((await store().photos.get(key))?.sentBytes).toBe(bytes.byteLength);
  });

  it('a photo whose listing the server has not seen yet waits and retries; it is never refused for that', async () => {
    server.listingKnown = false;
    expect(await drain(USER, { now: 1 })).toMatchObject({ retrying: 1 });
    expect((await store().outbox.get(key))?.state).toBe('retrying');
  });

  it('a photograph already stored is not sent again', async () => {
    server.stored = true;
    expect(await drain(USER, { now: 1 })).toMatchObject({ sent: 1 });
    expect(server.chunkRequests).toBe(0);
  });
});
