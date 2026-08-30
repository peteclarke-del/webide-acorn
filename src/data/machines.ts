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
      { id: 'os12-basic2', label: 'OS 1.20 + BASIC II', detail: 'Standard MOS and BASIC' },
      { id: 'os10-basic1', label: 'OS 1.00 + BASIC I', detail: 'Early firmware profile' },
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
      { id: 'os12-basic1', label: 'OS 1.20 + BASIC I', detail: 'Compatibility profile' },
    ],
    capabilities: [
      capability('dfs', 'DFS disk system', '8271/1770 disk image mastering', 'supported', true),
      capability('cassette', 'Cassette interface', 'UEF tape workflow', 'supported'),
      capability('sideways', 'Sideways RAM', 'Writable ROM banks at &8000', 'supported', true),
      capability('1mhzpi', '1MHzPi WiFi ROM', 'Development sideways ROM for the external 1 MHz bus interface', 'preview'),
      capability('tube', 'Tube second processor', '6502, Z80, ARM and other parasites', 'preview'),
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
      { id: 'bplus-os', label: 'B+ MOS + BASIC II + DFS', detail: 'Standard B+ ROM set' },
      { id: 'bplus-adfs', label: 'B+ MOS + BASIC II + ADFS', detail: 'ADFS storage set' },
    ],
    capabilities: [
      capability('shadow', 'Shadow screen RAM', 'Dedicated display memory', 'supported', true),
      capability('sideways', 'Sideways RAM', '12 KB or 64 KB banked workspace', 'supported', true),
      capability('dfs', '1770 DFS', 'Disk image mastering', 'supported', true),
      capability('adfs', 'ADFS', 'Hierarchical filing system', 'preview'),
      capability('tube', 'Tube second processor', 'External parasite CPU', 'preview'),
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
      { id: 'electron-plus3', label: 'Electron OS + ADFS E00', detail: 'Plus 3 disk profile' },
    ],
    /* The vendored ElkJS core models a base 32 KB Electron with an operating
     * system and BASIC and nothing else, so every expansion below is planned
     * rather than supported: enabling one here would change no behaviour in the
     * only adapter that can run this machine. They become real with the
     * Elkulator port recorded in the backlog, which is named as the
     * requirement so the reason is on the control itself. */
    capabilities: [
      capability('cassette', 'Cassette interface', 'UEF tape workflow', 'planned', false, 'the Elkulator port; the vendored ElkJS core has no tape'),
      capability('plus1', 'Plus 1 expansion', 'Cartridge, printer and analogue interfaces', 'planned', false, 'the Elkulator port; the vendored ElkJS core models no Plus 1'),
      capability('plus3', 'Plus 3 expansion', '3.5-inch disk and ADFS', 'planned', false, 'the Elkulator port; the vendored ElkJS core models no Plus 3 or ADFS'),
      capability('sideways', 'Sideways RAM', 'Expansion banked memory', 'planned', false, 'the Elkulator port; ElkJS decodes every unclaimed ROM bank to BASIC'),
      capability('joystick', 'Joystick interface', 'Configurable expansion joystick', 'planned', false, 'the Plus 1 the vendored ElkJS core does not model'),
      capability('1mhzpi', '1MHzPi / ElkWiFi', 'Development Plus 1 RH and modified ElkWiFi firmware', 'planned', false, 'the Elkulator port and a Plus 1 the vendored ElkJS core does not model'),
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
      { id: 'compact510', label: 'Compact MOS 5.10', detail: 'Master Compact profile' },
    ],
    capabilities: [
      capability('shadow', 'Shadow & Hazel RAM', 'Display and private workspace', 'supported', true),
      capability('sideways', 'Sideways RAM', 'Four writable bank slots', 'supported', true),
      capability('adfs', 'ADFS', 'Integrated hierarchical filing system', 'supported', true),
      capability('dfs', 'DFS', '1770 DFS compatibility', 'supported'),
      capability('tube', 'Tube / Turbo', 'Internal or external second processor', 'preview'),
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
      { id: 'riscos310-a5k', label: 'RISC OS 3.10', detail: 'Original A5000 release' },
      { id: 'riscos311-a5k', label: 'RISC OS 3.11', detail: 'Updated desktop ROM' },
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
      { id: 'riscos350', label: 'RISC OS 3.50', detail: 'Original Risc PC ROM' },
      { id: 'riscos370', label: 'RISC OS 3.70', detail: 'StrongARM-era ROM' },
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
