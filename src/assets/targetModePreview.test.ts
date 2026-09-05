// @vitest-environment node

/* The thing worth checking here is that the preview tells somebody something
 * the editor grid cannot: that their pixels are not square on the machine, and
 * that some of their colours have nowhere to go.
 */
import { describe, expect, it } from 'vitest';
import { previewCells, previewInEveryMode, previewInMode, pixelAspectOf } from './targetModePreview';
import { resolveProjectPalette } from './paletteDocument';

const palette = () => resolveProjectPalette([], 16);
const solid = (colour: number, count: number) => Array.from({ length: count }, () => colour);

describe('what a pixel is on the machine', () => {
  it('derives each mode’s pixel width from the widths the screen model already carries', () => {
    /* Every BBC graphics mode paints the same width of screen, so the ratio of
     * the pixel counts is the ratio of the pixel widths. */
    expect(pixelAspectOf('bbc-mode-0')).toBe(1);
    expect(pixelAspectOf('bbc-mode-1')).toBe(2);
    expect(pixelAspectOf('bbc-mode-4')).toBe(2);
    expect(pixelAspectOf('bbc-mode-2')).toBe(4);
    expect(pixelAspectOf('bbc-mode-5')).toBe(4);
  });

  it('says so, because a circle in the editor is an oval on the machine', () => {
    const preview = previewInMode(solid(0, 256), { width: 16, height: 16 }, 'bbc-mode-5');
    expect(preview.notes.join(' ')).toMatch(/4 times as wide/);
    expect(preview.notes.join(' ')).toMatch(/than the editor grid suggests/);
  });

  it('says nothing about aspect for the mode whose pixels are square', () => {
    expect(previewInMode(solid(0, 4), { width: 2, height: 2 }, 'bbc-mode-0').notes.join(' ')).not.toMatch(/times as wide/);
  });
});

describe('colours the mode cannot show', () => {
  it('names which ones and how many pixels use them, rather than clamping them', () => {
    /* A preview that looked right and a build that did not would be worse than
     * being told. */
    const pixels = [...solid(0, 10), ...solid(7, 3), ...solid(12, 2), ...solid(1, 1)];
    const preview = previewInMode(pixels, { width: 4, height: 4 }, 'bbc-mode-5');
    expect(preview.logicalColours).toBe(4);
    expect(preview.unrepresentable).toEqual([{ colour: 7, pixels: 3 }, { colour: 12, pixels: 2 }]);
    expect(preview.notes.join(' ')).toMatch(/uses 7, 12 as well/);
    expect(preview.notes.join(' ')).toMatch(/5 pixels would have no colour/);
    expect(preview.notes.join(' ')).toMatch(/nothing is clamped for you/);
  });

  it('finds nothing to report when every colour fits', () => {
    const preview = previewInMode(solid(3, 16), { width: 4, height: 4 }, 'bbc-mode-5');
    expect(preview.unrepresentable).toEqual([]);
    expect(preview.notes.join(' ')).not.toMatch(/no colour to be drawn in/);
  });

  it('gives a pixel the mode cannot show no colour at all rather than a substitute', () => {
    const cells = previewCells([0, 1, 9], { width: 3, height: 1 }, 'bbc-mode-5', palette());
    expect(cells[0]!.colour).not.toBeNull();
    expect(cells[1]!.colour).not.toBeNull();
    expect(cells[2]!.colour).toBeNull();
    expect(cells[2]!.logical).toBe(9);
  });
});

describe('what the artwork costs and covers', () => {
  it('reports the bytes a frame costs in the mode’s own depth', () => {
    /* MODE 5 is two bits per pixel: a 16-pixel row is four bytes. */
    expect(previewInMode(solid(0, 256), { width: 16, height: 16 }, 'bbc-mode-5').frameBytes).toBe(4 * 16);
    /* MODE 0 is one bit per pixel: the same row is two bytes. */
    expect(previewInMode(solid(0, 256), { width: 16, height: 16 }, 'bbc-mode-0').frameBytes).toBe(2 * 16);
    /* MODE 2 is four bits per pixel: eight bytes. */
    expect(previewInMode(solid(0, 256), { width: 16, height: 16 }, 'bbc-mode-2').frameBytes).toBe(8 * 16);
  });

  it('rounds a row up to whole bytes, because a row cannot occupy part of one', () => {
    /* Three MODE 5 pixels are six bits and still cost a byte. */
    expect(previewInMode(solid(0, 3), { width: 3, height: 1 }, 'bbc-mode-5').frameBytes).toBe(1);
  });

  it('reports how much of the screen it covers in this mode', () => {
    /* 16 pixels of MODE 5's 160 is a tenth of the width. */
    const preview = previewInMode(solid(0, 256), { width: 16, height: 16 }, 'bbc-mode-5');
    expect(preview.screenCoverage.horizontal).toBe(10);
    expect(preview.screenCoverage.vertical).toBe(6.3);
  });

  it('says when the artwork is wider than the mode', () => {
    const preview = previewInMode(solid(0, 200), { width: 200, height: 1 }, 'bbc-mode-5');
    expect(preview.notes.join(' ')).toMatch(/200 pixels wide and MODE 5 is 160/);
  });
});

describe('comparing the modes', () => {
  it('puts the modes that can show the artwork first', () => {
    /* Sixteen-colour artwork: only MODE 2 can show all of it. */
    const pixels = Array.from({ length: 16 }, (_, index) => index);
    const previews = previewInEveryMode(pixels, { width: 4, height: 4 });
    expect(previews[0]!.mode).toBe('bbc-mode-2');
    expect(previews[0]!.unrepresentable).toEqual([]);
    expect(previews.at(-1)!.unrepresentable.length).toBeGreaterThan(0);
  });

  it('prefers more colours when two modes both fit', () => {
    const previews = previewInEveryMode(solid(1, 4), { width: 2, height: 2 });
    expect(previews.every((preview) => preview.unrepresentable.length === 0)).toBe(true);
    expect(previews[0]!.logicalColours).toBe(16);
  });

  it('covers every mode the palette model knows', () => {
    expect(previewInEveryMode(solid(0, 4), { width: 2, height: 2 }).map((preview) => preview.mode).sort())
      .toEqual(['bbc-mode-0', 'bbc-mode-1', 'bbc-mode-2', 'bbc-mode-4', 'bbc-mode-5']);
  });
});
