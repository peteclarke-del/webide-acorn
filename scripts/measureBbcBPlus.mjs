#!/usr/bin/env node
/*
 * Boots the BBC Model B+ this build adds, and asks the machine about itself.
 *
 * The B+ here is not the engine's — jsbeeb publishes none, in the pinned
 * version or the current one — so every claim about it is a claim about code
 * written for this product. The only way to make such a claim worth anything is
 * to put the questions to the machine and record what it answers.
 *
 * Three questions, each chosen because a Model B or a Master gives a different
 * and visibly wrong answer to it:
 *
 *   - What are you? A Model B says "BBC Computer 32K". A B+ 64K says
 *     "Acorn OS 64K", and nothing else does.
 *   - What does a shadow mode cost? On a Model B the twenty-kilobyte screen
 *     drops HIMEM to &3000. On a B+ it stays at &8000, because the screen is
 *     not in the program's memory at all.
 *   - How much RAM is at &8000 when it is paged in? A Master has four
 *     kilobytes there and a B+ has twelve, so the top of the twelve is where
 *     the two machines part company.
 *
 * A fourth is asked to settle what is *not* offered: how the operating system
 * counts sideways RAM, and therefore why the B+ 128 is described rather than
 * run.
 *
 * ROMs are never committed. Run this against firmware you already have:
 *
 *   node scripts/measureBbcBPlus.mjs <directory containing roms/>
 *
 * where the directory holds `roms/bplus/os2.rom`, `roms/bplus/BASIC2.ROM` and
 * `roms/bplus/dfs223.rom`. On a real B+ 64K the operating system and BASIC
 * share one 32 KiB part at IC71 — the operating system is its upper half.
 */
import { argv, exit } from 'node:process';
import { resolve } from 'node:path';
import { TestMachine } from 'jsbeeb/tests/test-machine.js';
import { findModel } from 'jsbeeb/src/models.js';
import { setNodeBasePath } from 'jsbeeb/src/utils.js';
import { FakeVideo } from 'jsbeeb/src/video.js';
import { FakeSoundChip } from 'jsbeeb/src/soundchip.js';
import { FakeDdNoise } from 'jsbeeb/src/ddnoise.js';
import { FakeRelayNoise } from 'jsbeeb/src/relaynoise.js';
import { FakeMusic5000 } from 'jsbeeb/src/music5000.js';
import { Cmos } from 'jsbeeb/src/cmos.js';

export const FIRMWARE = Object.freeze(['bplus/os2.rom', 'bplus/BASIC2.ROM', 'bplus/dfs223.rom']);

/**
 * A B+ ready at its prompt.
 *
 * jsbeeb's own helper waits for the Model B's idle address, and the B+ is a
 * different operating system that idles somewhere else — so the prompt it
 * prints is the signal, which is the machine's rather than an address somebody
 * assumed.
 */
export async function bootBPlus({ BPlusCpu6502, bplusModelFrom }, swram) {
  const model = bplusModelFrom(findModel('B1770'), { os: FIRMWARE, ...(swram ? { swram } : {}) });
  const machine = new TestMachine('B1770');
  machine.model = model;
  machine.processor = new BPlusCpu6502(model, {
    dbgr: { setCpu: () => {} }, video: new FakeVideo(), soundChip: new FakeSoundChip(),
    ddNoise: new FakeDdNoise(), relayNoise: new FakeRelayNoise(), music5000: new FakeMusic5000(),
    cmos: new Cmos(), config: {},
  });
  await machine.initialise();
  machine.startCapture();
  let banner = '';
  for (let i = 0; i < 40 && !banner.trimEnd().endsWith('>'); i += 1) {
    await machine.runFor(1_000_000);
    banner += machine.drainText({ raw: true });
  }
  if (!banner.includes('Acorn OS')) throw new Error(`the machine never introduced itself: ${JSON.stringify(banner)}`);
  return { machine, banner: banner.trim() };
}

/** Type a line and give back everything the machine printed in reply. */
export async function ask(machine, line) {
  await machine.type(line);
  let text = '';
  for (let i = 0; i < 8; i += 1) { await machine.runFor(2_000_000); text += machine.drainText({ raw: true }); }
  return text.trim();
}

/*
 * Page the twelve kilobytes in, write to both ends of it, read them back, then
 * put the ROM back and read &8000 again. The machine's own copy of ROMSEL at
 * &F4 is saved and restored, because the operating system keeps one and a
 * routine that changes the register behind its back leaves it confused.
 */
export const PAGED_RAM_PROBE = `
ORG &7000
.start
  LDA &F4
  PHA
  LDA #&80
  STA &F4
  STA &FE30
  LDA #&5A
  STA &8000
  LDA #&A5
  STA &AFFF
  LDA &8000
  STA &7100
  LDA &AFFF
  STA &7101
  PLA
  STA &F4
  STA &FE30
  LDA &8000
  STA &7102
  RTS
`;

async function main() {
  const base = argv[2];
  if (!base) {
    console.error('Give the directory holding the roms/ tree this build reads firmware from.');
    exit(2);
  }
  setNodeBasePath(resolve(base));
  const bplus = await import('../src/emulator/bbcBPlus.ts');
  const { assemble6502 } = await import('../src/build/assembler6502.ts');

  const { machine, banner } = await bootBPlus(bplus);
  console.log('what it calls itself:', JSON.stringify(banner));

  for (const line of ['MODE 7:PRINT ~PAGE,~HIMEM', 'MODE 135:PRINT ~PAGE,~HIMEM', 'MODE 128:PRINT ~PAGE,~HIMEM']) {
    console.log(`${line} -> ${JSON.stringify(await ask(machine, line))}`);
  }

  /* A shadow mode, so the twenty-kilobyte screen is out of the way, and HIMEM
   * lowered so BASIC keeps out of the routine. */
  await ask(machine, 'MODE 135:HIMEM=&7000');
  const artifact = assemble6502(PAGED_RAM_PROBE, '6502', 0x7000, {}, 'bbc-bplus');
  const problems = artifact.diagnostics.filter((item) => item.severity !== 'info');
  if (problems.length) { console.error('the probe did not assemble:', problems.map((item) => item.message)); exit(1); }
  for (let index = 0; index < artifact.bytes.length; index += 1) machine.writebyte(0x7000 + index, artifact.bytes[index]);
  await ask(machine, 'CALL &7000');
  console.log('paged RAM at &8000, at &AFFF, then the ROM underneath:',
    JSON.stringify(await ask(machine, 'PRINT ~?&7100,~?&7101,~?&7102')));

  console.log('how the operating system counts sideways RAM:');
  for (const banks of [[], [0, 1], [0, 1, 2, 3], [0, 1, 2, 3, 4, 5, 6, 7], [4, 5, 6, 7]]) {
    const swram = Array.from({ length: 16 }, (_, bank) => banks.includes(bank));
    const { banner: fitted } = await bootBPlus(bplus, swram);
    console.log(`   banks ${JSON.stringify(banks).padEnd(22)} -> ${JSON.stringify(fitted.split('\n')[0])}`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) await main();
