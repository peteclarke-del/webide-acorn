import { unzipSync } from 'fflate';
import { archimedesCmosKey, archimedesCombinedRomKey, archimedesFirmwarePrefix, interleaveArchimedesRomLanes, type ArchimedesRomProfile } from './archimedesRom';

export interface FirmwareInput { name: string; bytes: Uint8Array }
export interface PreparedFirmwareRecord { key: string; filename: string; bytes: ArrayBuffer }
export interface PreparedArchimedesFirmware { records: PreparedFirmwareRecord[]; combined: Uint8Array; sourceFilenames: string[] }

const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_ENTRY_COUNT = 256;

export function filesFromArchimedesImport(name: string, bytes: Uint8Array): FirmwareInput[] {
  if (!name.toLowerCase().endsWith('.zip')) return [{ name, bytes }];
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error('Archimedes ROM archives are limited to 32 MiB.');
  const extracted = unzipSync(bytes, { filter: (entry) => !entry.name.endsWith('/') });
  const entries = Object.entries(extracted);
  if (entries.length > MAX_ENTRY_COUNT) throw new Error('Archimedes ROM archives are limited to 256 files.');
  return entries.map(([entryName, entryBytes]) => ({ name: entryName, bytes: entryBytes }));
}

export function prepareArchimedesFirmware(profile: ArchimedesRomProfile, inputs: FirmwareInput[]): PreparedArchimedesFirmware {
  const findExact = (expected: string): FirmwareInput => {
    const matches = inputs.filter((input) => basename(input.name).toLowerCase() === expected.toLowerCase());
    if (!matches.length) throw new Error(`Missing ${expected}.`);
    if (matches.length > 1) throw new Error(`More than one ${expected} was supplied.`);
    return matches[0]!;
  };
  const lanes = profile.laneFilenames.map(findExact);
  const cmos = findExact(profile.cmosFilename);
  if (cmos.bytes.length !== 256) throw new Error(`${profile.cmosFilename} must be 256 bytes; received ${cmos.bytes.length}.`);
  if (cmos.bytes.every((value) => value === 0x00 || value === 0xff)) throw new Error(`${profile.cmosFilename} contains only blank values.`);
  const combined = interleaveArchimedesRomLanes(profile, lanes.map((lane) => lane.bytes));
  const prefix = archimedesFirmwarePrefix(profile);
  const records: PreparedFirmwareRecord[] = [
    ...lanes.map((lane, index) => ({ key: `${prefix}/sources/${profile.laneFilenames[index]}`, filename: lane.name, bytes: exactBuffer(lane.bytes) })),
    { key: archimedesCombinedRomKey(profile), filename: `${profile.arculatorRomSet}-interleaved.rom`, bytes: exactBuffer(combined) },
    { key: archimedesCmosKey(profile), filename: cmos.name, bytes: exactBuffer(cmos.bytes) },
  ];
  return { records, combined, sourceFilenames: lanes.map((lane) => lane.name) };
}

function basename(path: string): string { return path.replaceAll('\\', '/').split('/').pop() ?? ''; }
function exactBuffer(bytes: Uint8Array): ArrayBuffer { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer; }
