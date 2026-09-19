/**
 * ARCH-01 · `@fasal/shared` is pure.
 *
 * Constitution §3 puts every domain rule in this package so that the device, the API and the
 * three channels compute the identical number. That only holds while the package is a set of
 * pure functions: the moment one of them reads the clock, the network or storage, two callers
 * can disagree about the same inputs. So purity is checked structurally, not by review.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PKG = resolve(import.meta.dirname, '..');
const SRC = join(PKG, 'src');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(path);
  }
  return out;
}

const files = sourceFiles(SRC).map((path) => ({
  path: relative(PKG, path).split('\\').join('/'),
  // Comments are prose, not behaviour: strip them so a docstring mentioning `Date.now()`
  // cannot fail the check, and so a rule cannot hide inside one either.
  code: readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1'),
}));

describe('ARCH-01 · @fasal/shared is pure', () => {
  it('finds its own source files (guards against a vacuous pass)', () => {
    expect(files.some((f) => f.path === 'src/index.ts')).toBe(true);
  });

  it('declares zero runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as Record<string, unknown>;
    expect(pkg['dependencies'] ?? {}).toEqual({});
    expect(pkg['peerDependencies'] ?? {}).toEqual({});
    expect(pkg['optionalDependencies'] ?? {}).toEqual({});
  });

  it('imports nothing but its own relative modules', () => {
    const offences: string[] = [];
    const importRe = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    for (const f of files) {
      for (const m of f.code.matchAll(importRe)) {
        const spec = m[1] ?? m[2] ?? m[3] ?? '';
        if (!spec.startsWith('./') && !spec.startsWith('../')) offences.push(`${f.path} imports '${spec}'`);
      }
    }
    expect(offences).toEqual([]);
  });

  it('never reads the clock, randomness, the network, storage, the environment or the console', () => {
    const forbidden: ReadonlyArray<readonly [RegExp, string]> = [
      [/\bDate\.now\s*\(/, 'Date.now() — take `now` as an argument'],
      [/\bnew\s+Date\s*\(\s*\)/, 'new Date() — take `now` as an argument'],
      [/\bperformance\.now\s*\(/, 'performance.now()'],
      [/\bMath\.random\s*\(/, 'Math.random() — determinism (PROMPT §14.2)'],
      [/\bcrypto\.(getRandomValues|randomUUID)\s*\(/, 'crypto randomness'],
      [/\bfetch\s*\(/, 'fetch() — I/O'],
      [/\bXMLHttpRequest\b/, 'XMLHttpRequest — I/O'],
      [/\b(localStorage|sessionStorage|indexedDB)\b/, 'browser storage — I/O'],
      [/\bprocess\.(env|argv|cwd)\b/, 'process state'],
      [/\bconsole\.\w+\s*\(/, 'console — I/O'],
      [/\b(window|document|navigator)\./, 'DOM globals'],
      [/\bsetTimeout|setInterval\b/, 'timers'],
    ];
    const offences: string[] = [];
    for (const f of files) {
      for (const [re, why] of forbidden) {
        if (re.test(f.code)) offences.push(`${f.path}: ${why}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it('is compiled without Node or DOM type libraries', () => {
    const tsconfig = readFileSync(join(PKG, 'tsconfig.json'), 'utf8');
    expect(tsconfig).toMatch(/"types":\s*\[\s*\]/);
    expect(tsconfig).not.toMatch(/"lib":\s*\[[^\]]*DOM/i);
  });
});
