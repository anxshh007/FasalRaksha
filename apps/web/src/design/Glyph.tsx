/**
 * The drawn glyph set (PROMPT §9.6): 20px grid, 1.25px stroke, square caps, `currentColor`.
 * No icon library, no emoji. The SVG sources live in design/glyphs/ and are inlined at build
 * time; they are this project's own static files, never user content.
 */
const SOURCES = import.meta.glob<string>('../../design/glyphs/*.svg', { query: '?raw', import: 'default', eager: true });

const GLYPHS: Record<string, string> = Object.fromEntries(
  Object.entries(SOURCES).map(([path, svg]) => [path.slice(path.lastIndexOf('/') + 1, -'.svg'.length), svg]),
);

export type GlyphName =
  | 'sprout' | 'home' | 'sell' | 'buyers' | 'deals' | 'quintal' | 'mandi' | 'slip' | 'warehouse' | 'truck' | 'rain' | 'msp' | 'seal'
  | 'flag' | 'mic' | 'camera' | 'sun' | 'moon' | 'language' | 'signal' | 'field' | 'up' | 'down' | 'flat' | 'why' | 'caution' | 'refuse';

export function Glyph({ name, size = 20, label }: { name: GlyphName; size?: number; label?: string }) {
  const svg = GLYPHS[name];
  if (svg === undefined) throw new Error(`No glyph named "${name}"`);
  return (
    <span
      className="glyph"
      style={{ width: size, height: size }}
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
