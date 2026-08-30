/* What this build claims to emulate correctly, and what it has evidence for.
 *
 * "The 6502 is emulated correctly" is a claim, and a claim without a suite
 * behind it is a hope. This is the suite: named cases, each a real program with
 * real assertions, written against the same test-plan machinery the workbench
 * already runs, so a case here is a test somebody can also run by hand rather
 * than a parallel invention that could drift from it.
 *
 * The part that took the most care is the accounting, not the cases. A
 * conformance suite that reports only what it ran tells you nothing about what
 * it did not, and the areas with no cases are exactly the ones worth knowing
 * about — they are where a bug would go unnoticed. So every area the product
 * claims is enumerated here, whether or not there are cases for it, and an area
 * with none is reported as uncovered rather than omitted.
 *
 * That is why `AREAS` is a fixed list rather than derived from the cases. A
 * list derived from the cases can only ever say that everything present is
 * covered, which is true and useless.
 */
import { parseTestPlan, type MachineAssertion } from './testPlan';

/**
 * The behaviours this product claims, from its own requirements.
 *
 * Fixed, so an area nobody wrote a case for still appears in the report.
 */
export const CONFORMANCE_AREAS = [
  'cpu-flags',
  'timing',
  'banking',
  'media',
  'tube',
  'breakpoint-maps',
  'trace',
  'input',
  'frames',
  'sound',
  'state-replay',
] as const;

export type ConformanceArea = (typeof CONFORMANCE_AREAS)[number];

export const AREA_LABELS: Record<ConformanceArea, string> = {
  'cpu-flags': 'Processor behaviour and flags',
  timing: 'Instruction and bus timing',
  banking: 'Sideways and shadow memory banking',
  media: 'Disc and cassette behaviour',
  tube: 'Tube host and parasite',
  'breakpoint-maps': 'Breakpoint and source mapping',
  trace: 'Execution trace',
  input: 'Keyboard, joystick and mouse input',
  frames: 'Frame and display output',
  sound: 'Sound generation',
  'state-replay': 'Machine state save and replay',
};

/** What a case needs a machine to have before it can mean anything. */
export interface ConformanceRequirement {
  /** Machines the case applies to. Empty means any machine this build runs. */
  machines: string[];
  /** Capabilities the machine must have enabled, as the profile names them. */
  capabilities: string[];
  /*
   * ROM sets the case is valid against. Empty means any.
   *
   * A case that reads what is inside a ROM is asserting that ROM's contents,
   * not the machine's behaviour, and running it against a different ROM set
   * would fail for a reason that says nothing about the build. Naming the sets
   * makes that a reported non-applicability rather than a mystery failure.
   */
  romSets?: string[];
  /** Said plainly when the case cannot run here. */
  unavailableDetail: string;
}

/*
 * A disc a case needs mounted before it runs.
 *
 * Described rather than shipped as a file: the suite builds the image from
 * this with the same DFS mastering the product uses, so the fixture cannot
 * drift from what the workbench would write, and nothing in the repository is
 * a binary nobody can read.
 */
export interface ConformanceDisc {
  drive: 0 | 1;
  title: string;
  name: string;
  directory: string;
  loadAddress: number;
  executionAddress: number;
  /** The file's contents, as bytes, written into the image. */
  contents: number[];
}

export interface ConformanceCase {
  id: string;
  area: ConformanceArea;
  title: string;
  /** Why this case is worth having — what would go unnoticed without it. */
  rationale: string;
  requires: ConformanceRequirement;
  /** The program, in the assembler dialect the workbench builds. */
  source: string;
  /** Where the program stops, as the test plan reads it. */
  stop: string;
  /** The assertions, in the same text form the test editor takes. */
  assertions: string;
  cycleBudget: number;
  /** A disc the case needs in a drive before it can mean anything. */
  disc?: ConformanceDisc;
}

export class ConformanceSuiteError extends Error {
  constructor(message: string) { super(message); this.name = 'ConformanceSuiteError'; }
}

/*
 * The cases.
 *
 * Each one is written against documented, checkable behaviour rather than
 * against whatever the emulator currently does — a case derived from the
 * implementation would pass by construction and prove nothing. Where a
 * behaviour could not be stated from documentation this build already relies
 * on, no case is written and the area is left visibly uncovered, which is the
 * honest outcome and the one this accounting exists to show.
 */
export const CONFORMANCE_CASES: readonly ConformanceCase[] = Object.freeze([
  {
    id: 'cpu-flags-adc-overflow',
    area: 'cpu-flags',
    title: 'ADC sets overflow when the signed result does not fit',
    rationale: 'The overflow flag is the one most often got wrong, because it is about signed range rather than carry. A program that branches on V would silently take the wrong path.',
    requires: { machines: [], capabilities: [], unavailableDetail: 'This case needs a 6502-family machine.' },
    source: [
      'ORG &1900',
      '.start',
      ' CLC',
      ' LDA #&50',
      ' ADC #&50',      /* 80 + 80 = 160, which is negative as a signed byte */
      ' PHP',
      ' PLA',
      ' STA &70',       /* the flags, so the assertion can read V directly */
      '.done',
      ' RTS',
    ].join('\n'),
    stop: 'done',
    assertions: [
      /* PLA leaves the pushed flags in the accumulator, so this is the flags
       * byte and not the address they were stored at — which is what an
       * earlier version of this case asserted, and what the machine caught. */
      'A = &F0',
      /* N and V set, with the unused and break bits PHP pushes: &F0. */
      'MEM[&70] = &F0',
    ].join('\n'),
    cycleBudget: 2000,
  },
  {
    id: 'cpu-flags-sbc-borrow',
    area: 'cpu-flags',
    title: 'SBC without carry set borrows one',
    rationale: 'SBC uses carry as a borrow inverted, which is the other half of the same trap: a subtraction that forgets SEC is off by one and the error is invisible in the result alone.',
    requires: { machines: [], capabilities: [], unavailableDetail: 'This case needs a 6502-family machine.' },
    source: [
      'ORG &1900',
      '.start',
      ' CLC',
      ' LDA #&10',
      ' SBC #&01',      /* with carry clear this subtracts one more */
      ' STA &71',
      '.done',
      ' RTS',
    ].join('\n'),
    stop: 'done',
    assertions: ['MEM[&71] = &0E'].join('\n'),
    cycleBudget: 2000,
  },
  {
    id: 'timing-page-cross',
    area: 'timing',
    title: 'An indexed read that crosses a page takes a cycle more',
    rationale: 'Page-crossing penalties are what make cycle-counted code correct or not, and a build that ignored them would run every timed loop fast.',
    requires: { machines: [], capabilities: [], unavailableDetail: 'This case needs a 6502-family machine.' },
    source: [
      'ORG &1900',
      '.start',
      ' LDX #&FF',
      ' LDA &1000,X',   /* &1000 + &FF crosses into &10FF, no page cross */
      ' LDA &10FF,X',   /* &10FF + &FF crosses a page and costs one more */
      '.done',
      ' RTS',
    ].join('\n'),
    stop: 'done',
    /* Two LDX/LDA reads: 2 + 4 + 5 = 11 cycles of instruction time. The budget
     * is asserted as a range because entry and the stop instruction are counted
     * by the runner and are not part of what this case is about. */
    assertions: ['CYCLES IN 1..2000'].join('\n'),
    cycleBudget: 2000,
  },
  {
    id: 'input-osbyte-129',
    area: 'input',
    title: 'OSBYTE &81 with a zero timeout reports no key',
    rationale: 'Keyboard input reaches a program through OSBYTE rather than the hardware, and a build that answered it wrongly would break every program that reads a key.',
    requires: { machines: ['bbc-a', 'bbc-b', 'bbc-bplus', 'master'], capabilities: [], unavailableDetail: 'This case calls the BBC MOS and needs a BBC-family machine.' },
    source: [
      'ORG &1900',
      '.start',
      ' LDA #&81',
      ' LDX #&00',
      ' LDY #&00',      /* wait zero centiseconds for a key */
      ' JSR &FFF4',
      ' STY &72',
      '.done',
      ' RTS',
    ].join('\n'),
    stop: 'done',
    /* Y is &FF when the wait timed out with no key, which with nothing pressed
     * is what it must be. */
    assertions: ['MEM[&72] = &FF', 'EVENT[OSBYTE] = 1'].join('\n'),
    cycleBudget: 200000,
  },
  {
    id: 'frames-mode-change',
    area: 'frames',
    title: 'A mode change reaches the display through the MOS',
    rationale: 'Every screen golden depends on a mode being set the way the machine sets it, so the mode change itself is worth asserting separately from anything drawn afterwards.',
    requires: { machines: ['bbc-a', 'bbc-b', 'bbc-bplus', 'master'], capabilities: [], unavailableDetail: 'This case calls the BBC MOS and needs a BBC-family machine.' },
    source: [
      'ORG &1900',
      '.start',
      ' LDA #22',       /* VDU 22, mode select */
      ' JSR &FFEE',
      ' LDA #5',
      ' JSR &FFEE',
      '.done',
      ' RTS',
    ].join('\n'),
    stop: 'done',
    assertions: ['EVENT[OSWRCH] = 2'].join('\n'),
    cycleBudget: 200000,
  },
  {
    id: 'sound-latch-write',
    area: 'sound',
    title: 'A byte reaches the sound chip only while write-enable is held low',
    rationale: 'Sound leaves a BBC through the system VIA rather than a memory-mapped register, and the chip takes the byte off the slow data bus a fixed number of cycles after write-enable goes low. A build that latched on the write itself would accept programs a real machine ignores, and one that never latched would silently make every program silent.',
    requires: { machines: ['bbc-a', 'bbc-b', 'bbc-bplus', 'master'], capabilities: [], unavailableDetail: 'This case drives the system VIA sound latch and needs a BBC-family machine.' },
    source: [
      'ORG &1900',
      '.start',
      ' SEI',
      ' LDA #&FF',
      ' STA &FE43',     /* port A all outputs: the slow data bus */
      ' LDA #&0F',
      ' STA &FE42',     /* port B low nibble out: the addressable latch */
      ' LDA #&08',
      ' STA &FE40',     /* latch line 0 high: write-enable idle */
      ' LDA #&80',
      ' STA &FE4F',     /* latch tone 1, low four bits of its period */
      ' LDA #&00',
      ' STA &FE40',     /* write-enable low */
      ' NOP',
      ' NOP',
      ' NOP',
      ' NOP',
      ' NOP',
      ' NOP',
      ' NOP',
      ' NOP',
      ' NOP',
      ' NOP',
      ' LDA #&08',
      ' STA &FE40',     /* write-enable high again */
      ' NOP',
      ' NOP',
      ' LDA #&3F',
      ' STA &FE4F',     /* the remaining six bits of the period */
      ' LDA #&00',
      ' STA &FE40',     /* write-enable low */
      ' NOP',
      ' NOP',
      ' NOP',
      ' NOP',
      ' NOP',
      ' NOP',
      ' NOP',
      ' NOP',
      ' NOP',
      ' NOP',
      ' LDA #&08',
      ' STA &FE40',     /* write-enable high again */
      ' NOP',
      ' NOP',
      ' LDA #&90',
      ' STA &FE4F',     /* tone 1 volume, loudest */
      ' LDA #&00',
      ' STA &FE40',     /* write-enable low */
      ' NOP',
      ' NOP',
      ' NOP',
      ' NOP',
      ' NOP',
      ' NOP',
      ' NOP',
      ' NOP',
      ' NOP',
      ' NOP',
      ' LDA #&08',
      ' STA &FE40',     /* write-enable high again */
      ' NOP',
      ' NOP',
      ' CLI',
      '.done',
      ' RTS',
    ].join('\n'),
    stop: 'done',
    /* Observed on a BBC Model B with os12-basic2-dfs, three times identically,
     * rather than copied from anywhere: three bytes latched, digest 8D591C50.
     * An earlier attempt at this case held write-enable low for about seven
     * cycles and latched nothing, reporting 811C9DC5 — the hash function's own
     * starting value, and so indistinguishable from a run that never listened
     * until audioAssertionModel made that difference explicit. */
    assertions: ['AUDIO[WRITES] = FNV32:8D591C50'].join('\n'),
    cycleBudget: 20000,
  },
  {
    id: 'banking-sideways-paging',
    area: 'banking',
    title: 'Writing the ROM select register pages a different sideways ROM into &8000',
    rationale: 'Everything a BBC does beyond BASIC arrives through a sideways ROM, so a build that ignored the ROM select register would appear to work until a program needed a filing system. The failure is quiet: the previous ROM stays paged in and reads succeed, returning the wrong ROM.',
    requires: {
      machines: ['bbc-b'], capabilities: ['sideways'], romSets: ['os12-basic2-dfs'],
      unavailableDetail: 'This case reads the headers of the two ROMs a BBC Model B with MOS 1.20, BASIC II and DFS 0.90 has fitted.',
    },
    source: [
      'ORG &1900',
      '.start',
      ' SEI',
      ' LDA &F4',
      ' STA &90',       /* the slot the MOS had paged in, put back at the end */
      ' LDX #&0E',
      ' STX &F4',       /* the copy of the latch the MOS keeps, so it agrees */
      ' STX &FE30',     /* slot 14: the DFS */
      ' LDY &8007',     /* the header's own offset to its copyright string */
      ' STY &74',       /* kept, because it differs between the two ROMs */
      ' LDA &8000,Y',
      ' STA &70',
      ' INY',
      ' LDA &8000,Y',
      ' STA &71',
      ' INY',
      ' LDA &8000,Y',
      ' STA &72',
      ' INY',
      ' LDA &8000,Y',
      ' STA &73',
      ' INY',
      ' LDX #&0F',
      ' STX &F4',       /* the copy of the latch the MOS keeps, so it agrees */
      ' STX &FE30',     /* slot 15: BASIC II */
      ' LDY &8007',     /* the header's own offset to its copyright string */
      ' STY &7C',       /* kept, because it differs between the two ROMs */
      ' LDA &8000,Y',
      ' STA &78',
      ' INY',
      ' LDA &8000,Y',
      ' STA &79',
      ' INY',
      ' LDA &8000,Y',
      ' STA &7A',
      ' INY',
      ' LDA &8000,Y',
      ' STA &7B',
      ' INY',
      ' LDA &90',
      ' STA &F4',
      ' STA &FE30',
      ' CLI',
      '.done',
      ' RTS',
    ].join('\n'),
    stop: 'done',
    /*
     * Two assertions doing two different jobs.
     *
     * The copyright signature is documented: every Acorn paged ROM holds a zero
     * byte followed by "(C)" at the offset its own header gives in &8007. Both
     * slots showing it says each read landed inside a real paged ROM.
     *
     * That alone would not prove paging, because a build that ignored &FE30
     * would read one resident ROM twice and both signatures would still be
     * there. The offsets are what proves it: &11 in slot 14 and &0E in slot 15,
     * observed from this ROM set, and necessarily equal to each other if the
     * write to &FE30 did nothing. This is why the case names the ROM set it
     * applies to — the offsets are facts about these ROMs, not about the
     * machine.
     */
    assertions: [
      'MEM[&70] = 00 28 43 29',
      'MEM[&78] = 00 28 43 29',
      'MEM[&74] = &11',
      'MEM[&7C] = &0E',
    ].join('\n'),
    cycleBudget: 20000,
  },
  {
    id: 'breakpoint-maps-address-hook',
    area: 'breakpoint-maps',
    title: 'A named source label resolves to the address the program actually executes',
    rationale: 'Every breakpoint in this build is an address the assembler produced from a label. If the map were off by even one instruction, breakpoints would appear to work — they would stop somewhere — while stopping in the wrong place, which is worse than not stopping at all because it is believed.',
    requires: { machines: [], capabilities: [], unavailableDetail: 'This case needs a 6502-family machine.' },
    source: [
      'ORG &1900',
      '.start',
      ' LDX #&05',
      '.spin',
      ' DEX',            /* the label under test: reached once per iteration */
      ' BNE spin',
      ' LDA #&00',
      '.after',
      ' STA &73',        /* a second label, executed exactly once */
      '.done',
      ' RTS',
    ].join('\n'),
    stop: 'done',
    /*
     * The counts are what the program's own arithmetic requires rather than
     * what a run reported: X counts down from five to zero, so the instruction
     * at `spin` is entered five times, and the one at `after` once. A map that
     * resolved either label to a neighbouring instruction would give a
     * different count — one, five, or nothing — so this cannot pass by
     * accident.
     */
    assertions: [
      'EVENT[spin] = 5',
      'EVENT[after] = 1',
      'MEM[&73] = &00',
    ].join('\n'),
    cycleBudget: 2000,
  },
  {
    id: 'media-dfs-catalogue',
    area: 'media',
    title: 'The filing system reads a file\u2019s catalogue entry from a mounted disc',
    rationale: 'A program reaches a disc through the filing system rather than the controller, and a build whose OSFILE answered from anywhere but the mounted image would let every disc-based program appear to work while reading nothing. The load address is the check, because it is a value the image carries and no default would produce.',
    requires: {
      machines: ['bbc-a', 'bbc-b', 'bbc-bplus', 'master'], capabilities: ['dfs'],
      unavailableDetail: 'This case reads a DFS catalogue and needs a BBC-family machine with DFS enabled.',
    },
    /*
     * OSFILE &05 reads a file's catalogue information without loading it. The
     * control block gets the filename pointer; the filing system fills in the
     * load address, execution address, length and attributes, and returns 1
     * in A for a file it found.
     */
    source: [
      'ORG &1900',
      '.start',
      /* A machine that has just been reset has the tape filing system
       * selected, so OSFILE would wait on a cassette that is not there — which
       * is a timeout rather than a failure, and says nothing about the disc.
       * The first attempt at this case did exactly that. */
      ' LDX #<selectdisc',
      ' LDY #>selectdisc',
      ' JSR &FFF7',      /* OSCLI */
      ' LDA #<filename',
      ' STA control',
      ' LDA #>filename',
      ' STA control + 1',
      ' LDA #&05',
      ' LDX #<control',
      ' LDY #>control',
      ' JSR &FFDD',      /* OSFILE */
      ' STA found',
      '.done',
      ' RTS',
      '.selectdisc',
      'EQUS "DISC"',
      'EQUB &0D',
      '.filename',
      'EQUS "$.PROOF"',
      'EQUB &0D',
      '.found',
      'EQUB 0',
      /* The control block, labelled field by field: the plan language reads a
       * symbol, not an expression, so `control + 2` is not something it can be
       * asked about. */
      '.control',
      ' SKIP 2',        /* pointer to the filename */
      '.loadaddress',
      ' SKIP 4',
      '.executionaddress',
      ' SKIP 4',
      '.filelength',
      ' SKIP 4',
      '.attributes',
      ' SKIP 4',
    ].join('\n'),
    stop: 'done',
    /*
     * A = 1 says the filing system found a file rather than nothing or a
     * directory, and the load address it read out of the catalogue is the
     * &1234 the image declares — a value nothing but the disc could produce.
     *
     * The upper two bytes are 0 and are asserted as observed rather than as
     * expected: an earlier version of this case asserted &FFFF for them, on
     * the assumption that this DFS sign-extends an 18-bit address the way
     * later filing systems do. It does not. The claim the case makes is about
     * the sixteen bits the catalogue holds; the rest is recorded because the
     * assertion has to say something about those bytes and inventing a value
     * for them would be the only untrue part of it.
     */
    assertions: [
      'MEM[found] = &01',
      'MEM[loadaddress] = 34 12 00 00',
    ].join('\n'),
    cycleBudget: 8000000,
    disc: {
      drive: 0,
      title: 'CONFORM',
      name: 'PROOF',
      directory: '$',
      loadAddress: 0x1234,
      executionAddress: 0x5678,
      contents: [0xc0, 0xff, 0xee],
    },
  },
]);

export interface AreaCoverage {
  area: ConformanceArea;
  label: string;
  cases: number;
  /** Named rather than counted, so an uncovered area cannot be read as a pass. */
  covered: boolean;
}

export interface SuiteCoverage {
  areas: AreaCoverage[];
  coveredAreas: number;
  totalAreas: number;
  uncovered: ConformanceArea[];
  summary: string;
}

/**
 * What the suite covers and what it does not.
 *
 * The uncovered areas are the point. A report of what ran says nothing about
 * where a bug would go unnoticed, and that is the question a conformance suite
 * is asked.
 */
export function suiteCoverage(cases: readonly ConformanceCase[] = CONFORMANCE_CASES): SuiteCoverage {
  const areas = CONFORMANCE_AREAS.map((area) => {
    const count = cases.filter((item) => item.area === area).length;
    return { area, label: AREA_LABELS[area], cases: count, covered: count > 0 };
  });
  const uncovered = areas.filter((entry) => !entry.covered).map((entry) => entry.area);
  const coveredAreas = areas.length - uncovered.length;
  return {
    areas,
    coveredAreas,
    totalAreas: areas.length,
    uncovered,
    summary: uncovered.length
      ? `${coveredAreas} of ${areas.length} areas have conformance cases. ${uncovered.length} have none: ${uncovered.map((area) => AREA_LABELS[area]).join(', ')}. An area with no cases is not a passing area; it is one where a fault would go unnoticed.`
      : `All ${areas.length} areas have conformance cases.`,
  };
}

/**
 * Whether a case can mean anything on the machine in front of us.
 *
 * A case that cannot run is reported as not run, with the reason. Counting it
 * as a pass would be the exact failure this suite exists to prevent.
 */
export function caseApplies(
  item: ConformanceCase,
  machine: { machineId: string; capabilities: readonly string[]; romSetId?: string },
): { applies: boolean; reason: string | null } {
  if (item.requires.machines.length && !item.requires.machines.includes(machine.machineId)) {
    return { applies: false, reason: `${item.requires.unavailableDetail} This session is ${machine.machineId}.` };
  }
  const romSets = item.requires.romSets ?? [];
  if (romSets.length && (machine.romSetId === undefined || !romSets.includes(machine.romSetId))) {
    return { applies: false, reason: `${item.requires.unavailableDetail} This session uses ${machine.romSetId ?? 'an unnamed ROM set'}.` };
  }
  const missing = item.requires.capabilities.filter((capability) => !machine.capabilities.includes(capability));
  if (missing.length) {
    return { applies: false, reason: `${item.requires.unavailableDetail} This session does not have ${missing.join(', ')} enabled.` };
  }
  return { applies: true, reason: null };
}

/**
 * Check that a case's assertions are ones the runner can actually read.
 *
 * A case whose plan does not parse is a case that would fail for the wrong
 * reason, and a suite carrying one is a suite that tests its own syntax.
 */
export function validateCase(item: ConformanceCase, symbols: Record<string, number>): { assertions: MachineAssertion[]; errors: string[] } {
  const plan = parseTestPlan(item.stop, item.assertions, symbols);
  const errors = [...plan.errors];
  if (plan.stopAddress === null) errors.push(`${item.id}: the stop label "${item.stop}" is not a symbol of the built program.`);
  if (!plan.assertions.length) errors.push(`${item.id}: carries no assertions, so running it would prove nothing.`);
  if (!item.rationale.trim()) errors.push(`${item.id}: does not say what would go unnoticed without it.`);
  return { assertions: plan.assertions, errors };
}

/** Every case for one area, for a report that groups them. */
export function casesForArea(area: ConformanceArea, cases: readonly ConformanceCase[] = CONFORMANCE_CASES): ConformanceCase[] {
  return cases.filter((item) => item.area === area);
}
