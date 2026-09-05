/* Write the typed client contracts, or check that what is committed is what the
 * description would produce.
 *
 * `--check` is what the gate runs, and it compares rather than regenerates: a
 * stage that writes the file it is about to inspect passes by definition. A
 * description edited without regenerating fails here, which is the whole point
 * of generating rather than writing the types twice.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { operations, renderContracts } from './apiDescription.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'src/api/contracts.ts');
const check = process.argv.includes('--check');

const document = JSON.parse(await readFile(join(root, 'api/openapi.json'), 'utf8'));
const rendered = renderContracts(document);
const declared = operations(document);

if (check) {
  if (!existsSync(target)) {
    console.error('src/api/contracts.ts has not been generated. Run npm run api:types.');
    process.exit(1);
  }
  if ((await readFile(target, 'utf8')) !== rendered) {
    console.error('src/api/contracts.ts differs from what api/openapi.json would produce. Run npm run api:types and commit the result.');
    process.exit(1);
  }
  console.log(`Client contracts match the description: ${declared.length} operations, ${Object.keys(document.components.schemas).length} schemas.`);
} else {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, rendered, 'utf8');
  console.log(`Wrote src/api/contracts.ts: ${declared.length} operations, ${Object.keys(document.components.schemas).length} schemas.`);
}
