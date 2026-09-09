#!/usr/bin/env node
/*
 * Asks each machine which of its sideways banks are RAM.
 *
 * "Sideways RAM" is a capability this product offers without saying how much,
 * and how much is exactly what a game needs to know: a program written for a
 * 32 KB board must not quietly spread itself over eight banks because the
 * emulator happened to give it eight.
 *
 * So the machine is asked. A short routine runs with interrupts off, and for
 * each of the sixteen banks it selects the bank, reads &8000, writes the
 * complement, reads it back and puts the original back. A bank whose read-back
 * changed is RAM. Doing it in one routine matters: paging out the language ROM
 * while BASIC is running it does not end well, so BASIC is not running.
 *
 * ROMs are never committed. Run this against firmware you already have:
 *
 *   node scripts/measureSidewaysRam.mjs <directory containing roms/>
 */
import { argv, exit } from 'node:process';
import { resolve } from 'node:path';
import { TestMachine } from 'jsbeeb/tests/test-machine.js';
import { setNodeBasePath } from 'jsbeeb/src/utils.js';

/** The ROM select register is four bits wide, so there are sixteen banks. */
export const SIDEWAYS_BANKS = 16;

/** A sideways bank is 16 KiB. */
export const SIDEWAYS_BANK_BYTES = 16 * 1024;

/*
 * The routine, in the assembler this product ships.
 *
 * &F4 is the operating system's own copy of the ROM select register. Writing
 * the register without writing the copy leaves the operating system believing
 * something that is no longer true, so both are written, and both are put back.
 */
export const SIDEWAYS_PROBE = `
ORG &2000
.start
  SEI
  LDA &F4
  PHA
  LDX #0
.bank
  STX &F4
  STX &FE30
  LDA &8000
  STA &2100,X
  EOR #&FF
  STA &8000
  LDA &8000
  STA &2110,X
  LDA &2100,X
  STA &8000
  INX
  CPX #16
  BNE bank
  PLA
  STA &F4
  STA &FE30
  CLI
  RTS
`;

/** Type a line and let the machine settle. */
async function ask(machine, line, seconds = 12) {
  await machine.type(line);
  for (let index = 0; index < seconds; index += 1) await machine.runFor(2_000_000);
  machine.drainText({ raw: true });
}

async function measure(model, assemble6502) {
  const machine = new TestMachine(model);
  await machine.initialise();
  machine.startCapture();
  let banner = '';
  for (let index = 0; index < 40 && !banner.trimEnd().endsWith('>'); index += 1) {
    await machine.runFor(1_000_000);
    banner += machine.drainText({ raw: true });
  }
  /* Out of the way of the routine and its two result tables. */
  await ask(machine, 'HIMEM=&2000');
  const artifact = assemble6502(SIDEWAYS_PROBE, '6502', 0x2000, {}, 'bbc-b');
  const problems = artifact.diagnostics.filter((item) => item.severity !== 'info');
  if (problems.length) throw new Error(`the probe did not assemble: ${problems.map((item) => item.message).join('; ')}`);
  for (let index = 0; index < artifact.bytes.length; index += 1) machine.writebyte(0x2000 + index, artifact.bytes[index]);
  await ask(machine, 'CALL &2000', 20);

  const writable = [];
  for (let bank = 0; bank < SIDEWAYS_BANKS; bank += 1) {
    const original = machine.readbyte(0x2100 + bank);
    const readBack = machine.readbyte(0x2110 + bank);
    if (readBack === ((original ^ 0xff) & 0xff)) writable.push(bank);
  }
  return { banner: banner.split('\n').filter(Boolean)[0], writable };
}

async function main() {
  const base = argv[2];
  if (!base) {
    console.error('Give the directory holding the roms/ tree this build reads firmware from.');
    exit(2);
  }
  setNodeBasePath(resolve(base));
  const { assemble6502 } = await import('../src/build/assembler6502.ts');

  for (const model of ['B', 'B1770', 'Master']) {
    const { banner, writable } = await measure(model, assemble6502);
    const kilobytes = (writable.length * SIDEWAYS_BANK_BYTES) / 1024;
    console.log(`${model.padEnd(8)} ${JSON.stringify(banner)}`);
    console.log(`         banks ${writable.length ? writable.join(', ') : 'none'} answer as RAM, which is ${kilobytes} KB`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) await main();
