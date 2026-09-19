#!/usr/bin/env node
/**
 * Run the repository's Python (the `.venv` created from ml/requirements.txt) with the given
 * arguments, on Windows or POSIX. Fails with an instruction rather than silently falling back
 * to whatever `python` is on PATH — a different numerical stack would produce a different
 * validation table (PROMPT §14.2).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const candidates = [join(ROOT, '.venv', 'Scripts', 'python.exe'), join(ROOT, '.venv', 'bin', 'python')];
const python = process.env.FASAL_PYTHON ?? candidates.find((p) => existsSync(p));
if (python === undefined) {
  console.error('No Python environment found. Create it with:\n  python -m venv .venv\n  .venv/Scripts/python -m pip install -r ml/requirements.txt   (Windows)\n  .venv/bin/python -m pip install -r ml/requirements.txt       (Linux/macOS)');
  process.exit(1);
}
const result = spawnSync(python, process.argv.slice(2), { cwd: ROOT, stdio: 'inherit' });
process.exit(result.status ?? 1);
