import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

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
      const precache = ['/', ...files.sort()];
      const fingerprint = precache.map((file) => (file === '/' ? file : `${file}:${createHash('sha256').update(readFileSync(join(outDir, file))).digest('hex')}`));
      const version = createHash('sha256').update(fingerprint.join('\n')).digest('hex').slice(0, 16);
      const source = readFileSync(resolve(import.meta.dirname, 'sw/sw.js'), 'utf8');
      writeFileSync(join(outDir, 'sw.js'), `const PRECACHE = ${JSON.stringify(precache)};\nconst VERSION = ${JSON.stringify(version)};\n${source}`);
    },
  };
}

const API = process.env['FASAL_API_URL'] ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react(), serviceWorker()],
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
