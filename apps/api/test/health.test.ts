/** The health route reports measured reachability and can never be answered from a cache. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/http/app.js';
import { createLogger } from '../src/log/logger.js';

/** A configuration with nothing optional in it: every test below varies one thing from here. */
const base = { DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x', NODE_ENV: 'test', DB_CONTEXT_KEY: 'a'.repeat(64), AUTH_SECRET: 'b'.repeat(64) };
const quiet = () => createLogger({ level: 'silent' });

describe('GET /api/health', () => {
  it('says the database is down when there is none, and forbids caching', async () => {
    const app = buildApp({
      config: loadConfig({ DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x', NODE_ENV: 'test', DB_CONTEXT_KEY: 'a'.repeat(64), AUTH_SECRET: 'b'.repeat(64) }),
      logger: createLogger({ level: 'silent' }),
    });
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({ ok: false, service: 'fasal-api', version: '3.0.0', database: 'down' });
    await app.close();
  });
});

/**
 * Deployment shape: the phone fetches `/api/…` relatively and its refresh cookie is scoped to
 * `/api/auth`, so the app and its API must answer on one origin. `WEB_DIST_DIR` is how a single
 * process gives them one — see docs/DEPLOY.md.
 */
describe('WEB_DIST_DIR · one origin for the app and its API', () => {
  const dist = mkdtempSync(join(tmpdir(), 'fasal-web-dist-'));
  beforeAll(() => {
    mkdirSync(join(dist, 'assets'), { recursive: true });
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Fasal Raksha</title>');
    writeFileSync(join(dist, 'sw.js'), 'self.addEventListener("install", () => {});');
    writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log(1);');
  });
  afterAll(() => rmSync(dist, { recursive: true, force: true }));

  const serving = async () => {
    const app = buildApp({ config: loadConfig({ ...base, WEB_DIST_DIR: dist }), logger: quiet() });
    await app.ready();
    return app;
  };

  it('serves the app shell at the root, and at any route the app owns', async () => {
    const app = await serving();
    try {
      for (const url of ['/', '/index.html', '/anything/the/app/routes']) {
        const response = await app.inject({ method: 'GET', url });
        expect(response.statusCode, url).toBe(200);
        expect(response.body).toContain('Fasal Raksha');
        expect(response.headers['cache-control']).toContain('no-cache');
      }
    } finally {
      await app.close();
    }
  });

  it('caches hashed assets forever and never the service worker', async () => {
    const app = await serving();
    try {
      const asset = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });
      expect(asset.statusCode).toBe(200);
      expect(asset.headers['cache-control']).toContain('immutable');
      const worker = await app.inject({ method: 'GET', url: '/sw.js' });
      expect(worker.statusCode).toBe(200);
      expect(worker.headers['cache-control']).toContain('no-cache'); // a held sw.js holds the old app
    } finally {
      await app.close();
    }
  });

  it('still answers its own API, and an unknown endpoint is a refusal rather than the shell', async () => {
    const app = await serving();
    try {
      const health = await app.inject({ method: 'GET', url: '/api/health' });
      expect(health.statusCode).toBe(200);
      const missing = await app.inject({ method: 'GET', url: '/api/there-is-no-such-thing' });
      expect(missing.statusCode).toBe(404);
      expect(missing.body).not.toContain('<!doctype html>'); // never the app shell for an API path
    } finally {
      await app.close();
    }
  });

  it('serves only /api when it is not set, so another host can serve the files', async () => {
    const app = buildApp({ config: loadConfig(base), logger: quiet() });
    await app.ready();
    try {
      expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
