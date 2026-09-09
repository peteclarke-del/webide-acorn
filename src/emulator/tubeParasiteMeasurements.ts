/*
 * Which second processor ran behind which host, and what it said.
 *
 * The engine picks a parasite by host, because that is what Acorn sold for
 * each. This build offers the choice instead, and the reason it can is that
 * neither parasite model is tied to a host: both were booted behind both
 * machines and both introduced themselves.
 *
 * The parasite is the one thing here that cannot be mistaken for something
 * else. Its ROM prints its own name, and the two ROMs print different names, so
 * whichever string reaches the screen is which ROM is running. PAGE and HIMEM
 * come from the parasite once the language has crossed the Tube, so they say
 * the transfer really happened rather than that the ULA answered.
 *
 * `scripts/measureTubeParasite.mjs` reproduces all four.
 */

export const TUBE_PARASITE_MEASUREMENT_SOURCE =
  'Measured by fitting each parasite behind each host, reading the banner its own ROM printed and asking BASIC for PAGE and HIMEM on the other side of the Tube.';

export interface TubeParasiteBoot {
  host: string;
  /** The engine's name for the parasite model. */
  parasite: string;
  printed: string;
  /** Where a program starts and ends in the parasite, in the machine's own hex. */
  page: string;
  himem: string;
}

export const TUBE_PARASITE_BOOTS: readonly TubeParasiteBoot[] = Object.freeze([
  { host: 'B', parasite: 'Tube65C02', printed: 'Acorn TUBE 6502 64K', page: '800', himem: '8000' },
  { host: 'B', parasite: 'Tube65C102', printed: 'Acorn TUBE 65C102 Co-Processor', page: '800', himem: '8000' },
  { host: 'Master', parasite: 'Tube65C02', printed: 'Acorn TUBE 6502 64K', page: '800', himem: '8000' },
  { host: 'Master', parasite: 'Tube65C102', printed: 'Acorn TUBE 65C102 Co-Processor', page: '800', himem: '8000' },
]);

/**
 * What a program gets on the other side of the Tube.
 *
 * The same on every one of the four, and it is the reason to fit a second
 * processor at all: thirty kilobytes with no screen in it, at three or four
 * megahertz rather than two, while the host keeps the display, the keyboard and
 * the filing system.
 */
export const TUBE_PARASITE_PROGRAM_BYTES = 0x8000 - 0x0800;
