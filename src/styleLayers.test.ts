import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/* The cascade order this product declares is theme, then layout, then
 * overrides, and `docs/theming.md` tells downstream deployments they can
 * override the layout layer. None of that holds for a rule written outside a
 * layer: an unlayered declaration beats every layered one whatever its
 * specificity, and beats the overrides layer too.
 *
 * That is not a theoretical concern. About four hundred lines had been appended
 * after the layout layer's closing brace, and the resulting precedence hid two
 * bugs in a single day: a heading that ignored the type scale because an
 * unlayered clamp outbid it, and a narrow-viewport rule written in the layered
 * media query that silently did nothing. Both looked like the rule was wrong
 * rather than the layer.
 */

const ROOT = process.cwd();
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

/** Characters left once the balanced `@layer <name> { … }` block is removed. */
function outsideLayer(css: string, layer: string): string {
  const opening = new RegExp(`@layer\\s+${layer}\\s*\\{`).exec(css);
  if (!opening) return css;
  let depth = 0;
  let end = css.length;
  for (let index = opening.index + opening[0].length - 1; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    else if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) { end = index + 1; break; }
    }
  }
  return `${css.slice(0, opening.index)}${css.slice(end)}`;
}

/** Anything that is not whitespace or a comment. */
const meaningful = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '').trim();

describe('the cascade layers', () => {
  it('declares the order the theming document describes', () => {
    expect(read('index.html')).toContain('@layer theme, layout, overrides;');
  });

  it('keeps every layout rule inside the layout layer', () => {
    const left = meaningful(outsideLayer(read('src/styles.css'), 'layout'));
    expect(left, 'these rules would beat every layered rule and the overrides layer').toBe('');
  });

  it('keeps every theme rule inside the theme layer', () => {
    const left = meaningful(outsideLayer(read('src/theme.css'), 'theme'));
    expect(left, 'these rules would beat every layered rule and the overrides layer').toBe('');
  });
});
