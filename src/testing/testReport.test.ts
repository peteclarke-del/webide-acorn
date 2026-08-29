import { describe, expect, it } from 'vitest';
import { createJUnitTestReport, createNativeTestReport, type ReportTestResult } from './testReport';

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
