// @vitest-environment node

/* The two refusals are the reason this module exists rather than the pixel
 * editor's original: tile indices and colour indices are both small numbers,
 * and anything that only counted values would accept one for the other.
 */
import { describe, expect, it } from 'vitest';
import {
  GridSelectionError,
  copySelection,
  describeSelection,
  fillSelection,
  parseGridClipboard,
  pasteSelection,
  selectionBounds,
  selectionContains,
  selectionSize,
} from './gridSelection';

const pixels = { width: 4, height: 3, kind: 'pixels' as const, valueLimit: 4 };
/* 4 by 3, values counting up so a lifted rectangle is recognisable. */
const values = [0, 1, 2, 3, 1, 2, 3, 0, 2, 3, 0, 1];
const selection = { start: { x: 1, y: 0 }, end: { x: 2, y: 1 } };

describe('describing a rectangle', () => {
  it('normalises corners given in any order', () => {
    const backwards = { start: { x: 2, y: 1 }, end: { x: 1, y: 0 } };
    expect(selectionBounds(backwards)).toEqual(selectionBounds(selection));
    expect(selectionSize(backwards)).toEqual({ width: 2, height: 2 });
  });

  it('knows what it contains', () => {
    expect(selectionContains(selection, 1, 0)).toBe(true);
    expect(selectionContains(selection, 2, 1)).toBe(true);
    expect(selectionContains(selection, 0, 0)).toBe(false);
    expect(selectionContains(selection, 3, 1)).toBe(false);
  });

  it('says its size in cells, which is what the editor grid is', () => {
    expect(describeSelection(selection)).toBe('2 by 2 cells, from 2,1 to 3,2');
  });
});

describe('lifting a rectangle out', () => {
  it('takes exactly the cells inside it, in order', () => {
    expect(copySelection(values, pixels, selection)).toEqual({
      schema: '8bit-net.grid-selection', version: 1, kind: 'pixels',
      width: 2, height: 2, values: [1, 2, 2, 3], valueLimit: 4,
    });
  });

  it('records what kind of grid it came from and what range it was valid against', () => {
    const copied = copySelection(values, pixels, selection);
    expect(copied.kind).toBe('pixels');
    expect(copied.valueLimit).toBe(4);
  });

  it('refuses a rectangle that runs off the grid', () => {
    expect(() => copySelection(values, pixels, { start: { x: 3, y: 0 }, end: { x: 4, y: 0 } }))
      .toThrow(/outside the grid/);
  });
});

describe('putting one back down', () => {
  it('writes the cells and leaves the rest alone', () => {
    const clipboard = copySelection(values, pixels, selection);
    expect(pasteSelection(values, pixels, clipboard, { x: 0, y: 1 })).toEqual([
      0, 1, 2, 3,
      1, 2, 3, 0,
      2, 3, 0, 1,
    ].map((value, index) => ([4, 5, 8, 9].includes(index) ? [1, 2, 2, 3][[4, 5, 8, 9].indexOf(index)]! : value)));
  });

  it('trims what falls off the edge rather than refusing the whole paste', () => {
    const clipboard = copySelection(values, pixels, selection);
    const pasted = pasteSelection(values, pixels, clipboard, { x: 3, y: 2 });
    expect(pasted).toHaveLength(values.length);
    expect(pasted[11]).toBe(1);
  });

  it('refuses tile indices pasted into pixels, because both are small numbers', () => {
    /* Anything that only counted values would accept this and produce artwork
     * nobody drew. */
    const tiles = copySelection([0, 1, 2, 3], { width: 2, height: 2, kind: 'tiles', valueLimit: 4 }, { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } });
    expect(() => pasteSelection(values, pixels, tiles, { x: 0, y: 0 }))
      .toThrow(/holds tiles and this is a grid of pixels/);
  });

  it('refuses a value the destination has no room for, rather than clamping it', () => {
    /* Sixteen-colour artwork into a four-colour asset: clamping loses what
     * somebody drew, and writing it out of range produces a build that does not
     * match what the editor showed. */
    const rich = copySelection([9, 10, 11, 12], { width: 2, height: 2, kind: 'pixels', valueLimit: 16 }, { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } });
    expect(() => pasteSelection(values, pixels, rich, { x: 0, y: 0 }))
      .toThrow(/holds the value 9 and this grid goes up to 3/);
    expect(() => pasteSelection(values, pixels, rich, { x: 0, y: 0 })).toThrow(/refused rather than clamped/);
  });

  it('accepts artwork from a narrower grid into a wider one', () => {
    const narrow = copySelection([0, 1, 2, 3], { width: 2, height: 2, kind: 'pixels', valueLimit: 4 }, { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } });
    const wide = { width: 2, height: 2, kind: 'pixels' as const, valueLimit: 16 };
    expect(pasteSelection([0, 0, 0, 0], wide, narrow, { x: 0, y: 0 })).toEqual([0, 1, 2, 3]);
  });
});

describe('reading a clipboard', () => {
  it('accepts its own output, as text or as an object', () => {
    const copied = copySelection(values, pixels, selection);
    expect(parseGridClipboard(copied)).toEqual(copied);
    expect(parseGridClipboard(JSON.stringify(copied))).toEqual(copied);
  });

  it('refuses anything that is not one, rather than repairing it', () => {
    expect(() => parseGridClipboard('not json at all')).toThrow(GridSelectionError);
    expect(() => parseGridClipboard({ schema: 'something.else' })).toThrow(/not hold a grid selection/);
    expect(() => parseGridClipboard({ schema: '8bit-net.grid-selection', version: 1, kind: 'sprites', width: 1, height: 1, values: [0], valueLimit: 2 }))
      .toThrow(/does not model/);
  });

  it('refuses a shape that disagrees with the values it carries', () => {
    expect(() => parseGridClipboard({ schema: '8bit-net.grid-selection', version: 1, kind: 'pixels', width: 2, height: 2, values: [0, 1], valueLimit: 4 }))
      .toThrow(/different number of values from the shape it declares/);
  });

  it('refuses a value outside the range the clipboard itself declares', () => {
    expect(() => parseGridClipboard({ schema: '8bit-net.grid-selection', version: 1, kind: 'pixels', width: 1, height: 1, values: [7], valueLimit: 4 }))
      .toThrow(/outside the range it declares/);
  });
});

describe('filling a rectangle', () => {
  it('sets what is inside and nothing outside', () => {
    expect(fillSelection(values, 4, selection, 0)).toEqual([
      0, 0, 0, 3,
      1, 0, 0, 0,
      2, 3, 0, 1,
    ]);
  });
});
