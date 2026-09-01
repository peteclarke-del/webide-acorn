#!/usr/bin/env node
/* One gate that has to pass before this service is releasable.
 *
 * Everything here was previously a command someone had to remember to run. A
 * gate is only useful if it is the same locally and in a pipeline, so this is
 * the single definition and the workflow file calls it rather than restating
 * the steps.
 *
 * Two rules it follows.
 *
 * A stage that cannot run is reported as skipped with the reason, never as
 * passed. The browser smoke needs a Chromium; on a machine without one the gate
 * says so instead of quietly reducing what it checked.
 *
 * The exit code is the honest one: any failed stage fails the gate, and a
 * skipped stage fails it too unless `--allow-skips` is given, so a pipeline
 * cannot drift into checking less than it thinks it does.
 */
import { readComposerAudit, readNpmAudit, scanFindings, scanSummary } from './securityScan.mjs';
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, env, exit } from 'node:process';
import { cpus } from 'node:os';
import { namesInBuild, readLockfile } from './sbom.mjs';
import { COPYLEFT_COMPONENTS, licenceComplianceFindings } from './licenceCompliance.mjs';

/* The browser smoke drives Chrome over a WebSocket, which Node 20 only exposes
 * behind a flag. Rather than fail with `WebSocket is not defined` when someone
 * runs this file directly instead of through `npm run ci`, the gate re-executes
 * itself with the flag. A gate that only works when invoked one particular way
 * is a gate people route around. */
if (typeof WebSocket === 'undefined') {
  const { execPath } = await import('node:process');
  const relaunch = spawn(execPath, ['--experimental-websocket', fileURLToPath(import.meta.url), ...argv.slice(2)], { stdio: 'inherit' });
  relaunch.on('exit', (code, signal) => exit(signal ? 1 : code ?? 1));
} else {

const flags = new Set(argv.slice(2).filter((value) => value.startsWith('--')));
const allowSkips = flags.has('--allow-skips');
const only = argv.slice(2).find((value) => !value.startsWith('--'));
/* `fileURLToPath` rather than `.pathname`: a repository path containing a
 * space arrives percent-encoded otherwise, and every spawned command then
 * fails with ENOENT on a directory that does not exist. */
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

/* A named browser is authoritative: a pipeline that sets CHROMIUM_PATH expects
 * that binary, and quietly falling back to another one would hide a broken
 * image. Only when nothing is named are the usual locations tried. */
const CHROMIUM_CANDIDATES = env.CHROMIUM_PATH
  ? [env.CHROMIUM_PATH]
  : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];

async function firstExisting(paths) {
  for (const path of paths) {
    try { await access(path); return path; } catch { /* try the next one */ }
  }
  return null;
}

function run(command, args, options = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', (error) => resolveRun({ code: -1, output: `${output}${error.message}` }));
    child.on('close', (code) => resolveRun({ code: code ?? -1, output }));
  });
}

const results = [];
const record = (name, status, detail) => {
  results.push({ name, status, detail });
  const mark = status === 'passed' ? 'PASS' : status === 'skipped' ? 'SKIP' : 'FAIL';
  console.log(`${mark}  ${name}${detail ? ` · ${detail}` : ''}`);
};

async function stage(name, body) {
  if (only && !name.includes(only)) return;
  const started = Date.now();
  try {
    const outcome = await body();
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (outcome?.skipped) record(name, 'skipped', outcome.reason);
    else record(name, 'passed', `${seconds}s${outcome?.detail ? ` · ${outcome.detail}` : ''}`);
  } catch (error) {
    record(name, 'failed', error instanceof Error ? error.message : String(error));
  }
}

function expectSuccess(result, what) {
  if (result.code === 0) return;
  const tail = result.output.trim().split('\n').slice(-25).join('\n');
  throw new Error(`${what} exited ${result.code}\n${tail}`);
}

/* ---- stages -------------------------------------------------------------- */

await stage('types', async () => {
  expectSuccess(await run('npx', ['tsc', '-b', '--pretty', 'false']), 'TypeScript project build');
});

await stage('help', async () => {
  expectSuccess(await run('node', ['scripts/verify-help.mjs']), 'Help verification');
});

await stage('tests', async () => {
  /* Bounded concurrency rather than the default one-worker-per-core. A gate has
   * to be deterministic on a loaded machine, and starving the reporter's own
   * worker channel produced a run where every one of the tests passed and the
   * process still exited non-zero. */
  const workers = Math.max(2, Math.min(4, cpus().length - 2));
  const result = await run('npx', ['vitest', 'run', '--coverage', '--reporter=dot', `--maxWorkers=${workers}`, `--minWorkers=1`]);
  expectSuccess(result, 'Unit and contract tests');
  /* A skipped test is not a passing test. The suite is the evidence the product
   * is correct, so a run that quietly checked less than all of it fails. */
  const skipped = /(\d+) skipped/.exec(result.output);
  if (skipped && Number(skipped[1]) > 0) throw new Error(`${skipped[1]} test(s) were skipped. Every test must run.`);
  const summary = /Tests\s+(\d+) passed \((\d+)\)/.exec(result.output);

  /* Coverage is a floor against regression, not a target to chase. A high
   * figure says a line ran, never that anything was checked about it, so the
   * floors are set just under what the suite achieves today: they catch code
   * added without tests, and they are not something to write tests at. */
  const FLOORS = { statements: 65, branches: 80, functions: 80, lines: 65 };
  let coverage;
  try {
    coverage = JSON.parse(await readFile(join(root, 'coverage', 'coverage-summary.json'), 'utf8')).total;
  } catch {
    throw new Error('The suite ran but wrote no coverage summary, so nothing was measured');
  }
  const below = Object.entries(FLOORS)
    .filter(([metric, floor]) => (coverage[metric]?.pct ?? 0) < floor)
    .map(([metric, floor]) => `${metric} ${coverage[metric]?.pct ?? 0}% is under the ${floor}% floor`);
  if (below.length) throw new Error(`Coverage fell below its floor: ${below.join('; ')}`);

  const percentages = `statements ${coverage.statements.pct}%, branches ${coverage.branches.pct}%, functions ${coverage.functions.pct}%`;
  return { detail: summary ? `${summary[1]} tests, none skipped, ${percentages}` : percentages };
});

/* The backend build services are exercised against the real assemblers, so the
 * gate obtains them rather than accepting a run that skipped those tests. */
await stage('backend', async () => {
  const result = await run('node', ['scripts/backend-tests.mjs']);
  expectSuccess(result, 'Backend test suite');
  /* A deprecation is a failure that has not happened yet, and the count is at
   * zero, so holding it there costs nothing and keeps the suite from quietly
   * accumulating work for the next major version of its own test runner. */
  const deprecated = /PHPUnit Deprecations:\s*(\d+)/.exec(result.output);
  if (deprecated && Number(deprecated[1]) > 0) {
    throw new Error(`${deprecated[1]} PHPUnit deprecation(s) were reported. Run the suite with --display-phpunit-deprecations to see them.`);
  }
  /* Two forms, because the runner prints a clean run differently from one with
   * anything to report, and reading only one of them silently loses the
   * summary on exactly the runs that are fine. */
  const summary = /OK \((\d+) tests?, (\d+) assertions?\)/.exec(result.output)
    ?? /Tests:\s*(\d+), Assertions:\s*(\d+)/.exec(result.output);
  if (!summary) throw new Error('The backend suite reported no test count, so nothing says how much of it ran');
  return { detail: `${summary[1]} tests, ${summary[2]} assertions, none skipped, no deprecations` };
});

/* Static analysis and formatting for the backend.
 *
 * The TypeScript side has strict mode with unused locals and parameters treated
 * as errors, which is a compiler doing part of what a linter would. The PHP had
 * nothing of the sort, and the first run of this stage found a check that could
 * never fire, a null reaching str_contains, a float used as an array key, an
 * unused closure capture and six docblocks whose `@return` was never read
 * because it shared a line with an `@param`.
 *
 * The formatter runs in check mode here. A gate that rewrote files would report
 * a pass on a working tree it had just changed, which is a different tree from
 * the one that was committed.
 */
await stage('analysis', async () => {
  const analyse = await run('backend/vendor/bin/phpstan', ['analyse', '--no-progress', '--error-format=raw', '--configuration=backend/phpstan.neon']);
  expectSuccess(analyse, 'PHP static analysis');
  const format = await run('backend/vendor/bin/php-cs-fixer', ['check', '--config=backend/.php-cs-fixer.dist.php', '--show-progress=none'], {
    env: { ...process.env, PHP_CS_FIXER_IGNORE_ENV: '1' },
  });
  expectSuccess(format, 'PHP formatting');
  const files = /Found 0 of (\d+) files/.exec(format.output);
  if (!files) throw new Error('The formatter did not report how many files it checked, so nothing says it checked any');
  return { detail: `PHPStan level ${await phpstanLevel()} clean, ${files[1]} files formatted as declared` };
});

async function phpstanLevel() {
  /* Read from the configuration rather than repeated here: two declarations of
   * one number are two numbers waiting to disagree. */
  const configuration = await readFile(join(root, 'backend', 'phpstan.neon'), 'utf8');
  const level = /^\s*level:\s*(\d+)\s*$/m.exec(configuration);
  if (!level) throw new Error('backend/phpstan.neon declares no analysis level, so nothing says how strictly it was checked');
  return level[1];
}

/* Dependencies checked against what is known about them today.
 *
 * Unlike every other stage, this one fails because the world changed rather
 * than because this repository did: a package that was clean this morning can
 * carry a critical advisory this afternoon with nothing here having moved. So
 * the threshold sits where somebody would actually act — high and critical
 * fail, moderate and low are reported — and the summary always names the scans
 * that did not run, because a security stage reporting only its own scope
 * would read as a clean bill of health for all of SEC-901.
 */
await stage('security', async () => {
  const npmAudit = await run('npm', ['audit', '--json']);
  /* npm exits non-zero when it finds anything at all, including the low
   * findings this stage deliberately does not fail on, so the document is what
   * is read rather than the exit code. */
  const npm = readNpmAudit(npmAudit.output);
  const composerAudit = await run('composer', ['audit', '--format=json'], { cwd: join(root, 'backend') });
  const composer = readComposerAudit(composerAudit.output);
  const findings = scanFindings(npm, composer);
  if (findings.length) throw new Error(findings.join(' '));
  return { detail: scanSummary(npm, composer) };
});

await stage('build', async () => {
  expectSuccess(await run('npx', ['vite', 'build']), 'Production build');
  for (const required of ['dist/index.html', 'dist/emulator.html', 'dist/electron.html', 'dist/archimedes.html']) {
    try { await access(join(root, required)); }
    catch { throw new Error(`${required} is missing from the production build`); }
  }
  return { detail: 'four runtime documents present' };
});

/* The vendored emulator sources are GPL and are shipped with their licence,
 * pinned revision and per-file checksums. A build that lost any of that would
 * be a distribution problem, not a cosmetic one. */
await stage('provenance', async () => {
  const required = [
    'public/electron/elkjs/LICENSE',
    'public/electron/elkjs/PROVENANCE.md',
    'docker/elkjs/elkjs-webide.patch',
  ];
  for (const path of required) {
    try { await access(join(root, path)); }
    catch { throw new Error(`${path} is missing; vendored GPL sources must ship their licence, provenance and patches`); }
  }
  const provenance = await readFile(join(root, 'public/electron/elkjs/PROVENANCE.md'), 'utf8');
  const checksums = [...provenance.matchAll(/`([0-9a-f]{64})`/g)].length;
  if (checksums < 6) throw new Error(`Only ${checksums} vendored-file checksums are recorded; every vendored file needs one`);

  /*
   * Naming an obligation is not meeting it. The inventory says which shipped
   * packages are copyleft; this says whether the image carries their licence
   * and their corresponding source. The two were not connected, and jsbeeb and
   * ElkJS shipped a licence file and no source for exactly that reason.
   */
  const dockerfile = await readFile(join(root, 'Dockerfile'), 'utf8');
  const lockfile = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  const shipped = readLockfile(lockfile, await namesInBuild(lockfile, root));
  const shippedCopyleft = shipped
    .filter((entry) => entry.shipped && entry.licenceClass === 'copyleft')
    .map((entry) => entry.name);
  const findings = licenceComplianceFindings(dockerfile, shippedCopyleft);
  if (findings.length) throw new Error(findings.join(' · '));

  return { detail: `${checksums} vendored-file checksums recorded, ${COPYLEFT_COMPONENTS.length} copyleft components shipping licence and source` };
});

/* No ROM, no commercial program and no proprietary manual may enter the image.
 * This is SEC-903 as an executable check rather than a promise. */
await stage('hygiene', async () => {
  /* What must never be committed, or published in a build. The rule used to be
   * one line — no firmware extensions — which is the most important case and
   * not the only one: a release is also wrong if it carries a private key, an
   * access token, or somebody's captured memory dump, and none of those
   * announce themselves by their extension. The scanner is shared with the
   * test suite so the gate and the contracts cannot disagree. */
  const { scanRepository, summarise, unexplainedAllowlistEntries } = await import('./hygiene.mjs');

  /* Everything that would be published, which is the tracked files plus the
   * untracked ones git is not ignoring. Listing only tracked files would have
   * scanned nothing at all while this service is not yet committed, and a
   * stage that checked nothing must never report as having passed. */
  const listed = await run('git', ['ls-files', '--cached', '--others', '--exclude-standard']);
  expectSuccess(listed, 'git ls-files');
  /* Third-party trees are their own projects with their own review. Scanning
   * them would bury a real finding in thousands of lines of someone else's
   * test fixtures. */
  const vendored = /^(?:node_modules|backend\/vendor|\.toolchains|dist|coverage)\//;
  const paths = listed.output.split('\n').map((line) => line.trim()).filter(Boolean).filter((path) => !vendored.test(path));
  if (!paths.length) throw new Error('No files were listed to scan, so nothing was checked');

  const read = async (path) => {
    try { return await readFile(join(root, path), 'utf8'); }
    catch { return null; }
  };
  const repository = await scanRepository(paths, read);

  /* The built bundle as well as the source, because a value can reach the
   * published output through an environment variable or an inlined import and
   * never appear in a tracked file at all. */
  let bundled = { findings: [], scanned: 0 };
  try {
    const listing = await run('find', [join(root, 'dist'), '-type', 'f']);
    if (listing.code === 0) {
      const distFiles = listing.output.split('\n').map((line) => line.trim()).filter(Boolean);
      bundled = await scanRepository(
        distFiles.map((path) => path.slice(root.length + 1)),
        async (path) => { try { return await readFile(join(root, path), 'utf8'); } catch { return null; } },
      );
    }
  } catch { /* the build stage reports a missing dist; this stage does not */ }

  const findings = [...repository.findings, ...bundled.findings, ...unexplainedAllowlistEntries()];
  if (findings.length) {
    const lines = summarise(findings);
    throw new Error(`${findings.length} hygiene finding(s): ${lines.slice(0, 6).join(' | ')}${lines.length > 6 ? ` | and ${lines.length - 6} more` : ''}`);
  }
  return { detail: `${repository.scanned} of ${paths.length} project files and ${bundled.scanned} built files carry no firmware, capture or credential` };
});

await stage('smoke', async () => {
  const chromium = await firstExisting(CHROMIUM_CANDIDATES);
  if (!chromium) return { skipped: true, reason: env.CHROMIUM_PATH ? `CHROMIUM_PATH names ${env.CHROMIUM_PATH}, which is not there` : 'no Chromium binary found; set CHROMIUM_PATH to include the browser smoke' };

  const port = Number(env.CI_SMOKE_PORT ?? 8137);
  const devtoolsPort = Number(env.CI_SMOKE_DEVTOOLS_PORT ?? 9137);
  const dist = join(root, 'dist');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
  /* The application is served under the same headers the container serves it
   * under, read from the nginx snippet rather than restated here. A content
   * security policy is only worth anything if the application actually runs
   * under it, and a policy that is never exercised fails in the least useful
   * way: everything works in development, where no policy is applied, and the
   * first person to load the deployed build gets a blank page. */
  const { headerPairs } = await import('./securityHeaders.mjs');
  const securityHeaders = headerPairs(await readFile(join(root, 'docker', 'security-headers.conf'), 'utf8'));

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://x');
    const path = join(dist, normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''));
    const stream = createReadStream(path);
    for (const [name, value] of securityHeaders) response.setHeader(name, value);
    stream.once('open', () => {
      response.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
      response.setHeader('Service-Worker-Allowed', '/');
      stream.pipe(response);
    });
    /* Anything the build does not contain is the single-page document, which is
     * how the workbench is served in the container too. */
    stream.once('error', () => {
      response.setHeader('Content-Type', 'text/html');
      const index = createReadStream(join(dist, 'index.html'));
      index.once('error', () => { response.statusCode = 404; response.end('not built'); });
      index.pipe(response);
    });
  });
  await new Promise((ready, failed) => { server.once('error', failed); server.listen(port, '127.0.0.1', ready); });

  const userDataDir = join(root, `.ci-smoke-${devtoolsPort}`);

  /*
   * Chromium hands its command line to an existing instance when one already
   * holds the same profile, and then exits. The debugging port answers either
   * way, so a gate that only asks whether the port responds will happily
   * measure a browser it did not start — one that may have been running for
   * days, carrying the storage of every previous run.
   *
   * That is not hypothetical: a browser left behind by an earlier run was found
   * still holding this port a day later. It made the first-render control count
   * read three times higher than the workbench actually renders, because the
   * page it measured had a project already open, and it eventually hung the
   * gate outright.
   *
   * So an already-answering port is refused before anything is launched, and
   * the refusal says how to clear it.
   */
  const answering = await fetch(`http://127.0.0.1:${devtoolsPort}/json/version`, { signal: AbortSignal.timeout(2000) })
    .then((response) => response.ok)
    .catch(() => false);
  if (answering) {
    throw new Error(`A browser is already answering on port ${devtoolsPort}. It is not this run's, and measuring it would report whatever state it has accumulated rather than this build. Stop it and remove ${userDataDir}, or set CI_SMOKE_DEVTOOLS_PORT to a free port.`);
  }
  /*
   * Any profile left by an earlier run is removed rather than reused, so the
   * scan always measures a browser that has seen nothing before. Headless
   * Chromium's children can still be writing as it shuts down, so a profile
   * sometimes survives its own teardown; that is harmless as long as it is
   * cleared here, and it is only harmless because this refuses to continue when
   * it cannot be.
   */
  await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  if (existsSync(userDataDir)) {
    throw new Error(`The browser profile ${userDataDir} could not be removed, so this run could not start from a browser that has seen nothing. Remove it and run the gate again.`);
  }

  let socket = null;
  const browser = spawn(chromium, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--remote-allow-origins=*', '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${devtoolsPort}`, `--user-data-dir=${userDataDir}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'] });

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (op, what, limit = 60_000) => {
    const deadline = Date.now() + limit;
    let last;
    while (Date.now() < deadline) {
      try { const value = await op(); if (value) return value; } catch (error) { last = error; }
      await delay(200);
    }
    throw new Error(`${what} timed out${last ? `: ${last.message}` : ''}`);
  };

  try {
    await until(async () => {
      /* If the browser this run started has gone, whatever is answering the
       * port belongs to something else. */
      if (browser.exitCode !== null) throw new Error(`the browser exited with code ${browser.exitCode} before it accepted a connection, which is what Chromium does when another instance already holds ${userDataDir}`);
      return (await fetch(`http://127.0.0.1:${devtoolsPort}/json/version`)).ok;
    }, 'the browser to accept connections', 30_000);
    const target = await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/new?${encodeURIComponent(`http://127.0.0.1:${port}`)}`, { method: 'PUT' })).json();
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((open, failed) => { socket.addEventListener('open', open, { once: true }); socket.addEventListener('error', failed, { once: true }); });

    let sequence = 0;
    const pending = new Map();
    const errors = [];
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) {
        if (message.method === 'Runtime.exceptionThrown') errors.push(message.params?.exceptionDetails?.text ?? 'uncaught exception');
        if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') errors.push(message.params.args?.map((argument) => argument.value ?? argument.description).join(' '));
        /* A blocked resource is reported here and nowhere else, so without
         * this a policy that breaks the application would pass silently. */
        if (message.method === 'Log.entryAdded' && message.params?.entry?.source === 'security') errors.push(`security: ${message.params.entry.text}`);
        return;
      }
      const promise = pending.get(message.id);
      if (!promise) return;
      pending.delete(message.id);
      message.error ? promise.reject(new Error(message.error.message)) : promise.resolve(message.result);
    });
    const call = (method, params = {}) => {
      const id = ++sequence;
      return new Promise((resolveCall, rejectCall) => { pending.set(id, { resolve: resolveCall, reject: rejectCall }); socket.send(JSON.stringify({ id, method, params })); });
    };
    const evaluate = async (expression) => {
      const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };

    await call('Page.enable');
    await call('Runtime.enable');
    await call('Log.enable');
    await until(() => evaluate('document.readyState === "complete" && !!document.querySelector(".app-shell")'), 'the workbench to render');
    const workspaces = await evaluate(`[...document.querySelectorAll('button')].map((button) => button.textContent.trim()).filter(Boolean).length`);
    if (!workspaces) throw new Error('The workbench rendered no controls');
    await delay(2000);

    /* Reflow and zoom, in the same page. WCAG 1.4.10 asks that at 320 CSS
     * pixels of width — which is also what 400% zoom on a 1280-pixel display
     * produces — the page does not require scrolling in two directions, and
     * that nothing is put out of reach. It is checked here rather than by hand
     * because a layout regression is invisible until someone is using a small
     * window, and by then it has shipped. */
    const MEASURE = `(() => {
      const doc = document.documentElement;
      const viewport = doc.clientWidth;
      /* Chrome's own visibility test, which accounts for a closed <details>
       * as well as display, visibility and opacity. Content a person cannot
       * see is not content that has to fit. */
      const shown = (node) => typeof node.checkVisibility === 'function'
        ? node.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })
        : getComputedStyle(node).display !== 'none';
      /* A control inside a horizontally scrollable strip is reachable by
       * scrolling it, which is what a tab rail is for. */
      const scrolls = (node) => {
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          if (/auto|scroll/.test(getComputedStyle(parent).overflowX)) return true;
        }
        return false;
      };
      const overflowing = [];
      for (const node of document.querySelectorAll('body *')) {
        if (!shown(node)) continue;
        const box = node.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) continue;
        if ((box.left > viewport + 1 || box.right > viewport + 1) && !scrolls(node)) {
          overflowing.push(node.tagName.toLowerCase() + '.' + String(node.className || '').slice(0, 40));
        }
      }
      const controls = [...document.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')]
        .filter((node) => shown(node) && !node.disabled);
      const clipped = controls.filter((node) => {
        const box = node.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) return false;
        if (box.left < viewport && box.right > 0) return false;
        return !scrolls(node);
      }).map((node) => (node.getAttribute('aria-label') || node.textContent || node.tagName).trim().slice(0, 40));
      /* One pixel of tolerance: sub-pixel rounding is not a reflow bug. */
      return { viewport, horizontal: Math.max(0, doc.scrollWidth - viewport - 1), overflowing: overflowing.slice(0, 6), overflowingCount: overflowing.length, controls: controls.length, clipped: clipped.slice(0, 6), clippedCount: clipped.length };
    })()`;

    const SIZES = [
      { name: '1440x900', width: 1440, height: 900 },
      { name: '900x700', width: 900, height: 700 },
      { name: '700x600', width: 700, height: 600 },
      { name: '320x480 (reflow, and 400% zoom of 1280)', width: 320, height: 480 },
      { name: '640x512 (200% zoom of 1280x1024)', width: 640, height: 512 },
    ];
    for (const size of SIZES) {
      await call('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 0, mobile: false });
      await delay(400);
      const measured = await evaluate(MEASURE);
      if (measured.horizontal > 0) throw new Error(`At ${size.name} the page scrolls horizontally by ${measured.horizontal}px`);
      if (measured.overflowingCount > 0) throw new Error(`At ${size.name} ${measured.overflowingCount} boxes reach past the viewport with nothing to scroll them: ${measured.overflowing.join(', ')}`);
      if (measured.clippedCount > 0) throw new Error(`At ${size.name} ${measured.clippedCount} controls are out of reach: ${measured.clipped.join(', ')}`);
      if (measured.controls === 0) throw new Error(`At ${size.name} the workbench rendered no controls`);
    }
    await call('Emulation.clearDeviceMetricsOverride');

    /* Accessibility, across every workspace a person can open rather than the
     * one that happens to be showing. An automated scan cannot decide whether
     * a name is meaningful or whether a reading order makes sense; what it can
     * decide is checked here, and what it cannot stays in the manual matrix.
     * The rules are shared with the test suite rather than restated. */
    const { SCAN, TEXT_SPACING, FOCUS_VISIBILITY, REDUCED_MOTION, FORCED_COLOURS, REDUCED_TRANSPARENCY, KEYBOARD_REACHABILITY, POINTER_ALTERNATIVES, VISUAL_ALTERNATIVES, summarise } = await import('./accessibilityRules.mjs');
    /* Every workspace the tab strip actually offers, read from the page rather
     * than listed here, so a new one is scanned the day it is added. Search
     * opens a modal over whatever is behind it and is scanned in place. */
    /* A sample project is opened first. Most of the workbench has nothing to
     * show until something is loaded — the asset editors, the disassembly, the
     * test list — so scanning the empty state would report a clean page while
     * leaving the surfaces that carry the most information unmeasured. This
     * drives the real dialog rather than seeding storage, so the code that
     * opens a project is exercised on the way. */
    const opened = await evaluate(`(() => {
      const palette = document.querySelector('button[aria-label="Open command palette"]');
      if (!palette) return 'no command palette';
      palette.click();
      return true;
    })()`);
    if (opened !== true) throw new Error(`Could not open a sample project for the scan: ${opened}`);
    await delay(300);
    await evaluate(`(() => {
      const input = document.querySelector('.command-palette input[role=combobox]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'sample');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const row = [...document.querySelectorAll('.command-palette-results [role=option]')].find((option) => option.textContent.includes('Start a project'));
      if (row) row.click();
      return true;
    })()`);
    const sampleOpened = await until(async () => evaluate(`(() => {
      const start = document.querySelector('.start-project-dialog');
      if (!start) return false;
      const open = [...start.querySelectorAll('button')].find((button) => /^Open /.test(button.textContent.trim()));
      if (!open) return false;
      open.click();
      return true;
    })()`), 'the sample catalogue', 40_000);
    if (!sampleOpened) throw new Error('The sample catalogue offered nothing to open');
    await until(() => evaluate(`!document.querySelector('.start-project-dialog')`), 'the start dialog to close', 20_000);
    await delay(600);

    /* The project is built before anything is scanned.
     *
     * Half the surfaces that carry the most information do not exist until a
     * build has produced something to show: the disassembly, the memory and
     * size maps, the artifact documents and the symbol list are all rendered
     * from a build result, and scanning before one exists reports a clean page
     * while leaving them unmeasured. That was the whole of what kept A11Y-902
     * open — coverage, not conformance.
     *
     * The build is driven through the real command rather than by seeding a
     * result, so the path a person takes is the path that is scanned. */
    await evaluate(`(() => {
      const tab = [...document.querySelectorAll('.modebar .mode-tab')].find((candidate) => candidate.textContent.trim() === 'Build targets');
      if (tab) tab.click();
      return true;
    })()`);
    await delay(500);
    const built = await evaluate(`(() => {
      const build = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Build');
      if (!build) return 'no build control on the Build targets workspace';
      if (build.disabled) return 'the build control is disabled';
      build.click();
      return true;
    })()`);
    if (built !== true) {
      /* Named rather than skipped. A scan that quietly did not build would go
       * on reporting the smaller surface count as though it were everything. */
      throw new Error(`The scan could not start a build, so the surfaces that only exist after one would not have been measured: ${built}`);
    }
    /* Waited for the artifact itself rather than for words on the page. A
     * regular expression over the body text matches the button that started
     * the build, so it would report success the instant it was clicked. */
    const buildFinished = await until(async () => evaluate(`(() => {
      /* The byte inspector and the generated documents exist only once a build
       * has produced something, so either one is proof there is an artifact. */
      return Boolean(document.querySelector('[aria-label="Build artifact byte inspector"], [aria-label="Generated artifact documents"]'));
    })()`), 'the sample project to build', 60_000).catch(() => false);
    if (!buildFinished) throw new Error('The sample project produced no artifact within a minute, so the surfaces that only exist after a build were not scanned');
    await delay(500);

    /* The project explorer holds the only draggable surface, so it is opened
     * before scanning. A panel that is closed while the page is measured takes
     * everything inside it out of the scan without saying so. */
    await evaluate(`(() => {
      const rail = document.querySelector('button[aria-label="Project explorer"]');
      if (rail && !document.querySelector('.explorer-panel .tree')) rail.click();
      return true;
    })()`);
    await delay(400);

    const offered = await evaluate(`[...document.querySelectorAll('.modebar .mode-tab')].map((tab) => tab.textContent.trim()).filter(Boolean)`);
    if (!offered.length) throw new Error('The workspace tab strip offered nothing, so nothing was scanned for accessibility');
    const accessibility = [];
    /* The drag-alternative rule can only say something if something draggable
     * was actually on the page while it ran. A check that passes because it
     * found nothing to check is not a passing check. */
    let draggableSeen = 0;
    let drawingSeen = 0;
    const visited = [];
    for (const workspace of offered) {
      const opened = await evaluate(`(() => {
        const tab = [...document.querySelectorAll('.modebar .mode-tab')].find((candidate) => candidate.textContent.trim() === ${JSON.stringify(workspace)});
        if (!tab) return false;
        tab.click();
        return true;
      })()`);
      if (!opened) continue;
      await delay(500);
      visited.push(workspace);
      for (const finding of await evaluate(SCAN)) accessibility.push({ ...finding, detail: `${finding.detail} (in ${workspace})` });
      /* Operating the workspace without a pointer, in the workspace itself
       * rather than only on whichever one happens to be showing. */
      draggableSeen = Math.max(draggableSeen, await evaluate(`document.querySelectorAll('[draggable="true"]').length`));
      drawingSeen = Math.max(drawingSeen, await evaluate(`document.querySelectorAll('canvas, [role="img"]').length`));
      for (const expression of [KEYBOARD_REACHABILITY, POINTER_ALTERNATIVES, VISUAL_ALTERNATIVES]) {
        for (const finding of await evaluate(expression)) {
          accessibility.push({ rule: 'keyboard', criterion: '2.1.1', element: finding.element, detail: `${finding.detail} (in ${workspace})` });
        }
      }
      /* A workspace that opened a dialog must not hide the next one. */
      await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    }

    if (!draggableSeen) throw new Error('No draggable element was on screen during the scan, so the keyboard-alternative rule checked nothing');
    if (!drawingSeen) throw new Error('No canvas or image role was on screen during the scan, so the visual-alternative rule checked nothing');
    if (visited.length < offered.length) throw new Error(`Only ${visited.length} of ${offered.length} workspaces could be opened for the accessibility scan`);
    if (accessibility.length) {
      const lines = summarise(accessibility);
      throw new Error(`${accessibility.length} accessibility finding(s) across ${visited.length} workspaces: ${lines.slice(0, 4).join(' | ')}`);
    }

    /* The conditions a person can turn on, checked with them turned on. A
     * stylesheet that declares support for one of these looks correct in the
     * source and can still do nothing on screen, so each is emulated and the
     * result measured rather than read. */
    const conditions = [
      { name: 'text spacing (WCAG 1.4.12)', media: [], expression: TEXT_SPACING },
      { name: 'focus visibility (WCAG 2.4.7)', media: [], expression: FOCUS_VISIBILITY },
      { name: 'the reduced-motion preference (WCAG 2.3.3 is AAA; honouring the preference is a product commitment)', media: [{ name: 'prefers-reduced-motion', value: 'reduce' }], expression: REDUCED_MOTION },
      { name: 'forced colours (WCAG 1.4.1)', media: [{ name: 'forced-colors', value: 'active' }], expression: FORCED_COLOURS },
      /* The recorded position is that this product carries no meaning in
       * translucency, so there is nothing to soften when somebody asks for
       * less of it. A position is not a check: this looks, and if it ever finds
       * something the position is wrong rather than the finding. */
      { name: 'reduced transparency (the product claims no meaningful translucency)', media: [{ name: 'prefers-reduced-transparency', value: 'reduce' }], expression: REDUCED_TRANSPARENCY },
    ];
    for (const condition of conditions) {
      await call('Emulation.setEmulatedMedia', { features: condition.media });
      await delay(300);
      const failures = await evaluate(condition.expression);
      if (failures.length) {
        const lines = failures.slice(0, 4).map((failure) => `${failure.element} ${failure.detail}`);
        await call('Emulation.setEmulatedMedia', { features: [] });
        throw new Error(`${failures.length} ${condition.name} failure(s): ${lines.join(' | ')}`);
      }
    }
    await call('Emulation.setEmulatedMedia', { features: [] });

    if (errors.length) throw new Error(`The workbench reported ${errors.length} console error(s): ${errors.slice(0, 3).join(' | ')}`);
    return { detail: `${workspaces} controls under the shipped security headers, no console or policy errors, reflow clean at ${SIZES.length} sizes down to 320px, ${visited.length} workspaces scanned after a real build with no accessibility finding, ${conditions.length} user conditions honoured, ${drawingSeen} drawing surfaces with alternatives` };
  } finally {
    /* Every handle opened here is closed here. A gate that printed its verdict
     * and then sat with an open socket would hang a pipeline until its timeout
     * rather than finishing. */
    socket?.close();
    /* Waited for rather than signalled and forgotten. A browser that is still
     * shutting down is still writing to its profile, so removing the directory
     * underneath it leaves most of it behind — which is how one of these came
     * to be holding the port a day later. */
    if (browser.exitCode === null) {
      await new Promise((exited) => {
        const escalate = setTimeout(() => browser.kill('SIGKILL'), 5_000);
        browser.once('exit', () => { clearTimeout(escalate); exited(); });
        browser.kill('SIGTERM');
      });
    }
    await new Promise((closed) => server.close(closed));
    /* Best effort: what makes the next run trustworthy is that it clears this
     * before launching, not that this succeeded. */
    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
});

/* ---- verdict -------------------------------------------------------------- */

/* A filter that matches nothing must not read as a pass. */
if (!results.length) { console.error(only ? `No gate stage matches "${only}".` : 'The gate ran no stages.'); exit(2); }

const failed = results.filter((result) => result.status === 'failed');
const skipped = results.filter((result) => result.status === 'skipped');
const report = {
  service: 'webide-acorn',
  stages: results,
  passed: results.filter((result) => result.status === 'passed').length,
  failed: failed.length,
  skipped: skipped.length,
};
await mkdir(join(root, 'ci'), { recursive: true });
await writeFile(join(root, 'ci', 'gate-report.json'), `${JSON.stringify(report, null, 2)}\n`);

console.log('');
console.log(`${report.passed} passed · ${report.failed} failed · ${report.skipped} skipped`);
if (failed.length) { console.error('Gate failed.'); exit(1); }
if (skipped.length && !allowSkips) { console.error(`Gate incomplete: ${skipped.map((result) => result.name).join(', ')} did not run. Pass --allow-skips to accept that.`); exit(2); }
console.log('Gate passed.');
exit(0);

}
