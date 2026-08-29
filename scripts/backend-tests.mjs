#!/usr/bin/env node
/* Run the backend suite with the pinned toolchains present.
 *
 * The build-service tests exercise the real assemblers, so they need those
 * assemblers. Rather than let a missing one turn into a skipped test, this
 * obtains what it can, publishes the paths, runs the suite, and then insists
 * that nothing was skipped: a run that quietly checked less than the whole
 * suite is a failure here, because the suite is the evidence.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, exit } from 'node:process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function run(command, args, options = {}) {
  return new Promise((done) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => { output += chunk; process.stderr.write(chunk); });
    child.on('error', (error) => done({ code: -1, output: `${output}${error.message}` }));
    child.on('close', (code) => done({ code: code ?? -1, output }));
  });
}

/* `--print-env` reports what it found without writing to the console, so the
 * assignments can be read straight out of its output. */
const discovery = await new Promise((done) => {
  const child = spawn('node', ['scripts/toolchains.mjs', '--print-env'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  child.on('close', (code) => done({ code: code ?? -1, output }));
});

const toolchainEnv = {};
for (const line of discovery.output.split('\n')) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match) toolchainEnv[match[1]] = match[2];
}
for (const line of discovery.output.split('\n')) if (line.startsWith('# ')) console.log(line.slice(2));

if (toolchainEnv.TOOLCHAINS_READY !== '1') {
  console.error('\nThe pinned native toolchains are not all present, so the backend suite would not run in full.');
  console.error('Obtain them with `npm run toolchains`, or run this suite in the native-builder container.');
  exit(1);
}

console.log('');
const result = await run('vendor/bin/phpunit', ['--display-skipped'], {
  cwd: resolve(root, 'backend'),
  env: { ...env, ...toolchainEnv },
});

/* A skipped test is not a passing test. The suite is the evidence the product
 * is correct, and a run that skipped part of it is evidence of less. */
const skipped = /Skipped:\s*(\d+)/.exec(result.output);
if (skipped && Number(skipped[1]) > 0) {
  console.error(`\n${skipped[1]} backend test(s) were skipped. Every test must run; see the messages above for what was missing.`);
  exit(1);
}
exit(result.code === 0 ? 0 : 1);
