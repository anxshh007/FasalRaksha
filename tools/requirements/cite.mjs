#!/usr/bin/env node
/**
 * `node tools/requirements/cite.mjs <file.json>` — add test citations and set statuses in
 * REQUIREMENTS.csv from a small JSON patch: { "ID": { "tests": ["path"], "status": "done", "paths": { "backend_path": "..." } } }.
 * The audit (audit.mjs) then checks that every cited file really names the id.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const patch = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const text = readFileSync(resolve(ROOT, 'REQUIREMENTS.csv'), 'utf8');
const rows = [];
let row = [], field = '', quoted = false;
for (let i = 0; i < text.length; i++) {
  const c = text[i];
  if (quoted) { if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c; }
  else if (c === '"') quoted = true; else if (c === ',') { row.push(field); field = ''; }
  else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else if (c !== '\r') field += c;
}
if (field || row.length) { row.push(field); rows.push(row); }
const header = rows[0];
const col = (name) => header.indexOf(name);
let touched = 0;
for (const r of rows.slice(1)) {
  const p = patch[r[0]];
  if (!p) continue;
  touched++;
  if (p.tests) r[col('test_id')] = [...new Set([...(r[col('test_id')] ? r[col('test_id')].split(';') : []), ...p.tests])].filter(Boolean).join(';');
  if (p.status) r[col('status')] = p.status;
  for (const [k, v] of Object.entries(p.paths ?? {})) r[col(k)] = v;
}
const out = rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','));
writeFileSync(resolve(ROOT, 'REQUIREMENTS.csv'), out.join('\n') + '\n');
console.log(`updated ${touched} rows`);
