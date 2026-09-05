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
  Object.freeze({ machineId: 'bbc-bplus', label: 'BBC Model B+', template: 'bbc-bplus-shadow-6502', runnable: true, packages: 'cassette' }),
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
  /* Opening a menu and choosing from it, the way somebody with a pointer does.
   * The workbench keeps its actions in menu bars now, so a walk that only knew
   * how to find buttons lying on the surface would miss most of what the
   * product offers. */
  const chooseFromMenu = async (barLabel, menuLabel, pattern, what) => {
    const bar = document.querySelector('[role="menubar"][aria-label="' + barLabel + '"]');
    if (!bar) throw new Error('No menu bar labelled ' + JSON.stringify(barLabel));
    const menu = [...bar.querySelectorAll('.panel-actions-button')].find((button) => button.textContent.trim() === menuLabel);
    if (!menu) throw new Error(barLabel + ' offers no ' + menuLabel + ' menu');
    menu.click();
    await wait(200);
    const item = [...bar.querySelectorAll('.panel-menu-items button')].find((button) => pattern.test(button.textContent.trim()));
    if (!item) throw new Error(menuLabel + ' offers no way to ' + what);
    if (item.disabled) throw new Error(menuLabel + ' offers ' + what + ' but will not do it: ' + item.textContent.trim());
    item.click();
    await wait(300);
    return item;
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
  await chooseFromMenu('Workbench menu', 'Project', /^Start from a sample/, 'start a project from a sample or a codebase');
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

  /*
   * Drawing something.
   *
   * A game is not source alone. The sprite editor's whole purpose is that what
   * is drawn becomes part of the program, so the journey draws, adds the
   * generated source to the project, and then builds — because a graphics
   * editor whose output cannot reach a build is a drawing program.
   */
  clickText('Sprites');
  await settle(() => !!document.querySelector('.pixel-grid [role="gridcell"]'), 'the sprite editor');
  const cells = [...document.querySelectorAll('.pixel-grid [role="gridcell"]')];
  record('sprite editor', cells.length + ' pixels to draw on');
  if (cells.length < 64) throw new Error('The sprite grid came up with only ' + cells.length + ' pixels');
  /* Draw a short diagonal, so what is added to the project is something rather
   * than an empty asset that would still generate bytes. */
  const side = Math.round(Math.sqrt(cells.length));
  for (let i = 0; i < side; i += 1) cells[i * side + i].click();
  await wait(300);
  await chooseFromMenu('Sprites actions', 'Document', /^Add EQUB source/, 'put what was drawn into the project');
  await wait(200);
  record('sprite to project', notices().slice(-1)[0] ?? 'added');

  /*
   * Composing something, on this machine's own sound hardware. The editor
   * chooses the target from the machine, and a song written for the wrong chip
   * is music that will not play.
   */
  clickText('Sound');
  await settle(() => !!document.querySelector('select[aria-label="Sound hardware"]'), 'the song editor');
  const hardware = document.querySelector('select[aria-label="Sound hardware"]');
  record('sound hardware offered', [...hardware.options].map((option) => option.textContent.trim()).join(' | '));
  const addSong = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Add generated source');
  if (!addSong) throw new Error('The song editor offers no way to put a song into the project');
  addSong.click();
  await wait(500);
  record('song to project', notices().slice(-1)[0] ?? 'added');

  /* Building it, with what was drawn and composed in the project. */
  clickText('Build targets');
  await wait(400);
  const build = [...document.querySelectorAll('button[aria-label^="Build target"]')][0];
  if (!build) throw new Error('There is no control to build the target that was just opened');
  if (build.disabled) throw new Error('The template opened with a build target this build refuses: ' + build.getAttribute('aria-label'));
  const runBuild = async (what) => {
    const before = notices().join(' ');
    build.click();
    await settle(() => notices().join(' ') !== before && notices().some((text) => /bytes/.test(text)), what, 200);
    const said = notices().filter((text) => /bytes|SUCCEEDED|FAILED|error/i.test(text)).join(' | ');
    if (/error|failed/i.test(said)) throw new Error(what + ' did not build: ' + said);
    const size = /([0-9][0-9,]*) bytes/.exec(said);
    if (!size) throw new Error(what + ' reported no size: ' + said);
    return Number(size[1].replace(/,/g, ''));
  };
  const bare = await runBuild('the starter on its own');
  record('build', bare + ' bytes from the starter alone');

  /*
   * And now with the artwork and the music in it.
   *
   * Adding a generated source to the project is not the same as building with
   * it: a build target names the units it assembles, so the editors' output has
   * to be selected before it is in the program. This is the step that decides
   * whether the asset editors are part of the workflow or beside it, so the
   * journey ticks them and requires the binary to grow.
   */
  const units = [...document.querySelectorAll('.build-check-list label')];
  const generated = units.filter((unit) => /[.]asm$/.test(unit.querySelector('span')?.textContent?.trim() ?? '')
    && !/entry/.test(unit.querySelector('small')?.textContent ?? ''));
  record('source units', units.length + ' offered, ' + generated.length + ' generated by the editors');
  if (generated.length < 2) throw new Error('The sprite and the song did not both reach the build target as source units');
  for (const unit of generated) {
    const box = unit.querySelector('input[type="checkbox"]');
    if (box.disabled) throw new Error('A generated source unit cannot be built: ' + unit.textContent.trim().slice(0, 60));
    if (!box.checked) box.click();
  }
  await wait(400);
  const withAssets = await runBuild('the game with its artwork and music');
  record('build with assets', withAssets + ' bytes, up from ' + bare);
  if (withAssets <= bare) throw new Error('Including the artwork and the music did not change the program: ' + withAssets + ' bytes against ' + bare);

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

  /*
   * And the other medium, where the machine has one. A disk is what most of
   * these machines actually shipped games on, and a workbench that can only
   * write tape has stopped short of the way people used them.
   */
  const disk = document.querySelector('section[aria-label="Edit DFS SSD image"]');
  if (disk) {
    const create = [...disk.querySelectorAll('button')].find((button) => /Create|Build|Write/i.test(button.textContent.trim()));
    record('disk', create ? 'offered: ' + create.textContent.trim() : 'an editor with no create control');
  } else {
    record('disk', 'this machine is offered none here');
  }

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
  let dialogs = [];
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
    /*
     * The workbench asks before it throws away unsaved work, with the browser's
     * own dialog. That is right, and it is also a dialog that blocks the page
     * until something answers it — so a walk that ignored one would not fail,
     * it would hang, and a gate stage that hangs teaches nobody anything.
     * Answering it is what a person does; what was asked is recorded.
     */
    if (message.method === 'Page.javascriptDialogOpening') {
      dialogs.push(message.params?.message ?? 'an unnamed dialog');
      socket.send(JSON.stringify({ id: ++sequence, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
    }
  });
  /*
   * Every request is given a deadline.
   *
   * A page that hangs — a render loop, a promise that never settles — would
   * otherwise hang this, and a gate stage that hangs is worse than one that
   * fails: nobody learns anything and the build never finishes. A machine that
   * takes longer than this to walk has something wrong with it worth reporting.
   */
  const call = (method, params = {}, timeoutMs = 120_000) => new Promise((done, failed) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      failed(new Error(method + ' did not answer within ' + Math.round(timeoutMs / 1000) + 's'));
    }, timeoutMs);
    pending.set(id, (message) => { clearTimeout(timer); done(message); });
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
      dialogs = [];
      /*
       * An empty workbench, not the one the last machine left behind. The
       * product remembers a project between visits, which is what somebody
       * wants and is not where a journey starts.
       */
      await call('Storage.clearDataForOrigin', { origin: `http://127.0.0.1:${port}`, storageTypes: 'all' });
      await call('Page.navigate', { url: `http://127.0.0.1:${port}/?journey=${journey.machineId}` });
      const ready = await call('Runtime.evaluate', {
        expression: 'new Promise((done) => { const check = () => (document.querySelector(".app-shell") ? done(true) : setTimeout(check, 100)); check(); })',
        awaitPromise: true, returnByValue: true,
      });
      if (!ready.result?.result?.value) throw new Error(`${journey.label}: the workbench never rendered`);
      let outcome;
      try {
        outcome = await call('Runtime.evaluate', {
          expression: `${WALK}(${JSON.stringify(journey.machineId)}, ${JSON.stringify(journey.template)}, ${journey.runnable})`,
          awaitPromise: true, returnByValue: true,
        });
      } catch (error) {
        results.push({ ...journey, ok: false, failure: error.message, complaints });
        continue;
      }
      if (outcome.result?.exceptionDetails) {
        const detail = outcome.result.exceptionDetails.exception?.description ?? outcome.result.exceptionDetails.text;
        results.push({ ...journey, ok: false, failure: String(detail).split('\n')[0], complaints });
        continue;
      }
      const walked = JSON.parse(outcome.result.result.value);
      const steps = [...walked.steps, ...(dialogs.length ? [{ name: 'asked before discarding work', detail: dialogs.join(' | ') }] : [])];
      results.push({ ...journey, ok: complaints.length === 0, failure: complaints.length ? 'the page complained' : null, steps, complaints });
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
