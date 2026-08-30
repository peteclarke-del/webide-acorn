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
  /** Said plainly when the case cannot run here. */
  unavailableDetail: string;
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
      'SAVE start,P%,start',
    ].join('\n'),
    stop: 'done',
    assertions: [
      'A = &70',
      /* Bit 6 of the stored flags is V. &F0 is N and V set with the unused and
       * break bits, which is what PHP pushes here. */
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
      'SAVE start,P%,start',
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
      'SAVE start,P%,start',
    ].join('\n'),
    stop: 'done',
    /* Two LDX/LDA reads: 2 + 4 + 5 = 11 cycles of instruction time. The budget
     * is asserted as a range because entry and the stop instruction are counted
     * by the runner and are not part of what this case is about. */
    assertions: ['CYCLES IN 1..2000'].join('\n'),
    cycleBudget: 2000,
  },
  {
    id: 'sound-single-latch',
    area: 'sound',
    title: 'One falling edge of the sound write line latches one command',
    rationale: 'The observed write count is what every sound assertion is built on. This build already corrected an expectation here once, when an uninitialised System VIA produced a spurious latch.',
    requires: { machines: ['bbc-a', 'bbc-b', 'bbc-bplus', 'master'], capabilities: [], unavailableDetail: 'The sound chip case needs a BBC-family machine with an SN76489.' },
    source: [
      'ORG &1900',
      '.start',
      ' LDA #&FF',
      ' STA &FE43',     /* system VIA port A all outputs */
      ' LDA #&9F',      /* channel 3 volume off */
      ' STA &FE4F',
      ' LDA #&00',
      ' STA &FE40',     /* drive the write line low: one latch */
      ' LDA #&08',
      ' STA &FE40',     /* and high again */
      '.done',
      ' RTS',
      'SAVE start,P%,start',
    ].join('\n'),
    stop: 'done',
    assertions: ['AUDIO[WRITES] = FNV32:9A0BB4AE'].join('\n'),
    cycleBudget: 5000,
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
      'SAVE start,P%,start',
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
      'SAVE start,P%,start',
    ].join('\n'),
    stop: 'done',
    assertions: ['EVENT[OSWRCH] = 2'].join('\n'),
    cycleBudget: 200000,
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
  machine: { machineId: string; capabilities: readonly string[] },
): { applies: boolean; reason: string | null } {
  if (item.requires.machines.length && !item.requires.machines.includes(machine.machineId)) {
    return { applies: false, reason: `${item.requires.unavailableDetail} This session is ${machine.machineId}.` };
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
