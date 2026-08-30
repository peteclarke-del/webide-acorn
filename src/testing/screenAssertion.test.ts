import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64, compareFramebufferRegion, framebufferRegionFnv32, framebufferRegionRgba, validateScreenGolden, validateScreenRegion } from './screenAssertion';

describe('screen assertion framebuffer digest', () => {
  it('hashes the exact declared pixels in stable low-byte-first order', () => {
    const pixels = new Uint32Array([0x04030201, 0x08070605, 0x0c0b0a09, 0x100f0e0d]);
    expect(framebufferRegionFnv32(pixels, { x: 0, y: 0, width: 2, height: 2 }, 2)).toBe('AE8E8135');
    expect(framebufferRegionFnv32(pixels, { x: 1, y: 0, width: 1, height: 2 }, 2)).toBe('C794ED65');
  });

  it('rejects out-of-frame and excessive regions', () => {
    expect(validateScreenRegion({ x: 1020, y: 0, width: 8, height: 1 })).toContain('1024 by 625');
    expect(validateScreenRegion({ x: 0, y: 0, width: 512, height: 256 })).toContain('65,536');
  });

  it('round-trips portable RGBA goldens and reports bounded pixel tolerance', () => {
    const pixels = new Uint32Array([0x04030201, 0x08070605]);
    const expected = framebufferRegionRgba(pixels, { x: 0, y: 0, width: 2, height: 1 }, 2);
    const encoded = bytesToBase64(expected);
    expect(Array.from(base64ToBytes(encoded))).toEqual(Array.from(expected));
    expect(validateScreenGolden({ id: 'title-1', name: 'Title', width: 2, height: 1, rgbaBase64: encoded })).toBeNull();
    const changed = new Uint32Array([0x04030201, 0x08070609]);
    expect(compareFramebufferRegion(changed, { x: 0, y: 0, width: 2, height: 1 }, encoded, 2, 0, 2)).toMatchObject({ differingPixels: 1, maximumChannelDelta: 4, passed: false });
    expect(compareFramebufferRegion(changed, { x: 0, y: 0, width: 2, height: 1 }, encoded, 4, 0, 2)).toMatchObject({ differingPixels: 0, maximumChannelDelta: 4, passed: true });
  });
});
