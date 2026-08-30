export type MemoryProfile = 'bbc' | 'master' | 'atom';
export type MemoryRegionKind = 'ram' | 'rom' | 'io' | 'banked' | 'overlay';
export type MemorySpaceId = 'mapped' | 'main' | 'sideways' | 'os' | 'shadow' | 'hazel' | 'andy' | 'atom-rom' | 'atom-os' | 'tube-logical' | 'tube-ram' | 'tube-rom';

export interface MemoryRegion { start: number; end: number; label: string; kind: MemoryRegionKind; active?: boolean; detail?: string }
export interface MemorySpace { id: MemorySpaceId; label: string; start: number; end: number; banked?: boolean; writable: boolean }
export interface MemoryMapState {
  profile: MemoryProfile;
  romsel?: number;
  selectedBank?: number;
  selectedBankWritable?: boolean;
  acccon?: number;
  accconFlags: Array<{ bit: string; set: boolean; meaning: string }>;
  regions: MemoryRegion[];
  spaces: MemorySpace[];
  banks: Array<{ bank: number; writable: boolean; selected: boolean }>;
}

export interface MappedAddressIdentity {
  addressSpace: 'mapped 6502';
  region: string;
  kind: MemoryRegionKind;
  bank?: number;
  writable: boolean;
  source: string;
}

interface MemoryMapInput { isMaster: boolean; isAtom: boolean; romsel: number; acccon: number; swram: boolean[] }

export function createMemoryMapState(input: MemoryMapInput): MemoryMapState {
  if (input.isAtom) return {
    profile: 'atom', accconFlags: [], banks: [],
    spaces: [space('mapped', 'Mapped Atom CPU view', 0, 0xffff, false), space('main', 'Physical main/video RAM', 0, 0x9fff, true), space('atom-rom', 'Atom language/utility ROM', 0xc000, 0xefff, false), space('atom-os', 'Atom kernel ROM', 0xf000, 0xffff, false)],
    regions: [region(0, 0x9fff, 'Main + video RAM', 'ram'), region(0xa000, 0xafff, 'Branquart bank', 'banked'), region(0xb000, 0xbfff, 'PPIA / VIA / expansion I/O', 'io'), region(0xc000, 0xefff, 'Language / utility ROM', 'rom'), region(0xf000, 0xffff, 'Kernel ROM', 'rom')],
  };
  const bank = input.romsel & 0x0f;
  const writable = Boolean(input.swram[bank]);
  const banks = Array.from({ length: 16 }, (_, index) => ({ bank: index, writable: Boolean(input.swram[index]), selected: index === bank }));
  if (!input.isMaster) return {
    profile: 'bbc', romsel: input.romsel & 0xff, selectedBank: bank, selectedBankWritable: writable, accconFlags: [], banks,
    spaces: [space('mapped', 'Mapped BBC CPU view', 0, 0xffff, false), space('main', 'Physical main RAM', 0, 0x7fff, true), space('sideways', 'Physical sideways bank', 0x8000, 0xbfff, writable, true), space('os', 'Physical MOS ROM', 0xc000, 0xffff, false)],
    regions: [region(0, 0x7fff, 'Main RAM', 'ram'), region(0x8000, 0xbfff, `Sideways ${writable ? 'RAM' : 'ROM'} bank ${bank}`, 'banked'), region(0xc000, 0xfbff, 'MOS ROM', 'rom'), region(0xfc00, 0xfeff, 'Hardware I/O overlay', 'io'), region(0xff00, 0xffff, 'MOS ROM / vectors', 'rom')],
  };
  const flags = [
    ['IRR', 0x80, 'IRQ request'], ['TST', 0x40, 'MOS replaces device reads'], ['IFJ', 0x20, 'reserved interface'], ['ITU', 0x10, 'Tube interrupt'],
    ['Y', 0x08, 'HAZEL at &C000'], ['X', 0x04, 'LYNNE shadow at &3000'], ['E', 0x02, 'shadow for MOS access'], ['D', 0x01, 'video uses LYNNE'],
  ] as const;
  const andy = Boolean(input.romsel & 0x80);
  const hazel = Boolean(input.acccon & 0x08);
  const shadow = Boolean(input.acccon & 0x04);
  return {
    profile: 'master', romsel: input.romsel & 0xff, selectedBank: bank, selectedBankWritable: writable, acccon: input.acccon & 0xff, banks,
    accconFlags: flags.map(([bit, mask, meaning]) => ({ bit, set: Boolean(input.acccon & mask), meaning })),
    spaces: [space('mapped', 'Mapped Master CPU view', 0, 0xffff, false), space('main', 'Physical main RAM', 0, 0x7fff, true), space('sideways', 'Physical sideways bank', 0x8000, 0xbfff, writable, true), space('os', 'Physical MOS ROM', 0xc000, 0xffff, false), space('shadow', 'LYNNE shadow RAM', 0x3000, 0x7fff, true), space('hazel', 'HAZEL private RAM', 0xc000, 0xdfff, true), space('andy', 'ANDY private RAM', 0x8000, 0x8fff, true)],
    regions: [region(0, 0x2fff, 'Main RAM', 'ram'), region(0x3000, 0x7fff, shadow ? 'LYNNE shadow RAM' : 'Main RAM', shadow ? 'overlay' : 'ram', shadow, 'ACCCON X'), region(0x8000, 0x8fff, andy ? 'ANDY private RAM' : `Sideways bank ${bank}`, andy ? 'overlay' : 'banked', andy, 'ROMSEL bit 7'), region(0x9000, 0xbfff, `Sideways ${writable ? 'RAM' : 'ROM'} bank ${bank}`, 'banked'), region(0xc000, 0xdfff, hazel ? 'HAZEL private RAM' : 'MOS ROM', hazel ? 'overlay' : 'rom', hazel, 'ACCCON Y'), region(0xe000, 0xfbff, 'MOS ROM', 'rom'), region(0xfc00, 0xfeff, input.acccon & 0x40 ? 'MOS test mapping' : 'Hardware I/O overlay', input.acccon & 0x40 ? 'overlay' : 'io'), region(0xff00, 0xffff, 'MOS ROM / vectors', 'rom')],
  };
}

function region(start: number, end: number, label: string, kind: MemoryRegionKind, active?: boolean, detail?: string): MemoryRegion { return { start, end, label, kind, ...(active === undefined ? {} : { active }), ...(detail ? { detail } : {}) }; }
function space(id: MemorySpaceId, label: string, start: number, end: number, writable: boolean, banked = false): MemorySpace { return { id, label, start, end, writable, ...(banked ? { banked: true } : {}) }; }

export function validateMemorySpaceRead(map: MemoryMapState, addressSpace: MemorySpaceId, address: number, length: number, bank?: number) {
  const space = map.spaces.find((candidate) => candidate.id === addressSpace);
  if (!space) throw new Error(`Address space ${addressSpace} is not available on this machine`);
  if (!Number.isInteger(address) || !Number.isInteger(length) || length < 1 || length > 4096 || address < space.start || address > space.end || address + length - 1 > space.end) throw new Error(`${space.label} reads require 1–4096 bytes wholly inside &${space.start.toString(16).toUpperCase().padStart(4, '0')}–&${space.end.toString(16).toUpperCase().padStart(4, '0')}`);
  if (space.banked && (!Number.isInteger(bank) || bank! < 0 || bank! > 15)) throw new Error('Sideways reads require a bank from 0 to 15');
  return { space, bank: space.banked ? bank : undefined };
}

export function mappedAddressIdentity(map: MemoryMapState, address: number): MappedAddressIdentity {
  const normalized = address & 0xffff;
  const region = map.regions.find((candidate) => normalized >= candidate.start && normalized <= candidate.end);
  if (!region) throw new Error(`Mapped address &${normalized.toString(16).toUpperCase().padStart(4, '0')} has no declared region`);
  const andy = map.profile === 'master' && normalized >= 0x8000 && normalized <= 0x8fff && Boolean((map.romsel ?? 0) & 0x80);
  const sideways = map.profile !== 'atom' && normalized >= 0x8000 && normalized <= 0xbfff && !andy;
  return {
    addressSpace: 'mapped 6502', region: region.label, kind: region.kind,
    ...(sideways ? { bank: map.selectedBank } : {}),
    writable: region.kind === 'ram' || region.kind === 'overlay' || (sideways && Boolean(map.selectedBankWritable)),
    source: sideways ? `live ROMSEL &${(map.romsel ?? 0).toString(16).toUpperCase().padStart(2, '0')}` : map.profile === 'master' && region.kind === 'overlay' ? `live ROMSEL/ACCCON &${(map.romsel ?? 0).toString(16).toUpperCase().padStart(2, '0')}/&${(map.acccon ?? 0).toString(16).toUpperCase().padStart(2, '0')}` : 'resolved live memory map',
  };
}

export function physicalMemoryIndex(space: MemorySpaceId, address: number, bank = 0, romOffset = 0x20000, osOffset = 0x420000) {
  switch (space) {
    case 'main': return address;
    case 'sideways': return romOffset + bank * 0x4000 + address - 0x8000;
    case 'os': return osOffset + address - 0xc000;
    case 'shadow': return address + 0x8000;
    case 'hazel': return address - 0x3000;
    case 'andy': return address;
    case 'atom-rom': return romOffset + address - 0xa000;
    case 'atom-os': return osOffset + address - 0xf000;
    default: return null;
  }
}
