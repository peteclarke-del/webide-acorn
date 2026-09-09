/*
 * What each BBC-family machine said when it was booted with a Tube fitted.
 *
 * This build carried a note for a long time saying the Tube did not complete
 * its boot on a BBC-family host, only on the Master, and that the fault lay
 * somewhere in the pinned core's handshake. That was wrong, and the trace below
 * is what settles it.
 *
 * A Model B writes the ULA control register once, reads it back and stops. That
 * is OS 1.20 finding the Tube and going no further: the language transfer is
 * not in OS 1.20, and on real hardware it is in a sideways ROM. Acorn shipped
 * that code in DNFS. Put DNFS in a bank and the same machine goes on to enable
 * the parasite interrupts, read the parasite's banner out of register 1 and
 * introduce itself as a Tube. A B+ and a Master need nothing extra, because
 * their own operating systems carry the code a Model B has to be given.
 *
 * `scripts/measureBbcTube.mjs` reproduces all of it against a firmware vault.
 */

export const BBC_TUBE_MEASUREMENT_SOURCE =
  'Measured by booting each BBC-family machine with a Tube parasite fitted, logging every access to the Tube ULA at &FEE0 to &FEE7 and reading the banner the machine printed.';

/** The sideways ROM that carries the 6502 Tube host code for a Model B. */
export const BBC_TUBE_HOST_ROM = 'b/dnfs120.rom';

export interface TubeBootMeasurement {
  machine: string;
  banks: string;
  /** The first line of the banner, which is where a machine says it has a Tube. */
  printed: string;
  /** The first accesses to the ULA, in the machine's own hex. */
  ulaAccesses: string[];
  establishes: string;
}

export const BBC_TUBE_BOOTS: readonly TubeBootMeasurement[] = [
  {
    machine: 'Acorn BBC Model B',
    banks: 'nothing extra',
    printed: 'BBC Computer 32K',
    ulaAccesses: ['write &FEE0 = &81 at &DB3D', 'read &FEE0 = &C1 at &DB40'],
    establishes:
      'OS 1.20 sets the enable-host-interrupt flag, reads it back to confirm the ULA latched it, and stops. Two accesses is the whole of the Tube code in that operating system.',
  },
  {
    machine: 'Acorn BBC Model B',
    banks: 'DNFS 1.20 in a sideways bank',
    printed: 'Acorn TUBE 6502 64K',
    ulaAccesses: [
      'write &FEE0 = &81 at &DB3D',
      'read &FEE0 = &C1 at &DB40',
      'write &FEE0 = &8E at &815D',
      'read &FEE0 = &CF at &8137',
      'read &FEE1 = &A at &813C',
    ],
    establishes:
      'The same two accesses from the operating system, and then a sideways ROM at &815D enabling the parasite interrupts and reading the parasite banner out of register 1. The Tube host code is that ROM, not the machine.',
  },
  {
    machine: 'Acorn BBC B+',
    banks: 'nothing extra',
    printed: 'Acorn TUBE 6502 64K',
    ulaAccesses: [
      'write &FEE0 = &1 at &DABF',
      'read &FEE0 = &C0 at &DAC2',
      'write &FEE0 = &81 at &DAC9',
      'read &FEE0 = &C1 at &DACC',
      'write &FEE0 = &8E at &AEFB',
      'read &FEE0 = &CF at &AED5',
      'read &FEE1 = &A at &AEDA',
    ],
    establishes:
      'MOS 2.00 carries the host code itself, at &AEFB, so a B+ needs nothing in a bank. This build was withholding the Tube from the B+ on the strength of the note that has now been disproved.',
  },
  {
    machine: 'BBC Master Series',
    banks: 'nothing extra',
    printed: 'Acorn TUBE 65C102 Co-Processor',
    ulaAccesses: [
      'write &FEE0 = &1 at &E37A',
      'read &FEE0 = &C0 at &E37D',
      'write &FEE0 = &81 at &E384',
      'read &FEE0 = &C1 at &E387',
      'write &FEE0 = &8E at &9DA5',
      'read &FEE0 = &CF at &9D7F',
      'read &FEE1 = &A at &9D84',
    ],
    establishes:
      'The Master does the same thing at its own addresses, with a 65C102 parasite rather than a 6502. It was working before any of this, which is what made the Model B look like a core fault.',
  },
] as const;

/**
 * What the three control-register writes mean, since the trace is unreadable
 * without them. Register 1's status carries the ULA control flags in its low
 * six bits, and a write with bit 7 set turns the named flags on rather than off.
 */
export const TUBE_CONTROL_WRITES: Readonly<Record<string, string>> = Object.freeze({
  '&1': 'clear the enable-host-interrupt-from-register-4 flag',
  '&81': 'set the enable-host-interrupt-from-register-4 flag',
  '&8E': 'set the parasite interrupt from registers 1 and 4, and the parasite non-maskable interrupt from register 3',
});
