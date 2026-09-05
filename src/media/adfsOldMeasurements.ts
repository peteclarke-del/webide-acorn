/*
 * Sectors from a real ADFS L disc, and how they came to be here.
 *
 * RISC OS 3.11 was booted on this build's own pinned A310 core, told to
 * `*Format 0 L flush`, given two subdirectories and two files, told to `*Ex` its
 * root, and then told to `*Dismount 0` so that everything it was holding was on
 * the disc rather than in its cache. The image was read out of the emulator and
 * these are the sectors that carry its catalogue.
 *
 * They are kept because a measurement nobody can repeat is a claim, and because
 * a disc image may not enter this repository — these are five structures, not a
 * disc. Each is run-length encoded, since a freshly formatted disc is mostly
 * zeroes, and the test rebuilds an image around them.
 *
 * The machine's own listing is kept beside them. That is the thing the reader is
 * actually held to: not that it parses without complaint, but that it says what
 * the machine said.
 */

/** Runs of `[value, count]`, because these sectors are mostly one byte. */
export type ByteRuns = ReadonlyArray<readonly [number, number]>;

export function expandRuns(runs: ByteRuns): Uint8Array {
  const total = runs.reduce((sum, [, count]) => sum + count, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const [value, count] of runs) { out.fill(value, at, at + count); at += count; }
  return out;
}

/** The two sectors of the old free-space map, at logical sectors 0 and 1. */
export const OLD_MAP_SECTOR_0: ByteRuns = [[0x92, 1], [0x00, 246], [0x66, 1], [0x75, 1], [0x68, 1], [0x00, 3], [0x0a, 1], [0x00, 1], [0xe0, 1]];
export const OLD_MAP_SECTOR_1: ByteRuns = [[0x6e, 1], [0x09, 1], [0x00, 244], [0x6c, 1], [0x73, 1], [0x00, 3], [0x40, 1], [0x1a, 1], [0x00, 1], [0x03, 1], [0xb4, 1]];

/** The root directory, at logical sector 2, and the two below it. */
export const OLD_ROOT_DIRECTORY: ByteRuns = [[0x04, 1], [0x48, 1], [0x75, 1], [0x67, 1], [0x6f, 1], [0xe1, 1], [0xec, 1], [0x70, 1], [0x68, 1], [0x61, 1], [0x0d, 1], [0x00, 5], [0x80, 1], [0x00, 3], [0x80, 1], [0x00, 3], [0x01, 1], [0x00, 2], [0x91, 1], [0x00, 2], [0x04, 1], [0x64, 1], [0x61, 1], [0x0d, 1], [0x80, 1], [0x00, 6], [0x44, 1], [0xfd, 1], [0xff, 2], [0x64, 1], [0x78, 1], [0x76, 1], [0x16, 1], [0x00, 1], [0x05, 1], [0x00, 2], [0x07, 1], [0x00, 2], [0x01, 1], [0x64, 1], [0x62, 1], [0x0d, 1], [0x80, 1], [0x00, 6], [0x44, 1], [0xfd, 1], [0xff, 2], [0x5a, 1], [0x83, 1], [0x76, 1], [0x16, 1], [0x00, 1], [0x05, 1], [0x00, 2], [0x8c, 1], [0x00, 2], [0x03, 1], [0xe6, 1], [0xe1, 1], [0x0d, 1], [0x00, 8], [0x80, 1], [0x00, 3], [0x80, 1], [0x00, 3], [0x80, 1], [0x00, 2], [0x0c, 1], [0x00, 2], [0x02, 1], [0x00, 1119], [0x66, 1], [0x6c, 1], [0x75, 1], [0x73, 1], [0x68, 1], [0x0d, 1], [0x00, 4], [0x02, 1], [0x00, 2], [0x66, 1], [0x6c, 1], [0x75, 1], [0x73, 1], [0x68, 1], [0x0d, 1], [0x00, 27], [0x04, 1], [0x48, 1], [0x75, 1], [0x67, 1], [0x6f, 1], [0x0f, 1]];
export const OLD_SUBDIRECTORY_DA: ByteRuns = [[0x00, 1], [0x48, 1], [0x75, 1], [0x67, 1], [0x6f, 1], [0x00, 1223], [0x64, 1], [0x61, 1], [0x0d, 1], [0x00, 7], [0x02, 1], [0x00, 2], [0x64, 1], [0x61, 1], [0x0d, 1], [0x00, 31], [0x48, 1], [0x75, 1], [0x67, 1], [0x6f, 1], [0x9b, 1]];
export const OLD_SUBDIRECTORY_DB: ByteRuns = [[0x00, 1], [0x48, 1], [0x75, 1], [0x67, 1], [0x6f, 1], [0x00, 1223], [0x64, 1], [0x62, 1], [0x0d, 1], [0x00, 7], [0x02, 1], [0x00, 2], [0x64, 1], [0x62, 1], [0x0d, 1], [0x00, 31], [0x48, 1], [0x75, 1], [0x67, 1], [0x6f, 1], [0x9e, 1]];

/** Where each of those directories starts, in logical sectors. */
export const OLD_DIRECTORY_SECTORS = Object.freeze({ root: 2, da: 7, db: 140 });

/**
 * What the machine printed for the root, which is what the reader must say.
 *
 * Transcribed from the `*Ex` output the machine spooled, with its own spelling
 * of the attributes and its own rounding of the sizes left alone.
 */
export const OLD_DISC_LISTING = Object.freeze({
  discName: 'flush',
  totalSectors: 2560,
  entries: Object.freeze([
    Object.freeze({ name: 'alpha', attributes: 'WR/', loadAddress: 0x00008000, executionAddress: 0x00008000, length: 256, directory: false }),
    Object.freeze({ name: 'da', attributes: 'D/', length: 1280, directory: true }),
    Object.freeze({ name: 'db', attributes: 'D/', length: 1280, directory: true }),
    Object.freeze({ name: 'fa', attributes: 'WR/', loadAddress: 0x00008000, executionAddress: 0x00008000, length: 32768, directory: false }),
  ]),
});

/** Where the measurement was taken, so the claim can be traced to a machine. */
export const OLD_DISC_MEASUREMENT_SOURCE = Object.freeze({
  machine: 'Acorn Archimedes A310, 4 MiB, on the pinned Arculator WebAssembly core this build ships',
  firmware: 'RISC OS 3.11 (29 Sep 1992)',
  method: 'Formatted with *Format 0 L, written to, listed with *Ex, and dismounted before the image was read.',
  notMeasured: 'S and M discs. RISC OS 3.11 offers F, E, D and L and no others, which its own *Help Format says, so neither could be produced here.',
});
