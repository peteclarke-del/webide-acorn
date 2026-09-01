import type {
  MachineCapability,
  MachineProfile,
  PlatformClass,
  PlatformClassId,
  ResolvedTarget,
} from '../types';

export const platformClasses: PlatformClass[] = [
  {
    id: '8-16-bit',
    label: '8 / 16-bit Acorn',
    detail: '6502, 65C02 and Tube systems',
  },
  {
    id: '32-bit',
    label: '32-bit ARM Acorn',
    detail: 'Archimedes and later RISC OS systems',
  },
];

const capability = (
  id: string,
  label: string,
  description: string,
  state: MachineCapability['state'] = 'supported',
  defaultEnabled = false,
  requirement?: string,
  requiresVariant?: string,
): MachineCapability => ({
  id,
  label,
  description,
  state,
  defaultEnabled,
  requirement,
  requiresVariant,
});

export const machineProfiles: MachineProfile[] = [
  {
    id: 'atom',
    platformClass: '8-16-bit',
    family: 'Atom',
    label: 'Acorn Atom',
    shortLabel: 'Atom',
    generation: '1980 · desktop micro',
    cpu: 'MOS 6502 @ 1 MHz',
    memory: '2–12 KB base RAM',
    variants: ['Atom 12K', 'Atom 12K + AtomDOS', 'Atom 12K + AtoMMC'],
    roms: [
      { id: 'atom-mos', label: 'Atom MOS 1.0', detail: 'Base MOS and BASIC' },
      { id: 'atom-fp', label: 'Atom MOS + FP ROM', detail: 'Floating-point extension' },
    ],
    capabilities: [
      capability('cassette', 'Cassette interface', 'Tape image loading and recording', 'supported', true),
      /* Both of these are peripherals a particular Atom is fitted with, so the
       * variant is named rather than described: enabling either on a plain
       * Atom 12K would claim hardware that is not there. */
      capability('atomdos', 'AtomDOS', 'Disk operating system and controller', 'preview', false, undefined, 'Atom 12K + AtomDOS'),
      capability('fp-rom', 'Floating-point ROM', 'Floating-point BASIC extension', 'supported'),
      capability('atommc', 'AtoMMC storage', 'SD/MMC mass-storage interface', 'preview', false, undefined, 'Atom 12K + AtoMMC'),
      capability('colour-board', 'Colour board', 'Expanded colour output', 'planned'),
    ],
    accent: '#e7ad42',
  },
  {
    id: 'bbc-a',
    platformClass: '8-16-bit',
    family: 'BBC Micro',
    label: 'Acorn BBC Model A',
    shortLabel: 'BBC A',
    generation: '1981 · BBC Computer Literacy Project',
    cpu: 'MOS 6502A @ 2 MHz',
    memory: '16 KB RAM',
    variants: ['Model A 16K', 'Model A upgraded 32K'],
    roms: [
      {
        id: 'os12-basic2', label: 'OS 1.20 + BASIC II', detail: 'Standard MOS and BASIC',
        unavailableReason: 'jsbeeb models the BBC B and no Model A. The two differ in fitted RAM and in which interfaces are present, so running a Model A profile on the B model would be a Model B wearing the name — and every difference that matters to a program written for a Model A is one this build would not show. The profile is listed because the product models the machine, not because this build can run it.',
      },
      {
        id: 'os10-basic1', label: 'OS 1.00 + BASIC I', detail: 'Early firmware profile',
        unavailableReason: 'jsbeeb models the BBC B and no Model A, so this early Model A firmware combination has no machine here to run on. Its BASIC I differs from BASIC II in ways a program can detect, and pretending otherwise on a Model B would be worse than saying so.',
      },
    ],
    capabilities: [
      capability('cassette', 'Cassette interface', 'UEF tape workflow', 'supported', true),
      capability('model-b-upgrade', 'Model B interfaces', 'User/analogue/1 MHz bus expansion', 'preview'),
      capability('econet', 'Econet', 'Network interface and NFS ROM', 'planned'),
      capability('tube', 'Tube interface', 'External second processor', 'planned'),
    ],
    accent: '#dccb8c',
  },
  {
    id: 'bbc-b',
    platformClass: '8-16-bit',
    family: 'BBC Micro',
    label: 'Acorn BBC Model B',
    shortLabel: 'BBC B',
    generation: '1981 · 8-bit reference target',
    cpu: 'MOS 6502A @ 2 MHz',
    memory: '32 KB RAM',
    variants: ['Model B · 8271 DFS', 'Model B · 1770 DFS', 'Model B · cassette'],
    roms: [
      { id: 'os12-basic2-dfs', label: 'OS 1.20 + BASIC II + DFS 0.90', detail: 'Canonical development set' },
      { id: 'os12-basic2-adfs', label: 'OS 1.20 + BASIC II + ADFS', detail: '1770 storage profile' },
      { id: 'os12-basic1', label: 'OS 1.20 + BASIC I + DFS 0.90', detail: 'Compatibility profile: the same machine with the earlier BASIC' },
    ],
    capabilities: [
      capability('dfs', 'DFS disk system', '8271/1770 disk image mastering', 'supported', true),
      capability('cassette', 'Cassette interface', 'UEF tape workflow', 'supported'),
      capability('sideways', 'Sideways RAM', 'Writable ROM banks at &8000', 'supported', true),
      capability('1mhzpi', '1MHzPi WiFi ROM', 'Development sideways ROM for the external 1 MHz bus interface', 'preview'),
      capability('tube', 'Tube second processor', 'The pinned core fits the interface but never hands the language over on this machine: the parasite runs its own ROM and waits, and its RAM is untouched. It boots on the Master, so this is the machine and not the feature', 'planned'),
      capability('econet', 'Econet', 'Network interface and NFS ROM', 'planned'),
      capability('speech', 'Speech system', 'TMS5220 speech hardware and PHROM', 'planned'),
    ],
    accent: '#dfc782',
  },
  {
    id: 'bbc-bplus',
    platformClass: '8-16-bit',
    family: 'BBC Micro',
    label: 'Acorn BBC B+',
    shortLabel: 'BBC B+',
    generation: '1985 · enhanced BBC Micro',
    cpu: 'MOS 6502A @ 2 MHz',
    memory: '64 or 128 KB RAM',
    variants: ['B+ 64K', 'B+ 128K'],
    roms: [
      {
        id: 'bplus-os', label: 'B+ MOS + BASIC II + DFS', detail: 'Standard B+ ROM set',
        unavailableReason: 'No emulator here models a BBC B+. jsbeeb publishes no B+ machine — not in the pinned 1.19.1 and not in the current 1.22.4 — and the B+ is not a Model B with different firmware: it has shadow screen RAM and twelve kilobytes of paged RAM reached through a control register the Model B does not have. Running B+ firmware on the B model would boot, and would be wrong exactly where a B+ program differs from a B one.',
      },
      {
        id: 'bplus-adfs', label: 'B+ MOS + BASIC II + ADFS', detail: 'ADFS storage set',
        unavailableReason: 'The same obstacle as the DFS set: no emulator here models a BBC B+, so its shadow and paged RAM cannot be executed. The filing system is not what is missing.',
      },
    ],
    capabilities: [
      capability('shadow', 'Shadow screen RAM', 'Dedicated display memory', 'supported', true),
      capability('sideways', 'Sideways RAM', '12 KB or 64 KB banked workspace', 'supported', true),
      capability('dfs', '1770 DFS', 'Disk image mastering', 'supported', true),
      capability('adfs', 'ADFS', 'Hierarchical filing system', 'preview'),
      capability('tube', 'Tube second processor', 'External parasite CPU. Not offered while the pinned core does not complete the Tube boot on a BBC-family host; it does on the Master', 'planned'),
      capability('1mhzpi', '1MHzPi WiFi ROM', 'Development sideways ROM shared with BBC B and Master profiles', 'preview'),
      capability('econet', 'Econet', 'Network interface', 'planned'),
    ],
    accent: '#c7b474',
  },
  {
    id: 'electron',
    platformClass: '8-16-bit',
    family: 'Electron',
    label: 'Acorn Electron',
    shortLabel: 'Electron',
    generation: '1983 · compact home computer',
    cpu: 'MOS 6502A @ 2 MHz variable',
    memory: '32 KB shared RAM',
    variants: ['Electron', 'Electron + Plus 1', 'Electron + Plus 3'],
    roms: [
      { id: 'electron-os', label: 'Electron OS 1.0 + BASIC II', detail: 'Standard firmware' },
      { id: 'electron-expanded', label: 'Electron + Plus 1 expansions', detail: 'Elkulator core with the Plus 1, Plus 3 and sideways boards' },
    ],
    /* Two cores can run this machine and they are not equally equipped. ElkJS
     * models a base 32 KB Electron with an operating system and BASIC and
     * nothing else; Elkulator, built for WebAssembly, is the full machine with
     * sideways banks, the Plus 1 and the Plus 3.
     *
     * The cassette interface is supported because it was proved rather than
     * assumed: a tape written by this build was mounted on a real Electron
     * under Elkulator in a browser, `*LOAD` was typed at its keyboard, the
     * machine turned its own cassette motor on, and every byte of the file
     * arrived at its load address.
     *
     * The expansions below stay planned, and the reason has changed. It is no
     * longer that no core can run them — Elkulator runs, and the bridge mounts
     * disc images through its own loader. It is that each one needs firmware
     * this vault does not hold: a Plus 1 ROM, an ADFS or DFS ROM. An expansion
     * whose ROM is absent is an expansion that is not fitted, and saying it is
     * supported would promise a machine nobody here can start. */
    capabilities: [
      capability('cassette', 'Cassette interface', 'UEF tape workflow', 'supported', true),
      capability('plus1', 'Plus 1 expansion', 'Cartridge, printer and analogue interfaces', 'planned', false, 'a Plus 1 ROM in the firmware vault; the Elkulator core fits one when it is there'),
      capability('plus3', 'Plus 3 expansion', '3.5-inch disk and ADFS', 'planned', false, 'an ADFS or DFS ROM in the firmware vault; the bridge mounts disc images through Elkulator\'s own loader once a machine has an interface to read them with'),
      capability('sideways', 'Sideways RAM', 'Expansion banked memory', 'planned', false, 'a sideways ROM manifest for the Elkulator core; ElkJS decodes every unclaimed ROM bank to BASIC'),
      capability('joystick', 'Joystick interface', 'Configurable expansion joystick', 'planned', false, 'the Plus 1, which needs its ROM'),
      capability('1mhzpi', '1MHzPi / ElkWiFi', 'Development Plus 1 RH and modified ElkWiFi firmware', 'planned', false, 'the Plus 1 the ElkWiFi board plugs into'),
    ],
    accent: '#cf6857',
  },
  {
    id: 'master',
    platformClass: '8-16-bit',
    family: 'Master',
    label: 'BBC Master Series',
    shortLabel: 'Master',
    generation: '1986 · advanced 8-bit range',
    cpu: 'WDC 65C12 @ 2 MHz',
    memory: '128 KB base RAM',
    variants: ['Master 128', 'Master Turbo', 'Master 512', 'Master Compact'],
    roms: [
      { id: 'mos320', label: 'MOS 3.20', detail: 'Original Master firmware' },
      { id: 'mos350', label: 'MOS 3.50', detail: 'Updated Master firmware' },
      {
        id: 'compact510', label: 'Compact MOS 5.10', detail: 'Master Compact profile',
        unavailableReason: 'The Master Compact is a different machine, not a Master 128 with later firmware: a different keyboard, no Tube and its own MOS entry points. jsbeeb models the Master 128 and no Compact, so running Compact firmware on it would boot something that is not a Compact and would be wrong in ways nothing here would catch. Supplying the ROM would not change that.',
      },
    ],
    capabilities: [
      capability('shadow', 'Shadow & Hazel RAM', 'Display and private workspace', 'supported', true),
      capability('sideways', 'Sideways RAM', 'Four writable bank slots', 'supported', true),
      capability('adfs', 'ADFS', 'Integrated hierarchical filing system', 'supported', true),
      capability('dfs', 'DFS', '1770 DFS compatibility', 'supported'),
      capability('tube', 'Tube / Turbo', 'Internal 65C102 Turbo second processor. The host reports it, the language is transferred and a conformance case passes on real hardware', 'supported'),
      capability('1mhzpi', '1MHzPi WiFi ROM', 'Development sideways ROM shared with BBC B and B+ profiles', 'preview'),
      capability('econet', 'Econet', 'Network interface and ANFS', 'planned'),
    ],
    accent: '#9eac91',
  },
  {
    id: 'archimedes-a300',
    platformClass: '32-bit',
    family: 'Archimedes',
    label: 'Acorn Archimedes A300',
    shortLabel: 'A300',
    generation: '1987 · first-generation ARM',
    cpu: 'ARM2 @ 8 MHz',
    memory: '512 KB–1 MB RAM',
    variants: ['A305 · 512K', 'A310 · 1MB'],
    roms: [
      { id: 'arthur120', label: 'Arthur 1.20', detail: 'Early desktop environment' },
      { id: 'riscos200', label: 'RISC OS 2.00', detail: 'First RISC OS release' },
      { id: 'riscos201', label: 'RISC OS 2.01', detail: '1990 maintenance release' },
      { id: 'riscos300', label: 'RISC OS 3.00', detail: 'Compatibility upgrade' },
      { id: 'riscos310', label: 'RISC OS 3.10', detail: '1992 desktop upgrade' },
      { id: 'riscos311', label: 'RISC OS 3.11', detail: 'Common final A300-series upgrade' },
    ],
    capabilities: [
      capability('adfs', 'ADFS floppy', '800 KB disk workflow', 'supported', true),
      capability('podules', 'Podule expansion', 'Backplane expansion devices', 'preview'),
      capability('econet', 'Econet', 'Acorn network interface', 'planned'),
      capability('harddisc', 'ST-506 hard disk', 'A300 storage expansion', 'preview'),
      capability('fpa', 'Floating-point accelerator', 'Floating-point podule', 'planned'),
    ],
    accent: '#76b6aa',
  },
  {
    id: 'archimedes-a400',
    platformClass: '32-bit',
    family: 'Archimedes',
    label: 'Acorn Archimedes A400/1',
    shortLabel: 'A400/1',
    generation: '1989 · ARM3-ready workstation',
    cpu: 'ARM2 / ARM3',
    memory: '1–8 MB RAM',
    variants: ['A410/1', 'A420/1', 'A440/1', 'A540'],
    roms: [
      { id: 'riscos201', label: 'RISC OS 2.01', detail: 'A400 series release' },
      { id: 'riscos310', label: 'RISC OS 3.10', detail: 'ARM3-era desktop' },
      { id: 'riscos311', label: 'RISC OS 3.11', detail: 'Updated desktop ROM' },
    ],
    capabilities: [
      capability('adfs', 'ADFS', 'Floppy and hard disk filing', 'supported', true),
      capability('arm3', 'ARM3 upgrade', 'Cache-equipped ARM3 processor', 'preview'),
      capability('harddisc', 'Hard disk', 'ST-506 or SCSI storage', 'supported', true),
      capability('podules', 'Podule expansion', 'Expansion backplane', 'preview'),
      capability('fpa', 'FPA10', 'Floating-point accelerator', 'planned'),
    ],
    accent: '#67a9a4',
  },
  {
    id: 'a3000',
    platformClass: '32-bit',
    family: 'Archimedes',
    label: 'BBC Acorn A3000',
    shortLabel: 'A3000',
    generation: '1989 · compact ARM desktop',
    cpu: 'ARM2 @ 8 MHz',
    memory: '1–4 MB RAM',
    variants: ['A3000 · 1MB', 'A3000 · 2MB', 'A3000 · 4MB'],
    roms: [
      { id: 'riscos201-a3k', label: 'RISC OS 2.01', detail: 'Original A3000 ROM' },
      { id: 'riscos311-a3k', label: 'RISC OS 3.11', detail: 'Common upgrade ROM' },
    ],
    capabilities: [
      capability('adfs', 'ADFS floppy', '800 KB disk workflow', 'supported', true),
      capability('internal-exp', 'Internal expansion', 'Mini-podule expansion', 'preview'),
      capability('econet', 'Econet', 'Education network interface', 'planned'),
      capability('harddisc', 'External hard disk', 'SCSI/IDE expansion', 'preview'),
    ],
    accent: '#85b978',
  },
  {
    id: 'a5000',
    platformClass: '32-bit',
    family: 'Later ARM',
    label: 'Acorn A5000',
    shortLabel: 'A5000',
    generation: '1991 · ARM3 desktop',
    cpu: 'ARM3 @ 25/33 MHz',
    memory: '2–8 MB RAM',
    variants: ['A5000', 'A5000 Alpha'],
    roms: [
      {
        id: 'riscos310-a5k', label: 'RISC OS 3.10', detail: 'Original A5000 release',
        unavailableReason: 'The qualified Arculator slice in this build covers the A310 class only, and the Archimedes firmware inventory carries no A5000 entry, so there is no machine here for this ROM to run on. The A5000 is an ARM3 machine with a different memory controller and IDE rather than floppy-first storage; it is described because the product models it, not because this build emulates it.',
      },
      {
        id: 'riscos311-a5k', label: 'RISC OS 3.11', detail: 'Updated desktop ROM',
        unavailableReason: 'The same obstacle as the 3.10 set: no A5000 is modelled here and no A5000 firmware entry is registered. The RISC OS version is not what is missing.',
      },
    ],
    capabilities: [
      capability('adfs', 'IDE + ADFS', 'Integrated hard disk and floppy', 'supported', true),
      capability('arm3', 'ARM3 cache', 'Integrated cached processor', 'supported', true),
      capability('podules', 'Podule expansion', 'Expansion cards', 'preview'),
      capability('multiscan', 'Multiscan display', 'VGA-class display modes', 'preview'),
      capability('econet', 'Econet', 'Network interface', 'planned'),
    ],
    accent: '#79a5cf',
  },
  {
    id: 'riscpc',
    platformClass: '32-bit',
    family: 'Later ARM',
    label: 'Acorn Risc PC',
    shortLabel: 'Risc PC',
    generation: '1994 · later ARM compatibility tier',
    cpu: 'ARM610 / ARM710 / StrongARM',
    memory: '4–256 MB RAM',
    variants: ['Risc PC 600', 'Risc PC 700', 'StrongARM Risc PC'],
    roms: [
      {
        id: 'riscos350', label: 'RISC OS 3.50', detail: 'Original Risc PC ROM',
        unavailableReason: 'No Risc PC is modelled here: the qualified Arculator slice covers the A310 class, and the Risc PC is a different machine again — ARM610 and later, VIDC20, and a ROM image in a format the Archimedes inventory does not describe. The profile is listed because the product models the machine.',
      },
      {
        id: 'riscos370', label: 'RISC OS 3.70', detail: 'StrongARM-era ROM',
        unavailableReason: 'The same obstacle as the 3.50 ROM: no Risc PC is modelled here, and a StrongARM-era ROM has no machine in this build to be loaded into.',
      },
    ],
    capabilities: [
      capability('vidc20', 'VIDC20 display', 'High-colour and multisync modes', 'preview', true),
      capability('ide', 'IDE + ADFS', 'Integrated storage', 'preview', true),
      capability('second-slice', 'Second processor slice', 'x86 compatibility hardware', 'planned'),
      capability('podules', 'Podule expansion', 'Expansion cards', 'planned'),
      capability('network', 'Ethernet', 'Network podule support', 'planned'),
    ],
    accent: '#8879c9',
  },
];

export const machinesForPlatform = (platformClass: PlatformClassId) =>
  machineProfiles.filter((machine) => machine.platformClass === platformClass);

export const defaultCapabilities = (machine: MachineProfile) =>
  machine.capabilities
    .filter((item) => item.defaultEnabled && item.state !== 'planned')
    .map((item) => item.id);

export const resolveTarget = (
  platformClass: PlatformClassId,
  machineId: string,
  variant: string,
  romId: string,
  enabledCapabilities: string[],
): ResolvedTarget => {
  const availableMachines = machinesForPlatform(platformClass);
  const machine =
    availableMachines.find((candidate) => candidate.id === machineId) ??
    availableMachines[0];

  if (!machine) {
    throw new Error(`No machine profiles registered for ${platformClass}`);
  }

  const resolvedVariant = machine.variants.includes(variant)
    ? variant
    : (machine.variants[0] ?? 'Default');
  const rom = machine.roms.find((candidate) => candidate.id === romId) ?? machine.roms[0];

  if (!rom) {
    throw new Error(`No ROM profiles registered for ${machine.id}`);
  }

  const selectable = new Set(
    machine.capabilities
      .filter((item) => item.state !== 'planned')
      .map((item) => item.id),
  );

  return {
    platformClass,
    machine,
    variant: resolvedVariant,
    rom,
    enabledCapabilities: enabledCapabilities.filter((id) => selectable.has(id)),
  };
};
