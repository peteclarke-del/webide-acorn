/*
 * How much sideways RAM each machine in this build actually has.
 *
 * "Sideways RAM" was offered as a capability without saying how much, and how
 * much is exactly what somebody writing a game needs to know. A program
 * written for a 32 KB board must not quietly spread itself over eight banks
 * because the emulator happened to give it eight, and then fail on the machine
 * it was written for.
 *
 * So each machine was asked. A short routine runs with interrupts off and, for
 * each of the sixteen banks, selects the bank, reads &8000, writes the
 * complement, reads it back and puts the original back. A bank whose read-back
 * changed is RAM. `scripts/measureSidewaysRam.mjs` reproduces it.
 *
 * The answers are the pinned engine's, not Acorn's. A Model B had four ROM
 * sockets and a sideways RAM board filled some of them; the engine gives every
 * Model B eight banks of RAM, which is 128 KB and more than any board this
 * product's users are likely to have. That is a real difference between the
 * emulated machine and the target, so it is written down here and named as a
 * limitation rather than left for a game to discover.
 */

/** The ROM select register is four bits wide, so there are sixteen banks. */
export const SIDEWAYS_BANK_COUNT = 16;

/** A sideways bank is 16 KiB. */
export const SIDEWAYS_BANK_BYTES = 16 * 1024;

export const SIDEWAYS_RAM_MEASUREMENT_SOURCE =
  'Measured by running a routine on each machine that selects every one of the sixteen banks in turn, writes the complement of what is at &8000, reads it back and restores it.';

export interface SidewaysRamMeasurement {
  /** The engine model asked, and what it called itself. */
  model: string;
  banner: string;
  /** The banks that answered as RAM. */
  writableBanks: readonly number[];
}

export const SIDEWAYS_RAM_MEASUREMENTS: readonly SidewaysRamMeasurement[] = Object.freeze([
  { model: 'B', banner: 'BBC Computer 32K', writableBanks: Object.freeze([0, 1, 2, 3, 4, 5, 6, 7]) },
  { model: 'B1770', banner: 'BBC Computer 32K', writableBanks: Object.freeze([0, 1, 2, 3, 4, 5, 6, 7]) },
  { model: 'Master', banner: 'Acorn MOS', writableBanks: Object.freeze([4, 5, 6, 7]) },
]);

/** How many kilobytes of sideways RAM a measurement found. */
export function sidewaysRamKilobytes(measurement: SidewaysRamMeasurement): number {
  return (measurement.writableBanks.length * SIDEWAYS_BANK_BYTES) / 1024;
}

/**
 * What the game target asked for, against what the emulated machine gives it.
 *
 * Named rather than left as a difference somebody notices later: a 32 KB board
 * is two banks, and this machine has eight. Code that fits in two will run on
 * both; code that uses more will run here and nowhere else.
 */
export const SIDEWAYS_RAM_LIMITATION =
  'The pinned engine gives every Model B eight banks of sideways RAM, which is 128 KB. A real board is usually 16, 32 or 64 KB, so a program that uses more banks than the board it is written for will run here and not there. The amount fitted is not selectable in this build.';
