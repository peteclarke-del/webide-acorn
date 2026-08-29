export interface RomRequirement {
  id: string;
  label: string;
  emulatorPath: string;
  acceptedSizes: number[];
  purpose: 'operating-system' | 'language' | 'filing-system' | 'extension';
  required: boolean;
  requiredByCapability?: string;
  runtimeMount?: 'sideways';
  supportStatus?: 'stable' | 'development';
  provenanceNote?: string;
}

/** The emulator that runs a ROM set, pinned to the exact build in use. */
export type RomSetEngine =
  | { id: 'jsbeeb'; version: '1.19.1' }
  | { id: 'elkjs'; version: 'ff123355' };

export interface RomSetDefinition {
  id: string;
  machineIds: string[];
  label: string;
  adapterModel: string;
  engine: RomSetEngine;
  requirements: RomRequirement[];
}

const rom = (id: string, label: string, emulatorPath: string, acceptedSizes: number[], purpose: RomRequirement['purpose'], required = true, requiredByCapability?: string, options: Pick<RomRequirement, 'runtimeMount' | 'supportStatus' | 'provenanceNote'> = {}): RomRequirement => ({ id, label, emulatorPath, acceptedSizes, purpose, required, requiredByCapability, ...options });
const engine = { id: 'jsbeeb', version: '1.19.1' } as const;
const elkjs = { id: 'elkjs', version: 'ff123355' } as const;
const bbcWifi = () => rom('1mhzpi-wifi', '1MHzPi BBC WiFi development ROM', 'development/BBCWiFi-development.rom', [16384], 'extension', false, '1mhzpi', {
  runtimeMount: 'sideways', supportStatus: 'development', provenanceNote: 'Snapshot from the active 1MHzPi project; also intended for BBC B+, BBC B and Master. Re-import after firmware rebuilds.',
});

export const ROM_SETS: RomSetDefinition[] = [
  {
    id: 'os12-basic2-dfs', machineIds: ['bbc-b'], label: 'BBC MOS 1.20 + BASIC II + DFS', adapterModel: 'B-DFS0.9', engine,
    requirements: [
      rom('os', 'MOS 1.20 operating system', 'os.rom', [16384], 'operating-system'),
      rom('basic', 'BBC BASIC II', 'BASIC.ROM', [16384], 'language'),
      rom('dfs', 'DFS filing system', 'b/DFS-0.9.rom', [8192, 16384], 'filing-system'),
      rom('tube6502', '6502 Tube boot ROM', 'tube/6502Tube.rom', [2048], 'extension', false, 'tube'),
      bbcWifi(),
    ],
  },
  {
    id: 'os12-basic2-adfs', machineIds: ['bbc-b'], label: 'BBC MOS 1.20 + BASIC II + ADFS', adapterModel: 'B1770A', engine,
    requirements: [
      rom('os', 'MOS 1.20 operating system', 'os.rom', [16384], 'operating-system'),
      rom('basic', 'BBC BASIC II', 'BASIC.ROM', [16384], 'language'),
      rom('dfs1770', '1770 DFS', 'b1770/dfs1770.rom', [8192, 16384], 'filing-system'),
      rom('adfs', 'ADFS', 'b1770/zADFS.ROM', [16384], 'filing-system'),
      rom('tube6502', '6502 Tube boot ROM', 'tube/6502Tube.rom', [2048], 'extension', false, 'tube'),
      bbcWifi(),
    ],
  },
  {
    id: 'mos320', machineIds: ['master'], label: 'Master MOS 3.20', adapterModel: 'Master', engine,
    requirements: [rom('mos320', 'Master MOS 3.20 combined image', 'master/mos3.20', [131072], 'operating-system'), rom('tube65c102', '65C102 Turbo Tube boot ROM', 'tube/65C102Tube.rom', [2048], 'extension', false, 'tube'), bbcWifi()],
  },
  {
    /* The Electron runs on the vendored ElkJS core, which models a base machine
     * only: it has no expansion ROM slots, so this manifest declares none. */
    id: 'electron-os', machineIds: ['electron'], label: 'Electron OS + BASIC', adapterModel: 'Electron', engine: elkjs,
    requirements: [
      rom('os', 'Electron operating system', 'os.rom', [16384], 'operating-system'),
      rom('basic', 'BBC BASIC II for the Electron', 'BASIC.ROM', [16384], 'language'),
    ],
  },
  {
    id: 'atom-mos', machineIds: ['atom'], label: 'Atom MOS + BASIC', adapterModel: 'Atom-Tape', engine,
    requirements: [
      rom('kernel', 'Atom kernel', 'atom/Atom_Kernel.rom', [4096], 'operating-system'),
      rom('basic', 'Atom BASIC', 'atom/Atom_Basic.rom', [4096], 'language'),
    ],
  },
  {
    id: 'atom-fp', machineIds: ['atom'], label: 'Atom MOS + floating point + BASIC', adapterModel: 'Atom-Tape-FP', engine,
    requirements: [
      rom('kernel', 'Atom kernel', 'atom/Atom_Kernel.rom', [4096], 'operating-system'),
      rom('floating-point', 'Atom floating-point ROM', 'atom/Atom_FloatingPoint.rom', [4096], 'extension'),
      rom('basic', 'Atom BASIC', 'atom/Atom_Basic.rom', [4096], 'language'),
    ],
  },
];

export function romSetFor(machineId: string, romId: string): RomSetDefinition | undefined {
  return ROM_SETS.find((set) => set.id === romId && set.machineIds.includes(machineId));
}

export function requiredRomRequirements(definition: RomSetDefinition, enabledCapabilities: string[] = []): RomRequirement[] {
  return definition.requirements.filter((item) => item.required || (!!item.requiredByCapability && enabledCapabilities.includes(item.requiredByCapability)));
}

export function runtimeSidewaysRomPaths(definition: RomSetDefinition, enabledCapabilities: string[] = []): string[] {
  return definition.requirements
    .filter((item) => item.runtimeMount === 'sideways' && !!item.requiredByCapability && enabledCapabilities.includes(item.requiredByCapability))
    .map((item) => item.emulatorPath);
}

export interface RomValidation { valid: boolean; errors: string[]; warnings: string[]; }

export function validateRom(requirement: RomRequirement, bytes: Uint8Array): RomValidation {
  const errors: string[] = []; const warnings: string[] = [];
  if (!requirement.acceptedSizes.includes(bytes.length)) errors.push(`${requirement.label} must be ${requirement.acceptedSizes.map(formatSize).join(' or ')}; this file is ${formatSize(bytes.length)}.`);
  if (bytes.length && bytes.every((value) => value === 0x00 || value === 0xff)) errors.push('The file contains only blank ROM values.');
  if (bytes.length > 16384 && bytes.length % 16384 === 0) {
    const banks = Array.from({ length: bytes.length / 16384 }, (_, index) => bytes.subarray(index * 16384, (index + 1) * 16384));
    const blankBanks = banks.flatMap((bank, index) => bank.every((value) => value === 0x00 || value === 0xff) ? [index] : []);
    if (blankBanks.length) errors.push(`The combined image contains blank 16 KiB bank${blankBanks.length === 1 ? '' : 's'}: ${blankBanks.join(', ')}.`);
    const identities = banks.map((bank) => bank.reduce((hash, value) => Math.imul(hash ^ value, 0x01000193) >>> 0, 0x811c9dc5));
    const duplicates = identities.flatMap((identity, index) => identities.indexOf(identity) === index ? [] : [index]);
    if (duplicates.length) warnings.push(`The combined image repeats 16 KiB bank${duplicates.length === 1 ? '' : 's'}: ${duplicates.join(', ')}; verify the dump's bank order.`);
  }
  if (requirement.purpose === 'operating-system' && bytes.length >= 4096) {
    const vectorOffset = bytes.length === 131072 ? 16384 - 4 : bytes.length - 4;
    const reset = bytes[vectorOffset]! | bytes[vectorOffset + 1]! << 8;
    if (reset === 0 || reset === 0xffff) warnings.push('The reset vector looks blank; verify that this is the correct firmware image and byte order.');
  }
  const bbcSideways = !requirement.emulatorPath.toLowerCase().startsWith('atom/') && bytes.length <= 16384 && requirement.purpose !== 'operating-system';
  if (bbcSideways && bytes.length >= 8) {
    const languageEntry = bytes[0] === 0x4c; const serviceEntry = bytes[3] === 0x4c; const type = bytes[6]!; const copyrightOffset = bytes[7]!;
    if (!languageEntry && !serviceEntry) warnings.push('The BBC sideways-ROM header has neither a JMP language entry nor a JMP service entry.');
    if ((type & 0xc0) === 0) warnings.push('The BBC sideways-ROM type byte does not declare a language or service entry.');
    if (copyrightOffset < 8 || copyrightOffset >= bytes.length || bytes[copyrightOffset] !== 0) warnings.push('The BBC sideways-ROM copyright offset does not point to its required zero marker.');
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function romStorageKey(setId: string, requirement: RomRequirement): string { return `${setId}/${requirement.emulatorPath}`; }
function formatSize(bytes: number): string { return bytes % 1024 === 0 ? `${bytes / 1024} KiB` : `${bytes} bytes`; }
