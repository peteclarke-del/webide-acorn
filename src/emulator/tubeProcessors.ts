/*
 * Every second processor a Tube can carry, and which of them run here.
 *
 * A Tube interface takes whatever is plugged into it. Acorn sold four
 * processors for one, and a PiTube Direct offers twenty-six emulations of them
 * and others, selected on the host with `*FX 151,230,n`. So the question is not
 * whether this build has a Tube. It is which processor is on the other side of
 * it.
 *
 * The list below is PiTube Direct's own, from its wiki, with its own selection
 * numbers kept so a program that switches processors on real hardware can be
 * written against the same numbers here. Two of them run in this build, because
 * the pinned jsbeeb publishes two parasite models and no more; the rest are
 * listed because the hardware has them, and each says what it would take. That
 * is the same distinction the compatibility matrix draws everywhere else:
 * planned means not fitted, and it is written down so nobody has to discover it.
 *
 * Nothing here is claimed from memory. The two that run were booted behind both
 * a Model B and a Master and printed their own ROM banners; see
 * `tubeParasiteMeasurements.ts`. The parasite ROMs named for the others were
 * identified by reading the images rather than by their filenames.
 */

/** Where the list comes from, so a reader can check it rather than trust it. */
export const PITUBE_DIRECT_CITATION = {
  title: 'PiTubeDirect wiki',
  url: 'https://github.com/hoglet67/PiTubeDirect/wiki',
  section: 'Co-processor emulations, selected with *FX 151,230,n',
} as const;

/** How a processor is selected on real hardware. */
export const TUBE_SELECT_OSBYTE = '*FX 151,230,n';

export type TubeProcessorState = 'runs' | 'planned';

export interface TubeProcessorEntry {
  /** PiTube Direct's own selection number for this emulation. */
  select: number;
  /** The capability a machine profile offers this processor under. */
  capabilityId: string;
  label: string;
  /** The processor family, in the words the hardware uses. */
  cpu: string;
  state: TubeProcessorState;
  /**
   * The parasite ROM, where this build knows which one it is. A ROM present in
   * a firmware vault is not the same as a processor that can run it, and the
   * two are separate on purpose.
   */
  romPath?: string;
  /** What runs it here, or what it would take to. */
  note: string;
}

/*
 * The processors worth listing, which is Acorn's own four plus the two
 * 6502-family emulations this build runs and the one Acorn shipped in the
 * Master 512. PiTube Direct offers more (the OPC series, the F100-L, a PDP-11,
 * a 6809, two 65C816 variants); those are hobbyist targets rather than machines
 * anybody wrote Acorn software for, and adding them to this table would make it
 * longer without making it more useful. The selection numbers are kept sparse
 * rather than renumbered, so the gaps are visible.
 */
export const TUBE_PROCESSORS: readonly TubeProcessorEntry[] = Object.freeze([
  {
    select: 1,
    capabilityId: 'tube',
    label: '6502 second processor',
    cpu: '65C02 at 3 MHz',
    state: 'runs',
    romPath: 'tube/6502Tube.rom',
    note: 'What Acorn sold for a BBC Model B. The pinned engine models it, and the parasite prints Acorn TUBE 6502 64K.',
  },
  {
    select: 3,
    capabilityId: 'tube-turbo',
    label: '65C102 Turbo second processor',
    cpu: '65C102 at 4 MHz',
    state: 'runs',
    romPath: 'tube/65C102Tube.rom',
    note: 'What Acorn sold for a Master, and what a PiTube Direct usually runs. The pinned engine models it, and the parasite prints Acorn TUBE 65C102 Co-Processor.',
  },
  {
    select: 5,
    capabilityId: 'tube-z80',
    label: 'Z80 second processor',
    cpu: 'Z80',
    state: 'planned',
    romPath: 'tube/Z80_120.rom',
    note: 'Acorn sold this one for CP/M. The parasite ROM is identified and reads Acorn TUBE Z80 64K 1.20, and the pinned engine has no Z80 at all, so running it needs a Z80 core this build does not have.',
  },
  {
    select: 8,
    capabilityId: 'tube-80286',
    label: '80286 second processor',
    cpu: 'Intel 80286',
    state: 'planned',
    note: 'The closest thing PiTube Direct offers to the 80186 Acorn put in the Master 512, for DOS Plus. No x86 core is present here, and no parasite ROM for it is identified.',
  },
  {
    select: 12,
    capabilityId: 'tube-arm2',
    label: 'ARM2 second processor',
    cpu: 'ARM2',
    state: 'planned',
    romPath: 'tube/ARMeval_100.rom',
    note: 'The Acorn ARM Evaluation System, the machine the Archimedes came out of. The parasite ROM is identified and is the Brazil supervisor of August 1986. This build has an ARM2 elsewhere, inside the pinned Arculator, but that is a whole Archimedes rather than a core that can be put behind a Tube.',
  },
  {
    select: 13,
    capabilityId: 'tube-32016',
    label: '32016 second processor',
    cpu: 'National Semiconductor 32016',
    state: 'planned',
    note: 'Acorn sold this one as the Cambridge Co-processor, running Panos. No 32016 core is present here, and no parasite ROM for it is identified.',
  },
]);

/** The ones a session can actually fit today. */
export function runnableTubeProcessors(): readonly TubeProcessorEntry[] {
  return TUBE_PROCESSORS.filter((entry) => entry.state === 'runs');
}

/** The ones the hardware offers and this build does not run. */
export function plannedTubeProcessors(): readonly TubeProcessorEntry[] {
  return TUBE_PROCESSORS.filter((entry) => entry.state === 'planned');
}

/*
 * The table, rendered.
 *
 * Generated rather than written, so a processor cannot be added to the
 * catalogue and left out of the document, or claimed in the document and absent
 * from the catalogue.
 */
export function renderTubeProcessorMatrix(): string {
  const lines: string[] = [];
  lines.push('# Second processors behind the Tube');
  lines.push('');
  lines.push('<!-- Generated from src/emulator/tubeProcessors.ts. Edit the catalogue, not this file. -->');
  lines.push('');
  lines.push(`A Tube interface takes whatever is plugged into it. Acorn sold four processors for one, and a PiTube Direct offers twenty-six emulations, selected on the host with \`${TUBE_SELECT_OSBYTE}\`. So the question is never whether a machine has a Tube; it is which processor is on the other side.`);
  lines.push('');
  lines.push(`The selection numbers below are PiTube Direct's own, kept so a program that switches processors on real hardware can be written against the same numbers here. See [${PITUBE_DIRECT_CITATION.title}](${PITUBE_DIRECT_CITATION.url}).`);
  lines.push('');
  lines.push('| n | Processor | CPU | Runs here | Parasite ROM |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const entry of TUBE_PROCESSORS) {
    lines.push(`| ${entry.select} | ${entry.label} | ${entry.cpu} | ${entry.state === 'runs' ? 'yes' : 'no'} | ${entry.romPath ? `\`${entry.romPath}\`` : 'not identified' } |`);
  }
  lines.push('');
  lines.push('## What each one is, and what it would take');
  lines.push('');
  for (const entry of TUBE_PROCESSORS) lines.push(`- **${entry.label}** (${entry.cpu}): ${entry.note}`);
  lines.push('');
  lines.push('## Why only two');
  lines.push('');
  lines.push('The pinned jsbeeb publishes two parasite models, both 6502 family, and no others. A Tube parasite is a whole processor with its own memory, its own boot ROM and its own timing, so fitting a Z80 or an ARM2 behind the Tube means bringing a core for it, not configuring one that is already there.');
  lines.push('');
  lines.push('Two of the absent ones already have their parasite ROM in the firmware vault, identified by reading the image rather than trusting its filename: the Z80 ROM reads `Acorn TUBE Z80 64K 1.20` and the ARM one is the Brazil supervisor of August 1986. Having the ROM is not having the processor, and the table says so rather than implying otherwise.');
  lines.push('');
  lines.push('## Choosing one in this build');
  lines.push('');
  lines.push('Enable the Tube capability for the machine, which fits the processor Acorn sold with it: a 6502 for a BBC B or B+, a 65C102 for a Master. Enable the 65C102 Turbo capability alongside it to put a 65C102 behind the Tube of a BBC B or B+ instead, which is what a PiTube Direct does. A Model B also needs the Tube host code in a sideways bank, because OS 1.20 finds the Tube and stops there; Acorn shipped that code in DNFS.');
  lines.push('');
  return lines.join('\n');
}
