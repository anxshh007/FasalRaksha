/**
 * The end-to-end stack supervisor (Gate A: "the backend can be killed"). One process that
 *
 *   1. starts a throwaway PostgreSQL, applies every migration, installs a context key;
 *   2. loads the newest committed bundle release into it;
 *   3. runs the API as a *child process* on E2E_API_PORT; and
 *   4. listens on E2E_CONTROL_PORT for a test to stop and restart that child:
 *        GET  /status   → { api: 'up' | 'down', apiUrl }
 *        POST /api/stop → kill the API process and wait until its port is closed
 *        POST /api/start
 *
 * Killing the API is a real kill of a real process, not a mocked route or a flag. The database
 * keeps running, so a restart finds the farmer's session and queued writes where they were.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createTestDatabase, startCluster } from '../test/support/cluster.js';
import { latestPipelineVersion, publish } from './lib/release.js';

const API_PORT = Number(process.env['E2E_API_PORT'] ?? 8799);
const CONTROL_PORT = Number(process.env['E2E_CONTROL_PORT'] ?? 8798);
const API_DIR = resolve(import.meta.dirname, '..');
const tsxCli = createRequire(resolve(API_DIR, 'package.json')).resolve('tsx/cli');

const cluster = await startCluster();
const db = await createTestDatabase(cluster);
const version = latestPipelineVersion();
if (version === null) throw new Error('No committed bundle release under data/bundles.');
await publish(version, { ownerUrl: db.ownerUrl, env: {} });

const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'development', // one-time codes are returned to the caller: this is a test stack
  DATABASE_URL: db.appUrl,
  DB_CONTEXT_KEY: db.contextKey.toString('hex'),
  AUTH_SECRET: randomBytes(32).toString('hex'),
  API_HOST: '127.0.0.1',
  API_PORT: String(API_PORT),
  LOG_LEVEL: 'warn',
  // Each run's photographs go to a throwaway folder, not the demo's store.
  PHOTO_STORE_DIR: mkdtempSync(join(tmpdir(), 'fasal-e2e-photos-')),
};

let api: ChildProcess | null = null;

const portOpen = (port: number) =>
  new Promise<boolean>((done) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => (socket.destroy(), done(true)));
    socket.once('error', () => done(false));
  });

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('timed out');
}

async function startApi(): Promise<void> {
  if (api !== null) return;
  api = spawn(process.execPath, [tsxCli, '--conditions=source', 'src/server.ts'], { cwd: API_DIR, env, stdio: ['ignore', 'inherit', 'inherit'] });
  api.once('exit', () => {
    api = null;
  });
  await waitFor(() => portOpen(API_PORT), 60_000); // a cold start loads tsx and sharp's native image library
}

async function stopApi(): Promise<void> {
  const child = api;
  if (child === null) return;
  const exited = new Promise<void>((done) => child.once('exit', () => done()));
  child.kill('SIGKILL'); // an outage, not a graceful shutdown
  await exited;
  await waitFor(async () => !(await portOpen(API_PORT)), 10_000);
}

await startApi();

const control = createServer((req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const status = () => ({ api: api === null ? 'down' : 'up', apiUrl: `http://127.0.0.1:${API_PORT}`, release: version });
  if (req.method === 'GET' && req.url === '/status') return send(200, status());
  if (req.method === 'POST' && req.url === '/api/stop') return void stopApi().then(() => send(200, status()), (e: unknown) => send(500, { error: String(e) }));
  if (req.method === 'POST' && req.url === '/api/start') return void startApi().then(() => send(200, status()), (e: unknown) => send(500, { error: String(e) }));
  send(404, { error: 'unknown' });
});
control.listen(CONTROL_PORT, '127.0.0.1', () => {
  process.stdout.write(`E2E stack ready: API http://127.0.0.1:${API_PORT}, control http://127.0.0.1:${CONTROL_PORT}, release ${version}\n`);
});

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  control.close();
  await stopApi().catch(() => undefined);
  await db.drop().catch(() => undefined);
  await cluster.stop().catch(() => undefined);
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.stdin.on('close', () => void shutdown());
