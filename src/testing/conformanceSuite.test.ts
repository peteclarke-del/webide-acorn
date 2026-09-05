// @vitest-environment node

/* The accounting matters more than the cases here. A conformance suite that
 * reports only what it ran says nothing about where a fault would go
 * unnoticed, and that is the question it is asked.
 */
import { describe, expect, it } from 'vitest';
import { assembleProject6502 } from '../build/projectAssembler6502';
import { createDfsImage } from '../media/dfsImage';
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

/*
 * The symbols each case's own build emits.
 *
 * These were once a hand-written pair, `start` and `done`, which stood in for
 * a build. That made the contract a list of the labels somebody remembered:
 * the first case to name a third label failed here for a reason about this
 * file rather than about the case. Assembling gives the same symbols a real
 * run resolves against, so a case can name any label its source defines and a
 * case naming one it does not still fails.
 */
const built = new Map(CONFORMANCE_CASES.map((item) => [
  item.id,
  assembleProject6502(item.id, [{ id: item.id, name: `${item.id}.asm`, content: item.source }]),
]));
const symbolsFor = (item: ConformanceCase) => built.get(item.id)?.symbols ?? {};

/* For the cases built here that are not in the suite — a case with no
 * assertions, a lost stop label — where what is under test is the refusal
 * rather than the symbols. */
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
      const { assertions, errors } = validateCase(item, symbolsFor(item));
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
      const artifact = built.get(item.id)!;
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

  it('refuses a case asserting against a label its own source does not define', () => {
    /* The counterpart to resolving symbols from the build rather than from a
     * remembered list: naming a label that is not there must still fail, or
     * assembling would have replaced one hand-written answer with a check that
     * accepts anything. */
    const invented: ConformanceCase = { ...CONFORMANCE_CASES[0]!, id: 'invented', assertions: 'EVENT[nowhere] = 1' };
    expect(validateCase(invented, symbolsFor(CONFORMANCE_CASES[0]!)).errors.join(' '))
      .toMatch(/EVENT\[nowhere\] must name a MOS call, a 16-bit address or a build symbol/);
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

  it('does not apply a case written against other ROMs, and says which set is loaded', () => {
    /* A case that reads what is inside a ROM is asserting that ROM's contents.
     * Run against another set it would fail for a reason that says nothing
     * about the build, which reads as a fault and is not one. */
    const romBound = CONFORMANCE_CASES.find((item) => (item.requires.romSets ?? []).length)!;
    const machine = { machineId: romBound.requires.machines[0] ?? 'bbc-b', capabilities: romBound.requires.capabilities };
    expect(caseApplies(romBound, { ...machine, romSetId: romBound.requires.romSets![0]! }).applies).toBe(true);
    const elsewhere = caseApplies(romBound, { ...machine, romSetId: 'os12-basic2-adfs' });
    expect(elsewhere.applies).toBe(false);
    expect(elsewhere.reason).toMatch(/This session uses os12-basic2-adfs\./);
    /* And a session that did not say which ROMs it has cannot be assumed to
     * have the right ones. */
    expect(caseApplies(romBound, machine).applies).toBe(false);
  });
});

describe('a case that needs a disc', () => {
  const withDisc = CONFORMANCE_CASES.filter((item) => item.disc);

  it('describes the disc rather than shipping an image, and describes one this build can master', () => {
    /* A binary fixture in the repository is a thing nobody can read and that
     * can drift from what the product would actually write. */
    expect(withDisc.length).toBeGreaterThan(0);
    for (const item of withDisc) {
      const disc = item.disc!;
      expect([0, 1], item.id).toContain(disc.drive);
      expect(disc.name, item.id).toMatch(/^[A-Za-z0-9_]{1,7}$/);
      expect(disc.directory, item.id).toMatch(/^[!-~]$/);
      expect(disc.contents.length, item.id).toBeGreaterThan(0);
      expect(disc.contents.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255), item.id).toBe(true);
      /* Mastered with the same writer the product uses, so the fixture and the
       * product cannot disagree about what a disc looks like. */
      const created = createDfsImage({
        title: disc.title, name: disc.name, directory: disc.directory,
        loadAddress: disc.loadAddress, executionAddress: disc.executionAddress,
        bytes: Uint8Array.from(disc.contents),
      });
      expect(created.catalogue.files.map((file) => file.name), item.id).toEqual([disc.name]);
      expect(created.catalogue.files[0]!.loadAddress, item.id).toBe(disc.loadAddress);
    }
  });

  it('only declares a disc where the case names the media capability', () => {
    /* A case that quietly needed a disc without saying so would be reported as
     * applying on a machine that cannot give it one. */
    for (const item of withDisc) {
      expect(item.requires.capabilities, item.id).toContain('dfs');
    }
  });
});
