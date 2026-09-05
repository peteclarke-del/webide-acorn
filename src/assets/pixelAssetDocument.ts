import { sha256Hex } from '../build/digest';
import { fitsScreenBlocks, packBbcMode5Pixels, packBbcScreenBlocks, packOpaqueMask, packTwoBitPixels } from './pixelPacking';

export type PixelAssetKind = 'character' | 'sprite' | 'tile';
/*
 * How a picture becomes bytes.
 *
 * The first two say how four pixels sit inside one byte and leave the bytes in
 * row order. The third is the order the machine itself stores a picture in:
 * eight-scanline blocks, four pixels wide, columns across before rows down. It
 * is what every generator that targets the BBC emits, and reading such data as
 * rows gives a recognisable picture cut into strips.
 */
export type PixelPacking =
  | 'logical-2bpp-msb-groups'
  | 'bbc-mode-5-hardware-interleaved-2bpp'
  | 'bbc-screen-2bpp-eight-line-blocks';

/* The one schema every character, sprite and tile document carries. */
export const PIXEL_ASSET_SCHEMA = '8bit-net.pixel-asset' as const;

export interface PixelSpriteFrame {
  id: string;
  name: string;
  durationMs: number;
  pixels: number[];
  mask: number[];
  hotspot: { x: number; y: number };
}

export interface PixelAssetDocument {
  schema: typeof PIXEL_ASSET_SCHEMA;
  version: 1;
  name: string;
  kind: PixelAssetKind;
  width: number;
  height: number;
  pixels: number[];
  palette: { indices: [number, number, number, number]; interpretation: 'logical-acorn-colours' };
  target: { family: 'acorn-8-bit'; packing: PixelPacking; previewPixelAspect: 'square-editor-preview' };
  sprite?: {
    hotspot: { x: number; y: number };
    mask: number[];
    maskSemantics: '1-opaque-0-transparent';
    frame: { name: string; durationMs: number };
    animation?: { playback: 'loop' | 'once'; frames: PixelSpriteFrame[] };
  };
  extensions: Record<string, unknown>;
}

export interface PixelAssetOutput {
  bytes: Uint8Array;
  maskBytes?: Uint8Array;
  assembly: string;
  manifest: {
    schema: '8bit-net.generated-asset'; version: 1; sourceSchema: PixelAssetDocument['schema']; sourceVersion: 1;
    name: string; kind: PixelAssetKind; width: number; height: number; packing: PixelAssetDocument['target']['packing'];
    byteLength: number; sha256: string; hotspot?: { x: number; y: number }; maskPacking?: '1bpp-msb-eight-pixels-per-byte'; maskByteLength?: number; maskSha256?: string;
    frameCount?: number; frameByteLength?: number; frameDurationsMs?: number[]; playback?: 'loop' | 'once';
  };
}

const SIZES = new Set([8, 16, 24, 32]);

export function createPixelAssetDocument(kind: PixelAssetKind, width = kind === 'sprite' ? 16 : 8, height = kind === 'sprite' ? 16 : 8): PixelAssetDocument {
  return {
    schema: PIXEL_ASSET_SCHEMA, version: 1, name: `untitled-${kind}`, kind, width, height,
    pixels: Array(width * height).fill(0),
    palette: { indices: [0, 1, 2, 3], interpretation: 'logical-acorn-colours' },
    target: { family: 'acorn-8-bit', packing: 'logical-2bpp-msb-groups', previewPixelAspect: 'square-editor-preview' },
    ...(kind === 'sprite' ? { sprite: { hotspot: { x: 0, y: 0 }, mask: Array(width * height).fill(1), maskSemantics: '1-opaque-0-transparent' as const, frame: { name: 'Frame 1', durationMs: 100 } } } : {}), extensions: {},
  };
}

function validateDimensions(width: unknown, height: unknown): asserts width is number {
  if (!Number.isInteger(width) || !SIZES.has(width as number) || !Number.isInteger(height) || !SIZES.has(height as number)) throw new Error('Pixel asset width and height must each be 8, 16, 24 or 32');
}

function frameName(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !value.trim() || value.length > 40) throw new Error('Sprite frame names must contain 1–40 characters');
  return value.trim();
}

function frameDuration(value: unknown): number {
  if (value === undefined) return 100;
  if (!Number.isInteger(value) || (value as number) < 20 || (value as number) > 60_000) throw new Error('Sprite frame duration must be an integer from 20–60,000 ms');
  return value as number;
}

function validateFramePixels(value: unknown, count: number, label: string): number[] {
  if (!Array.isArray(value) || value.length !== count) throw new Error(`${label} pixel array length must equal width × height`);
  return value.map(pixelIndex);
}

function validateFrameMask(value: unknown, count: number, label: string): number[] {
  if (!Array.isArray(value) || value.length !== count || value.some((bit) => bit !== 0 && bit !== 1)) throw new Error(`${label} mask must contain exactly one 0/1 value per pixel`);
  return [...value];
}

function validateHotspot(value: unknown, width: number, height: number, label: string): { x: number; y: number } {
  const hotspot = value as { x?: unknown; y?: unknown } | undefined;
  if (!hotspot || !Number.isInteger(hotspot.x) || !Number.isInteger(hotspot.y) || (hotspot.x as number) < 0 || (hotspot.y as number) < 0 || (hotspot.x as number) >= width || (hotspot.y as number) >= height) throw new Error(`${label} hotspot must lie inside the asset`);
  return { x: hotspot.x as number, y: hotspot.y as number };
}

export function parsePixelAssetDocument(value: string | unknown, fallbackKind: PixelAssetKind = 'sprite'): PixelAssetDocument {
  const parsed = typeof value === 'string' ? JSON.parse(value) as Record<string, unknown> : value as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Pixel asset document must be a JSON object');
  // Migration for the original browser-local {width,height,pixels} draft.
  if (parsed.schema === undefined && parsed.version === undefined) {
    validateDimensions(parsed.width, parsed.height);
    if (!Array.isArray(parsed.pixels) || parsed.pixels.length !== parsed.width * (parsed.height as number)) throw new Error('Legacy pixel asset data has the wrong pixel count');
    const migrated = createPixelAssetDocument(fallbackKind, parsed.width, parsed.height as number);
    migrated.pixels = parsed.pixels.map(pixelIndex);
    return migrated;
  }
  if (parsed.schema !== PIXEL_ASSET_SCHEMA || parsed.version !== 1) throw new Error('Unsupported pixel asset schema or version');
  if (!['character', 'sprite', 'tile'].includes(String(parsed.kind))) throw new Error('Pixel asset kind must be character, sprite or tile');
  validateDimensions(parsed.width, parsed.height);
  if (typeof parsed.name !== 'string' || !parsed.name.trim() || parsed.name.length > 80) throw new Error('Pixel asset name must contain 1–80 characters');
  if (!Array.isArray(parsed.pixels) || parsed.pixels.length !== parsed.width * (parsed.height as number)) throw new Error('Pixel array length must equal width × height');
  const expected = createPixelAssetDocument(parsed.kind as PixelAssetKind, parsed.width, parsed.height as number);
  const extensions = parsed.extensions && typeof parsed.extensions === 'object' && !Array.isArray(parsed.extensions) ? parsed.extensions as Record<string, unknown> : {};
  const target = parsed.target as Partial<PixelAssetDocument['target']> | undefined;
  const packing = target?.packing;
  const pixelCount = parsed.width * (parsed.height as number);
  const PACKINGS: readonly string[] = ['logical-2bpp-msb-groups', 'bbc-mode-5-hardware-interleaved-2bpp', 'bbc-screen-2bpp-eight-line-blocks'];
  if (packing !== undefined && !PACKINGS.includes(packing)) throw new Error('Pixel asset target packing is not supported');
  /* The machine's own layout only describes a picture whose width is a whole
   * number of four-pixel groups and whose height is a whole number of
   * eight-scanline bands. A document claiming it at another shape could not be
   * generated, so it is refused here rather than at generation time. */
  if (packing === 'bbc-screen-2bpp-eight-line-blocks' && !fitsScreenBlocks(parsed.width as number, parsed.height as number)) {
    throw new Error('BBC screen order needs a width that is a multiple of 4 pixels and a height that is a multiple of 8 rows');
  }
  let sprite = expected.sprite;
  if (parsed.kind === 'sprite' && parsed.sprite !== undefined) {
    const imported = parsed.sprite as Partial<NonNullable<PixelAssetDocument['sprite']>>;
    const hotspot = validateHotspot(imported.hotspot, parsed.width, parsed.height as number, 'Sprite');
    const mask = validateFrameMask(imported.mask, parsed.pixels.length, 'Sprite');
    if (imported.maskSemantics !== '1-opaque-0-transparent') throw new Error('Sprite mask semantics are not supported');
    const rootFrame = imported.frame as { name?: unknown; durationMs?: unknown } | undefined;
    let animation: NonNullable<PixelAssetDocument['sprite']>['animation'];
    if (imported.animation !== undefined) {
      if (!imported.animation || (imported.animation.playback !== 'loop' && imported.animation.playback !== 'once') || !Array.isArray(imported.animation.frames) || imported.animation.frames.length > 63) throw new Error('Sprite animation must contain 0–63 additional frames and a supported playback mode');
      const ids = new Set<string>();
      const frames = imported.animation.frames.map((value, index) => {
        const frame = value as Partial<PixelSpriteFrame>;
        if (typeof frame.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(frame.id) || ids.has(frame.id)) throw new Error('Sprite animation frame IDs must be unique lowercase identifiers');
        ids.add(frame.id);
        return { id: frame.id, name: frameName(frame.name, `Frame ${index + 2}`), durationMs: frameDuration(frame.durationMs), pixels: validateFramePixels(frame.pixels, pixelCount, `Sprite frame ${index + 2}`), mask: validateFrameMask(frame.mask, pixelCount, `Sprite frame ${index + 2}`), hotspot: validateHotspot(frame.hotspot, parsed.width as number, parsed.height as number, `Sprite frame ${index + 2}`) };
      });
      animation = { playback: imported.animation.playback, frames };
    }
    sprite = { hotspot, mask, maskSemantics: imported.maskSemantics, frame: { name: frameName(rootFrame?.name, 'Frame 1'), durationMs: frameDuration(rootFrame?.durationMs) }, ...(animation ? { animation } : {}) };
  }
  if (parsed.kind !== 'sprite' && parsed.sprite !== undefined) throw new Error('Only sprite documents may contain sprite mask metadata');
  return { ...expected, name: parsed.name.trim(), pixels: parsed.pixels.map(pixelIndex), target: { ...expected.target, packing: packing ?? expected.target.packing }, ...(sprite ? { sprite } : {}), extensions: structuredClone(extensions) };
}

function pixelIndex(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 3) throw new Error('Every pixel must be an integer palette index from 0 to 3');
  return value as number;
}

export function serializePixelAssetDocument(document: PixelAssetDocument): string {
  const validated = parsePixelAssetDocument(document, document.kind);
  return `${JSON.stringify(validated, null, 2)}\n`;
}

export function generatePixelAssetOutput(document: PixelAssetDocument): PixelAssetOutput {
  const validated = parsePixelAssetDocument(document, document.kind);
  const frames = pixelAssetFrames(validated);
  const pack = (pixels: number[]) => {
    if (validated.target.packing === 'bbc-screen-2bpp-eight-line-blocks') {
      return packBbcScreenBlocks(pixels, validated.width, validated.height) ?? packBbcMode5Pixels(pixels);
    }
    return validated.target.packing === 'bbc-mode-5-hardware-interleaved-2bpp' ? packBbcMode5Pixels(pixels) : packTwoBitPixels(pixels);
  };
  const packedFrames = frames.map((frame) => pack(frame.pixels));
  const bytes = Uint8Array.from(packedFrames.flatMap((frame) => Array.from(frame)));
  const packedMasks = validated.sprite ? frames.map((frame) => packOpaqueMask(frame.mask!)) : [];
  const maskBytes = validated.sprite ? Uint8Array.from(packedMasks.flatMap((frame) => Array.from(frame))) : undefined;
  const rows = Array.from({ length: Math.ceil(bytes.length / 8) }, (_, row) => `EQUB ${Array.from(bytes.slice(row * 8, row * 8 + 8)).map((byte) => `&${byte.toString(16).toUpperCase().padStart(2, '0')}`).join(', ')}`);
  const manifest: PixelAssetOutput['manifest'] = {
    schema: '8bit-net.generated-asset', version: 1, sourceSchema: validated.schema, sourceVersion: validated.version,
    name: validated.name, kind: validated.kind, width: validated.width, height: validated.height,
    packing: validated.target.packing, byteLength: bytes.length, sha256: sha256Hex(bytes),
  };
  if (validated.sprite && maskBytes) Object.assign(manifest, { hotspot: validated.sprite.hotspot, maskPacking: '1bpp-msb-eight-pixels-per-byte', maskByteLength: maskBytes.length, maskSha256: sha256Hex(maskBytes), frameCount: frames.length, frameByteLength: packedFrames[0]!.length, frameDurationsMs: frames.map((frame) => frame.durationMs), playback: validated.sprite.animation?.playback ?? 'loop' });
  const maskRows = maskBytes ? Array.from({ length: Math.ceil(maskBytes.length / 8) }, (_, row) => `EQUB ${Array.from(maskBytes.slice(row * 8, row * 8 + 8)).map((byte) => `&${byte.toString(16).toUpperCase().padStart(2, '0')}`).join(', ')}`) : [];
  const label = `asset_${validated.name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z_]/, '_$&')}`;
  const frameTable = validated.sprite && frames.length > 1 ? [`.${label}_frames`, ...frames.map((frame, index) => `EQUW ${label}_pixels + ${index * packedFrames[0]!.length}, ${label}_mask + ${index * packedMasks[0]!.length}\nEQUB ${frame.hotspot!.x}, ${frame.hotspot!.y}\nEQUW ${frame.durationMs}`)] : [];
  const assembly = [`; Generated asset ${validated.name} · ${validated.kind} ${validated.width}x${validated.height}`, `; ${manifest.packing} · ${manifest.byteLength} bytes · SHA-256 ${manifest.sha256}`, ...(frames.length > 1 ? [`; ${frames.length} animation frames · ${validated.sprite?.animation?.playback ?? 'loop'} playback`] : []), `.${label}_pixels`, ...rows, ...(validated.sprite && maskBytes ? [`; Sprite hotspot ${validated.sprite.hotspot.x},${validated.sprite.hotspot.y}`, `; ${manifest.maskPacking} · ${manifest.maskByteLength} bytes · SHA-256 ${manifest.maskSha256}`, `.${label}_mask`, ...maskRows, `.${label}_hotspot`, `EQUB ${validated.sprite.hotspot.x}, ${validated.sprite.hotspot.y}`, ...frameTable] : [])].join('\n');
  return { bytes, ...(maskBytes ? { maskBytes } : {}), assembly, manifest };
}

export function pixelAssetFrames(document: PixelAssetDocument): Array<{ id: string; name: string; durationMs: number; pixels: number[]; mask?: number[]; hotspot?: { x: number; y: number } }> {
  if (!document.sprite) return [{ id: 'frame-1', name: 'Frame 1', durationMs: 100, pixels: document.pixels }];
  return [{ id: 'frame-1', name: document.sprite.frame.name, durationMs: document.sprite.frame.durationMs, pixels: document.pixels, mask: document.sprite.mask, hotspot: document.sprite.hotspot }, ...(document.sprite.animation?.frames ?? [])];
}

export function updatePixelSpriteFrame(document: PixelAssetDocument, index: number, changes: Partial<Pick<PixelSpriteFrame, 'name' | 'durationMs' | 'pixels' | 'mask' | 'hotspot'>>): PixelAssetDocument {
  if (!document.sprite) throw new Error('Only sprite documents contain animation frames');
  if (!Number.isInteger(index) || index < 0 || index >= pixelAssetFrames(document).length) throw new Error('Sprite frame index is out of range');
  const next = structuredClone(document);
  if (index === 0) {
    if (changes.pixels) next.pixels = [...changes.pixels];
    if (changes.mask) next.sprite!.mask = [...changes.mask];
    if (changes.hotspot) next.sprite!.hotspot = { ...changes.hotspot };
    next.sprite!.frame = { name: changes.name ?? next.sprite!.frame.name, durationMs: changes.durationMs ?? next.sprite!.frame.durationMs };
  } else Object.assign(next.sprite!.animation!.frames[index - 1]!, structuredClone(changes));
  return parsePixelAssetDocument(next, 'sprite');
}

export function addPixelSpriteFrame(document: PixelAssetDocument, duplicateIndex = 0): PixelAssetDocument {
  if (!document.sprite) throw new Error('Only sprite documents contain animation frames');
  const frames = pixelAssetFrames(document);
  if (frames.length >= 64) throw new Error('Sprite animations are limited to 64 frames');
  const source = frames[duplicateIndex];
  if (!source) throw new Error('Sprite frame index is out of range');
  const used = new Set(frames.map((frame) => frame.id)); let number = frames.length + 1;
  while (used.has(`frame-${number}`)) number += 1;
  const next = structuredClone(document);
  next.sprite!.animation ??= { playback: 'loop', frames: [] };
  next.sprite!.animation.frames.push({ id: `frame-${number}`, name: `Frame ${number}`, durationMs: source.durationMs, pixels: [...source.pixels], mask: [...source.mask!], hotspot: { ...source.hotspot! } });
  return parsePixelAssetDocument(next, 'sprite');
}

export function removePixelSpriteFrame(document: PixelAssetDocument, index: number): PixelAssetDocument {
  if (!document.sprite) throw new Error('Only sprite documents contain animation frames');
  const frames = pixelAssetFrames(document);
  if (frames.length === 1) throw new Error('A sprite must retain at least one frame');
  if (!Number.isInteger(index) || index < 0 || index >= frames.length) throw new Error('Sprite frame index is out of range');
  if (index === 0) {
    const promoted = frames[1]!;
    const next = updatePixelSpriteFrame(document, 0, { name: promoted.name, durationMs: promoted.durationMs, pixels: promoted.pixels, mask: promoted.mask, hotspot: promoted.hotspot });
    next.sprite!.animation!.frames.shift();
    if (!next.sprite!.animation!.frames.length) delete next.sprite!.animation;
    return parsePixelAssetDocument(next, 'sprite');
  }
  const next = structuredClone(document);
  next.sprite!.animation!.frames.splice(index - 1, 1);
  if (!next.sprite!.animation!.frames.length) delete next.sprite!.animation;
  return parsePixelAssetDocument(next, 'sprite');
}

export function movePixelSpriteFrame(document: PixelAssetDocument, index: number, direction: -1 | 1): PixelAssetDocument {
  if (!document.sprite) throw new Error('Only sprite documents contain animation frames');
  const frames = pixelAssetFrames(document);
  const destination = index + direction;
  if (!Number.isInteger(index) || index < 0 || index >= frames.length || destination < 0 || destination >= frames.length) throw new Error('Sprite frame move is out of range');
  const ordered = [...frames];
  [ordered[index], ordered[destination]] = [ordered[destination]!, ordered[index]!];
  const next = structuredClone(document);
  const root = ordered[0]!;
  next.pixels = [...root.pixels];
  next.sprite!.mask = [...root.mask!];
  next.sprite!.hotspot = { ...root.hotspot! };
  next.sprite!.frame = { name: root.name, durationMs: root.durationMs };
  const serializedIds = new Set(ordered.slice(1).filter((frame) => frame.id !== 'frame-1').map((frame) => frame.id));
  let rootReplacementId = frames.length + 1;
  while (serializedIds.has(`frame-${rootReplacementId}`)) rootReplacementId += 1;
  next.sprite!.animation = { playback: document.sprite.animation?.playback ?? 'loop', frames: ordered.slice(1).map((frame) => ({ id: frame.id === 'frame-1' ? `frame-${rootReplacementId}` : frame.id, name: frame.name, durationMs: frame.durationMs, pixels: [...frame.pixels], mask: [...frame.mask!], hotspot: { ...frame.hotspot! } })) };
  return parsePixelAssetDocument(next, 'sprite');
}

export function resizePixelAssetDocument(document: PixelAssetDocument, width: number, height: number): PixelAssetDocument {
  validateDimensions(width, height);
  const resizePlane = (values: number[], fill: number) => {
    const resized = Array(width * height).fill(fill);
    for (let y = 0; y < Math.min(document.height, height); y += 1) for (let x = 0; x < Math.min(document.width, width); x += 1) resized[y * width + x] = values[y * document.width + x];
    return resized;
  };
  const clamp = (hotspot: { x: number; y: number }) => ({ x: Math.min(hotspot.x, width - 1), y: Math.min(hotspot.y, height - 1) });
  const next = structuredClone(document);
  next.width = width; next.height = height; next.pixels = resizePlane(document.pixels, 0);
  if (next.sprite && document.sprite) {
    next.sprite.mask = resizePlane(document.sprite.mask, 1); next.sprite.hotspot = clamp(document.sprite.hotspot);
    next.sprite.animation?.frames.forEach((frame, index) => {
      const source = document.sprite!.animation!.frames[index]!;
      frame.pixels = resizePlane(source.pixels, 0); frame.mask = resizePlane(source.mask, 1); frame.hotspot = clamp(source.hotspot);
    });
  }
  return parsePixelAssetDocument(next, document.kind);
}
