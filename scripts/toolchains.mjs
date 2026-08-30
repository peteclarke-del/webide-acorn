#!/usr/bin/env node
/* Make the pinned native toolchains present so their tests always run.
 *
 * The backend build services are tested against the real assemblers, because
 * the point of those tests is the exact bytes produced. Previously they skipped
 * themselves where a toolchain was absent, which meant the suite reported green
 * while checking less than it claimed; a test that only runs on one machine is
 * worse than no test.
 *
 * This script obtains each toolchain at the exact revision the product pins,
 * verifies it, and prints the environment the suite needs. What it cannot
 * obtain it says so about, loudly, rather than letting a test quietly disappear.
 *
 * The pinned versions are the container's. Building here rather than using
 * whatever the host happens to have installed is the whole point: a system
 * BeebAsm 1.10 would assemble the same source into different bytes than the
 * pinned 1.11, and the tests assert exact bytes.
 */
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, env, exit, stdout } from 'node:process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cache = env.TOOLCHAIN_CACHE ?? join(root, '.toolchains');
const printEnv = argv.includes('--print-env');

/* Read from the manifests the product ships, so this script cannot pin a
 * different revision than the code that validates it. */
const beebasmManifest = await readFile(join(root, 'backend/src/Build/BeebAsmManifest.php'), 'utf8');
const pinned = (name) => {
  const match = new RegExp(`${name} = '([^']+)'`).exec(beebasmManifest);
  if (!match) throw new Error(`BeebAsmManifest does not declare ${name}`);
  return match[1];
};
const BEEBASM_COMMIT = pinned('COMMIT');
const BEEBASM_VERSION = pinned('UPSTREAM_VERSION');

function run(command, args, options = {}) {
  return new Promise((done) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', (error) => done({ code: -1, output: `${output}${error.message}` }));
    child.on('close', (code) => done({ code: code ?? -1, output }));
  });
}

const notes = [];
const say = (line) => { if (!printEnv) console.log(line); else notes.push(line); };

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

/* ---- BeebAsm --------------------------------------------------------------- */

const beebasmDir = join(cache, 'beebasm');
const beebasmBinary = join(beebasmDir, 'beebasm');

async function ensureBeebAsm() {
  if (await exists(beebasmBinary)) {
    const version = await run(beebasmBinary, ['--help']);
    if (new RegExp(`beebasm\\s+${BEEBASM_VERSION}\\b`, 'i').test(version.output)) {
      say(`BeebAsm ${BEEBASM_VERSION} already built at ${beebasmBinary}`);
      return true;
    }
    say(`Rebuilding: the cached BeebAsm is not ${BEEBASM_VERSION}`);
  }

  await mkdir(cache, { recursive: true });
  if (!await exists(join(beebasmDir, '.git'))) {
    say(`Cloning stardot/beebasm at ${BEEBASM_COMMIT}`);
    const clone = await run('git', ['clone', '--quiet', 'https://github.com/stardot/beebasm.git', beebasmDir]);
    if (clone.code !== 0) { say(`Could not clone BeebAsm: ${clone.output.trim()}`); return false; }
  }
  const checkout = await run('git', ['-C', beebasmDir, 'checkout', '--detach', '--quiet', BEEBASM_COMMIT]);
  if (checkout.code !== 0) {
    await run('git', ['-C', beebasmDir, 'fetch', '--quiet', 'origin']);
    const retry = await run('git', ['-C', beebasmDir, 'checkout', '--detach', '--quiet', BEEBASM_COMMIT]);
    if (retry.code !== 0) { say(`Could not check out ${BEEBASM_COMMIT}: ${retry.output.trim()}`); return false; }
  }
  /* The pin is the commit, not the branch: verify it rather than assume. */
  const head = await run('git', ['-C', beebasmDir, 'rev-parse', 'HEAD']);
  if (head.output.trim() !== BEEBASM_COMMIT) { say(`BeebAsm checkout is ${head.output.trim()}, not the pinned ${BEEBASM_COMMIT}`); return false; }

  /* The same target and flags the container image builds with, taken from
   * backend/Dockerfile, so the binary here is the binary there. */
  say('Building BeebAsm');
  const build = await run('make', [
    '-C', join(beebasmDir, 'src'), '-j', '2', 'code',
    "CXXFLAGS=-O3 -pedantic -DNDEBUG -Wall -W -Wcast-qual -Werror -Wshadow -Wcast-align -Wold-style-cast -Woverloaded-virtual -Wno-array-bounds -Wno-error=use-after-free",
  ], { cwd: beebasmDir });
  if (build.code !== 0 || !await exists(beebasmBinary)) {
    say(`BeebAsm did not build: ${build.output.trim().split('\n').slice(-8).join('\n')}`);
    return false;
  }
  const version = await run(beebasmBinary, ['--help']);
  if (!new RegExp(`beebasm\\s+${BEEBASM_VERSION}\\b`, 'i').test(version.output)) {
    say(`The built BeebAsm does not report ${BEEBASM_VERSION}: ${version.output.trim().split('\n')[0]}`);
    return false;
  }
  say(`Built BeebAsm ${BEEBASM_VERSION} at ${beebasmBinary}`);
  return true;
}

/* ---- report ---------------------------------------------------------------- */

const beebasmReady = await ensureBeebAsm();

/* The product's manifest looks for the licence and the source archive beside
 * the binary; a checkout provides both. */
const environment = beebasmReady ? {
  BEEBASM_PATH: beebasmBinary,
  BEEBASM_SOURCE_PATH: join(beebasmDir, 'README.md'),
  BEEBASM_LICENCE_PATH: join(beebasmDir, 'COPYING.txt'),
} : {};

const cc65 = ['/usr/bin/cc65', '/usr/bin/ca65', '/usr/bin/ld65', '/usr/share/cc65/lib/none.lib'];
const missingCc65 = [];
for (const path of cc65) if (!await exists(path)) missingCc65.push(path);
if (missingCc65.length) say(`cc65 is incomplete: ${missingCc65.join(', ')} missing. Install the pinned cc65 package, or run the backend suite in the native-builder container.`);
else say('cc65 suite present');

/* GNU ARM binutils. The container installs them under /usr/bin; elsewhere a
 * toolchain is commonly unpacked somewhere else entirely, and the build service
 * already reads a path per tool from the environment. Find them rather than
 * insist on one location, and say which was used: the ARM tests assert that two
 * builds of the same source agree, not a hard-coded byte string, so a different
 * binutils release is a difference worth naming but not a reason to skip. */
const ARM_TOOLS = ['as', 'ld', 'objcopy'];
const ARM_SEARCH = [
  '/usr/bin',
  ...(env.ARM_TOOLCHAIN_BIN ? [env.ARM_TOOLCHAIN_BIN] : []),
  ...(env.PATH ?? '').split(':').filter(Boolean),
  join(env.HOME ?? '', 'arm-toolchain/bin'),
];
const missingArm = [];
for (const tool of ARM_TOOLS) {
  let found = null;
  for (const directory of ARM_SEARCH) {
    const candidate = join(directory, `arm-none-eabi-${tool}`);
    if (await exists(candidate)) { found = candidate; break; }
  }
  if (found) environment[`ARM_${tool.toUpperCase()}_PATH`] = found;
  else missingArm.push(`arm-none-eabi-${tool}`);
}
if (missingArm.length) say(`GNU ARM binutils incomplete: ${missingArm.join(', ')} not found. Install binutils-arm-none-eabi, set ARM_TOOLCHAIN_BIN, or run the backend suite in the native-builder container.`);
else {
  const version = await run(environment.ARM_AS_PATH, ['--version']);
  say(`GNU ARM binutils present at ${environment.ARM_AS_PATH} · ${version.output.trim().split('\n')[0]}`);
}

const ready = beebasmReady && !missingCc65.length && !missingArm.length;

if (printEnv) {
  for (const [name, value] of Object.entries(environment)) stdout.write(`${name}=${value}\n`);
  stdout.write(`TOOLCHAINS_READY=${ready ? '1' : '0'}\n`);
  for (const note of notes) stdout.write(`# ${note}\n`);
} else {
  await writeFile(join(cache, 'environment.json'), `${JSON.stringify({ ready, environment, missing: [...missingCc65, ...missingArm] }, null, 2)}\n`);
  console.log(ready ? 'Every pinned native toolchain is present.' : 'Some pinned native toolchains are missing; the tests that need them cannot run here.');
}

exit(ready ? 0 : 1);
