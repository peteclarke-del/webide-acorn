import { describe, expect, it } from 'vitest';
import { convertNumber } from './numberConverter';

describe('target-aware number converter', () => {
  it('converts Acorn hexadecimal and exposes exact endian bytes', () => {
    expect(convertNumber('&1234', 16, '6502').conversion).toMatchObject({ unsigned: 0x1234, signed: 0x1234, decimal: '4660', hexadecimal: '1234', binary: '0001001000110100', octal: '011064', acornLiteral: '&1234', alternativeLiteral: '$1234', cLiteral: '0x1234', littleEndian: '34 12', bigEndian: '12 34', address: { valid: true, maximum: 0xffff, alignment: 1 } });
  });

  it('represents negative values as bounded two complement values', () => {
    expect(convertNumber('-1', 8, '65c02').conversion).toMatchObject({ unsigned: 255, signed: -1, hexadecimal: 'FF', binary: '11111111', littleEndian: 'FF' });
    expect(convertNumber('-129', 8, '6502').error).toContain('-128');
  });

  it('distinguishes ARM address range and alignment from plain conversion', () => {
    expect(convertNumber('0x8000', 32, 'arm').conversion?.address).toMatchObject({ valid: true, maximum: 0x03ffffff, alignment: 4 });
    expect(convertNumber('&8002', 32, 'arm').conversion?.address).toMatchObject({ valid: false, reason: 'ARM instruction addresses must be word aligned.' });
    expect(convertNumber('&4000000', 32, 'arm').conversion?.address.valid).toBe(false);
  });

  it('accepts binary and octal and reports malformed input', () => {
    expect(convertNumber('%01000001', 8, '6502').conversion).toMatchObject({ unsigned: 65, character: 'A' });
    expect(convertNumber('0o377', 8, '6502').conversion?.unsigned).toBe(255);
    expect(convertNumber('12 bananas', 16, '6502').error).toContain('Enter decimal');
  });
});
