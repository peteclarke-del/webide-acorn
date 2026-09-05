// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  OLD_DIRECTORY_BYTES,
  OLD_ROOT_SECTOR,
  oldDiscName,
  oldImageSector,
  parseOldDirectory,
  readOldSectors,
} from './adfsOldDirectory';
import {
  OLD_DIRECTORY_SECTORS,
  OLD_DISC_LISTING,
  OLD_DISC_MEASUREMENT_SOURCE,
  OLD_MAP_SECTOR_0,
  OLD_MAP_SECTOR_1,
  OLD_ROOT_DIRECTORY,
  OLD_SUBDIRECTORY_DA,
  OLD_SUBDIRECTORY_DB,
  expandRuns,
} from './adfsOldMeasurements';

/** The L geometry, which is what the measured disc is. */
const L = { sectorsPerTrack: 16, tracks: 80, sides: 2 };

/** An image with the measured sectors put back where the machine had them. */
function measuredImage(): Uint8Array {
  const image = new Uint8Array(640 * 1024);
  image.set(expandRuns(OLD_MAP_SECTOR_0), 0);
  image.set(expandRuns(OLD_MAP_SECTOR_1), 256);
  for (const [logical, runs] of [
    [OLD_DIRECTORY_SECTORS.root, OLD_ROOT_DIRECTORY],
    [OLD_DIRECTORY_SECTORS.da, OLD_SUBDIRECTORY_DA],
    [OLD_DIRECTORY_SECTORS.db, OLD_SUBDIRECTORY_DB],
  ] as const) {
    const bytes = expandRuns(runs);
    for (let sector = 0; sector < 5; sector += 1) {
      image.set(bytes.subarray(sector * 256, sector * 256 + 256), oldImageSector(logical + sector, L) * 256);
    }
  }
  return image;
}

describe('an ADFS old-map disc, against what the machine said about it', () => {
  const image = measuredImage();

  it('finds the root where every one of these discs keeps it', () => {
    expect(OLD_ROOT_SECTOR).toBe(2);
    const root = parseOldDirectory(readOldSectors(image, OLD_ROOT_SECTOR, 5, L), '$');
    expect(root.name).toBe(OLD_DISC_LISTING.discName);
    expect(root.title).toBe(OLD_DISC_LISTING.discName);
    /* The root is its own parent, which is how a walk knows to stop. */
    expect(root.parentSector).toBe(OLD_ROOT_SECTOR);
  });

  it('lists exactly what the machine listed, in name, size and kind', () => {
    const root = parseOldDirectory(readOldSectors(image, OLD_ROOT_SECTOR, 5, L), '$');
    expect(root.entries.map((entry) => entry.name)).toEqual(OLD_DISC_LISTING.entries.map((entry) => entry.name));
    for (const [index, expected] of OLD_DISC_LISTING.entries.entries()) {
      const entry = root.entries[index]!;
      expect(entry.length, expected.name).toBe(expected.length);
      expect(entry.directory, expected.name).toBe(expected.directory);
      if ('loadAddress' in expected) {
        expect(entry.loadAddress, expected.name).toBe(expected.loadAddress);
        expect(entry.executionAddress, expected.name).toBe(expected.executionAddress);
      }
    }
  });

  it('reads the attributes out of the name, where they live', () => {
    /* This is the thing that cannot be guessed from a hex dump: a file called
     * `alpha` is stored as `\xe1\xecpha`, and a reader that took those bytes as
     * ASCII would render a name nobody typed and drop the attributes. */
    const root = parseOldDirectory(readOldSectors(image, OLD_ROOT_SECTOR, 5, L), '$');
    const alpha = root.entries.find((entry) => entry.name === 'alpha')!;
    expect(alpha.readable).toBe(true);
    expect(alpha.writable).toBe(true);
    expect(alpha.locked).toBe(false);
    expect(alpha.directory).toBe(false);
    const da = root.entries.find((entry) => entry.name === 'da')!;
    expect(da.directory).toBe(true);
    expect(da.filetype).toBe(0xffd);
  });

  it('follows a subdirectory to where it actually is, not where a flat reading puts it', () => {
    /* `db` starts at logical sector 140, which on a double-sided image is file
     * sector 268. A reader without the interleave would find zeroes there and
     * call the disc corrupt. */
    const root = parseOldDirectory(readOldSectors(image, OLD_ROOT_SECTOR, 5, L), '$');
    const db = root.entries.find((entry) => entry.name === 'db')!;
    expect(db.startSector).toBe(OLD_DIRECTORY_SECTORS.db);
    expect(oldImageSector(db.startSector, L)).toBe(268);
    const directory = parseOldDirectory(readOldSectors(image, db.startSector, 5, L), '$.db');
    expect(directory.name).toBe('db');
    expect(directory.parentSector).toBe(OLD_ROOT_SECTOR);
    expect(directory.entries).toEqual([]);
  });

  it('maps a single-sided disc straight through, because there is nothing to interleave', () => {
    const single = { sectorsPerTrack: 16, tracks: 80, sides: 1 };
    for (const logical of [0, 1, 2, 15, 16, 140, 1279]) {
      expect(oldImageSector(logical, single), String(logical)).toBe(logical);
    }
  });

  it('reads the disc name back out of the two map sectors it is split across', () => {
    expect(oldDiscName(image)).toBe(OLD_DISC_LISTING.discName);
  });

  it('refuses a directory that is the wrong size, missing a signature or half written', () => {
    const good = readOldSectors(image, OLD_ROOT_SECTOR, 5, L);
    expect(() => parseOldDirectory(good.subarray(0, 1024), '$')).toThrow(/1280 bytes/);
    const noSignature = Uint8Array.from(good); noSignature[1] = 0x58;
    expect(() => parseOldDirectory(noSignature, '$')).toThrow(/Hugo/);
    const halfWritten = Uint8Array.from(good); halfWritten[OLD_DIRECTORY_BYTES - 6] = (halfWritten[OLD_DIRECTORY_BYTES - 6]! + 1) & 0xff;
    expect(() => parseOldDirectory(halfWritten, '$')).toThrow(/half-written/);
  });

  it('refuses a sector past the end of the disc rather than wrapping onto another', () => {
    /* The mapping shuffles, so sector 2560 of a 2560-sector disc lands on file
     * sector 32 — a real sector holding somebody else's file. A bounds check on
     * the file offset alone lets that through and returns the wrong bytes
     * without complaint, which is how a reader comes to invent a listing. */
    expect(oldImageSector(2559, L)).toBe(2559);
    expect(() => oldImageSector(2560, L)).toThrow(/not on a disc of 2560 sectors/);
    expect(() => readOldSectors(image, 2559, 5, L)).toThrow(/not on a disc of 2560 sectors/);
  });

  it('records the check byte without claiming to have verified it', () => {
    /* The algorithm was not established, and a guess would reject good discs
     * and say they were damaged. What is verified is stated instead: both
     * signatures, the sequence number at each end, and the map's own checksums,
     * which this build already computes. */
    const root = parseOldDirectory(readOldSectors(image, OLD_ROOT_SECTOR, 5, L), '$');
    expect(root.storedCheckByte).toBeGreaterThanOrEqual(0);
    expect(root.storedCheckByte).toBeLessThan(256);
  });

  it('says which discs the measurement covers and which it does not', () => {
    expect(OLD_DISC_MEASUREMENT_SOURCE.notMeasured).toContain('S and M');
    expect(OLD_DISC_MEASUREMENT_SOURCE.firmware).toContain('RISC OS 3.11');
  });
});

describe('the whole disc, through the reader the workbench uses', () => {
  it('lists an L disc the way the machine listed it, subdirectories and all', async () => {
    const { parseAdfsCatalogue } = await import('./adfsCatalogue');
    const catalogue = parseAdfsCatalogue(measuredImage());
    expect(catalogue.format).toBe('ADFS L');
    expect(catalogue.name).toBe(OLD_DISC_LISTING.discName);
    expect(catalogue.warnings).toEqual([]);
    expect(catalogue.entries.map((entry) => entry.name)).toEqual(OLD_DISC_LISTING.entries.map((entry) => entry.name));
    const fa = catalogue.entries.find((entry) => entry.name === 'fa')!;
    expect(fa.length).toBe(32768);
    expect(fa.directory).toBe(false);
    /* The subdirectories are walked, not merely named. That is the part the
     * interleave breaks if it is wrong, and an empty list from a directory that
     * is really elsewhere would look exactly like an empty directory. */
    const da = catalogue.entries.find((entry) => entry.name === 'da')!;
    expect(da.directory).toBe(true);
    expect(da.children).toEqual([]);
  });

  it('refuses an image whose map disagrees with its own length', async () => {
    const { parseAdfsCatalogue } = await import('./adfsCatalogue');
    const image = measuredImage();
    /* The declared size lives inside the checksummed part of the map, so it is
     * changed and the checksum put right again. Otherwise the checksum speaks
     * first and this would be testing that instead. */
    image[0xfd] = 0x09;
    let sum = 0; let carry = 0;
    for (let offset = 0xfe; offset >= 0; offset -= 1) {
      const total = sum + carry + image[offset]!;
      sum = total & 0xff; carry = total > 0xff ? 1 : 0;
    }
    image[0xff] = sum;
    expect(() => parseAdfsCatalogue(image)).toThrow(/says it holds .* and this image is/);
  });

  it('reports a directory loop rather than following it for ever', async () => {
    const { parseAdfsCatalogue } = await import('./adfsCatalogue');
    const image = measuredImage();
    /* Point `db` back at the root. A reader that trusted it would recurse until
     * it ran out of stack, and a damaged disc can say exactly this. */
    const rootAt = oldImageSector(OLD_ROOT_SECTOR, L) * 256;
    for (let index = 0; index < 47; index += 1) {
      const offset = rootAt + 5 + index * 26;
      const name = String.fromCharCode(...image.subarray(offset, offset + 2).map((value) => value & 0x7f));
      if (name === 'db') { image[offset + 0x16] = OLD_ROOT_SECTOR; image[offset + 0x17] = 0; image[offset + 0x18] = 0; }
    }
    const catalogue = parseAdfsCatalogue(image);
    expect(catalogue.warnings.join(' ')).toContain('already listed');
  });
});
