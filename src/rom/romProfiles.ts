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
  | { id: 'elkjs'; version: 'ff123355' }
  /* The Elkulator WebAssembly port, pinned to the revision it is built from.
   * It boots an Electron, draws its screen and carries a per-instruction hook,
   * so the expansion set below is offered like any other. The expansions
   * themselves stay planned until each has been exercised through it. See
   * docker/elkulator/. */
  | { id: 'elkulator'; version: 'allegro5-6785521' };

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

const elkulator = { id: 'elkulator', version: 'allegro5-6785521' } as const;

/*
 * The expansion ROMs an Electron needs to be more than a bare machine.
 *
 * Every one of these is a manifest and not a file. No firmware may enter this
 * repository or its image, so what is declared is the name, the sizes the
 * emulator accepts, the role it plays and the capability that requires it; the
 * bytes are supplied through the firmware vault by whoever owns them.
 *
 * The sizes are the ones observed in the 1MHzPi project's own Elkulator ROM
 * directory, which is where these combinations are actually exercised on
 * hardware, so a file that is the wrong size is refused before it can produce
 * a machine that half works.
 */
const elkExpansion = (id: string, label: string, path: string, capability: string, note: string, sizes = [16384]) =>
  rom(id, label, path, sizes, 'extension', false, capability, {
    runtimeMount: 'sideways', supportStatus: 'development', provenanceNote: note,
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
    /*
     * The same machine with the earlier BASIC.
     *
     * BASIC I and BASIC II are different languages to a program that can tell
     * them apart — OPENUP, the OSCLI keyword and several error messages arrive
     * with II — so a build targeting the earlier one deserves a machine that
     * actually has it rather than a note saying it is close enough. The engine
     * model is the same; only the image in the language socket differs, and the
     * vault serves each set from its own directory.
     */
    id: 'os12-basic1', machineIds: ['bbc-b'], label: 'BBC MOS 1.20 + BASIC I + DFS', adapterModel: 'B-DFS0.9', engine,
    requirements: [
      rom('os', 'MOS 1.20 operating system', 'os.rom', [16384], 'operating-system'),
      rom('basic1', 'BBC BASIC I', 'BASIC.ROM', [16384], 'language', true, undefined, {
        provenanceNote: 'The first BBC BASIC, loaded through the path the engine names for the language socket.',
      }),
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
    /*
     * MOS 3.50 is the same machine with later firmware, so it is the same
     * engine model with a different image in its own vault directory.
     *
     * The emulator path says `mos3.20` and that is not a mistake. jsbeeb's
     * Master model names the file it asks for, and the vault serves each ROM
     * set from its own directory, so the path is the engine's name for the
     * socket rather than a claim about which firmware is in it. Putting a 3.50
     * image at a path called 3.50 would simply mean the emulator never read it.
     *
     * No image is shipped. This is a manifest: it says what a person needs to
     * supply and what will be checked when they do, which is why the set can
     * exist here before any firmware does.
     */
    id: 'mos350', machineIds: ['master'], label: 'Master MOS 3.50', adapterModel: 'Master', engine,
    requirements: [
      rom('mos350', 'Master MOS 3.50 combined image', 'master/mos3.20', [131072], 'operating-system', true, undefined, {
        provenanceNote: 'The later Master 128 firmware, as a 128 KiB combined image of eight 16 KiB banks in the order the engine reads them. It is loaded through the path the engine names for the Master OS socket.',
      }),
      rom('tube65c102', '65C102 Turbo Tube boot ROM', 'tube/65C102Tube.rom', [2048], 'extension', false, 'tube'),
      bbcWifi(),
    ],
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
    /*
     * The Electron as it is actually used, rather than as ElkJS can run it.
     *
     * This set exists for the Elkulator port and is declared ahead of it
     * deliberately: the combinations are known, they are exercised on real
     * hardware in the 1MHzPi project, and writing them down now means the
     * firmware a person already owns can be registered and checked before the
     * core is able to boot it. That core boots now, so this set is selectable;
     * what is still not claimed is that the expansions work, because none of
     * them has been exercised through it yet.
     */
    id: 'electron-expanded', machineIds: ['electron'], label: 'Electron + Plus 1 expansions', adapterModel: 'Electron', engine: elkulator,
    requirements: [
      rom('os', 'Electron operating system 1.00', 'roms/os', [16384], 'operating-system'),
      rom('basic', 'BBC BASIC II for the Electron', 'roms/basic.rom', [16384], 'language'),
      /* The Plus 1 is the board every other expansion here plugs into, so its
       * own ROM is what the cartridge slots and the printer and analogue ports
       * come from. It is 4 KB rather than 16. */
      elkExpansion('plus1', 'Plus 1 expansion ROM', 'roms/plus1.rom', 'plus1', 'Acorn Plus 1 support ROM. Supplies the cartridge slots, printer port and analogue port.', [4096]),
      elkExpansion('adfs', 'Acorn ADFS for the Plus 3', 'roms/acorn-adfs.rom', 'plus3', 'Acorn ADFS. The Plus 3 disc interface is unusable without it.'),
      elkExpansion('dfs', 'Electron DFS', 'roms/dfs.rom', 'plus3', 'Disc filing system for Electron disc interfaces.'),
      elkExpansion('emmfs', 'EMMFS · MMFS for the Electron', 'roms/EMMFS.rom', 'plus1', 'MMFS built for the Electron, giving SD-card storage through the cartridge slot.'),
      elkExpansion('eswmmfs', 'ESWMMFS · sideways-RAM MMFS', 'roms/ESWMMFS.rom', 'sideways', 'MMFS variant that keeps its workspace in sideways RAM.'),
      elkExpansion('zemmfs', 'ZEMMFS · MMFS variant', 'roms/ZEMMFS.rom', 'plus1', 'A further MMFS build carried by the 1MHzPi project.'),
      elkExpansion('afm', 'Advanced File Manager 1.09', 'roms/AFM1V09.rom', 'plus1', 'Advanced File Manager, a filing-system front end used with MMFS.'),
      elkExpansion('rhplus1', 'Retro Hardware Plus 1 support 1.33', 'roms/RHPLUS133.rom', 'plus1', 'Support ROM for the Retro Hardware Plus 1 reimplementation, which is the board the 1MHzPi work uses.'),
      elkExpansion('elkwifi', 'ElkWiFi 1MHz bus firmware', 'roms/elkwifi.rom', '1mhzpi', 'Built from the 1MHzPi project\u2019s own source rather than obtained; re-import after a firmware rebuild. Its size is not a round 16 KB.', [16384, 16406]),
      /* The Electron's Tube is on the Plus 1's expansion connector, so the
       * client ROM is a 4 KB parasite image rather than a sideways one. */
      rom('tube6502', '6502 Tube client 1.20', 'roms/6502tube_120.rom', [4096], 'extension', false, 'tube', {
        supportStatus: 'development', provenanceNote: 'Parasite boot ROM for a 6502 second processor on the Plus 1 expansion connector.',
      }),
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
