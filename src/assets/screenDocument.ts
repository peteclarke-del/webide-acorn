/* Versioned, editable full-screen bitmap documents.
 *
 * A BBC display mode stores its frame buffer as eight-byte character blocks.
 * One block covers eight raster lines and however many pixels fit in a byte at
 * the mode's colour depth, so a block is eight pixels wide at one bit per pixel,
 * four at two bits and two at four bits.
 *
 * The document stores the packed frame buffer itself, base64 encoded, because
 * that is exactly what the machine displays and it keeps a full screen inside
 * the editable-source limit. Packing and unpacking are inverses of one rule, so
 * a screen never changes by being opened and saved.
 */
import { sha256Hex } from '../build/digest';
import { paletteModeProfile, type PaletteModeId } from './paletteDocument';

export const SCREEN_SCHEMA = '8bit-net.screen' as const;

export interface ScreenModeGeometry {
  mode: PaletteModeId;
  /** Visible pixels. */
  width: number;
  height: number;
  bitsPerPixel: number;
  logicalColours: number;
  /** Pixels one byte holds. */
  pixelsPerByte: number;
  /** Pixels one eight-byte block covers horizontally. */
  blockWidth: number;
  blocksPerRow: number;
  /** Total frame-buffer bytes. */
  byteLength: number;
}

const MODE_WIDTHS: Record<PaletteModeId, number> = {
  'bbc-mode-0': 640,
  'bbc-mode-1': 320,
  'bbc-mode-2': 160,
  'bbc-mode-4': 320,
  'bbc-mode-5': 160,
};

export const SCREEN_HEIGHT = 256;
export const BLOCK_ROWS = SCREEN_HEIGHT / 8;

export function screenGeometry(mode: PaletteModeId): ScreenModeGeometry {
  const profile = paletteModeProfile(mode);
  const width = MODE_WIDTHS[mode];
  const pixelsPerByte = 8 / profile.bitsPerPixel;
  const blocksPerRow = width / pixelsPerByte;
  return {
    mode,
    width,
    height: SCREEN_HEIGHT,
    bitsPerPixel: profile.bitsPerPixel,
    logicalColours: profile.logicalColours,
    pixelsPerByte,
    blockWidth: pixelsPerByte,
    blocksPerRow,
    byteLength: blocksPerRow * BLOCK_ROWS * 8,
  };
}

/**
 * Byte offset and pixel position of a screen pixel.
 *
 * Blocks run left to right then top to bottom; within a block, one byte per
 * raster line.
 */
export function screenByteForPixel(geometry: ScreenModeGeometry, x: number, y: number): { byteIndex: number; pixelInByte: number } {
  const blockColumn = Math.floor(x / geometry.blockWidth);
  const blockRow = Math.floor(y / 8);
  const byteIndex = blockRow * geometry.blocksPerRow * 8 + blockColumn * 8 + (y % 8);
  return { byteIndex, pixelInByte: x % geometry.blockWidth };
}

/**
 * Where a colour bit lives in a packed byte.
 *
 * For a byte holding N pixels, colour bit b of pixel p occupies bit
 * `b * N + (N - 1 - p)`. That single rule produces the BBC's one, two and four
 * bit-per-pixel layouts, including the two-bit split across nibbles.
 */
function colourBitPosition(pixelsPerByte: number, bit: number, pixelInByte: number): number {
  return bit * pixelsPerByte + (pixelsPerByte - 1 - pixelInByte);
}

export function readScreenPixel(bytes: Uint8Array, geometry: ScreenModeGeometry, x: number, y: number): number {
  const { byteIndex, pixelInByte } = screenByteForPixel(geometry, x, y);
  const byte = bytes[byteIndex] ?? 0;
  let colour = 0;
  for (let bit = 0; bit < geometry.bitsPerPixel; bit += 1) {
    if ((byte >> colourBitPosition(geometry.pixelsPerByte, bit, pixelInByte)) & 1) colour |= 1 << bit;
  }
  return colour;
}

export function writeScreenPixel(bytes: Uint8Array, geometry: ScreenModeGeometry, x: number, y: number, colour: number): void {
  const { byteIndex, pixelInByte } = screenByteForPixel(geometry, x, y);
  let byte = bytes[byteIndex] ?? 0;
  for (let bit = 0; bit < geometry.bitsPerPixel; bit += 1) {
    const position = colourBitPosition(geometry.pixelsPerByte, bit, pixelInByte);
    byte = ((colour >> bit) & 1) ? (byte | (1 << position)) : (byte & ~(1 << position) & 0xff);
  }
  bytes[byteIndex] = byte;
}

export interface ScreenDocument {
  schema: typeof SCREEN_SCHEMA;
  version: 1;
  name: string;
  mode: PaletteModeId;
  /** The packed frame buffer, base64 encoded. */
  framebufferBase64: string;
  extensions: Record<string, unknown>;
}

export function encodeBase64(bytes: Uint8Array): string {
  if (typeof btoa !== 'function') return Buffer.from(bytes).toString('base64');
  /* A frame buffer is tens of kilobytes, so the binary string is built in
   * chunks rather than one concatenation per byte. */
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function decodeBase64(value: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  return Uint8Array.from(Buffer.from(value, 'base64'));
}

/**
 * Build a document from a frame buffer the caller already holds.
 *
 * Editors keep the decoded frame buffer as their working state and call this
 * only when a document is actually needed, so painting does not pay for a
 * base64 encode of the whole screen on every pixel.
 */
export function screenDocumentFromBytes(name: string, mode: PaletteModeId, bytes: Uint8Array, extensions: Record<string, unknown> = {}): ScreenDocument {
  const geometry = screenGeometry(mode);
  if (bytes.length !== geometry.byteLength) {
    throw new Error(`${paletteModeProfile(mode).label} needs a ${geometry.byteLength.toLocaleString()}-byte frame buffer, not ${bytes.length.toLocaleString()}`);
  }
  if (typeof name !== 'string' || !name.trim() || name.length > 80) throw new Error('Screen name must contain 1 to 80 characters');
  return { schema: SCREEN_SCHEMA, version: 1, name: name.trim(), mode, framebufferBase64: encodeBase64(bytes), extensions };
}

export function createScreenDocument(name = 'untitled-screen', mode: PaletteModeId = 'bbc-mode-5'): ScreenDocument {
  const geometry = screenGeometry(mode);
  return {
    schema: SCREEN_SCHEMA,
    version: 1,
    name,
    mode,
    framebufferBase64: encodeBase64(new Uint8Array(geometry.byteLength)),
    extensions: {},
  };
}

export function parseScreenDocument(value: string | unknown): ScreenDocument {
  const parsed = typeof value === 'string' ? JSON.parse(value) as Record<string, unknown> : value as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Screen document must be a JSON object');
  if (parsed.schema !== SCREEN_SCHEMA || parsed.version !== 1) throw new Error('Unsupported screen schema or version');
  if (typeof parsed.name !== 'string' || !parsed.name.trim() || parsed.name.length > 80) throw new Error('Screen name must contain 1 to 80 characters');
  if (typeof parsed.mode !== 'string' || !(parsed.mode in MODE_WIDTHS)) throw new Error('Screen mode must be a supported BBC display mode');
  const mode = parsed.mode as PaletteModeId;
  const geometry = screenGeometry(mode);
  if (typeof parsed.framebufferBase64 !== 'string') throw new Error('Screen framebuffer must be a base64 string');
  let bytes: Uint8Array;
  try { bytes = decodeBase64(parsed.framebufferBase64); }
  catch { throw new Error('Screen framebuffer is not valid base64'); }
  if (bytes.length !== geometry.byteLength) {
    throw new Error(`${paletteModeProfile(mode).label} needs a ${geometry.byteLength.toLocaleString()}-byte frame buffer, not ${bytes.length.toLocaleString()}`);
  }
  const extensions = parsed.extensions && typeof parsed.extensions === 'object' && !Array.isArray(parsed.extensions) ? parsed.extensions as Record<string, unknown> : {};
  return { schema: SCREEN_SCHEMA, version: 1, name: parsed.name.trim(), mode, framebufferBase64: encodeBase64(bytes), extensions };
}

/**
 * Validate a document that is already in this build's own hands and hand back
 * its decoded frame buffer.
 *
 * `parseScreenDocument` re-encodes the frame buffer so that untrusted input is
 * normalized to canonical base64. Editing operations do not need that: they
 * receive a document this module produced, so they validate and decode once and
 * encode once, instead of decoding and encoding a whole screen twice per pixel.
 */
function decodedScreen(document: ScreenDocument): { document: ScreenDocument; geometry: ScreenModeGeometry; bytes: Uint8Array } {
  if (!document || document.schema !== SCREEN_SCHEMA || document.version !== 1) throw new Error('Unsupported screen schema or version');
  if (typeof document.name !== 'string' || !document.name.trim() || document.name.length > 80) throw new Error('Screen name must contain 1 to 80 characters');
  if (typeof document.mode !== 'string' || !(document.mode in MODE_WIDTHS)) throw new Error('Screen mode must be a supported BBC display mode');
  const geometry = screenGeometry(document.mode);
  if (typeof document.framebufferBase64 !== 'string') throw new Error('Screen framebuffer must be a base64 string');
  let bytes: Uint8Array;
  try { bytes = decodeBase64(document.framebufferBase64); }
  catch { throw new Error('Screen framebuffer is not valid base64'); }
  if (bytes.length !== geometry.byteLength) {
    throw new Error(`${paletteModeProfile(document.mode).label} needs a ${geometry.byteLength.toLocaleString()}-byte frame buffer, not ${bytes.length.toLocaleString()}`);
  }
  return { document, geometry, bytes };
}

export function serializeScreenDocument(document: ScreenDocument): string {
  return `${JSON.stringify(parseScreenDocument(document), null, 2)}\n`;
}

export function screenBytes(document: ScreenDocument): Uint8Array {
  return decodeBase64(parseScreenDocument(document).framebufferBase64);
}

export function withScreenBytes(document: ScreenDocument, bytes: Uint8Array): ScreenDocument {
  return parseScreenDocument({ ...document, framebufferBase64: encodeBase64(bytes) });
}

/* ---- editing ------------------------------------------------------------- */

export function paintScreenPixel(document: ScreenDocument, x: number, y: number, colour: number): ScreenDocument {
  const { document: validated, geometry, bytes } = decodedScreen(document);
  if (!Number.isInteger(x) || x < 0 || x >= geometry.width || !Number.isInteger(y) || y < 0 || y >= geometry.height) throw new Error('That pixel is outside the screen');
  if (!Number.isInteger(colour) || colour < 0 || colour >= geometry.logicalColours) throw new Error(`${paletteModeProfile(validated.mode).label} has logical colours 0 to ${geometry.logicalColours - 1}`);
  writeScreenPixel(bytes, geometry, x, y, colour);
  return { ...validated, framebufferBase64: encodeBase64(bytes) };
}

export function fillScreen(document: ScreenDocument, colour: number): ScreenDocument {
  const { document: validated, geometry } = decodedScreen(document);
  if (!Number.isInteger(colour) || colour < 0 || colour >= geometry.logicalColours) throw new Error(`${paletteModeProfile(validated.mode).label} has logical colours 0 to ${geometry.logicalColours - 1}`);
  const bytes = new Uint8Array(geometry.byteLength);
  /* One block's worth of pixels produces the repeating byte for a solid fill. */
  for (let pixel = 0; pixel < geometry.pixelsPerByte; pixel += 1) writeScreenPixel(bytes, geometry, pixel, 0, colour);
  bytes.fill(bytes[0]!);
  return { ...validated, framebufferBase64: encodeBase64(bytes) };
}

/**
 * Change display mode.
 *
 * Modes differ in resolution and colour depth, so the picture is re-sampled by
 * nearest pixel and colours above the new mode's range are clamped. The caller
 * is told how much changed rather than being left to assume it was lossless.
 */
export function setScreenMode(document: ScreenDocument, mode: PaletteModeId): { document: ScreenDocument; changedPixels: number; clampedColours: number } {
  const { document: validated, geometry: from, bytes: source } = decodedScreen(document);
  const to = screenGeometry(mode);
  const target = new Uint8Array(to.byteLength);
  let changedPixels = 0; let clampedColours = 0;
  for (let y = 0; y < to.height; y += 1) {
    for (let x = 0; x < to.width; x += 1) {
      const sourceX = Math.min(from.width - 1, Math.floor(x * from.width / to.width));
      const sourceY = Math.min(from.height - 1, Math.floor(y * from.height / to.height));
      const original = readScreenPixel(source, from, sourceX, sourceY);
      const colour = Math.min(original, to.logicalColours - 1);
      if (colour !== original) clampedColours += 1;
      if (from.width !== to.width && sourceX * to.width !== x * from.width) changedPixels += 1;
      writeScreenPixel(target, to, x, y, colour);
    }
  }
  return { document: { ...validated, mode, framebufferBase64: encodeBase64(target) }, changedPixels, clampedColours };
}

/* ---- image import -------------------------------------------------------- */

export interface ImageImportResult {
  document: ScreenDocument;
  /** Distinct source colours the image contained. */
  sourceColours: number;
  /** Pixels whose nearest palette colour was not an exact match. */
  approximatedPixels: number;
  /** Source pixels dropped because the image was larger than the screen. */
  croppedPixels: number;
}

function channelDistance(r1: number, g1: number, b1: number, rgb: string): number {
  const r2 = Number.parseInt(rgb.slice(1, 3), 16);
  const g2 = Number.parseInt(rgb.slice(3, 5), 16);
  const b2 = Number.parseInt(rgb.slice(5, 7), 16);
  return (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;
}

/**
 * Import RGBA pixels into a screen, mapping each to the nearest palette colour.
 *
 * The mapping is lossy whenever a source colour is not exactly one of the
 * palette's colours, so the result reports how many pixels were approximated
 * and how much of the image did not fit, rather than presenting the conversion
 * as faithful.
 */
export function importImageIntoScreen(
  document: ScreenDocument,
  rgba: Uint8Array | Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  paletteColours: readonly string[],
): ImageImportResult {
  const { document: validated, geometry } = decodedScreen(document);
  if (!Number.isInteger(imageWidth) || imageWidth < 1 || !Number.isInteger(imageHeight) || imageHeight < 1) throw new Error('The image must have a positive width and height');
  if (rgba.length < imageWidth * imageHeight * 4) throw new Error('The image data is shorter than its declared size');
  const usable = paletteColours.slice(0, geometry.logicalColours);
  if (!usable.length) throw new Error('No palette colours were supplied for the conversion');
  const bytes = new Uint8Array(geometry.byteLength);
  const distinct = new Set<number>();
  let approximatedPixels = 0;
  for (let y = 0; y < Math.min(imageHeight, geometry.height); y += 1) {
    for (let x = 0; x < Math.min(imageWidth, geometry.width); x += 1) {
      const offset = (y * imageWidth + x) * 4;
      const r = rgba[offset]!; const g = rgba[offset + 1]!; const b = rgba[offset + 2]!;
      distinct.add((r << 16) | (g << 8) | b);
      let best = 0; let bestDistance = Number.POSITIVE_INFINITY;
      usable.forEach((rgb, index) => {
        const distance = channelDistance(r, g, b, rgb);
        if (distance < bestDistance) { bestDistance = distance; best = index; }
      });
      if (bestDistance > 0) approximatedPixels += 1;
      writeScreenPixel(bytes, geometry, x, y, best);
    }
  }
  const croppedPixels = imageWidth * imageHeight - Math.min(imageWidth, geometry.width) * Math.min(imageHeight, geometry.height);
  return {
    document: { ...validated, framebufferBase64: encodeBase64(bytes) },
    sourceColours: distinct.size,
    approximatedPixels,
    croppedPixels,
  };
}

/* ---- generation ---------------------------------------------------------- */

export interface ScreenOutput {
  bytes: Uint8Array;
  assembly: string;
  manifest: {
    schema: '8bit-net.generated-screen';
    version: 1;
    sourceSchema: typeof SCREEN_SCHEMA;
    sourceVersion: 1;
    name: string;
    mode: PaletteModeId;
    displayMode: number;
    width: number;
    height: number;
    bitsPerPixel: number;
    byteLength: number;
    sha256: string;
    /** Logical colours the picture actually uses. */
    usedColours: number[];
  };
}

export function screenLabel(name: string): string {
  return `screen_${name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z_]/, '_$&')}`;
}

export function generateScreenOutput(document: ScreenDocument): ScreenOutput {
  const { document: validated, geometry, bytes } = decodedScreen(document);
  return screenOutputFromBytes(validated.name, validated.mode, geometry, bytes);
}

/** The same generation, for a caller that already holds the frame buffer. */
export function generateScreenOutputFromBytes(name: string, mode: PaletteModeId, bytes: Uint8Array): ScreenOutput {
  const geometry = screenGeometry(mode);
  if (bytes.length !== geometry.byteLength) throw new Error(`${paletteModeProfile(mode).label} needs a ${geometry.byteLength.toLocaleString()}-byte frame buffer, not ${bytes.length.toLocaleString()}`);
  return screenOutputFromBytes(name, mode, geometry, bytes);
}

function screenOutputFromBytes(name: string, mode: PaletteModeId, geometry: ScreenModeGeometry, bytes: Uint8Array): ScreenOutput {
  const validated = { name, mode };
  const used = new Set<number>();
  /* Stop as soon as every colour the mode has is accounted for; a full-screen
   * scan at four bits per pixel is over 40,000 reads. */
  outer: for (let y = 0; y < geometry.height; y += 1) {
    for (let x = 0; x < geometry.width; x += 1) {
      used.add(readScreenPixel(bytes, geometry, x, y));
      if (used.size === geometry.logicalColours) break outer;
    }
  }
  const label = screenLabel(validated.name);
  const rows = Array.from({ length: Math.ceil(bytes.length / 16) }, (_, row) =>
    `EQUB ${Array.from(bytes.slice(row * 16, row * 16 + 16)).map((byte) => `&${byte.toString(16).toUpperCase().padStart(2, '0')}`).join(', ')}`);
  const assembly = [
    `; Generated screen ${validated.name} for ${paletteModeProfile(validated.mode).label}`,
    `; ${geometry.width} by ${geometry.height} pixels at ${geometry.bitsPerPixel} bits per pixel`,
    `; ${bytes.length} frame-buffer bytes in hardware block order · SHA-256 ${sha256Hex(bytes)}`,
    `.${label}`,
    ...rows,
    `.${label}_end`,
  ].join('\n');
  return {
    bytes,
    assembly,
    manifest: {
      schema: '8bit-net.generated-screen',
      version: 1,
      sourceSchema: SCREEN_SCHEMA,
      sourceVersion: 1,
      name: validated.name,
      mode: validated.mode,
      displayMode: paletteModeProfile(validated.mode).mode,
      width: geometry.width,
      height: geometry.height,
      bitsPerPixel: geometry.bitsPerPixel,
      byteLength: bytes.length,
      sha256: sha256Hex(bytes),
      usedColours: [...used].sort((left, right) => left - right),
    },
  };
}
