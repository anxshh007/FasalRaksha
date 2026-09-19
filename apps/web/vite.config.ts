import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig, type Plugin } from 'vite';

/**
 * Writes `sw.js` with the exact list of files this build produced, and a version derived from
 * their contents. The app shell is then cached whole on install. V-2 listed its shell by hand and
 * missed the hashed assets, which the first offline reload then failed to load.
 */
function serviceWorker(): Plugin {
  let outDir = '';
  return {
    name: 'fasal-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    // After everything, public files and index.html included, has been written.
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string, prefix: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}${entry.name}/`);
          else if (!entry.name.endsWith('.map') && entry.name !== 'sw.js') files.push(`/${prefix}${entry.name}`);
        }
      };
      walk(outDir, '');
      // The grading runtime and models load only when the camera opens (PROMPT §7.3), and are
      // cached by the camera itself after an integrity check. They are never part of the shell.
      for (let i = files.length - 1; i >= 0; i--) if (/^\/(ort|models)\/|\.wasm$/.test(files[i] ?? '')) files.splice(i, 1);
      const precache = ['/', ...files.sort()];
      const fingerprint = precache.map((file) => (file === '/' ? file : `${file}:${createHash('sha256').update(readFileSync(join(outDir, file))).digest('hex')}`));
      const version = createHash('sha256').update(fingerprint.join('\n')).digest('hex').slice(0, 16);
      const source = readFileSync(resolve(import.meta.dirname, 'sw/sw.js'), 'utf8');
      writeFileSync(join(outDir, 'sw.js'), `const PRECACHE = ${JSON.stringify(precache)};\nconst VERSION = ${JSON.stringify(version)};\n${source}`);
    },
  };
}

/**
 * ONNX Runtime Web's WebAssembly engine (PROMPT §7.3), about 14 MB (2.4 MB brotli). Emitted under
 * a content-hashed name and pinned by its SHA-256, which is compiled into the app: the camera
 * fetches it lazily, checks the hash, caches it in IndexedDB and hands the verified bytes to the
 * runtime (env.wasm.wasmBinary), so the runtime itself never fetches anything.
 */
function onnxRuntime(): Plugin {
  const dist = join(dirname(createRequire(import.meta.url).resolve('onnxruntime-web/wasm')), '.');
  const file = join(dist, 'ort-wasm-simd-threaded.wasm');
  const bytes = readFileSync(file);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const path = `/ort/ort-wasm-simd-threaded.${sha256.slice(0, 8)}.wasm`;
  return {
    name: 'fasal-onnx-runtime',
    config: () => ({ define: { __ORT_WASM__: JSON.stringify({ path, sha256, bytes: bytes.byteLength }) } }),
    configureServer(server) {
      server.middlewares.use(path, (_request, response) => {
        response.setHeader('content-type', 'application/wasm');
        response.end(bytes);
      });
    },
    generateBundle(_options, bundle) {
      // The runtime's bundled build names its engine with `new URL(…, import.meta.url)`, so Vite
      // copies all 14 MB into /assets as well. Nothing loads that copy (the verified bytes are
      // handed over directly), and left in the build it would be precached: drop it.
      for (const [name, output] of Object.entries(bundle)) {
        if (output.type === 'asset' && /^assets\/ort-wasm-simd-threaded[^/]*\.wasm$/.test(name)) delete bundle[name];
      }
      this.emitFile({ type: 'asset', fileName: path.slice(1), source: bytes });
    },
  };
}

const API = process.env['FASAL_API_URL'] ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react(), onnxRuntime(), serviceWorker()],
  // Workers are ES modules so the vision worker can load the grading runtime as its own chunk.
  worker: { format: 'es' },
  resolve: {
    // Resolve @fasal/shared to its TypeScript source during development and bundling, so the
    // device runs exactly the code the tests ran — no stale dist in between.
    conditions: ['source', ...defaultClientConditions],
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': API },
  },
  preview: {
    host: '127.0.0.1',
    port: Number(process.env['FASAL_PREVIEW_PORT'] ?? 4173),
    strictPort: true,
    proxy: { '/api': API },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
