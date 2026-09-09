#!/usr/bin/env node
/*
 * Boots a BBC Model B with a real Acorn ADFS and a BeebSCSI board, and asks
 * ADFS about it.
 *
 * The board is written from BeebSCSI's own documentation rather than ported
 * from another emulator, so the only thing that settles whether the register
 * map and the SCSI state machine are right is putting a real ADFS ROM in front
 * of them and reading what it says. ADFS is not a friendly harness: it probes
 * the host adapter, selects the drive, sends the command block, walks the bus
 * phases and reads the sectors, and it complains in its own words when any of
 * that does not answer as it expects.
 *
 * Four questions, each with a visibly wrong answer if the board is wrong:
 *
 *   - What does ADFS say when the card holds no image? It should be the sense
 *     byte the drive returned and nothing else, printed as ADFS prints it.
 *   - What does it say when the card holds an unformatted one? The read has to
 *     succeed and return zeros, which is a broken directory and not a fault.
 *   - Can a sector be read back byte for byte? A known pattern is put in the
 *     image and fetched through the operating system's own OSWORD &72.
 *   - Can one be written? A pattern is written through the same call, the
 *     buffer is cleared, and the sector is read back.
 *
 * The last two use OSWORD &72 because that is the call BeebSCSI's own
 * documentation uses in its BASIC examples, so the path exercised is the one
 * the board is documented against rather than one chosen for convenience.
 *
 * ROMs are never committed. Run this against firmware you already have:
 *
 *   node scripts/measureBeebScsi.mjs <directory containing roms/>
 *
 * where the directory holds `roms/os.rom`, `roms/BASIC.ROM`,
 * `roms/b1770/zADFS.ROM` and `roms/b1770/dfs1770.rom`.
 */
import { argv, exit } from 'node:process';
import { resolve } from 'node:path';
import { TestMachine } from 'jsbeeb/tests/test-machine.js';
import { setNodeBasePath } from 'jsbeeb/src/utils.js';

/** DFS wins the filing system here, so the machine reaches a BASIC prompt to type at. */
export const MODEL_DFS_FIRST = 'B1770';
/** ADFS wins here, so it tries the hard disc at startup and says what it found. */
export const MODEL_ADFS_FIRST = 'B1770A';
export const FIRMWARE = Object.freeze(['os.rom', 'BASIC.ROM', 'b1770/zADFS.ROM', 'b1770/dfs1770.rom']);

/** A small LUN: 32 tracks is 2 heads by 16 cylinders, 1,056 sectors, 264 KB. */
export const MEASURED_TRACKS = 32;

/** Sector n of the pattern image holds this at offset i. */
export const patternByte = (sector, offset) => (sector * 16 + offset) & 0xff;

/** A machine booted with a BeebSCSI board on the 1 MHz bus. */
export async function bootWithBeebScsi({ fitBeebScsi }, model, card) {
  const machine = new TestMachine(model);
  await machine.initialise();
  const board = fitBeebScsi(machine.processor, card);
  machine.startCapture();
  let banner = '';
  for (let index = 0; index < 40 && !banner.trimEnd().endsWith('>'); index += 1) {
    await machine.runFor(1_000_000);
    banner += machine.drainText({ raw: true });
  }
  if (!banner.includes('BBC Computer')) throw new Error(`the machine never introduced itself: ${JSON.stringify(banner)}`);
  return { machine, board, banner: banner.trim() };
}

/** Type a line and give back everything the machine printed in reply. */
export async function ask(machine, line, seconds = 12) {
  await machine.type(line);
  let text = '';
  for (let index = 0; index < seconds; index += 1) { await machine.runFor(2_000_000); text += machine.drainText({ raw: true }); }
  return text.trim();
}

/*
 * A sector read and a sector write, as BeebSCSI's own documentation writes
 * them. The control block is at C%, the buffer at B%: byte 0 is the drive,
 * bytes 1 to 4 the buffer address, byte 5 the SCSI opcode, bytes 6 to 8 the
 * block address and byte 9 the block count.
 */
export const READ_SECTOR = (sector) =>
  `B%=&2000:C%=&2100:?C%=0:C%!1=B%:C%?5=8:C%?6=0:C%?7=0:C%?8=${sector}:C%?9=1:C%?10=0:C%?11=0:A%=&72:X%=C%:Y%=X%DIV256:CALL&FFF1`;

async function main() {
  const base = argv[2];
  if (!base) {
    console.error('Give the directory holding the roms/ tree this build reads firmware from.');
    exit(2);
  }
  setNodeBasePath(resolve(base));
  const bus = await import('../src/emulator/beebScsiBus.ts');
  const { BeebScsiCard } = await import('../src/emulator/beebScsi.ts');
  const { createBlankLunImage } = await import('../src/media/beebScsiLun.ts');
  const blank = createBlankLunImage(MEASURED_TRACKS);

  const empty = new BeebScsiCard();
  const { banner: emptyBanner } = await bootWithBeebScsi(bus, MODEL_ADFS_FIRST, empty);
  console.log('ADFS first, card empty:      ', JSON.stringify(emptyBanner));

  const unformatted = new BeebScsiCard();
  unformatted.mount(0, blank.data, blank.descriptor);
  const { banner: unformattedBanner } = await bootWithBeebScsi(bus, MODEL_ADFS_FIRST, unformatted);
  console.log('ADFS first, LUN unformatted: ', JSON.stringify(unformattedBanner));

  /* A pattern in the first eight sectors, so a read that returns the wrong
   * block or the wrong offset says so rather than looking plausible. */
  const patterned = new BeebScsiCard();
  const data = new Uint8Array(blank.geometry.sectors * 256);
  for (let sector = 0; sector < 8; sector += 1) {
    for (let offset = 0; offset < 256; offset += 1) data[sector * 256 + offset] = patternByte(sector, offset);
  }
  patterned.mount(0, data, blank.descriptor);

  const { machine, board } = await bootWithBeebScsi(bus, MODEL_DFS_FIRST, patterned);
  await ask(machine, '*ADFS');
  const read = await ask(machine, `${READ_SECTOR(3)}:PRINT ~?B%,~?(B%+1),~?(B%+2),~?(B%+255)`, 20);
  console.log('sector 3 read back:          ', JSON.stringify(read.split('\n').at(-2) ?? read));
  console.log('  the image holds:           ', [0, 1, 2, 255].map((offset) => patternByte(3, offset).toString(16).toUpperCase()).join(' '));

  const written = await ask(machine,
    'FORI%=0TO255:?(B%+I%)=255-I%:NEXT:C%?5=&A:C%?8=9:CALL&FFF1:FORI%=0TO255:?(B%+I%)=0:NEXT:C%?5=8:CALL&FFF1:PRINT ~?B%,~?(B%+1),~?(B%+255)', 30);
  console.log('sector 9 written then read:  ', JSON.stringify(written.split('\n').at(-2) ?? written));

  const image = patterned.image(0);
  console.log('what the card now holds:     ', `write revision ${image.revision}, sector 9 starts ${image.data[9 * 256]} ${image.data[9 * 256 + 1]} and ends ${image.data[9 * 256 + 255]}`);
  const state = board.snapshotState();
  console.log('the board afterwards:        ', JSON.stringify({ phase: state.phase, startedLuns: state.startedLuns, lastCommand: state.lastCommand, lastStatus: state.lastStatus }));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) await main();
