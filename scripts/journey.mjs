#!/usr/bin/env node
/*
 * Walks the authoring journey once per machine, in the built workbench, in a
 * real browser — and fails on anything that looks like a crash, a policy
 * violation, or a refusal nobody meant.
 *
 * The goal this exists for is not "each feature works somewhere". It is that a
 * person can go from an empty workbench to a distributable game for one of
 * these machines without leaving it, and without being stopped by something the
 * product should have handled. Those are different claims, and only the second
 * one is worth anything to somebody who wants to write a game.
 *
 * Walking it by hand first was worth doing, and this exists because of what
 * that found: an assembler that gave every machine the BBC's operating-system
 * vocabulary, four machines with no starter project at all, and an Electron
 * whose Run printed nothing and reported no error. Every one of those passed
 * the whole suite. None of them survives this.
 *
 * What is checked here needs no firmware, because firmware cannot be committed:
 * choosing a machine, starting from its template, building it, and packaging
 * the result to the medium that machine shipped with. The steps that need a
 * real machine — running, debugging, booting the media — are measured by the
 * scripts beside this one against a firmware vault, and frozen where the
 * always-running tests can hold the product to them.
 *
 * A machine with no engine here is walked too, and asserted to say so. That is
 * the point of the B+ row: the workbench must refuse it for the reason that is
 * true, rather than crashing or reporting missing firmware.
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, normalize, extname, resolve } from 'node:path';
import { argv, env, exit } from 'node:process';

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm',
};

/**
 * The five machines the goal names, and what each should be able to reach.
 *
 * `packages` is the medium the workbench should offer for that machine. A
 * machine with `runnable: false` is expected to refuse, and the refusal has to
 * name the obstacle rather than blame a missing file.
 */
export const JOURNEYS = Object.freeze([
  Object.freeze({ machineId: 'atom', label: 'Acorn Atom', template: 'atom-text-6502', runnable: true, packages: 'cassette' }),
  Object.freeze({ machineId: 'electron', label: 'Acorn Electron', template: 'electron-mode6-6502', runnable: true, packages: 'cassette' }),
  Object.freeze({ machineId: 'bbc-b', label: 'BBC Model B', template: 'bbc-b-mode7-6502', runnable: true, packages: 'cassette' }),
  Object.freeze({ machineId: 'bbc-bplus', label: 'BBC Model B+', template: null, runnable: false, packages: null }),
  Object.freeze({ machineId: 'master', label: 'BBC Master', template: 'master-mode7-6502', runnable: true, packages: 'cassette' }),
]);

/* Driven in the page rather than from here: one round trip per journey instead
 * of one per click, and the assertions sit beside the state they are about. */
const WALK = `(async (machineId, templateId, expectRunnable) => {
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));
  const settle = async (predicate, what, tries = 60) => {
    for (let i = 0; i < tries; i += 1) { if (predicate()) return true; await wait(100); }
    throw new Error('Timed out waiting for ' + what);
  };
  const byLabel = (label) => [...document.querySelectorAll('[aria-label], button, [title]')]
    .find((node) => (node.getAttribute('aria-label') ?? node.getAttribute('title') ?? node.textContent ?? '').trim() === label);
  const clickText = (text) => {
    const node = [...document.querySelectorAll('button')].find((button) => (button.textContent ?? '').trim() === text);
    if (!node) throw new Error('No control reads ' + JSON.stringify(text));
    node.click();
    return node;
  };
  const setSelect = (label, value) => {
    const select = document.querySelector('select[aria-label="' + label + '"]');
    if (!select) throw new Error('No selector labelled ' + JSON.stringify(label));
    if (![...select.options].some((option) => option.value === value)) {
      throw new Error(label + ' offers no ' + JSON.stringify(value) + '; it offers ' + [...select.options].map((option) => option.value).join(', '));
    }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return select;
  };
  const notices = () => [...document.querySelectorAll('[role="status"], .honest-note, .notice')].map((node) => node.textContent.trim()).filter(Boolean);
  const steps = [];
  const record = (name, detail) => steps.push({ name, detail });

  /* Choosing the machine. */
  const configButton = byLabel('Target configuration');
  if (configButton && !document.querySelector('select[aria-label="Acorn system"]')) configButton.click();
  await settle(() => !!document.querySelector('select[aria-label="Acorn system"]'), 'the target configuration panel');
  setSelect('Acorn system', machineId);
  await wait(400);
  record('choose the machine', document.querySelector('select[aria-label="Acorn system"]').value);

  /* Turn on the interface the medium needs, the way a person would: the
   * capability checkboxes are how a machine is configured, and a cassette
   * writer is offered for a machine whose cassette interface is enabled. */
  const enableCapability = (title) => {
    const item = [...document.querySelectorAll('.capability-item')]
      .find((node) => (node.querySelector('strong')?.textContent ?? '').trim() === title);
    if (!item) return null;
    const box = item.querySelector('input[type="checkbox"]');
    if (box.disabled) return 'disabled';
    if (!box.checked) box.click();
    return box.checked ? 'enabled' : 'refused';
  };

  const romSelect = document.querySelector('select[aria-label="ROM and operating system"]');
  const romOptions = [...romSelect.options].map((option) => ({ value: option.value, label: option.textContent.trim() }));
  record('firmware offered', romOptions.map((option) => option.label).join(' | '));

  if (!expectRunnable) {
    /* Every firmware this machine offers has to explain itself rather than
     * looking like something the person forgot to supply. */
    const explained = [];
    for (const option of romOptions) {
      setSelect('ROM and operating system', option.value);
      await wait(300);
      const said = notices().find((text) => /no emulator|no .* model|models no|jsbeeb/i.test(text));
      if (!said) throw new Error(option.label + ' is offered with no explanation of why it cannot run');
      if (/supply|upload|import/i.test(said)) throw new Error(option.label + ' blames a missing file: ' + said);
      explained.push(said.slice(0, 120));
    }
    record('refusal', explained.join(' | '));
    return JSON.stringify({ machineId, steps, refused: true });
  }

  /* Starting from the machine's own template. */
  byLabel('Start from a sample or existing codebase').click();
  await settle(() => !!document.querySelector('[aria-label="Start a project"]'), 'the start dialog');
  clickText('Templates');
  await wait(300);
  const cards = [...document.querySelectorAll('[aria-label="Start a project"] .template-head strong')].map((node) => node.textContent.trim());
  record('templates offered', cards.join(' | '));
  if (!cards.length) throw new Error('This machine is offered no template to start from');
  const start = [...document.querySelectorAll('[aria-label="Start a project"] button')].find((button) => button.textContent.trim() === 'Start from this template');
  if (!start) throw new Error('The template cannot be started');
  start.click();
  await settle(() => !document.querySelector('[aria-label="Start a project"]'), 'the start dialog to close');
  await wait(600);

  /* The medium is chosen after the project exists, because opening a template
   * sets the machine's configuration and would otherwise undo the choice. */
  const configButtonAgain = byLabel('Target configuration');
  if (configButtonAgain && !document.querySelector('.capability-item')) configButtonAgain.click();
  await settle(() => !!document.querySelector('.capability-item'), 'the capability list');
  const cassetteState = enableCapability('Cassette interface');
  record('cassette interface', cassetteState ?? 'this machine has none');
  if (cassetteState !== 'enabled') throw new Error('The cassette interface could not be enabled: ' + String(cassetteState));
  await wait(400);

  /* Building it. */
  const build = [...document.querySelectorAll('button[aria-label^="Build target"]')][0];
  if (!build) throw new Error('There is no control to build the target that was just opened');
  if (build.disabled) throw new Error('The template opened with a build target this build refuses: ' + build.getAttribute('aria-label'));
  build.click();
  await settle(() => notices().some((text) => /built|bytes|artifact/i.test(text)), 'the build to finish', 150);
  const built = notices().filter((text) => /built|bytes|artifact/i.test(text));
  record('build', built.join(' | ').slice(0, 200));
  if (built.some((text) => /error|failed/i.test(text))) throw new Error('The template did not build: ' + built.join(' | '));

  /* Packaging it to the medium the machine shipped with. */
  clickText('Media');
  await wait(600);
  const packageButtons = [...document.querySelectorAll('button')].filter((button) => button.textContent.trim() === 'Package current build');
  record('media controls', packageButtons.length + ' packaging control(s)');
  const cassette = [...document.querySelectorAll('section[aria-label="Write a cassette image from the current build"] button')];
  if (!cassette.length) throw new Error('This machine is offered no way to write a cassette, though its profile enables one');
  cassette.find((button) => button.textContent.trim() === 'Package current build').click();
  await wait(400);
  const status = document.querySelector('section[aria-label="Write a cassette image from the current build"] [role="status"]').textContent.trim();
  record('cassette', status);
  if (!/cassette/i.test(status) || !/block/i.test(status)) throw new Error('Writing a cassette did not produce one: ' + status);

  return JSON.stringify({ machineId, steps, refused: false });
})`;

async function serve(dist, port) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://x');
    const path = join(dist, normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''));
    const stream = createReadStream(path);
    stream.once('open', () => {
      response.setHeader('Content-Type', TYPES[extname(path)] ?? 'application/octet-stream');
      stream.pipe(response);
    });
    stream.once('error', () => {
      response.setHeader('Content-Type', 'text/html');
      const index = createReadStream(join(dist, 'index.html'));
      index.once('error', () => { response.statusCode = 404; response.end('not built'); });
      index.pipe(response);
    });
  });
  await new Promise((ready, failed) => { server.once('error', failed); server.listen(port, '127.0.0.1', ready); });
  return server;
}

/** Walk every journey, and give back what each machine did. */
export async function walkJourneys(dist, { chromium, port = 8139, journeys = JOURNEYS } = {}) {
  const server = await serve(resolve(dist), port);
  const userDataDir = `/tmp/8bit-net-journey-${process.pid}`;
  const browser = spawn(chromium, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader', '--remote-allow-origins=*', '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`, '--no-first-run', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  const devtools = await new Promise((done, failed) => {
    browser.stderr.on('data', (chunk) => {
      stderr += chunk;
      const found = /ws:\/\/127\.0\.0\.1:(\d+)\//.exec(stderr);
      if (found) done(Number(found[1]));
    });
    setTimeout(() => failed(new Error(`the browser published no DevTools endpoint: ${stderr}`)), 30_000);
  });
  const targets = await (await fetch(`http://127.0.0.1:${devtools}/json/list`)).json();
  const socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((open) => socket.addEventListener('open', open));

  let sequence = 0;
  const pending = new Map();
  let complaints = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) { pending.get(message.id)?.(message); pending.delete(message.id); return; }
    if (message.method === 'Runtime.exceptionThrown') complaints.push(`exception: ${message.params?.exceptionDetails?.text ?? 'uncaught'}`);
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
      complaints.push(`console: ${message.params.args?.map((argument) => argument.value ?? argument.description).join(' ')}`);
    }
    /* A blocked resource is reported here and nowhere else, so without this a
     * policy that breaks the workbench would pass silently. */
    if (message.method === 'Log.entryAdded' && message.params?.entry?.source === 'security') complaints.push(`security: ${message.params.entry.text}`);
  });
  const call = (method, params = {}) => new Promise((done) => {
    const id = ++sequence;
    pending.set(id, done);
    socket.send(JSON.stringify({ id, method, params }));
  });

  const results = [];
  try {
    await call('Page.enable');
    await call('Runtime.enable');
    await call('Log.enable');
    for (const journey of journeys) {
      /* A fresh page per machine: a journey has to start where a person starts,
       * not where the last one left the workbench. */
      complaints = [];
      await call('Page.navigate', { url: `http://127.0.0.1:${port}/?journey=${journey.machineId}` });
      const ready = await call('Runtime.evaluate', {
        expression: 'new Promise((done) => { const check = () => (document.querySelector(".app-shell") ? done(true) : setTimeout(check, 100)); check(); })',
        awaitPromise: true, returnByValue: true,
      });
      if (!ready.result?.result?.value) throw new Error(`${journey.label}: the workbench never rendered`);
      const outcome = await call('Runtime.evaluate', {
        expression: `${WALK}(${JSON.stringify(journey.machineId)}, ${JSON.stringify(journey.template)}, ${journey.runnable})`,
        awaitPromise: true, returnByValue: true,
      });
      if (outcome.result?.exceptionDetails) {
        const detail = outcome.result.exceptionDetails.exception?.description ?? outcome.result.exceptionDetails.text;
        results.push({ ...journey, ok: false, failure: String(detail).split('\n')[0], complaints });
        continue;
      }
      const walked = JSON.parse(outcome.result.result.value);
      results.push({ ...journey, ok: complaints.length === 0, failure: complaints.length ? 'the page complained' : null, steps: walked.steps, complaints });
    }
  } finally {
    socket.close();
    browser.kill('SIGKILL');
    server.close();
  }
  return results;
}

async function main() {
  const dist = argv[2] ?? 'dist';
  const chromium = env.CHROMIUM_PATH ?? '/usr/bin/google-chrome';
  const results = await walkJourneys(dist, { chromium });
  let failed = 0;
  for (const result of results) {
    console.log(`${result.ok ? 'walked ' : 'STOPPED'} ${result.label}`);
    for (const step of result.steps ?? []) console.log(`    ${step.name}: ${step.detail}`);
    for (const complaint of result.complaints ?? []) console.log(`    complaint: ${complaint}`);
    if (result.failure) { console.log(`    ${result.failure}`); failed += 1; }
  }
  console.log(`${results.length - failed} of ${results.length} journeys walked end to end`);
  if (failed) exit(1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) await main();
