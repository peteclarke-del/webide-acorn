#!/usr/bin/env node
/*
 * Asks a real Acorn Electron to make a sound, and watches its ULA while it does.
 *
 * The Electron's sound hardware is one tone generator, driven by two write-only
 * ULA registers: the divider that fixes the pitch, and two bits that turn the
 * tone on. Write-only means a program cannot read back what it asked for, and
 * neither can a debugger by reading memory — so the bridge in
 * `docker/elkulator/webide_bridge.c` publishes both, and this script is why.
 *
 * It boots an Electron on the Elkulator WebAssembly core in headless Chromium,
 * types SOUND statements at its keyboard over the ordinary runtime command
 * envelope, and records the dividers seen while each note plays. The findings
 * are written into `src/assets/electronSoundMeasurements.ts`, which the
 * always-running tests compare the song editor's Electron target against.
 *
 * It is worth having because the answers are not what the BBC would lead you to
 * expect. A note sent to a second channel does not queue behind the one playing;
 * it replaces it, and the first is lost silently. There is no volume at all.
 * Channel 0 makes noise by modulating the same generator rather than by having a
 * noise source, so noise and tone cannot sound together either. A song editor
 * that assumed otherwise would let somebody write music this machine drops half
 * of without a word.
 *
 * ROMs are never committed. Run this against firmware you already have:
 *
 *   node --experimental-websocket scripts/measureElectronSound.mjs <dir>
 *
 * where <dir> holds `roms/os` and `roms/basic.rom` and a copy of the runtime
 * page and core, laid out the way the workbench serves them. CHROMIUM_PATH
 * selects the browser.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve, normalize } from 'node:path';
import { argv, env, exit } from 'node:process';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json' };

/** The statements to play, and what each is there to establish. */
export const MEASUREMENTS = Object.freeze({
  pitches: [0, 4, 32, 53, 89, 101, 149, 197, 231, 255],
  amplitudes: [0, -1, -7, -15],
  channels: [0, 1, 2, 3],
  pairs: [
    'SOUND 1,-15,53,10:SOUND 2,-15,197,10',
    'SOUND 0,-15,5,10:SOUND 1,-15,101,10',
    'SOUND 1,-15,53,10:SOUND 1,-15,197,10',
  ],
});

/* The page that hosts the runtime. The runtime publishes its events to a parent
 * frame and takes commands from one, so a host is how it is meant to be driven,
 * and driving it any other way would measure something the workbench does not
 * do. */
export const HOST_HTML = `<!doctype html>
<meta charset="utf-8">
<title>Electron sound measurement</title>
<iframe id="runtime" src="/elkulator.html?session=sound-check" width="660" height="540"></iframe>
<script>
  const CHANNEL = '8bit-net-elkulator';
  const SESSION = 'sound-check';
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
</script>
`;

async function serve(root) {
  const server = createServer(async (request, response) => {
    const path = normalize(decodeURIComponent((request.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    if (path === '/') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(HOST_HTML); return; }
    try {
      const bytes = await readFile(join(root, path));
      response.writeHead(200, { 'Content-Type': TYPES[path.slice(path.lastIndexOf('.'))] ?? 'application/octet-stream' });
      response.end(bytes);
    } catch { response.writeHead(404).end('not here'); }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { server, port: server.address().port };
}

async function attach() {
  const browser = spawn(env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader', '--remote-allow-origins=*', '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0', `--user-data-dir=/tmp/electron-sound-${process.pid}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  const port = await new Promise((done, fail) => {
    browser.stderr.on('data', (chunk) => {
      stderr += chunk;
      const found = /ws:\/\/127\.0\.0\.1:(\d+)\//.exec(stderr);
      if (found) done(Number(found[1]));
    });
    setTimeout(() => fail(new Error(`the browser published no DevTools endpoint: ${stderr}`)), 30_000);
  });
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((done) => socket.addEventListener('open', done));
  return { browser, socket };
}

/* Every note is measured in its own window of silence. Without that the reading
 * lags a statement behind, because the machine queues a note and plays it after
 * the line is entered — which is how a first attempt attributed every divider to
 * the pitch before it. */
const PROBE = [
  '(async () => {',
  '  const wait = (ms) => new Promise((done) => setTimeout(done, ms));',
  '  const out = { pitches: [], amplitudes: [], channels: [], pairs: [] };',
  "  window.__command({ type: 'initialise', roms: { os: '/roms/os', basic: '/roms/basic.rom' } });",
  '  await wait(4000);',
  "  const sound = async () => { window.__command({ type: 'snapshot' }); await wait(90); return window.__lastState()?.sound ?? null; };",
  '  const quiet = async () => { let run = 0; for (let i = 0; i < 120 && run < 8; i += 1) { const s = await sound(); run = (s && s.enabled) ? 0 : run + 1; } };',
  '  const play = async (statement) => {',
  '    await quiet();',
  "    window.__command({ type: 'inject-text', text: statement + String.fromCharCode(10), holdFields: 6 });",
  '    const dividers = [];',
  '    let started = false, off = 0;',
  '    for (let i = 0; i < 200; i += 1) {',
  '      const state = await sound();',
  '      if (state && state.enabled) { started = true; off = 0; dividers.push(state.divider); }',
  '      else if (started && ++off > 6) break;',
  '    }',
  '    return { statement, played: started, dividers: [...new Set(dividers)] };',
  '  };',
  '  for (const pitch of PITCHES) out.pitches.push(await play("SOUND 1,-15," + pitch + ",10"));',
  '  for (const amplitude of AMPLITUDES) out.amplitudes.push(await play("SOUND 1," + amplitude + ",101,10"));',
  '  for (const channel of CHANNELS) out.channels.push(await play("SOUND " + channel + ",-15,101,10"));',
  '  for (const pair of PAIRS) out.pairs.push(await play(pair));',
  '  out.errors = window.__errors().map((event) => event.message);',
  '  return JSON.stringify(out);',
  '})()',
].join('\n');

async function main() {
  const root = argv[2];
  if (!root) {
    console.error('Give the directory serving elkulator.html, the core and a roms/ tree.');
    exit(2);
  }
  const { server, port } = await serve(resolve(root));
  const { browser, socket } = await attach();
  let nextId = 0;
  const pending = new Map();
  const pageErrors = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) { pending.get(message.id)?.(message); pending.delete(message.id); return; }
    if (message.method === 'Runtime.exceptionThrown') pageErrors.push(message.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((done) => { const id = ++nextId; pending.set(id, done); socket.send(JSON.stringify({ id, method, params })); });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await new Promise((done) => setTimeout(done, 4000));

  const expression = PROBE
    .replace('PITCHES', JSON.stringify(MEASUREMENTS.pitches))
    .replace('AMPLITUDES', JSON.stringify(MEASUREMENTS.amplitudes))
    .replace('CHANNELS', JSON.stringify(MEASUREMENTS.channels))
    .replace('PAIRS', JSON.stringify(MEASUREMENTS.pairs));
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description ?? 'the probe failed');
  const measured = JSON.parse(result.result.result.value);

  for (const group of ['pitches', 'amplitudes', 'channels', 'pairs']) {
    console.log(`${group}:`);
    for (const entry of measured[group]) {
      console.log('  ', entry.statement, '->', entry.played ? `dividers ${JSON.stringify(entry.dividers)}` : 'silent');
    }
  }
  console.log('runtime errors:', measured.errors, 'page errors:', pageErrors);
  socket.close(); browser.kill('SIGKILL'); server.close();
  if (measured.errors.length || pageErrors.length) exit(1);
}

if (process.argv[1] && import.meta.url.endsWith(resolve(process.argv[1]).split('/').pop())) await main();
