/*
 * What one assertion was asked for and what the machine gave back.
 *
 * The runtime has always computed both — every assertion kind produces an
 * `actual` beside its `expected` — and the report dropped them, so a failing
 * run said which test failed and never what it saw. That is the difference
 * between a report somebody can act on and one that sends them back to run it
 * again by hand, and it was found the hard way: a conformance case failed
 * against a real BBC and the report could not say whether the fault was the
 * expectation or the machine.
 */
export interface ReportAssertion {
  /** The assertion as it was written, which is what a person recognises. */
  source: string;
  passed: boolean;
  /** Rendered rather than raw, because a report is read and not parsed. */
  expected: string;
  actual: string;
}

export interface ReportTestResult {
  name: string;
  suite: string;
  status: 'passed' | 'failed' | 'timeout' | 'error' | 'skipped' | 'cancelled';
  reason: string;
  cycles: number;
  buildFingerprint?: string;
  recordedAt?: string;
  /** Every assertion, passed or not: the passing ones say what was proved. */
  assertions?: ReportAssertion[];
}

/** How many assertions a single result may carry into a report. */
const MAX_REPORTED_ASSERTIONS = 64;

/**
 * Render an assertion's expected and actual sides for a report.
 *
 * A byte is shown the way the assertion was written — a memory expectation of
 * `&41` reads back as `&41` rather than as 65 — because a report that renamed
 * the value would make somebody check whether it was the same number.
 */
export function renderAssertionValue(value: unknown): string {
  if (value === undefined || value === null) return 'not recorded';
  if (Array.isArray(value)) return value.map((item) => renderAssertionValue(item)).join(', ');
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 && value <= 0xffffffff
    ? `&${value.toString(16).toUpperCase()}`
    : String(value);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
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
  const copied = results.slice(0, 10_000).map((result) => ({
    ...result,
    ...(result.assertions ? { assertions: result.assertions.slice(0, MAX_REPORTED_ASSERTIONS).map((assertion) => ({ ...assertion })) } : {}),
  }));
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
      /* The failing assertions go in the failure body, because that is where a
       * reader of a JUnit report looks and a message attribute is one line. */
      const failedAssertions = (row.assertions ?? []).filter((assertion) => !assertion.passed);
      const detail = failedAssertions.length
        ? `\n${failedAssertions.map((assertion) => `${assertion.source} — expected ${assertion.expected}, got ${assertion.actual}`).join('\n')}\n`
        : '';
      /* Self-closing when there is nothing to add, so a result that carries no
       * assertion detail keeps exactly the shape it had before. */
      const failure = detail
        ? `<failure type="${xml(row.status)}" message="${xml(row.reason)}">${xml(detail)}</failure>`
        : `<failure type="${xml(row.status)}" message="${xml(row.reason)}"/>`;
      const outcome = ['failed', 'timeout', 'error'].includes(row.status) ? failure : ['skipped', 'cancelled'].includes(row.status) ? `<skipped message="${xml(row.reason)}"/>` : '';
      return `<testcase classname="${xml(suite)}" name="${xml(row.name)}">${properties}${outcome}</testcase>`;
    }).join('');
    return `<testsuite name="${xml(suite)}" tests="${rows.length}" failures="${failures}" skipped="${skipped}">${cases}</testsuite>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><testsuites tests="${results.length}">${body}</testsuites>`;
}
