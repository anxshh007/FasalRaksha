import { resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
export const MIGRATIONS_DIR = resolve(REPO_ROOT, 'infra/migrations');
export const ENV_FILE = resolve(REPO_ROOT, '.env');
export const LOCAL_PG_DIR = resolve(REPO_ROOT, '.pgdata');
