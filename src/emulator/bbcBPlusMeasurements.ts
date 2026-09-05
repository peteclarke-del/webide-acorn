/*
 * What a BBC Model B+ said when this build ran one.
 *
 * The B+ here is not the engine's — jsbeeb publishes none — so every claim
 * about it is a claim about code written for this product, and the way to make
 * such a claim worth anything is to let the machine answer.
 *
 * Three questions were put to it, chosen because each has a wrong answer that
 * a Model B or a Master would give:
 *
 *  - What are you? A Model B says "BBC Computer 32K". This says "Acorn OS 64K",
 *    which is what a B+ 64K says and what nothing else does.
 *  - What does a shadow mode cost? On a Model B the twenty-kilobyte screen
 *    takes HIMEM down to &3000. On a B+ it stays at &8000, because the screen
 *    is not in the program's memory at all. That is the whole reason the
 *    machine exists.
 *  - How much RAM is at &8000 when it is paged in? A Master has four kilobytes
 *    there; a B+ has twelve. Writing to the top of the twelve and reading it
 *    back is the difference, and it is why the paging here covers &8000-&AFFF
 *    rather than the Master's &8000-&8FFF.
 *
 * `scripts/measureBbcBPlus.mjs` reproduces all of it against a firmware vault.
 */

export const BBC_BPLUS_MEASUREMENT_SOURCE =
  'Measured by booting the B+ this build adds on top of jsbeeb\'s Model B, with a real OS 2.00, BASIC II and 1770 DFS, ' +
  'and asking the machine at its own keyboard.';

/** What the machine printed when it started. */
export const BBC_BPLUS_BANNER = 'Acorn OS 64K\n\nAcorn 1770 DFS\n\nBASIC';

export interface ScreenModeMeasurement {
  /** What was typed. */
  typed: string;
  /** Where BASIC said its program starts and ends, in the machine's own hex. */
  page: string;
  himem: string;
  /** Why this one is in the set. */
  establishes: string;
}

export const BBC_BPLUS_SCREEN_MODES: readonly ScreenModeMeasurement[] = Object.freeze([
  {
    typed: 'MODE 7:PRINT ~PAGE,~HIMEM',
    page: '1900',
    himem: '7C00',
    establishes: 'An ordinary mode behaves like a Model B: the screen comes out of the top of main memory.',
  },
  {
    typed: 'MODE 135:PRINT ~PAGE,~HIMEM',
    page: '1900',
    himem: '8000',
    establishes: 'The same screen asked for in shadow costs the program nothing: HIMEM is the top of RAM.',
  },
  {
    typed: 'MODE 128:PRINT ~PAGE,~HIMEM',
    page: '1900',
    himem: '8000',
    establishes: 'And so does the twenty-kilobyte screen, which on a Model B would take HIMEM down to &3000. This is the machine being a B+ rather than a Model B.',
  },
]);

/**
 * The paged RAM at &8000, written and read back through the machine.
 *
 * A routine set ROMSEL bit 7, wrote to both ends of the twelve kilobytes, read
 * them back, then restored ROMSEL and read &8000 again.
 */
export const BBC_BPLUS_PAGED_RAM = Object.freeze({
  wroteAt8000: 0x5a,
  readBackAt8000: 0x5a,
  /* The top of the twelve kilobytes. A Master's four would have given the ROM
   * byte here, which is exactly the mistake this is guarding. */
  wroteAtAFFF: 0xa5,
  readBackAtAFFF: 0xa5,
  /* With ROMSEL restored, &8000 is the language ROM again — so the RAM is an
   * overlay the machine can lift, not a permanent change to memory. */
  romByteAt8000AfterRestoring: 0xc9,
});

/**
 * What the operating system reports when sideways RAM is fitted, and why the
 * B+ 128 is not offered.
 *
 * OS 2.00 counts sideways RAM in banks 0 and 1 and adds a flat thirty-two
 * kilobytes for it, whatever else is fitted: banks 0-1, 0-3 and 0-7 all give
 * the same answer, and banks 4-7 give none at all. So nothing that can be
 * configured here makes this machine introduce itself as a B+ 128 would. Rather
 * than ship a machine whose own operating system reports a size Acorn never
 * sold, the 128 is described and not offered.
 */
export const BBC_BPLUS_SIDEWAYS_RAM_BANNERS: readonly { banks: readonly number[]; banner: string }[] = Object.freeze([
  { banks: Object.freeze([]), banner: 'Acorn OS 64K' },
  { banks: Object.freeze([0, 1]), banner: 'Acorn OS 96K' },
  { banks: Object.freeze([0, 1, 2, 3]), banner: 'Acorn OS 96K' },
  { banks: Object.freeze([0, 1, 2, 3, 4, 5, 6, 7]), banner: 'Acorn OS 96K' },
  { banks: Object.freeze([4, 5, 6, 7]), banner: 'Acorn OS 64K' },
]);
