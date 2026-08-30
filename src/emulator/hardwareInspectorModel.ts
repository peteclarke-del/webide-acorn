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
