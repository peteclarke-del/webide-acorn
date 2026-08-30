import { describe, expect, it } from 'vitest';
import {
  addTileMapLayer, createTileMapDocument, fillTileMapArea, generateTileMapOutput, MAX_MAP_LAYERS,
  paintTileMapCell, parseTileMapDocument, removeTileMapLayer, removeTileMapObject, resizeTileMap,
  serializeTileMapDocument, setTileMapTileset, tileAssetLabel, tileMapLabel, upsertTileMapObject,
  type TileMapDocument,
} from './tileMapDocument';

function sample(): TileMapDocument {
  const base = setTileMapTileset(createTileMapDocument('level one', 4, 3), [
    { index: 1, assetFile: 'wall.asset.json' },
    { index: 2, assetFile: 'floor.asset.json' },
  ]);
  const painted = fillTileMapArea(base, 'layer-1', 0, 0, 4, 1, 1);
  return paintTileMapCell(painted, 'layer-1', 2, 1, 2);
}

describe('tile map documents', () => {
  it('creates an empty single-layer map of the requested size', () => {
    const document = createTileMapDocument('start', 6, 5);
    expect(document.layers).toHaveLength(1);
    expect(document.layers[0]!.cells).toHaveLength(30);
    expect(document.layers[0]!.cells.every((cell) => cell === 0)).toBe(true);
    expect(parseTileMapDocument(document)).toEqual(document);
  });

  it('round-trips through serialization', () => {
    const document = sample();
    expect(parseTileMapDocument(serializeTileMapDocument(document))).toEqual(document);
  });

  it('refuses a cell that names an index the tileset does not declare', () => {
    const document = sample();
    const broken = { ...document, layers: [{ ...document.layers[0]!, cells: document.layers[0]!.cells.map((_, index) => index === 0 ? 9 : 0) }] };
    expect(() => parseTileMapDocument(broken)).toThrow(/tile index 9, which the tileset does not declare/);
  });

  it('refuses malformed schemas, sizes, duplicate indices and stray objects', () => {
    expect(() => parseTileMapDocument({ schema: 'other', version: 1 })).toThrow(/Unsupported tile map schema/);
    expect(() => parseTileMapDocument({ ...sample(), width: 1 })).toThrow(/Map width/);
    expect(() => parseTileMapDocument({ ...sample(), tileWidth: 7 })).toThrow(/Tile width/);
    expect(() => parseTileMapDocument({ ...sample(), tileset: [{ index: 1, assetFile: 'a' }, { index: 1, assetFile: 'b' }] })).toThrow(/declared twice/);
    expect(() => parseTileMapDocument({ ...sample(), tileset: [{ index: 0, assetFile: 'a' }] })).toThrow(/index 0 is always the empty tile/);
    expect(() => parseTileMapDocument({ ...sample(), layers: [] })).toThrow(/1 to 4 layers/);
    expect(() => parseTileMapDocument({ ...sample(), objects: [{ id: 'o', name: 'o', kind: 'point', x: 9, y: 0, width: 1, height: 1, properties: [] }] })).toThrow(/lies outside the map/);
    expect(() => parseTileMapDocument({ ...sample(), objects: [{ id: 'o', name: 'o', kind: 'region', x: 3, y: 0, width: 4, height: 1, properties: [] }] })).toThrow(/extends beyond the map/);
  });
});

describe('editing a tile map', () => {
  it('paints a single cell and fills a rectangle', () => {
    const document = sample();
    expect(document.layers[0]!.cells).toEqual([1, 1, 1, 1, 0, 0, 2, 0, 0, 0, 0, 0]);
    expect(paintTileMapCell(document, 'layer-1', 0, 2, 2).layers[0]!.cells[8]).toBe(2);
    expect(() => paintTileMapCell(document, 'layer-1', 4, 0, 1)).toThrow(/outside the map/);
    expect(() => fillTileMapArea(document, 'layer-1', 2, 0, 3, 1, 1)).toThrow(/outside the map/);
    expect(() => paintTileMapCell(document, 'missing', 0, 0, 1)).toThrow(/not in this map/);
  });

  it('adds and removes layers within the declared bound', () => {
    let document = sample();
    for (let count = 1; count < MAX_MAP_LAYERS; count += 1) document = addTileMapLayer(document);
    expect(document.layers).toHaveLength(MAX_MAP_LAYERS);
    expect(() => addTileMapLayer(document)).toThrow(/limited to 4 layers/);
    expect(removeTileMapLayer(document, document.layers[1]!.id).layers).toHaveLength(MAX_MAP_LAYERS - 1);
    expect(() => removeTileMapLayer(createTileMapDocument('one'), 'layer-1')).toThrow(/at least one layer/);
  });

  it('keeps retained cells when resizing and drops objects that no longer fit', () => {
    const withObject = upsertTileMapObject(sample(), { id: 'spawn', name: 'Spawn', kind: 'point', x: 3, y: 2, width: 1, height: 1, properties: [7] });
    const grown = resizeTileMap(withObject, 6, 4);
    expect(grown.layers[0]!.cells.slice(0, 4)).toEqual([1, 1, 1, 1]);
    expect(grown.layers[0]!.cells[4]).toBe(0);
    expect(grown.objects).toHaveLength(1);
    const shrunk = resizeTileMap(withObject, 2, 2);
    expect(shrunk.layers[0]!.cells).toEqual([1, 1, 0, 0]);
    expect(shrunk.objects).toEqual([]);
  });

  it('clears cells whose tile index is removed from the tileset', () => {
    const reduced = setTileMapTileset(sample(), [{ index: 1, assetFile: 'wall.asset.json' }]);
    expect(reduced.layers[0]!.cells).toEqual([1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('adds, replaces and removes objects', () => {
    const added = upsertTileMapObject(sample(), { id: 'gate', name: 'Gate', kind: 'region', x: 0, y: 1, width: 2, height: 2, properties: [1, 2] });
    expect(added.objects).toHaveLength(1);
    const replaced = upsertTileMapObject(added, { ...added.objects[0]!, name: 'Exit gate' });
    expect(replaced.objects).toHaveLength(1);
    expect(replaced.objects[0]!.name).toBe('Exit gate');
    expect(removeTileMapObject(replaced, 'gate').objects).toEqual([]);
  });
});

describe('generated map output', () => {
  const output = generateTileMapOutput(sample());

  it('emits a header, the layer data and a deterministic digest', () => {
    // width, height, layers, highest index, objects, property stride
    expect(Array.from(output.bytes.slice(0, 6))).toEqual([4, 3, 1, 2, 0, 0]);
    expect(Array.from(output.bytes.slice(6))).toEqual([1, 1, 1, 1, 0, 0, 2, 0, 0, 0, 0, 0]);
    expect(output.manifest).toMatchObject({ width: 4, height: 3, layerCount: 1, tilesetCount: 2, objectCount: 0, propertyStride: 0, byteLength: 18 });
    expect(output.manifest.sha256).toBe(generateTileMapOutput(sample()).manifest.sha256);
  });

  it('names the tile artwork by the label the asset pipeline actually generates', () => {
    expect(tileAssetLabel('wall.asset.json')).toBe('asset_wall_pixels');
    expect(tileMapLabel('level one')).toBe('map_level_one');
    expect(output.assembly).toContain('.map_level_one');
    expect(output.assembly).toContain('.map_level_one_layer0');
    expect(output.assembly).toContain('EQUW asset_wall_pixels');
    expect(output.assembly).toContain('EQUW asset_floor_pixels');
    expect(output.requiredAssets).toEqual(['wall.asset.json', 'floor.asset.json']);
  });

  it('declares an index whose artwork is not chosen yet without inventing an address', () => {
    const pending = setTileMapTileset(createTileMapDocument('pending', 2, 2), [{ index: 1, assetFile: null }]);
    const generated = generateTileMapOutput(paintTileMapCell(pending, 'layer-1', 0, 0, 1));
    expect(generated.assembly).toContain('EQUW 0 ; index 1 has no artwork chosen yet');
    expect(generated.requiredAssets).toEqual([]);
    expect(generated.manifest.unassignedIndices).toEqual([1]);
  });

  it('marks an undeclared pointer slot instead of emitting a fabricated address', () => {
    const gapped = setTileMapTileset(createTileMapDocument('gap', 2, 2), [{ index: 3, assetFile: 'only.asset.json' }]);
    const assembly = generateTileMapOutput(gapped).assembly;
    expect(assembly).toContain('EQUW 0 ; index 1 is not declared');
    expect(assembly).toContain('EQUW 0 ; index 2 is not declared');
    expect(assembly).toContain('EQUW asset_only_pixels');
  });

  it('emits objects with their extent and byte properties', () => {
    const withObjects = upsertTileMapObject(sample(), { id: 'gate', name: 'Gate', kind: 'region', x: 0, y: 1, width: 2, height: 2, properties: [9] });
    const generated = generateTileMapOutput(withObjects);
    expect(Array.from(generated.bytes.slice(-7))).toEqual([1, 0, 1, 2, 2, 1, 9]);
    expect(generated.manifest.objectCount).toBe(1);
    expect(generated.assembly).toContain('.map_level_one_objects');
  });
});

describe('tile properties, usage and duplicate artwork', () => {
  const withProperties = () => setTileMapTileset(sample(), [
    { index: 1, assetFile: 'wall.asset.json', properties: [1, 0], name: 'Wall' },
    { index: 2, assetFile: 'wall.asset.json', properties: [0, 5] },
  ]);

  it('emits a fixed-stride property table for every declared index', () => {
    const output = generateTileMapOutput(withProperties());
    expect(output.manifest.propertyStride).toBe(2);
    expect(Array.from(output.bytes.slice(0, 6))).toEqual([4, 3, 1, 2, 0, 2]);
    // Layer data, then two property bytes per index 1 and 2.
    expect(Array.from(output.bytes.slice(6 + 12, 6 + 12 + 4))).toEqual([1, 0, 0, 5]);
    expect(output.assembly).toContain('.map_level_one_tile_properties');
  });

  it('pads a shorter property list so the table stride stays fixed', () => {
    const mixed = setTileMapTileset(sample(), [
      { index: 1, assetFile: 'wall.asset.json', properties: [7] },
      { index: 2, assetFile: 'floor.asset.json', properties: [1, 2, 3] },
    ]);
    const output = generateTileMapOutput(mixed);
    expect(output.manifest.propertyStride).toBe(3);
    expect(Array.from(output.bytes.slice(6 + 12, 6 + 12 + 6))).toEqual([7, 0, 0, 1, 2, 3]);
  });

  it('says so when no tile declares a property', () => {
    const output = generateTileMapOutput(sample());
    expect(output.manifest.propertyStride).toBe(0);
    expect(output.assembly).toContain('no tile declares a property');
  });

  it('refuses more properties than the declared bound and non-byte values', () => {
    expect(() => setTileMapTileset(sample(), [{ index: 1, assetFile: null, properties: [1, 2, 3, 4, 5] }])).toThrow(/limited to 4 properties/);
    expect(() => setTileMapTileset(sample(), [{ index: 1, assetFile: null, properties: [300] }])).toThrow(/not a byte/);
  });

  it('counts how many cells use each index', () => {
    const usage = generateTileMapOutput(sample()).manifest.tileUsage;
    expect(usage).toEqual([{ index: 1, cells: 4 }, { index: 2, cells: 1 }]);
  });

  it('reports indices that name the same artwork so they can be merged', () => {
    expect(generateTileMapOutput(withProperties()).manifest.duplicateArtwork)
      .toEqual([{ assetFile: 'wall.asset.json', indices: [1, 2] }]);
    expect(generateTileMapOutput(sample()).manifest.duplicateArtwork).toEqual([]);
  });
});
