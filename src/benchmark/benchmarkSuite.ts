/* What this build measures, and on what.
 *
 * A benchmark is only worth having if a person can tell what it would mean for
 * it to get worse, so each case here names the operation somebody actually
 * performs rather than a function that happens to be easy to time, and carries
 * a ceiling rather than a target.
 *
 * The ceilings are deliberately generous — roughly ten times what the operation
 * costs on the slower of the two engines measured, not a factor of two. A
 * benchmark suite that failed on a loaded laptop would be turned off within a
 * week, and a suite nobody runs measures nothing. What these catch is the
 * change that makes an operation cost a hundred times what it did, which is the
 * shape of an accidental quadratic or a lost cache, and which is invisible
 * until somebody with a large project finds it.
 *
 * They are set from the measurements rather than chosen, for the same reason
 * the coverage floors are: a number picked in advance is a wish, and a number
 * taken from what is already true is a guard against it getting worse.
 *
 * Two areas are declared and not measured, and that is recorded rather than
 * quietly omitted: everything about the emulator and the debugger needs
 * firmware to run, and no firmware may enter this repository or its image
 * (SEC-903). Their measurement belongs with the conformance suite, which is run
 * where firmware has been supplied.
 */

export const BENCHMARK_SCHEMA = '8bit-net.benchmark-report' as const;

export type BenchmarkArea =
  | 'startup' | 'editing' | 'diagnostics' | 'build' | 'emulator'
  | 'debugger' | 'trace' | 'assets';

export const BENCHMARK_AREAS: readonly BenchmarkArea[] = Object.freeze([
  'startup', 'editing', 'diagnostics', 'build', 'emulator', 'debugger', 'trace', 'assets',
]);

export const AREA_LABELS: Readonly<Record<BenchmarkArea, string>> = Object.freeze({
  startup: 'Application startup',
  editing: 'Edit latency',
  diagnostics: 'Live diagnostics',
  build: 'Build',
  emulator: 'Emulator input, frames and audio',
  debugger: 'Debugger acknowledgement',
  trace: 'Trace',
  assets: 'Asset canvases',
});

/**
 * Why an area carries no measurement.
 *
 * An unmeasured area with no reason beside it reads as an area that was fine,
 * which is the one thing it must never read as.
 */
export const UNMEASURED_AREAS: Readonly<Partial<Record<BenchmarkArea, string>>> = Object.freeze({
  emulator: 'Every emulator measurement needs a booted machine, which needs firmware, and no firmware may enter this repository or the built image. These are measured with the conformance suite, where firmware has been supplied.',
  debugger: 'A debugger acknowledgement is a round trip to a running machine, so it has the same firmware dependency as the emulator itself.',
});

export interface BenchmarkCase {
  id: string;
  area: BenchmarkArea;
  label: string;
  /** What a regression here would do to somebody using the product. */
  matters: string;
  /** How many times the operation runs per measurement. */
  iterations: number;
  /** The ceiling for one iteration, in milliseconds. */
  budgetMs: number;
}

export interface BenchmarkMeasurement {
  id: string;
  /** Milliseconds for one iteration, which is what the budget is against. */
  millisecondsPerIteration: number;
  iterations: number;
  /** Something the operation produced, so a case that did nothing cannot pass. */
  produced: number;
}

export interface BenchmarkBrowser {
  id: string;
  label: string;
  /** The engine, because two browsers on one engine measure one engine. */
  engine: 'blink' | 'gecko' | 'webkit';
  /** How this build gets one to measure, or why it cannot here. */
  obtained: string;
}

/**
 * The browsers this product supports, from the requirement.
 *
 * Safari is declared and cannot be measured on this machine: WebKit's browser
 * does not run on Linux, and measuring a different WebKit — a GTK build, or a
 * remote service — would be measuring something else and reporting it under
 * Safari's name. The report says which of these were measured and which were
 * not, so the matrix cannot be read as covered when it is not.
 */
export const BENCHMARK_BROWSERS: readonly BenchmarkBrowser[] = Object.freeze([
  { id: 'chromium', label: 'Chromium or Chrome', engine: 'blink', obtained: 'Launched headless from CHROMIUM_PATH, or found on the PATH.' },
  { id: 'firefox', label: 'Firefox', engine: 'gecko', obtained: 'Launched headless from FIREFOX_PATH, or found on the PATH.' },
  { id: 'safari', label: 'Safari', engine: 'webkit', obtained: 'Not obtainable here. Safari does not run on Linux, and another WebKit reported under its name would be a different measurement wearing the same label.' },
]);

/**
 * A machine class, recorded rather than assumed.
 *
 * The same numbers mean different things on different hardware, so a report
 * that did not say what it ran on would be a set of figures nobody could
 * compare with anything.
 */
export interface HardwareClass {
  id: string;
  label: string;
  /** Logical processors at or above which a machine is in this class. */
  minimumCores: number;
}

export const HARDWARE_CLASSES: readonly HardwareClass[] = Object.freeze([
  { id: 'workstation', label: 'Workstation', minimumCores: 8 },
  { id: 'laptop', label: 'Laptop or small desktop', minimumCores: 4 },
  { id: 'modest', label: 'Modest', minimumCores: 1 },
]);

export function hardwareClassFor(cores: number): HardwareClass {
  return HARDWARE_CLASSES.find((entry) => cores >= entry.minimumCores) ?? HARDWARE_CLASSES[HARDWARE_CLASSES.length - 1]!;
}

export const BENCHMARK_CASES: readonly BenchmarkCase[] = Object.freeze([
  {
    id: 'startup-first-render',
    area: 'startup',
    label: 'The workbench renders its first frame',
    matters: 'This is the whole wait between opening the product and being able to do anything with it, so it is the one measurement everybody experiences.',
    iterations: 1,
    budgetMs: 10_000,
  },
  {
    id: 'edit-latency-large-source',
    area: 'editing',
    label: 'A keystroke is applied to a two-thousand-line source',
    matters: 'Edit latency is the only measurement a person feels continuously. A regression here does not slow a task down, it makes typing unpleasant, which is a different and worse kind of failure.',
    iterations: 200,
    budgetMs: 10,
  },
  {
    id: 'diagnostics-large-source',
    area: 'diagnostics',
    label: 'Diagnostics are recomputed for a two-thousand-line source',
    matters: 'Diagnostics run after every pause in typing. If they cost more than the pause, they run behind the source and report on a program nobody has any more.',
    iterations: 20,
    budgetMs: 250,
  },
  {
    id: 'build-large-source',
    area: 'build',
    label: 'A two-thousand-line source is assembled',
    matters: 'The build is the loop everything else waits on: run, debug and test all begin with it, so its cost is paid several times for every change.',
    iterations: 10,
    budgetMs: 6000,
  },
  {
    id: 'trace-filter-large-window',
    area: 'trace',
    label: 'Fifty thousand trace events are filtered',
    matters: 'A trace is taken when something is already wrong, and a filter that cannot keep up with the window turns the one tool for a hard bug into a thing that hangs.',
    iterations: 5,
    budgetMs: 20,
  },
  {
    id: 'asset-canvas-tilemap',
    area: 'assets',
    label: 'A sixty-four by sixty-four tile map is drawn',
    matters: 'An asset canvas redraws on every stroke, so its cost is the difference between drawing and waiting.',
    iterations: 20,
    budgetMs: 60,
  },
]);

/** Every area with no case, and why — an empty answer is the finding. */
export function unmeasuredAreas(cases: readonly BenchmarkCase[] = BENCHMARK_CASES): Array<{ area: BenchmarkArea; reason: string }> {
  return BENCHMARK_AREAS
    .filter((area) => !cases.some((item) => item.area === area))
    .map((area) => ({ area, reason: UNMEASURED_AREAS[area] ?? 'No reason has been recorded for this area carrying no measurement, which is itself a finding.' }));
}

export interface BenchmarkReport {
  schema: typeof BENCHMARK_SCHEMA;
  version: 1;
  browsers: Array<{
    id: string;
    /** What the browser said it was, not what it was asked to be. */
    userAgent: string;
    version: string;
    hardwareClass: string;
    cores: number;
    measurements: BenchmarkMeasurement[];
  }>;
  /** Browsers in the matrix with no measurement, and why. */
  unmeasuredBrowsers: Array<{ id: string; reason: string }>;
  unmeasuredAreas: Array<{ area: BenchmarkArea; reason: string }>;
}

export interface BudgetFinding {
  browserId: string;
  caseId: string;
  /** Present when the case ran; absent means it did not. */
  millisecondsPerIteration?: number;
  budgetMs: number;
  detail: string;
}

/**
 * Everything wrong with a report, in the words a reader needs.
 *
 * A measurement that is missing is a finding as much as one that is too slow: a
 * suite that reported only on what it managed to run would get quieter every
 * time something broke.
 */
export function budgetFindings(report: BenchmarkReport, cases: readonly BenchmarkCase[] = BENCHMARK_CASES): BudgetFinding[] {
  const findings: BudgetFinding[] = [];
  for (const browser of report.browsers) {
    const byId = new Map(browser.measurements.map((measurement) => [measurement.id, measurement]));
    for (const item of cases) {
      const measurement = byId.get(item.id);
      if (!measurement) {
        findings.push({ browserId: browser.id, caseId: item.id, budgetMs: item.budgetMs, detail: `${browser.id} has no measurement for ${item.id}, so nothing says whether it is within its ceiling.` });
        continue;
      }
      if (measurement.produced <= 0) {
        findings.push({ browserId: browser.id, caseId: item.id, millisecondsPerIteration: measurement.millisecondsPerIteration, budgetMs: item.budgetMs, detail: `${item.id} produced nothing on ${browser.id}, so its timing is the cost of doing no work.` });
        continue;
      }
      if (measurement.millisecondsPerIteration > item.budgetMs) {
        findings.push({ browserId: browser.id, caseId: item.id, millisecondsPerIteration: measurement.millisecondsPerIteration, budgetMs: item.budgetMs, detail: `${item.id} took ${measurement.millisecondsPerIteration.toFixed(2)} ms on ${browser.id}, above its ${item.budgetMs} ms ceiling.` });
      }
    }
  }
  return findings;
}
