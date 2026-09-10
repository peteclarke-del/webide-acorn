#!/usr/bin/env node
/*
 * Runs a generated BeebSID player on the machine and reads the chip back.
 *
 * The song editor generates a player that writes the 6581's registers
 * directly. Whether it writes the right ones is not something to assert from
 * the source text: the player runs here on a Model B with BeebSID fitted, one
 * row at a time, and the chip's register file is read after each, through the
 * same SID engine the workbench's runtime fits. The values are recorded in
 * src/assets/sidSongMeasurements.ts and held by tests that need no firmware.
 *
 * ROMs are never committed. Run this against firmware you already have:
 *
 *   node scripts/measureSidSong.mjs <directory containing roms/>
 */
import { argv, exit } from 'node:process';
import { resolve } from 'node:path';
import { TestMachine } from 'jsbeeb/tests/test-machine.js';
import { setNodeBasePath } from 'jsbeeb/src/utils.js';

async function main() {
  const base = argv[2];
  if (!base) {
    console.error('Give the directory holding the roms/ tree this build reads firmware from.');
    exit(2);
  }
  setNodeBasePath(resolve(base));
  const { assemble6502 } = await import('../src/build/assembler6502.ts');
  const { fitBeebSid } = await import('../src/emulator/beebSidBus.ts');
  const { MEASURED_SONG, measuredSongDocument } = await import('../src/assets/sidSongMeasurements.ts');
  const { generateSongOutput, songLabel } = await import('../src/assets/songDocument.ts');

  const machine = new TestMachine('B');
  await machine.initialise();
  const sid = fitBeebSid(machine.processor);
  machine.startCapture();
  let banner = '';
  for (let index = 0; index < 40 && !banner.trimEnd().endsWith('>'); index += 1) {
    await machine.runFor(1_000_000);
    banner += machine.drainText({ raw: true });
  }
  console.log('machine:', JSON.stringify(banner.split('\n').filter(Boolean)[0]), 'with BeebSID at &FC20');

  const document = measuredSongDocument();
  const output = generateSongOutput(document);
  const label = songLabel(document.name);
  /* Reset, then one row per call: the harness calls the player as a program would. */
  const source = `ORG &2000\n.start\n  JSR ${label}_reset\n.done\n  RTS\n.row\n  JSR ${label}_play_row\n.row_done\n  RTS\n${output.assembly}\n`;
  const artifact = assemble6502(source, '6502', 0x2000, {}, 'bbc-b');
  const problems = artifact.diagnostics.filter((item) => item.severity !== 'info');
  if (problems.length) throw new Error(`the player did not assemble: ${problems.map((item) => item.message).join('; ')}`);
  for (let offset = 0; offset < artifact.bytes.length; offset += 1) machine.writebyte(0x2000 + offset, artifact.bytes[offset]);

  const runTo = async (entry, stop) => {
    machine.processor.pc = entry;
    let reached = false;
    const hook = machine.processor.debugInstruction.add((address) => { if (address === stop) reached = true; return false; });
    for (let index = 0; index < 20 && !reached; index += 1) await machine.runFor(10_000);
    hook.remove();
    if (!reached) throw new Error(`the player never reached &${stop.toString(16)}`);
  };
  const registers = () => sid.snapshotState().registers.slice(0, 0x19).map((value) => `&${value.toString(16).toUpperCase().padStart(2, '0')}`).join(' ');

  await runTo(artifact.symbols.START, artifact.symbols.DONE);
  console.log(`after reset:  ${registers()}`);
  for (let row = 0; row < MEASURED_SONG.rows; row += 1) {
    await runTo(artifact.symbols.ROW, artifact.symbols.ROW_DONE);
    console.log(`after row ${row}:  ${registers()}`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) await main();
