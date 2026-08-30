// @vitest-environment node

/* The accounting matters more than the cases here. A conformance suite that
 * reports only what it ran says nothing about where a fault would go
 * unnoticed, and that is the question it is asked.
 */
import { describe, expect, it } from 'vitest';
import { assembleProject6502 } from '../build/projectAssembler6502';
import { resolveTestValue } from './testPlan';
import {
  CONFORMANCE_AREAS,
  CONFORMANCE_CASES,
  caseApplies,
  casesForArea,
  suiteCoverage,
  validateCase,
  type ConformanceCase,
} from './conformanceSuite';

/* Symbols the cases refer to. A real run gets these from the build; here they
 * stand in so the plans can be checked without assembling anything. */
const symbols = { start: 0x1900, done: 0x1910 };

describe('what the suite says it covers', () => {
  it('enumerates every area the product claims, covered or not', () => {
    /* Derived from the cases this would only ever report that everything
     * present is covered, which is true and useless. */
    const coverage = suiteCoverage();
    expect(coverage.areas.map((entry) => entry.area)).toEqual([...CONFORMANCE_AREAS]);
    expect(coverage.totalAreas).toBe(CONFORMANCE_AREAS.length);
  });

  it('names the areas with no cases rather than omitting them', () => {
    const coverage = suiteCoverage();
    expect(coverage.uncovered.length).toBeGreaterThan(0);
    expect(coverage.summary).toMatch(/have none:/);
    expect(coverage.summary).toMatch(/not a passing area; it is one where a fault would go unnoticed/);
  });

  it('counts an area as covered only when a case exists for it', () => {
    const coverage = suiteCoverage();
    for (const entry of coverage.areas) {
      expect(entry.covered).toBe(entry.cases > 0);
      expect(entry.cases).toBe(casesForArea(entry.area).length);
    }
  });

  it('reports full coverage only when every area really has one', () => {
    /* Proved by giving it a suite that does cover everything, so the happy
     * summary is reachable and is not a sentence nothing can produce. */
    const complete = CONFORMANCE_AREAS.map((area, index) => ({
      ...CONFORMANCE_CASES[0]!, id: `case-${index}`, area,
    })) as ConformanceCase[];
    const coverage = suiteCoverage(complete);
    expect(coverage.uncovered).toEqual([]);
    expect(coverage.summary).toMatch(/All 11 areas have conformance cases/);
  });
});

describe('the cases themselves', () => {
  it('every case parses into assertions the runner can read', () => {
    /* A case whose plan does not parse would fail for the wrong reason, and a
     * suite carrying one is a suite testing its own syntax. */
    for (const item of CONFORMANCE_CASES) {
      const { assertions, errors } = validateCase(item, symbols);
      expect(errors, `${item.id}: ${errors.join(' · ')}`).toEqual([]);
      expect(assertions.length, item.id).toBeGreaterThan(0);
    }
  });

  it('every case says what would go unnoticed without it', () => {
    for (const item of CONFORMANCE_CASES) {
      expect(item.rationale.trim().length, item.id).toBeGreaterThan(30);
    }
  });

  it('every case has a unique identifier and a real cycle budget', () => {
    const ids = CONFORMANCE_CASES.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of CONFORMANCE_CASES) {
      expect(item.cycleBudget, item.id).toBeGreaterThan(0);
    }
  });

  it('every case assembles with the toolchain the suite is run through', () => {
    /* The check that was missing, and its absence cost a five-minute headless
     * run against a real machine to discover. Every case originally ended with
     * a BeebAsm `SAVE`, which the browser assembler does not have — so none of
     * them could build, and a contract that asserted the sources *contained*
     * SAVE agreed with the mistake rather than catching it. Assembling here
     * means a case that cannot build fails in seconds instead. */
    for (const item of CONFORMANCE_CASES) {
      const artifact = assembleProject6502(item.id, [{ id: item.id, name: `${item.id}.asm`, content: item.source }]);
      const errors = artifact.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
      expect(errors.map((diagnostic) => diagnostic.message), item.id).toEqual([]);
      expect(artifact.bytes.length, item.id).toBeGreaterThan(0);
      /* And the label the plan stops on has to resolve against the symbols the
       * build emits — through the same resolver the runner uses, because the
       * assembler upper-cases labels and a plain key lookup would be testing a
       * proxy for the behaviour rather than the behaviour. */
      expect(resolveTestValue(item.stop, artifact.symbols), `${item.id} stop label ${item.stop}`).not.toBeNull();
    }
  });

  it('refuses a case with no assertions rather than letting it pass vacuously', () => {
    const empty: ConformanceCase = { ...CONFORMANCE_CASES[0]!, id: 'empty', assertions: '' };
    expect(validateCase(empty, symbols).errors.join(' ')).toMatch(/carries no assertions, so running it would prove nothing/);
  });

  it('refuses a case whose stop label is not in the build', () => {
    const lost: ConformanceCase = { ...CONFORMANCE_CASES[0]!, id: 'lost', stop: 'nowhere' };
    expect(validateCase(lost, symbols).errors.join(' ')).toMatch(/is not a symbol of the built program/);
  });

  it('refuses a case that does not say why it exists', () => {
    const mute: ConformanceCase = { ...CONFORMANCE_CASES[0]!, id: 'mute', rationale: '  ' };
    expect(validateCase(mute, symbols).errors.join(' ')).toMatch(/does not say what would go unnoticed without it/);
  });
});

describe('whether a case can mean anything here', () => {
  const bbc = { machineId: 'bbc-b', capabilities: ['dfs'] };

  it('applies a machine-independent case anywhere', () => {
    const anywhere = CONFORMANCE_CASES.find((item) => !item.requires.machines.length)!;
    expect(caseApplies(anywhere, { machineId: 'atom', capabilities: [] })).toEqual({ applies: true, reason: null });
  });

  it('does not apply a BBC case on another machine, and says why', () => {
    const bbcOnly = CONFORMANCE_CASES.find((item) => item.requires.machines.includes('bbc-b'))!;
    const standing = caseApplies(bbcOnly, { machineId: 'atom', capabilities: [] });
    expect(standing.applies).toBe(false);
    expect(standing.reason).toMatch(/This session is atom/);
  });

  it('does not apply a case whose capability is not enabled, and names it', () => {
    const needsTube: ConformanceCase = {
      ...CONFORMANCE_CASES[0]!, id: 'needs-tube',
      requires: { machines: [], capabilities: ['tube'], unavailableDetail: 'This case needs a Tube.' },
    };
    const standing = caseApplies(needsTube, bbc);
    expect(standing.applies).toBe(false);
    expect(standing.reason).toMatch(/does not have tube enabled/);
  });
});
