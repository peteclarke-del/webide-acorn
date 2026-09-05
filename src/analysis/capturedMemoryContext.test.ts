import { describe, expect, it } from 'vitest';
import { capturedMemoryMetadata, capturedMemoryName, type CapturedMemoryContext } from './capturedMemoryContext';

const context = (overrides: Partial<CapturedMemoryContext> = {}): CapturedMemoryContext => ({
  machineLabel: 'BBC Model B',
  spaceId: 'sideways',
  spaceLabel: 'Sideways ROM',
  banked: true,
  bank: 4,
  address: 0x8000,
  byteLength: 256,
  capturedAtCycles: 1_234_567,
  ...overrides,
});

describe('what a memory capture carries into analysis', () => {
  it('says which bank it came from, because sixteen of them share the addresses', () => {
    /* Bytes from bank 4 and bytes from bank 12 disassemble at the same
     * addresses and look identical afterwards. A listing that does not say
     * which one it was cannot be compared with anything, including itself an
     * hour later. */
    const metadata = capturedMemoryMetadata(context());
    expect(metadata.addressSpace).toBe('BBC Model B · Sideways ROM');
    expect(metadata.bank).toBe('Sideways bank 4');
    expect(capturedMemoryName(context())).toBe('sideways bank 4 &8000');
  });

  it('says it is a moment rather than a file', () => {
    /* A capture presented like a document gives no hint that the same read a
     * moment later can hold different bytes. */
    const metadata = capturedMemoryMetadata(context());
    expect(metadata.warnings[0]).toMatch(/capture of Sideways ROM at cycle 1,234,567, not a file/);
    expect(metadata.warnings[0]).toMatch(/can hold different bytes/);
  });

  it('takes the origin from where the bytes were read, and claims no entry point', () => {
    /* Nothing about a window of memory says anything is entered at its start,
     * and defaulting one would be inventing a fact about somebody's program. */
    const metadata = capturedMemoryMetadata(context());
    expect(metadata.load).toBe(0x8000);
    expect(metadata.execute).toBeUndefined();
    expect(metadata.declaredLength).toBe(256);
  });

  it('refuses to let a banked capture go by without its bank', () => {
    const metadata = capturedMemoryMetadata(context({ bank: undefined }));
    expect(metadata.bank).toBeUndefined();
    expect(metadata.warnings.join(' ')).toMatch(/banked and no bank was recorded/);
    expect(capturedMemoryName(context({ bank: undefined }))).toBe('sideways &8000');
  });

  it('ignores a bank recorded against a space that has none, and says it did', () => {
    /* Showing it would imply main RAM has banks; dropping it silently would
     * hide that the caller believed something untrue. */
    const metadata = capturedMemoryMetadata(context({ spaceId: 'main', spaceLabel: 'Main RAM', banked: false, bank: 4, address: 0x1900 }));
    expect(metadata.bank).toBeUndefined();
    expect(metadata.warnings.join(' ')).toMatch(/is not banked, so the bank recorded with this capture has been ignored/);
  });

  it('says nothing extra about an ordinary unbanked capture', () => {
    const metadata = capturedMemoryMetadata(context({ spaceId: 'main', spaceLabel: 'Main RAM', banked: false, bank: undefined, address: 0x1900 }));
    expect(metadata.warnings).toHaveLength(1);
    expect(metadata.addressSpace).toBe('BBC Model B · Main RAM');
    expect(capturedMemoryName(context({ spaceId: 'main', banked: false, bank: undefined, address: 0x1900 }))).toBe('main &1900');
  });

  it('produces a name a file system would accept', () => {
    const name = capturedMemoryName(context({ spaceId: 'tube-logical/ram', bank: undefined, banked: false }));
    expect(name).not.toMatch(/[/\\:*?"<>|]/);
    expect(name).toBe('tube-logical-ram &8000');
  });
});
