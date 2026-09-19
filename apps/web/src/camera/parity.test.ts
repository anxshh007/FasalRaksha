/**
 * FR-11 · §7.3 · runtime parity — the phone's own session code (runtime.ts `onnxSession`: ONNX Runtime
 * Web on WebAssembly, fed the engine bytes it would have verified) runs every committed model on
 * the golden input and must reproduce the probabilities ONNX Runtime computed in Python
 * (data/golden/vision.json, written by ml/vision/golden.py). Compared as log-probabilities, so a
 * saturated 1e-9 still pins the logits behind it.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import manifest from './models.json';
import { onnxSession } from './runtime';

const ROOT = resolve(import.meta.dirname, '../../../..');
const golden = JSON.parse(readFileSync(join(ROOT, 'data', 'golden', 'vision.json'), 'utf8')) as { modelVersion: string; gradeProbs: Record<string, number[]> };
const engine = readFileSync(join(dirname(createRequire(import.meta.url).resolve('onnxruntime-web/wasm')), 'ort-wasm-simd-threaded.wasm'));

/** The golden formula, in the same IEEE double operations and order as numpy, then float32. */
function goldenInput(): Float32Array {
  const tint = [0.85, 0.5, 0.45];
  const tri = (v: number) => Math.abs((v % 36) - 18.0) / 18.0;
  const out = new Float32Array(3 * 224 * 224);
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < 224; y++) {
      for (let x = 0; x < 224; x++) out[c * 224 * 224 + y * 224 + x] = (0.2 + 0.7 * tri(x + 5 * c) * tri(y + 3 * c)) * tint[c]!;
    }
  }
  return out;
}

describe('§7.3 · ONNX Runtime Web reproduces the pipeline\'s numbers', () => {
  it('the golden vector belongs to the committed models', () => {
    expect(golden.modelVersion).toBe(manifest.version);
    expect(Object.keys(golden.gradeProbs).sort()).toEqual(Object.keys(manifest.families).sort());
  });

  it.each(Object.entries(manifest.families))('%s', async (family, entry) => {
    const model = readFileSync(join(ROOT, 'apps', 'web', 'public', entry.path));
    const session = await onnxSession(new Uint8Array(engine), new Uint8Array(model));
    const [probs] = await session.run(goldenInput(), 1);
    const expected = golden.gradeProbs[family]!;
    expect(probs).toHaveLength(3);
    for (let k = 0; k < 3; k++) {
      const e = expected[k]!;
      if (e > 1e-30) expect(Math.abs(Math.log(probs![k]!) - Math.log(e)), `${family}[${k}]`).toBeLessThan(1e-3);
      else expect(probs![k]!).toBeLessThanOrEqual(1e-30);
    }
  }, 60_000);
});
