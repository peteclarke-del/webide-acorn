import { describe, expect, it } from 'vitest';
import { isEmulatorScaleMode, scaledFramebufferViewport } from './emulatorScaleModel';

describe('emulator framebuffer scaling', () => {
  it('keeps fit fluid and computes exact integer viewports', () => {
    expect(scaledFramebufferViewport('fit', 1024, 625)).toBeUndefined();
    expect(scaledFramebufferViewport('1x', 1024, 625)).toEqual({ width: 1024, height: 625 });
    expect(scaledFramebufferViewport('2x', 640, 480)).toEqual({ width: 1280, height: 960 });
  });

  it('refuses unavailable or implausible live dimensions', () => {
    expect(scaledFramebufferViewport('1x', 0, 625)).toBeUndefined();
    expect(scaledFramebufferViewport('2x', 5000, 480)).toBeUndefined();
  });

  it('accepts only maintained scale modes', () => {
    expect(isEmulatorScaleMode('fit')).toBe(true);
    expect(isEmulatorScaleMode('stretch')).toBe(false);
  });
});
