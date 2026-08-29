import { ARM26_ALIGNED_MAX_ADDRESS, validateArmExecutionAddress } from './armExecutionModel';

export function validateArmRegisterEdit(register: number, value: number): { register: number; value: number } {
  if (!Number.isInteger(register) || register < 0 || register > 15) throw new Error('ARM register index must be R0–R15');
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error('ARM register value must be an unsigned 32-bit integer');
  if (register === 15) validateArmExecutionAddress(value);
  return { register, value: value >>> 0 };
}

export function composeArm26R15(rawR15: number, executeAddress: number): number {
  validateArmExecutionAddress(executeAddress);
  return (((rawR15 >>> 0) & 0xfc000003) | ((executeAddress + 8) & ARM26_ALIGNED_MAX_ADDRESS)) >>> 0;
}
