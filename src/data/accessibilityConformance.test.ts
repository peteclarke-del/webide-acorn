// @vitest-environment node

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CRITERIA,
  conformanceSummary,
  renderConformanceChecklist,
  validateConformance,
  type Criterion,
} from './accessibilityConformance';
import { COVERAGE } from '../../scripts/accessibilityRules.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const documentPath = join(root, 'docs', 'accessibility-conformance.md');

describe('the conformance checklist', () => {
  it('matches the document that is checked in', async () => {
    const expected = renderConformanceChecklist();
    let actual: string | null = null;
    try { actual = await readFile(documentPath, 'utf8'); } catch { actual = null; }
    if (actual !== expected) {
      await writeFile(documentPath, expected, 'utf8');
      throw new Error(`docs/accessibility-conformance.md ${actual === null ? 'did not exist' : 'was out of date'} and has been written. Review and commit it.`);
    }
    expect(actual).toBe(expected);
  });

  it('is internally consistent', () => {
    expect(validateConformance()).toEqual([]);
  });

  it('lists every Level A and AA criterion of WCAG 2.2 exactly once', () => {
    /* Forty-nine at A and AA in WCAG 2.2, after 4.1.1 Parsing was removed and
     * the six 2.2 additions were made. */
    expect(CRITERIA).toHaveLength(55);
    expect(new Set(CRITERIA.map((criterion) => criterion.id)).size).toBe(CRITERIA.length);
    for (const criterion of CRITERIA) expect(['A', 'AA']).toContain(criterion.level);
  });

  it('does not list 4.1.1, which WCAG 2.2 removed', () => {
    /* Citing a criterion that no longer exists would make the whole checklist
     * suspect, and the duplicate-id rule is cited against 4.1.2 instead. */
    expect(CRITERIA.map((criterion) => criterion.id)).not.toContain('4.1.1');
  });

  it('includes the criteria WCAG 2.2 added', () => {
    const ids = CRITERIA.map((criterion) => criterion.id);
    for (const added of ['2.4.11', '2.5.7', '2.5.8', '3.2.6', '3.3.7', '3.3.8']) expect(ids, added).toContain(added);
  });

  it('makes every not-applicable entry say what the product does not have', () => {
    /* The entry easiest to abuse is the one that has to say most. */
    const broken: Criterion = { id: '1.1.1', name: 'x', level: 'A', verification: 'n/a', evidence: 'This criterion is simply out of scope for the product as it stands today.' };
    expect(validateConformance([broken]).map((problem) => problem.problem))
      .toContain('is marked not applicable without saying what the product does not have');
  });

  it('makes every partial entry say which half is manual', () => {
    const broken: Criterion = { id: '1.1.1', name: 'x', level: 'A', verification: 'partial', evidence: 'A rule in the release gate decides most of this criterion for us.' };
    expect(validateConformance([broken]).map((problem) => problem.problem))
      .toContain('is marked partial without saying which half is manual');
  });

  it('names a gate rule in the evidence for everything it calls automated', () => {
    /* An automated claim with no rule behind it is a manual claim wearing a
     * better word. */
    for (const criterion of CRITERIA.filter((entry) => entry.verification === 'automated')) {
      expect(criterion.evidence, criterion.id).toMatch(/gate|rule|binding table/i);
    }
  });

  it('leaves in the checklist everything the rules say they cannot decide', () => {
    /* Each limitation the scan declares must appear as manual or partial work
     * somewhere, or it has been quietly dropped. */
    expect(COVERAGE.manual.length).toBeGreaterThan(0);
    const manualWork = CRITERIA.filter((criterion) => criterion.verification === 'manual' || criterion.verification === 'partial');
    expect(manualWork.length).toBeGreaterThanOrEqual(COVERAGE.manual.length);
    const text = manualWork.map((criterion) => criterion.evidence).join(' ').toLowerCase();
    /* The four things the scan declares it cannot decide each have to appear
     * as work somewhere, or one of them has been quietly dropped. */
    for (const subject of ['screen reader', 'order', 'announce', 'conveys']) {
      expect(text, subject).toContain(subject);
    }
  });

  it('counts what it claims', () => {
    const summary = conformanceSummary();
    expect(summary.automated + summary.partial + summary.manual + summary.notApplicable).toBe(summary.total);
    expect(summary.total).toBe(CRITERIA.length);
  });

  it('makes no overall conformance claim while the manual matrix is unrun', () => {
    const text = renderConformanceChecklist();
    expect(text).toContain('makes no overall conformance claim');
    expect(text).toContain('Level AAA is out of scope');
  });

  it('produces the same bytes every time', () => {
    expect(renderConformanceChecklist()).toBe(renderConformanceChecklist());
  });
});
