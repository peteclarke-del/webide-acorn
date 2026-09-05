// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { unrunnablePlanRefusal } from './headlessPlanRefusal.mjs';

describe('what the runner says when no report could be produced', () => {
  it('says nothing when every plan ran, whatever the plans decided', () => {
    /* A failing test is a result and produces a report; it is not this. */
    expect(unrunnablePlanRefusal([{ status: 'passed', name: 'a' }, { status: 'failed', name: 'b' }])).toBeNull();
    expect(unrunnablePlanRefusal([])).toBeNull();
  });

  it('names each plan, its reason and the remedy', () => {
    const refusal = unrunnablePlanRefusal([
      { status: 'passed', name: 'runs fine' },
      { status: 'error', name: 'too big a region', message: 'Screen-region assertions are limited to 65,536 pixels' },
    ]);
    expect(refusal).toContain('1 of 2 test plans could not run, so no report was produced');
    expect(refusal).toContain('  too big a region: Screen-region assertions are limited to 65,536 pixels');
    expect(refusal).toContain('Fix the plan in the project and run again.');
  });

  it('still says which plan when the workbench gave no reason', () => {
    /* Better a named plan with no reason than a timeout with neither. */
    expect(unrunnablePlanRefusal([{ status: 'error', name: 'nameless reason' }])).toContain('nameless reason: no reason given');
    expect(unrunnablePlanRefusal([{ status: 'error' }])).toContain('an unnamed plan: no reason given');
  });

  it('refuses input that is not a list of rows rather than reporting nothing wrong', () => {
    expect(() => unrunnablePlanRefusal(undefined as unknown as never[])).toThrow(/must be an array/);
  });
});
