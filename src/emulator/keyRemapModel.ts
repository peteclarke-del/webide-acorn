import { validateMachineTapCode } from './keyboardInputModel';

export interface MachineKeyRemap { hostCode: number; targetCode: number }
export const HOST_REMAP_KEYS = Object.freeze([
  { label: 'Backspace', code: 8 }, { label: 'Enter', code: 13 }, { label: 'Shift', code: 16 }, { label: 'Control', code: 17 }, { label: 'Escape', code: 27 }, { label: 'Space', code: 32 },
  { label: 'Left', code: 37 }, { label: 'Up', code: 38 }, { label: 'Right', code: 39 }, { label: 'Down', code: 40 },
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((label) => ({ label, code: label.charCodeAt(0) })),
  ...Array.from({ length: 12 }, (_, index) => ({ label: `F${index + 1}`, code: 112 + index })),
]);
const HOST_CODES = new Set(HOST_REMAP_KEYS.map((key) => key.code));

export function validateMachineKeyRemaps(value: unknown): MachineKeyRemap[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error('Custom key mappings must contain at most 32 entries');
  const seen = new Set<number>();
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('Custom key mapping entries must be objects');
    const { hostCode, targetCode } = entry as MachineKeyRemap;
    if (!Number.isInteger(hostCode) || !HOST_CODES.has(hostCode)) throw new Error('Custom mapping host key is outside the maintained key list');
    if (seen.has(hostCode)) throw new Error('Each host key can have only one custom mapping');
    seen.add(hostCode);
    return Object.freeze({ hostCode, targetCode: validateMachineTapCode(targetCode) });
  }).sort((left, right) => left.hostCode - right.hostCode);
}

