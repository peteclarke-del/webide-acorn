/*
 * Capturing the help screenshots from the product itself.
 *
 * Every topic in `src/help/helpTopics.ts` may carry a screenshot, and a
 * screenshot is the one part of a guide that nothing checks the truth of. The
 * gate fails on a missing file and on a control name that no longer exists, but
 * a picture of last month's interface passes both while showing something the
 * reader will not find. That is exactly what had happened: sixty images were
 * taken before the appearance work, so they show a smaller default text size
 * and no menu bar across the top.
 *
 * Taking them by hand is what made them go stale, so they are taken by driving
 * the real application in a real browser. Each entry below says which state its
 * picture is of and the steps that reach it, in the product's own terms: the
 * workspace to open, the control to choose, the text to put in. Nothing is
 * drawn, composed or simulated. If a state cannot be reached the capture fails
 * and says so, and the committed image is left alone, because an honest old
 * screenshot is worth more than a confident wrong one.
 *
 *   node --experimental-websocket scripts/helpScreenshots.mjs [--only <name>]
 *
 * It needs the application being served, by `npm run dev` or a preview of the
 * build, and takes the address in HELP_SCREENSHOT_URL (default
 * http://127.0.0.1:5399/).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.HELP_SCREENSHOT_URL ?? 'http://127.0.0.1:5399/';
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

/** The house size for these images, which the committed ones already use. */
export const VIEWPORT = { width: 1600, height: 960 };

export const CHROMIUM_CANDIDATES = process.env.CHROMIUM_PATH
  ? [process.env.CHROMIUM_PATH]
  : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(op, what, limit = 20_000) {
  const deadline = Date.now() + limit;
  let last;
  while (Date.now() < deadline) {
    try { const value = await op(); if (value) return value; } catch (error) { last = error; }
    await delay(150);
  }
  throw new Error(`${what} timed out${last ? `: ${last.message}` : ''}`);
}

/** A page under Chrome DevTools Protocol, with the few verbs these states need. */
export async function openPage(chromium) {
  const port = 9300 + Math.floor(Math.random() * 400);
  const userDataDir = await mkdtemp(join(tmpdir(), 'help-shots-'));
  const browser = spawn(chromium, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    '--remote-allow-origins=*', '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'] });

  await until(async () => {
    if (browser.exitCode !== null) throw new Error(`the browser exited with code ${browser.exitCode}`);
    return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
  }, 'the browser to accept connections', 30_000);

  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((open, failed) => {
    socket.addEventListener('open', open, { once: true });
    socket.addEventListener('error', failed, { once: true });
  });

  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text.slice(0, 200));
    return result.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: 1, mobile: false });

  const close = async () => {
    try { socket.close(); } catch { /* closing a dead socket is not a failure */ }
    browser.kill('SIGKILL');
    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  };
  return { send, evaluate, close };
}

/** Reload to a workbench that has seen nothing, so one state cannot leak into the next. */
export async function reset(page) {
  /*
   * The firmware vault is IndexedDB, and the page is reused from one shot to
   * the next. Without this a picture taken after an emulator shot would show a
   * machine with ROMs, whatever its own steps did, and the order of this list
   * would decide what the pictures say.
   */
  await page.evaluate(`(async () => {
    try { localStorage.clear(); sessionStorage.clear(); } catch { /* a browser may refuse storage */ }
    try {
      const databases = await indexedDB.databases();
      await Promise.all(databases.map(({ name }) => name && new Promise((done) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = done; request.onerror = done; request.onblocked = done;
      })));
    } catch { /* a browser may not list databases */ }
  })()`);
  await page.send('Page.navigate', { url });
  await until(() => page.evaluate("document.readyState === 'complete'"), 'the page to load');
  await until(() => page.evaluate("!!document.querySelector('button[aria-label=\"Settings\"]')"), 'the workbench to mount');
  await delay(500);
}

/*
 * The steps a state is reached by. Each is one thing a person does, so an entry
 * below reads as the procedure its topic describes rather than as a script.
 */
export const STEPS = {
  /** Open one of the workspaces, by the name on its tab. */
  async workspace(page, name) {
    const opened = await until(() => page.evaluate(`(() => {
      const tab = [...document.querySelectorAll('.mode-tab')].find((button) => button.textContent.trim() === ${JSON.stringify(name)});
      if (!tab) return false;
      tab.click();
      return true;
    })()`), `the ${name} workspace tab to appear`);
    if (!opened) throw new Error(`there is no ${name} workspace tab`);
    await delay(500);
  },
  /** Click the first element matching a selector. */
  async click(page, selector) {
    await until(() => page.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), `${selector} to appear`);
    await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await delay(350);
  },
  /*
   * Click the thing with these words on it. An exact match wins; failing that a
   * single one that starts with them, because a menu entry carries its shortcut
   * in the same element and nobody reads "Go to line...Ctrl+G" as its name.
   */
  async clickText(page, { selector, text }) {
    const found = await until(() => page.evaluate(`(() => {
      const candidates = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const exact = candidates.filter((element) => element.textContent.trim() === ${JSON.stringify(text)});
      const prefixed = candidates.filter((element) => element.textContent.trim().startsWith(${JSON.stringify(text)}));
      const match = exact[0] ?? (prefixed.length === 1 ? prefixed[0] : undefined);
      if (!match) return false;
      match.click();
      return true;
    })()`), `${selector} reading ${JSON.stringify(text)} to appear`);
    if (!found) throw new Error(`no single ${selector} reads ${JSON.stringify(text)}`);
    await delay(350);
  },
  /** Put a value into a field the way a person would, so React sees the change. */
  async setValue(page, { selector, value }) {
    await until(() => page.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), `${selector} to appear`);
    const ok = await page.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
        : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
      /* Focused, because a person typing into a field is in it, and because the
       * key step after this one has to land somewhere. */
      element.focus();
      setter.call(element, ${JSON.stringify(value)});
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!ok) throw new Error(`could not set ${selector}`);
    await delay(400);
  },
  /*
   * Type into a field, as text input rather than as a value assignment, so the
   * editor sees the same event it would from a keyboard. `at` says where the
   * caret goes first: the end of the text, or after the first occurrence of a
   * piece of it.
   */
  async type(page, { selector, text, at = 'end' }) {
    await until(() => page.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), `${selector} to appear`);
    const placed = await page.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      element.focus();
      const position = ${JSON.stringify(at)} === 'end' ? element.value.length : element.value.indexOf(${JSON.stringify(at)});
      if (position < 0) return false;
      const offset = ${JSON.stringify(at)} === 'end' ? position : position + ${JSON.stringify(at)}.length;
      element.setSelectionRange(offset, offset);
      return true;
    })()`);
    if (!placed) throw new Error(`the field has no ${JSON.stringify(at)} to type after`);
    await page.send('Input.insertText', { text });
    await delay(700);
  },
  /*
   * Select a piece of the text and type over it, which is how a person changes
   * a line. An empty replacement deletes the selection.
   */
  async replace(page, { selector, find, text = '' }) {
    await until(() => page.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), `${selector} to appear`);
    const selected = await page.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      const at = element.value.indexOf(${JSON.stringify(find)});
      if (at < 0) return false;
      element.focus();
      element.setSelectionRange(at, at + ${JSON.stringify(find)}.length);
      return true;
    })()`);
    if (!selected) throw new Error(`the text does not contain ${JSON.stringify(find)} to replace`);
    await page.send('Input.insertText', { text });
    await delay(700);
  },
  /** Give something keyboard focus, which is what makes the key step land on it. */
  async focus(page, selector) {
    await until(() => page.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), `${selector} to appear`);
    await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await delay(200);
  },
  /*
   * Put the caret where a person would click, named by the text it goes after
   * rather than by an offset, so an edit to the sample program does not quietly
   * move it into the middle of a different word.
   */
  async caret(page, { selector, after, occurrence = 1 }) {
    await until(() => page.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), `${selector} to appear`);
    const placed = await page.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      let at = -1;
      for (let found = 0; found < ${occurrence}; found += 1) {
        at = element.value.indexOf(${JSON.stringify(after)}, at + 1);
        if (at < 0) return false;
      }
      const position = at + ${JSON.stringify(after)}.length;
      element.focus();
      element.setSelectionRange(position, position);
      element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'ArrowRight' }));
      return true;
    })()`);
    if (!placed) throw new Error(`the source has no ${occurrence === 1 ? '' : `${occurrence} occurrences of `}${JSON.stringify(after)} to put the caret after`);
    await delay(400);
  },
  /** Open a disclosure by the words on it, the way a reader would. */
  async disclose(page, summary) {
    const opened = await until(() => page.evaluate(`(() => {
      const heading = [...document.querySelectorAll('summary')].find((element) => element.textContent.trim().startsWith(${JSON.stringify(summary)}));
      if (!heading) return false;
      if (!heading.parentElement.open) heading.click();
      return true;
    })()`), `a disclosure reading ${JSON.stringify(summary)} to appear`);
    if (!opened) throw new Error(`no disclosure reads ${JSON.stringify(summary)}`);
    await delay(350);
  },
  /** Wait for something the state is not reached without. */
  async waitFor(page, selector) {
    await until(() => page.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), `${selector} to appear`);
  },
  /** Wait for text to be present anywhere on the page. */
  async waitForText(page, text) {
    await until(() => page.evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`), `the text ${JSON.stringify(text)} to appear`);
  },
  /** Press a key the browser treats as real, which is what moves focus. */
  async key(page, { key, code, modifiers = 0, text }) {
    for (const type of ['keyDown', 'keyUp']) {
      await page.send('Input.dispatchKeyEvent', { type: type === 'keyDown' && text ? 'keyDown' : type, key, code, modifiers, text: type === 'keyDown' ? text : undefined, windowsVirtualKeyCode: undefined });
    }
    await delay(250);
  },
  /** Hand real files to a file input, which is how firmware and media arrive. */
  async files(page, { selector, paths }) {
    const missing = paths.filter((path) => !existsSync(path));
    if (missing.length) throw new Error(`these files are not on this machine: ${missing.join(', ')}`);
    await until(() => page.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), `${selector} to appear`);
    const { root: document } = await page.send('DOM.getDocument');
    const { nodeId } = await page.send('DOM.querySelector', { nodeId: document.nodeId, selector });
    if (!nodeId) throw new Error(`no file input matches ${selector}`);
    await page.send('DOM.setFileInputFiles', { nodeId, files: paths });
    await delay(900);
  },
  /*
   * Scroll something into view so the picture is of it.
   *
   * The pane it sits in is scrolled, never the page. `scrollIntoView` walks up
   * to whatever will move, and with `start` that is the window, which slides the
   * whole workbench off the top of the shot. `top` puts the element's heading a
   * little below the pane's top edge, which is what a section taller than its
   * pane needs; `center` is the default and suits a short one.
   */
  async scrollTo(page, argument) {
    const { selector, block = 'center' } = typeof argument === 'string' ? { selector: argument } : argument;
    const moved = await page.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      let pane = element.parentElement;
      while (pane && !(pane.scrollHeight > pane.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(pane).overflowY))) pane = pane.parentElement;
      if (!pane) return false;
      const offset = element.getBoundingClientRect().top - pane.getBoundingClientRect().top;
      pane.scrollTop += ${JSON.stringify(block)} === 'top'
        ? offset - 12
        : offset - Math.max(0, (pane.clientHeight - element.getBoundingClientRect().height) / 2);
      return true;
    })()`);
    /* A pane nothing can scroll is a pane a reader cannot reach either, so say
     * so rather than taking a picture of the top of it. */
    if (!moved) throw new Error(`nothing scrollable holds ${selector}`);
    await delay(400);
  },
  /** Let something settle. Used sparingly, and never to paper over a missing wait. */
  async wait(page, ms) {
    await delay(ms);
  },
};

export async function runStep(page, step) {
  const [name, argument] = Object.entries(step)[0];
  const run = STEPS[name];
  if (!run) throw new Error(`there is no step called ${name}`);
  await run(page, argument);
}

/** Everything that has to be true of the state before its picture is taken. */
async function assertState(page, checks) {
  for (const text of checks ?? []) {
    const present = await page.evaluate(`document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`);
    if (!present) throw new Error(`the state does not show ${JSON.stringify(text)}, so this is not the state the topic describes`);
  }
}

export async function capture(page, shot) {
  await reset(page);
  for (const step of shot.steps) await runStep(page, step);
  await assertState(page, shot.shows);
  await delay(300);
  const image = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(root, 'public/help', shot.file), Buffer.from(image.data, 'base64'));
  return shot.file;
}

export async function main(shots) {
  const chromium = CHROMIUM_CANDIDATES.find((path) => existsSync(path));
  if (!chromium) throw new Error('no Chromium binary found; set CHROMIUM_PATH');
  const wanted = only ? shots.filter((shot) => shot.file === only || shot.file === `${only}.png`) : shots;
  if (!wanted.length) throw new Error(`nothing to capture${only ? ` for ${only}` : ''}`);

  const page = await openPage(chromium);
  const taken = [];
  const failed = [];
  try {
    for (const shot of wanted) {
      try {
        await capture(page, shot);
        taken.push(shot.file);
        console.log(`captured ${shot.file}`);
      } catch (error) {
        failed.push({ file: shot.file, reason: error.message });
        console.log(`KEPT ${shot.file}: ${error.message}`);
      }
    }
  } finally {
    await page.close();
  }
  console.log(`\n${taken.length} captured, ${failed.length} left as they were`);
  for (const entry of failed) console.log(`  ${entry.file}: ${entry.reason}`);
  return { taken, failed };
}

/* Run the whole set when this file is the program, and stay importable when a
 * probe or a test wants the page verbs without taking any pictures. */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { SHOTS } = await import('./helpScreenshotStates.mjs');
  const outcome = await main(SHOTS);
  process.exit(outcome.failed.length ? 1 : 0);
}
