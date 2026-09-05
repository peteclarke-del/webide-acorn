// @vitest-environment node

/* Naming an obligation is not meeting it. These check the difference. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { COPYLEFT_COMPONENTS, licenceComplianceFindings } from './licenceCompliance.mjs';

const dockerfile = () => readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');

describe('what a copyleft component owes', () => {
  it('finds nothing wrong with the image this product actually ships', () => {
    expect(licenceComplianceFindings(dockerfile(), ['jsbeeb'])).toEqual([]);
  });

  it('requires a licence and a corresponding source for every one of them', () => {
    /* Every entry, not a sample: a component whose source stopped shipping is
     * exactly the failure this exists to catch. */
    for (const component of COPYLEFT_COMPONENTS) {
      for (const path of [component.licence, component.source]) {
        const stripped = dockerfile().split('\n').filter((line) => !line.includes(path)).join('\n');
        const findings = licenceComplianceFindings(stripped, []);
        expect(findings.join(' '), `${component.id} ${path}`).toContain(component.id);
      }
    }
  });

  it('refuses a shipped copyleft package nobody has said how to distribute', () => {
    /* The next one has to be noticed. A package that ships under copyleft and
     * is not accounted for here is a finding, not a silence. */
    const findings = licenceComplianceFindings(dockerfile(), ['jsbeeb', 'some-new-gpl-core']);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('some-new-gpl-core');
    expect(findings[0]).toMatch(/Add it to COPYLEFT_COMPONENTS and ship its source, or stop distributing it/);
  });

  it('says what each component is, so a finding names something recognisable', () => {
    for (const component of COPYLEFT_COMPONENTS) {
      expect(component.what.length, component.id).toBeGreaterThan(20);
      expect(component.source, component.id).toMatch(/^source\//);
      expect(component.licence, component.id).toMatch(/^licenses\//);
    }
  });
});
