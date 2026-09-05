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
  RUNTIME_PAGES,
  RUNTIME_HOST_SOURCE,
  runtimeFindings,
  runtimeProbe,
  runtimeSummary,
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

  it('names every runtime document with the channel it announces on', () => {
    expect(RUNTIME_PAGES.length).toBeGreaterThan(3);
    for (const page of RUNTIME_PAGES) {
      expect(page.path, page.label).toMatch(/^\/[a-z]+\.html$/);
      expect(page.channel, page.label).toMatch(/^8bit-net-/);
      expect(runtimeProbe(page.status, page.channel)).toContain(page.channel);
    }
  });
});

describe('the runtime page rules', () => {
  const answered = (overrides: Record<string, unknown> = {}) => ({
    framed: true,
    statusPresent: true,
    statusText: 'Waiting for firmware from the local vault…',
    canvases: 1,
    announced: ['ready'],
    errors: [],
    rejections: [],
    violations: [],
    ...overrides,
  });
  const page = (overrides: Record<string, unknown> = {}) => [{ label: 'Elkulator Electron runtime', expectsAnnouncement: true, page: answered(overrides) }];

  it('accepts a runtime that framed, rendered and announced itself', () => {
    expect(runtimeFindings('Firefox', page())).toEqual([]);
  });

  it('fails a runtime that never announced itself, whatever its status region says', () => {
    /* This is the check that matters. A script that throws on load leaves the
     * document's own initial status text in place, so the status region reads
     * as populated either way; only the announcement cannot be faked by a page
     * that did not run. */
    const findings = runtimeFindings('Firefox', page({ announced: [] }));
    expect(findings.join(' ')).toContain('never announced itself');
  });

  it('fails a runtime with no display surface or no status region', () => {
    expect(runtimeFindings('Chromium', page({ canvases: 0 })).join(' ')).toContain('display surface');
    expect(runtimeFindings('Chromium', page({ statusPresent: false })).join(' ')).toContain('status region');
  });

  it('says so rather than reporting nothing when the frame could not be reached', () => {
    const findings = runtimeFindings('Firefox', page({ framed: false }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('nothing about it was measured');
  });

  it('reports an error, a rejection and a violation inside a runtime page', () => {
    const findings = runtimeFindings('Firefox', page({ errors: ['boom'], rejections: ['nope'], violations: ['script-src blocked inline'] }));
    expect(findings.join('\n')).toContain('uncaught error in the');
    expect(findings.join('\n')).toContain('unhandled rejection in the');
    expect(findings.join('\n')).toContain('policy violation in the');
  });

  it('names the browser whose runtimes it quotes, and what each announced', () => {
    const summary = runtimeSummary([{ browser: 'Firefox', runtimes: page() }]);
    expect(summary).toContain('in Firefox:');
    expect(summary).toContain('announced ready');
    expect(runtimeSummary([])).toBe('no runtime document was measured');
  });

  it('frames only a path on its own origin', () => {
    /* The harness takes the page to frame from its own query string, so the
     * pattern is what stops it being pointed anywhere else. */
    expect(RUNTIME_HOST_SOURCE).toContain('event.origin !== window.location.origin');
    expect(RUNTIME_HOST_SOURCE).toContain('.html$');
  });
});
