import { describe, expect, it } from 'vitest';
import { validateMachineKeyRemaps } from './keyRemapModel';

describe('machine key remaps', () => {
  it('normalizes maintained host and Acorn identities', () => expect(validateMachineKeyRemaps([{ hostCode: 90, targetCode: 32 }, { hostCode: 65, targetCode: 37 }])).toEqual([{ hostCode: 65, targetCode: 37 }, { hostCode: 90, targetCode: 32 }]));
  it('rejects duplicate, unknown and unmaintained targets', () => {
    expect(() => validateMachineKeyRemaps([{ hostCode: 65, targetCode: 32 }, { hostCode: 65, targetCode: 37 }])).toThrow(/one custom/);
    expect(() => validateMachineKeyRemaps([{ hostCode: 999, targetCode: 32 }])).toThrow(/host key/);
    expect(() => validateMachineKeyRemaps([{ hostCode: 65, targetCode: 999 }])).toThrow(/Acorn key/);
  });
});
