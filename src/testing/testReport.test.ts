import { describe, expect, it } from 'vitest';
import { createJUnitTestReport, createNativeTestReport, renderAssertionValue, type ReportTestResult } from './testReport';

const results: ReportTestResult[] = [
  { name: 'passes', suite: 'CPU & flags', status: 'passed', reason: 'ok', cycles: 8, buildFingerprint: 'a'.repeat(64) },
  { name: 'fails <exactly>', suite: 'CPU & flags', status: 'failed', reason: 'X < expected', cycles: 10 },
  { name: 'not supported', suite: 'Video', status: 'skipped', reason: 'adapter unavailable', cycles: 0 },
];

describe('test result reports', () => {
  it('creates a bounded native report with manifest parity and totals', () => {
    expect(createNativeTestReport(results, 'bbc-b/os12', '2026-08-24T12:00:00.000Z')).toMatchObject({ format: '8bit-net-dev-test-report-1', manifest: { machineManifestId: 'bbc-b/os12', testTargetSchema: 1 }, totals: { tests: 3, passed: 1, failed: 1, skipped: 1 } });
  });

  it('creates escaped JUnit-compatible suites, cases, outcomes and provenance', () => {
    const report = createJUnitTestReport(results, 'bbc-b/os12');
    expect(report).toContain('name="CPU &amp; flags"');
    expect(report).toContain('name="fails &lt;exactly&gt;"');
    expect(report).toContain('<failure type="failed" message="X &lt; expected"/>');
    expect(report).toContain(`name="buildFingerprint" value="${'a'.repeat(64)}"`);
    expect(report).toContain('<skipped message="adapter unavailable"/>');
  });
});

describe('saying what a failing assertion actually saw', () => {
  const withAssertions = (overrides: Partial<ReportTestResult> = {}): ReportTestResult => ({
    name: 'ADC sets overflow', suite: 'Conformance: cpu-flags', status: 'failed',
    reason: 'stop address reached', cycles: 16,
    assertions: [
      { source: 'A = &F0', passed: false, expected: '&F0', actual: '&70' },
      { source: 'MEM[&70] = &F0', passed: true, expected: '&F0', actual: '&F0' },
    ],
    ...overrides,
  });

  it('carries every assertion into the native report, passed and failed alike', () => {
    /* The passing ones say what was proved, which is half of what a report is
     * for. */
    const report = createNativeTestReport([withAssertions()], 'bbc-b/x/y', 'now');
    expect(report.results[0]!.assertions).toHaveLength(2);
    expect(report.results[0]!.assertions![0]).toEqual({ source: 'A = &F0', passed: false, expected: '&F0', actual: '&70' });
  });

  it('puts the failing assertions in the JUnit failure body, where a reader looks', () => {
    const xml = createJUnitTestReport([withAssertions()], 'bbc-b/x/y');
    expect(xml).toContain('A = &amp;F0 — expected &amp;F0, got &amp;70');
    /* Only the failing ones: a failure body listing what passed buries the
     * thing somebody opened it for. */
    expect(xml).not.toContain('MEM[&amp;70] = &amp;F0 — expected');
  });

  it('says nothing extra when a result carries no assertions', () => {
    const report = createNativeTestReport([withAssertions({ assertions: undefined })], 'bbc-b/x/y', 'now');
    expect(report.results[0]!.assertions).toBeUndefined();
    expect(createJUnitTestReport([withAssertions({ assertions: undefined })], 'bbc-b/x/y')).toContain('<failure');
  });

  it('bounds how many assertions one result can carry into a report', () => {
    const many = Array.from({ length: 200 }, (_, index) => ({ source: `A = ${index}`, passed: true, expected: `${index}`, actual: `${index}` }));
    const report = createNativeTestReport([withAssertions({ assertions: many })], 'bbc-b/x/y', 'now');
    expect(report.results[0]!.assertions!.length).toBeLessThanOrEqual(64);
  });
});

describe('rendering a value for a report', () => {
  it('shows a byte the way the assertion was written, not as a decimal', () => {
    /* A memory expectation of &41 reading back as 65 would make somebody check
     * whether it was the same number. */
    expect(renderAssertionValue(0x41)).toBe('&41');
    expect(renderAssertionValue([0x41, 0x42])).toBe('&41, &42');
  });

  it('says a value was not recorded rather than showing it as zero', () => {
    expect(renderAssertionValue(undefined)).toBe('not recorded');
    expect(renderAssertionValue(null)).toBe('not recorded');
    /* Zero is a real value and must not read as an absence. */
    expect(renderAssertionValue(0)).toBe('&0');
  });

  it('passes a digest through as the string it is', () => {
    expect(renderAssertionValue('FNV32:9A0BB4AE')).toBe('FNV32:9A0BB4AE');
  });
});
