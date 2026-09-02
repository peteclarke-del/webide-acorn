#!/usr/bin/env node
/*
 * Builds each starter template and runs it on the machine it was written for.
 *
 * A starter is the first thing somebody sees of a machine, so being nearly
 * right about it is worse than useless: a program that assembles cleanly and
 * calls the wrong addresses looks like a working example until it is run. And
 * the machines really do differ — the Atom's OSWRCH is at &FFF4 where the BBC's
 * is at &FFEE, and a carriage return on an Atom returns to column zero without
 * moving down a line, so a program that writes one where a BBC would writes its
 * second line over its first.
 *
 * Both of those were found this way rather than read: by assembling the
 * template, placing it in a real machine's memory, calling it, and reading the
 * screen the machine drew.
 *
 * ROMs are never committed. Run this against firmware you already have:
 *
 *   node scripts/measureStarterTemplates.mjs <directory containing roms/>
 */
import { argv, exit } from 'node:process';
import { resolve } from 'node:path';
import { TestMachine } from 'jsbeeb/tests/test-machine.js';
import { setNodeBasePath } from 'jsbeeb/src/utils.js';

/** Which machine each template is run on, and how its output is read. */
export const RUNS = Object.freeze([
  { templateId: 'bbc-b-mode7-6502', model: 'B', origin: 0x1900, read: 'wrchv' },
  { templateId: 'master-mode7-6502', model: 'Master', origin: 0x1900, read: 'wrchv' },
  /* The B+ is not one of the engine's machines, so this one is built here; the
   * script that measures it boots it the same way and asks the same questions. */
  { templateId: 'bbc-bplus-shadow-6502', model: 'BPlus', origin: 0x1900, read: 'wrchv' },
  /* The Atom's characters do not pass through a vector this harness can watch,
   * so its screen memory is read instead — in the Atom's own character codes,
   * where 0x00-0x1F are @A-Z[\]^_ and 0x20-0x3F the digits and punctuation. */
  { templateId: 'atom-text-6502', model: 'Atom-Tape', origin: 0x2900, read: 'screen' },
]);

const decodeAtomScreen = (bytes) => bytes
  .map((byte) => { const value = byte & 0x3f; return String.fromCharCode(value < 0x20 ? 0x40 + value : value); })
  .join('')
  .match(/.{32}/g)
  .map((line) => line.replace(/\s+$/, ''))
  .filter(Boolean);

/** Place the program, call it the way BASIC would, and give it a key. */
export async function runTemplate({ model, origin, read }, bytes, { call, key = 'K' }) {
  const machine = new TestMachine(model);
  await machine.initialise();
  machine.startCapture();
  await machine.runUntilInput(30);
  machine.drainText({ raw: true });
  for (let index = 0; index < bytes.length; index += 1) machine.writebyte(origin + index, bytes[index]);
  await machine.type(call);
  let printed = '';
  for (let i = 0; i < 8; i += 1) { await machine.runFor(2_000_000); printed += machine.drainText({ raw: true }); }
  await machine.type(key);
  for (let i = 0; i < 6; i += 1) { await machine.runFor(1_000_000); printed += machine.drainText({ raw: true }); }
  /* The machine has to be usable afterwards: a starter that leaves BASIC broken
   * has not returned cleanly, however right its output looked. */
  await machine.type('PRINT 6*7');
  for (let i = 0; i < 6; i += 1) { await machine.runFor(1_000_000); printed += machine.drainText({ raw: true }); }
  let screen = null;
  if (read === 'screen') {
    const bytesRead = [];
    for (let i = 0; i < 512; i += 1) bytesRead.push(machine.readbyte(0x8000 + i));
    screen = decodeAtomScreen(bytesRead);
  }
  return { printed, screen };
}

async function main() {
  const base = argv[2];
  if (!base) {
    console.error('Give the directory holding the roms/ tree this build reads firmware from.');
    exit(2);
  }
  setNodeBasePath(resolve(base));
  const { TEMPLATE_CATALOGUE } = await import('../src/project/templateCatalogue.ts');
  const { assemble6502 } = await import('../src/build/assembler6502.ts');
  const { toolchainFor } = await import('../src/build/buildTarget.ts');

  let failures = 0;
  for (const run of RUNS) {
    const template = TEMPLATE_CATALOGUE.find((candidate) => candidate.id === run.templateId);
    if (!template) { console.error(`no template called ${run.templateId}`); failures += 1; continue; }
    const source = template.files.find((file) => file.name === template.entryFileName).content;
    const processor = toolchainFor(template.toolchainId).processor === '65c02' ? '65c02' : '6502';
    const artifact = assemble6502(source, processor, run.origin, {}, template.target.machineId);
    const problems = artifact.diagnostics.filter((item) => item.severity !== 'info');
    if (problems.length) { console.error(run.templateId, 'did not assemble:', problems.map((item) => item.message)); failures += 1; continue; }
    const call = run.model === 'Atom-Tape' ? `LINK#${run.origin.toString(16).toUpperCase()}` : `CALL &${run.origin.toString(16).toUpperCase()}`;
    const result = await runTemplate(run, artifact.bytes, { call });
    console.log(run.templateId, 'on', run.model, '-', artifact.bytes.length, 'bytes');
    console.log('   printed:', JSON.stringify(result.printed));
    if (result.screen) console.log('   screen:', JSON.stringify(result.screen));
    const shown = result.screen ? result.screen.join('\n') : result.printed;
    if (!shown.includes('8BIT-NET DEV')) { console.error('   the banner never appeared'); failures += 1; }
    if (!/42/.test(shown)) { console.error('   BASIC did not answer afterwards, so the program did not return cleanly'); failures += 1; }
  }
  if (failures) exit(1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) await main();
