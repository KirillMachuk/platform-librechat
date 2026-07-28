import { PROJECT_COLORS, DEFAULT_PROJECT_COLOR, resolveColor } from '../iconOptions';

/**
 * Project colours are inline hexes, not tokens, because the user picks them —
 * which means nothing else in the app protects them from becoming invisible in
 * one of the two themes. A glyph is drawn in its colour on a disc of the same
 * colour at 10% alpha, over a surface that flips between #ffffff and #0d0d0d,
 * so the pair that has to stay legible is glyph-against-disc.
 */

/** The surfaces a project glyph actually lands on (client/src/style.css). */
const SURFACES = ['#ffffff', '#0d0d0d', '#171717'];
const DISC_ALPHA = 0x1a / 255;
/** WCAG 1.4.11: a meaningful graphical object needs 3:1. */
const MIN_RATIO = 3;

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

const relativeLuminance = (hex: string) => {
  const [r, g, b] = channels(hex).map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string) => {
  const [lo, hi] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => x - y);
  return (hi + 0.05) / (lo + 0.05);
};

/** The `${hex}1a` disc the components paint behind the glyph. */
const disc = (hex: string, surface: string) => {
  const [fr, fg, fb] = channels(hex);
  const [br, bg, bb] = channels(surface);
  const mix = (f: number, b: number) => Math.round(DISC_ALPHA * f + (1 - DISC_ALPHA) * b);
  return `#${[mix(fr, br), mix(fg, bg), mix(fb, bb)]
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`;
};

describe('project colour palette', () => {
  it.each(PROJECT_COLORS)('$name stays legible in both themes', ({ hex }) => {
    for (const surface of SURFACES) {
      expect(contrast(hex, disc(hex, surface))).toBeGreaterThanOrEqual(MIN_RATIO);
    }
  });

  it('every colour is a 6-digit hex, because the disc is built by string concatenation', () => {
    // `${iconHex}1a` only produces valid CSS for #rrggbb — a shorthand or rgb()
    // would silently render a transparent disc with no error anywhere.
    for (const { hex } of PROJECT_COLORS) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('falls back to the default colour when a project has none stored', () => {
    const defaultHex = PROJECT_COLORS.find((c) => c.name === DEFAULT_PROJECT_COLOR)?.hex;
    expect(defaultHex).toBeDefined();
    // Projects predating the colour field, and unknown names, must not drop out
    // of the palette — that is how the old invisible near-black survived.
    expect(resolveColor(undefined)).toBe(defaultHex);
    expect(resolveColor(null)).toBe(defaultHex);
    expect(resolveColor('')).toBe(defaultHex);
    expect(resolveColor('a-colour-that-was-removed')).toBe(defaultHex);
  });

  it('keeps the stored names stable', () => {
    // These strings live in Mongo; renaming one orphans every project using it.
    expect(PROJECT_COLORS.map((c) => c.name)).toEqual([
      'black',
      'red',
      'orange',
      'yellow',
      'green',
      'blue',
      'purple',
      'pink',
    ]);
  });
});
