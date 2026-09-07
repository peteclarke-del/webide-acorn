/*
 * What the theme's colours measure, against what they have to reach.
 *
 * The tokens in `theme.css` were chosen by eye, and by eye is how a light theme
 * ends up defining its own surfaces and inheriting the dark theme's foreground
 * colours: each block looks right on its own, and nothing compares the two. So
 * this computes the ratios rather than trusting them, and the pairings below are
 * declared rather than generated, because a pairing is a claim about what is
 * actually drawn on what — `--syntax-opcode` on `--theme-editor` is a real pair
 * and `--syntax-opcode` on `--theme-emulator-bezel` is not.
 *
 * The thresholds are WCAG 2.2:
 *
 *   4.5:1  text (1.4.3). Every text token here is held to the normal-text
 *          figure rather than the 3:1 large-text one, because a token is not a
 *          size — the same `--theme-muted` sets captions and headings, so the
 *          stricter of the two is the only one that is true everywhere.
 *   3:1    the boundary of a control that has to be identified, and a focus
 *          indicator (1.4.11).
 *
 * Disabled controls are exempt under 1.4.3 and are not audited, and there is no
 * disabled colour token to audit in any case: this product says "inactive" by
 * dimming the control, through `--control-disabled-opacity`, and by nothing
 * else. A palette entry for it existed and was read nowhere, which is why it is
 * gone rather than given a use.
 */

/** A colour as its channels plus an alpha, which translucent tokens carry. */
type Rgba = readonly [number, number, number, number];

export interface ThemeTokens {
  readonly [token: string]: string;
}

export interface ContrastPairing {
  /** Token drawn on top. */
  foreground: string;
  /** Token drawn underneath. */
  background: string;
  minimum: number;
  /** What is drawn, so a failure says what a person would have been looking at. */
  purpose: string;
}

/** The four palettes the stylesheet can produce. */
export type PaletteName = 'dark' | 'light' | 'dark high contrast' | 'light high contrast';

export interface ContrastFinding extends ContrastPairing {
  theme: PaletteName;
  ratio: number;
}

/* ------------------------------------------------------------------ colour */

export function parseColour(value: string): Rgba | null {
  const text = value.trim();
  const six = /^#([0-9a-f]{6})$/i.exec(text);
  if (six) {
    const packed = Number.parseInt(six[1]!, 16);
    return [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255, 1];
  }
  const three = /^#([0-9a-f]{3})$/i.exec(text);
  if (three) {
    const [r, g, b] = [...three[1]!].map((digit) => Number.parseInt(digit + digit, 16));
    return [r!, g!, b!, 1];
  }
  const functional = /^rgba?\(([^)]+)\)$/i.exec(text);
  if (functional) {
    const parts = functional[1]!.split(/[,\s/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
    return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1];
  }
  /* Anything else — a gradient, a colour-mix, a font stack — is not a flat
   * colour and is reported as unmeasurable rather than guessed at. */
  return null;
}

function channelLuminance(channel: number): number {
  const scaled = channel / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([red, green, blue]: Rgba): number {
  return 0.2126 * channelLuminance(red) + 0.7152 * channelLuminance(green) + 0.0722 * channelLuminance(blue);
}

/**
 * The contrast ratio between two tokens, with a translucent foreground
 * flattened over its backdrop first — an overlay at 78% opacity is not the
 * colour it declares, and comparing the declared one would report a ratio
 * nobody ever sees.
 */
export function contrastRatio(foreground: string, background: string): number | null {
  const under = parseColour(background);
  const overRaw = parseColour(foreground);
  if (!under || !overRaw) return null;
  const over: Rgba = overRaw[3] >= 1
    ? overRaw
    : [0, 1, 2].map((index) => overRaw[index]! * overRaw[3] + under[index]! * (1 - overRaw[3])).concat(1) as unknown as Rgba;
  const a = relativeLuminance(over);
  const b = relativeLuminance(under);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/* ------------------------------------------------------------------ tokens */

/** The outermost brace-balanced block starting at a marker. */
function blockAt(css: string, marker: string): string {
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`theme.css no longer contains ${marker.trim()}`);
  const from = css.indexOf('{', start);
  let depth = 0;
  for (let index = from; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    else if (css[index] === '}') { depth -= 1; if (depth === 0) return css.slice(from, index); }
  }
  throw new Error(`theme.css block starting at ${marker.trim()} is not closed`);
}

function declarations(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[match[1]!] = match[2]!.trim();
  return out;
}

/**
 * Both themes, resolved the way a browser resolves them.
 *
 * The light theme is an override block, so a token it does not mention keeps
 * the value from `:root`. That inheritance is the whole reason this audit
 * exists and so it is modelled rather than avoided: the light theme is read as
 * the dark one with its own declarations laid over the top.
 */
export function readThemes(css: string): Record<PaletteName, ThemeTokens> {
  const dark = declarations(blockAt(css, '\n  :root {'));
  const light = { ...dark, ...declarations(blockAt(css, "\n  :root[data-theme='light'] {")) };
  /* The high-contrast blocks are overrides in exactly the same way, and each
   * lists only the tokens that had to move. */
  const darkMore = { ...dark, ...declarations(blockAt(css, "\n  :root[data-contrast='more'] {")) };
  const lightMore = { ...light, ...declarations(blockAt(css, "\n  :root[data-theme='light'][data-contrast='more'] {")) };
  return { dark, light, 'dark high contrast': darkMore, 'light high contrast': lightMore };
}

/*
 * What each palette has to reach.
 *
 * The standard palettes are held to WCAG AA, which is what UX-006 requires. The
 * high-contrast palettes exist because somebody asked for more than that, so
 * they are held to AAA — 7:1 for text, 4.5:1 for the boundary of a control. A
 * high-contrast mode that only met AA would be a setting that did nothing.
 */
export const PALETTE_TARGETS: Readonly<Record<PaletteName, { text: number; nonText: number }>> = Object.freeze({
  dark: { text: 4.5, nonText: 3 },
  light: { text: 4.5, nonText: 3 },
  'dark high contrast': { text: 7, nonText: 4.5 },
  'light high contrast': { text: 7, nonText: 4.5 },
});

/* ---------------------------------------------------------------- pairings */

/** Surfaces that text is set on. */
const TEXT_SURFACES = [
  '--theme-background', '--theme-background-end', '--theme-surface-0', '--theme-surface-1',
  '--theme-surface-2', '--theme-surface-3', '--theme-surface-raised', '--theme-input',
  '--theme-editor', '--theme-editor-gutter', '--theme-hover', '--theme-selection',
] as const;

/** Foreground tokens that carry words. */
const TEXT_INKS = ['--theme-ink', '--theme-ink-strong', '--theme-muted', '--theme-faint'] as const;

/*
 * Status and emphasis colours, as they are used as text on panel surfaces.
 *
 * Which of these carry words was counted rather than assumed, and the count
 * corrected a wrong guess: `--theme-primary` is mostly a border, at forty-two
 * border uses against ten of text, while the colour that actually sets emphasis
 * text is `--theme-primary-light`, at a hundred and fourteen. Auditing the
 * first and not the second would have measured the wrong token.
 */
const STATUS_INKS = [
  '--theme-success', '--theme-warning', '--theme-info', '--theme-danger',
  '--theme-primary', '--theme-primary-light', '--theme-secondary', '--theme-accent',
] as const;

/*
 * The surfaces a status colour is set on, which includes the page ground.
 *
 * Leaving `--theme-background` out was a real gap rather than a simplification.
 * It is the darkest of the light theme's surfaces by a wide margin, and a great
 * deal of text is drawn straight onto it — the panel eyebrows, the state pills,
 * the inspector's kind labels, filenames in code voice. Measuring the rendered
 * page found all of them at between 2.7 and 4.2 to one while this list said the
 * palette was clean, because it only ever asked about the panel surfaces.
 */
const STATUS_SURFACES = [
  '--theme-background', '--theme-background-end', '--theme-surface-0',
  '--theme-surface-1', '--theme-surface-2', '--theme-surface-3', '--theme-editor',
] as const;

const SYNTAX_INKS = [
  '--syntax-comment', '--syntax-label', '--syntax-opcode',
  '--syntax-number', '--syntax-address', '--syntax-symbol',
] as const;

/** Surfaces a control border or a focus ring is drawn against. */
const CONTROL_SURFACES = [
  '--theme-background', '--theme-background-end', '--theme-surface-0', '--theme-surface-1',
  '--theme-surface-2', '--theme-surface-3', '--theme-surface-raised', '--theme-input',
] as const;

/*
 * Charts and diagnostics are covered by the pairings below rather than by rows
 * of their own, and that is a finding rather than an omission: neither has a
 * palette. The build graph draws its headings in `--theme-secondary` and its
 * captions in `--theme-faint` on `--theme-surface-2`; the three diagnostic
 * lists use `--theme-warning`, `--theme-danger` and `--theme-muted` on
 * `--theme-surface-1` and `--theme-surface-2`. Every one of those pairs is
 * already here. The only chart-specific custom property in the stylesheets is
 * `--graph-depth`, which is an indent and not a colour.
 */
export const CONTRAST_PAIRINGS: readonly ContrastPairing[] = Object.freeze([
  ...TEXT_SURFACES.flatMap((background) => TEXT_INKS.map((foreground) => ({
    foreground, background, minimum: 4.5, purpose: 'body text on a panel surface',
  }))),
  ...STATUS_SURFACES.flatMap((background) => STATUS_INKS.map((foreground) => ({
    foreground, background, minimum: 4.5, purpose: 'a status or emphasis colour used as text',
  }))),
  /* Code voice is not confined to the editor: filenames, addresses and symbols
   * are set in it all over the workbench, on whatever is behind them. */
  ...['--theme-editor', '--theme-background', '--theme-surface-1', '--theme-surface-2']
    .flatMap((background) => SYNTAX_INKS.map((foreground) => ({
      foreground, background, minimum: 4.5, purpose: 'source code, or a value in code voice',
    }))),
  ...CONTROL_SURFACES.map((background) => ({
    foreground: '--theme-line', background, minimum: 3, purpose: 'the border that identifies a control',
  })),
  ...CONTROL_SURFACES.map((background) => ({
    foreground: '--theme-focus', background, minimum: 3, purpose: 'the focus indicator',
  })),
  { foreground: '--theme-on-accent', background: '--theme-primary', minimum: 4.5, purpose: 'the label on a primary button' },
  { foreground: '--theme-on-accent', background: '--theme-accent', minimum: 4.5, purpose: 'the label on an accent badge' },
  { foreground: '--theme-danger-ink', background: '--theme-danger', minimum: 4.5, purpose: 'the label on a destructive button' },
]);

/** Every pairing that measures below what it has to reach. */
export function auditContrast(tokens: ThemeTokens, theme: PaletteName): ContrastFinding[] {
  const target = PALETTE_TARGETS[theme];
  const findings: ContrastFinding[] = [];
  for (const pairing of CONTRAST_PAIRINGS) {
    const foreground = tokens[pairing.foreground];
    const background = tokens[pairing.background];
    if (foreground === undefined || background === undefined) continue;
    /* A pairing states the AA figure it is about; a palette states the standard
     * it is held to. The stricter of the two is what applies, so raising a
     * palette's target raises every pairing in it at once. */
    const minimum = Math.max(pairing.minimum, pairing.minimum >= 4.5 ? target.text : target.nonText);
    const ratio = contrastRatio(foreground, background);
    if (ratio === null || ratio >= minimum) continue;
    findings.push({ ...pairing, minimum, theme, ratio });
  }
  return findings.sort((a, b) => a.ratio - b.ratio);
}

/** One line per finding, for a report a person reads rather than a diff. */
export function describeFinding(finding: ContrastFinding): string {
  return `${finding.theme}: ${finding.foreground} on ${finding.background} measures ${finding.ratio.toFixed(2)}:1 and needs ${finding.minimum}:1 — ${finding.purpose}`;
}
