import { ARM26_MAX_ADDRESS } from './armMemoryModel';

export const ARM26_ALIGNED_MAX_ADDRESS = ARM26_MAX_ADDRESS & ~3;

export function validateArmExecutionAddress(address: number): number {
  if (!Number.isInteger(address) || address < 0 || address > ARM26_ALIGNED_MAX_ADDRESS || (address & 3) !== 0) {
    throw new Error('ARM execution targets must be aligned 26-bit addresses');
  }
  return address;
}

export function isArmBranchWithLink(word: number): boolean {
  return ((word >>> 25) & 0x7) === 0x5 && ((word >>> 24) & 1) === 1;
}

export function armStepOverTarget(pc: number, word: number): number | null {
  validateArmExecutionAddress(pc);
  return isArmBranchWithLink(word) ? validateArmExecutionAddress(pc + 4) : null;
}

export function armLinkReturnTarget(linkRegister: number): number {
  return validateArmExecutionAddress((linkRegister >>> 0) & ARM26_ALIGNED_MAX_ADDRESS);
}
