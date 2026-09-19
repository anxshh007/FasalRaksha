#!/usr/bin/env node
/**
 * `pnpm requirements` — the traceability audit over REQUIREMENTS.csv (PROMPT §0.2).
 *
 * "A requirement with no test row is not implemented." This makes that sentence checkable:
 *
 *   - the header is exactly the contract's nine columns;
 *   - every seeded family is complete (FR-01…15, RK-1…9, GR-1…7, CAM-01…14, SEC-01…14,
 *     P1-01…12) and no id appears twice;
 *   - every status is one of planned | building | done | cut;
 *   - every test file a row cites exists and names that row's id — so a test_id cannot be
 *     filled in to make a row look covered;
 *   - a `done` row cites at least one test; a `cut` row is explained in CUTS.md;
 *   - every requirement id a test names exists in the matrix (a typo'd id covers nothing).
 *
 * `--gate-j` additionally requires every P1-* row to be `done` (PROMPT §14.3, Gate J).
 * Exits non-zero on any error. Prints the matrix summary either way.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const CSV = join(ROOT, 'REQUIREMENTS.csv');
const CUTS = join(ROOT, 'CUTS.md');
const GATE_J = process.argv.includes('--gate-j');

const HEADER = ['id', 'requirement', 'frontend_path', 'backend_path', 'shared_path', 'ml_path', 'db_table', 'test_id', 'status'];
const STATUSES = new Set(['planned', 'building', 'done', 'cut']);
const pad = (n, width) => String(n).padStart(width, '0');
const range = (prefix, from, to, width) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${width ? pad(from + i, width) : from + i}`);
const FAMILIES = {
  FR: range('FR-', 1, 15, 2),
  RK: range('RK-', 1, 9, 0),
  GR: range('GR-', 1, 7, 0),
  CAM: range('CAM-', 1, 14, 2),
  SEC: range('SEC-', 1, 14, 2),
  P1: range('P1-', 1, 12, 2),
};
const ID_PATTERN = /\b(?:FR-\d{2}|RK-\d|GR-\d|CAM-\d{2}|SEC-\d{2}|P1-\d{2}|ARCH-\d{2})\b/g;

/** RFC-4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', '.venv', '.pgdata', 'coverage', '__pycache__', 'reference'].includes(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/(\.test\.tsx?|\.spec\.tsx?|^test_.*\.py|\.e2e\.mjs)$/.test(entry)) out.push(path);
  }
  return out;
}

const errors = [];
const warnings = [];
const [header, ...records] = parseCsv(readFileSync(CSV, 'utf8'));
if (JSON.stringify(header) !== JSON.stringify(HEADER)) errors.push(`Header must be exactly: ${HEADER.join(',')}`);

const rows = new Map();
for (const [index, cells] of records.entries()) {
  if (cells.length !== HEADER.length) { errors.push(`Line ${index + 2}: ${cells.length} columns, expected ${HEADER.length}`); continue; }
  const row = Object.fromEntries(HEADER.map((key, i) => [key, cells[i].trim()]));
  if (rows.has(row.id)) errors.push(`${row.id} appears twice`);
  rows.set(row.id, row);
}

for (const [family, ids] of Object.entries(FAMILIES)) {
  const missing = ids.filter((id) => !rows.has(id));
  if (missing.length > 0) errors.push(`Family ${family} is missing ${missing.join(', ')}`);
}

const cutsText = existsSync(CUTS) ? readFileSync(CUTS, 'utf8') : '';
for (const row of rows.values()) {
  if (!STATUSES.has(row.status)) errors.push(`${row.id}: status "${row.status}" is not one of ${[...STATUSES].join(' | ')}`);
  const cited = row.test_id ? row.test_id.split(';').map((s) => s.trim()).filter(Boolean) : [];
  for (const ref of cited) {
    const file = join(ROOT, ref.split('#')[0]);
    if (!existsSync(file)) { errors.push(`${row.id}: cited test ${ref} does not exist`); continue; }
    if (!readFileSync(file, 'utf8').includes(row.id)) errors.push(`${row.id}: cited test ${ref} never names ${row.id}`);
  }
  if (row.status === 'done' && cited.length === 0) errors.push(`${row.id}: status done but no test is cited`);
  if (row.status === 'cut' && !cutsText.includes(row.id)) errors.push(`${row.id}: status cut but CUTS.md does not explain it`);
  if (GATE_J && row.id.startsWith('P1-') && row.status !== 'done') errors.push(`Gate J: ${row.id} is ${row.status}, not done`);
}

const testFiles = walk(ROOT);
const namedInTests = new Map();
for (const file of testFiles) {
  for (const id of readFileSync(file, 'utf8').match(ID_PATTERN) ?? []) {
    if (!namedInTests.has(id)) namedInTests.set(id, new Set());
    namedInTests.get(id).add(relative(ROOT, file).split('\\').join('/'));
  }
}
for (const [id, files] of namedInTests) {
  if (!rows.has(id)) errors.push(`${[...files].join(', ')} names ${id}, which is not in REQUIREMENTS.csv`);
}
for (const row of rows.values()) {
  const inTests = namedInTests.get(row.id);
  if (inTests && !row.test_id) warnings.push(`${row.id}: named by ${[...inTests].join(', ')} but test_id is empty`);
}

// ── Summary ────────────────────────────────────────────────────────────────
const byFamily = new Map();
for (const row of rows.values()) {
  const family = row.id.replace(/-\d+$/, '');
  const f = byFamily.get(family) ?? { total: 0, planned: 0, building: 0, done: 0, cut: 0, tested: 0 };
  f.total++;
  if (STATUSES.has(row.status)) f[row.status]++;
  if (row.test_id) f.tested++;
  byFamily.set(family, f);
}
const line = (cols) => cols.map((c, i) => String(c).padEnd(i === 0 ? 8 : 9)).join('');
console.log('REQUIREMENTS.csv — traceability audit');
console.log(line(['family', 'rows', 'planned', 'building', 'done', 'cut', 'tested']));
let totals = { total: 0, planned: 0, building: 0, done: 0, cut: 0, tested: 0 };
for (const [family, f] of byFamily) {
  console.log(line([family, f.total, f.planned, f.building, f.done, f.cut, f.tested]));
  totals = Object.fromEntries(Object.keys(totals).map((k) => [k, totals[k] + f[k]]));
}
console.log(line(['TOTAL', totals.total, totals.planned, totals.building, totals.done, totals.cut, totals.tested]));
console.log(`test files scanned: ${testFiles.length} · requirement ids named in tests: ${namedInTests.size}`);
for (const w of warnings) console.log(`warning  ${w}`);
for (const e of errors) console.log(`ERROR    ${e}`);
console.log(errors.length === 0 ? 'audit: PASS' : `audit: FAIL (${errors.length} error${errors.length === 1 ? '' : 's'})`);
process.exit(errors.length === 0 ? 0 : 1);
