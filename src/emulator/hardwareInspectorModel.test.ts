import { describe, expect, it } from 'vitest';
import { compareHardwareGroups, field, flagFields, formatHardwareValue, packKeyboardColumn, type HardwareInspection } from './hardwareInspectorModel';

describe('hardware inspector model', () => {
  it('retains the previous value and marks only changed registers', () => {
    const previous: HardwareInspection = { sequence: 1, cycles: 10, profile: 'bbc', groups: [{ id: 'via', label: 'VIA', source: 'snapshot', registers: [{ id: 'ifr', name: 'IFR', address: '&FE4D', value: 0x40, width: 8, access: 'read/write', changed: false, bitfields: [] }] }] };
    const [group] = compareHardwareGroups([{ id: 'via', label: 'VIA', source: 'snapshot', registers: [{ id: 'ifr', name: 'IFR', address: '&FE4D', value: 0xc0, width: 8, access: 'read/write' }] }], previous);
    expect(group!.registers[0]).toMatchObject({ previousValue: 0x40, value: 0xc0, changed: true });
  });

  it('decodes named flags and packed fields without interpreting inactive bits as active', () => {
    expect(flagFields(0x42, [[6, 'T1'], [5, 'T2'], [1, 'CA1']])).toEqual([
      { label: 'T1', value: '1', active: true }, { label: 'T2', value: '0', active: false }, { label: 'CA1', value: '1', active: true },
    ]);
    expect(field('mode', 0x0c, 0x0c, 2)).toEqual({ label: 'mode', value: '3' });
    expect(formatHardwareValue(0xab, 8)).toBe('&AB');
    expect(formatHardwareValue(0x1234, 16)).toBe('&1234');
  });

  it('packs only the authoritative sixteen keyboard matrix rows', () => {
    expect(packKeyboardColumn([1, 0, 1, 0, 0, 0, 0, 1])).toBe(0x85);
    expect(packKeyboardColumn([...Array(16).fill(0), 1])).toBe(0);
  });
});
