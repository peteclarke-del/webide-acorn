/* Interchange with the Tiled JSON tile-map format.
 *
 * Tiled describes far more than this build's map document can hold, so import
 * is deliberately narrow and loud: everything the format carries that cannot be
 * represented here is listed before anything is created, and nothing is guessed
 * to fill a gap. Export writes back only what the document actually holds and
 * records where it came from, so a round trip through this pair reproduces the
 * layers, tile indices and objects it started with.
 *
 * The Tiled map format is an open, publicly documented interchange format. Only
 * the format is used here: no Tiled code, artwork or content is included, and an
 * imported file's own licence remains the importer's responsibility, which the
 * result states rather than assumes.
 */
import {
  createTileMapDocument, MAX_MAP_DIMENSION, MAX_MAP_LAYERS, MAX_MAP_OBJECTS, MIN_MAP_DIMENSION,
  parseTileMapDocument, type TileMapDocument, type TileMapObject,
} from './tileMapDocument';

/** Tiled stores rotation and flip state in the top three bits of a tile id. */
const FLIP_FLAGS = 0xe0000000;
const GID_MASK = 0x1fffffff;

export interface TiledImportReport {
  document: TileMapDocument;
  /** Where the data came from, carried into the document's extensions. */
  provenance: { sourceName: string; tiledVersion: string | null; importedFrom: 'tiled-json-1' };
  /** Everything in the file this build cannot represent, named individually. */
  unsupported: string[];
  /** Changes made to fit this build's limits, each with its reason. */
  adjustments: string[];
  /** Statement of what the importer does and does not know about licensing. */
  licenceNotice: string;
}

const LICENCE_NOTICE =
  'The Tiled map format is open and publicly documented; this importer contains no Tiled code, artwork or content. '
  + 'Whatever licence covers the file you imported still covers the data it carried, and this build makes no claim about it.';

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
  return value as Record<string, unknown>;
}

/**
 * Read a Tiled JSON map into this build's tile-map document.
 *
 * Only finite, orthogonal maps with uncompressed tile-layer data are accepted.
 * Anything else is refused with the reason rather than partially imported.
 */
export function importTiledMap(value: string | unknown, sourceName = 'map.json'): TiledImportReport {
  const parsed = asRecord(typeof value === 'string' ? JSON.parse(value) : value, 'A Tiled map');
  const unsupported: string[] = [];
  const adjustments: string[] = [];

  if (parsed.type !== undefined && parsed.type !== 'map') throw new Error('That JSON file is not a Tiled map');
  if (parsed.orientation !== undefined && parsed.orientation !== 'orthogonal') throw new Error(`This build imports orthogonal maps only, not ${String(parsed.orientation)}`);
  if (parsed.infinite === true) throw new Error('Infinite Tiled maps cannot be imported; save the map with a fixed size first');

  const width = Number(parsed.width);
  const height = Number(parsed.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < MIN_MAP_DIMENSION || height < MIN_MAP_DIMENSION) {
    throw new Error('The Tiled map does not declare a usable width and height in tiles');
  }
  if (width > MAX_MAP_DIMENSION || height > MAX_MAP_DIMENSION) {
    throw new Error(`This build holds maps up to ${MAX_MAP_DIMENSION} by ${MAX_MAP_DIMENSION} tiles; that map is ${width} by ${height}`);
  }

  const tileWidth = Number(parsed.tilewidth);
  const tileHeight = Number(parsed.tileheight);
  const supportedTileSize = new Set([8, 16, 24, 32]);
  const useTileWidth = supportedTileSize.has(tileWidth) ? tileWidth : 8;
  const useTileHeight = supportedTileSize.has(tileHeight) ? tileHeight : 8;
  if (useTileWidth !== tileWidth || useTileHeight !== tileHeight) {
    adjustments.push(`Tile size ${tileWidth} by ${tileHeight} is not one this build supports, so the map records ${useTileWidth} by ${useTileHeight}; the layout is unchanged.`);
  }

  const rawLayers = Array.isArray(parsed.layers) ? parsed.layers : [];
  const tileLayers: Array<{ name: string; data: number[]; visible: boolean }> = [];
  const objects: TileMapObject[] = [];

  for (const candidate of rawLayers) {
    const layer = asRecord(candidate, 'A Tiled layer');
    const name = typeof layer.name === 'string' && layer.name.trim() ? layer.name.trim().slice(0, 60) : `Layer ${tileLayers.length + 1}`;
    if (layer.type === 'imagelayer') { unsupported.push(`Image layer "${name}" was not imported; this build has no image layer.`); continue; }
    if (layer.type === 'group') { unsupported.push(`Layer group "${name}" was not imported; nested groups are not represented.`); continue; }
    if (layer.type === 'objectgroup') {
      for (const objectCandidate of Array.isArray(layer.objects) ? layer.objects : []) {
        const object = asRecord(objectCandidate, 'A Tiled object');
        const pixelX = Number(object.x) || 0;
        const pixelY = Number(object.y) || 0;
        const x = Math.min(width - 1, Math.max(0, Math.floor(pixelX / (tileWidth || 1))));
        const y = Math.min(height - 1, Math.max(0, Math.floor(pixelY / (tileHeight || 1))));
        const pixelWidth = Number(object.width) || 0;
        const pixelHeight = Number(object.height) || 0;
        const spanX = Math.max(1, Math.round(pixelWidth / (tileWidth || 1)));
        const spanY = Math.max(1, Math.round(pixelHeight / (tileHeight || 1)));
        const kind = pixelWidth > 0 && pixelHeight > 0 ? 'region' : 'point';
        if (object.polygon || object.polyline || object.ellipse || object.text) {
          unsupported.push(`Object "${String(object.name ?? object.id ?? 'unnamed')}" uses a shape or text this build does not hold; its position was kept as a ${kind}.`);
        }
        if (objects.length >= MAX_MAP_OBJECTS) {
          adjustments.push(`Only the first ${MAX_MAP_OBJECTS} objects were imported.`);
          break;
        }
        objects.push({
          id: `object-${objects.length + 1}`,
          name: typeof object.name === 'string' && object.name.trim() ? object.name.trim().slice(0, 60) : `Object ${objects.length + 1}`,
          kind,
          x, y,
          width: kind === 'region' ? Math.min(spanX, width - x) : 1,
          height: kind === 'region' ? Math.min(spanY, height - y) : 1,
          properties: [],
        });
      }
      continue;
    }
    if (layer.type !== undefined && layer.type !== 'tilelayer') { unsupported.push(`Layer "${name}" has type ${String(layer.type)}, which was not imported.`); continue; }
    if (layer.compression) throw new Error(`Layer "${name}" is ${String(layer.compression)} compressed; export the map with uncompressed CSV data`);
    if (layer.encoding !== undefined && layer.encoding !== 'csv') throw new Error(`Layer "${name}" uses ${String(layer.encoding)} encoding; export the map with CSV data`);
    const data = layer.data;
    if (!Array.isArray(data)) throw new Error(`Layer "${name}" has no readable tile data`);
    if (data.length !== width * height) throw new Error(`Layer "${name}" holds ${data.length} tiles, not the ${width * height} its map declares`);
    tileLayers.push({ name, data: data.map((entry) => Number(entry) || 0), visible: layer.visible !== false });
  }

  if (!tileLayers.length) throw new Error('That Tiled map has no tile layer to import');
  const droppedLayers = tileLayers.slice(MAX_MAP_LAYERS);
  if (droppedLayers.length) adjustments.push(`This build holds ${MAX_MAP_LAYERS} layers, so ${droppedLayers.map((layer) => `"${layer.name}"`).join(', ')} ${droppedLayers.length === 1 ? 'was' : 'were'} not imported.`);
  const kept = tileLayers.slice(0, MAX_MAP_LAYERS);

  /* Tiled numbers tiles globally from each tileset's firstgid. This build has
   * one flat index space, so global ids are renumbered densely and the mapping
   * is reported rather than silently applied. */
  let flipped = 0;
  const usedGids = new Set<number>();
  for (const layer of kept) for (const raw of layer.data) {
    if (raw & FLIP_FLAGS) flipped += 1;
    const gid = raw & GID_MASK;
    if (gid) usedGids.add(gid);
  }
  if (flipped) unsupported.push(`${flipped} tile placement${flipped === 1 ? '' : 's'} carried a flip or rotation flag, which this build does not hold; those tiles were imported unflipped.`);
  const ordered = [...usedGids].sort((left, right) => left - right);
  if (ordered.length > 255) throw new Error(`That map uses ${ordered.length} distinct tiles; this build holds 255`);
  const indexByGid = new Map(ordered.map((gid, position) => [gid, position + 1]));
  if (ordered.length && (ordered[0] !== 1 || ordered[ordered.length - 1] !== ordered.length)) {
    adjustments.push(`Tiled global ids ${ordered[0]} to ${ordered[ordered.length - 1]} were renumbered to indices 1 to ${ordered.length}.`);
  }

  const externalTilesets = (Array.isArray(parsed.tilesets) ? parsed.tilesets : []).filter((candidate) => asRecord(candidate, 'A Tiled tileset').source !== undefined);
  if (externalTilesets.length) unsupported.push(`${externalTilesets.length} external tileset reference${externalTilesets.length === 1 ? '' : 's'} could not be followed; every tile index was imported with no artwork chosen.`);

  const base = createTileMapDocument(typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : sourceName.replace(/\.[^.]+$/, ''), width, height, useTileWidth, useTileHeight);
  const document = parseTileMapDocument({
    ...base,
    tileset: ordered.map((gid) => ({ index: indexByGid.get(gid)!, assetFile: null, properties: [] })),
    layers: kept.map((layer, position) => ({
      id: `layer-${position + 1}`,
      name: layer.name,
      visible: layer.visible,
      cells: layer.data.map((raw) => indexByGid.get(raw & GID_MASK) ?? 0),
    })),
    objects,
    extensions: {
      importedFrom: 'tiled-json-1',
      sourceName,
      ...(typeof parsed.tiledversion === 'string' ? { tiledVersion: parsed.tiledversion } : {}),
    },
  });

  return {
    document,
    provenance: { sourceName, tiledVersion: typeof parsed.tiledversion === 'string' ? parsed.tiledversion : null, importedFrom: 'tiled-json-1' },
    unsupported,
    adjustments,
    licenceNotice: LICENCE_NOTICE,
  };
}

/**
 * Write a tile-map document back out as a Tiled JSON map.
 *
 * Only what the document holds is written: layers, dense tile indices and point
 * or region objects. Tile artwork is not exported because the document names
 * project asset files rather than a Tiled tileset image.
 */
export function exportTiledMap(document: TileMapDocument): string {
  const validated = parseTileMapDocument(document);
  const map = {
    type: 'map',
    version: '1.10',
    orientation: 'orthogonal',
    renderorder: 'right-down',
    infinite: false,
    name: validated.name,
    width: validated.width,
    height: validated.height,
    tilewidth: validated.tileWidth,
    tileheight: validated.tileHeight,
    nextlayerid: validated.layers.length + 2,
    nextobjectid: validated.objects.length + 1,
    tilesets: validated.tileset.length ? [{ firstgid: 1, name: `${validated.name} tiles`, tilecount: validated.tileset.reduce((highest, entry) => Math.max(highest, entry.index), 0), tilewidth: validated.tileWidth, tileheight: validated.tileHeight, columns: 1 }] : [],
    layers: [
      ...validated.layers.map((layer, position) => ({
        type: 'tilelayer', id: position + 1, name: layer.name, visible: layer.visible, opacity: 1,
        x: 0, y: 0, width: validated.width, height: validated.height,
        encoding: 'csv', data: layer.cells,
      })),
      ...(validated.objects.length ? [{
        type: 'objectgroup', id: validated.layers.length + 1, name: 'Objects', visible: true, opacity: 1,
        objects: validated.objects.map((object, position) => ({
          id: position + 1, name: object.name,
          x: object.x * validated.tileWidth, y: object.y * validated.tileHeight,
          width: object.kind === 'region' ? object.width * validated.tileWidth : 0,
          height: object.kind === 'region' ? object.height * validated.tileHeight : 0,
          visible: true, rotation: 0,
          properties: object.properties.map((property, slot) => ({ name: `property${slot}`, type: 'int', value: property })),
        })),
      }] : []),
    ],
  };
  return `${JSON.stringify(map, null, 2)}\n`;
}
