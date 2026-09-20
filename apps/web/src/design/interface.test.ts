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
const copy = [...strings.matchAll(/(mr|hi|en): (['"])((?:\\.|(?!\2).)*)\2/g)].map((m) => ({ lang: m[1], text: m[3] ?? '' }));

describe('P1-07 · no security signalling, no emoji', () => {
  it('finds the copy it scans (guards against a vacuous pass)', () => {
    expect(copy.length).toBeGreaterThan(600); // every string, in Marathi, Hindi and English
  });

  it('no padlock, shield, "runs locally", "secure" or "verified" badge text anywhere in the interface', () => {
    // `isSecureContext` is the browser's name for "may use the camera" (HTTPS or localhost): an API
    // the camera must ask about, never text a farmer sees. It is the one identifier excused.
    const offences = ui.filter((f) => /🔒|🛡|runs locally|demo build|secure|encrypted|✅/i.test(code(read(f)).replaceAll('isSecureContext', ''))).map(rel);
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
    const banned = /\b(model|algorithm|AI|ML|inference|predict(ion|ed)?|confidence interval|quantile|score)\b|मॉडेल|मॉडल|अल्गोरिदम|एल्गोरिदम|एआय|एआई/i;
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

/**
 * §14.4 · Judge Mode is the one place model terminology is allowed, and it is fenced: not linked
 * from any farmer screen, and the only place literal English diagnostics copy is written.
 */
describe('§14.4 · Judge Mode is the exception, and the exception is fenced', () => {
  const judge = (path: string) => rel(path).startsWith('src/judge/');
  /** JSX text: what is written between tags, as opposed to a `t(locale, …)` lookup. */
  const jsxText = (text: string) =>
    [...code(text).matchAll(/>([^<>{}\n]{4,})</g)].map((m) => (m[1] ?? '').trim()).filter((line) => /[A-Za-z]/.test(line) && !/^[\s·—-]*$/.test(line));

  it('only the route table and the root know it exists, and neither links to it', () => {
    const allowed = new Set(['src/state/route.ts', 'src/App.tsx']);
    const mentions = ui.filter((f) => !judge(f) && !allowed.has(rel(f)) && code(read(f)).includes('_judge')).map(rel);
    expect(mentions).toEqual([]); // a screen that mentions it is a screen that could link to it
    // And nowhere is it an anchor: a judge types the route, a farmer never taps into it.
    const linked = ui.filter((f) => /href=[^\r\n]*_judge/.test(code(read(f)))).map(rel);
    expect(linked).toEqual([]);
  });

  it('the navigation offers four places, and Judge Mode is not one of them', () => {
    const app = read(join(WEB, 'src/App.tsx'));
    const nav = app.slice(app.indexOf('const nav'), app.indexOf('];', app.indexOf('const nav')));
    expect(nav).toContain("route: 'home'");
    expect(nav).toContain("route: 'deals'");
    expect(nav).not.toContain('_judge');
  });

  it('literal model terminology in the interface appears only under src/judge', () => {
    const banned = /\b(model|skill|coverage|conformal|quantile|inference|accuracy)\b/i;
    const offences = ui
      .filter((f) => !judge(f) && /\.tsx$/.test(f))
      .flatMap((f) => jsxText(read(f)).filter((line) => banned.test(line)).map((line) => `${rel(f)}: ${line}`));
    expect(offences).toEqual([]);
  });

  it('and Judge Mode does use it — otherwise this fence guards nothing', () => {
    const screen = read(join(WEB, 'src/judge/JudgeScreen.tsx'));
    expect(jsxText(screen).some((line) => /skill|coverage/i.test(line))).toBe(true);
  });
});

/**
 * P1-10 · P1-11 — two Phase-1 defects that are proven fixed by what the source does *not*
 * contain. A removal is only really done when something fails if it comes back.
 */
describe('P1-10 · no model credential ever reaches the browser', () => {
  it('no API key field, no key in storage, no provider SDK in the app', () => {
    const banned = /\b(apiKey|api_key|groq|anthropic|openai|bearer sk-|sk-[a-z0-9]{8})\b/i;
    const offences = ui.filter((f) => banned.test(code(read(f)))).map(rel);
    expect(offences).toEqual([]);
  });

  it('and the package the app ships depends on no model SDK', () => {
    const manifest = JSON.parse(read(join(WEB, 'package.json'))) as { dependencies?: Record<string, string> };
    const deps = Object.keys(manifest.dependencies ?? {});
    expect(deps.filter((d) => /groq|openai|anthropic|@ai-sdk/.test(d))).toEqual([]);
  });
});

describe('P1-11 · the device store is IndexedDB, not localStorage, and the DOM is React', () => {
  it('localStorage and sessionStorage are never read or written', () => {
    // Prose about Phase 1 is allowed; a call is not. `code()` has already stripped comments.
    const offences = ui.filter((f) => /\b(local|session)Storage\s*\.\s*(get|set|remove|clear)/.test(code(read(f)))).map(rel);
    expect(offences).toEqual([]);
  });

  it('nothing renders by assembling HTML strings, except the drawn glyph set', () => {
    const offences = ui.filter((f) => /\b(innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML)\b/.test(code(read(f)))).map(rel);
    // Glyph.tsx inlines this repository's own SVG files, imported at build time, so that they
    // inherit `currentColor`. They are drawn here, never fetched, and never come from a user.
    expect(offences).toEqual(['src/design/Glyph.tsx']);
    const glyph = code(read(join(WEB, 'src/design/Glyph.tsx')));
    expect(glyph).toMatch(/import\.meta\.glob|\?raw/); // build-time, from the repository
    expect(glyph).not.toMatch(/fetch\(/);
  });
});

/**
 * A registry id belongs to one account, and the browser suite shares one database within a run,
 * so two specs signing in with the same farmer is a test that fails for a reason that has nothing
 * to do with what it is testing. It happened twice while this suite grew; this is the guard.
 */
describe('e2e · no two browser specs claim the same farmer', () => {
  const specs = files(join(WEB, 'e2e'), (n) => n.endsWith('.spec.ts'));

  it('finds the specs it scans (guards against a vacuous pass)', () => {
    expect(specs.length).toBeGreaterThanOrEqual(10);
  });

  it('each registry identifier is signed in with by exactly one spec', () => {
    const claims = new Map<string, string[]>();
    for (const file of specs) {
      // Every identifier the spec's code names — comments are already stripped by `code()`.
      const body = code(read(file));
      for (const id of new Set([...body.matchAll(/PMK-MH-\d{4}-\d{5}/g)].map((m) => m[0]))) {
        claims.set(id, [...(claims.get(id) ?? []), rel(file)]);
      }
    }
    expect(claims.size).toBeGreaterThan(5);
    const shared = [...claims.entries()].filter(([, where]) => new Set(where).size > 1).map(([id, where]) => `${id}: ${[...new Set(where)].join(', ')}`);
    expect(shared).toEqual([]);
  });
});
