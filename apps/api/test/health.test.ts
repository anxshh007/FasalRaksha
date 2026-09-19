/** The health route reports measured reachability and can never be answered from a cache. */
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/http/app.js';
import { createLogger } from '../src/log/logger.js';

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
