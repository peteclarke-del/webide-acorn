/* The page the benchmark harness opens in each browser.
 *
 * It reports by posting its results back rather than by being read over a
 * debugging protocol, because the protocols differ per browser — Chromium
 * speaks CDP, Firefox speaks WebDriver BiDi, and Safari speaks neither — and a
 * measurement that only exists on the browser whose protocol was implemented
 * is not a measurement across a matrix. A POST works everywhere and needs no
 * client at all.
 */
import {
  BENCHMARK_CASES, BENCHMARK_SCHEMA, hardwareClassFor,
  type BenchmarkMeasurement,
} from './benchmarkSuite';
import {
  benchmarkFile, benchmarkSource, runAssetCanvas, runBuild, runDiagnostics,
  runEditLatency, runStartup, runTraceFilter,
} from './benchmarkRunners';

const parameters = new URLSearchParams(location.search);
const report = parameters.get('report');
const browserId = parameters.get('browser') ?? 'unknown';
const workbench = parameters.get('workbench') ?? '/index.html';

function show(text: string): void {
  const output = document.querySelector('#benchmark-output');
  if (output) output.textContent = text;
}

/** A measured case, timed once around the whole run of its iterations. */
function measure(id: string, iterations: number, run: () => number): BenchmarkMeasurement {
  const started = performance.now();
  const produced = run();
  const elapsed = performance.now() - started;
  return { id, iterations, produced, millisecondsPerIteration: elapsed / Math.max(1, iterations) };
}

async function main(): Promise<void> {
  const source = benchmarkSource();
  const file = benchmarkFile(source);
  const byId = new Map(BENCHMARK_CASES.map((item) => [item.id, item]));
  const iterations = (id: string) => byId.get(id)?.iterations ?? 1;
  const measurements: BenchmarkMeasurement[] = [];
  const failures: string[] = [];

  const startup = byId.get('startup-first-render');
  if (startup) {
    try {
      const { milliseconds, produced } = await runStartup(workbench);
      measurements.push({ id: startup.id, iterations: 1, produced, millisecondsPerIteration: milliseconds });
    } catch (error) {
      failures.push(`${startup.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const synchronous: Array<[string, () => number]> = [
    ['edit-latency-large-source', () => runEditLatency(source, iterations('edit-latency-large-source'))],
    ['diagnostics-large-source', () => runDiagnostics(file, iterations('diagnostics-large-source'))],
    ['build-large-source', () => runBuild(source, iterations('build-large-source'))],
    ['trace-filter-large-window', () => runTraceFilter(50_000, iterations('trace-filter-large-window'))],
    ['asset-canvas-tilemap', () => runAssetCanvas(iterations('asset-canvas-tilemap'))],
  ];
  for (const [id, run] of synchronous) {
    if (!byId.has(id)) continue;
    try {
      measurements.push(measure(id, iterations(id), run));
    } catch (error) {
      failures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    /* Yielded between cases so the page can paint, which keeps a long run from
     * being killed by a browser that thinks the tab has hung. */
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const cores = navigator.hardwareConcurrency || 1;
  const payload = {
    schema: BENCHMARK_SCHEMA,
    browser: {
      id: browserId,
      userAgent: navigator.userAgent,
      version: /(?:Chrome|Firefox|Version)\/([0-9.]+)/.exec(navigator.userAgent)?.[1] ?? 'unknown',
      hardwareClass: hardwareClassFor(cores).id,
      cores,
      measurements,
    },
    failures,
  };
  show(`${measurements.length} measured, ${failures.length} failed`);
  if (report) {
    await fetch(report, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  }
}

void main().catch((error) => {
  show(`Benchmark failed: ${error instanceof Error ? error.message : String(error)}`);
  if (report) void fetch(report, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schema: BENCHMARK_SCHEMA, browser: { id: browserId, userAgent: navigator.userAgent, version: 'unknown', hardwareClass: 'unknown', cores: 0, measurements: [] }, failures: [String(error)] }) });
});
