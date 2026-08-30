export const ARM26_MODE_NAMES = ['User', 'FIQ', 'IRQ', 'Supervisor'] as const;

export interface Arm26Status {
  raw: number;
  pc: number;
  mode: number;
  modeName: typeof ARM26_MODE_NAMES[number];
  flags: Array<{ name: 'N' | 'Z' | 'C' | 'V' | 'I' | 'F'; set: boolean; detail: string }>;
}

const flagDetails = [
  ['N', 'Negative condition'], ['Z', 'Zero condition'], ['C', 'Carry / no borrow'],
  ['V', 'Signed overflow'], ['I', 'IRQ disable'], ['F', 'FIQ disable'],
] as const;

export function decodeArm26Status(rawValue: number): Arm26Status {
  const raw = rawValue >>> 0;
  const mode = raw & 3;
  return {
    raw,
    pc: raw & 0x03fffffc,
    mode,
    modeName: ARM26_MODE_NAMES[mode]!,
    flags: flagDetails.map(([name, detail], index) => ({ name, detail, set: !!(raw & (0x80000000 >>> index)) })),
  };
}

export function armPipelineStageName(index: number): 'Execute' | 'Decode' | 'Next fetch' {
  if (index === 0) return 'Execute';
  if (index === 1) return 'Decode';
  return 'Next fetch';
}

const IOC_SOURCES = {
  A: ['Printer latch/busy', 'Serial ring', 'Disc index / printer ACK', 'VBlank', 'Power on', 'Timer 0', 'Timer 1', 'Force IRQ'],
  B: ['Podule FIQ', 'Sound buffer', 'Serial control', 'ST506 / IDE', 'Disc changed / IRQ', 'Podule IRQ', 'Keyboard TX', 'Keyboard RX'],
  F: ['Disc data', 'Disc IRQ', 'Econet', 'Reserved', 'Serial line', 'Reserved', 'Podule FIQ', 'Force FIQ'],
} as const;

export function decodeIocInterrupts(group: keyof typeof IOC_SOURCES, status: number, mask: number): Array<{ bit: number; label: string; asserted: boolean; enabled: boolean; pending: boolean }> {
  return IOC_SOURCES[group].map((label, bit) => ({ bit, label, asserted: !!(status & (1 << bit)), enabled: !!(mask & (1 << bit)), pending: !!((status & mask) & (1 << bit)) }));
}
