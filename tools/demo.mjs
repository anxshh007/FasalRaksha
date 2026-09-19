#!/usr/bin/env node
/**
 * `pnpm demo` — the whole prototype on this machine, in one command:
 *
 *   1. PostgreSQL (the persistent local cluster in .pgdata), migrated, with the newest committed
 *      bundle release loaded;
 *   2. the API on http://127.0.0.1:8787 (development mode: one-time codes are shown on screen,
 *      no SMS is sent);
 *   3. the production build of the PWA, service worker and all, on http://127.0.0.1:4173.
 *
 * Open http://127.0.0.1:4173. Ctrl+C stops everything. Stop just the API (or turn the network
 * off) to see field mode: the app keeps computing from the phone's own store.
 */
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const children = [];

function run(label, command, env = {}) {
  const child = spawn(command, { cwd: ROOT, shell: true, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  const prefix = (line) => `[${label}] ${line}`;
  child.stdout.on('data', (chunk) => process.stdout.write(String(chunk).split(/\r?\n/).filter(Boolean).map(prefix).join('\n') + '\n'));
  child.stderr.on('data', (chunk) => process.stderr.write(String(chunk).split(/\r?\n/).filter(Boolean).map(prefix).join('\n') + '\n'));
  return child;
}

function waitForOutput(child, pattern, timeoutMs) {
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`timed out waiting for ${pattern}`)), timeoutMs);
    const check = (chunk) => {
      if (pattern.test(String(chunk))) {
        clearTimeout(timer);
        done();
      }
    };
    child.stdout.on('data', check);
    child.stderr.on('data', check);
    child.once('exit', (code) => fail(new Error(`exited with ${code} before ${pattern}`)));
  });
}

function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((done, fail) => {
    const attempt = () => {
      const req = request(url, (res) => {
        res.resume();
        if (res.statusCode !== undefined && res.statusCode < 500) done();
        else retry();
      });
      req.on('error', retry);
      req.end();
    };
    const retry = () => (Date.now() > deadline ? fail(new Error(`${url} did not answer`)) : setTimeout(attempt, 300));
    attempt();
  });
}

function stopAll() {
  for (const child of children) {
    if (child.pid === undefined || child.exitCode !== null) continue;
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGINT');
  }
}
process.on('SIGINT', () => {
  stopAll();
  setTimeout(() => process.exit(0), 1500);
});
process.on('SIGTERM', () => {
  stopAll();
  setTimeout(() => process.exit(0), 1500);
});

try {
  const db = run('db', 'pnpm --filter @fasal/api run db:local');
  await waitForOutput(db, /PostgreSQL is running/, 180_000);
  run('api', 'pnpm --filter @fasal/api exec tsx --conditions=source src/server.ts');
  await waitForUrl('http://127.0.0.1:8787/api/health', 60_000);
  const build = run('web', 'pnpm --filter @fasal/web exec vite build');
  await new Promise((done, fail) => build.once('exit', (code) => (code === 0 ? done() : fail(new Error('web build failed')))));
  run('web', 'pnpm --filter @fasal/web exec vite preview', { FASAL_API_URL: 'http://127.0.0.1:8787', FASAL_PREVIEW_PORT: '4173' });
  await waitForUrl('http://127.0.0.1:4173/', 60_000);
  process.stdout.write('\nFasal Raksha is running: http://127.0.0.1:4173   (API http://127.0.0.1:8787 · Ctrl+C stops everything)\n\n');
} catch (error) {
  process.stderr.write(`demo: ${error instanceof Error ? error.message : String(error)}\n`);
  stopAll();
  process.exit(1);
}
