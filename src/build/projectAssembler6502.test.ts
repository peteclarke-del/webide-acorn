import { describe, expect, it } from 'vitest';
import { assembleProject6502 } from './projectAssembler6502';
import { addPixelSpriteFrame, createPixelAssetDocument, serializePixelAssetDocument, updatePixelSpriteFrame } from '../assets/pixelAssetDocument';

const file = (id: string, name: string, content: string) => ({ id, name, content });

describe('multi-file 6502 project assembler', () => {
  it('expands nested includes, resolves cross-file symbols and preserves address provenance', () => {
    const result = assembleProject6502('main', [
      file('main', 'main.asm', 'ORG &1900\nINCLUDE "constants.inc"\n.start\n JSR helper\n BRK'),
      file('constants', 'constants.inc', 'INCLUDE "helper.asm"\nEQUB &AA'),
      file('helper', 'helper.asm', '.helper\n LDA #&41\n RTS'),
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(result.dependencies).toEqual(['constants.inc', 'helper.asm']);
    expect(result.symbols.HELPER).toBe(0x1900);
    expect(result.sourceLocations[0x1900]).toEqual({ fileId: 'helper', fileName: 'helper.asm', line: 2 });
    expect(result.sourceLocations[0x1903]).toEqual({ fileId: 'constants', fileName: 'constants.inc', line: 2 });
    expect(result.listing.join('\n')).toContain('[helper.asm:2]');
    expect(result.sourceFiles.helper).toEqual({ name: 'helper.asm', content: '.helper\n LDA #&41\n RTS' });
    expect(Object.keys(result.sourceFiles).sort()).toEqual(['constants', 'helper', 'main']);
  });

  it('reports missing includes at the requesting file and line', () => {
    const result = assembleProject6502('main', [file('main', 'main.asm', 'ORG &1900\nINCLUDE "missing.asm"\nBRK')]);
    expect(result.diagnostics[0]).toMatchObject({ fileId: 'main', fileName: 'main.asm', line: 2, message: 'Included file not found: missing.asm' });
  });

  it('generates versioned asset dependencies at build time with source provenance', () => {
    const sprite = createPixelAssetDocument('sprite', 8, 8); sprite.name = 'hero'; sprite.pixels[0] = 3; sprite.sprite!.mask[0] = 0; sprite.sprite!.hotspot = { x: 2, y: 3 };
    const result = assembleProject6502('main', [file('main', 'main.asm', 'ORG &1900\nINCLUDEASSET "hero.asset.json"\nRTS'), file('asset', 'hero.asset.json', serializePixelAssetDocument(sprite))]);
    expect(result.diagnostics).toEqual([]); expect(result.dependencies).toEqual(['hero.asset.json']);
    expect(Object.keys(result.sourceFiles).sort()).toEqual(['asset', 'main']);
    expect(result.symbols).toMatchObject({ ASSET_HERO_PIXELS: 0x1900, ASSET_HERO_MASK: 0x1910, ASSET_HERO_HOTSPOT: 0x1918 });
    expect(Array.from(result.bytes.slice(0, 1))).toEqual([0xc0]); expect(Array.from(result.bytes.slice(16, 17))).toEqual([0x7f]); expect(Array.from(result.bytes.slice(24, 27))).toEqual([2, 3, 0x60]);
    expect(result.sourceLocations[0x1900]).toMatchObject({ fileId: 'asset', fileName: 'hero.asset.json' });
  });

  it('assembles current animation frames and their ordered runtime table directly from the editable dependency', () => {
    let sprite = createPixelAssetDocument('sprite', 8, 8); sprite.name = 'runner'; sprite.pixels[0] = 1;
    sprite = addPixelSpriteFrame(sprite); sprite = updatePixelSpriteFrame(sprite, 1, { durationMs: 250, pixels: [2, ...Array(63).fill(0)] });
    const result = assembleProject6502('main', [file('main', 'main.asm', 'ORG &1900\nINCLUDEASSET "runner.asset.json"\nRTS'), file('asset', 'runner.asset.json', serializePixelAssetDocument(sprite))]);
    expect(result.diagnostics).toEqual([]);
    expect(result.symbols).toMatchObject({ ASSET_RUNNER_PIXELS: 0x1900, ASSET_RUNNER_MASK: 0x1920, ASSET_RUNNER_FRAMES: 0x1932 });
    expect(Array.from(result.bytes.slice(0, 17))).toEqual([0x40, ...Array(15).fill(0), 0x80]);
    expect(Array.from(result.bytes.slice(-9))).toEqual([0x10, 0x19, 0x28, 0x19, 0, 0, 250, 0, 0x60]);
    expect(result.sourceLocations[0x1932]).toMatchObject({ fileId: 'asset', fileName: 'runner.asset.json' });
  });

  it('rejects include cycles with the exact dependency chain', () => {
    const result = assembleProject6502('a', [file('a', 'a.asm', 'INCLUDE "b.asm"'), file('b', 'b.asm', 'INCLUDE "a.asm"')]);
    expect(result.diagnostics[0]).toMatchObject({ fileName: 'b.asm', line: 1 });
    expect(result.diagnostics[0]?.message).toContain('a.asm → b.asm → a.asm');
  });

  it('stops oversized expansion before passing attacker-controlled payloads to the assembler', () => {
    const oversized = assembleProject6502('main', [file('main', 'main.asm', `ORG &1900\nEQUS "${'A'.repeat(2 * 1024 * 1024)}"`)]);
    expect(oversized.bytes).toHaveLength(0);
    expect(oversized.diagnostics).toEqual([expect.objectContaining({ fileId: 'main', line: 2, message: expect.stringContaining('2 MiB build limit') })]);
  });

  it('rejects output bombs and host-path include attempts without producing bytes', () => {
    const outputBomb = assembleProject6502('main', [file('main', 'main.asm', `ORG &1900\nEQUB ${Array.from({ length: 70_000 }, () => '0').join(',')}`)]);
    expect(outputBomb.bytes).toHaveLength(0);
    expect(outputBomb.diagnostics.some((diagnostic) => /exceeds the 16-bit address space/.test(diagnostic.message))).toBe(true);
    const traversal = assembleProject6502('main', [file('main', 'main.asm', 'ORG &1900\nINCLUDE "../../outside.asm"\nRTS')]);
    expect(traversal.bytes).toEqual(Uint8Array.of(0x60));
    expect(traversal.diagnostics[0]).toMatchObject({ fileId: 'main', line: 2, message: 'Included file not found: ../../outside.asm' });
  });
});

describe('map inclusion', () => {
  const tile = (name: string, fill: number) => JSON.stringify({
    schema: '8bit-net.pixel-asset', version: 1, name, kind: 'tile', width: 8, height: 8,
    pixels: Array(64).fill(fill), palette: { indices: [0, 1, 2, 3], interpretation: 'logical-acorn-colours' },
    target: { family: 'acorn-8-bit', packing: 'logical-2bpp-msb-groups', previewPixelAspect: 'square-editor-preview' },
    extensions: {},
  });
  const map = JSON.stringify({
    schema: '8bit-net.tile-map', version: 1, name: 'level', width: 2, height: 2, tileWidth: 8, tileHeight: 8,
    layers: [{ id: 'layer-1', name: 'Ground', visible: true, cells: [1, 2, 0, 1] }],
    tileset: [{ index: 1, assetFile: 'wall.asset.json' }, { index: 2, assetFile: 'floor.asset.json' }],
    objects: [], extensions: {},
  });
  const files = [
    { id: 'main', name: 'main.asm', content: 'ORG &1900\n.start\nRTS\nINCLUDEMAP "level.map.json"' },
    { id: 'map', name: 'level.map.json', content: map },
    { id: 'wall', name: 'wall.asset.json', content: tile('wall', 1) },
    { id: 'floor', name: 'floor.asset.json', content: tile('floor', 2) },
  ];

  it('emits the map, pulls in the tileset artwork it names and resolves the pointer table', () => {
    const artifact = assembleProject6502('main', files, '6502');
    expect(artifact.diagnostics).toEqual([]);
    expect(artifact.symbols.MAP_LEVEL).toBeDefined();
    expect(artifact.symbols.MAP_LEVEL_LAYER0).toBeDefined();
    expect(artifact.symbols.MAP_LEVEL_TILES).toBeDefined();
    expect(artifact.symbols.ASSET_WALL_PIXELS).toBeDefined();
    expect(artifact.symbols.ASSET_FLOOR_PIXELS).toBeDefined();
    const table = artifact.symbols.MAP_LEVEL_TILES! - artifact.origin;
    expect(artifact.bytes[table]! | (artifact.bytes[table + 1]! << 8)).toBe(artifact.symbols.ASSET_WALL_PIXELS);
    expect(artifact.bytes[table + 2]! | (artifact.bytes[table + 3]! << 8)).toBe(artifact.symbols.ASSET_FLOOR_PIXELS);
    expect(artifact.dependencies).toEqual(expect.arrayContaining(['level.map.json', 'wall.asset.json', 'floor.asset.json']));
  });

  it('emits each asset once when a map and an explicit directive both name it', () => {
    const withoutDuplicate = assembleProject6502('main', files, '6502');
    const withDuplicate = assembleProject6502('main', [
      { ...files[0]!, content: 'ORG &1900\n.start\nRTS\nINCLUDEASSET "wall.asset.json"\nINCLUDEMAP "level.map.json"' },
      ...files.slice(1),
    ], '6502');
    // A second request for the same artwork must not duplicate its labels or bytes.
    expect(withDuplicate.diagnostics).toEqual([]);
    expect(withDuplicate.bytes.length).toBe(withoutDuplicate.bytes.length);
    expect(withDuplicate.symbols.ASSET_WALL_PIXELS).toBe(withoutDuplicate.symbols.ASSET_WALL_PIXELS);
  });

  it('reports a missing map, a malformed map and a tileset asset the project lacks', () => {
    expect(assembleProject6502('main', [{ ...files[0]!, content: 'ORG &1900\nINCLUDEMAP "gone.map.json"' }], '6502')
      .diagnostics.map((item) => item.message).join(' ')).toMatch(/Included map not found: gone.map.json/);
    expect(assembleProject6502('main', [files[0]!, { id: 'map', name: 'level.map.json', content: '{"schema":"nope"}' }], '6502')
      .diagnostics.map((item) => item.message).join(' ')).toMatch(/Map generation failed/);
    expect(assembleProject6502('main', [files[0]!, files[1]!, files[2]!], '6502')
      .diagnostics.map((item) => item.message).join(' ')).toMatch(/needs tileset asset floor.asset.json, which is not in this project/);
  });
});

describe('palette and font inclusion', () => {
  const palette = JSON.stringify({ schema: '8bit-net.palette', version: 1, name: 'level', mode: 'bbc-mode-5', entries: [0, 1, 3, 7], extensions: {} });
  const font = JSON.stringify({ schema: '8bit-net.font', version: 1, name: 'game', glyphs: [{ code: 224, rows: [1, 2, 3, 4, 5, 6, 7, 8] }], sampleText: '', extensions: {} });
  const files = [
    { id: 'main', name: 'main.asm', content: 'ORG &1900\n.start\nRTS\nINCLUDEPALETTE "level.palette.json"\nINCLUDEFONT "game.font.json"' },
    { id: 'palette', name: 'level.palette.json', content: palette },
    { id: 'font', name: 'game.font.json', content: font },
  ];

  it('emits the VDU streams both documents describe', () => {
    const artifact = assembleProject6502('main', files, '6502');
    expect(artifact.diagnostics).toEqual([]);
    const paletteAt = artifact.symbols.PALETTE_LEVEL! - artifact.origin;
    expect(Array.from(artifact.bytes.slice(paletteAt, paletteAt + 12))).toEqual([19, 0, 0, 0, 0, 0, 19, 1, 1, 0, 0, 0]);
    const fontAt = artifact.symbols.FONT_GAME! - artifact.origin;
    expect(Array.from(artifact.bytes.slice(fontAt, fontAt + 10))).toEqual([23, 224, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(artifact.dependencies).toEqual(expect.arrayContaining(['level.palette.json', 'game.font.json']));
  });

  it('reports a missing or malformed document rather than emitting nothing quietly', () => {
    expect(assembleProject6502('main', [{ ...files[0]!, content: 'ORG &1900\nINCLUDEPALETTE "gone.palette.json"' }], '6502')
      .diagnostics.map((item) => item.message).join(' ')).toMatch(/Included palette not found/);
    expect(assembleProject6502('main', [{ ...files[0]!, content: 'ORG &1900\nINCLUDEFONT "game.font.json"' }, { id: 'font', name: 'game.font.json', content: '{"schema":"nope"}' }], '6502')
      .diagnostics.map((item) => item.message).join(' ')).toMatch(/Font generation failed/);
  });
});
