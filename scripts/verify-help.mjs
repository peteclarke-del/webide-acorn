import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const topics = readFileSync(resolve(root, 'src/help/helpTopics.ts'), 'utf8');
const failures = [];
const screenshotPaths = Array.from(topics.matchAll(/src:\s*["'](\/help\/[a-z0-9-]+\.png)["']/g), match => match[1]);
for (const path of screenshotPaths) {
  if (!existsSync(resolve(root, 'public', path.slice(1)))) failures.push(`Missing help screenshot ${path}`);
}

/*
 * The whole interface, not a list of five files somebody remembered to extend.
 * A control the guide names can live in any workspace, and naming the files by
 * hand meant a control that moved into one of the others read as missing.
 */
const source = [
  readFileSync(resolve(root, 'src/App.tsx'), 'utf8'),
  ...readdirSync(resolve(root, 'src/components'))
    .filter(name => name.endsWith('.tsx') && !name.endsWith('.test.tsx'))
    .map(name => readFileSync(resolve(root, 'src/components', name), 'utf8')),
].join('\n');
/*
 * Controls the guide tells somebody to choose by name.
 *
 * The guide went on telling people to click six things in a toolbar long after
 * they had moved into menus, and nothing noticed, because a procedure is prose
 * and prose does not fail. Naming them here is what makes a move break
 * something: rename or remove one and this stops passing, which is the moment
 * to fix the sentence that names it too.
 */
const maintainedControls = [
  'Save all project files in browser', 'Open technical help', 'Choose Acorn file',
  'Build all', 'Run', 'Pause', 'Step over', 'Apply permanent', 'Clear all',
  'New plan', 'Build &amp; run test', 'Add live font build target', 'Search reference',
  'Search help', 'Import ROM set', 'Replace all',
  /* Named by the procedures that were corrected when the menu bars arrived. */
  'Start a project from a sample or a template', 'Start a project from an existing codebase folder', 'Export portable project',
  'Compare saved', 'Split editor', 'Reset split', 'Signature help',
  'Definition / Research', 'Call hierarchy', 'Declaration', 'Implementation',
  'Type definition', 'Add generated source', 'Add EQUB source', 'Add build target',
  'Declare tile', 'Add object at cursor',
  /* And the workbench menu bar's own entries, which are what the guide's
   * procedures now tell somebody to choose. */
  'Start from a sample', 'Open a codebase…', 'Export…', 'Revert', 'Signature help', 'Import image…',
  'Import Tiled…', 'Previous change', 'Next change', 'Scope start',
];
for (const control of maintainedControls) {
  if (!source.includes(control)) failures.push(`Documented control is absent from the interface source: ${control}`);
}
if (screenshotPaths.length < 10) failures.push(`Expected at least 10 maintained workflow screenshots, found ${screenshotPaths.length}`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Help verification passed: ${screenshotPaths.length} references and ${maintainedControls.length} maintained controls.`);
