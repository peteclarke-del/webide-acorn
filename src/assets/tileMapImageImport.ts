/*
 * Cut an image into tiles and lay them out as a map.
 *
 * This is the one asset conversion where the honest answer is almost never
 * "that worked". An image is arbitrary colour at arbitrary size; a tile map is
 * a small palette, a fixed grid and a bounded tileset. Every one of those is a
 * place the conversion loses something, so each is counted and reported rather
 * than absorbed: colours that had to be approximated, image that did not fit
 * the grid, and distinct tiles the tileset could not hold.
 *
 * Nothing here decodes an image format. The caller supplies RGBA it already
 * has, which keeps this testable without a browser and keeps image decoding
 * where the browser already does it.
 */
import { createPixelAssetDocument, serializePixelAssetDocument } from './pixelAssetDocument';
import {
  MAX_MAP_DIMENSION,
  MAX_TILESET_ENTRIES,
  MIN_MAP_DIMENSION,
  parseTileMapDocument,
  type TileMapDocument,
} from './tileMapDocument';

export interface TileMapImageImport {
  document: TileMapDocument;
  /** Pixel asset documents for each distinct tile, for the project to hold. */
  assets: Array<{ name: string; content: string }>;
  /** Distinct source colours the image contained. */
  sourceColours: number;
  /** Pixels whose nearest palette colour was not an exact match. */
  approximatedPixels: number;
  /** Whole tiles dropped because the image did not fill the grid. */
  croppedTiles: number;
  /** Distinct tiles found, and how many cells reuse one that already existed. */
  distinctTiles: number;
  reusedCells: number;
  /*
   * Tiles that would have been distinct but for the tileset bound. Their cells
   * are left empty rather than pointed at the nearest tile: a map that quietly
   * substituted artwork would look imported and be wrong.
   */
  droppedTiles: number;
  /** Said plainly, in the order somebody needs to read it. */
  notes: string[];
}

function channelDistance(r: number, g: number, b: number, rgb: string): number {
  const red = Number.parseInt(rgb.slice(1, 3), 16);
  const green = Number.parseInt(rgb.slice(3, 5), 16);
  const blue = Number.parseInt(rgb.slice(5, 7), 16);
  return (r - red) ** 2 + (g - green) ** 2 + (b - blue) ** 2;
}

/**
 * Import RGBA pixels as a tileset and a single layer.
 *
 * The map is replaced rather than merged: an import that half-overwrote a map
 * would leave indices from two different tilesets in one layer, which is not a
 * map of anything.
 */
export function importImageIntoTileMap(
  document: TileMapDocument,
  rgba: Uint8Array | Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  paletteColours: readonly string[],
  assetStem = 'imported-tile',
): TileMapImageImport {
  const validated = parseTileMapDocument(document);
  if (!Number.isInteger(imageWidth) || imageWidth < 1 || !Number.isInteger(imageHeight) || imageHeight < 1) throw new Error('The image must have a positive width and height');
  if (rgba.length < imageWidth * imageHeight * 4) throw new Error('The image data is shorter than its declared size');
  const usable = paletteColours.slice(0, 4);
  if (!usable.length) throw new Error('No palette colours were supplied for the conversion');
  if (!/^[a-z][a-z0-9-]{0,32}$/.test(assetStem)) throw new Error('The asset name stem must be lower-case letters, digits and hyphens');

  const { tileWidth, tileHeight } = validated;
  const columns = Math.floor(imageWidth / tileWidth);
  const rows = Math.floor(imageHeight / tileHeight);
  if (!columns || !rows) throw new Error(`This image is ${imageWidth} by ${imageHeight} pixels, which is smaller than one ${tileWidth} by ${tileHeight} tile`);
  /* A map is at least two tiles each way. Padding a smaller image out to that
   * would put cells in the map that the image never showed. */
  if (columns < MIN_MAP_DIMENSION || rows < MIN_MAP_DIMENSION) {
    throw new Error(`This image is ${columns} by ${rows} tiles of ${tileWidth} by ${tileHeight} pixels, and a map is at least ${MIN_MAP_DIMENSION} by ${MIN_MAP_DIMENSION}`);
  }

  /* Quantise once, so a tile compared against another is compared on the
   * colours it will actually be drawn in rather than on its source colours. */
  const quantised = new Uint8Array(imageWidth * imageHeight);
  const distinctColours = new Set<number>();
  let approximatedPixels = 0;
  for (let pixel = 0; pixel < imageWidth * imageHeight; pixel += 1) {
    const offset = pixel * 4;
    const r = rgba[offset]!; const g = rgba[offset + 1]!; const b = rgba[offset + 2]!;
    distinctColours.add((r << 16) | (g << 8) | b);
    let best = 0; let bestDistance = Number.POSITIVE_INFINITY;
    usable.forEach((colour, index) => {
      const distance = channelDistance(r, g, b, colour);
      if (distance < bestDistance) { bestDistance = distance; best = index; }
    });
    if (bestDistance > 0) approximatedPixels += 1;
    quantised[pixel] = best;
  }

  /* A map is at most 128 tiles each way, so an image with more is cropped from
   * the right and bottom rather than resampled — resampling a tile grid would
   * invent artwork that is in no tile of the image. */
  const mapWidth = Math.min(MAX_MAP_DIMENSION, columns);
  const mapHeight = Math.min(MAX_MAP_DIMENSION, rows);
  const cropped = columns * rows - mapWidth * mapHeight;

  const byArtwork = new Map<string, number>();
  const assets: Array<{ name: string; content: string }> = [];
  const cells: number[] = [];
  let reusedCells = 0;
  let droppedTiles = 0;
  for (let row = 0; row < mapHeight; row += 1) {
    for (let column = 0; column < mapWidth; column += 1) {
      const pixels: number[] = [];
      for (let y = 0; y < tileHeight; y += 1) {
        for (let x = 0; x < tileWidth; x += 1) {
          pixels.push(quantised[(row * tileHeight + y) * imageWidth + column * tileWidth + x]!);
        }
      }
      const key = pixels.join('');
      const existing = byArtwork.get(key);
      if (existing !== undefined) { cells.push(existing); reusedCells += 1; continue; }
      if (byArtwork.size >= MAX_TILESET_ENTRIES - 1) {
        /* Left empty on purpose. Pointing this cell at the nearest existing
         * tile would produce a map that looks imported and is not the image. */
        droppedTiles += 1;
        cells.push(0);
        continue;
      }
      const index = byArtwork.size + 1;
      byArtwork.set(key, index);
      const asset = {
        ...createPixelAssetDocument('tile', tileWidth, tileHeight),
        name: `${assetStem}-${index}`,
        pixels,
      };
      assets.push({ name: `${assetStem}-${index}.asset.json`, content: serializePixelAssetDocument(asset) });
      cells.push(index);
    }
  }

  const tileset = assets.map((asset, offset) => ({ index: offset + 1, assetFile: asset.name, properties: [] as number[] }));
  const imported = parseTileMapDocument({
    ...validated,
    width: mapWidth,
    height: mapHeight,
    /* One layer: an image says nothing about which of several layers its
     * tiles belong to, and spreading them across the existing layers would be
     * this build inventing a structure the image does not have. */
    layers: [{ id: 'layer-1', name: 'Imported', visible: true, cells }],
    tileset,
    objects: [],
  });

  const notes: string[] = [];
  if (approximatedPixels) notes.push(`${approximatedPixels.toLocaleString()} of ${(imageWidth * imageHeight).toLocaleString()} pixels were not one of the ${usable.length} palette colours and were mapped to the nearest.`);
  if (cropped > 0) notes.push(`${cropped.toLocaleString()} tiles of the image were dropped: a map holds at most ${MAX_MAP_DIMENSION} by ${MAX_MAP_DIMENSION} tiles.`);
  if (imageWidth % tileWidth || imageHeight % tileHeight) notes.push(`The image is ${imageWidth} by ${imageHeight} pixels, which is not a whole number of ${tileWidth} by ${tileHeight} tiles; the remainder on the right and bottom was not imported.`);
  if (droppedTiles) notes.push(`${droppedTiles.toLocaleString()} cells needed a tile beyond the ${MAX_TILESET_ENTRIES - 1} a tileset can hold and were left empty rather than pointed at different artwork.`);
  if (reusedCells) notes.push(`${reusedCells.toLocaleString()} cells reuse a tile that had already been seen, so the tileset holds ${byArtwork.size} distinct tiles rather than ${mapWidth * mapHeight}.`);
  if (!notes.length) notes.push('Every pixel was already a palette colour and the image divided exactly into tiles, so nothing was lost.');

  return {
    document: imported,
    assets,
    sourceColours: distinctColours.size,
    approximatedPixels,
    croppedTiles: Math.max(0, cropped),
    distinctTiles: byArtwork.size,
    reusedCells,
    droppedTiles,
    notes,
  };
}
