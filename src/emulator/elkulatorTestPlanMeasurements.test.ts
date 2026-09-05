import { describe, expect, it } from 'vitest';
import {
  ELKULATOR_TEST_PLAN_RESULTS, ELKULATOR_TEST_PLAN_MEASUREMENT_SOURCE, ELKULATOR_CYCLE_VARIATION,
  MEASURED_PROGRAM, MEASURED_PROGRAM_ORIGIN, MEASURED_PROGRAM_STOP,
} from './elkulatorTestPlanMeasurements';
import { ELKULATOR_CAPABILITIES, elkulatorCommandRefusal } from './elkulatorAdapter';

describe('the Electron test runner, as the machine answered it', () => {
  /*
   * The point of these is not that a runner exists. It is that this one can
   * fail, time out and refuse — because a runner that only ever passes is
   * indistinguishable from one that checks nothing, and the second is worse
   * than having none.
   */
  it('can pass, fail, time out and refuse', () => {
    expect(ELKULATOR_TEST_PLAN_RESULTS.map((result) => result.status))
      .toEqual(['passed', 'failed', 'timeout', 'error', 'error']);
  });

  it('passes only when every assertion it evaluated was true', () => {
    for (const result of ELKULATOR_TEST_PLAN_RESULTS) {
      const allTrue = result.assertions.every((assertion) => assertion.passed);
      if (result.status === 'passed') expect(allTrue, `${result.name} passed`).toBe(true);
      if (result.status === 'failed') expect(allTrue, `${result.name} failed`).toBe(false);
    }
  });

  it('times out even when the assertion it did evaluate was true', () => {
    /* The trap this guards: reporting a pass because the expectations happened
     * to hold at the moment the budget ran out, when the program never reached
     * the state the plan was about. */
    const timedOut = ELKULATOR_TEST_PLAN_RESULTS.find((result) => result.status === 'timeout')!;
    expect(timedOut.assertions.every((assertion) => assertion.passed)).toBe(true);
    expect(timedOut.status).not.toBe('passed');
  });

  it('reports the cycles that elapsed rather than the budget it was given', () => {
    const timedOut = ELKULATOR_TEST_PLAN_RESULTS.find((result) => result.status === 'timeout')!;
    /* The plan asked for 5,000; this core cannot stop inside a field. */
    expect(timedOut.cycles).toBeGreaterThan(5_000);
    expect(timedOut.reason).toContain('timeout');
  });

  it('evaluates nothing at all in a refused plan', () => {
    for (const refused of ELKULATOR_TEST_PLAN_RESULTS.filter((result) => result.status === 'error')) {
      expect(refused.assertions, `${refused.name} evaluated nothing`).toEqual([]);
      expect(refused.cycles).toBe(0);
      expect(refused.reason.length).toBeGreaterThan(40);
    }
  });

  it('refuses a parasite test for what the machine is', () => {
    const parasite = ELKULATOR_TEST_PLAN_RESULTS.find((result) => result.name.includes('parasite'))!;
    expect(parasite.reason).toContain('no Tube');
  });

  it('runs a program a person could read, at an address in Electron RAM', () => {
    expect(MEASURED_PROGRAM[0]).toBe(0xa9);
    expect(MEASURED_PROGRAM_ORIGIN + MEASURED_PROGRAM.length).toBeLessThan(0x8000);
    expect(MEASURED_PROGRAM_STOP).toBeGreaterThan(MEASURED_PROGRAM_ORIGIN);
    expect(MEASURED_PROGRAM_STOP).toBeLessThan(MEASURED_PROGRAM_ORIGIN + MEASURED_PROGRAM.length);
  });

  it('reports the Electron\'s contended cycles, not a datasheet\'s', () => {
    expect(ELKULATOR_CYCLE_VARIATION.measured.every((value) => value >= ELKULATOR_CYCLE_VARIATION.nominalCycles)).toBe(true);
    expect(new Set(ELKULATOR_CYCLE_VARIATION.measured).size).toBeGreaterThan(1);
    expect(ELKULATOR_CYCLE_VARIATION.cause).toContain('contention');
  });

  it('is offered by the adapter, so nothing refuses what the machine just did', () => {
    expect([...ELKULATOR_CAPABILITIES]).toContain('run-test');
    expect(elkulatorCommandRefusal('run-test')).toBeNull();
  });

  it('says where the results came from', () => {
    expect(ELKULATOR_TEST_PLAN_MEASUREMENT_SOURCE).toContain('command envelope');
    expect(ELKULATOR_TEST_PLAN_MEASUREMENT_SOURCE).toContain('Elkulator');
  });
});
