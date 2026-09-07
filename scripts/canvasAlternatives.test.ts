import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/*
 * Every canvas in the product, and which of the two treatments it takes.
 *
 * UX-007 says a canvas may not be the only way to inspect or edit critical
 * data. This build answers that in two ways, and which one applies depends on
 * whether the canvas can be edited:
 *
 *   An editable canvas — the screen editor, the tile map — is `aria-hidden`,
 *   because a bitmap read out cell by cell tells nobody anything. What it is
 *   wrapped in takes focus and arrow keys, and a `role="status"` region beside
 *   it says where the caret is and what is under it: "Row 4 of 32, column 9 of
 *   40, tile 12 on layer Background". That sentence is the accessible view, and
 *   it is live, so it follows the caret.
 *
 *   A canvas that only shows something — a golden-image comparison, the map
 *   overview thumbnail — carries an `aria-label` describing what it shows. It
 *   is not hidden, because there is something worth announcing, and it is not
 *   interactive, so there is nothing to operate.
 *
 * The failure this guards against is a third treatment: a canvas that is
 * neither hidden nor named, which a screen reader announces as nothing at all
 * and which may be the only place some data appears. Two of the four here were
 * in that state until they were given the live region they now have.
 */
function sources(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) { out.push(...sources(path)); continue; }
    if (/\.tsx$/.test(entry) && !entry.includes('.test.')) out.push(path);
  }
  return out;
}

interface Canvas { file: string; line: number; hidden: boolean; named: boolean; markup: string }

function canvases(): Canvas[] {
  const found: Canvas[] = [];
  for (const path of sources(resolve(process.cwd(), 'src'))) {
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(/<canvas\b[^>]*>/g)) {
      const markup = match[0].replace(/\s+/g, ' ');
      found.push({
        file: path.split('/src/')[1]!,
        line: text.slice(0, match.index).split('\n').length,
        hidden: /aria-hidden=["{]?["']?true/.test(markup),
        named: /aria-label(?:ledby)?=/.test(markup),
        markup,
      });
    }
  }
  return found;
}

describe('the canvases and their accessible equivalents', () => {
  it('has canvases to check', () => {
    /* Without this the rule below can pass by finding none. */
    expect(canvases().length).toBeGreaterThanOrEqual(4);
  });

  it('gives every canvas one of the two treatments and never neither', () => {
    const untreated = canvases()
      .filter((canvas) => !canvas.hidden && !canvas.named)
      .map((canvas) => `${canvas.file}:${canvas.line} ${canvas.markup.slice(0, 70)}`);
    expect(untreated, 'a canvas that is neither hidden nor named is announced as nothing').toEqual([]);
  });

  it('gives every hidden canvas a live region to speak for it', () => {
    /*
     * Hiding a canvas is only honest if something else says what it holds. The
     * region is looked for in the same file, because that is where the wrapper
     * and its status line live.
     */
    const silent: string[] = [];
    for (const canvas of canvases().filter((entry) => entry.hidden)) {
      const text = readFileSync(resolve(process.cwd(), 'src', canvas.file), 'utf8');
      if (!/role="status"/.test(text)) silent.push(`${canvas.file}:${canvas.line}`);
    }
    expect(silent, 'a hidden canvas with nothing announcing its contents is data nobody can reach').toEqual([]);
  });

  it('names a preview canvas with something more than its element type', () => {
    for (const canvas of canvases().filter((entry) => entry.named && !entry.hidden)) {
      /* A label may be an expression rather than a literal — one of these is
       * built from the image being compared — so what is checked is that it
       * says something, not how it was written. */
      expect(canvas.markup, `${canvas.file} has an empty label`).not.toMatch(/aria-label=(?:""|''|\{``\}|\{''\}|\{""\})/);
      expect(canvas.markup.toLowerCase(), `${canvas.file} says only "canvas"`).not.toMatch(/aria-label=["']canvas["']/);
    }
  });
});
