/**
 * The camera's worker (PROMPT §7.1, §7.3, §7.4, §7.8). Everything that touches pixels happens
 * here, so the main thread never blocks: a blocked main thread is the commonest reason a camera
 * screen "feels broken".
 *
 *   guide    a viewfinder frame, downscaled to 256 px on an OffscreenCanvas, gated (§7.1)
 *   view     one of the burst's frames: gated, checked for distribution (§7.2), scored by the
 *            grader if it passed both and the grader is loaded. The frame is kept for encoding.
 *   encode   the chosen frame as the upload: ≤ 1280 px long edge, JPEG q 0.82, drawn fresh onto a
 *            canvas, so no EXIF (GPS included) survives (CAM-14, §7.8)
 *   discard  release every kept frame
 *
 * At most five frames are held at once, and every one is closed when it is no longer needed.
 * A failed allocation is reported as `memory`, so the page can drop to one frame and then to
 * photo only (CAM-08).
 */
import { checkDistribution, measureFrame, problemFor, QUALITY_LIMITS, type VisionFamily } from '@fasal/shared';

import { fetchBytes, hasWasmSimd, indexedDbCache, loadGrader, onnxSession, sha256Hex, type GradingSession } from './runtime';
import type { WorkerReply, WorkerRequest } from './protocol';

const scope = self as unknown as { postMessage(message: WorkerReply, transfer?: Transferable[]): void; onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null };

const MAX_KEPT = 5;
const UPLOAD_EDGE = 1280;
const UPLOAD_QUALITY = 0.82;

let family: VisionFamily | null = null;
let previousThumb: Float32Array | null = null;
let grader: GradingSession | null = null;
let graderVersion: string | null = null;
const kept = new Map<number, ImageBitmap>();

class MemoryError extends Error {}

/** Canvases are reused by size and capped at three (§7.7: cap concurrent canvases). */
const canvases = new Map<string, OffscreenCanvasRenderingContext2D>();

function canvas(width: number, height: number): OffscreenCanvasRenderingContext2D {
  const key = `${width}x${height}`;
  const reused = canvases.get(key);
  if (reused !== undefined) {
    reused.clearRect(0, 0, width, height);
    return reused;
  }
  let context: OffscreenCanvasRenderingContext2D | null = null;
  try {
    context = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
  } catch {
    context = null;
  }
  if (context === null) throw new MemoryError('canvas allocation failed');
  if (canvases.size >= 3) canvases.delete(canvases.keys().next().value as string);
  canvases.set(key, context);
  return context;
}

function pixels(bitmap: ImageBitmap, longEdge: number) {
  const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas(width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  return { width, height, data: image.data };
}

/** Centre square, 224 × 224, as NCHW RGB in [0, 1]: the grader's input contract. */
function tensor(bitmap: ImageBitmap): Float32Array {
  const side = Math.min(bitmap.width, bitmap.height);
  const context = canvas(224, 224);
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 224, 224);
  const { data } = context.getImageData(0, 0, 224, 224);
  const out = new Float32Array(3 * 224 * 224);
  const plane = 224 * 224;
  for (let i = 0; i < plane; i++) {
    out[i] = (data[i * 4] ?? 0) / 255;
    out[plane + i] = (data[i * 4 + 1] ?? 0) / 255;
    out[2 * plane + i] = (data[i * 4 + 2] ?? 0) / 255;
  }
  return out;
}

function keep(id: number, bitmap: ImageBitmap) {
  kept.set(id, bitmap);
  while (kept.size > MAX_KEPT) {
    const [oldest, frame] = kept.entries().next().value as [number, ImageBitmap];
    frame.close();
    kept.delete(oldest);
  }
}

function releaseAll() {
  for (const frame of kept.values()) frame.close();
  kept.clear();
}

async function handle(message: WorkerRequest): Promise<void> {
  switch (message.type) {
    case 'configure': {
      family = message.family;
      previousThumb = null;
      grader = null;
      graderVersion = null;
      if (!message.grading) {
        scope.postMessage({ type: 'grader', status: 'absent', reason: 'no-model', version: null });
        return;
      }
      scope.postMessage({ type: 'grader', status: 'loading', reason: null, version: null });
      const result = await loadGrader(
        family,
        message.runtime,
        { fetchBytes, cache: indexedDbCache(), sha256: sha256Hex, simd: hasWasmSimd, createSession: onnxSession },
        message.effectiveType,
      );
      if (result.ok) {
        grader = result.session;
        graderVersion = result.version;
        scope.postMessage({ type: 'grader', status: 'ready', reason: null, version: result.version });
      } else {
        scope.postMessage({ type: 'grader', status: 'absent', reason: result.reason, version: null });
      }
      return;
    }
    case 'guide': {
      const { bitmap } = message;
      try {
        const frame = pixels(bitmap, QUALITY_LIMITS.analysisSide);
        const { measures, thumb } = measureFrame(frame, family, previousThumb);
        previousThumb = thumb;
        scope.postMessage({ type: 'guide', id: message.id, problem: problemFor(measures) });
      } finally {
        bitmap.close();
      }
      return;
    }
    case 'view': {
      const { bitmap } = message;
      keep(message.id, bitmap);
      // Views are a deliberate burst, not a moving viewfinder: stability was the shutter's job.
      const { measures } = measureFrame(pixels(bitmap, QUALITY_LIMITS.analysisSide), family, null);
      const problem = problemFor(measures);
      const distribution = checkDistribution(measures, family);
      let probs: number[] | null = null;
      if (grader !== null && problem === null && distribution.inDistribution) {
        probs = (await grader.run(tensor(bitmap), 1))[0] ?? null;
      }
      scope.postMessage({ type: 'view', id: message.id, view: { problem, distribution, probs, sharpness: measures.sharpness }, modelVersion: probs === null ? null : graderVersion });
      return;
    }
    case 'encode': {
      const bitmap = kept.get(message.id);
      if (bitmap === undefined) throw new Error('that frame is no longer held');
      const scale = Math.min(1, UPLOAD_EDGE / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas(width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await (context.canvas as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality: UPLOAD_QUALITY });
      releaseAll();
      scope.postMessage({ type: 'encoded', id: message.id, blob, width, height });
      return;
    }
    case 'discard':
      releaseAll();
      previousThumb = null;
      return;
  }
}

scope.onmessage = (event) => {
  const message = event.data;
  handle(message).catch((error: unknown) => {
    const memory = error instanceof MemoryError || error instanceof RangeError || (error instanceof DOMException && /memory|allocat/i.test(error.message));
    const id = 'id' in message ? message.id : -1;
    if (message.type === 'view') {
      kept.get(message.id)?.close();
      kept.delete(message.id);
    }
    scope.postMessage({ type: 'error', id, kind: memory ? 'memory' : 'failed', message: error instanceof Error ? error.message : String(error) });
  });
};
