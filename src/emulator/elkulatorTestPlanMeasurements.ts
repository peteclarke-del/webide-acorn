/*
 * What happened when hardware test plans were run on a real Acorn Electron.
 *
 * A test runner is the one part of a workbench that cannot be taken on trust,
 * because its failure mode is silence. A runner that evaluates nothing and
 * reports "passed" does not look broken; it looks like evidence, and it removes
 * the evidence it appears to be. So this one was run on the machine, over the
 * ordinary command envelope, and what it said is written down here.
 *
 * Five plans, each there for a different reason: one that should pass, one that
 * should fail, one that should time out, and two that should be refused before
 * they run. `scripts/measureElectronTestPlan.mjs` reproduces them, and refuses
 * to exit zero unless each still does what a working runner would.
 */

/** How the measurement was taken, for anyone reading a failure. */
export const ELKULATOR_TEST_PLAN_MEASUREMENT_SOURCE =
  'Measured on an Acorn Electron booted under the Elkulator WebAssembly core in headless Chromium: each plan was ' +
  'submitted over the runtime command envelope the workbench uses, and the test-result event it published was recorded.';

/**
 * The program every plan ran: LDA #&42, STA &2000, LDX #7, then a halt loop.
 *
 * Four instructions, one visible memory write, and somewhere to stop.
 */
export const MEASURED_PROGRAM = Object.freeze([0xa9, 0x42, 0x8d, 0x00, 0x20, 0xa2, 0x07, 0x4c, 0x07, 0x19]);
export const MEASURED_PROGRAM_ORIGIN = 0x1900;
export const MEASURED_PROGRAM_STOP = 0x1907;

export interface MeasuredPlanResult {
  name: string;
  status: 'passed' | 'failed' | 'timeout' | 'error';
  /** The machine's own account of how the run ended. */
  reason: string;
  /** Cycles that actually elapsed, which is not the budget. */
  cycles: number;
  /** Each assertion as it came back, or none where the plan was refused. */
  assertions: ReadonlyArray<{ kind: string; passed: boolean }>;
  /** Why this plan is in the set. */
  establishes: string;
}

export const ELKULATOR_TEST_PLAN_RESULTS: readonly MeasuredPlanResult[] = Object.freeze([
  {
    name: 'registers and memory',
    status: 'passed',
    reason: 'stop address reached · 0 input actions applied',
    cycles: 12,
    assertions: [
      { kind: 'register', passed: true },
      { kind: 'register', passed: true },
      { kind: 'memory', passed: true },
      { kind: 'cycles', passed: true },
    ],
    establishes: 'A plan whose expectations are all true passes, having read the registers and memory the program really left behind.',
  },
  {
    name: 'a wrong expectation fails',
    status: 'failed',
    reason: 'stop address reached · 0 input actions applied',
    cycles: 12,
    assertions: [{ kind: 'register', passed: false }],
    establishes: 'A plan with one wrong expectation fails, and the failure is the assertion rather than the run: the machine reached its stop address exactly as before.',
  },
  {
    name: 'an unreachable stop times out',
    status: 'timeout',
    reason: 'timeout · 0 input actions applied',
    cycles: 40028,
    assertions: [{ kind: 'register', passed: true }],
    establishes: 'A plan whose stop is never reached times out rather than passing, even though its one assertion was true — and it reports the cycles that really elapsed, which overran the 5,000 it was given because this core runs a whole field at a time.',
  },
  {
    name: 'a screen assertion is refused',
    status: 'error',
    reason: 'SCREEN hashes a region of the framebuffer. The core renders into its own canvas through Allegro and this bridge publishes no framebuffer to read back.',
    cycles: 0,
    assertions: [],
    establishes: 'An assertion this core cannot observe is refused before the run, with the reason. It is not reported as a pass with nothing checked, which is the outcome that would matter most.',
  },
  {
    name: 'a parasite test is refused',
    status: 'error',
    reason: 'The Acorn Electron has no Tube, so there is no parasite to run a test on',
    cycles: 0,
    assertions: [],
    establishes: 'A plan naming a second processor is refused for what the machine is, rather than answered about the host as though the question had been about that.',
  },
]);

/**
 * The cycle counts this core reports are the Electron's own, not a datasheet's.
 *
 * The four instructions above are eleven cycles on paper. The machine reported
 * eleven on one run and twelve on the next, because the ULA stretches the
 * processor when it touches shared RAM and whether an access lands in a
 * stretched slot depends on where the display has got to. That is the machine
 * being modelled rather than approximated — and it is why a cycle assertion on
 * this hardware should be written as a bound rather than an equality.
 */
export const ELKULATOR_CYCLE_VARIATION = Object.freeze({
  program: 'LDA #&42 : STA &2000 : LDX #7 : JMP *',
  nominalCycles: 11,
  measured: Object.freeze([11, 12]),
  cause: 'ULA contention on shared RAM, which depends on the display phase at the moment of the access',
});
