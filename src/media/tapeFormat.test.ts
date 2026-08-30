import { describe, expect, it } from 'vitest';
import { detectTapeFormat, MAX_TAPE_IMAGE_BYTES, validateTapeImage } from './tapeFormat';

const uef = (...payload: number[]) => Uint8Array.from([
  0x55, 0x45, 0x46, 0x20, 0x46, 0x69, 0x6c, 0x65, 0x21, 0x00, 0x00, 0x00,
  ...payload,
]);

describe('cassette image boundary', () => {
  it('recognizes UEF and tapefile signatures without relying on filenames', () => {
    expect(detectTapeFormat(uef())).toBe('UEF');
    expect(detectTapeFormat(Uint8Array.from([0xff, 0x04, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('tapefile');
    expect(detectTapeFormat(Uint8Array.from([0xff, 0x03]))).toBeNull();
  });

  it('rejects empty, unknown and oversized input before the emulator parser', () => {
    expect(() => validateTapeImage(new Uint8Array())).toThrow('must not be empty');
    expect(() => validateTapeImage(new Uint8Array(12))).toThrow('not a recognized');
    expect(() => validateTapeImage(new Uint8Array(MAX_TAPE_IMAGE_BYTES + 1))).toThrow('limited to 8 MiB');
  });

  it('returns the detected format for valid bounded input', () => {
    expect(validateTapeImage(uef(0x00, 0x01, 0x00, 0x00, 0x00, 0x00))).toBe('UEF');
  });
});
