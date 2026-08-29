import { describe, expect, it } from 'vitest';
import { parseArmMemoryEditBytes, validateArmMemoryEdit } from './armMemoryEditModel';

describe('ARM logical-memory edit model', () => {
  it('parses common hexadecimal byte notation into a bounded transaction', () => {
    expect(validateArmMemoryEdit({ address: 0x8000, bytes: parseArmMemoryEditBytes('02, &00 0xA0 E3') })).toEqual({ address: 0x8000, bytes: [0x02, 0x00, 0xa0, 0xe3] });
  });
  it('rejects invalid values, empty edits, oversized edits and 26-bit wrap', () => {
    expect(() => parseArmMemoryEditBytes('')).toThrow(/one or more/);
    expect(() => parseArmMemoryEditBytes('100')).toThrow(/Invalid/);
    expect(() => validateArmMemoryEdit({ address: 0x3ffffff, bytes: [1, 2] })).toThrow(/wrap/);
    expect(() => validateArmMemoryEdit({ address: 0x8000, bytes: Array(257).fill(0) })).toThrow(/1–256/);
  });
  it('returns a defensive byte copy', () => {
    const bytes = [1, 2];
    const edit = validateArmMemoryEdit({ address: 0, bytes });
    bytes[0] = 9;
    expect(edit.bytes).toEqual([1, 2]);
  });
});
