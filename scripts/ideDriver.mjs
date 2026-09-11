/*
 * Driving the live workbench from the outside, for any project.
 *
 * The product is a web application, and the surest way to know a thing works is
 * to make the running product do it and read back what happened. This is the
 * plumbing for that: it starts (or attaches to) a real Chrome showing the
 * workbench with a remote debugging port, speaks the DevTools protocol to it,
 * and offers the handful of moves a demonstration needs. Opening a project,
 * supplying firmware, changing a file through the editor, writing the folder
 * back, building and booting, and reading the machine's screen.
 *
 * Nothing here knows about any particular project. The folder, its name, the
 * ROMs it needs and where they are all come in as arguments, so the same driver
 * runs a BBC game, an Electron demo or an empty template. What a project does
 * with the machine once it boots (its own symbols, its own screen layout) is
 * the project's business and stays in the project; this only gets it there.
 *
 * One step is a person's to make. A browser will not hand a page a folder it
 * can write back to without a real click on the picker, so `openProjectFolder`
 * opens the dialog and waits for that grant rather than faking it. Everything
 * before and after it is automated.
 *
 * The DevTools protocol needs a WebSocket. Node 22 has one built in; on Node 20
 * it is behind a flag, so this falls back to undici's, which needs none.
 *
 * As a library:
 *   import { launchOrAttach, openProjectFolder, buildAndBoot } from './ideDriver.mjs';
 *
 * As a command:
 *   node scripts/ideDriver.mjs open  --project <dir> [--name <n>] [--roms <dir>] [--firmware a,b,c]
 *   node scripts/ideDriver.mjs build-boot [--wait-ms 45000]
 *   node scripts/ideDriver.mjs shot  --out <file.png> [--press-return]
 * Common options: --url (default http://127.0.0.1:5173/), --port (9333),
 *   --profile <dir>, --chrome <path>.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const { runStep } = await import(join(HERE, 'helpScreenshots.mjs'));

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** A WebSocket that works on Node 20 and 22 alike. */
async function webSocket() {
  if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket;
  return (await import('undici')).WebSocket;
}

const CHROME_CANDIDATES = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];

/** Defaults for where the workbench is served and how the browser is reached. */
export function driverDefaults(options = {}) {
  return {
    url: options.url ?? process.env.ACORN_IDE_URL ?? 'http://127.0.0.1:5173/',
    port: Number(options.port ?? process.env.ACORN_IDE_DEBUG_PORT ?? 9333),
    chrome: options.chrome ?? CHROME_CANDIDATES.find((path) => existsSync(path)),
    profileDir: options.profileDir ?? process.env.ACORN_IDE_PROFILE
      ?? join(homedir(), '.local', 'share', 'acorn-ide-driver', sanitise(options.profileName ?? 'default')),
  };
}

function sanitise(value) {
  return String(value).trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'default';
}

async function browserUp(port) {
  try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { return false; }
}

/* ---- the connection ------------------------------------------------------- */

async function connect(target) {
  const WebSocketImpl = await webSocket();
  const socket = new WebSocketImpl(target.webSocketDebuggerUrl);
  await new Promise((open, failed) => { socket.addEventListener('open', open, { once: true }); socket.addEventListener('error', failed, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  const dialog = { answer: undefined };
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Page.javascriptDialogOpening') {
      const promptText = dialog.answer ?? message.params.defaultPrompt ?? '';
      dialog.answer = undefined;
      socket.send(JSON.stringify({ id: ++sequence, method: 'Page.handleJavaScriptDialog', params: { accept: true, promptText } }));
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolveValue, reject) => {
    const id = ++sequence; pending.set(id, { resolve: resolveValue, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
  return { send, evaluate, dialog, close: () => socket.close() };
}

/** Attach to the workbench page already open in the browser, if there is one. */
export async function attach(options = {}) {
  const { url, port } = driverDefaults(options);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  let target = targets.find((item) => item.type === 'page' && item.url.startsWith(url) && !item.url.includes('emulator.html'));
  if (!target) target = await (await fetch(`http://127.0.0.1:${port}/json/new?${url}`, { method: 'PUT' })).json();
  return connect(target);
}

/** The machine's own window when it has been popped out; null when it has not. */
export async function attachMachineWindow(options = {}) {
  const { port } = driverDefaults(options);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = targets.find((item) => item.type === 'page' && item.url.includes('emulator.html'));
  return target ? connect(target) : null;
}

/**
 * Ensure a headed Chrome is showing the workbench with its debugging port open,
 * starting one with a persistent profile if none is running, then attach. The
 * profile persists so a folder granted once stays granted between runs.
 */
export async function launchOrAttach(options = {}) {
  const settings = driverDefaults(options);
  if (!(await browserUp(settings.port))) {
    if (!settings.chrome) throw new Error('no Chrome or Chromium was found; pass --chrome with the path to one');
    mkdirSync(settings.profileDir, { recursive: true });
    const browser = spawn(settings.chrome, [
      `--remote-debugging-port=${settings.port}`, '--remote-allow-origins=*', `--user-data-dir=${settings.profileDir}`,
      '--no-first-run', '--no-default-browser-check', '--window-size=1600,1000', settings.url,
    ], { detached: true, stdio: 'ignore', env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':0' } });
    browser.unref();
    for (let tries = 0; tries < 60 && !(await browserUp(settings.port)); tries += 1) await delay(500);
    if (!(await browserUp(settings.port))) throw new Error('the browser did not open its debugging port');
  }
  const page = await attach(settings);
  await waitForWorkbench(page);
  return page;
}

/** Wait until the workbench itself has loaded, not just the browser. */
export async function waitForWorkbench(page, tries = 60) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (await page.evaluate(`!!document.querySelector('button[aria-label="Settings"]')`)) return;
    await delay(500);
  }
  throw new Error('the workbench did not finish loading');
}

/* ---- projects ------------------------------------------------------------- */

/** Whether a project with files is open (optionally one whose name is shown). */
export async function projectIsOpen(page, { name } = {}) {
  const hasFiles = await page.evaluate(`!document.querySelector('.start-project-dialog') && !!document.querySelector('button.tree-item, .tree-item')`);
  if (!hasFiles) return false;
  if (!name) return true;
  return page.evaluate(`document.body.innerText.includes(${JSON.stringify(name)})`);
}

/**
 * Open the folder dialog and wait for the person to choose the folder and
 * create the project from it. This is the one manual step: a browser will not
 * give a page write access to a folder without a real click. If the workbench
 * reloads while waiting (its own source changing under the dev server), the
 * dialog is opened again. Returns once a project is open.
 */
export async function openProjectFolder(page, { folderPath, name, quiet = false } = {}) {
  if (await projectIsOpen(page, { name })) { if (!quiet) console.log('a project is already open in the workbench'); return; }
  const openDialog = async () => {
    await runStep(page, { clickText: { selector: '.workbench-menu button, .menu-bar button, button', text: 'Project' } });
    await runStep(page, { clickText: { selector: 'button', text: 'Open a codebase...' } });
    await runStep(page, { waitFor: '.start-project-dialog' });
  };
  await openDialog();
  if (!quiet) {
    console.log('');
    console.log('In the browser window, click the button that opens a folder this browser can');
    console.log(`write back to, choose${folderPath ? `  ${folderPath}` : ' the project folder'}, and create the project from it.`);
    console.log('Waiting for that.');
  }
  for (;;) {
    if (await projectIsOpen(page, { name })) { if (!quiet) console.log('the project is open, and its folder will be written back to'); return; }
    const lost = await page.evaluate(`!document.querySelector('.start-project-dialog') && !document.querySelector('button[aria-label="Settings"]')`);
    if (lost) { await waitForWorkbench(page).catch(() => {}); await openDialog(); if (!quiet) console.log('the dialog was put back after a reload'); }
    await delay(1000);
  }
}

/**
 * Supply firmware to the ROM workspace when the set is not already complete.
 * `firmware` is the list of ROM files to feed the requirement slots in order,
 * resolved against `romsDir`. Does nothing when the workbench already reports
 * the set ready, so it is safe to call every run.
 */
export async function supplyFirmware(page, { romsDir, firmware = [] } = {}) {
  if (!firmware.length) return { supplied: 0, alreadyReady: true };
  await runStep(page, { workspace: 'Settings' });
  await runStep(page, { waitFor: '.rom-workspace' });
  if (await page.evaluate(`document.body.innerText.includes('ROM SET READY')`)) return { supplied: 0, alreadyReady: true };
  for (let index = 0; index < firmware.length; index += 1) {
    await runStep(page, { files: { selector: `.rom-requirements section:nth-of-type(${index + 1}) input[type="file"]`, paths: [resolve(romsDir, firmware[index])] } });
    await runStep(page, { waitFor: `.rom-requirements section:nth-of-type(${index + 1}).supplied` });
  }
  await runStep(page, { waitForText: 'ROM SET READY' });
  return { supplied: firmware.length, alreadyReady: false };
}

/* ---- editing, building, booting ------------------------------------------- */

/** The workbench's status line, the short sentence it shows after an action. */
export async function statusNotice(page) {
  return String(await page.evaluate("(document.querySelector('.status-left')?.textContent ?? '').trim()"));
}

/**
 * Open a menu on the workbench menu bar and click one of its items by name.
 * Matches an item exactly, then by a single one that starts with the name
 * (a menu entry carries its shortcut in the same element, so "Build and run"
 * reads as "Build and runF5"). Throws when the menu or a usable item is not
 * found, so a rename fails here rather than silently doing nothing.
 */
export async function clickMenuItem(page, menu, item) {
  const opened = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('.panel-actions-button, [role=menubar] button, button')].find((element) => element.textContent.trim() === ${JSON.stringify(menu)});
    if (!button) return 'no ' + ${JSON.stringify(menu)} + ' menu';
    button.click();
    return true;
  })()`);
  if (opened !== true) throw new Error(`the ${menu} menu could not be opened: ${opened}`);
  await delay(400);
  const chosen = await page.evaluate(`(() => {
    const items = [...document.querySelectorAll('.panel-menu-item, [role=menu] button')];
    const exact = items.filter((element) => element.textContent.trim() === ${JSON.stringify(item)});
    const prefixed = items.filter((element) => element.textContent.trim().startsWith(${JSON.stringify(item)}));
    const match = exact[0] ?? (prefixed.length === 1 ? prefixed[0] : undefined);
    if (!match) return 'no ' + ${JSON.stringify(item)} + ' item';
    if (match.disabled) return ${JSON.stringify(item)} + ' is disabled';
    match.click();
    return true;
  })()`);
  if (chosen !== true) throw new Error(`the ${menu} menu could not run ${item}: ${chosen}`);
  await delay(350);
}

/** Open a project file in the editor and replace its text the way a person would. */
export async function editFile(page, { name, text }) {
  await runStep(page, { workspace: 'Code' });
  await runStep(page, { clickText: { selector: 'button.tree-item', text: name.split('/').pop() } });
  await runStep(page, { waitForText: name });
  const took = await page.evaluate(`(() => {
    const area = document.querySelector('textarea.source-textarea');
    if (!area) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(area, ${JSON.stringify(text)});
    area.dispatchEvent(new Event('input', { bubbles: true }));
    return area.value === ${JSON.stringify(text)};
  })()`);
  await delay(500);
  return took;
}

/** Write the open project's files back to its folder. */
export async function saveToFolder(page) {
  await runStep(page, { clickText: { selector: 'button', text: 'To folder' } });
  await delay(1500);
  return statusNotice(page);
}

/**
 * Build every target and boot the machine from what it produced, then wait for
 * the workbench to report the boot done. Returns the status line it settled on.
 */
export async function buildAndBoot(page, { timeoutMs = 120000 } = {}) {
  await clickMenuItem(page, 'Build', 'Build and boot');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await statusNotice(page);
    if (/booted from it|stopped|not started|failed/.test(text)) return text;
    await delay(1000);
  }
  return statusNotice(page);
}

/** Save a PNG of a page (the workbench, or the machine's popped-out window). */
export async function captureScreenshot(target, path) {
  const { data } = await target.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path, Buffer.from(data, 'base64'));
  return path;
}

/** Press and release a key on the machine, focusing its canvas first. */
export async function pressMachineKey(machine, { key = 'Enter', code = 'Enter', keyCode = 13, holdMs = 150 } = {}) {
  await machine.evaluate(`document.querySelector('canvas')?.focus()`);
  await machine.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode });
  await delay(holdMs);
  await machine.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
}

/* ---- command line --------------------------------------------------------- */

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) { options[key] = true; } else { options[key] = next; index += 1; }
    } else positional.push(token);
  }
  return { positional, options };
}

async function main(argv) {
  const { positional, options } = parseArgs(argv);
  const command = positional[0] ?? 'open';
  const settings = driverDefaults({ url: options.url, port: options.port, chrome: options.chrome, profileDir: options.profile, profileName: options.name ?? options.project });

  if (command === 'open') {
    const project = options.project ? resolve(options.project) : undefined;
    const page = await launchOrAttach(settings);
    await openProjectFolder(page, { folderPath: project, name: options.name });
    if (options.roms || options.firmware) {
      const result = await supplyFirmware(page, { romsDir: options.roms ?? '.', firmware: String(options.firmware ?? '').split(',').map((entry) => entry.trim()).filter(Boolean) });
      console.log(result.alreadyReady ? 'firmware already complete' : `supplied ${result.supplied} ROM file(s)`);
    }
    await runStep(page, { workspace: 'Code' }).catch(() => {});
    page.close();
    return;
  }

  if (command === 'build-boot') {
    const page = await attach(settings);
    const notice = await buildAndBoot(page, { timeoutMs: Number(options['timeout-ms'] ?? 120000) });
    console.log('build and boot:', notice);
    if (options['wait-ms']) await delay(Number(options['wait-ms']));
    page.close();
    return;
  }

  if (command === 'shot') {
    const out = resolve(options.out ?? 'workbench.png');
    const page = await attach(settings);
    const machine = await attachMachineWindow(settings);
    const target = machine ?? page;
    if (machine && options['press-return']) { await pressMachineKey(machine); await delay(Number(options['play-ms'] ?? 3000)); }
    await captureScreenshot(target, out);
    console.log(`${machine ? "the machine's window" : 'the workbench'} is in ${out}`);
    machine?.close();
    page.close();
    return;
  }

  throw new Error(`unknown command ${command}; use open, build-boot or shot`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exit(1); });
}
