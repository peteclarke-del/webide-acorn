// @vitest-environment node

/* What matters here is what the conversion admits to losing. An importer that
 * returned a map and said nothing would be the same code with the evidence
 * removed.
 */
import { describe, expect, it } from 'vitest';
import { createTileMapDocument, parseTileMapDocument } from './tileMapDocument';
import { parsePixelAssetDocument } from './pixelAssetDocument';
import { importImageIntoTileMap } from './tileMapImageImport';

const PALETTE = ['#000000', '#ff0000', '#00ff00', '#ffffff'];

/** RGBA for an image built from a function of tile column and row. */
function image(columns: number, rows: number, tile: (column: number, row: number, x: number, y: number) => string, size = 8) {
  const width = columns * size; const height = rows * size;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const colour = tile(Math.floor(x / size), Math.floor(y / size), x % size, y % size);
      const offset = (y * width + x) * 4;
      rgba[offset] = Number.parseInt(colour.slice(1, 3), 16);
      rgba[offset + 1] = Number.parseInt(colour.slice(3, 5), 16);
      rgba[offset + 2] = Number.parseInt(colour.slice(5, 7), 16);
      rgba[offset + 3] = 255;
    }
  }
  return { rgba, width, height };
}

const map = () => createTileMapDocument('imported', 4, 4, 8, 8);

describe('cutting an image into tiles', () => {
  it('makes one asset per distinct tile and reuses the rest', () => {
    /* A checkerboard of two tiles over a four by four grid: two assets, and
     * fourteen of the sixteen cells reusing one of them. */
    const { rgba, width, height } = image(4, 4, (column, row) => (column + row) % 2 ? '#ff0000' : '#000000');
    const result = importImageIntoTileMap(map(), rgba, width, height, PALETTE);
    expect(result.distinctTiles).toBe(2);
    expect(result.assets).toHaveLength(2);
    expect(result.reusedCells).toBe(14);
    expect(result.document.layers[0]!.cells).toEqual([1, 2, 1, 2, 2, 1, 2, 1, 1, 2, 1, 2, 2, 1, 2, 1]);
    expect(result.notes.join(' ')).toMatch(/14 cells reuse a tile that had already been seen/);
  });

  it('writes pixel asset documents the rest of the build can already read', () => {
    /* Not a shape of its own: the tileset points at asset files, and an
     * importer that produced something almost like one would generate a map
     * whose artwork nothing could open. */
    const { rgba, width, height } = image(2, 2, (column) => column ? '#ffffff' : '#000000');
    const result = importImageIntoTileMap(map(), rgba, width, height, PALETTE, 'level-tile');
    const asset = parsePixelAssetDocument(result.assets[0]!.content);
    expect(result.assets[0]!.name).toBe('level-tile-1.asset.json');
    expect(asset.width).toBe(8);
    expect(asset.pixels).toHaveLength(64);
    expect(asset.pixels.every((pixel) => pixel === 0)).toBe(true);
    expect(result.document.tileset.map((entry) => entry.assetFile)).toEqual(['level-tile-1.asset.json', 'level-tile-2.asset.json']);
    /* And the map it produces is a map this build accepts. */
    expect(() => parseTileMapDocument(result.document)).not.toThrow();
  });

  it('counts the pixels it had to approximate rather than presenting the conversion as faithful', () => {
    const { rgba, width, height } = image(2, 2, () => '#883322');
    const result = importImageIntoTileMap(map(), rgba, width, height, PALETTE);
    expect(result.sourceColours).toBe(1);
    expect(result.approximatedPixels).toBe(256);
    expect(result.notes.join(' ')).toMatch(/256 of 256 pixels were not one of the 4 palette colours/);
  });

  it('says when the image did not divide into whole tiles', () => {
    const { rgba, width, height } = image(2, 2, () => '#000000');
    /* Declared three pixels wider than the tiles account for. */
    const padded = new Uint8Array((width + 3) * height * 4);
    for (let y = 0; y < height; y += 1) padded.set(rgba.slice(y * width * 4, (y + 1) * width * 4), y * (width + 3) * 4);
    const result = importImageIntoTileMap(map(), padded, width + 3, height, PALETTE);
    expect(result.document.width).toBe(2);
    expect(result.notes.join(' ')).toMatch(/not a whole number of 8 by 8 tiles; the remainder on the right and bottom was not imported/);
  });

  it('says nothing was lost only when nothing was', () => {
    /* Four distinct tiles, every colour already in the palette, and the image
     * an exact number of tiles: the only case where the note is earned. */
    const { rgba, width, height } = image(2, 2, (column, row) => PALETTE[row * 2 + column]!);
    const result = importImageIntoTileMap(map(), rgba, width, height, PALETTE);
    expect(result.notes).toEqual(['Every pixel was already a palette colour and the image divided exactly into tiles, so nothing was lost.']);
  });

  it('leaves a cell empty rather than pointing it at artwork that is not what the image showed', () => {
    /* 256 distinct tiles is one more than a tileset holds. The 256th cell is
     * empty and said to be, because substituting the nearest tile would give a
     * map that looks imported and is not the image. */
    const { rgba, width, height } = image(16, 16, (column, row, x, y) => {
      /* Three marked pixels, on their own rows, spelling the cell number in
       * three, three and two bits, so all 256 tiles genuinely differ. */
      const cell = row * 16 + column;
      const marked = (y === 0 && x === (cell & 7)) || (y === 2 && x === ((cell >> 3) & 7)) || (y === 4 && x === ((cell >> 6) & 3));
      return marked ? '#ffffff' : '#000000';
    });
    const result = importImageIntoTileMap(map(), rgba, width, height, PALETTE);
    expect(result.distinctTiles).toBe(255);
    expect(result.droppedTiles).toBe(1);
    expect(result.document.layers[0]!.cells[255]).toBe(0);
    expect(result.notes.join(' ')).toMatch(/were left empty rather than pointed at different artwork/);
  });

  it('refuses an image smaller than one tile, and data shorter than it claims', () => {
    const { rgba, width, height } = image(2, 2, () => '#000000');
    expect(() => importImageIntoTileMap(map(), rgba, 4, 4, PALETTE)).toThrow(/smaller than one 8 by 8 tile/);
    expect(() => importImageIntoTileMap(map(), rgba, 8, 16, PALETTE)).toThrow(/1 by 2 tiles .* and a map is at least 2 by 2/);
    expect(() => importImageIntoTileMap(map(), new Uint8Array(16), width, height, PALETTE)).toThrow(/shorter than its declared size/);
    expect(() => importImageIntoTileMap(map(), rgba, width, height, [])).toThrow(/No palette colours/);
    expect(() => importImageIntoTileMap(map(), rgba, width, height, PALETTE, 'Bad Stem')).toThrow(/lower-case letters, digits and hyphens/);
  });
});
