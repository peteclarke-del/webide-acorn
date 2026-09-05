#!/usr/bin/env node
/* Writes docs/sbom.md from the lockfile, the built output and `npm audit`.
 *
 * The built output matters: whether a package is distributed is decided by
 * whether it can be in what ships, not by a flag in the lockfile. */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { namesInBuild, readLockfile, renderBackendSection, renderSbom, sbomSummary } from './sbom.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const lockfile = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const built = await namesInBuild(lockfile, root);
const entries = readLockfile(lockfile, built);

/* The backend's dependencies ship with its own image, so they belong in this
 * inventory. Absence is reported in the document rather than passed over, so a
 * generation without PHP available cannot look like a backend with nothing in
 * it. */
let backend = null;
try {
  const { stdout } = await promisify(execFile)('composer', ['licenses', '--format=json', '--no-interaction'], { cwd: join(root, 'backend'), maxBuffer: 8 * 1024 * 1024 });
  backend = JSON.parse(stdout).dependencies ?? null;
} catch { backend = null; }

let audit = null;
try {
  const { stdout } = await promisify(execFile)('npm', ['audit', '--json'], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  audit = JSON.parse(stdout).metadata?.vulnerabilities ?? null;
} catch (error) {
  /* `npm audit` exits non-zero when it finds something, and still prints. */
  try { audit = JSON.parse(error.stdout ?? '{}').metadata?.vulnerabilities ?? null; } catch { audit = null; }
}

await writeFile(join(root, 'docs', 'sbom.md'), renderSbom(entries, audit, backend), 'utf8');
const summary = sbomSummary(entries);
console.log(`${summary.total} installed · ${summary.shipped} distributed · ${summary.development} development · ${summary.installedNotDistributed} installed but not distributed`);
console.log(`licences needing a person: ${summary.shippedCopyleft + summary.shippedOther + summary.shippedUndetermined}`);
