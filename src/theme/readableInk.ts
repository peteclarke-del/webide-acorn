/* Choosing text that can be read on a colour the user picked.
 *
 * A swatch that shows its index written on the colour it represents is a
 * label on an arbitrary background, and a fixed ink colour fails on half of
 * them. On this product's own palette it measured 1.03:1 against WCAG's 4.5:1
 * — text the same colour as what it sits on, which is text nobody can read.
 *
 * The fix is not a lighter ink. It is choosing, per swatch, whichever of black
 * or white contrasts better with that particular colour, which is the only
 * approach that works for a colour the product does not choose.
 */

/** Relative luminance, per WCAG 2.x. */
export function relativeLuminance(red: number, green: number, blue: number): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

/** The contrast ratio between two luminances, per WCAG 2.x. */
export function contrastRatio(first: number, second: number): number {
  const light = Math.max(first, second);
  const dark = Math.min(first, second);
  return (light + 0.05) / (dark + 0.05);
}

/** Red, green and blue from `#rgb`, `#rrggbb` or `rgb(r, g, b)`, or null. */
export function parseColour(value: string): [number, number, number] | null {
  const text = value.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
  if (short) return [short[1]!, short[2]!, short[3]!].map((part) => Number.parseInt(part + part, 16)) as [number, number, number];
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(text);
  if (long) return [long[1]!, long[2]!, long[3]!].map((part) => Number.parseInt(part, 16)) as [number, number, number];
  const functional = /^rgba?\(([^)]+)\)$/i.exec(text);
  if (functional) {
    const parts = functional[1]!.split(',').map((part) => Number.parseFloat(part.trim()));
    if (parts.length >= 3 && parts.slice(0, 3).every((part) => Number.isFinite(part))) {
      return [parts[0]!, parts[1]!, parts[2]!];
    }
  }
  return null;
}

export interface ReadableInk {
  /** The colour to write in. */
  ink: '#000000' | '#ffffff';
  /** What that gives, so a caller can report it rather than assume it. */
  ratio: number;
  /** True when even the better of black and white does not reach 4.5:1. */
  belowAa: boolean;
}

/**
 * Black or white, whichever reads better on the given background.
 *
 * A colour this cannot parse falls back to black on the assumption of a light
 * background, and says the ratio is unknown by reporting zero, so a caller
 * that wants to check never mistakes a guess for a measurement.
 */
export function readableInk(background: string): ReadableInk {
  const parsed = parseColour(background);
  if (!parsed) return { ink: '#000000', ratio: 0, belowAa: true };
  const luminance = relativeLuminance(...parsed);
  const onBlack = contrastRatio(luminance, 0);
  const onWhite = contrastRatio(luminance, 1);
  const ink = onBlack >= onWhite ? '#000000' : '#ffffff';
  const ratio = Math.max(onBlack, onWhite);
  return { ink, ratio, belowAa: ratio < 4.5 };
}
