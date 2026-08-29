import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { archimedesRomProfile } from './archimedesRom';
import { filesFromArchimedesImport, prepareArchimedesFirmware } from './archimedesFirmwareImport';

const profile = { ...archimedesRomProfile('archimedes-a300', 'riscos311')!, laneSize: 2 };
const goodFiles = () => [
  ...profile.laneFilenames.map((name, lane) => ({ name: `aa310/${name}`, bytes: new Uint8Array([lane + 1, lane + 5]) })),
  { name: `aa310/${profile.cmosFilename}`, bytes: new Uint8Array(256).fill(0x55) },
];

describe('Archimedes firmware import', () => {
  it('extracts a MAME ZIP and prepares source, interleaved and CMOS records atomically', () => {
    const zip = zipSync(Object.fromEntries(goodFiles().map((file) => [file.name, file.bytes])));
    const prepared = prepareArchimedesFirmware(profile, filesFromArchimedesImport('aa310.zip', zip));
    expect([...prepared.combined]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(prepared.records).toHaveLength(6);
    expect(prepared.records[4]?.key).toBe('archimedes/riscos311/roms/riscos311/rom.bin');
  });

  it('rejects an incomplete set instead of concatenating whichever chips exist', () => {
    expect(() => prepareArchimedesFirmware(profile, goodFiles().slice(1))).toThrow(`Missing ${profile.laneFilenames[0]}`);
  });

  it('rejects an invalid CMOS image', () => {
    const files = goodFiles(); files[4] = { ...files[4]!, bytes: new Uint8Array(255) };
    expect(() => prepareArchimedesFirmware(profile, files)).toThrow('must be 256 bytes');
  });
});
