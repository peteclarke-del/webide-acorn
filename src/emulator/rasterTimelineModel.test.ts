import { describe, expect, it } from 'vitest';
import { rasterEvents, rasterPositionMatches, validateRasterConfig, type RasterSample } from './rasterTimelineModel';

const sample = (patch: Partial<RasterSample> = {}): RasterSample => ({ frame: 1, x: 0, y: 10, hSync: false, vSync: false, scanline: 0, horizontalCounter: 0, verticalCounter: 0, displayAddress: 0x3000, mode: 1, ulaControl: 4, palette: [0, 1, 2], ...patch });

describe('raster timeline model', () => {
  it('detects only configured authoritative transitions', () => {
    const events = rasterEvents(sample(), sample({ frame: 2, hSync: true, vSync: true, mode: 2, palette: [0, 3, 2], y: 16 }), { capacity: 256, recordHSync: true, sampleEveryScanlines: 8 });
    expect(events).toEqual(['frame', 'hsync-start', 'vsync-start', 'mode', 'palette', 'scanline']);
    expect(rasterEvents(sample(), sample({ hSync: true }), { capacity: 256, recordHSync: false, sampleEveryScanlines: 0 })).toEqual([]);
  });

  it('matches a beam crossing once per frame', () => {
    const config = validateRasterConfig({ capacity: 128, breakX: 320, breakY: 200 });
    expect(rasterPositionMatches(sample({ x: 312, y: 200 }), sample({ x: 320, y: 200 }), config)).toBe(true);
    expect(rasterPositionMatches(sample({ x: 312, y: 200 }), sample({ x: 320, y: 200 }), config, 1)).toBe(false);
    expect(() => validateRasterConfig({ capacity: 128, breakX: 321, breakY: 200 })).toThrow(/8-pixel/);
  });
});
