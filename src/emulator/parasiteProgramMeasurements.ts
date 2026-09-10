/*
 * A program built in the workbench, running on the second processor.
 *
 * The whole reason to put a Tube behind a BBC is to run the program somewhere
 * that is not the host: thirty kilobytes with no screen in it, at three or four
 * megahertz rather than two, while the host keeps the display, the keyboard and
 * the filing system. Until this, a program could be loaded into the host and
 * run, or loaded into the parasite by a test plan, and there was no way to
 * build one and have it execute on the other side of the Tube.
 *
 * A pass here has to be something the host could not have produced, or it says
 * nothing at all. So the program writes to &8000. On the parasite that is
 * ordinary RAM holding the language the host transferred; on the host it is a
 * sideways ROM slot, where a write is ignored and a read gives back a ROM byte.
 * The arithmetic is chosen so every value checked is one the program computed
 * rather than one it was given: &10 plus &32 is &42, and &42 appears nowhere in
 * the source.
 *
 * `scripts/measureParasiteProgram.mjs` reproduces all three.
 */

export const PARASITE_PROGRAM_MEASUREMENT_SOURCE =
  'Measured by assembling a program in this build, writing it into the parasite, pointing the parasite at it and reading back what it computed.';

/** Where the program was loaded, inside the range the runtime allows. */
export const MEASURED_PROGRAM_ORIGIN = 0x2000;

export interface ParasiteProgramRun {
  host: string;
  parasite: string;
  /** The banner the parasite's own ROM printed, so the processor names itself. */
  printed: string;
  /** &8000 after the run: on the parasite this is RAM, on the host a ROM slot. */
  computed: number;
  /** A marker in ordinary parasite RAM, so a wrong &8000 cannot pass alone. */
  marker: number;
  /** X, loaded back from &8000 by the program itself. */
  x: number;
}

export const PARASITE_PROGRAM_RUNS: readonly ParasiteProgramRun[] = Object.freeze([
  { host: 'B', parasite: 'Tube65C02', printed: 'Acorn TUBE 6502 64K', computed: 0x42, marker: 0x5a, x: 0x42 },
  { host: 'B', parasite: 'Tube65C102', printed: 'Acorn TUBE 65C102 Co-Processor', computed: 0x42, marker: 0x5a, x: 0x42 },
  { host: 'Master', parasite: 'Tube65C102', printed: 'Acorn TUBE 65C102 Co-Processor', computed: 0x42, marker: 0x5a, x: 0x42 },
]);

/**
 * Why &8000 is the address that settles it.
 *
 * Everything else the program does would be equally true if it had been loaded
 * into the host and run there: the same arithmetic gives the same registers and
 * the same byte in the same place. &8000 is where the two machines differ.
 */
export const PARASITE_PROOF_ADDRESS = 0x8000;

export const PARASITE_PROOF_NOTE =
  'On the host &8000 is a sideways ROM slot, where a write is ignored and a read gives a ROM byte. On the parasite it is ordinary RAM holding the transferred language. A computed &42 read back from there is a result only the second processor could have produced.';
