export interface PixelPoint { x: number; y: number }
export interface PixelSelection { start: PixelPoint; end: PixelPoint }
export interface PixelClipboard { schema: '8bit-net.pixel-selection'; version: 1; width: number; height: number; pixels: number[] }

export function selectionBounds(selection: PixelSelection) {
  return {
    left: Math.min(selection.start.x, selection.end.x), top: Math.min(selection.start.y, selection.end.y),
    right: Math.max(selection.start.x, selection.end.x), bottom: Math.max(selection.start.y, selection.end.y),
  };
}

export function selectionContains(selection: PixelSelection, x: number, y: number): boolean {
  const bounds = selectionBounds(selection);
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

export function copyPixelSelection(pixels: number[], canvasWidth: number, canvasHeight: number, selection: PixelSelection): PixelClipboard {
  const bounds = selectionBounds(selection);
  if (bounds.left < 0 || bounds.top < 0 || bounds.right >= canvasWidth || bounds.bottom >= canvasHeight) throw new Error('Selection lies outside the pixel asset');
  const width = bounds.right - bounds.left + 1; const height = bounds.bottom - bounds.top + 1;
  const copied = Array.from({ length: width * height }, (_, index) => pixels[(bounds.top + Math.floor(index / width)) * canvasWidth + bounds.left + index % width]!);
  return { schema: '8bit-net.pixel-selection', version: 1, width, height, pixels: copied };
}

export function parsePixelClipboard(value: string | unknown): PixelClipboard {
  const parsed = typeof value === 'string' ? JSON.parse(value) as Partial<PixelClipboard> : value as Partial<PixelClipboard>;
  if (!parsed || parsed.schema !== '8bit-net.pixel-selection' || parsed.version !== 1 || !Number.isInteger(parsed.width) || !Number.isInteger(parsed.height)
    || parsed.width! < 1 || parsed.height! < 1 || !Array.isArray(parsed.pixels) || parsed.pixels.length !== parsed.width! * parsed.height!
    || parsed.pixels.some((pixel) => !Number.isInteger(pixel) || pixel < 0 || pixel > 3)) throw new Error('Clipboard does not contain a valid schema-1 pixel selection');
  return { schema: parsed.schema, version: parsed.version, width: parsed.width!, height: parsed.height!, pixels: [...parsed.pixels] };
}

export function pastePixelSelection(pixels: number[], canvasWidth: number, canvasHeight: number, clipboard: PixelClipboard, destination: PixelPoint): number[] {
  const parsed = parsePixelClipboard(clipboard); const result = [...pixels];
  for (let y = 0; y < parsed.height; y += 1) for (let x = 0; x < parsed.width; x += 1) {
    const targetX = destination.x + x; const targetY = destination.y + y;
    if (targetX >= 0 && targetY >= 0 && targetX < canvasWidth && targetY < canvasHeight) result[targetY * canvasWidth + targetX] = parsed.pixels[y * parsed.width + x]!;
  }
  return result;
}

export function fillPixelSelection(pixels: number[], canvasWidth: number, selection: PixelSelection, colour: number): number[] {
  return pixels.map((pixel, index) => selectionContains(selection, index % canvasWidth, Math.floor(index / canvasWidth)) ? colour : pixel);
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
