import { describe, expect, it } from 'vitest';
import {
  createScreenDocument, decodeBase64, encodeBase64, fillScreen, generateScreenOutput,
  importImageIntoScreen, paintScreenPixel, parseScreenDocument, readScreenPixel, screenByteForPixel,
  screenBytes, screenGeometry, screenLabel, serializeScreenDocument, setScreenMode, withScreenBytes,
} from './screenDocument';
import { packBbcMode5Pixels } from './pixelPacking';
import type { PaletteModeId } from './paletteDocument';

const MODES: PaletteModeId[] = ['bbc-mode-0', 'bbc-mode-1', 'bbc-mode-2', 'bbc-mode-4', 'bbc-mode-5'];

describe('screen geometry', () => {
  it('matches the frame-buffer size each BBC mode really uses', () => {
    expect(screenGeometry('bbc-mode-5')).toMatchObject({ width: 160, bitsPerPixel: 2, pixelsPerByte: 4, blocksPerRow: 40, byteLength: 10240 });
    expect(screenGeometry('bbc-mode-4')).toMatchObject({ width: 320, bitsPerPixel: 1, pixelsPerByte: 8, blocksPerRow: 40, byteLength: 10240 });
    expect(screenGeometry('bbc-mode-1')).toMatchObject({ width: 320, bitsPerPixel: 2, blocksPerRow: 80, byteLength: 20480 });
    expect(screenGeometry('bbc-mode-2')).toMatchObject({ width: 160, bitsPerPixel: 4, pixelsPerByte: 2, blocksPerRow: 80, byteLength: 20480 });
    expect(screenGeometry('bbc-mode-0')).toMatchObject({ width: 640, bitsPerPixel: 1, blocksPerRow: 80, byteLength: 20480 });
  });

  it('addresses pixels through eight-byte character blocks', () => {
    const geometry = screenGeometry('bbc-mode-5');
    expect(screenByteForPixel(geometry, 0, 0)).toEqual({ byteIndex: 0, pixelInByte: 0 });
    expect(screenByteForPixel(geometry, 3, 0)).toEqual({ byteIndex: 0, pixelInByte: 3 });
    // The fifth pixel starts the next block, eight bytes further on.
    expect(screenByteForPixel(geometry, 4, 0)).toEqual({ byteIndex: 8, pixelInByte: 0 });
    // Raster line one is the second byte of the same block.
    expect(screenByteForPixel(geometry, 0, 1)).toEqual({ byteIndex: 1, pixelInByte: 0 });
    // Block row one starts a whole row of blocks later.
    expect(screenByteForPixel(geometry, 0, 8)).toEqual({ byteIndex: 320, pixelInByte: 0 });
  });
});

describe('pixel packing rule', () => {
  it('produces the same two-bit layout as the separately tested MODE 5 packer', () => {
    const pixels = [0, 1, 2, 3];
    let screen = createScreenDocument('p', 'bbc-mode-5');
    pixels.forEach((colour, x) => { screen = paintScreenPixel(screen, x, 0, colour); });
    expect(screenBytes(screen)[0]).toBe(packBbcMode5Pixels(pixels)[0]);
  });

  it('round-trips every colour of every mode through one byte', () => {
    for (const mode of MODES) {
      const geometry = screenGeometry(mode);
      let document = createScreenDocument('p', mode);
      for (let x = 0; x < geometry.pixelsPerByte; x += 1) {
        document = paintScreenPixel(document, x, 0, x % geometry.logicalColours);
      }
      const painted = screenBytes(document);
      for (let x = 0; x < geometry.pixelsPerByte; x += 1) {
        expect(readScreenPixel(painted, geometry, x, 0)).toBe(x % geometry.logicalColours);
      }
    }
  });
});

describe('screen documents', () => {
  it('creates a blank screen of the right size and round-trips', () => {
    const document = createScreenDocument('title', 'bbc-mode-5');
    expect(screenBytes(document)).toHaveLength(10240);
    expect(parseScreenDocument(serializeScreenDocument(document))).toEqual(document);
  });

  it('refuses a frame buffer that is the wrong size for its mode', () => {
    const document = createScreenDocument('title', 'bbc-mode-5');
    expect(() => parseScreenDocument({ ...document, mode: 'bbc-mode-1' })).toThrow(/needs a 20,480-byte frame buffer, not 10,240/);
    expect(() => parseScreenDocument({ ...document, framebufferBase64: '!!!not base64!!!' })).toThrow(/not valid base64/);
    expect(() => parseScreenDocument({ ...document, mode: 'bbc-mode-7' })).toThrow(/supported BBC display mode/);
    expect(() => parseScreenDocument({ schema: 'other', version: 1 })).toThrow(/Unsupported screen schema/);
  });

  it('encodes and decodes base64 without changing a byte', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    expect(Array.from(decodeBase64(encodeBase64(bytes)))).toEqual(Array.from(bytes));
  });
});

describe('editing a screen', () => {
  it('paints one pixel and leaves its neighbours alone', () => {
    const painted = paintScreenPixel(createScreenDocument('s'), 5, 9, 2);
    const geometry = screenGeometry('bbc-mode-5');
    const bytes = screenBytes(painted);
    expect(readScreenPixel(bytes, geometry, 5, 9)).toBe(2);
    expect(readScreenPixel(bytes, geometry, 4, 9)).toBe(0);
    expect(readScreenPixel(bytes, geometry, 5, 8)).toBe(0);
  });

  it('refuses a pixel outside the screen or a colour outside the mode', () => {
    const document = createScreenDocument('s', 'bbc-mode-5');
    expect(() => paintScreenPixel(document, 160, 0, 1)).toThrow(/outside the screen/);
    expect(() => paintScreenPixel(document, 0, 256, 1)).toThrow(/outside the screen/);
    expect(() => paintScreenPixel(document, 0, 0, 4)).toThrow(/logical colours 0 to 3/);
  });

  it('fills the whole screen with one colour', () => {
    const filled = fillScreen(createScreenDocument('s'), 3);
    const geometry = screenGeometry('bbc-mode-5');
    const bytes = screenBytes(filled);
    expect(readScreenPixel(bytes, geometry, 0, 0)).toBe(3);
    expect(readScreenPixel(bytes, geometry, 159, 255)).toBe(3);
    expect(new Set(bytes).size).toBe(1);
  });

  it('reports how lossy a mode change was instead of implying it was clean', () => {
    const source = paintScreenPixel(fillScreen(createScreenDocument('s', 'bbc-mode-2'), 0), 0, 0, 9);
    const result = setScreenMode(source, 'bbc-mode-5');
    expect(result.document.mode).toBe('bbc-mode-5');
    expect(screenBytes(result.document)).toHaveLength(10240);
    // Colour 9 does not exist in a four-colour mode and had to be clamped.
    expect(result.clampedColours).toBeGreaterThan(0);
    const widened = setScreenMode(createScreenDocument('s', 'bbc-mode-5'), 'bbc-mode-1');
    expect(widened.clampedColours).toBe(0);
    expect(widened.changedPixels).toBeGreaterThan(0);
  });
});

describe('image import', () => {
  const palette = ['#000000', '#ff0000', '#ffff00', '#ffffff'];
  function image(width: number, height: number, colour: [number, number, number]) {
    const rgba = new Uint8Array(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      rgba[index * 4] = colour[0]; rgba[index * 4 + 1] = colour[1]; rgba[index * 4 + 2] = colour[2]; rgba[index * 4 + 3] = 255;
    }
    return rgba;
  }

  it('maps exact palette colours without reporting approximation', () => {
    const result = importImageIntoScreen(createScreenDocument('s'), image(4, 4, [255, 0, 0]), 4, 4, palette);
    expect(result.approximatedPixels).toBe(0);
    expect(result.sourceColours).toBe(1);
    expect(readScreenPixel(screenBytes(result.document), screenGeometry('bbc-mode-5'), 0, 0)).toBe(1);
  });

  it('counts every pixel it had to approximate', () => {
    const result = importImageIntoScreen(createScreenDocument('s'), image(4, 4, [200, 10, 10]), 4, 4, palette);
    expect(result.approximatedPixels).toBe(16);
    expect(readScreenPixel(screenBytes(result.document), screenGeometry('bbc-mode-5'), 0, 0)).toBe(1);
  });

  it('reports the part of an oversized image that did not fit', () => {
    const result = importImageIntoScreen(createScreenDocument('s'), image(200, 300, [0, 0, 0]), 200, 300, palette);
    expect(result.croppedPixels).toBe(200 * 300 - 160 * 256);
  });

  it('refuses malformed image input', () => {
    expect(() => importImageIntoScreen(createScreenDocument('s'), new Uint8Array(4), 0, 1, palette)).toThrow(/positive width and height/);
    expect(() => importImageIntoScreen(createScreenDocument('s'), new Uint8Array(4), 4, 4, palette)).toThrow(/shorter than its declared size/);
    expect(() => importImageIntoScreen(createScreenDocument('s'), image(1, 1, [0, 0, 0]), 1, 1, [])).toThrow(/No palette colours/);
  });
});

describe('generated screen output', () => {
  it('emits the frame buffer in hardware block order with a deterministic digest', () => {
    const document = paintScreenPixel(createScreenDocument('title screen'), 0, 0, 3);
    const output = generateScreenOutput(document);
    expect(screenLabel('title screen')).toBe('screen_title_screen');
    expect(output.bytes).toHaveLength(10240);
    expect(Array.from(output.bytes)).toEqual(Array.from(screenBytes(document)));
    expect(output.assembly).toContain('.screen_title_screen');
    expect(output.manifest).toMatchObject({ displayMode: 5, width: 160, height: 256, bitsPerPixel: 2, byteLength: 10240 });
    expect(output.manifest.sha256).toBe(generateScreenOutput(document).manifest.sha256);
  });

  it('reports the logical colours the picture actually uses', () => {
    expect(generateScreenOutput(createScreenDocument('blank')).manifest.usedColours).toEqual([0]);
    const two = paintScreenPixel(createScreenDocument('two'), 10, 10, 2);
    expect(generateScreenOutput(two).manifest.usedColours).toEqual([0, 2]);
  });

  it('accepts a frame buffer written directly', () => {
    const bytes = new Uint8Array(screenGeometry('bbc-mode-5').byteLength).fill(0xff);
    const document = withScreenBytes(createScreenDocument('solid'), bytes);
    expect(generateScreenOutput(document).manifest.usedColours).toEqual([3]);
  });
});
