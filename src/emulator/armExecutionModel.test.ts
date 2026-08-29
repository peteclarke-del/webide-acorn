import { describe, expect, it } from 'vitest';
import { armLinkReturnTarget, armStepOverTarget, isArmBranchWithLink, validateArmExecutionAddress } from './armExecutionModel';

describe('ARM2 execution controls', () => {
  it('accepts only aligned addresses in the 26-bit execution space', () => {
    expect(validateArmExecutionAddress(0x038021b8)).toBe(0x038021b8);
    expect(() => validateArmExecutionAddress(0x038021ba)).toThrow(/aligned/);
    expect(() => validateArmExecutionAddress(0x04000000)).toThrow(/26-bit/);
  });

  it('steps over only branch-with-link instructions', () => {
    expect(isArmBranchWithLink(0xeb000001)).toBe(true);
    expect(armStepOverTarget(0x8000, 0xeb000001)).toBe(0x8004);
    expect(isArmBranchWithLink(0xea000001)).toBe(false);
    expect(armStepOverTarget(0x8000, 0xea000001)).toBeNull();
  });

  it('extracts and validates the 26-bit aligned return address from R14', () => {
    expect(armLinkReturnTarget(0xfc008127)).toBe(0x008124);
  });
});
