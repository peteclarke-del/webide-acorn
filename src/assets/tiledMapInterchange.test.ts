import { describe, expect, it } from 'vitest';
import { exportTiledMap, importTiledMap } from './tiledMapInterchange';
import { parseTileMapDocument, setTileMapTileset, upsertTileMapObject, createTileMapDocument, fillTileMapArea } from './tileMapDocument';

function tiled(overrides: Record<string, unknown> = {}) {
  return {
    type: 'map', version: '1.10', tiledversion: '1.10.2', orientation: 'orthogonal', infinite: false,
    name: 'level', width: 4, height: 3, tilewidth: 8, tileheight: 8,
    tilesets: [{ firstgid: 1, name: 'tiles' }],
    layers: [{ type: 'tilelayer', name: 'Ground', visible: true, width: 4, height: 3, encoding: 'csv', data: [1, 1, 2, 0, 0, 2, 0, 0, 1, 0, 0, 0] }],
    ...overrides,
  };
}

describe('importing a Tiled map', () => {
  it('reads layers, dense indices and provenance', () => {
    const report = importTiledMap(tiled(), 'level.json');
    expect(report.document.width).toBe(4);
    expect(report.document.height).toBe(3);
    expect(report.document.layers[0]!.cells).toEqual([1, 1, 2, 0, 0, 2, 0, 0, 1, 0, 0, 0]);
    expect(report.document.tileset.map((entry) => entry.index)).toEqual([1, 2]);
    expect(report.provenance).toEqual({ sourceName: 'level.json', tiledVersion: '1.10.2', importedFrom: 'tiled-json-1' });
    expect(report.document.extensions).toMatchObject({ importedFrom: 'tiled-json-1', sourceName: 'level.json' });
  });

  it('states what it knows and does not know about licensing', () => {
    const report = importTiledMap(tiled());
    expect(report.licenceNotice).toMatch(/contains no Tiled code, artwork or content/);
    expect(report.licenceNotice).toMatch(/makes no claim about it/);
  });

  it('renumbers sparse global ids densely and says it did', () => {
    const report = importTiledMap(tiled({ layers: [{ type: 'tilelayer', name: 'G', width: 4, height: 3, encoding: 'csv', data: [17, 17, 40, 0, 0, 40, 0, 0, 17, 0, 0, 0] }] }));
    expect(report.document.layers[0]!.cells).toEqual([1, 1, 2, 0, 0, 2, 0, 0, 1, 0, 0, 0]);
    expect(report.adjustments.join(' ')).toMatch(/global ids 17 to 40 were renumbered to indices 1 to 2/);
  });

  it('names every feature it cannot represent instead of dropping it quietly', () => {
    const report = importTiledMap(tiled({
      tilesets: [{ firstgid: 1, source: 'shared.tsx' }],
      layers: [
        tiled().layers[0],
        { type: 'imagelayer', name: 'Backdrop' },
        { type: 'group', name: 'Folder' },
        { type: 'objectgroup', name: 'Things', objects: [{ id: 1, name: 'Spawn', x: 8, y: 8 }, { id: 2, name: 'Zone', x: 0, y: 0, width: 16, height: 8 }, { id: 3, name: 'Path', x: 0, y: 0, polygon: [] }] },
      ],
    }));
    const joined = report.unsupported.join(' ');
    expect(joined).toMatch(/Image layer "Backdrop"/);
    expect(joined).toMatch(/Layer group "Folder"/);
    expect(joined).toMatch(/external tileset reference/);
    expect(joined).toMatch(/Object "Path" uses a shape or text/);
    expect(report.document.objects.map((object) => [object.name, object.kind, object.x, object.y])).toEqual([
      ['Spawn', 'point', 1, 1], ['Zone', 'region', 0, 0], ['Path', 'point', 0, 0],
    ]);
  });

  it('reports flip and rotation flags and imports those tiles unflipped', () => {
    const flippedGid = 1 | 0x80000000;
    const report = importTiledMap(tiled({ layers: [{ type: 'tilelayer', name: 'G', width: 4, height: 3, encoding: 'csv', data: [flippedGid, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }] }));
    expect(report.unsupported.join(' ')).toMatch(/1 tile placement carried a flip or rotation flag/);
    expect(report.document.layers[0]!.cells[0]).toBe(1);
  });

  it('keeps only the layers this build holds and says which it dropped', () => {
    const layer = (name: string) => ({ type: 'tilelayer', name, width: 4, height: 3, encoding: 'csv', data: Array(12).fill(1) });
    const report = importTiledMap(tiled({ layers: ['a', 'b', 'c', 'd', 'e'].map(layer) }));
    expect(report.document.layers).toHaveLength(4);
    expect(report.adjustments.join(' ')).toMatch(/"e" was not imported/);
  });

  it('refuses what it cannot import at all, with the reason', () => {
    expect(() => importTiledMap(tiled({ infinite: true }))).toThrow(/Infinite Tiled maps/);
    expect(() => importTiledMap(tiled({ orientation: 'isometric' }))).toThrow(/orthogonal maps only/);
    expect(() => importTiledMap(tiled({ width: 400 }))).toThrow(/up to 128 by 128 tiles/);
    expect(() => importTiledMap(tiled({ layers: [{ type: 'tilelayer', name: 'G', width: 4, height: 3, encoding: 'base64', compression: 'zlib', data: 'x' }] }))).toThrow(/compressed/);
    expect(() => importTiledMap(tiled({ layers: [{ type: 'tilelayer', name: 'G', width: 4, height: 3, encoding: 'csv', data: [1, 2] }] }))).toThrow(/holds 2 tiles, not the 12/);
    expect(() => importTiledMap(tiled({ layers: [{ type: 'objectgroup', name: 'O', objects: [] }] }))).toThrow(/no tile layer/);
    expect(() => importTiledMap({ type: 'tileset' })).toThrow(/not a Tiled map/);
  });

  it('records a tile size it cannot hold without changing the layout', () => {
    const report = importTiledMap(tiled({ tilewidth: 12, tileheight: 12 }));
    expect(report.document.tileWidth).toBe(8);
    expect(report.adjustments.join(' ')).toMatch(/Tile size 12 by 12 is not one this build supports/);
    expect(report.document.layers[0]!.cells).toEqual([1, 1, 2, 0, 0, 2, 0, 0, 1, 0, 0, 0]);
  });
});

describe('exporting to Tiled and back', () => {
  const source = () => {
    const base = setTileMapTileset(createTileMapDocument('level', 4, 3), [
      { index: 1, assetFile: 'wall.asset.json' },
      { index: 2, assetFile: null },
    ]);
    const painted = fillTileMapArea(base, 'layer-1', 0, 0, 4, 1, 1);
    return upsertTileMapObject(painted, { id: 'spawn', name: 'Spawn', kind: 'region', x: 1, y: 1, width: 2, height: 2, properties: [7] });
  };

  it('round-trips layers, indices and objects', () => {
    const exported = exportTiledMap(source());
    const report = importTiledMap(exported, 'round-trip.json');
    expect(report.document.width).toBe(source().width);
    expect(report.document.layers[0]!.cells).toEqual(source().layers[0]!.cells);
    expect(report.document.objects.map((object) => [object.kind, object.x, object.y, object.width, object.height]))
      .toEqual([['region', 1, 1, 2, 2]]);
  });

  it('writes a document Tiled itself would recognise', () => {
    const map = JSON.parse(exportTiledMap(source()));
    expect(map).toMatchObject({ type: 'map', orientation: 'orthogonal', infinite: false, width: 4, height: 3 });
    expect(map.layers[0]).toMatchObject({ type: 'tilelayer', encoding: 'csv' });
    expect(map.layers[0].data).toHaveLength(12);
    expect(map.layers[1]).toMatchObject({ type: 'objectgroup' });
    expect(map.layers[1].objects[0]).toMatchObject({ name: 'Spawn', x: 8, y: 8, width: 16, height: 16 });
  });

  it('does not claim to export artwork it does not hold', () => {
    const map = JSON.parse(exportTiledMap(source()));
    expect(map.tilesets[0].image).toBeUndefined();
    expect(parseTileMapDocument(source()).tileset[0]!.assetFile).toBe('wall.asset.json');
  });
});
