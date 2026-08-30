import { describe, expect, it } from 'vitest';
import { armMemoryPageAddress, formatArmMemoryText, readArmLittleEndianWord, resolveArmMemoryExpression, resolveArmValueExpression, validateArmMemoryRead } from './armMemoryModel';

describe('ARM 26-bit logical memory inspector model', () => {
  it('resolves bounded literals, symbols and offsets without code evaluation', () => {
    expect(resolveArmMemoryExpression('entry + &20', { ENTRY: 0x8000 })).toBe(0x8020);
    expect(resolveArmMemoryExpression('&03FFFFFF')).toBe(0x03ffffff);
    expect(resolveArmMemoryExpression('&03FFFFFF + 1')).toBeNull();
    expect(resolveArmMemoryExpression('entry.constructor()', { ENTRY: 0x8000 })).toBeNull();
  });

  it('resolves full-width comparison values while retaining 26-bit address bounds', () => {
    expect(resolveArmValueExpression('&FFFFFFFF')).toBe(0xffffffff);
    expect(resolveArmValueExpression('LIMIT+4', { LIMIT: 0x8000 })).toBe(0x8004);
    expect(resolveArmMemoryExpression('&FFFFFFFF')).toBeNull();
  });

  it('rejects wrapping/oversized reads and clamps page navigation', () => {
    expect(validateArmMemoryRead(0x8000, 4096)).toEqual({ address: 0x8000, length: 4096 });
    expect(() => validateArmMemoryRead(0x03fffff0, 32)).toThrow('must not wrap');
    expect(() => validateArmMemoryRead(0, 4097)).toThrow('1–4,096');
    expect(armMemoryPageAddress(0, 256, -1)).toBe(0);
    expect(armMemoryPageAddress(0x03ffff00, 256, 1)).toBe(0x03ffff00);
  });

  it('reads unsigned little-endian words and produces deterministic readable export', () => {
    expect(readArmLittleEndianWord(0x8000, [0x78, 0x56, 0x34, 0xf2], 0x8000)).toBe(0xf2345678);
    expect(readArmLittleEndianWord(0x8000, [1, 2, 3], 0x8000)).toBeNull();
    expect(formatArmMemoryText(0x8000, [0x41, 0, 0xff], 8)).toBe('&00008000  41 00 FF                 A··');
  });
});
