#!/usr/bin/env node
/*
 * Boots each BBC-family machine with a Tube fitted, and reads the banner.
 *
 * This build carried a note for a long time saying the Tube did not complete
 * its boot on a BBC-family host, only on the Master, and that the fault was
 * somewhere in the pinned core's handshake. That note was wrong, and this is
 * what settles it: the ULA accesses each machine makes are logged, and the
 * difference between the machines is not in the emulator at all.
 *
 * A Model B writes the ULA control register once, reads it back, and stops.
 * That is OS 1.20 finding the Tube and going no further, because the language
 * transfer is not in OS 1.20: on real hardware it is in a sideways ROM, and
 * Acorn shipped it in DNFS. Put DNFS in a bank and the same machine goes on to
 * enable the parasite interrupts, read the parasite's banner out of R1 and
 * introduce itself as a Tube. A B+ and a Master need nothing extra, because
 * their own operating systems carry that code.
 *
 * ROMs are never committed. Run this against firmware you already have:
 *
 *   node scripts/measureBbcTube.mjs <directory containing roms/>
 */
import { argv, exit } from 'node:process';
import { resolve } from 'node:path';
import { TestMachine } from 'jsbeeb/tests/test-machine.js';
import { findModel, tubeModelFor } from 'jsbeeb/src/models.js';
import { setNodeBasePath } from 'jsbeeb/src/utils.js';
import { FakeVideo } from 'jsbeeb/src/video.js';
import { FakeSoundChip } from 'jsbeeb/src/soundchip.js';

/** The sideways ROM that carries the 6502 Tube host code for a Model B. */
export const TUBE_HOST_ROM = 'b/dnfs120.rom';

/** Boot a machine, logging every access to the Tube ULA at &FEE0 to &FEE7. */
async function boot(machine, extraRoms) {
  machine.processor.config.extraRoms = [...extraRoms];
  await machine.initialise();
  const cpu = machine.processor;
  const accesses = [];
  const read = cpu.readDevice.bind(cpu);
  const write = cpu.writeDevice.bind(cpu);
  const note = (entry) => { if (accesses.length < 8) accesses.push(entry); };
  const hex = (value) => value.toString(16).toUpperCase();
  cpu.readDevice = (address) => {
    const value = read(address);
    if (address >= 0xfee0 && address <= 0xfee7) note(`read &${hex(address)} = &${hex(value)} at &${hex(cpu.pc)}`);
    return value;
  };
  cpu.writeDevice = (address, value) => {
    if (address >= 0xfee0 && address <= 0xfee7) note(`write &${hex(address)} = &${hex(value)} at &${hex(cpu.pc)}`);
    write(address, value);
  };
  machine.startCapture();
  let banner = '';
  for (let index = 0; index < 40 && !banner.trimEnd().endsWith('>'); index += 1) {
    await machine.runFor(1_000_000);
    banner += machine.drainText({ raw: true });
  }
  return { banner: banner.split('\n').filter(Boolean).join(' | '), accesses, hasTube: !!cpu.hasTube };
}

async function main() {
  const base = argv[2];
  if (!base) {
    console.error('Give the directory holding the roms/ tree this build reads firmware from.');
    exit(2);
  }
  setNodeBasePath(resolve(base));
  const { createBPlusCpu, bplusModelFrom } = await import('../src/emulator/bbcBPlus.ts');

  const cases = [
    { label: 'Model B, nothing in a bank', build: () => new TestMachine('B', { tube: true }), extraRoms: [] },
    { label: 'Model B, DNFS in a bank  ', build: () => new TestMachine('B', { tube: true }), extraRoms: [TUBE_HOST_ROM] },
    {
      label: 'B+, nothing in a bank    ',
      build: () => {
        const model = bplusModelFrom(findModel('B1770'), { os: ['bplus/os2.rom', 'bplus/BASIC2.ROM', 'bplus/dfs223.rom'] });
        const machine = new TestMachine('B1770');
        machine.model = model;
        machine.processor = createBPlusCpu(model, { video: new FakeVideo(), soundChip: new FakeSoundChip(), tube: tubeModelFor(model) });
        return machine;
      },
      extraRoms: [],
    },
    { label: 'Master, nothing in a bank', build: () => new TestMachine('Master', { tube: true }), extraRoms: [] },
  ];

  for (const item of cases) {
    const result = await boot(item.build(), item.extraRoms);
    console.log(`${item.label}  ${JSON.stringify(result.banner)}`);
    for (const access of result.accesses) console.log(`      ${access}`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) await main();
