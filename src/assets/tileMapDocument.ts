/* Versioned, editable tile-map documents.
 *
 * A map paints indices from a tileset, and each tileset entry names a pixel
 * asset document that already exists in the project. That keeps one source of
 * truth for the artwork: editing a tile in the pixel editor changes the map
 * preview and the generated output, and the map itself only ever stores
 * indices, layers and objects.
 *
 * Generation is deterministic and self-describing: a header, one block per
 * layer, a pointer table into the referenced tile assets and an object table.
 * Nothing is emitted for a tileset entry that the build has not included, and
 * the caller is told which entry is missing rather than being given a table
 * with a fabricated address in it. */
import { sha256Hex } from '../build/digest';

export const TILE_MAP_SCHEMA = '8bit-net.tile-map' as const;

export type TileMapObjectKind = 'point' | 'region';

export interface TileMapLayer {
  id: string;
  name: string;
  visible: boolean;
  /** width * height tile indices; 0 means the empty tile. */
  cells: number[];
}

export interface TileMapObject {
  id: string;
  name: string;
  kind: TileMapObjectKind;
  x: number;
  y: number;
  /** Region extent in tiles. A point object is always 1 by 1. */
  width: number;
  height: number;
  /** Author-defined byte properties emitted after the extent. */
  properties: number[];
}

export const MAX_TILE_PROPERTIES = 4;

export interface TileMapTilesetEntry {
  index: number;
  /** Project filename of the pixel asset that draws this index, or null when
   * the index is declared but its artwork has not been chosen yet. */
  assetFile: string | null;
  /** Author-defined bytes the game reads, such as a collision or scoring flag.
   * Every declared index emits the same number of them so the table has a
   * fixed stride. */
  properties: number[];
  /** Optional label, for the editor only; it is not generated. */
  name?: string;
}

export interface TileMapDocument {
  schema: typeof TILE_MAP_SCHEMA;
  version: 1;
  name: string;
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  layers: TileMapLayer[];
  tileset: TileMapTilesetEntry[];
  objects: TileMapObject[];
  extensions: Record<string, unknown>;
}

export const MAX_MAP_DIMENSION = 128;
export const MIN_MAP_DIMENSION = 2;
export const MAX_MAP_LAYERS = 4;
export const MAX_MAP_OBJECTS = 256;
export const MAX_OBJECT_PROPERTIES = 8;
export const MAX_TILESET_ENTRIES = 256;
export const MAX_MAP_CELLS = 16_384;

const TILE_SIZES = new Set([8, 16, 24, 32]);

export function createTileMapDocument(name = 'untitled-map', width = 20, height = 16, tileWidth = 8, tileHeight = 8): TileMapDocument {
  return {
    schema: TILE_MAP_SCHEMA,
    version: 1,
    name,
    width,
    height,
    tileWidth,
    tileHeight,
    layers: [{ id: 'layer-1', name: 'Ground', visible: true, cells: Array(width * height).fill(0) }],
    tileset: [],
    objects: [],
    extensions: {},
  };
}

function dimension(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < MIN_MAP_DIMENSION || (value as number) > MAX_MAP_DIMENSION) {
    throw new Error(`${label} must be a whole number of tiles from ${MIN_MAP_DIMENSION} to ${MAX_MAP_DIMENSION}`);
  }
  return value as number;
}

function tileDimension(value: unknown, label: string): number {
  if (!Number.isInteger(value) || !TILE_SIZES.has(value as number)) throw new Error(`${label} must be 8, 16, 24 or 32 pixels`);
  return value as number;
}

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error(`${label} must contain 1 to ${maximum} characters`);
  return value.trim();
}

export function parseTileMapDocument(value: string | unknown): TileMapDocument {
  const parsed = typeof value === 'string' ? JSON.parse(value) as Record<string, unknown> : value as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Tile map document must be a JSON object');
  if (parsed.schema !== TILE_MAP_SCHEMA || parsed.version !== 1) throw new Error('Unsupported tile map schema or version');
  const name = text(parsed.name, 'Tile map name', 80);
  const width = dimension(parsed.width, 'Map width');
  const height = dimension(parsed.height, 'Map height');
  if (width * height > MAX_MAP_CELLS) throw new Error(`A map is limited to ${MAX_MAP_CELLS.toLocaleString()} tiles`);
  const tileWidth = tileDimension(parsed.tileWidth, 'Tile width');
  const tileHeight = tileDimension(parsed.tileHeight, 'Tile height');

  const tilesetSource = Array.isArray(parsed.tileset) ? parsed.tileset : [];
  if (tilesetSource.length > MAX_TILESET_ENTRIES) throw new Error(`A tileset is limited to ${MAX_TILESET_ENTRIES} entries`);
  const usedIndices = new Set<number>();
  const tileset: TileMapTilesetEntry[] = tilesetSource.map((candidate) => {
    const entry = candidate as Partial<TileMapTilesetEntry>;
    if (!Number.isInteger(entry.index) || (entry.index as number) < 1 || (entry.index as number) > 255) throw new Error('Tileset indices must be whole numbers from 1 to 255; index 0 is always the empty tile');
    if (usedIndices.has(entry.index as number)) throw new Error(`Tileset index ${entry.index} is declared twice`);
    usedIndices.add(entry.index as number);
    const assetFile = entry.assetFile === null || entry.assetFile === undefined ? null : text(entry.assetFile, 'Tileset asset filename', 120);
    const properties = Array.isArray(entry.properties) ? entry.properties : [];
    if (properties.length > MAX_TILE_PROPERTIES) throw new Error(`A tile is limited to ${MAX_TILE_PROPERTIES} properties`);
    if (properties.some((property) => !Number.isInteger(property) || property < 0 || property > 255)) throw new Error(`Tile ${entry.index} has a property that is not a byte`);
    const name = entry.name === undefined ? undefined : text(entry.name, 'Tile name', 40);
    return { index: entry.index as number, assetFile, properties: [...properties] as number[], ...(name ? { name } : {}) };
  }).sort((left, right) => left.index - right.index);

  const layerSource = Array.isArray(parsed.layers) ? parsed.layers : [];
  if (!layerSource.length || layerSource.length > MAX_MAP_LAYERS) throw new Error(`A map must have 1 to ${MAX_MAP_LAYERS} layers`);
  const layerIds = new Set<string>();
  const layers: TileMapLayer[] = layerSource.map((candidate, position) => {
    const layer = candidate as Partial<TileMapLayer>;
    const id = typeof layer.id === 'string' && layer.id.trim() && !layerIds.has(layer.id) ? layer.id.trim().slice(0, 60) : `layer-${position + 1}`;
    if (layerIds.has(id)) throw new Error(`Layer identity ${id} is declared twice`);
    layerIds.add(id);
    if (!Array.isArray(layer.cells) || layer.cells.length !== width * height) throw new Error(`Layer ${id} must contain exactly width by height cells`);
    const cells = layer.cells.map((cell) => {
      if (!Number.isInteger(cell) || (cell as number) < 0 || (cell as number) > 255) throw new Error(`Layer ${id} contains a cell that is not a tile index from 0 to 255`);
      /* A cell may only name an index the tileset declares, so a map can never
       * generate a pointer to artwork that does not exist. */
      if (cell !== 0 && !usedIndices.has(cell as number)) throw new Error(`Layer ${id} uses tile index ${cell}, which the tileset does not declare`);
      return cell as number;
    });
    return { id, name: text(layer.name ?? `Layer ${position + 1}`, 'Layer name', 60), visible: layer.visible !== false, cells };
  });

  const objectSource = Array.isArray(parsed.objects) ? parsed.objects : [];
  if (objectSource.length > MAX_MAP_OBJECTS) throw new Error(`A map is limited to ${MAX_MAP_OBJECTS} objects`);
  const objectIds = new Set<string>();
  const objects: TileMapObject[] = objectSource.map((candidate, position) => {
    const object = candidate as Partial<TileMapObject>;
    const kind: TileMapObjectKind = object.kind === 'region' ? 'region' : 'point';
    const id = typeof object.id === 'string' && object.id.trim() && !objectIds.has(object.id) ? object.id.trim().slice(0, 60) : `object-${position + 1}`;
    if (objectIds.has(id)) throw new Error(`Object identity ${id} is declared twice`);
    objectIds.add(id);
    const x = object.x as number; const y = object.y as number;
    if (!Number.isInteger(x) || x < 0 || x >= width || !Number.isInteger(y) || y < 0 || y >= height) throw new Error(`Object ${id} lies outside the map`);
    const objectWidth = kind === 'point' ? 1 : object.width as number;
    const objectHeight = kind === 'point' ? 1 : object.height as number;
    if (!Number.isInteger(objectWidth) || objectWidth < 1 || x + objectWidth > width || !Number.isInteger(objectHeight) || objectHeight < 1 || y + objectHeight > height) throw new Error(`Object ${id} extends beyond the map`);
    const properties = Array.isArray(object.properties) ? object.properties : [];
    if (properties.length > MAX_OBJECT_PROPERTIES) throw new Error(`Object ${id} declares more than ${MAX_OBJECT_PROPERTIES} properties`);
    if (properties.some((property) => !Number.isInteger(property) || property < 0 || property > 255)) throw new Error(`Object ${id} has a property that is not a byte`);
    return { id, name: text(object.name ?? id, 'Object name', 60), kind, x, y, width: objectWidth, height: objectHeight, properties: [...properties] as number[] };
  });

  const extensions = parsed.extensions && typeof parsed.extensions === 'object' && !Array.isArray(parsed.extensions) ? parsed.extensions as Record<string, unknown> : {};
  return { schema: TILE_MAP_SCHEMA, version: 1, name, width, height, tileWidth, tileHeight, layers, tileset, objects, extensions };
}

export function serializeTileMapDocument(document: TileMapDocument): string {
  return `${JSON.stringify(parseTileMapDocument(document), null, 2)}\n`;
}

export interface TileMapOutput {
  bytes: Uint8Array;
  assembly: string;
  /** Tileset asset filenames this map needs the build to provide. */
  requiredAssets: string[];
  manifest: {
    schema: '8bit-net.generated-map';
    version: 1;
    sourceSchema: typeof TILE_MAP_SCHEMA;
    sourceVersion: 1;
    name: string;
    width: number;
    height: number;
    tileWidth: number;
    tileHeight: number;
    layerCount: number;
    tilesetCount: number;
    objectCount: number;
    /** Property bytes emitted per tile index; zero when none are declared. */
    propertyStride: number;
    /** How many cells across all layers use each declared index. */
    tileUsage: Array<{ index: number; cells: number }>;
    /** Groups of indices that name the same artwork file. */
    duplicateArtwork: Array<{ assetFile: string; indices: number[] }>;
    /** Declared indices whose artwork has not been chosen. */
    unassignedIndices: number[];
    byteLength: number;
    sha256: string;
  };
}

export function tileMapLabel(name: string): string {
  return `map_${name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z_]/, '_$&')}`;
}

/** The label the asset pipeline gives a pixel asset's packed pixel data. */
export function tileAssetLabel(assetFile: string): string {
  const name = assetFile.replace(/\.asset\.json$/i, '');
  return `asset_${name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z_]/, '_$&')}_pixels`;
}

function byteRows(label: string, bytes: number[]): string[] {
  return [
    `.${label}`,
    ...Array.from({ length: Math.max(1, Math.ceil(bytes.length / 16)) }, (_, row) => {
      const slice = bytes.slice(row * 16, row * 16 + 16);
      return slice.length ? `EQUB ${slice.map((byte) => `&${byte.toString(16).toUpperCase().padStart(2, '0')}`).join(', ')}` : '';
    }).filter(Boolean),
  ];
}

/**
 * Generate the map's assembler source and byte image.
 *
 * The header is width, height, layer count, highest declared tile index and
 * object count. Layers follow in declaration order, then a pointer table with
 * one 16-bit address for tile indices 1 to the highest declared index, then the
 * object table.
 */
export function generateTileMapOutput(document: TileMapDocument): TileMapOutput {
  const validated = parseTileMapDocument(document);
  const label = tileMapLabel(validated.name);
  const highestIndex = validated.tileset.reduce((highest, entry) => Math.max(highest, entry.index), 0);

  const propertyStride = validated.tileset.reduce((widest, entry) => Math.max(widest, entry.properties.length), 0);
  const header = [validated.width, validated.height, validated.layers.length, highestIndex, validated.objects.length, propertyStride];
  const layerBytes = validated.layers.flatMap((layer) => layer.cells);
  const objectBytes = validated.objects.flatMap((object) => [
    object.kind === 'region' ? 1 : 0, object.x, object.y, object.width, object.height,
    object.properties.length, ...object.properties,
  ]);

  /* The pointer table is two bytes per index and is emitted as EQUW of real
   * asset labels, so its byte image is not known until the build resolves those
   * labels. The byte image below therefore carries the data the map itself
   * owns; the pointer table is described by the assembly and the manifest. */
  const propertyStrideBytes = Array.from({ length: propertyStride ? highestIndex : 0 }, (_, offset) => {
    const properties = validated.tileset.find((entry) => entry.index === offset + 1)?.properties ?? [];
    return Array.from({ length: propertyStride }, (__, slot) => properties[slot] ?? 0);
  }).flat();
  const bytes = Uint8Array.from([...header, ...layerBytes, ...propertyStrideBytes, ...objectBytes]);

  const lines: string[] = [
    `; Generated tile map ${validated.name} · ${validated.width}x${validated.height} tiles of ${validated.tileWidth}x${validated.tileHeight} pixels`,
    `; ${validated.layers.length} layer(s) · ${validated.tileset.length} tileset entries · ${validated.objects.length} objects`,
    `; ${bytes.length} data bytes · SHA-256 ${sha256Hex(bytes)}`,
    `.${label}`,
    `EQUB ${header.map((value) => `&${value.toString(16).toUpperCase().padStart(2, '0')}`).join(', ')}`,
  ];
  validated.layers.forEach((layer, position) => {
    lines.push(`; layer ${position} · ${layer.name}${layer.visible ? '' : ' (hidden in the editor, still generated)'}`);
    lines.push(...byteRows(`${label}_layer${position}`, layer.cells));
  });
  lines.push(`; tile pointer table for indices 1 to ${highestIndex}`);
  lines.push(`.${label}_tiles`);
  if (highestIndex > 0) {
    const byIndex = new Map(validated.tileset.map((entry) => [entry.index, entry.assetFile]));
    for (let index = 1; index <= highestIndex; index += 1) {
      if (!byIndex.has(index)) { lines.push(`EQUW 0 ; index ${index} is not declared`); continue; }
      const assetFile = byIndex.get(index)!;
      lines.push(assetFile ? `EQUW ${tileAssetLabel(assetFile)}` : `EQUW 0 ; index ${index} has no artwork chosen yet`);
    }
  }
  if (propertyStride > 0) {
    lines.push(`; ${propertyStride} property byte(s) per tile index, 1 to ${highestIndex}`);
    const byIndexProperties = new Map(validated.tileset.map((entry) => [entry.index, entry.properties]));
    const propertyBytes = Array.from({ length: highestIndex }, (_, offset) => {
      const properties = byIndexProperties.get(offset + 1) ?? [];
      return Array.from({ length: propertyStride }, (__, slot) => properties[slot] ?? 0);
    }).flat();
    lines.push(...byteRows(`${label}_tile_properties`, propertyBytes));
  } else {
    lines.push(`.${label}_tile_properties ; no tile declares a property`);
  }
  lines.push(`.${label}_objects`);
  lines.push(...(objectBytes.length ? byteRows(`${label}_object_data`, objectBytes).slice(1) : ['; no objects']));

  return {
    bytes,
    assembly: lines.join('\n'),
    requiredAssets: validated.tileset.flatMap((entry) => entry.assetFile ? [entry.assetFile] : []),
    manifest: {
      schema: '8bit-net.generated-map',
      version: 1,
      sourceSchema: TILE_MAP_SCHEMA,
      sourceVersion: 1,
      name: validated.name,
      width: validated.width,
      height: validated.height,
      tileWidth: validated.tileWidth,
      tileHeight: validated.tileHeight,
      layerCount: validated.layers.length,
      tilesetCount: validated.tileset.length,
      objectCount: validated.objects.length,
      propertyStride,
      tileUsage: validated.tileset.map((entry) => ({
        index: entry.index,
        cells: validated.layers.reduce((total, layer) => total + layer.cells.filter((cell) => cell === entry.index).length, 0),
      })),
      duplicateArtwork: [...validated.tileset.reduce((groups, entry) => {
        if (!entry.assetFile) return groups;
        groups.set(entry.assetFile, [...(groups.get(entry.assetFile) ?? []), entry.index]);
        return groups;
      }, new Map<string, number[]>())].filter(([, indices]) => indices.length > 1).map(([assetFile, indices]) => ({ assetFile, indices })),
      unassignedIndices: validated.tileset.filter((entry) => entry.assetFile === null).map((entry) => entry.index),
      byteLength: bytes.length,
      sha256: sha256Hex(bytes),
    },
  };
}

/* ---- editing operations -------------------------------------------------- */

export function resizeTileMap(document: TileMapDocument, width: number, height: number): TileMapDocument {
  const validated = parseTileMapDocument(document);
  dimension(width, 'Map width'); dimension(height, 'Map height');
  if (width * height > MAX_MAP_CELLS) throw new Error(`A map is limited to ${MAX_MAP_CELLS.toLocaleString()} tiles`);
  const next: TileMapDocument = {
    ...validated,
    width,
    height,
    layers: validated.layers.map((layer) => ({
      ...layer,
      /* Cells inside the retained area keep their value; new area is empty. */
      cells: Array.from({ length: width * height }, (_, cell) => {
        const x = cell % width; const y = Math.floor(cell / width);
        return x < validated.width && y < validated.height ? layer.cells[y * validated.width + x]! : 0;
      }),
    })),
    /* Objects that no longer fit are dropped rather than silently clamped. */
    objects: validated.objects.filter((object) => object.x + object.width <= width && object.y + object.height <= height),
  };
  return parseTileMapDocument(next);
}

export function paintTileMapCell(document: TileMapDocument, layerId: string, x: number, y: number, tile: number): TileMapDocument {
  const validated = parseTileMapDocument(document);
  const layer = validated.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new Error(`Layer ${layerId} is not in this map`);
  if (!Number.isInteger(x) || x < 0 || x >= validated.width || !Number.isInteger(y) || y < 0 || y >= validated.height) throw new Error('The painted cell lies outside the map');
  const cells = [...layer.cells];
  cells[y * validated.width + x] = tile;
  return parseTileMapDocument({ ...validated, layers: validated.layers.map((candidate) => candidate.id === layerId ? { ...candidate, cells } : candidate) });
}

export function fillTileMapArea(document: TileMapDocument, layerId: string, x: number, y: number, width: number, height: number, tile: number): TileMapDocument {
  const validated = parseTileMapDocument(document);
  const layer = validated.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new Error(`Layer ${layerId} is not in this map`);
  if (x < 0 || y < 0 || width < 1 || height < 1 || x + width > validated.width || y + height > validated.height) throw new Error('The filled area lies outside the map');
  const cells = [...layer.cells];
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) cells[row * validated.width + column] = tile;
  }
  return parseTileMapDocument({ ...validated, layers: validated.layers.map((candidate) => candidate.id === layerId ? { ...candidate, cells } : candidate) });
}

export function addTileMapLayer(document: TileMapDocument, name?: string): TileMapDocument {
  const validated = parseTileMapDocument(document);
  if (validated.layers.length >= MAX_MAP_LAYERS) throw new Error(`A map is limited to ${MAX_MAP_LAYERS} layers`);
  const used = new Set(validated.layers.map((layer) => layer.id));
  let number = validated.layers.length + 1;
  while (used.has(`layer-${number}`)) number += 1;
  return parseTileMapDocument({
    ...validated,
    layers: [...validated.layers, { id: `layer-${number}`, name: name ?? `Layer ${number}`, visible: true, cells: Array(validated.width * validated.height).fill(0) }],
  });
}

export function removeTileMapLayer(document: TileMapDocument, layerId: string): TileMapDocument {
  const validated = parseTileMapDocument(document);
  if (validated.layers.length === 1) throw new Error('A map must retain at least one layer');
  if (!validated.layers.some((layer) => layer.id === layerId)) throw new Error(`Layer ${layerId} is not in this map`);
  return parseTileMapDocument({ ...validated, layers: validated.layers.filter((layer) => layer.id !== layerId) });
}

export type TileMapTilesetInput = Omit<TileMapTilesetEntry, 'properties'> & { properties?: number[] };

export function setTileMapTileset(document: TileMapDocument, tileset: readonly TileMapTilesetInput[]): TileMapDocument {
  const validated = parseTileMapDocument(document);
  const declared = new Set(tileset.map((entry) => entry.index));
  /* Removing an index that is still painted would leave the map unparseable, so
   * those cells are cleared explicitly and the caller can see it happen. */
  const layers = validated.layers.map((layer) => ({ ...layer, cells: layer.cells.map((cell) => cell === 0 || declared.has(cell) ? cell : 0) }));
  return parseTileMapDocument({ ...validated, tileset: tileset.map((entry) => ({ properties: [], ...entry })), layers });
}

export function upsertTileMapObject(document: TileMapDocument, object: TileMapObject): TileMapDocument {
  const validated = parseTileMapDocument(document);
  const existing = validated.objects.findIndex((candidate) => candidate.id === object.id);
  const objects = existing < 0 ? [...validated.objects, object] : validated.objects.map((candidate, index) => index === existing ? object : candidate);
  return parseTileMapDocument({ ...validated, objects });
}

export function removeTileMapObject(document: TileMapDocument, objectId: string): TileMapDocument {
  const validated = parseTileMapDocument(document);
  return parseTileMapDocument({ ...validated, objects: validated.objects.filter((object) => object.id !== objectId) });
}

/**
 * Tileset asset filenames a map document references, for dependency tracking.
 * Content that does not parse has no references rather than throwing, because
 * the build reports a malformed map through its own diagnostic.
 */
export function tileMapAssetReferences(content: string): string[] {
  try {
    return parseTileMapDocument(content).tileset.flatMap((entry) => entry.assetFile ? [entry.assetFile] : []);
  } catch { return []; }
}
