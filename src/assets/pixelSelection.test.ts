import { describe, expect, it } from 'vitest';
import { copyPixelSelection, fillPixelSelection, parsePixelClipboard, pastePixelSelection, selectionBounds, transformPixelSelection } from './pixelSelection';

describe('pixel asset rectangular selections', () => {
  it('normalises reverse selections and copies exact row-major pixels', () => {
    const pixels = Array.from({ length: 16 }, (_, index) => index % 4);
    const selection = { start: { x: 2, y: 2 }, end: { x: 1, y: 1 } };
    expect(selectionBounds(selection)).toEqual({ left: 1, top: 1, right: 2, bottom: 2 });
    /* Written in the shared clipboard shape now the map and screen editors use
     * the same machinery: it carries what kind of grid the numbers came from
     * and the range they were valid against, neither of which the pixel-only
     * shape could say. */
    expect(copyPixelSelection(pixels, 4, 4, selection)).toEqual({
      schema: '8bit-net.grid-selection', version: 1, kind: 'pixels',
      width: 2, height: 2, values: [1, 2, 1, 2], valueLimit: 4,
    });
  });

  it('still reads artwork copied before the machinery was shared', () => {
    /* Refusing the old shape would throw away whatever somebody had on their
     * clipboard when this build changed underneath them. */
    const legacy = JSON.stringify({ schema: '8bit-net.pixel-selection', version: 1, width: 2, height: 2, pixels: [1, 2, 3, 0] });
    expect(parsePixelClipboard(legacy)).toEqual({
      schema: '8bit-net.grid-selection', version: 1, kind: 'pixels',
      width: 2, height: 2, values: [1, 2, 3, 0], valueLimit: 4,
    });
  });

  it('pastes deterministically and clips at the canvas edge', () => {
    const clipboard = parsePixelClipboard(JSON.stringify({ schema: '8bit-net.pixel-selection', version: 1, width: 2, height: 2, pixels: [1, 2, 3, 0] }));
    expect(pastePixelSelection(Array(9).fill(0), 3, 3, clipboard, { x: 2, y: 2 })).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('fills only the selected rectangle and rejects malformed clipboard data', () => {
    expect(fillPixelSelection(Array(9).fill(0), 3, { start: { x: 1, y: 0 }, end: { x: 2, y: 1 } }, 3)).toEqual([0, 3, 3, 0, 3, 3, 0, 0, 0]);
    expect(() => parsePixelClipboard({ schema: '8bit-net.pixel-selection', version: 1, width: 2, height: 2, pixels: [1] }))
      .toThrow(/different number of values from the shape it declares/);
  });

  it('refuses a clipboard from a different kind of grid', () => {
    /* Tile indices and colour indices are both small numbers, so anything that
     * only counted values would take one for the other. */
    const tiles = { schema: '8bit-net.grid-selection', version: 1, kind: 'tiles', width: 1, height: 1, values: [1], valueLimit: 4 };
    expect(() => pastePixelSelection(Array(9).fill(0), 3, 3, parsePixelClipboard(tiles), { x: 0, y: 0 }))
      .toThrow(/holds tiles and this is a grid of pixels/);
  });

  it('flips only the selected rectangle in either axis', () => {
    const pixels = [0, 1, 2, 3, 0, 1, 2, 3, 0];
    const selection = { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } };
    expect(transformPixelSelection(pixels, 3, selection, 'flip-horizontal')).toEqual([1, 0, 2, 0, 3, 1, 2, 3, 0]);
    expect(transformPixelSelection(pixels, 3, selection, 'flip-vertical')).toEqual([3, 0, 2, 0, 1, 1, 2, 3, 0]);
  });
});
