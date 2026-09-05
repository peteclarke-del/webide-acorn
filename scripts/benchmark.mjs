#!/usr/bin/env node
/* Measure the workbench in every browser this machine can produce.
 *
 * The page reports by posting its results here rather than being read over a
 * debugging protocol. Chromium speaks CDP, Firefox speaks WebDriver BiDi and
 * Safari speaks neither, so a harness built on a protocol measures whichever
 * browser that protocol belongs to and calls it a matrix. A POST works in all
 * of them and needs no client.
 *
 * A browser in the matrix that could not be launched is recorded with the
 * reason. That is the difference between a report that covers two of three
 * engines and one that quietly reports on one and reads as complete.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = new Map();
for (let index = 2; index < process.argv.length; index += 2) argv.set(process.argv[index], process.argv[index + 1]);
const port = Number(argv.get('--port') ?? 8123);
if (!Number.isInteger(port) || port < 1024 || port > 65_535) throw new Error('--port must be between 1024 and 65535');
const reportPath = resolve(argv.get('--output') ?? join(root, 'docs', 'benchmarks.json'));
const documentPath = resolve(argv.get('--document') ?? join(root, 'docs', 'benchmarks.md'));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.data': 'application/octet-stream' };

/** Where a browser is, or null with the reason it is not here. */
function locate(id) {
  const named = process.env[`${id.toUpperCase()}_PATH`];
  if (named) return existsSync(named) ? named : null;
  const candidates = id === 'chromium'
    ? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
    : id === 'firefox' ? ['/usr/bin/firefox'] : [];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function launch(id, executable, url, profile) {
  const args = id === 'firefox'
    ? ['--headless', '--new-instance', '--profile', profile, url]
    : ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', `--user-data-dir=${profile}`, url];
  return spawn(executable, args, { stdio: ['ignore', 'ignore', 'ignore'] });
}

/*
 * Where a browser is allowed to keep the profile this run gives it.
 *
 * A packaged Firefox — the snap on Ubuntu, and Flatpak the same way — is
 * confined and cannot see a directory under the system temporary path. Given
 * one it does not fail: it starts, ignores the profile, writes nothing and
 * exits a few seconds later, which from out here is indistinguishable from a
 * browser that ran and reported nothing. That cost an afternoon once, so the
 * profile goes somewhere the confinement allows and the reason is written down
 * rather than left as a magic path.
 */
function profileRoot(id) {
  if (id !== 'firefox') return tmpdir();
  const confined = join(process.env.HOME ?? tmpdir(), 'snap', 'firefox', 'common');
  return existsSync(confined) ? confined : tmpdir();
}

const suite = await (async () => {
  /* The declarations are TypeScript, so they are bundled with the esbuild vite
   * already brings rather than being copied here. Two declarations of what is
   * measured would eventually disagree about what was proved. */
  const staging = await mkdtemp(join(tmpdir(), '8bit-net-benchmark-suite-'));
  try {
    const bundle = join(staging, 'suite.mjs');
    await run('npx', ['esbuild', join(root, 'src/benchmark/benchmarkSuite.ts'), '--bundle', '--format=esm', `--outfile=${bundle}`], { cwd: root });
    return await import(`file://${bundle}`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
})();

const output = await mkdtemp(join(tmpdir(), '8bit-net-benchmark-'));
const profiles = [];
try {
  process.stdout.write('Building the workbench and the benchmark page…\n');
  await run('npx', ['vite', 'build'], { cwd: root, env: { ...process.env, BENCHMARK_OUTPUT_DIR: output } });

  const reports = new Map();
  let deliver = null;
  const server = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/report') {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        response.writeHead(204).end();
        try { deliver?.(JSON.parse(body)); } catch (error) { deliver?.({ failures: [String(error)] }); }
      });
      return;
    }
    const requested = (request.url ?? '/').split('?')[0];
    const file = join(output, requested === '/' ? 'index.html' : requested.replace(/^\/+/, ''));
    if (!file.startsWith(output) || !existsSync(file)) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(response);
  });
  await new Promise((ready) => server.listen(port, '127.0.0.1', ready));

  const unmeasuredBrowsers = [];
  for (const browser of suite.BENCHMARK_BROWSERS) {
    const executable = locate(browser.id);
    if (!executable) {
      unmeasuredBrowsers.push({ id: browser.id, reason: `${browser.label} was not found on this machine. ${browser.obtained}` });
      process.stdout.write(`SKIPPED  ${browser.id} · not present\n`);
      continue;
    }
    const profile = await mkdtemp(join(profileRoot(browser.id), `8bit-net-benchmark-${browser.id}-`));
    profiles.push(profile);
    const url = `http://127.0.0.1:${port}/benchmark.html?report=/report&browser=${browser.id}&workbench=/index.html`;
    process.stdout.write(`RUNNING  ${browser.id} · ${executable}\n`);
    const child = launch(browser.id, executable, url, profile);
    const delivered = await new Promise((resolveReport) => {
      const timer = setTimeout(() => resolveReport(null), 240_000);
      deliver = (payload) => { clearTimeout(timer); resolveReport(payload); };
    });
    deliver = null;
    child.kill('SIGTERM');
    if (!delivered?.browser) {
      unmeasuredBrowsers.push({ id: browser.id, reason: `${browser.label} was launched but reported nothing within four minutes, so it has no measurement rather than a slow one.` });
      process.stdout.write(`FAILED   ${browser.id} · no report\n`);
      continue;
    }
    if (delivered.failures?.length) {
      for (const failure of delivered.failures) process.stdout.write(`  ! ${failure}\n`);
    }
    reports.set(browser.id, delivered.browser);
    process.stdout.write(`MEASURED ${browser.id} · ${delivered.browser.measurements.length} of ${suite.BENCHMARK_CASES.length} cases\n`);
  }
  await new Promise((closed) => server.close(closed));

  const report = {
    schema: suite.BENCHMARK_SCHEMA,
    version: 1,
    browsers: [...reports.values()].sort((left, right) => left.id.localeCompare(right.id)),
    unmeasuredBrowsers: unmeasuredBrowsers.sort((left, right) => left.id.localeCompare(right.id)),
    unmeasuredAreas: suite.unmeasuredAreas(),
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(documentPath, renderDocument(report, suite));

  const findings = suite.budgetFindings(report);
  for (const finding of findings) process.stdout.write(`OVER     ${finding.detail}\n`);
  if (!report.browsers.length) {
    process.stderr.write('No browser in the matrix could be measured, so this run proved nothing.\n');
    process.exitCode = 1;
  } else if (findings.length) {
    process.exitCode = 1;
  } else {
    process.stdout.write(`Within budget on ${report.browsers.length} browser${report.browsers.length === 1 ? '' : 's'}.\n`);
  }
} finally {
  await rm(output, { recursive: true, force: true });
  for (const profile of profiles) await rm(profile, { recursive: true, force: true });
}

function renderDocument(report, module) {
  const byId = new Map(module.BENCHMARK_CASES.map((item) => [item.id, item]));
  const lines = [
    '# Benchmarks',
    '',
    'Generated by `npm run benchmark`, which builds the workbench, opens the',
    'benchmark page in every browser this machine can produce, and records what',
    'each one reported. Nothing here is written by hand.',
    '',
    'The ceilings are deliberately generous — an order of magnitude above what an',
    'operation costs today rather than a factor of two. A suite that failed on a',
    'loaded laptop would be switched off within a week, and a suite nobody runs',
    'measures nothing. What these catch is the change that makes an operation cost',
    'a hundred times what it did.',
    '',
    '## What was measured, and on what',
    '',
  ];
  for (const browser of report.browsers) {
    lines.push(`### ${browser.id}`, '', `\`${browser.userAgent}\``, '', `Version ${browser.version} · ${browser.hardwareClass} · ${browser.cores} logical processors`, '', '| Case | Per iteration | Ceiling | Iterations | Produced |', '| --- | --- | --- | --- | --- |');
    for (const measurement of browser.measurements) {
      const item = byId.get(measurement.id);
      lines.push(`| ${item?.label ?? measurement.id} | ${measurement.millisecondsPerIteration.toFixed(3)} ms | ${item?.budgetMs ?? '—'} ms | ${measurement.iterations} | ${measurement.produced} |`);
    }
    lines.push('');
  }
  if (report.unmeasuredBrowsers.length) {
    lines.push('## Browsers with no measurement', '', 'Named rather than omitted: a matrix that reported only what it managed to', 'run would get quieter every time something broke.', '');
    for (const entry of report.unmeasuredBrowsers) lines.push(`- **${entry.id}** — ${entry.reason}`);
    lines.push('');
  }
  if (report.unmeasuredAreas.length) {
    lines.push('## Areas with no measurement', '');
    for (const entry of report.unmeasuredAreas) lines.push(`- **${module.AREA_LABELS[entry.area] ?? entry.area}** — ${entry.reason}`);
    lines.push('');
  }
  lines.push('## Why each case matters', '');
  for (const item of module.BENCHMARK_CASES) lines.push(`- **${item.label}** — ${item.matters}`);
  lines.push('');
  return lines.join('\n');
}
