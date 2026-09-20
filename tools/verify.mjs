#!/usr/bin/env node
/**
 * `pnpm verify` — everything CI runs, locally, in order, with each step's real output and a
 * summary table at the end. A step that cannot run is reported as FAILED, never skipped
 * silently. `--deps` adds the dependency audit (needs the network).
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const steps = [
  ['typecheck (strict)', 'pnpm', ['-r', 'run', 'typecheck']],
  ['build', 'pnpm', ['-r', 'run', 'build']],
  ['unit tests', 'pnpm', ['-r', 'run', 'test']],
  ['database tests (real PostgreSQL)', 'pnpm', ['test:db']],
  ['ml tests', 'node', ['tools/py.mjs', '-m', 'pytest', 'ml', '-q']],
  ['end-to-end: Gates A C F G H I, design, budget (Edge)', 'pnpm', ['e2e']],
  ['requirements audit', 'node', ['tools/requirements/audit.mjs']],
];
if (process.argv.includes('--deps')) steps.push(['dependency audit (high)', 'pnpm', ['audit', '--audit-level', 'high']]);

const results = [];
for (const [label, command, args] of steps) {
  console.log(`\n━━━ ${label} ━━━  ${command} ${args.join(' ')}`);
  const started = Date.now();
  const run = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  results.push({ label, ok: run.status === 0, seconds: ((Date.now() - started) / 1000).toFixed(1) });
}

console.log('\n━━━ verify summary ━━━');
for (const r of results) console.log(`${r.ok ? 'PASS  ' : 'FAILED'}  ${r.label.padEnd(36)} ${r.seconds}s`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? 'verify: PASS' : `verify: FAIL (${failed} step${failed === 1 ? '' : 's'})`);
process.exit(failed === 0 ? 0 : 1);
