/**
 * P9 gate · §9.10 — WCAG AA on every text/background pair in both themes, computed from the
 * tokens that ship. The table is printed on every run.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatTable, over, pairs, parseColour, parseTheme, ratio } from './contrast';

const css = readFileSync(resolve(import.meta.dirname, '../../design/tokens.css'), 'utf8');
const all = [...pairs(parseTheme(css, 'night'), 'night'), ...pairs(parseTheme(css, 'field'), 'field')];

describe('design tokens · contrast', () => {
  it('computes WCAG ratios correctly (black on white is 21:1)', () => {
    expect(ratio(parseColour('#000000'), parseColour('#ffffff'))).toBeCloseTo(21, 5);
    expect(ratio(over('rgba(255, 255, 255, 0.5)', '#000000'), parseColour('#000000'))).toBeGreaterThan(4);
  });

  it('checks a meaningful number of pairs in each theme (guards against a vacuous pass)', () => {
    expect(all.filter((p) => p.theme === 'night').length).toBeGreaterThan(100);
    expect(all.filter((p) => p.theme === 'field').length).toBeGreaterThan(100);
  });

  it('every pair passes AA in both themes', () => {
    console.log(formatTable(all));
    const failing = all.filter((p) => p.ratio < p.required).map((p) => `${p.theme}: ${p.foreground} on ${p.background} = ${p.ratio.toFixed(2)}:1`);
    expect(failing).toEqual([]);
  });

  it('the specification\'s original --text-faint values would fail, which is why they were changed (CUTS C-04)', () => {
    expect(ratio(parseColour('#65736B'), parseColour('#07110C'))).toBeLessThan(4.5);
    expect(ratio(parseColour('#7C8981'), parseColour('#F7F8F7'))).toBeLessThan(4.5);
  });
});
