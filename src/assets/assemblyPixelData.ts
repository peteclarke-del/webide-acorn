/* Recover editable assets from assembler data that already exists in a project.
 *
 * An imported codebase usually keeps its graphics as labelled `EQUB` runs. This
 * module finds those runs and offers the ones whose byte count matches a real
 * pixel-asset geometry. The offer is only made when unpacking and repacking the
 * bytes reproduces them exactly, so promoting a run to an editable document can
 * never change what the build emits. Runs that merely look like level data are
 * reported with their possible grid shapes and nothing is created for them,
 * because this build has no map document to create. */
import { createPixelAssetDocument, serializePixelAssetDocument, type PixelAssetDocument, type PixelAssetKind, type PixelPacking } from './pixelAssetDocument';
import { packBbcMode5Pixels, packTwoBitPixels, unpackBbcMode5Pixels, unpackTwoBitPixels } from './pixelPacking';
import { createTileMapDocument, parseTileMapDocument, type TileMapDocument } from './tileMapDocument';

/** A labelled run of byte data found in assembler source. */
export interface AssemblyByteRun {
  fileName: string;
  label: string;
  /** 1-based line of the label. */
  line: number;
  bytes: number[];
}

export interface DerivedPixelAsset {
  id: string;
  fileName: string;
  name: string;
  sourceFile: string;
  sourceLabel: string;
  sourceLine: number;
  kind: PixelAssetKind;
  width: number;
  height: number;
  packing: PixelPacking;
  byteLength: number;
  /** True when the same run also has the small alphabet of tile-map data, so
   * the user can see that the geometry is not the only reading of it. */
  alsoLooksLikeMapData: boolean;
  /** Serialized editable document that regenerates the original bytes. */
  document: string;
}

export interface TileMapCandidate {
  id: string;
  sourceFile: string;
  sourceLabel: string;
  sourceLine: number;
  byteLength: number;
  distinctValues: number;
  /** The run's byte values, so a real map document can be built from them. */
  values: number[];
  /** Grid shapes the byte count allows, widest first. */
  shapes: Array<{ width: number; height: number }>;
}

const PIXEL_SIZES = [8, 16, 24, 32] as const;
const MAX_RUN_BYTES = 4096;

function parseByteItem(token: string): number | null {
  const value = token.trim();
  if (/^&[0-9a-f]{1,2}$/i.test(value)) return Number.parseInt(value.slice(1), 16);
  if (/^\$[0-9a-f]{1,2}$/i.test(value)) return Number.parseInt(value.slice(1), 16);
  if (/^%[01]{1,8}$/.test(value)) return Number.parseInt(value.slice(1), 2);
  if (/^\d{1,3}$/.test(value)) { const numeric = Number(value); return numeric <= 0xff ? numeric : null; }
  return null;
}

function stripComment(line: string): string {
  const semicolon = line.indexOf(';');
  return semicolon < 0 ? line : line.slice(0, semicolon);
}

/**
 * Labelled runs of consecutive numeric `EQUB`/`BYTE` lines. A run ends at the
 * next label, at any other instruction or directive, or at a non-numeric item,
 * so a run always describes exactly the bytes that follow its own label.
 */
export function assemblyByteRuns(fileName: string, source: string): AssemblyByteRun[] {
  const runs: AssemblyByteRun[] = [];
  let current: AssemblyByteRun | null = null;
  const finish = () => { if (current && current.bytes.length) runs.push(current); current = null; };

  source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n').forEach((rawLine, index) => {
    const code = stripComment(rawLine).trim();
    if (!code) return;
    const label = /^(?:\.([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*):)\s*(.*)$/.exec(code);
    if (label) {
      finish();
      current = { fileName, label: (label[1] ?? label[2])!, line: index + 1, bytes: [] };
      if (!label[3]) return;
      appendData(current, label[3], finish);
      return;
    }
    if (!current) return;
    appendData(current, code, finish);
  });
  finish();
  return runs.filter((run) => run.bytes.length <= MAX_RUN_BYTES);
}

function appendData(run: AssemblyByteRun, code: string, finish: () => void) {
  const directive = /^(EQUB|BYTE)\b\s*(.*)$/i.exec(code);
  if (!directive) { finish(); return; }
  const items = (directive[2] ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!items.length) { finish(); return; }
  const values = items.map(parseByteItem);
  if (values.some((value) => value === null)) { finish(); return; }
  run.bytes.push(...(values as number[]));
}

/** Width and height pairs a 2 bits-per-pixel run of this length can represent. */
export function pixelGeometriesFor(byteLength: number): Array<{ width: number; height: number }> {
  const pixels = byteLength * 4;
  const geometries: Array<{ width: number; height: number }> = [];
  for (const width of PIXEL_SIZES) {
    for (const height of PIXEL_SIZES) {
      if (width * height === pixels) geometries.push({ width, height });
    }
  }
  /* A square asset is the usual intent, so offer it first. */
  return geometries.sort((left, right) => Math.abs(left.width - left.height) - Math.abs(right.width - right.height) || right.width - left.width);
}

function documentFor(name: string, kind: PixelAssetKind, width: number, height: number, packing: PixelPacking, bytes: number[]): PixelAssetDocument | null {
  const pixels = packing === 'bbc-mode-5-hardware-interleaved-2bpp' ? unpackBbcMode5Pixels(bytes) : unpackTwoBitPixels(bytes);
  if (pixels.length !== width * height) return null;
  const repacked = Array.from(packing === 'bbc-mode-5-hardware-interleaved-2bpp' ? packBbcMode5Pixels(pixels) : packTwoBitPixels(pixels));
  /* Refuse anything that does not reproduce the original bytes exactly. */
  if (repacked.length !== bytes.length || repacked.some((byte, index) => byte !== bytes[index])) return null;
  const document = createPixelAssetDocument(kind, width, height);
  document.name = name;
  document.pixels = pixels;
  document.target = { ...document.target, packing };
  if (document.sprite) document.sprite.mask = pixels.map((pixel) => (pixel === 0 ? 0 : 1));
  return document;
}

function assetName(label: string): string {
  const cleaned = label.replace(/^(?:asset_)?/i, '').replace(/_(?:pixels|data|sprite|tile|gfx)$/i, '').replace(/[^A-Za-z0-9_]/g, '_');
  return (cleaned || label).slice(0, 60);
}

export interface PixelAssetCandidateOptions {
  /** Packing to propose. Both are reversible, so this is a presentation choice. */
  packing?: PixelPacking;
  kind?: PixelAssetKind;
}

/**
 * Pixel assets that can be recovered from the given runs. Runs whose byte count
 * has no valid geometry, or which do not round-trip, are simply not offered.
 */
export function pixelAssetCandidates(
  runs: readonly AssemblyByteRun[],
  existingFileNames: ReadonlySet<string> = new Set(),
  options: PixelAssetCandidateOptions = {},
): DerivedPixelAsset[] {
  const packing = options.packing ?? 'bbc-mode-5-hardware-interleaved-2bpp';
  const kind = options.kind ?? 'tile';
  const used = new Set(existingFileNames);
  const mapLike = new Set(tileMapCandidates(runs).map((candidate) => candidate.id));
  const candidates: DerivedPixelAsset[] = [];
  for (const run of runs) {
    const geometry = pixelGeometriesFor(run.bytes.length)[0];
    if (!geometry) continue;
    const name = assetName(run.label);
    const document = documentFor(name, kind, geometry.width, geometry.height, packing, run.bytes);
    if (!document) continue;
    let fileName = `${name}.asset.json`;
    let counter = 2;
    while (used.has(fileName.toLowerCase())) { fileName = `${name}-${counter}.asset.json`; counter += 1; }
    used.add(fileName.toLowerCase());
    candidates.push({
      id: `${run.fileName}:${run.label}`,
      fileName,
      name,
      sourceFile: run.fileName,
      sourceLabel: run.label,
      sourceLine: run.line,
      kind,
      width: geometry.width,
      height: geometry.height,
      packing,
      byteLength: run.bytes.length,
      alsoLooksLikeMapData: mapLike.has(`${run.fileName}:${run.label}`),
      document: serializePixelAssetDocument(document),
    });
  }
  return candidates;
}

/**
 * Runs that look like tile-map data. These are reported only: this build has no
 * map document, so nothing is created and no grid shape is chosen for the user.
 */
export function tileMapCandidates(runs: readonly AssemblyByteRun[]): TileMapCandidate[] {
  const candidates: TileMapCandidate[] = [];
  for (const run of runs) {
    if (run.bytes.length < 32) continue;
    const distinct = new Set(run.bytes);
    /* A map uses a small alphabet of tile indices; pixel or code data does not. */
    if (distinct.size > 16 || Math.max(...run.bytes) > 63) continue;
    const shapes: Array<{ width: number; height: number }> = [];
    for (let width = 4; width <= 64; width += 1) {
      if (run.bytes.length % width !== 0) continue;
      const height = run.bytes.length / width;
      if (height >= 4 && height <= 64) shapes.push({ width, height });
    }
    if (!shapes.length) continue;
    candidates.push({
      id: `${run.fileName}:${run.label}`,
      sourceFile: run.fileName,
      sourceLabel: run.label,
      sourceLine: run.line,
      byteLength: run.bytes.length,
      distinctValues: distinct.size,
      values: [...run.bytes],
      shapes: shapes.sort((left, right) => right.width - left.width),
    });
  }
  return candidates;
}

/**
 * Build a real, editable tile map from a detected run of level data.
 *
 * Every distinct non-zero value becomes a declared tileset index with no
 * artwork chosen yet, so the map is honest about what was and was not recovered:
 * the layout is genuine, the pictures are not guessed. The chosen grid shape
 * must be one the run's length actually allows.
 */
export function tileMapFromCandidate(candidate: TileMapCandidate, width: number, height: number, name = candidate.sourceLabel): TileMapDocument {
  if (!candidate.shapes.some((shape) => shape.width === width && shape.height === height)) {
    throw new Error(`${candidate.byteLength} bytes cannot be read as a ${width} by ${height} grid`);
  }
  const distinct = [...new Set(candidate.values)].filter((value) => value !== 0).sort((left, right) => left - right);
  const document = createTileMapDocument(name.replace(/_(?:map|level|data)$/i, '') || name, width, height);
  return parseTileMapDocument({
    ...document,
    tileset: distinct.map((index) => ({ index, assetFile: null })),
    layers: [{ ...document.layers[0]!, name: 'Imported', cells: [...candidate.values] }],
  });
}
