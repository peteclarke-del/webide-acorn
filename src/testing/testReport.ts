export interface ReportTestResult {
  name: string;
  suite: string;
  status: 'passed' | 'failed' | 'timeout' | 'error' | 'skipped' | 'cancelled';
  reason: string;
  cycles: number;
  buildFingerprint?: string;
  recordedAt?: string;
}

export interface NativeTestReport {
  format: '8bit-net-dev-test-report-1';
  generatedAt: string;
  manifest: { machineManifestId: string; testTargetSchema: 1 };
  totals: { tests: number; passed: number; failed: number; skipped: number };
  results: ReportTestResult[];
}

const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

export function createNativeTestReport(results: readonly ReportTestResult[], machineManifestId: string, generatedAt = new Date().toISOString()): NativeTestReport {
  const copied = results.slice(0, 10_000).map((result) => ({ ...result }));
  const failed = copied.filter((result) => ['failed', 'timeout', 'error'].includes(result.status)).length;
  const skipped = copied.filter((result) => ['skipped', 'cancelled'].includes(result.status)).length;
  return { format: '8bit-net-dev-test-report-1', generatedAt, manifest: { machineManifestId, testTargetSchema: 1 }, totals: { tests: copied.length, passed: copied.filter((result) => result.status === 'passed').length, failed, skipped }, results: copied };
}

export function createJUnitTestReport(results: readonly ReportTestResult[], machineManifestId: string): string {
  const suites = new Map<string, ReportTestResult[]>();
  results.slice(0, 10_000).forEach((result) => suites.set(result.suite, [...(suites.get(result.suite) ?? []), result]));
  const body = Array.from(suites.entries()).map(([suite, rows]) => {
    const failures = rows.filter((row) => ['failed', 'timeout', 'error'].includes(row.status)).length;
    const skipped = rows.filter((row) => ['skipped', 'cancelled'].includes(row.status)).length;
    const cases = rows.map((row) => {
      const properties = `<properties><property name="cycles" value="${row.cycles}"/><property name="machineManifestId" value="${xml(machineManifestId)}"/>${row.buildFingerprint ? `<property name="buildFingerprint" value="${xml(row.buildFingerprint)}"/>` : ''}</properties>`;
      const outcome = ['failed', 'timeout', 'error'].includes(row.status) ? `<failure type="${xml(row.status)}" message="${xml(row.reason)}"/>` : ['skipped', 'cancelled'].includes(row.status) ? `<skipped message="${xml(row.reason)}"/>` : '';
      return `<testcase classname="${xml(suite)}" name="${xml(row.name)}">${properties}${outcome}</testcase>`;
    }).join('');
    return `<testsuite name="${xml(suite)}" tests="${rows.length}" failures="${failures}" skipped="${skipped}">${cases}</testsuite>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><testsuites tests="${results.length}">${body}</testsuites>`;
}
