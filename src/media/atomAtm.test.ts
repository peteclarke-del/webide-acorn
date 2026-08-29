import { describe, expect, it } from 'vitest';
import { createAtomAtm, parseAtomAtm } from './atomAtm';

describe('Acorn Atom ATM container', () => {
  it('round-trips the documented little-endian metadata and exact payload', () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, index) => (index * 7) & 0xff);
    const first = createAtomAtm({ name: 'SNAPPER', loadAddress: 0x2900, executionAddress: 0xce86, bytes });
    const second = createAtomAtm({ name: 'SNAPPER', loadAddress: 0x2900, executionAddress: 0xce86, bytes });
    expect(first).toEqual(second);
    expect(first.slice(0, 16)).toEqual(Uint8Array.from([0x53, 0x4e, 0x41, 0x50, 0x50, 0x45, 0x52, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    expect(first.slice(16, 22)).toEqual(Uint8Array.from([0x00, 0x29, 0x86, 0xce, 0x2c, 0x01]));
    expect(parseAtomAtm(first)).toEqual({ name: 'SNAPPER', loadAddress: 0x2900, executionAddress: 0xce86, bytes });
  });

  it('rejects unsafe names, addresses, lengths, padding and trailing data', () => {
    expect(() => createAtomAtm({ name: '../BAD', loadAddress: 0, executionAddress: 0, bytes: Uint8Array.of(1) })).toThrow('path separators');
    expect(() => createAtomAtm({ name: 'TOO-LONG-NAME', loadAddress: 0, executionAddress: 0, bytes: Uint8Array.of(1) })).toThrow('1–12');
    expect(() => createAtomAtm({ name: 'BAD', loadAddress: 0x10000, executionAddress: 0, bytes: Uint8Array.of(1) })).toThrow('16-bit');
    expect(() => createAtomAtm({ name: 'EMPTY', loadAddress: 0, executionAddress: 0, bytes: new Uint8Array() })).toThrow('1–65,535');
    const valid = createAtomAtm({ name: 'OK', loadAddress: 0x2900, executionAddress: 0x2900, bytes: Uint8Array.of(1) });
    const padded = valid.slice(); padded[3] = 1; expect(() => parseAtomAtm(padded)).toThrow('padding');
    const trailing = new Uint8Array(valid.length + 1); trailing.set(valid); expect(() => parseAtomAtm(trailing)).toThrow('declares 1');
  });
});
