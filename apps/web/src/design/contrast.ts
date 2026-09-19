/**
 * WCAG 2.2 contrast, computed from the design tokens themselves (PROMPT §9.10: "verify every
 * pair programmatically and print the contrast table"). Pure: the test reads tokens.css and
 * hands the text in, so the table always describes the tokens that actually ship.
 */

export type Theme = 'night' | 'field';
export type Tokens = Record<string, string>;

const BLOCK = { night: /:root,\s*:root\[data-theme='night'\]\s*\{([^}]*)\}/, field: /:root\[data-theme='field'\]\s*\{([^}]*)\}/ } as const;

/** The custom properties declared in one theme's block of tokens.css. */
export function parseTheme(css: string, theme: Theme): Tokens {
  const body = BLOCK[theme].exec(css)?.[1];
  if (body === undefined) throw new Error(`tokens.css has no ${theme} block`);
  const tokens: Tokens = {};
  for (const match of body.matchAll(/--([a-z-]+):\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) tokens[name] = value.replace(/\/\*.*?\*\//g, '').trim();
  }
  return tokens;
}

type Rgba = [number, number, number, number];

export function parseColour(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex?.[1] !== undefined) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/i.exec(value);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])];
  throw new Error(`not a colour: ${value}`);
}

/** A (possibly translucent) colour as it appears laid over an opaque one. */
export function over(top: string, bottom: string): Rgba {
  const [r, g, b, a] = parseColour(top);
  const [R, G, B] = parseColour(bottom);
  return [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a), 1];
}

function luminance([r, g, b]: Rgba): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function ratio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export interface Pair {
  theme: Theme;
  foreground: string;
  background: string;
  ratio: number;
  /** 4.5 for text (every text size here is below "large"); 3 for control borders and focus rings. */
  required: number;
}

const TEXTS = ['text', 'text-muted', 'text-faint', 'farmer', 'buyer', 'fpo', 'caution', 'refuse'];
const OPAQUE_GROUNDS = ['ground', 'ground-soft', 'surface', 'surface-raised'];
const TINTS = ['farmer-tint', 'buyer-tint', 'fpo-tint', 'caution-tint', 'refuse-tint'];

/** Every pair the interface can put on screen, in one theme. */
export function pairs(tokens: Tokens, theme: Theme): Pair[] {
  const get = (name: string) => {
    const value = tokens[name];
    if (value === undefined) throw new Error(`${theme} is missing --${name}`);
    return value;
  };
  const out: Pair[] = [];
  const grounds: { name: string; colour: Rgba }[] = OPAQUE_GROUNDS.map((g) => ({ name: g, colour: parseColour(get(g)) }));
  // Tints are washes: they sit on the page ground and on cards.
  for (const tint of TINTS) for (const base of ['ground', 'surface']) grounds.push({ name: `${tint} on ${base}`, colour: over(get(tint), get(base)) });
  for (const text of TEXTS) for (const g of grounds) out.push({ theme, foreground: text, background: g.name, ratio: ratio(parseColour(get(text)), g.colour), required: 4.5 });
  // Ink on filled accent buttons.
  for (const fill of ['farmer', 'buyer', 'fpo']) out.push({ theme, foreground: 'on-accent', background: fill, ratio: ratio(parseColour(get('on-accent')), parseColour(get(fill))), required: 4.5 });
  // Non-text (WCAG 1.4.11): input borders use --text-faint; focus rings use the accent.
  for (const g of ['ground', 'surface']) {
    out.push({ theme, foreground: 'text-faint (control border)', background: g, ratio: ratio(parseColour(get('text-faint')), parseColour(get(g))), required: 3 });
    for (const accent of ['farmer', 'buyer', 'fpo']) out.push({ theme, foreground: `${accent} (focus ring)`, background: g, ratio: ratio(parseColour(get(accent)), parseColour(get(g))), required: 3 });
  }
  return out;
}

export function formatTable(all: Pair[]): string {
  const lines = ['CONTRAST — every text/background pair, both themes (WCAG 2.2 AA: 4.5:1 text, 3:1 controls)'];
  for (const theme of ['night', 'field'] as const) {
    const rows = all.filter((p) => p.theme === theme);
    lines.push('', `${theme.toUpperCase()}  ${rows.length} pairs, lowest ${Math.min(...rows.map((r) => r.ratio)).toFixed(2)}:1`);
    const fgs = [...new Set(rows.map((r) => r.foreground))];
    for (const fg of fgs) {
      const mine = rows.filter((r) => r.foreground === fg);
      const worst = mine.reduce((a, b) => (b.ratio < a.ratio ? b : a));
      const failing = mine.filter((r) => r.ratio < r.required);
      lines.push(`  ${fg.padEnd(30)} ${String(mine.length).padStart(2)} backgrounds  min ${worst.ratio.toFixed(2)}:1 on ${worst.background.padEnd(22)} ${failing.length === 0 ? 'PASS' : `FAIL ×${failing.length}`}`);
    }
  }
  return lines.join('\n');
}
