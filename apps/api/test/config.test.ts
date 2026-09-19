/** ARCH-04 · configuration is parsed with zod at boot, and no secret has a default. */
import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from '../src/config.js';

const VALID = { DATABASE_URL: 'postgres://fasal_app:s3cret-value@127.0.0.1:5432/fasal' };

describe('ARCH-04 · configuration', () => {
  it('parses a minimal valid environment and applies only non-secret defaults', () => {
    const config = loadConfig(VALID);
    expect(config).toMatchObject({ NODE_ENV: 'development', API_HOST: '127.0.0.1', API_PORT: 8787, LOG_LEVEL: 'info' });
    expect(config.CORS_ORIGINS).toEqual(['http://localhost:5173']);
  });

  it('refuses to start without DATABASE_URL — the secret has no default', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL is not set/);
  });

  it('names every problem at once and never echoes a value', () => {
    try {
      loadConfig({ DATABASE_URL: 'mysql://root:hunter2@db/x', API_PORT: '99999', LOG_LEVEL: 'loud' });
      expect.unreachable('loadConfig should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const problems = (error as ConfigError).problems.join('\n');
      expect(problems).toMatch(/DATABASE_URL/);
      expect(problems).toMatch(/API_PORT/);
      expect(problems).toMatch(/LOG_LEVEL/);
      expect((error as Error).message).not.toContain('hunter2');
    }
  });

  it('parses the CORS allowlist strictly: origins only, no paths, no wildcards', () => {
    expect(loadConfig({ ...VALID, CORS_ORIGINS: 'http://localhost:5173, https://fasal.example.in' }).CORS_ORIGINS).toEqual([
      'http://localhost:5173',
      'https://fasal.example.in',
    ]);
    expect(() => loadConfig({ ...VALID, CORS_ORIGINS: '*' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...VALID, CORS_ORIGINS: 'https://fasal.example.in/app' })).toThrow(ConfigError);
  });
});

describe('ARCH-04 · only .env.example is committed', () => {
  it('.gitignore excludes every .env except .env.example', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const ignore = readFileSync(resolve(import.meta.dirname, '../../../.gitignore'), 'utf8');
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).toMatch(/^\.env\.\*$/m);
    expect(ignore).toMatch(/^!\.env\.example$/m);
  });
});
