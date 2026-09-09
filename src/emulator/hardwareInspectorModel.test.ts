import { describe, expect, it } from 'vitest';
import { compareHardwareGroups, field, flagFields, formatHardwareValue, packKeyboardColumn, videoNulaGroup, type HardwareInspection } from './hardwareInspectorModel';

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

describe('VideoNuLA inspector group', () => {
  /* The state jsbeeb reports after a machine has redefined physical colour 7
   * to mid grey, which is the worked example in the VideoNuLA user guide. */
  const state = {
    collook: [0, 0, 0, 0, 0, 0, 0, 0xff888888, 0, 0, 0, 0, 0, 0, 0, 0],
    flash: [1, 1, 1, 1, 1, 1, 1, 1],
    paletteWriteFlag: false,
    paletteFirstByte: 0x78,
    paletteMode: 1,
    horizontalOffset: 3,
    leftBlank: 2,
    disabled: false,
    attributeMode: 1,
    attributeText: 0,
  };

  it('reports every write-only register the board holds, because none can be read back', () => {
    const group = videoNulaGroup(state);
    expect(group.id).toBe('video-nula');
    expect(group.registers.every((register) => register.access === 'internal state')).toBe(true);
    const byId = new Map(group.registers.map((register) => [register.id, register.value]));
    expect(byId.get('palette-mode')).toBe(1);
    expect(byId.get('horizontal-offset')).toBe(3);
    expect(byId.get('left-blank')).toBe(2);
    expect(byId.get('attribute-mode')).toBe(1);
    expect(byId.get('colour-7')).toBe(0xff888888);
    expect(byId.get('pending-byte')).toBe(0x78);
  });

  it('says the extended features are on until software disables them', () => {
    const enabled = videoNulaGroup(state).registers.find((register) => register.id === 'enabled');
    const disabled = videoNulaGroup({ ...state, disabled: true }).registers.find((register) => register.id === 'enabled');
    expect(enabled!.value).toBe(1);
    expect(disabled!.value).toBe(0);
  });

  it('reports the sixteen physical colours and eight flash flags, and no more', () => {
    const group = videoNulaGroup({ ...state, collook: Array(64).fill(0), flash: Array(32).fill(0) });
    expect(group.registers.filter((register) => register.id.startsWith('colour-'))).toHaveLength(16);
    expect(group.registers.filter((register) => register.id.startsWith('flash-'))).toHaveLength(8);
  });

  it('reports a machine that has not been asked about anything rather than refusing', () => {
    const group = videoNulaGroup({});
    expect(group.registers.find((register) => register.id === 'enabled')!.value).toBe(1);
    expect(group.registers.filter((register) => register.id.startsWith('colour-'))).toHaveLength(0);
  });
});
