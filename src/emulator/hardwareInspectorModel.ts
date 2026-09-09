export type HardwareRegisterAccess = 'read/write' | 'read-only' | 'write-only latch' | 'internal state';

export interface HardwareBitfield {
  label: string;
  value: string;
  active?: boolean;
}

export interface HardwareRegister {
  id: string;
  name: string;
  address: string;
  value: number;
  width: 8 | 16 | 32;
  access: HardwareRegisterAccess;
  previousValue?: number;
  changed: boolean;
  bitfields: HardwareBitfield[];
}

export interface HardwareGroup {
  id: string;
  label: string;
  source: string;
  registers: HardwareRegister[];
}

export interface HardwareInspection {
  sequence: number;
  cycles: number;
  profile: 'atom' | 'bbc' | 'master';
  groups: HardwareGroup[];
}

export type HardwareRegisterDraft = Omit<HardwareRegister, 'previousValue' | 'changed' | 'bitfields'> & { bitfields?: HardwareBitfield[] };
export type HardwareGroupDraft = Omit<HardwareGroup, 'registers'> & { registers: HardwareRegisterDraft[] };

export function flagFields(value: number, definitions: Array<[number, string]>): HardwareBitfield[] {
  return definitions.map(([bit, label]) => ({ label, value: value & (1 << bit) ? '1' : '0', active: Boolean(value & (1 << bit)) }));
}

export function field(label: string, value: number, mask: number, shift = 0): HardwareBitfield {
  return { label, value: String((value & mask) >>> shift) };
}

export function compareHardwareGroups(groups: HardwareGroupDraft[], previous: HardwareInspection | null): HardwareGroup[] {
  const oldValues = new Map(previous?.groups.flatMap((group) => group.registers.map((register) => [`${group.id}:${register.id}`, register.value] as const)) ?? []);
  return groups.map((group) => ({
    ...group,
    registers: group.registers.map((register) => {
      const previousValue = oldValues.get(`${group.id}:${register.id}`);
      return { ...register, bitfields: register.bitfields ?? [], ...(previousValue === undefined ? {} : { previousValue }), changed: previousValue !== undefined && previousValue !== register.value };
    }),
  }));
}

export function formatHardwareValue(value: number, width: 8 | 16 | 32): string {
  return `&${(value >>> 0).toString(16).toUpperCase().padStart(width / 4, '0')}`;
}

export function packKeyboardColumn(rows: ArrayLike<number>): number {
  return Array.from(rows).slice(0, 16).reduce((mask, pressed, row) => mask | (Number(pressed) ? 1 << row : 0), 0) & 0xffff;
}

/**
 * The VideoNuLA's own state, as one inspector group.
 *
 * The board replaces the video ULA, so what it holds is hardware state rather
 * than a preference: the twelve-bit palette every physical colour is finally
 * resolved through, the modes it has been put into, and whether software has
 * turned the extended features off and handed &FE22 and &FE23 back to the
 * original two registers. None of it can be read back from the machine, which
 * is why an inspector is the only way to see it: every one of these registers
 * is write-only on real hardware.
 */
export interface VideoNulaState {
  collook?: ArrayLike<number>;
  flash?: ArrayLike<number>;
  paletteWriteFlag?: boolean;
  paletteFirstByte?: number;
  paletteMode?: number;
  horizontalOffset?: number;
  leftBlank?: number;
  disabled?: boolean;
  attributeMode?: number;
  attributeText?: number;
}

export function videoNulaGroup(state: VideoNulaState): HardwareGroupDraft {
  const whole = (value: number | undefined) => Number(value ?? 0) >>> 0;
  const register = (id: string, name: string, address: string, value: number, width: 8 | 16 | 32 = 8): HardwareRegisterDraft =>
    ({ id, name, address, value, width, access: 'internal state' });
  return {
    id: 'video-nula',
    label: 'VideoNuLA',
    source: 'jsbeeb Video.snapshotState().ula · internal state, no register is read',
    registers: [
      register('enabled', 'Extended features', '&FE22 code 5', state.disabled === true ? 0 : 1),
      register('palette-mode', 'Palette mode', '&FE22 code 1', whole(state.paletteMode)),
      register('horizontal-offset', 'Horizontal scroll offset', '&FE22 code 2', whole(state.horizontalOffset)),
      register('left-blank', 'Left blanking size', '&FE22 code 3', whole(state.leftBlank)),
      register('attribute-mode', 'Attribute mode', '&FE22 code 6', whole(state.attributeMode)),
      register('attribute-text', 'Extended attribute mode', '&FE22 code 7', whole(state.attributeText)),
      register('pending-write', 'Palette write phase', '&FE23', state.paletteWriteFlag === true ? 1 : 0),
      register('pending-byte', 'First palette byte held', '&FE23', whole(state.paletteFirstByte)),
      ...Array.from(state.collook ?? [], (colour, index) =>
        register(`colour-${index}`, `Physical colour ${index}`, '&FE23 palette', whole(colour), 32)).slice(0, 16),
      ...Array.from(state.flash ?? [], (value, index) =>
        register(`flash-${index}`, `Flash flag ${index + 8}`, '&FE22 codes 8 and 9', whole(value))).slice(0, 8),
    ],
  };
}
