import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/* The workbench's text sizes all come from one generated scale so the whole
 * interface can be made larger by changing two numbers, and so nothing can
 * quietly reintroduce the five- and six-pixel type the product shipped with.
 * These tests read the stylesheets as text because that is where the rule
 * lives; a rendered check would only see whichever page it happened to open. */

/* Vitest runs from the project root, so stylesheets are read from there. */
const __PROJECT_ROOT = process.cwd();
const THEME = 'src/theme.css';
/* Stylesheets that carry sizes. Each records whether it is loaded next to
 * theme.css or on its own, because a page loaded on its own cannot see the
 * scale unless it carries its own copy of it. */
const SHEETS = [
  { path: 'src/styles.css', standalone: false },
  { path: 'src/emulator/runtime.css', standalone: true },
  { path: 'public/electron-runtime.css', standalone: true },
  { path: 'public/archimedes-runtime.css', standalone: true },
];

/* Sizes that are not a length: they either take the inherited size or are
 * resolved by a token further up. They cannot be off the scale. */
const NOT_A_LENGTH = /^(inherit|initial|unset|revert|100%|1em)$/;

/* The code column is sized by the reader's own preference rather than by the
 * interface scale, because it is the one piece of text people set for
 * themselves; its bounds are guarded in `editorPreferences.test.ts`. */
const READER_S_OWN_SIZE = /var\(--editor-font-size/;

/* A zero size is not text at all: it is how a narrow viewport suppresses a
 * button's label so only its icon remains. */
const HIDES_A_LABEL = /^0$/;

/* Whitespace inside calc() and friends would otherwise split a single value
 * into several words when the `font` shorthand is read a word at a time. */
const packParentheses = (value: string) => {
  let depth = 0;
  let out = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (!(depth > 0 && /\s/.test(ch))) out += ch;
  }
  return out;
};

const read = (path: string) => readFileSync(resolve(__PROJECT_ROOT, path), 'utf8');

const declaredSizes = (css: string) => {
  const sizes: string[] = [];
  for (const [, value] of css.matchAll(/font-size:\s*([^;}]+)/g)) sizes.push((value ?? '').trim());
  /* The `font` shorthand carries a size between the weight and the line
   * height: `font: 800 var(--fs-18)/1 var(--font-mono)`. A bare number there
   * is the weight, so only a token or a length counts as the size. */
  for (const [, value] of css.matchAll(/(?<![-\w])font:\s*([^;}]+)/g)) {
    const size = packParentheses((value ?? '').trim())
      .split(/\s+/)
      .map((part) => part.split('/')[0] ?? '')
      .find((part) => /^(var\(--fs-|max\(|[\d.]+(px|em|rem|pt|%))/.test(part));
    if (size) sizes.push(size);
  }
  return sizes;
};

describe('the interface type scale', () => {
  const theme = read(THEME);

  it('generates every size from the scale and the floor', () => {
    expect(theme).toMatch(/--ui-scale:\s*[\d.]+/);
    expect(theme).toMatch(/--fs-floor:\s*\d+px/);
    for (const [, token, body] of theme.matchAll(/(--fs-[\w-]+):\s*([^;]+);/g)) {
      if (token === '--fs-floor') continue;
      expect(body, `${token} must be floored and scaled`).toMatch(
        /max\(var\(--fs-floor\), calc\([\d.]+px \* var\(--ui-scale\)\)\)/,
      );
    }
  });

  for (const sheet of SHEETS) {
    const css = read(sheet.path);

    it(`sizes every rule in ${sheet.path} through the scale`, () => {
      const offScale = declaredSizes(css).filter(
        (size) =>
          !size.includes('var(--fs-') &&
          !NOT_A_LENGTH.test(size) &&
          !READER_S_OWN_SIZE.test(size) &&
          !HIDES_A_LABEL.test(size),
      );
      expect(offScale, `${sheet.path} has sizes that ignore the scale`).toEqual([]);
    });

    it(`resolves every token ${sheet.path} asks for`, () => {
      const source = sheet.standalone ? css : `${theme}\n${css}`;
      const defined = new Set([...source.matchAll(/(--fs-[\w-]+):/g)].map((m) => m[1]));
      const missing = [...new Set([...css.matchAll(/var\((--fs-[\w-]+)\)/g)].map((m) => m[1]))]
        .filter((token) => !defined.has(token));
      expect(missing, `${sheet.path} uses tokens nothing defines`).toEqual([]);
    });
  }

  it('keeps each standalone page in step with the workbench scale', () => {
    const scaleOf = (css: string) => [
      /--ui-scale:\s*([\d.]+)/.exec(css)?.[1],
      /--fs-floor:\s*(\d+px)/.exec(css)?.[1],
    ];
    for (const sheet of SHEETS.filter((s) => s.standalone)) {
      expect(scaleOf(read(sheet.path)), `${sheet.path} drifted from ${THEME}`).toEqual(
        scaleOf(theme),
      );
    }
  });
});
