export type RasterEventKind = 'frame' | 'hsync-start' | 'hsync-end' | 'vsync-start' | 'vsync-end' | 'mode' | 'palette' | 'scanline';

export interface RasterSample {
  frame: number;
  x: number;
  y: number;
  hSync: boolean;
  vSync: boolean;
  scanline: number;
  horizontalCounter: number;
  verticalCounter: number;
  displayAddress: number;
  mode: number;
  ulaControl: number;
  palette: number[];
}

export interface RasterConfig {
  capacity: number;
  recordHSync: boolean;
  sampleEveryScanlines: number;
  breakEvent?: RasterEventKind;
  breakX?: number;
  breakY?: number;
}

export function validateRasterConfig(input: Record<string, unknown>): RasterConfig {
  const capacity = Number(input.capacity ?? 256);
  const sampleEveryScanlines = Number(input.sampleEveryScanlines ?? 0);
  if (!Number.isInteger(capacity) || capacity < 64 || capacity > 4096) throw new Error('Raster capacity must be 64–4,096 events');
  if (!Number.isInteger(sampleEveryScanlines) || sampleEveryScanlines < 0 || sampleEveryScanlines > 625) throw new Error('Scanline sampling must be 0–625');
  const breakY = input.breakY === undefined ? undefined : Number(input.breakY);
  const breakX = input.breakX === undefined ? undefined : Number(input.breakX);
  if (breakY !== undefined && (!Number.isInteger(breakY) || breakY < -1 || breakY > 624)) throw new Error('Raster break Y must be -1–624');
  if (breakX !== undefined && (!Number.isInteger(breakX) || breakX < -8 || breakX > 1023 || breakX % 8 !== 0)) throw new Error('Raster break X must be -8–1,023 in 8-pixel increments');
  if (breakX !== undefined && breakY === undefined) throw new Error('Raster break X requires a Y position');
  const allowed: RasterEventKind[] = ['frame', 'hsync-start', 'hsync-end', 'vsync-start', 'vsync-end', 'mode', 'palette', 'scanline'];
  const breakEvent = input.breakEvent === undefined || input.breakEvent === '' ? undefined : String(input.breakEvent) as RasterEventKind;
  if (breakEvent !== undefined && !allowed.includes(breakEvent)) throw new Error('Unsupported raster break event');
  return { capacity, recordHSync: Boolean(input.recordHSync), sampleEveryScanlines, ...(breakEvent ? { breakEvent } : {}), ...(breakX === undefined ? {} : { breakX }), ...(breakY === undefined ? {} : { breakY }) };
}

export function rasterEvents(previous: RasterSample, current: RasterSample, config: RasterConfig): RasterEventKind[] {
  const events: RasterEventKind[] = [];
  if (current.frame !== previous.frame) events.push('frame');
  if (config.recordHSync && current.hSync !== previous.hSync) events.push(current.hSync ? 'hsync-start' : 'hsync-end');
  if (current.vSync !== previous.vSync) events.push(current.vSync ? 'vsync-start' : 'vsync-end');
  if (current.mode !== previous.mode || current.ulaControl !== previous.ulaControl) events.push('mode');
  if (current.palette.length !== previous.palette.length || current.palette.some((value, index) => value !== previous.palette[index])) events.push('palette');
  if (config.sampleEveryScanlines > 0 && current.y !== previous.y && current.y >= 0 && current.y % config.sampleEveryScanlines === 0) events.push('scanline');
  return events;
}

export function rasterPositionMatches(previous: RasterSample, current: RasterSample, config: RasterConfig, lastMatchedFrame?: number): boolean {
  if (config.breakY === undefined || current.frame === lastMatchedFrame || current.y !== config.breakY) return false;
  if (config.breakX === undefined) return previous.frame !== current.frame || previous.y !== current.y;
  return previous.frame !== current.frame || previous.y !== current.y ? current.x >= config.breakX : previous.x < config.breakX && current.x >= config.breakX;
}
