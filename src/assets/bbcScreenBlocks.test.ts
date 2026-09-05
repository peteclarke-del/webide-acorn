import { describe, expect, it } from 'vitest';
import { fitsScreenBlocks, packBbcScreenBlocks, unpackBbcScreenBlocks } from './pixelPacking';

/*
 * A real sprite from a real game, and what it is a picture of.
 *
 * These sixty-four bytes are `sprite_player_walk_1_down` from a BBC Model B
 * game, written by the game's own converter. The expected picture below was
 * produced by running that converter's packing algorithm backwards, so this
 * test measures the workbench against the tool that made the data rather than
 * against a second opinion of mine.
 *
 * Read as linear rows — which is how the importer read it — the same bytes give
 * a figure cut into vertical strips and shuffled. That is what a person sees
 * and calls artwork that did not come in properly.
 */
const PLAYER_WALK_DOWN = [
  0x00, 0x00, 0x00, 0x00, 0x00, 0x20, 0x20, 0x30,
  0x00, 0x00, 0x07, 0x0f, 0x0f, 0x0f, 0x0f, 0x07,
  0x00, 0x00, 0x0e, 0xef, 0xff, 0xff, 0xef, 0x0e,
  0x00, 0x00, 0x00, 0x88, 0x88, 0x88, 0x00, 0x00,
  0x30, 0x11, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x80, 0x33, 0x33, 0x07, 0x00, 0x03, 0x06, 0x00,
  0x00, 0x09, 0x0c, 0x0c, 0x00, 0x02, 0x07, 0x00,
  0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
];

/** ' ' is colour 0, '.' 1, 'o' 2, 'O' 3. */
const EXPECTED = [
    '                ',
    '                ',
    '     ......     ',
    '    ....OOO.O   ',
    '    ....OOOOO   ',
    '  o ....OOOOO   ',
    '  o ....OOO.    ',
    '  oo ......     ',
    '  ooo           ',
    '   O  OO.  ..   ',
    '      OO..      ',
    '     .....      ',
    '                ',
    '      ..  .     ',
    '     ..  ...    ',
    '                ',
];

const draw = (pixels: readonly number[], width: number) =>
  Array.from({ length: pixels.length / width }, (_, row) =>
    pixels.slice(row * width, (row + 1) * width).map((value) => ' .oO'[value]).join(''));

describe('BBC screen-order sprite data', () => {
  it('reads a real game sprite as the picture its own converter drew', () => {
    const pixels = unpackBbcScreenBlocks(PLAYER_WALK_DOWN, 16, 16);
    expect(pixels).not.toBeNull();
    expect(draw(pixels!, 16)).toEqual(EXPECTED);
  });

  it('writes back exactly the bytes it was given', () => {
    const pixels = unpackBbcScreenBlocks(PLAYER_WALK_DOWN, 16, 16)!;
    expect(Array.from(packBbcScreenBlocks(pixels, 16, 16)!)).toEqual(PLAYER_WALK_DOWN);
  });

  it('is a different arrangement from reading the bytes as rows', () => {
    /* If these agreed, the layout would not matter and neither would this. */
    const asBlocks = unpackBbcScreenBlocks(PLAYER_WALK_DOWN, 16, 16)!;
    const asRows = PLAYER_WALK_DOWN.flatMap((byte) => [0, 1, 2, 3].map((offset) =>
      (((byte >> (7 - offset)) & 1) << 1) | ((byte >> (3 - offset)) & 1)));
    expect(asBlocks).not.toEqual(asRows);
  });

  it('refuses a shape the layout cannot express, rather than reshaping it', () => {
    expect(fitsScreenBlocks(16, 16)).toBe(true);
    expect(fitsScreenBlocks(6, 16)).toBe(false);
    expect(fitsScreenBlocks(16, 12)).toBe(false);
    expect(unpackBbcScreenBlocks(PLAYER_WALK_DOWN, 16, 12)).toBeNull();
    expect(packBbcScreenBlocks([0, 1, 2], 16, 16)).toBeNull();
  });

  it('round-trips every shape it does accept', () => {
    for (const { width, height } of [{ width: 4, height: 8 }, { width: 8, height: 8 }, { width: 16, height: 16 }, { width: 32, height: 8 }, { width: 8, height: 24 }]) {
      const pixels = Array.from({ length: width * height }, (_, index) => index % 4);
      const bytes = packBbcScreenBlocks(pixels, width, height)!;
      expect(bytes, `${width}x${height} packs`).not.toBeNull();
      expect(unpackBbcScreenBlocks(bytes, width, height), `${width}x${height} round-trips`).toEqual(pixels);
    }
  });
});
