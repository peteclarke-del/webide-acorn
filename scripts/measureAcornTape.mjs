#!/usr/bin/env node
/*
 * Makes real Acorn machines load tapes this build wrote, and records what they
 * did.
 *
 * The Acorn tape block format is the operating system's, not the emulator's. A
 * UEF reader decodes the container and hands the bytes to the machine; nothing
 * in the reader knows what a file header is, what a checksum covers, or where a
 * block should land. So a tape with a wrong checksum does not fail to open — it
 * simply never finishes loading, quietly, on the machine.
 *
 * That means the encoder cannot be tested against a specification alone. It is
 * tested against machines: a BBC B, a BBC Master and an Acorn Atom are booted on
 * the pinned jsbeeb core this build ships, the tape is mounted, the load command
 * is typed at the keyboard, and what the machine prints and what lands in its
 * memory are both read back. The output is written to
 * `src/media/acornTapeMeasurements.ts`, which the always-running tests in
 * `src/media/acornTape.test.ts` compare the encoder against. That is what lets
 * those tests hold the encoder to real machine behaviour on a checkout that has
 * no copyright ROMs.
 *
 * Three findings came out of this and none could have been assumed: the Atom
 * sums the four synchronising asterisks into its check byte, every Atom block
 * carries its own load address rather than the file's, and the Atom needs a full
 * leader before every block and not only the first.
 *
 * ROMs are never committed. Run this against firmware you already have:
 *
 *   node scripts/measureAcornTape.mjs <directory containing roms/>
 *
 * where the directory holds `roms/os.rom`, `roms/BASIC.ROM`,
 * `roms/b/DFS-0.9.rom`, the Master set and `roms/atom/Atom_Kernel.rom`, laid out
 * the way jsbeeb asks for them.
 */
import { argv, exit } from 'node:process';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { TestMachine } from 'jsbeeb/tests/test-machine.js';
import { setNodeBasePath } from 'jsbeeb/src/utils.js';
import { loadTapeFromData } from 'jsbeeb/src/tapes.js';
import * as Tokeniser from 'jsbeeb/src/basic-tokenise.js';

const hex = (bytes) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/** The payloads under test, generated so a test can rebuild them exactly. */
export function measurementPayload(length, step, seed) {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = (i * step + (i >> 8) * 3 + seed) & 0xff;
  return bytes;
}

async function boot(model) {
  const machine = new TestMachine(model);
  await machine.initialise();
  machine.startCapture();
  await machine.runUntilInput(30);
  machine.drainText({ raw: true });
  return machine;
}

/** Mount a tape on a BBC-family machine and load a file from it by name. */
export async function bbcLoad(model, file, image) {
  const machine = await boot(model);
  machine.processor.acia.setTape(await loadTapeFromData('game.uef', image, machine.model));
  await machine.type('*TAPE');
  await machine.runFor(1_000_000);
  machine.drainText({ raw: true });
  await machine.type(`*LOAD ${file.name}`);
  let transcript = '';
  for (let i = 0; i < 40; i += 1) {
    await machine.runFor(2_000_000);
    transcript += machine.drainText({ raw: true });
    if (transcript.trimEnd().endsWith('>')) break;
  }
  const memory = [];
  for (let i = 0; i < file.bytes.length; i += 1) memory.push(machine.readbyte(file.loadAddress + i));
  return { transcript, loaded: memory.every((byte, index) => byte === file.bytes[index]) };
}

/** Chain a tokenised BASIC program from tape and let the machine run it. */
export async function bbcChain(model, name, source, image) {
  const machine = await boot(model);
  machine.processor.acia.setTape(await loadTapeFromData('prog.uef', image, machine.model));
  await machine.type('*TAPE');
  await machine.runFor(1_000_000);
  machine.drainText({ raw: true });
  await machine.type(`CHAIN"${name}"`);
  let transcript = '';
  for (let i = 0; i < 60; i += 1) {
    await machine.runFor(2_000_000);
    transcript += machine.drainText({ raw: true });
    if (/DONE/.test(transcript)) break;
  }
  return { transcript, source };
}

/*
 * The Atom's tape has no motor line, so the emulated deck is started by hand the
 * way somebody presses play; and the ROM prints PLAY TAPE and then waits for a
 * key before it starts listening, which is why a bare RETURN is typed.
 */
export async function atomLoad(file, image) {
  const machine = await boot('Atom-Tape');
  machine.processor.atomppia.setTape(await loadTapeFromData('game.uef', image, machine.model));
  await machine.type(`*LOAD"${file.name}"`);
  await machine.runFor(500_000);
  await machine.type('');
  machine.processor.atomppia.playTape();
  let transcript = '';
  for (let i = 0; i < 120; i += 1) {
    await machine.runFor(1_000_000);
    transcript += machine.drainText({ raw: true });
    if (transcript.trimEnd().endsWith('>')) break;
  }
  const memory = [];
  for (let i = 0; i < file.bytes.length; i += 1) memory.push(machine.readbyte(file.loadAddress + i));
  return { transcript, loaded: memory.every((byte, index) => byte === file.bytes[index]) };
}

async function main() {
  const base = argv[2];
  if (!base) {
    console.error('Give the directory holding the roms/ tree this build reads firmware from.');
    exit(2);
  }
  setNodeBasePath(resolve(base));
  const { createTapeImage, createAtomTapeImage, encodeTapeFile, encodeAtomTapeFile } =
    await import('../src/media/acornTape.ts').catch(() => {
      console.error('Transpile src/media/acornTape.ts first, or run this through a TypeScript-aware loader.');
      exit(2);
    });

  const bbcFile = { name: 'GAME', loadAddress: 0x3000, executionAddress: 0x3000, bytes: measurementPayload(320, 7, 3) };
  const atomFile = { name: 'GAME', loadAddress: 0x2900, executionAddress: 0x2900, bytes: measurementPayload(600, 7, 11) };
  const bbcImage = createTapeImage([bbcFile]);
  const atomImage = createAtomTapeImage([atomFile]);

  const tokeniser = await Tokeniser.create();
  const basicSource = '10 PRINT "TAPE LOADED"\n20 PRINT "DONE"\n';
  const tokenised = Uint8Array.from([...tokeniser.tokenise(basicSource)].map((character) => character.charCodeAt(0)));
  const basicFile = { name: 'HELLO', loadAddress: 0x1900, executionAddress: 0x801f, bytes: tokenised };

  const results = {
    bbcB: await bbcLoad('B', bbcFile, bbcImage),
    master: await bbcLoad('Master', bbcFile, bbcImage),
    bbcChain: await bbcChain('B', 'HELLO', basicSource, createTapeImage([basicFile])),
    atom: await atomLoad(atomFile, atomImage),
  };

  const measured = {
    bbcBlocks: encodeTapeFile(bbcFile).map(hex),
    bbcImage: hex(bbcImage),
    atomBlocks: encodeAtomTapeFile(atomFile).map(hex),
    atomImage: hex(atomImage),
    tokenisedBasic: hex(tokenised),
    results,
  };
  const out = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'ci', 'results', 'acorn-tape-measurements.json');
  await writeFile(out, `${JSON.stringify(measured, null, 2)}\n`);
  for (const [name, result] of Object.entries(results)) {
    console.log(name, JSON.stringify(result.transcript), 'loaded' in result ? `loaded=${result.loaded}` : '');
  }
  console.log(`written ${out}`);
  if (!results.bbcB.loaded || !results.master.loaded || !results.atom.loaded) {
    console.error('A machine did not load every byte; the encoder and the measurements disagree.');
    exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
