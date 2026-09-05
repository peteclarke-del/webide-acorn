// @vitest-environment node

/* The dependency scan, and the ways it must refuse.
 *
 * A security stage that cannot fail is worse than no security stage, because
 * it is read as evidence. Each finding it is supposed to raise is raised here
 * from a document that would produce it, and each thing it deliberately does
 * not scan is asserted to be named with a reason.
 */
import { describe, expect, it } from 'vitest';
import {
  FAILING_SEVERITIES, readComposerAudit, readNpmAudit, REPORTED_SEVERITIES,
  scanFindings, scanSummary, UNSCANNED,
} from './securityScan.mjs';

const npmDocument = (counts: Record<string, number>) =>
  JSON.stringify({ metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0, ...counts } } });

const clean = readNpmAudit(npmDocument({}));
const cleanComposer = readComposerAudit(JSON.stringify({ advisories: [], abandoned: [] }));

describe('reading what the scanners said', () => {
  it('reads an npm summary and refuses one it cannot', () => {
    expect(readNpmAudit(npmDocument({ high: 2, total: 2 }))).toEqual({
      counts: { info: 0, low: 0, moderate: 0, high: 2, critical: 0, total: 2 }, total: 2,
    });
    /* A scanner that produced nothing readable must not read as a scanner that
     * found nothing. */
    expect(() => readNpmAudit('not json')).toThrow(/did not return JSON/);
    /* A notice printed before the report is chatter, not a failed scan: the
     * report is there and reading it is what the stage is for. */
    expect(readNpmAudit('npm notice a new version is available\n{"metadata":{"vulnerabilities":{"total":0}}}').total).toBe(0);
    expect(readComposerAudit('Warning: the advisory database was slow\n{"advisories":[],"abandoned":[]}').advisories).toBe(0);
    expect(() => readComposerAudit('no document here at all')).toThrow(/did not return JSON/);
    expect(() => readNpmAudit('{}')).toThrow(/no vulnerability summary/);
  });

  it('reads composer advisories in either shape it reports them', () => {
    /* Composer reports an object keyed by package, and an empty array when
     * there is nothing, so both have to be understood. */
    expect(readComposerAudit(JSON.stringify({ advisories: [], abandoned: [] }))).toEqual({ advisories: 0, abandoned: [] });
    expect(readComposerAudit(JSON.stringify({ advisories: { 'vendor/pkg': [{}, {}] }, abandoned: { 'vendor/old': 'none' } })))
      .toEqual({ advisories: 2, abandoned: ['vendor/old'] });
    expect(() => readComposerAudit('{}')).toThrow(/no advisories field/);
  });
});

describe('what stops a release and what does not', () => {
  it('fails on high and critical, naming the count and the remedy', () => {
    for (const severity of FAILING_SEVERITIES) {
      const findings = scanFindings(readNpmAudit(npmDocument({ [severity]: 1, total: 1 })), cleanComposer);
      expect(findings, severity).toHaveLength(1);
      expect(findings[0], severity).toContain(`1 ${severity} npm advisory`);
      expect(findings[0], severity).toMatch(/npm audit/);
    }
  });

  it('reports moderate and low without failing, because nobody would act today', () => {
    for (const severity of REPORTED_SEVERITIES) {
      const npm = readNpmAudit(npmDocument({ [severity]: 3, total: 3 }));
      expect(scanFindings(npm, cleanComposer), severity).toEqual([]);
      expect(scanSummary(npm, cleanComposer), severity).toContain(`3 ${severity}`);
      expect(scanSummary(npm, cleanComposer), severity).toContain('reported and not failing');
    }
  });

  it('fails on a backend advisory and on an abandoned package', () => {
    /* Abandonment is its own finding: a package nobody maintains will not be
     * fixed when something is found in it. */
    const composer = readComposerAudit(JSON.stringify({ advisories: { 'vendor/pkg': [{}] }, abandoned: { 'vendor/old': 'none' } }));
    const findings = scanFindings(clean, composer);
    expect(findings.join(' ')).toContain('1 composer advisory');
    expect(findings.join(' ')).toContain('vendor/old');
    expect(findings.join(' ')).toMatch(/will not be fixed/);
  });

  it('says nothing is wrong only when nothing is', () => {
    expect(scanFindings(clean, cleanComposer)).toEqual([]);
    expect(scanSummary(clean, cleanComposer)).toMatch(/no high or critical advisories/);
  });
});

describe('what it does not scan', () => {
  it('names each one with a reason a reader can act on', () => {
    /* A security stage reporting only its own scope would read as a clean bill
     * of health for the whole of SEC-901. */
    expect(UNSCANNED.map((entry) => entry.id).sort()).toEqual(['container', 'dast', 'penetration-test']);
    for (const entry of UNSCANNED) {
      expect(entry.reason.length, entry.id).toBeGreaterThan(80);
      expect(entry.label.length, entry.id).toBeGreaterThan(5);
    }
  });

  it('says plainly that an independent test cannot be satisfied from inside', () => {
    const pen = UNSCANNED.find((entry) => entry.id === 'penetration-test')!;
    expect(pen.reason).toMatch(/independent/);
    expect(pen.reason).toMatch(/did not write the code/);
  });

  it('does not claim the browser smoke is a DAST run', () => {
    const dast = UNSCANNED.find((entry) => entry.id === 'dast')!;
    expect(dast.reason).toMatch(/is not a DAST run and is not claimed as one/);
  });

  it('counts the unscanned areas in the summary, so they cannot go quiet', () => {
    expect(scanSummary(clean, cleanComposer)).toContain(`${UNSCANNED.length} scans not run and named`);
  });
});
