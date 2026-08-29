import { describe, expect, it } from 'vitest';
import { validateRegisterPatch } from './registerEditModel';

describe('6502 register edit model', () => {
  it('accepts a partial or complete bounded register transaction', () => {
    expect(validateRegisterPatch({ a: 0x41, pc: 0x1900 })).toEqual({ a: 0x41, pc: 0x1900 });
    expect(validateRegisterPatch({ a: 0, x: 1, y: 2, s: 0xff, p: 0x34, pc: 0xffff })).toHaveProperty('pc', 0xffff);
  });

  it('rejects unknown, empty, and out-of-width edits', () => {
    expect(() => validateRegisterPatch({})).toThrow(/at least one/);
    expect(() => validateRegisterPatch({ r0: 1 })).toThrow(/Unsupported/);
    expect(() => validateRegisterPatch({ a: 0x100 })).toThrow(/8-bit/);
    expect(() => validateRegisterPatch({ pc: 0x10000 })).toThrow(/16-bit/);
  });
});
