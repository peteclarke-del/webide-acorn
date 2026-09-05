import { describe, expect, it } from 'vitest';
import { assemble6502 } from '../build/assembler6502';
import { assembleProject6502 } from '../build/projectAssembler6502';
import { Cpu6502Runtime } from '../runtime/cpu6502';
import {
  addTileMapLayer, createTileMapDocument, fillTileMapArea, generateTileMapOutput, MAX_MAP_LAYERS,
  paintTileMapCell, parseTileMapDocument, removeTileMapLayer, removeTileMapObject, resizeTileMap,
  rleDecodePlane, rleEncodePlane,
  TILE_ATTRIBUTE_FLIP_X, TILE_ATTRIBUTE_FLIP_Y, TILE_ATTRIBUTE_PRIORITY,
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
    // width, height, layers, highest index, objects, property stride, flags
    expect(Array.from(output.bytes.slice(0, 7))).toEqual([4, 3, 1, 2, 0, 0, 0]);
    expect(Array.from(output.bytes.slice(7))).toEqual([1, 1, 1, 1, 0, 0, 2, 0, 0, 0, 0, 0]);
    expect(output.manifest).toMatchObject({ width: 4, height: 3, layerCount: 1, tilesetCount: 2, objectCount: 0, propertyStride: 0, byteLength: 19, encoding: 'raw', attributePlanes: false });
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
    expect(Array.from(output.bytes.slice(7 + 12, 7 + 12 + 4))).toEqual([1, 0, 0, 5]);
    expect(output.assembly).toContain('.map_level_one_tile_properties');
  });

  it('pads a shorter property list so the table stride stays fixed', () => {
    const mixed = setTileMapTileset(sample(), [
      { index: 1, assetFile: 'wall.asset.json', properties: [7] },
      { index: 2, assetFile: 'floor.asset.json', properties: [1, 2, 3] },
    ]);
    const output = generateTileMapOutput(mixed);
    expect(output.manifest.propertyStride).toBe(3);
    expect(Array.from(output.bytes.slice(7 + 12, 7 + 12 + 6))).toEqual([7, 0, 0, 1, 2, 3]);
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

describe('what a tile property byte means', () => {
  const typed = (): TileMapDocument => ({
    ...sample(),
    propertySchema: [
      { name: 'solid', type: 'flag', description: 'Blocks the player' },
      { name: 'terrain', type: 'enum', values: ['grass', 'water', 'stone'] },
      { name: 'damage', type: 'byte' },
    ],
    tileset: [
      { index: 1, assetFile: 'wall.asset.json', properties: [1, 2, 0] },
      { index: 2, assetFile: 'floor.asset.json', properties: [0, 0, 5] },
    ],
  });

  it('refuses a flag that is not a flag and an enum value that names nothing', () => {
    /* The point of typing a property: without it, 2 in a flag column is
     * indistinguishable from a deliberate value and the game reads it as one. */
    const document = typed();
    expect(() => parseTileMapDocument({ ...document, tileset: [{ ...document.tileset[0]!, properties: [2, 0, 0] }, document.tileset[1]!] }))
      .toThrow(/solid is a flag, so it is 0 or 1, not 2/);
    expect(() => parseTileMapDocument({ ...document, tileset: [{ ...document.tileset[0]!, properties: [1, 3, 0] }, document.tileset[1]!] }))
      .toThrow(/terrain names 3 values, so it is 0 to 2, not 3/);
  });

  it('refuses a tile carrying more properties than the map declares slots for', () => {
    /* A schema some tiles are allowed to ignore is not a schema. */
    const document = typed();
    expect(() => parseTileMapDocument({ ...document, tileset: [{ ...document.tileset[0]!, properties: [1, 2, 0, 4] }, document.tileset[1]!] }))
      .toThrow(/carries 4 properties but this map declares 3/);
  });

  it('refuses a schema that could not become a symbol, or one that says the same thing twice', () => {
    const document = typed();
    expect(() => parseTileMapDocument({ ...document, propertySchema: [{ name: '2fast', type: 'byte' }] })).toThrow(/becomes part of a generated symbol/);
    expect(() => parseTileMapDocument({ ...document, propertySchema: [{ name: 'a', type: 'byte' }, { name: 'A', type: 'flag' }] })).toThrow(/declared twice/);
    expect(() => parseTileMapDocument({ ...document, propertySchema: [{ name: 'choice', type: 'enum', values: ['only'] }] })).toThrow(/2 to 16 values, or it is not a choice/);
    expect(() => parseTileMapDocument({ ...document, propertySchema: [{ name: 'plain', type: 'byte', values: ['a', 'b'] }] })).toThrow(/cannot carry named values/);
  });

  it('generates a constant for every slot and every named value', () => {
    const { assembly, manifest } = generateTileMapOutput(typed());
    expect(assembly).toContain('map_level_one_prop_solid = 0 ; flag · Blocks the player');
    expect(assembly).toContain('map_level_one_prop_terrain = 1 ; enum of 3');
    expect(assembly).toContain('map_level_one_prop_terrain_water = 1');
    expect(assembly).toContain('map_level_one_prop_damage = 2 ; byte');
    expect(manifest.propertySchema).toHaveLength(3);
  });

  it('leaves an untyped map generating exactly what it did before', () => {
    /* Typing is opt-in; a map that declares nothing must not gain a table of
     * constants nobody asked for. */
    expect(generateTileMapOutput(sample()).assembly).not.toContain('_prop_');
  });
});

describe('cells that flip or draw in front', () => {
  const attributed = (): TileMapDocument => {
    const document = sample();
    const attributes = Array(document.width * document.height).fill(0);
    attributes[0] = 1; attributes[1] = 3; attributes[6] = 4;
    return { ...document, layers: [{ ...document.layers[0]!, attributes }] };
  };

  it('keeps attributes in a plane of their own rather than in the index byte', () => {
    /* An index is a whole byte and a tileset may declare all 255, so there are
     * no spare bits to take. */
    const output = generateTileMapOutput(attributed());
    expect(output.manifest.attributePlanes).toBe(true);
    expect(output.manifest.cellsWithAttributes).toBe(3);
    expect(Array.from(output.bytes.slice(0, 7))).toEqual([4, 3, 1, 2, 0, 0, 2]);
    expect(Array.from(output.bytes.slice(7 + 12, 7 + 24))).toEqual([1, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0]);
    expect(output.assembly).toContain('bit 0 flips in x, bit 1 flips in y, bit 2 draws in front');
  });

  it('drops a plane that says nothing, so a map that stopped using them generates what it used to', () => {
    const document = attributed();
    const cleared = { ...document, layers: [{ ...document.layers[0]!, attributes: Array(12).fill(0) }] };
    expect(parseTileMapDocument(cleared).layers[0]!.attributes).toBeUndefined();
    expect(generateTileMapOutput(cleared).bytes).toEqual(generateTileMapOutput(sample()).bytes);
  });

  it('refuses a plane of the wrong length or a bit this build does not define', () => {
    const document = attributed();
    expect(() => parseTileMapDocument({ ...document, layers: [{ ...document.layers[0]!, attributes: [1, 2] }] })).toThrow(/not one byte per cell/);
    expect(() => parseTileMapDocument({ ...document, layers: [{ ...document.layers[0]!, attributes: Array(12).fill(8) }] })).toThrow(/outside the flip and priority bits/);
  });

  it('gives every layer a plane once any layer has one', () => {
    /* So a reader's arithmetic over the planes does not depend on which layers
     * happen to use attributes. */
    const twoLayers = addTileMapLayer(attributed(), 'Front');
    const output = generateTileMapOutput(twoLayers);
    expect(output.bytes.length).toBe(7 + 12 * 4);
  });
});

describe('compressing the planes', () => {
  /* A map that compresses well: mostly one tile, with a little variation. */
  const repetitive = (): TileMapDocument => {
    const base = setTileMapTileset(createTileMapDocument('big level', 40, 30), [
      { index: 1, assetFile: 'wall.asset.json' },
      { index: 2, assetFile: 'floor.asset.json' },
    ]);
    const filled = fillTileMapArea(base, 'layer-1', 0, 0, 40, 30, 1);
    return { ...fillTileMapArea(filled, 'layer-1', 4, 4, 30, 20, 2), encoding: 'rle' };
  };

  it('round-trips every plane through the encoding', () => {
    const document = repetitive();
    const cells = document.layers[0]!.cells;
    expect(rleDecodePlane(rleEncodePlane(cells))).toEqual(cells);
    /* Including the awkward shapes: nothing, one value, and a run longer than
     * a single count can hold. */
    expect(rleDecodePlane(rleEncodePlane([]))).toEqual([]);
    expect(rleDecodePlane(rleEncodePlane([7]))).toEqual([7]);
    const long = Array(600).fill(3);
    expect(rleEncodePlane(long)).toEqual([255, 3, 255, 3, 90, 3]);
    expect(rleDecodePlane(rleEncodePlane(long))).toEqual(long);
  });

  it('refuses a block that no encoder here produces rather than expanding it anyway', () => {
    expect(() => rleDecodePlane([4])).toThrow(/pairs of count and value/);
    expect(() => rleDecodePlane([0, 5])).toThrow(/run of zero/);
  });

  it('compresses the planes and says by how much', () => {
    const output = generateTileMapOutput(repetitive());
    expect(output.manifest.encoding).toBe('rle');
    expect(output.manifest.rawPlaneBytes).toBe(1200);
    expect(output.manifest.compressedPlaneBytes).toBeLessThan(1200);
    /* The decoded plane is the map, checked through the generated bytes rather
     * than through the encoder that produced them. */
    const encodedLength = output.bytes[7]! | (output.bytes[8]! << 8);
    expect(rleDecodePlane(Array.from(output.bytes.slice(9, 9 + encodedLength)))).toEqual(repetitive().layers[0]!.cells);
  });

  it('declines compression that would make the data bigger, and says so where it can be seen', () => {
    /* Emitting a larger file because a setting was ticked helps nobody. The
     * flag records what was done, not what was asked. */
    /* No two neighbouring cells alike, so every cell costs a count as well as
     * a value and the encoding is strictly worse than saying nothing. */
    const document = sample();
    const noisy: TileMapDocument = {
      ...document, encoding: 'rle',
      layers: [{ ...document.layers[0]!, cells: document.layers[0]!.cells.map((_, cell) => cell % 2 === 0 ? 1 : 2) }],
    };
    const output = generateTileMapOutput(noisy);
    expect(output.manifest.encodingRequested).toBe('rle');
    expect(output.manifest.encoding).toBe('raw');
    expect(output.bytes[6]! & 1).toBe(0);
    expect(output.assembly).toMatch(/run-length encoding was asked for and declined/);
    expect(output.bytes).toEqual(generateTileMapOutput({ ...noisy, encoding: 'raw' }).bytes);
  });

  it('generates an unpacker only for a map that needs one, and declares the bytes it claims', () => {
    expect(generateTileMapOutput(sample()).assembly).not.toContain('_unpack');
    const assembly = generateTileMapOutput({ ...repetitive(), unpackZeroPage: 0x80 }).assembly;
    expect(assembly).toContain('map_big_level_unpack_source = &80');
    expect(assembly).toContain('map_big_level_unpack_count = &86');
    expect(assembly).toContain('.map_big_level_unpack');
  });

  it('refuses a zero-page base the unpacker would run off the end of', () => {
    expect(() => parseTileMapDocument({ ...repetitive(), unpackZeroPage: 0xfa })).toThrow(/7 consecutive zero-page bytes/);
  });
});

describe('the generated unpacker, assembled', () => {
  const compressible = (): TileMapDocument => {
    const base = setTileMapTileset(createTileMapDocument('unpack me', 8, 4), [
      { index: 1, assetFile: 'wall.asset.json' },
      { index: 2, assetFile: 'floor.asset.json' },
    ]);
    const filled = fillTileMapArea(base, 'layer-1', 0, 0, 8, 4, 1);
    return { ...fillTileMapArea(filled, 'layer-1', 1, 1, 6, 2, 2), encoding: 'rle' };
  };

  it('assembles with the toolchain the build actually uses', () => {
    /* Generated source that does not assemble is not a feature, and reading it
     * is not evidence that it does. */
    const document = compressible();
    const { assembly } = generateTileMapOutput(document);
    /* The pointer table names the artwork labels the asset pipeline emits;
     * this contract is about the unpacker, so they stand in as empty blocks. */
    const source = ['ORG &2000', ' JSR map_unpack_me_unpack', ' RTS', '.asset_wall_pixels', 'EQUB 0', '.asset_floor_pixels', 'EQUB 0', assembly].join('\n');
    const artifact = assembleProject6502('unpack', [{ id: 'unpack', name: 'unpack.asm', content: source }]);
    expect(artifact.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').map((diagnostic) => diagnostic.message)).toEqual([]);
    expect(artifact.symbols.MAP_UNPACK_ME_UNPACK).toBeGreaterThan(0);
  });

  it('expands a compressed layer back to the map, executed rather than read', () => {
    /*
     * Reading generated source is not evidence that it runs. This assembles the
     * unpacker and executes it, so an off-by-one in the pointer arithmetic —
     * the failure a hand-written unpacker makes, and the one that looks like
     * corrupted artwork rather than like a bug — fails here.
     *
     * The same program has also been run on a genuine BBC Model B through the
     * headless path and expanded the same thirty-two cells from twelve bytes.
     * This contract is the reproducible half: it needs no ROMs and no machine.
     */
    const document = compressible();
    const { assembly, manifest } = generateTileMapOutput(document);
    expect(manifest.encoding).toBe('rle');
    expect(manifest.compressedPlaneBytes).toBeLessThan(manifest.rawPlaneBytes);

    const source = [
      'ORG &1900', '.start',
      ' LDA #<map_unpack_me_layer0', ' STA map_unpack_me_unpack_source',
      ' LDA #>map_unpack_me_layer0', ' STA map_unpack_me_unpack_source + 1',
      ' LDA #<buffer', ' STA map_unpack_me_unpack_dest',
      ' LDA #>buffer', ' STA map_unpack_me_unpack_dest + 1',
      ' JSR map_unpack_me_unpack', ' BRK',
      '.buffer', ' SKIP 32',
      '.asset_wall_pixels', 'EQUB 0', '.asset_floor_pixels', 'EQUB 0',
      assembly,
    ].join('\n');
    const artifact = assemble6502(source);
    expect(artifact.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);

    const cpu = new Cpu6502Runtime();
    cpu.load(artifact);
    expect(cpu.run().status).toBe('halted');
    const buffer = artifact.symbols.BUFFER!;
    expect(Array.from(cpu.memory.slice(buffer, buffer + 32))).toEqual(document.layers[0]!.cells);
  });

  it('leaves the byte after the destination alone, so a plane cannot overrun what follows it', () => {
    /* A run count read as zero would write 256 bytes and quietly destroy
     * whatever came next; this is what says it does not. */
    const document = compressible();
    const source = [
      'ORG &1900', '.start',
      ' LDA #<map_unpack_me_layer0', ' STA map_unpack_me_unpack_source',
      ' LDA #>map_unpack_me_layer0', ' STA map_unpack_me_unpack_source + 1',
      ' LDA #<buffer', ' STA map_unpack_me_unpack_dest',
      ' LDA #>buffer', ' STA map_unpack_me_unpack_dest + 1',
      ' JSR map_unpack_me_unpack', ' BRK',
      '.buffer', ' SKIP 32',
      '.sentinel', 'EQUB &5A',
      '.asset_wall_pixels', 'EQUB 0', '.asset_floor_pixels', 'EQUB 0',
      generateTileMapOutput(document).assembly,
    ].join('\n');
    const artifact = assemble6502(source);
    const cpu = new Cpu6502Runtime();
    cpu.load(artifact);
    cpu.run();
    expect(cpu.memory[artifact.symbols.SENTINEL!]).toBe(0x5a);
  });
});

describe('editing with attributes', () => {
  it('paints and fills an attribute alongside the index', () => {
    const painted = paintTileMapCell(sample(), 'layer-1', 1, 0, 1, TILE_ATTRIBUTE_FLIP_X | TILE_ATTRIBUTE_PRIORITY);
    expect(painted.layers[0]!.attributes?.[1]).toBe(5);
    const filled = fillTileMapArea(painted, 'layer-1', 0, 0, 2, 1, 1, TILE_ATTRIBUTE_FLIP_Y);
    expect(filled.layers[0]!.attributes?.slice(0, 2)).toEqual([2, 2]);
  });

  it('costs a map nothing until an attribute is actually used', () => {
    expect(paintTileMapCell(sample(), 'layer-1', 1, 0, 1).layers[0]!.attributes).toBeUndefined();
  });

  it('carries the attribute plane through a resize rather than dropping it', () => {
    /* Losing which cells were flipped on a resize would be a silent change to
     * the artwork, visible only once the game ran. */
    const painted = paintTileMapCell(sample(), 'layer-1', 1, 1, 1, TILE_ATTRIBUTE_FLIP_Y);
    const resized = resizeTileMap(painted, 6, 5);
    expect(resized.layers[0]!.attributes).toHaveLength(30);
    expect(resized.layers[0]!.attributes?.[6 + 1]).toBe(TILE_ATTRIBUTE_FLIP_Y);
  });
});
