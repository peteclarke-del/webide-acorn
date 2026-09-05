#!/usr/bin/env node
/*
 * Drives the Electron runtime page in a real browser, so measurements are taken
 * from the machine rather than from a belief about it.
 *
 * The runtime publishes its events to a parent frame and takes its commands
 * from one, so it is hosted in an iframe here exactly as the workbench hosts
 * it. Driving it any other way would measure something the product does not do.
 *
 * This is the shared half of the measuring scripts beside it — the ROM-less
 * plumbing: a static server, a headless browser, a DevTools connection and a
 * page that speaks the command envelope. What is measured is each script's own
 * business, expressed as an expression evaluated in that page.
 *
 * ROMs are never committed. Each script is pointed at a directory the caller
 * already has, holding the runtime page, the core and a roms/ tree.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve, normalize } from 'node:path';
import { env } from 'node:process';

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm',
  '.css': 'text/css', '.json': 'application/json', '.uef': 'application/octet-stream',
};

/**
 * The host page.
 *
 * It collects every event the runtime publishes and offers three things to the
 * probe: sending a command, reading the last state, and asking for memory and
 * waiting for the reply that matches.
 */
export const HOST_HTML = `<!doctype html>
<meta charset="utf-8">
<title>Electron runtime probe</title>
<iframe id="runtime" src="/elkulator.html?session=probe" width="660" height="540"></iframe>
<script>
  const CHANNEL = '8bit-net-elkulator';
  const SESSION = 'probe';
  window.__events = [];
  let commandId = 0;
  window.addEventListener('message', (event) => {
    if (event.data && event.data.channel === CHANNEL) window.__events.push(event.data);
  });
  window.__command = (command) => {
    document.getElementById('runtime').contentWindow.postMessage(
      { channel: CHANNEL, sessionId: SESSION, commandId: ++commandId, ...command }, window.location.origin);
  };
  window.__lastState = () => [...window.__events].reverse().find((event) => event.type === 'state') ?? null;
  window.__errors = () => window.__events.filter((event) => event.type === 'error');
  window.__memory = (address, length) => new Promise((done, fail) => {
    const requestId = 'm' + Math.random();
    const timer = setTimeout(() => fail(new Error('the runtime never answered a memory read')), 5000);
    const listener = (event) => {
      if (event.data && event.data.channel === CHANNEL && event.data.type === 'memory' && event.data.requestId === requestId) {
        clearTimeout(timer); window.removeEventListener('message', listener); done(event.data.bytes);
      }
    };
    window.addEventListener('message', listener);
    window.__command({ type: 'read-memory', address, length, requestId, direct: true });
  });
</script>
`;

/**
 * Serve a directory, run an expression in the hosted runtime, and give back
 * what it returned along with anything the page threw.
 */
export async function probeElectronRuntime(root, expression, { settleMs = 4000 } = {}) {
  const base = resolve(root);
  const server = createServer(async (request, response) => {
    const path = normalize(decodeURIComponent((request.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    if (path === '/') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(HOST_HTML); return; }
    try {
      const bytes = await readFile(join(base, path));
      response.writeHead(200, { 'Content-Type': TYPES[path.slice(path.lastIndexOf('.'))] ?? 'application/octet-stream' });
      response.end(bytes);
    } catch { response.writeHead(404).end('not here'); }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;

  const browser = spawn(env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader', '--remote-allow-origins=*', '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0', `--user-data-dir=/tmp/electron-probe-${process.pid}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  const devtools = await new Promise((done, fail) => {
    browser.stderr.on('data', (chunk) => {
      stderr += chunk;
      const found = /ws:\/\/127\.0\.0\.1:(\d+)\//.exec(stderr);
      if (found) done(Number(found[1]));
    });
    setTimeout(() => fail(new Error(`the browser published no DevTools endpoint: ${stderr}`)), 30_000);
  });
  const targets = await (await fetch(`http://127.0.0.1:${devtools}/json/list`)).json();
  const socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((done) => socket.addEventListener('open', done));

  let nextId = 0;
  const pending = new Map();
  const pageErrors = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) { pending.get(message.id)?.(message); pending.delete(message.id); return; }
    if (message.method === 'Runtime.exceptionThrown') pageErrors.push(message.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((done) => {
    const id = ++nextId;
    pending.set(id, done);
    socket.send(JSON.stringify({ id, method, params }));
  });

  try {
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    await new Promise((done) => setTimeout(done, settleMs));
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.result?.exceptionDetails) {
      throw new Error(result.result.exceptionDetails.exception?.description ?? 'the probe threw');
    }
    return { value: JSON.parse(result.result.result.value), pageErrors };
  } finally {
    socket.close();
    browser.kill('SIGKILL');
    server.close();
  }
}
