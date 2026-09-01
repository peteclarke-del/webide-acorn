// @vitest-environment node

/* That the cross-browser rules say what they mean.
 *
 * The stage that uses these needs a browser, and these do not: the judgement
 * about what a browser's answer means is separated from the business of
 * starting one, so the part that decides pass or fail is checkable everywhere.
 */
import { describe, expect, it } from 'vitest';
import {
  MINIMUM_CONTROLS,
  MINIMUM_LANDMARKS,
  OPTIONAL_CAPABILITIES,
  matrixFindings,
  matrixSummary,
  PAGE_PROBE,
  COLLECTOR_SOURCE,
} from './browserMatrix.mjs';

const REQUIRED = ['webAssembly', 'workers', 'indexedDB', 'webgl', 'structuredClone'];

const capable = (overrides: Record<string, boolean> = {}) => ({
  ...Object.fromEntries([...REQUIRED, ...Object.keys(OPTIONAL_CAPABILITIES)].map((name) => [name, true])),
  ...overrides,
});

const answer = (overrides: Record<string, unknown> = {}) => ({
  title: '8bit-net Dev · Acorn Workbench',
  controls: 171,
  landmarks: 28,
  rootChildren: 1,
  errors: [],
  rejections: [],
  violations: [],
  capability: capable(),
  ...overrides,
});

const result = (browser: string, page: ReturnType<typeof answer> | null) => ({ browser, version: '1.0', page });

describe('the cross-browser matrix rules', () => {
  it('accepts a browser that started the workbench with nothing wrong', () => {
    expect(matrixFindings([result('Firefox', answer())])).toEqual([]);
  });

  it('refuses to call a run with no browser a pass', () => {
    /* A stage that measured nothing must not read as a stage that found
     * nothing wrong; those are the same output and opposite meanings. */
    expect(matrixFindings([])).toEqual(['No browser was measured, so this stage checked nothing.']);
  });

  it('fails a browser that loaded the document without mounting the workbench', () => {
    const findings = matrixFindings([result('Firefox', answer({ rootChildren: 0, controls: 0, landmarks: 0 }))]);
    expect(findings[0]).toContain('did not mount');
  });

  it('fails a browser that rendered too little to have finished starting', () => {
    const findings = matrixFindings([result('Chromium', answer({ controls: MINIMUM_CONTROLS - 1 }))]);
    expect(findings.join(' ')).toContain('did not finish starting');
    expect(matrixFindings([result('Chromium', answer({ landmarks: MINIMUM_LANDMARKS - 1 }))]).join(' ')).toContain('landmarks');
  });

  it('reports an uncaught error, an unhandled rejection and a policy violation by name', () => {
    const findings = matrixFindings([result('Firefox', answer({
      errors: ['x is not a function at /assets/app.js:1'],
      rejections: ['store unreachable'],
      violations: ["script-src blocked inline"],
    }))]);
    expect(findings.join('\n')).toContain('uncaught error');
    expect(findings.join('\n')).toContain('unhandled rejection');
    expect(findings.join('\n')).toContain('content security policy violation');
  });

  it('fails a browser missing a capability the product cannot work without', () => {
    for (const required of REQUIRED) {
      const findings = matrixFindings([result('Firefox', answer({ capability: capable({ [required]: false }) }))]);
      expect(findings.join(' '), required).toContain(`does not provide ${required}`);
    }
  });

  it('records a missing optional capability rather than failing for it', () => {
    /* Firefox has no File System Access API. That is a fact about the web, and
     * the product already offers a one-way import there; treating it as a
     * defect would make the gate red for something correct. */
    const page = answer({ capability: capable({ fileSystemAccess: false, webgpu: false }) });
    expect(matrixFindings([result('Firefox', page)])).toEqual([]);
    expect(matrixSummary([result('Firefox', page)])[0]).toContain('without fileSystemAccess, webgpu');
  });

  it('says so when a browser has everything recorded', () => {
    expect(matrixSummary([result('Chromium', answer())])[0]).toContain('with every recorded capability');
  });

  it('reports every browser rather than stopping at the first failure', () => {
    const findings = matrixFindings([
      result('Firefox', answer({ rootChildren: 0 })),
      result('Chromium', answer({ errors: ['boom'] })),
    ]);
    expect(findings.some((finding) => finding.startsWith('Firefox'))).toBe(true);
    expect(findings.some((finding) => finding.startsWith('Chromium'))).toBe(true);
  });

  it('names a browser that answered nothing at all', () => {
    expect(matrixFindings([result('Firefox', null)])).toEqual(['Firefox produced no answer at all.']);
  });

  it('gives every optional capability a stated purpose', () => {
    /* A capability recorded without saying what it is for is a line nobody can
     * act on, which is how a matrix becomes decoration. */
    for (const [name, purpose] of Object.entries(OPTIONAL_CAPABILITIES)) {
      expect(purpose.length, name).toBeGreaterThan(30);
      expect(PAGE_PROBE, `${name} is actually probed`).toContain(`${name}:`);
    }
  });

  it('probes every capability it requires', () => {
    for (const required of REQUIRED) expect(PAGE_PROBE, required).toContain(`${required}:`);
  });

  it('collects from before the application runs, and carries no inline script', () => {
    /* The collector is served as a file because the shipped policy forbids
     * inline script. If it ever became inline the policy would block it, and a
     * collector the policy blocked could not report the policy blocking
     * anything else. */
    expect(COLLECTOR_SOURCE).toContain("addEventListener('error'");
    expect(COLLECTOR_SOURCE).toContain('unhandledrejection');
    expect(COLLECTOR_SOURCE).toContain('securitypolicyviolation');
    expect(COLLECTOR_SOURCE).toContain('window.__ciCollected');
  });
});
