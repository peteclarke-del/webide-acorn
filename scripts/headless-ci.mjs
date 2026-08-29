#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';

const argv = new Map();
for (let index = 2; index < process.argv.length; index += 2) argv.set(process.argv[index], process.argv[index + 1]);
const projectPath = resolve(argv.get('--project') ?? '/workspace/project.json');
const romManifestPath = resolve(argv.get('--rom-manifest') ?? '/workspace/roms.json');
const outputDirectory = resolve(argv.get('--output') ?? '/workspace/results');
const workbenchUrl = argv.get('--url') ?? 'http://webide-acorn:8080';
const chromiumPath = process.env.CHROMIUM_PATH ?? '/usr/bin/chromium';
const timeoutMs = Number(argv.get('--timeout-ms') ?? 120_000);
if (!Number.isInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 900_000) throw new Error('--timeout-ms must be between 10000 and 900000');
/* Both loopback ports are configurable so a run cannot collide with another
 * service, or with a second concurrent runner, on the same host. */
const port = (flag, fallback) => {
  const value = Number(argv.get(flag) ?? fallback);
  if (!Number.isInteger(value) || value < 1024 || value > 65_535) throw new Error(`${flag} must be a port between 1024 and 65535`);
  return value;
};
const proxyPort = port('--proxy-port', 8081);
const devtoolsPort = port('--devtools-port', 9222);
if (proxyPort === devtoolsPort) throw new Error('--proxy-port and --devtools-port must differ');
const browserUrl = `http://127.0.0.1:${proxyPort}`;
const userDataDir = argv.get('--user-data-dir') ?? `/tmp/8bit-net-headless-ci-${devtoolsPort}`;

const projectText = await readFile(projectPath, 'utf8');
if (Buffer.byteLength(projectText) > 8 * 1024 * 1024) throw new Error('Project input exceeds 8 MiB');
const project = JSON.parse(projectText);
/* Project format 13 introduced persistent test plans, and every later version
 * migrates forward in the workbench, so the runner accepts 13 or newer rather
 * than pinning the one version that happened to be current when it was written. */
const FIRST_TESTABLE_PROJECT_FORMAT = 13;
const projectFormat = /^8bit-net-dev-project-(\d{1,3})$/.exec(String(project?.format ?? ''));
if (!projectFormat || Number(projectFormat[1]) < FIRST_TESTABLE_PROJECT_FORMAT) throw new Error(`Headless CI requires an 8bit-net-dev-project-${FIRST_TESTABLE_PROJECT_FORMAT} or newer export, not ${project?.format}`);
const expectedManifest = `${project.target?.machineId}/${project.target?.variant}/${project.target?.romId}`;
if (expectedManifest.includes('undefined')) throw new Error('Project target does not contain a complete machine manifest');
const enabledPlans = Array.isArray(project.testPlans) ? project.testPlans.filter((plan) => plan?.enabled).length : 0;
if (!enabledPlans) throw new Error('Project contains no enabled test plans');

const declaredRoms = JSON.parse(await readFile(romManifestPath, 'utf8'))?.roms;
if (!Array.isArray(declaredRoms) || !declaredRoms.length || declaredRoms.length > 32) throw new Error('ROM manifest must declare 1 to 32 ROM files');
const roms = [];
for (const declared of declaredRoms) {
  if (!declared || typeof declared.key !== 'string' || !/^[A-Za-z0-9._/-]{1,200}$/.test(declared.key) || declared.key.includes('..') || typeof declared.file !== 'string') throw new Error('ROM manifest contains an invalid key or file');
  const bytes = await readFile(resolve(declared.file));
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) throw new Error(`ROM ${declared.key} is empty or exceeds 4 MiB`);
  roms.push({ key: declared.key, filename: declared.file.split('/').at(-1), bytes: bytes.toString('base64'), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}

await mkdir(outputDirectory, { recursive: true });
for (const filename of ['acorn-test-report.json', 'acorn-test-report.junit.xml', 'test-report.json', 'test-report.junit.xml']) await unlink(join(outputDirectory, filename)).catch((error) => { if (error.code !== 'ENOENT') throw error; });
const proxy = createServer(async (request, response) => {
  try {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const headers = { ...request.headers }; delete headers.host;
    const upstream = await fetch(new URL(request.url ?? '/', workbenchUrl), { method: request.method, headers, ...(['GET', 'HEAD'].includes(request.method ?? 'GET') ? {} : { body: Buffer.concat(chunks) }) });
    response.statusCode = upstream.status;
    upstream.headers.forEach((value, name) => { if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(name.toLowerCase())) response.setHeader(name, value); });
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) { response.statusCode = 502; response.end(`CI proxy error: ${error.message}`); }
});
await new Promise((resolveProxy, reject) => { proxy.once('error', reject); proxy.listen(proxyPort, '127.0.0.1', resolveProxy); });
const chrome = spawn(chromiumPath, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--remote-allow-origins=*', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${devtoolsPort}`, `--user-data-dir=${userDataDir}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeErrors = '';
chrome.stderr.setEncoding('utf8');
chrome.stderr.on('data', (chunk) => { chromeErrors = `${chromeErrors}${chunk}`.slice(-16_384); });

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
async function until(operation, description, limit = timeoutMs) {
  const deadline = Date.now() + limit;
  let lastError;
  while (Date.now() < deadline) {
    try { const value = await operation(); if (value) return value; } catch (error) { lastError = error; }
    await delay(100);
  }
  throw new Error(`${description} timed out${lastError ? `: ${lastError.message}` : ''}`);
}

class Cdp {
  constructor(socket) { this.socket = socket; this.sequence = 0; this.pending = new Map(); this.events = []; socket.addEventListener('message', (event) => { const message = JSON.parse(event.data); if (!message.id) { if (['Runtime.exceptionThrown', 'Runtime.consoleAPICalled', 'Log.entryAdded'].includes(message.method)) this.events.push(message); return; } const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result); }); }
  call(method, params = {}) { const id = ++this.sequence; return new Promise((resolveCall, reject) => { this.pending.set(id, { resolve: resolveCall, reject }); this.socket.send(JSON.stringify({ id, method, params })); }); }
  async evaluate(expression) { const response = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text); return response.result.value; }
}

let cdp;
try {
  await until(async () => (await fetch(`http://127.0.0.1:${devtoolsPort}/json/version`)).ok, 'Chromium DevTools endpoint', 30_000);
  const target = await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/new?${encodeURIComponent(browserUrl)}`, { method: 'PUT' })).json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveSocket, reject) => { socket.addEventListener('open', resolveSocket, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  cdp = new Cdp(socket);
  await cdp.call('Page.enable'); await cdp.call('Runtime.enable'); await cdp.call('Log.enable');
  await cdp.call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: outputDirectory, eventsEnabled: true });
  await until(() => cdp.evaluate('document.readyState === "complete"'), 'Workbench load');
  await until(() => cdp.evaluate(`navigator.serviceWorker?.ready.then(() => true)`), 'ROM service worker readiness', 30_000);
  await cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('8bit-net-dev:local-project', ${JSON.stringify(projectText)}); localStorage.removeItem('8bit-net-dev:test-history-v1');` });
  await cdp.evaluate(`(async () => {
    localStorage.setItem('8bit-net-dev:local-project', ${JSON.stringify(projectText)});
    localStorage.removeItem('8bit-net-dev:test-history-v1');
    const roms = ${JSON.stringify(roms)};
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('8bit-net-dev-roms', 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('roms')) request.result.createObjectStore('roms', { keyPath: 'key' }); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction('roms', 'readwrite');
        for (const rom of roms) { const binary = atob(rom.bytes); const bytes = Uint8Array.from(binary, character => character.charCodeAt(0)); transaction.objectStore('roms').put({ key: rom.key, filename: rom.filename, bytes: bytes.buffer, size: rom.size, sha256: rom.sha256, importedAt: new Date().toISOString() }); }
        transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
      };
    });
    return true;
  })()`);
  await cdp.call('Page.reload', { ignoreCache: true });
  await until(() => cdp.evaluate('document.readyState === "complete" && [...document.querySelectorAll("button")].some(button => button.textContent.trim() === "Tests")'), 'Project reload');
  const click = (label) => cdp.evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === ${JSON.stringify(label)}); if (!button || button.disabled) return false; button.click(); return true; })()`);
  await until(() => click('Tests'), 'Tests workspace availability');
  await cdp.evaluate(`(() => { globalThis.__headlessTestResults = []; addEventListener('message', event => { if (event.data?.type === 'test-result') globalThis.__headlessTestResults.push(structuredClone(event.data)); }); return true; })()`);
  await until(() => click('Test all'), 'Test-all availability');
  const terminal = await until(() => cdp.evaluate(`(() => { const rows = [...document.querySelectorAll('.test-all-results [role="listitem"]')].map(row => ({ status: row.querySelector('strong')?.textContent.trim().toLowerCase(), name: row.querySelector('span')?.textContent.trim(), message: row.querySelector('small')?.textContent.trim() })); return rows.length > 0 && rows.every(row => !['queued','running'].includes(row.status)) ? rows : null; })()`), 'Test-all completion');
  const adapterResults = await cdp.evaluate(`globalThis.__headlessTestResults ?? []`);
  await until(() => click('Export native JSON'), 'Native report export');
  await until(async () => { try { return (await stat(join(outputDirectory, 'acorn-test-report.json'))).size > 0; } catch { return false; } }, 'Native report download', 30_000);
  await until(() => click('Export JUnit XML'), 'JUnit report export');
  await until(async () => { try { return (await stat(join(outputDirectory, 'acorn-test-report.junit.xml'))).size > 0; } catch { return false; } }, 'JUnit report download', 30_000);
  const nativePath = join(outputDirectory, 'acorn-test-report.json');
  const report = JSON.parse(await readFile(nativePath, 'utf8'));
  if (report.format !== '8bit-net-dev-test-report-1' || report.manifest?.machineManifestId !== expectedManifest || report.manifest?.testTargetSchema !== 1) throw new Error(`Interactive report manifest mismatch: ${JSON.stringify(report.manifest)}`);
  if (report.totals?.tests !== terminal.length) throw new Error(`Interactive report contains ${report.totals?.tests} results but the adapter returned ${terminal.length}`);
  await rename(nativePath, join(outputDirectory, 'test-report.json'));
  await rename(join(outputDirectory, 'acorn-test-report.junit.xml'), join(outputDirectory, 'test-report.junit.xml'));
  process.stdout.write(`${JSON.stringify({ format: report.format, manifest: report.manifest, totals: report.totals, results: terminal, adapterResults }, null, 2)}\n`);
  if (report.totals.failed > 0) process.exitCode = 1;
} catch (error) {
  let pageDiagnostic = null;
  try { pageDiagnostic = cdp ? await cdp.evaluate(`({ href: location.href, title: document.title, readyState: document.readyState, body: document.body?.innerText.slice(0, 2000), html: document.body?.innerHTML.slice(0, 2000), resources: performance.getEntriesByType('resource').map(item => ({ name: item.name, duration: item.duration })).slice(-20), buttons: [...document.querySelectorAll('button')].map(button => button.textContent.trim()).slice(0, 50) })`) : null; } catch {}
  process.stderr.write(`Headless CI failed: ${error.message}\nPage: ${JSON.stringify(pageDiagnostic)}\nEvents: ${JSON.stringify(cdp?.events.slice(-20) ?? [])}\n${chromeErrors}\n`);
  process.exitCode = 2;
} finally {
  chrome.kill('SIGTERM');
  proxy.close();
}
