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
import { readLockfile, renderSbom, sbomSummary } from './sbom.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Package names referenced anywhere in the built output. */
async function namesInBuild(lockfile) {
  const names = new Set();
  let text = '';
  const walk = async (directory) => {
    let entries = [];
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { await walk(path); continue; }
      if (!/\.(m?js|css|html|json|map)$/.test(entry.name)) continue;
      try { text += await readFile(path, 'utf8'); } catch { /* a binary asset */ }
    }
  };
  await walk(join(root, 'dist'));
  for (const path of Object.keys(lockfile.packages ?? {})) {
    if (!path) continue;
    const name = path.replace(/^.*node_modules\//, '');
    if (text.includes(name)) names.add(name);
  }
  return names;
}

const lockfile = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const built = await namesInBuild(lockfile);
const entries = readLockfile(lockfile, built);

let audit = null;
try {
  const { stdout } = await promisify(execFile)('npm', ['audit', '--json'], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  audit = JSON.parse(stdout).metadata?.vulnerabilities ?? null;
} catch (error) {
  /* `npm audit` exits non-zero when it finds something, and still prints. */
  try { audit = JSON.parse(error.stdout ?? '{}').metadata?.vulnerabilities ?? null; } catch { audit = null; }
}

await writeFile(join(root, 'docs', 'sbom.md'), renderSbom(entries, audit), 'utf8');
const summary = sbomSummary(entries);
console.log(`${summary.total} installed · ${summary.shipped} distributed · ${summary.development} development · ${summary.installedNotDistributed} installed but not distributed`);
console.log(`licences needing a person: ${summary.shippedCopyleft + summary.shippedOther + summary.shippedUndetermined}`);
