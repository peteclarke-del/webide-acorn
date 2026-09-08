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

const CHROMIUM_CANDIDATES = process.env.CHROMIUM_PATH
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
async function openPage(chromium) {
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
async function reset(page) {
  await page.evaluate("(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* a browser may refuse storage */ } })()");
  await page.send('Page.navigate', { url });
  await until(() => page.evaluate("document.readyState === 'complete'"), 'the page to load');
  await until(() => page.evaluate("!!document.querySelector('button[aria-label=\"Settings\"]')"), 'the workbench to mount');
  await delay(500);
}

/*
 * The steps a state is reached by. Each is one thing a person does, so an entry
 * below reads as the procedure its topic describes rather than as a script.
 */
const STEPS = {
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
  /** Click the first element of a kind whose visible text is exactly this. */
  async clickText(page, { selector, text }) {
    const found = await until(() => page.evaluate(`(() => {
      const match = [...document.querySelectorAll(${JSON.stringify(selector)})].find((element) => element.textContent.trim() === ${JSON.stringify(text)});
      if (!match) return false;
      match.click();
      return true;
    })()`), `${selector} reading ${JSON.stringify(text)} to appear`);
    if (!found) throw new Error(`no ${selector} reads ${JSON.stringify(text)}`);
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
      setter.call(element, ${JSON.stringify(value)});
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!ok) throw new Error(`could not set ${selector}`);
    await delay(400);
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
  /** Scroll something into view so the picture is of it. */
  async scrollTo(page, selector) {
    await page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'center' })`);
    await delay(400);
  },
  /** Let something settle. Used sparingly, and never to paper over a missing wait. */
  async wait(page, ms) {
    await delay(ms);
  },
};

async function runStep(page, step) {
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

const { SHOTS } = await import('./helpScreenshotStates.mjs');
const outcome = await main(SHOTS);
process.exit(outcome.failed.length ? 1 : 0);
