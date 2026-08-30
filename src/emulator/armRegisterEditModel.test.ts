import { describe, expect, it } from 'vitest';
import { composeArm26R15, validateArmRegisterEdit } from './armRegisterEditModel';

describe('ARM register editing', () => {
  it('accepts full-width general registers but bounds and aligns execute PC', () => {
    expect(validateArmRegisterEdit(0, 0xffffffff)).toEqual({ register: 0, value: 0xffffffff });
    expect(validateArmRegisterEdit(15, 0x8000)).toEqual({ register: 15, value: 0x8000 });
    expect(() => validateArmRegisterEdit(15, 0x8002)).toThrow(/aligned/);
    expect(() => validateArmRegisterEdit(16, 0)).toThrow(/R0–R15/);
  });

  it('preserves 26-bit status/mode while converting execute PC to stored pipeline R15', () => {
    expect(composeArm26R15(0x8c000003, 0x8000)).toBe(0x8c00800b);
  });
});
