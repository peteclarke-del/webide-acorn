#!/usr/bin/env node
/*
 * Boots each parasite behind each host, and reads what the parasite says.
 *
 * The engine picks a second processor by host: the Turbo board for a Master,
 * the 6502 board for everything else, because that is what Acorn sold for each.
 * That is the right default and the wrong rule. A PiTube Direct puts a 65C102
 * behind whatever machine it is plugged into, and the game this is being got
 * ready for is a Model B with one.
 *
 * Nothing needs to be argued about this, because the parasite introduces
 * itself: the 6502 board's ROM prints `Acorn TUBE 6502 64K` and the 65C102
 * board's prints `Acorn TUBE 65C102 Co-Processor`. Whichever string reaches the
 * screen is which ROM is running.
 *
 * PAGE and HIMEM are asked for too. Those come from the parasite once the
 * language has been transferred, so they say the language really did cross.
 *
 * ROMs are never committed. Run this against firmware you already have:
 *
 *   node scripts/measureTubeParasite.mjs <directory containing roms/>
 */
import { argv, exit } from 'node:process';
import { resolve } from 'node:path';
import { TestMachine } from 'jsbeeb/tests/test-machine.js';
import { findModel, TubeModel, TurboTubeModel } from 'jsbeeb/src/models.js';
import { setNodeBasePath } from 'jsbeeb/src/utils.js';
import { Cpu6502 } from 'jsbeeb/src/6502.js';
import { FakeVideo } from 'jsbeeb/src/video.js';
import { FakeSoundChip } from 'jsbeeb/src/soundchip.js';

/** A Model B needs the Tube host code in a bank; a Master carries its own. */
export const TUBE_HOST_ROM = 'b/dnfs120.rom';

async function boot(modelName, parasite, extraRoms, createBbcCpu) {
  const model = findModel(modelName);
  const machine = new TestMachine(modelName);
  machine.processor = createBbcCpu(Cpu6502, model, {
    video: new FakeVideo(), soundChip: new FakeSoundChip(), tube: parasite,
  });
  machine.processor.config.extraRoms = [...extraRoms];
  await machine.initialise();
  machine.startCapture();
  let banner = '';
  for (let index = 0; index < 40 && !banner.trimEnd().endsWith('>'); index += 1) {
    await machine.runFor(1_000_000);
    banner += machine.drainText({ raw: true });
  }
  await machine.type('PRINT ~PAGE,~HIMEM');
  let reply = '';
  for (let index = 0; index < 12; index += 1) { await machine.runFor(2_000_000); reply += machine.drainText({ raw: true }); }
  return {
    banner: banner.split('\n').filter(Boolean)[0],
    memory: reply.trim().split('\n').at(-2)?.trim().split(/\s+/).slice(-2) ?? [],
  };
}

async function main() {
  const base = argv[2];
  if (!base) {
    console.error('Give the directory holding the roms/ tree this build reads firmware from.');
    exit(2);
  }
  setNodeBasePath(resolve(base));
  const { createBbcCpu } = await import('../src/emulator/bbcCpuFactory.ts');

  const cases = [
    { host: 'Model B', model: 'B', parasite: TubeModel, banks: [TUBE_HOST_ROM] },
    { host: 'Model B', model: 'B', parasite: TurboTubeModel, banks: [TUBE_HOST_ROM] },
    { host: 'Master ', model: 'Master', parasite: TubeModel, banks: [] },
    { host: 'Master ', model: 'Master', parasite: TurboTubeModel, banks: [] },
  ];

  for (const item of cases) {
    const result = await boot(item.model, item.parasite, item.banks, createBbcCpu);
    const [page, himem] = result.memory;
    console.log(`${item.host}  ${item.parasite.name.padEnd(10)}  ${JSON.stringify(result.banner)}  page &${page} himem &${himem}`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) await main();
