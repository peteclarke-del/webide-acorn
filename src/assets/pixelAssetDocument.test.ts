import { describe, expect, it } from 'vitest';
import { addPixelSpriteFrame, createPixelAssetDocument, generatePixelAssetOutput, movePixelSpriteFrame, parsePixelAssetDocument, pixelAssetFrames, removePixelSpriteFrame, resizePixelAssetDocument, serializePixelAssetDocument, updatePixelSpriteFrame } from './pixelAssetDocument';
import { assemble6502 } from '../build/assembler6502';

describe('versioned pixel asset documents', () => {
  it('round-trips an editable document and deterministic generated manifest', () => {
    const document = createPixelAssetDocument('character', 8, 8);
    document.name = 'letter-a'; document.pixels.splice(0, 4, 0, 1, 2, 3); document.extensions = { note: 'retained' };
    const reopened = parsePixelAssetDocument(serializePixelAssetDocument(document));
    const first = generatePixelAssetOutput(reopened); const second = generatePixelAssetOutput(reopened);
    expect(reopened.extensions).toEqual({ note: 'retained' });
    expect(first.bytes[0]).toBe(0x1b);
    expect(first).toEqual(second);
    expect(first.manifest).toMatchObject({ byteLength: 16, width: 8, height: 8, packing: 'logical-2bpp-msb-groups' });
    expect(first.manifest.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('migrates the original browser-local draft without accepting invalid pixels', () => {
    const migrated = parsePixelAssetDocument({ width: 8, height: 8, pixels: Array(64).fill(2) }, 'tile');
    expect(migrated).toMatchObject({ schema: '8bit-net.pixel-asset', version: 1, kind: 'tile' });
    expect(() => parsePixelAssetDocument({ ...migrated, pixels: [...migrated.pixels.slice(0, 63), 4] })).toThrow('palette index');
  });

  it('refuses unsupported versions and inconsistent dimensions', () => {
    expect(() => parsePixelAssetDocument({ schema: '8bit-net.pixel-asset', version: 2 })).toThrow('Unsupported');
    const document = createPixelAssetDocument('sprite'); document.pixels.pop();
    expect(() => serializePixelAssetDocument(document)).toThrow('width × height');
  });

  it('retains and generates the exact BBC MODE 5 hardware encoding', () => {
    const document = createPixelAssetDocument('sprite', 8, 8); document.pixels.splice(0, 4, 0, 1, 2, 3);
    document.target.packing = 'bbc-mode-5-hardware-interleaved-2bpp';
    const reopened = parsePixelAssetDocument(serializePixelAssetDocument(document));
    expect(reopened.target.packing).toBe('bbc-mode-5-hardware-interleaved-2bpp');
    expect(generatePixelAssetOutput(reopened).bytes[0]).toBe(0x35);
  });

  it('round-trips independent sprite mask/hotspot data and deterministic mask bytes', () => {
    const document = createPixelAssetDocument('sprite', 8, 8);
    document.sprite!.hotspot = { x: 3, y: 4 }; document.sprite!.mask.splice(0, 8, 1, 0, 1, 0, 0, 1, 0, 1);
    const reopened = parsePixelAssetDocument(serializePixelAssetDocument(document)); const output = generatePixelAssetOutput(reopened);
    expect(reopened.sprite?.hotspot).toEqual({ x: 3, y: 4 });
    expect(Array.from(output.maskBytes ?? [])).toEqual([0xa5, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    expect(output.manifest).toMatchObject({ hotspot: { x: 3, y: 4 }, maskPacking: '1bpp-msb-eight-pixels-per-byte', maskByteLength: 8 });
    expect(output.manifest.maskSha256).toMatch(/^[0-9a-f]{64}$/);
    const assembled = assemble6502(`ORG &1900\n${output.assembly}`);
    expect(assembled.diagnostics).toEqual([]);
    expect(assembled.symbols).toMatchObject({ ASSET_UNTITLED_SPRITE_PIXELS: 0x1900, ASSET_UNTITLED_SPRITE_MASK: 0x1910, ASSET_UNTITLED_SPRITE_HOTSPOT: 0x1918 });
    expect(Array.from(assembled.bytes.slice(-2))).toEqual([3, 4]);
  });

  it('persists, edits, orders and generates bounded sprite animation frames', () => {
    let document = createPixelAssetDocument('sprite', 8, 8); document.name = 'runner';
    document.pixels[0] = 1; document.sprite!.mask[0] = 0; document.sprite!.hotspot = { x: 1, y: 2 };
    document = addPixelSpriteFrame(document);
    document = updatePixelSpriteFrame(document, 1, { name: 'Stride', durationMs: 160, pixels: [2, ...Array(63).fill(0)], mask: Array(64).fill(1), hotspot: { x: 3, y: 4 } });
    const reopened = parsePixelAssetDocument(serializePixelAssetDocument(document));
    expect(pixelAssetFrames(reopened).map((frame) => [frame.name, frame.durationMs, frame.pixels[0], frame.hotspot])).toEqual([
      ['Frame 1', 100, 1, { x: 1, y: 2 }], ['Stride', 160, 2, { x: 3, y: 4 }],
    ]);
    const output = generatePixelAssetOutput(reopened);
    expect(output.manifest).toMatchObject({ frameCount: 2, frameByteLength: 16, frameDurationsMs: [100, 160], byteLength: 32, maskByteLength: 16, playback: 'loop' });
    expect(Array.from(output.bytes.slice(0, 17))).toEqual([0x40, ...Array(15).fill(0), 0x80]);
    const assembled = assemble6502(`ORG &1900\n${output.assembly}`);
    expect(assembled.diagnostics).toEqual([]);
    expect(assembled.symbols).toMatchObject({ ASSET_RUNNER_PIXELS: 0x1900, ASSET_RUNNER_MASK: 0x1920, ASSET_RUNNER_HOTSPOT: 0x1930, ASSET_RUNNER_FRAMES: 0x1932 });
    expect(Array.from(assembled.bytes.slice(-16))).toEqual([0x00, 0x19, 0x20, 0x19, 1, 2, 100, 0, 0x10, 0x19, 0x28, 0x19, 3, 4, 160, 0]);

    const moved = movePixelSpriteFrame(reopened, 1, -1);
    expect(pixelAssetFrames(moved).map((frame) => frame.name)).toEqual(['Stride', 'Frame 1']);
    const resized = resizePixelAssetDocument(moved, 16, 8);
    expect(pixelAssetFrames(resized).map((frame) => [frame.pixels.length, frame.mask?.length, frame.hotspot])).toEqual([[128, 128, { x: 3, y: 4 }], [128, 128, { x: 1, y: 2 }]]);
    const removed = removePixelSpriteFrame(moved, 0);
    expect(pixelAssetFrames(removed).map((frame) => frame.name)).toEqual(['Frame 1']);
  });

  it('rejects malformed or excessive animation metadata', () => {
    const document = addPixelSpriteFrame(createPixelAssetDocument('sprite'));
    const invalid = structuredClone(document); invalid.sprite!.animation!.frames[0]!.durationMs = 10;
    expect(() => parsePixelAssetDocument(invalid)).toThrow('20–60,000');
    const duplicate = structuredClone(document); duplicate.sprite!.animation!.frames.push(structuredClone(duplicate.sprite!.animation!.frames[0]!));
    expect(() => parsePixelAssetDocument(duplicate)).toThrow('unique');
  });
});
