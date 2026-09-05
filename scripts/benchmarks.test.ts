// @vitest-environment node

/* The checked-in benchmark report, held to the suite that produced it.
 *
 * The measurements themselves need browsers, so refreshing the report is a
 * deliberate act — `npm run benchmark` — exactly as approving a golden is. What
 * runs on every commit is this: that the report is the shape the suite expects,
 * that it covers what the suite declares, that every figure is inside its
 * ceiling, and that anything unmeasured is named with a reason.
 *
 * That division is the point. A benchmark stage that needed three browsers
 * would be switched off on the first machine that had two, and a report with
 * nothing checking it would drift into a file nobody reads.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BENCHMARK_AREAS, BENCHMARK_BROWSERS, BENCHMARK_CASES, BENCHMARK_SCHEMA,
  budgetFindings, hardwareClassFor, unmeasuredAreas, type BenchmarkReport,
} from '../src/benchmark/benchmarkSuite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const report = JSON.parse(await readFile(join(root, 'docs', 'benchmarks.json'), 'utf8')) as BenchmarkReport;
const document = await readFile(join(root, 'docs', 'benchmarks.md'), 'utf8');

describe('the suite itself', () => {
  it('declares a unique, budgeted case for every area it claims to measure', () => {
    const ids = BENCHMARK_CASES.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of BENCHMARK_CASES) {
      expect(BENCHMARK_AREAS).toContain(item.area);
      expect(item.budgetMs).toBeGreaterThan(0);
      expect(item.iterations).toBeGreaterThan(0);
      /* Each case says what a regression would do to somebody, because a
       * number with no consequence attached is one nobody will defend. */
      expect(item.matters.length).toBeGreaterThan(40);
    }
  });

  it('gives every unmeasured area a reason, because an empty area is the finding', () => {
    const unmeasured = unmeasuredAreas();
    expect(unmeasured.map((entry) => entry.area).sort()).toEqual(['debugger', 'emulator']);
    for (const entry of unmeasured) {
      expect(entry.reason).toMatch(/firmware/);
      expect(entry.reason).not.toMatch(/no reason has been recorded/i);
    }
  });

  it('places a machine in a class by what it has, and never off the end', () => {
    expect(hardwareClassFor(64).id).toBe('workstation');
    expect(hardwareClassFor(8).id).toBe('workstation');
    expect(hardwareClassFor(4).id).toBe('laptop');
    expect(hardwareClassFor(1).id).toBe('modest');
    expect(hardwareClassFor(0).id).toBe('modest');
  });

  it('finds a measurement over its ceiling, one that produced nothing, and one that is absent', () => {
    /* A check that cannot fail is not a check, so each of the three kinds of
     * finding is produced deliberately here. */
    const base = { id: 'chromium', userAgent: 'test', version: '1', hardwareClass: 'workstation', cores: 8 };
    const slow = BENCHMARK_CASES[0]!;
    const findings = budgetFindings({
      ...report,
      browsers: [{ ...base, measurements: [{ id: slow.id, iterations: 1, produced: 1, millisecondsPerIteration: slow.budgetMs + 1 }] }],
    });
    expect(findings.some((finding) => finding.detail.includes('above its'))).toBe(true);
    expect(findings.some((finding) => finding.detail.includes('has no measurement for'))).toBe(true);

    const empty = budgetFindings({
      ...report,
      browsers: [{ ...base, measurements: [{ id: slow.id, iterations: 1, produced: 0, millisecondsPerIteration: 0 }] }],
    });
    expect(empty.some((finding) => finding.detail.includes('produced nothing'))).toBe(true);
  });
});

describe('the checked-in report', () => {
  it('is the shape the suite writes', () => {
    expect(report.schema).toBe(BENCHMARK_SCHEMA);
    expect(report.version).toBe(1);
    expect(report.browsers.length).toBeGreaterThan(0);
  });

  it('is inside every ceiling', () => {
    expect(budgetFindings(report)).toEqual([]);
  });

  it('measured every case on every browser it reports', () => {
    const expected = BENCHMARK_CASES.map((item) => item.id).sort();
    for (const browser of report.browsers) {
      expect(browser.measurements.map((measurement) => measurement.id).sort()).toEqual(expected);
      expect(browser.measurements.every((measurement) => measurement.produced > 0)).toBe(true);
      /* What the browser said it was, so a report cannot be attributed to a
       * browser that never ran. */
      expect(browser.userAgent.length).toBeGreaterThan(20);
      expect(browser.cores).toBeGreaterThan(0);
    }
  });

  it('accounts for every browser in the matrix, measured or not', () => {
    const accounted = new Set([...report.browsers.map((browser) => browser.id), ...report.unmeasuredBrowsers.map((entry) => entry.id)]);
    for (const browser of BENCHMARK_BROWSERS) {
      expect(accounted.has(browser.id)).toBe(true);
    }
    /* Named with a reason rather than omitted: a matrix that reported only what
     * it managed to run would get quieter every time something broke. */
    for (const entry of report.unmeasuredBrowsers) expect(entry.reason.length).toBeGreaterThan(30);
  });

  it('covers more than one engine, or it is one browser wearing the word matrix', () => {
    const engines = new Set(report.browsers.map((browser) => BENCHMARK_BROWSERS.find((entry) => entry.id === browser.id)?.engine));
    expect(engines.size).toBeGreaterThan(1);
  });
});

describe('the generated document', () => {
  it('says the same thing the report does', () => {
    for (const browser of report.browsers) expect(document).toContain(browser.userAgent);
    for (const entry of report.unmeasuredBrowsers) expect(document).toContain(entry.reason);
    for (const item of BENCHMARK_CASES) expect(document).toContain(item.matters);
  });

  it('says it is generated, so nobody edits it by hand', () => {
    expect(document).toMatch(/Generated by `npm run benchmark`/);
    expect(document).toMatch(/Nothing here is written by hand/);
  });
});
