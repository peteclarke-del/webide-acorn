import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/*
 * How a number is written when somebody reads it.
 *
 * Acorn wrote hexadecimal with an ampersand and capital digits (`&1900`, not
 * `0x1900` and not `&1e00`), and this product is read by people who have been
 * reading `&` for forty years. The convention is already followed almost
 * everywhere: of a hundred and fifty-odd places that convert a number to hex,
 * a hundred write `&` with capitals and padding, and thirty-two more write `&`
 * with capitals where the width genuinely varies, such as a BASIC token byte.
 *
 * The sigil is not always `&`, and that is deliberate rather than a lapse:
 * `formatAddress` in `acornTargetReference.ts` writes `0x` into C and ARM
 * source and `$` into ca65 assembly, because those are the notations those
 * assemblers accept. What must not happen is an Acorn address written in Acorn
 * notation with lower-case digits, which reads as a different thing to the eye
 * and appears nowhere in the product today.
 */
function sources(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) { out.push(...sources(path)); continue; }
    if (!/\.tsx?$/.test(entry) || entry.includes('.test.')) continue;
    out.push(path);
  }
  return out;
}

const FILES = sources(resolve(process.cwd(), 'src'));

describe('the way a number is written', () => {
  it('has conversions to check', () => {
    const total = FILES.reduce((sum, file) => sum + (readFileSync(file, 'utf8').match(/toString\(16\)/g)?.length ?? 0), 0);
    expect(total, 'the product still formats numbers as hexadecimal').toBeGreaterThan(100);
  });

  it('never writes an Acorn address in lower case', () => {
    const wrong: string[] = [];
    for (const file of FILES) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/&\$\{[^}]*?toString\(16\)((?:(?!\}).)*)\}/g)) {
        /* `&${x.toString(16)...}` is an Acorn address, so the digits have to be
         * capitals. Anything else is a different notation and not this rule's
         * business. */
        if (!match[1]!.includes('toUpperCase')) wrong.push(`${file.split('/src/')[1]}: ${match[0].slice(0, 70)}`);
      }
    }
    expect(wrong, 'an Acorn address with lower-case digits reads as something else').toEqual([]);
  });

  it('keeps the one place that chooses a sigil by dialect', () => {
    /* If this goes, the rule above starts being wrong rather than merely
     * narrow: `0x` in a C file is correct and must stay possible. */
    const reference = readFileSync(resolve(process.cwd(), 'src/language/acornTargetReference.ts'), 'utf8');
    expect(reference).toContain("return `0x${digits}`");
    expect(reference).toContain("return `$${digits}`");
    expect(reference).toContain("return `&${digits}`");
  });
});
