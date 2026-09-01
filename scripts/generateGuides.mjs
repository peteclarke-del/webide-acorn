/* Write the standalone user guides, or check that what is committed is what
 * would be written.
 *
 * `--check` is what the gate runs. Generating into the working tree during a
 * release would make the check pass by definition, which is not a check; so the
 * gate renders in memory and compares, and a topic edited without regenerating
 * fails rather than shipping a book that describes an older product.
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { guideFiles, unavailableFailures, unpublishedTopics } from './userGuides.mjs';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = join(root, 'docs/guide');
const check = process.argv.includes('--check');

/* The topics are TypeScript, so they are bundled the same way the benchmark
 * declarations are, rather than parsed out of the source with a regular
 * expression that would agree with the file only by luck. */
async function loadTopics() {
  const scratch = await mkdtemp(join(tmpdir(), 'guides-'));
  try {
    const bundle = join(scratch, 'helpTopics.mjs');
    await run('npx', ['esbuild', join(root, 'src/help/helpTopics.ts'), '--bundle', '--format=esm', `--outfile=${bundle}`], { cwd: root });
    return (await import(`file://${bundle}`)).HELP_TOPICS;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

const topics = await loadTopics();
const failures = [];

const unpublished = unpublishedTopics(topics);
if (unpublished.length > 0) {
  failures.push(`These topics are in the IDE and in no published guide: ${unpublished.join(', ')}. Add them to an area in scripts/userGuides.mjs.`);
}

const interfaceSource = (await Promise.all(
  (await readdir(join(root, 'src/components'))).filter((name) => name.endsWith('.tsx') && !name.includes('.test.'))
    .map((name) => readFile(join(root, 'src/components', name), 'utf8')),
)).join('\n') + await readFile(join(root, 'src/App.tsx'), 'utf8');
failures.push(...unavailableFailures(interfaceSource));

let files;
try {
  files = guideFiles(topics);
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
}

if (files && check) {
  for (const [name, content] of files) {
    const path = join(outputDir, name);
    if (!existsSync(path)) {
      failures.push(`docs/guide/${name} has not been generated. Run npm run guides.`);
      continue;
    }
    if ((await readFile(path, 'utf8')) !== content) {
      failures.push(`docs/guide/${name} differs from what the help topics would produce. Run npm run guides and commit the result.`);
    }
  }
  const present = existsSync(outputDir) ? await readdir(outputDir) : [];
  for (const name of present) {
    if (!files.has(name)) failures.push(`docs/guide/${name} is not produced by any area and would be read as a maintained guide. Remove it or give it an area.`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

if (files && !check) {
  await mkdir(outputDir, { recursive: true });
  for (const [name, content] of files) await writeFile(join(outputDir, name), content, 'utf8');
}

const words = files ? [...files.values()].join(' ').split(/\s+/).length : 0;
console.log(check
  ? `User guides match the help topics: ${files.size} files, ${topics.length} procedures.`
  : `Wrote ${files.size} user guides covering ${topics.length} procedures, about ${words.toLocaleString('en-GB')} words.`);
