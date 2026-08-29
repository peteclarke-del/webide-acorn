export const EMULATOR_SCREEN_WIDTH = 1024;
export const EMULATOR_SCREEN_HEIGHT = 625;
export const MAX_SCREEN_ASSERTION_PIXELS = 65_536;
export const MAX_SCREEN_GOLDENS = 4;
export const MAX_SCREEN_GOLDEN_BYTES = MAX_SCREEN_ASSERTION_PIXELS * 4;

export interface ScreenRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenGolden {
  id: string;
  name: string;
  width: number;
  height: number;
  rgbaBase64: string;
}

export interface ScreenDifference {
  expectedRgbaBase64: string;
  actualRgbaBase64: string;
  expectedDigest: string;
  actualDigest: string;
  differingPixels: number;
  allowedDifferingPixels: number;
  maximumChannelDelta: number;
  allowedChannelDelta: number;
  passed: boolean;
}

export function validateScreenRegion(region: ScreenRegion): string | null {
  const values = [region.x, region.y, region.width, region.height];
  if (values.some((value) => !Number.isInteger(value))) return 'Screen-region coordinates and dimensions must be integers';
  if (region.x < 0 || region.y < 0 || region.width < 1 || region.height < 1) return 'Screen-region coordinates must be non-negative and dimensions must be positive';
  if (region.x + region.width > EMULATOR_SCREEN_WIDTH || region.y + region.height > EMULATOR_SCREEN_HEIGHT) return `Screen region must fit within ${EMULATOR_SCREEN_WIDTH} by ${EMULATOR_SCREEN_HEIGHT} pixels`;
  if (region.width * region.height > MAX_SCREEN_ASSERTION_PIXELS) return `Screen-region assertions are limited to ${MAX_SCREEN_ASSERTION_PIXELS.toLocaleString()} pixels`;
  return null;
}

export function framebufferRegionFnv32(framebuffer: Uint32Array, region: ScreenRegion, stride = EMULATOR_SCREEN_WIDTH): string {
  const regionError = validateScreenRegion(region);
  if (regionError) throw new Error(regionError);
  if (!Number.isInteger(stride) || stride < region.x + region.width || framebuffer.length < stride * (region.y + region.height)) throw new Error('Framebuffer does not contain the declared screen region');
  let hash = 0x811c9dc5;
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      const pixel = framebuffer[y * stride + x]! >>> 0;
      for (let shift = 0; shift < 32; shift += 8) {
        hash ^= (pixel >>> shift) & 0xff;
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
    }
  }
  return hash.toString(16).padStart(8, '0').toUpperCase();
}

export function rgbaBytesFnv32(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').toUpperCase();
}

export function framebufferRegionRgba(framebuffer: Uint32Array, region: ScreenRegion, stride = EMULATOR_SCREEN_WIDTH): Uint8Array {
  const regionError = validateScreenRegion(region);
  if (regionError) throw new Error(regionError);
  if (!Number.isInteger(stride) || stride < region.x + region.width || framebuffer.length < stride * (region.y + region.height)) throw new Error('Framebuffer does not contain the declared screen region');
  const bytes = new Uint8Array(region.width * region.height * 4);
  let offset = 0;
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      const pixel = framebuffer[y * stride + x]! >>> 0;
      bytes[offset++] = pixel & 0xff;
      bytes[offset++] = (pixel >>> 8) & 0xff;
      bytes[offset++] = (pixel >>> 16) & 0xff;
      bytes[offset++] = (pixel >>> 24) & 0xff;
    }
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Screen golden pixels are not valid base64');
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function validateScreenGolden(golden: ScreenGolden): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(golden.id)) return 'Screen golden id must contain 1 to 40 letters, digits, underscores or hyphens';
  if (!golden.name.trim() || golden.name.length > 80) return 'Screen golden name must contain 1 to 80 characters';
  const regionError = validateScreenRegion({ x: 0, y: 0, width: golden.width, height: golden.height });
  if (regionError) return regionError;
  try {
    if (base64ToBytes(golden.rgbaBase64).length !== golden.width * golden.height * 4) return 'Screen golden byte count does not match its dimensions';
  } catch (error) { return error instanceof Error ? error.message : 'Screen golden pixels are invalid'; }
  return null;
}

export function compareFramebufferRegion(
  framebuffer: Uint32Array,
  region: ScreenRegion,
  expectedRgbaBase64: string,
  allowedChannelDelta: number,
  allowedDifferingPixels: number,
  stride = EMULATOR_SCREEN_WIDTH,
): ScreenDifference {
  if (!Number.isInteger(allowedChannelDelta) || allowedChannelDelta < 0 || allowedChannelDelta > 255) throw new Error('Screen channel tolerance must be between 0 and 255');
  if (!Number.isInteger(allowedDifferingPixels) || allowedDifferingPixels < 0 || allowedDifferingPixels > region.width * region.height) throw new Error('Allowed differing screen pixels are outside the declared region');
  const expected = base64ToBytes(expectedRgbaBase64);
  const actual = framebufferRegionRgba(framebuffer, region, stride);
  if (expected.length !== actual.length) throw new Error('Screen golden byte count does not match the asserted region');
  let differingPixels = 0;
  let maximumChannelDelta = 0;
  for (let offset = 0; offset < actual.length; offset += 4) {
    let pixelDelta = 0;
    for (let channel = 0; channel < 4; channel += 1) pixelDelta = Math.max(pixelDelta, Math.abs(actual[offset + channel]! - expected[offset + channel]!));
    maximumChannelDelta = Math.max(maximumChannelDelta, pixelDelta);
    if (pixelDelta > allowedChannelDelta) differingPixels += 1;
  }
  return {
    expectedRgbaBase64,
    actualRgbaBase64: bytesToBase64(actual),
    expectedDigest: rgbaBytesFnv32(expected),
    actualDigest: rgbaBytesFnv32(actual),
    differingPixels,
    allowedDifferingPixels,
    maximumChannelDelta,
    allowedChannelDelta,
    passed: differingPixels <= allowedDifferingPixels,
  };
}
