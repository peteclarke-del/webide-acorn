export interface ArchimedesRomProfile {
  id: string;
  machineIds: string[];
  label: string;
  arculatorRomSet: 'arthur120' | 'riscos200' | 'riscos201' | 'riscos300' | 'riscos310' | 'riscos311';
  laneFilenames: [string, string, string, string];
  laneSize: number;
  cmosFilename: 'cmos_arthur.bin' | 'cmos_riscos2.bin' | 'cmos_riscos3.bin';
}

export interface ArchimedesRuntimeConfiguration {
  profile: ArchimedesRomProfile;
  memoryKiB: 512 | 1024;
  cmosRuntimeName: 'arthur' | 'riscos2' | 'riscos3_old';
}

const profile = (id: string, label: string, arculatorRomSet: ArchimedesRomProfile['arculatorRomSet'], laneFilenames: ArchimedesRomProfile['laneFilenames'], laneSize: number, cmosFilename: ArchimedesRomProfile['cmosFilename']): ArchimedesRomProfile => ({
  id, machineIds: ['archimedes-a300', 'archimedes-a400', 'a3000'], label, arculatorRomSet, laneFilenames, laneSize, cmosFilename,
});

/** Physical chip names and byte-lane ordering from MAME's aa310 definition. */
export const ARCHIMEDES_ROM_PROFILES: ArchimedesRomProfile[] = [
  profile('arthur120', 'Arthur 1.20 (25 Sep 1987)', 'arthur120', ['0277,022-02.rom', '0277,023-02.rom', '0277,024-02.rom', '0277,025-02.rom'], 0x20000, 'cmos_arthur.bin'),
  profile('riscos200', 'RISC OS 2.00 (05 Oct 1988)', 'riscos200', ['0283,022-01.rom', '0283,023-01.rom', '0283,024-01.rom', '0283,025-01.rom'], 0x20000, 'cmos_riscos2.bin'),
  profile('riscos201', 'RISC OS 2.01 (05 Jul 1990)', 'riscos201', ['0270,601-01.rom', '0270,602-01.rom', '0270,603-01.rom', '0270,604-01.rom'], 0x20000, 'cmos_riscos2.bin'),
  profile('riscos300', 'RISC OS 3.00 (25 Sep 1991)', 'riscos300', ['0270,251-01.rom', '0270,252-01.rom', '0270,253-01.rom', '0270,254-01.rom'], 0x80000, 'cmos_riscos3.bin'),
  profile('riscos310', 'RISC OS 3.10 (30 Apr 1992)', 'riscos310', ['0296,041-01.rom', '0296,042-01.rom', '0296,043-01.rom', '0296,044-01.rom'], 0x80000, 'cmos_riscos3.bin'),
  profile('riscos311', 'RISC OS 3.11 (29 Sep 1992)', 'riscos311', ['0296,041-02.rom', '0296,042-02.rom', '0296,043-02.rom', '0296,044-02.rom'], 0x80000, 'cmos_riscos3.bin'),
];

export function archimedesRomProfile(machineId: string, romId: string): ArchimedesRomProfile | undefined {
  const canonicalRomId = romId.replace(/-a3k$/, '');
  return ARCHIMEDES_ROM_PROFILES.find((candidate) => candidate.id === canonicalRomId && candidate.machineIds.includes(machineId));
}

/** Runtime coverage is deliberately narrower than the import inventory. */
export function archimedesRuntimeConfiguration(machineId: string, variant: string, romId: string): ArchimedesRuntimeConfiguration | undefined {
  if (machineId !== 'archimedes-a300') return undefined;
  const selected = archimedesRomProfile(machineId, romId);
  if (!selected) return undefined;
  const memoryKiB = variant.startsWith('A305') ? 512 : variant.startsWith('A310') ? 1024 : undefined;
  if (!memoryKiB) return undefined;
  const cmosRuntimeName = selected.cmosFilename === 'cmos_arthur.bin' ? 'arthur' : selected.cmosFilename === 'cmos_riscos2.bin' ? 'riscos2' : 'riscos3_old';
  return { profile: selected, memoryKiB, cmosRuntimeName };
}

export function archimedesFirmwarePrefix(profileDefinition: ArchimedesRomProfile): string { return `archimedes/${profileDefinition.id}`; }
export function archimedesCombinedRomKey(profileDefinition: ArchimedesRomProfile): string { return `${archimedesFirmwarePrefix(profileDefinition)}/roms/${profileDefinition.arculatorRomSet}/rom.bin`; }
export function archimedesCmosKey(profileDefinition: ArchimedesRomProfile): string { return `${archimedesFirmwarePrefix(profileDefinition)}/cmos/${profileDefinition.cmosFilename}`; }

export function interleaveArchimedesRomLanes(profileDefinition: ArchimedesRomProfile, lanes: readonly Uint8Array[]): Uint8Array {
  if (lanes.length !== 4) throw new Error(`Expected four byte-lane ROMs; received ${lanes.length}.`);
  lanes.forEach((lane, index) => {
    if (lane.length !== profileDefinition.laneSize) throw new Error(`${profileDefinition.laneFilenames[index]} must be ${profileDefinition.laneSize} bytes; received ${lane.length}.`);
    if (lane.every((value) => value === 0x00 || value === 0xff)) throw new Error(`${profileDefinition.laneFilenames[index]} contains only blank ROM values.`);
  });
  const combined = new Uint8Array(profileDefinition.laneSize * 4);
  for (let index = 0; index < profileDefinition.laneSize; index += 1) {
    for (let lane = 0; lane < 4; lane += 1) combined[index * 4 + lane] = lanes[lane]![index]!;
  }
  return combined;
}
