/**
 * P1-07 · P1-12 · P9 — the interface rules, checked on the source that ships rather than by
 * review (Constitution §7, §8; PROMPT §9.2, §9.4–§9.6, §9.10):
 *
 *   no security signalling and no emoji on a farmer screen (P1-07);
 *   no model terminology in farmer-facing copy (Constitution §8);
 *   fonts self-hosted: no Google Fonts, no external URL in the shell or styles (P1-12);
 *   no colour outside tokens.css; radius ≤ 4px (the mic pill excepted); no blur, no gradient,
 *   one shadow token; no text below the 13px floor.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const WEB = resolve(import.meta.dirname, '../..');

function files(dir: string, test: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...files(path, test));
    else if (test(entry) && !entry.includes('.test.')) out.push(path);
  }
  return out;
}

const read = (path: string) => readFileSync(path, 'utf8');
const rel = (path: string) => relative(WEB, path).split('\\').join('/');
const ui = files(join(WEB, 'src'), (n) => /\.(tsx?|css)$/.test(n));
const css = [...files(join(WEB, 'src'), (n) => n.endsWith('.css')), ...files(join(WEB, 'design'), (n) => n.endsWith('.css'))];
/** Comments are prose about the rules, not the interface: strip them before scanning. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');

// The farmer-facing copy, both languages.
const strings = read(join(WEB, 'src/i18n/strings.ts'));
const copy = [...strings.matchAll(/(mr|en): (['"])((?:\\.|(?!\2).)*)\2/g)].map((m) => ({ lang: m[1], text: m[3] ?? '' }));

describe('P1-07 · no security signalling, no emoji', () => {
  it('finds the copy it scans (guards against a vacuous pass)', () => {
    expect(copy.length).toBeGreaterThan(100);
  });

  it('no padlock, shield, "runs locally", "secure" or "verified" badge text anywhere in the interface', () => {
    const offences = ui.filter((f) => /🔒|🛡|runs locally|demo build|secure|encrypted|✅/i.test(code(read(f)))).map(rel);
    expect(offences).toEqual([]);
  });

  it('no emoji as iconography: the drawn glyph set replaces them', () => {
    const emoji = /\p{Extended_Pictographic}/u;
    const offences = [...ui.filter((f) => emoji.test(code(read(f)))).map(rel), ...copy.filter((c) => emoji.test(c.text)).map((c) => c.text)];
    expect(offences).toEqual([]);
  });
});

describe('Constitution §8 · no model terminology on a farmer screen', () => {
  it('none of model, algorithm, AI, ML, inference, prediction, confidence interval, quantile, score', () => {
    const banned = /\b(model|algorithm|AI|ML|inference|predict(ion|ed)?|confidence interval|quantile|score)\b|मॉडेल|अल्गोरिदम|एआय/i;
    expect(copy.filter((c) => banned.test(c.text)).map((c) => `${c.lang}: ${c.text}`)).toEqual([]);
  });
});

describe('P1-12 · type and assets are self-hosted', () => {
  it('no Google Fonts, no @import from the network, no external URL in the shell or the styles', () => {
    const shell = [join(WEB, 'index.html'), ...css];
    const offences = shell.filter((f) => /fonts\.googleapis|fonts\.gstatic|@import\s+url\(\s*['"]?https?:|url\(\s*['"]?https?:/i.test(code(read(f)))).map(rel);
    expect(offences).toEqual([]);
  });

  it('every @font-face is a local woff2 with font-display: swap', () => {
    const fonts = read(join(WEB, 'design/fonts.css'));
    const faces = [...fonts.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1] ?? '');
    expect(faces.length).toBeGreaterThanOrEqual(10);
    for (const face of faces) {
      expect(face).toMatch(/font-display:\s*swap/);
      expect(face).toMatch(/url\('\.\.\/node_modules\/@fontsource\/[^']+\.woff2'\)/);
      expect(face).toMatch(/unicode-range/);
    }
  });
});

describe('§9.4–§9.6 · tokens, materials and the type floor', () => {
  const styles = css.filter((f) => !f.endsWith('tokens.css'));

  it('no colour is written outside tokens.css', () => {
    const colour = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;
    const offences = [...styles, ...ui.filter((f) => !f.endsWith('.css'))].filter((f) => colour.test(code(read(f)))).map(rel);
    expect(offences).toEqual([]);
  });

  it('corner radius is at most 4px; the mic pill and round dots are the only exceptions', () => {
    const radii = styles.flatMap((f) => [...code(read(f)).matchAll(/border-radius:\s*([^;]+);/g)].map((m) => (m[1] ?? '').trim()));
    expect(radii.length).toBeGreaterThan(3);
    for (const r of radii) expect(['var(--radius)', 'var(--radius-input)', '50%', '999px', '0']).toContain(r);
  });

  it('no blur, no gradient, and the single shadow token only', () => {
    const all = styles.map((f) => code(read(f))).join('\n');
    expect(all).not.toMatch(/backdrop-filter|filter:\s*blur|(?<!repeating-)linear-gradient|radial-gradient/);
    const shadows = [...all.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => (m[1] ?? '').trim());
    for (const s of shadows) expect(s === 'var(--shadow-float)' || s.includes('var(--refuse-tint)') || s.includes('transparent')).toBe(true); // the float token; mic-pulse keyframes
  });

  it('no text below 13px: sizes come from the scale, whose smallest step is 13px', () => {
    const sizes = styles.flatMap((f) => [...code(read(f)).matchAll(/font-size:\s*([^;]+);/g)].map((m) => (m[1] ?? '').trim()));
    for (const s of sizes) expect(s).toMatch(/^var\(--size-[a-z0-9]+\)$/);
    const tokens = read(join(WEB, 'design/tokens.css'));
    const scale = [...tokens.matchAll(/--size-[a-z0-9]+:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(Math.min(...scale)).toBeGreaterThanOrEqual(13);
  });
});
