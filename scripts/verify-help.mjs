import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const topics = readFileSync(resolve(root, 'src/help/helpTopics.ts'), 'utf8');
const failures = [];
const screenshotPaths = Array.from(topics.matchAll(/src:\s*["'](\/help\/[a-z0-9-]+\.png)["']/g), match => match[1]);
for (const path of screenshotPaths) {
  if (!existsSync(resolve(root, 'public', path.slice(1)))) failures.push(`Missing help screenshot ${path}`);
}

const source = [
  'src/App.tsx',
  'src/components/HelpWorkspace.tsx',
  'src/components/ProjectSearchWorkspace.tsx',
  'src/components/RomManagerWorkspace.tsx',
  'src/components/ArchimedesFirmwareWorkspace.tsx',
].map(path => readFileSync(resolve(root, path), 'utf8')).join('\n');
const maintainedControls = [
  'Save all project files in browser', 'Open technical help', 'Choose Acorn file',
  'Build all', 'Run', 'Pause', 'Step over', 'Apply permanent', 'Clear all',
  'New plan', 'Build &amp; run test', 'Add live build target', 'Search reference',
  'Search help', 'Import ROM set', 'Replace all',
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
