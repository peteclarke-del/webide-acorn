/* The pixel editor's view of the shared selection machinery.
 *
 * The rectangle arithmetic, the clipboard and its refusals all live in
 * `gridSelection`, which the map and screen editors use too. What remains here
 * is the part that is genuinely about pixels: the flip transforms, and a
 * clipboard that still reads the schema this editor wrote before the machinery
 * was shared, so artwork somebody copied yesterday still pastes today.
 */
import {
  GRID_CLIPBOARD_SCHEMA,
  copySelection,
  fillSelection,
  parseGridClipboard,
  pasteSelection,
  selectionBounds as gridSelectionBounds,
  selectionContains as gridSelectionContains,
  type GridClipboard,
  type GridPoint,
  type GridSelection,
} from './gridSelection';

export type PixelPoint = GridPoint;
export type PixelSelection = GridSelection;
export type PixelClipboard = GridClipboard;

/** The schema this editor wrote before the selection machinery was shared. */
const LEGACY_SCHEMA = '8bit-net.pixel-selection';

/* Four, because that is what the previous clipboard enforced and what a pixel
 * asset in this build holds; the shared module carries the bound rather than
 * assuming it, so a wider mode is a matter of passing a larger number. */
const PIXEL_VALUE_LIMIT = 4;

export const selectionBounds = gridSelectionBounds;
export const selectionContains = gridSelectionContains;

export function copyPixelSelection(pixels: number[], canvasWidth: number, canvasHeight: number, selection: PixelSelection): PixelClipboard {
  return copySelection(pixels, { width: canvasWidth, height: canvasHeight, kind: 'pixels', valueLimit: PIXEL_VALUE_LIMIT }, selection);
}

/**
 * Read a clipboard, accepting the older pixel-only shape as well as the shared
 * one.
 *
 * The old schema is converted rather than refused, because refusing it would
 * throw away artwork somebody copied before this build changed underneath them.
 */
export function parsePixelClipboard(value: string | unknown): PixelClipboard {
  const parsed = typeof value === 'string' ? JSON.parse(value) as Record<string, unknown> : value as Record<string, unknown>;
  if (parsed && parsed.schema === LEGACY_SCHEMA) {
    return parseGridClipboard({
      schema: GRID_CLIPBOARD_SCHEMA, version: 1, kind: 'pixels',
      width: parsed.width, height: parsed.height, values: parsed.pixels, valueLimit: PIXEL_VALUE_LIMIT,
    });
  }
  return parseGridClipboard(parsed);
}

export function pastePixelSelection(pixels: number[], canvasWidth: number, canvasHeight: number, clipboard: PixelClipboard, destination: PixelPoint): number[] {
  return pasteSelection(pixels, { width: canvasWidth, height: canvasHeight, kind: 'pixels', valueLimit: PIXEL_VALUE_LIMIT }, clipboard, destination);
}

export function fillPixelSelection(pixels: number[], canvasWidth: number, selection: PixelSelection, colour: number): number[] {
  return fillSelection(pixels, canvasWidth, selection, colour);
}

export function transformPixelSelection(pixels: number[], canvasWidth: number, selection: PixelSelection, transform: 'flip-horizontal' | 'flip-vertical'): number[] {
  const bounds = selectionBounds(selection); const result = [...pixels];
  for (let y = bounds.top; y <= bounds.bottom; y += 1) for (let x = bounds.left; x <= bounds.right; x += 1) {
    const sourceX = transform === 'flip-horizontal' ? bounds.right - (x - bounds.left) : x;
    const sourceY = transform === 'flip-vertical' ? bounds.bottom - (y - bounds.top) : y;
    result[y * canvasWidth + x] = pixels[sourceY * canvasWidth + sourceX]!;
  }
  return result;
}
