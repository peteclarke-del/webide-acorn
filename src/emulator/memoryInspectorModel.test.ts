import { describe, expect, it } from 'vitest';
import { changedMemoryAddresses, formatMemoryRows, parseMemorySearch, readLittleEndianPointer, resolveMemoryExpression, searchMemory } from './memoryInspectorModel';

describe('hardware memory inspector model', () => {
  it('resolves bounded symbols and literal offsets without evaluating code', () => {
    expect(resolveMemoryExpression('buffer + &10', { BUFFER: 0x2000 })).toBe(0x2010);
    expect(resolveMemoryExpression('$2100 - 16')).toBe(0x20f0);
    expect(resolveMemoryExpression('missing + 1', {})).toBeNull();
    expect(resolveMemoryExpression('buffer.constructor()', { BUFFER: 0x2000 })).toBeNull();
    expect(resolveMemoryExpression('&FFFF + 1')).toBeNull();
  });

  it('formats hex/decimal rows and distinguishes BBC-family pound text', () => {
    expect(formatMemoryRows(0x2000, [0x41, 0x60, 0, 255], 8, 'hex')[0]).toMatchObject({ address: 0x2000, values: ['41', '60', '00', 'FF'], ascii: 'A`··', acorn: 'A£··' });
    expect(formatMemoryRows(0x2000, [1, 255], 8, 'decimal')[0]!.values).toEqual(['001', '255']);
  });

  it('searches byte wildcards/text, diffs overlapping snapshots and follows little-endian pointers', () => {
    const bytes = [0xa9, 0x41, 0x8d, 0, 0x20, 0xa9, 0x42];
    expect(searchMemory(0x1900, bytes, parseMemorySearch('A9 ??', 'bytes'))).toEqual([0x1900, 0x1905]);
    expect(searchMemory(0x1900, bytes, parseMemorySearch('A', 'text'))).toEqual([0x1901]);
    expect(Array.from(changedMemoryAddresses(0x2000, [1, 9, 3], 0x2000, [1, 2, 3]))).toEqual([0x2001]);
    expect(readLittleEndianPointer(0x2000, [0x34, 0x12], 0x2000)).toBe(0x1234);
    expect(readLittleEndianPointer(0x2000, [0x34], 0x2000)).toBeNull();
  });
});
