import { ARM26_MAX_ADDRESS } from './armMemoryModel';

export interface ArmMemoryEdit { address: number; bytes: number[] }

export function validateArmMemoryEdit(edit: ArmMemoryEdit): ArmMemoryEdit {
  if (!Number.isInteger(edit.address) || edit.address < 0 || edit.address > ARM26_MAX_ADDRESS) throw new Error('ARM memory edit address must be inside the 26-bit logical address space');
  if (!Array.isArray(edit.bytes) || edit.bytes.length < 1 || edit.bytes.length > 256 || edit.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 0xff)) throw new Error('ARM memory edits require 1–256 byte values');
  if (edit.address + edit.bytes.length - 1 > ARM26_MAX_ADDRESS) throw new Error('ARM memory edits must not wrap past the 26-bit address space');
  return { address: edit.address, bytes: [...edit.bytes] };
}

export function parseArmMemoryEditBytes(text: string): number[] {
  const tokens = text.trim().split(/[\s,]+/).filter(Boolean);
  if (!tokens.length) throw new Error('Enter one or more hexadecimal byte values');
  if (tokens.length > 256) throw new Error('ARM memory edits are limited to 256 bytes');
  return tokens.map((token) => {
    const normalized = token.replace(/^&/, '').replace(/^0x/i, '');
    if (!/^[0-9a-f]{1,2}$/i.test(normalized)) throw new Error(`Invalid hexadecimal byte ${token}`);
    return Number.parseInt(normalized, 16);
  });
}
