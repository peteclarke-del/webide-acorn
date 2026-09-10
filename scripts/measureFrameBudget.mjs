#!/usr/bin/env node
/*
 * What a BBC Model B can actually put on screen in one frame.
 *
 * A game design starts with this number and every other decision follows from
 * it, so it is measured on the machine rather than reasoned about. The routines
 * below run on a real Model B under the pinned core, and the cycles they take
 * are counted by the emulator rather than by adding up an instruction table.
 *
 * Five questions:
 *
 *   - How cheaply can the host put a byte on screen at all? An unrolled store
 *     is the floor: nothing that draws anything can beat it.
 *   - How cheaply can it copy a byte from somewhere else to the screen? That is
 *     what "the second processor composes a frame and the host shows it" costs,
 *     whatever produced the bytes.
 *   - What does a byte cost when it really does come from a second processor,
 *     with the two sides kept in step? The blind read is a ceiling; this is
 *     what a game pays.
 *   - What does the hardware scroll cost? It is two 6845 registers, and the
 *     answer decides whether scrolling is free or is part of the budget.
 *   - How much of a screen is that, in each mode worth considering?
 *
 * ROMs are never committed. Run this against firmware you already have:
 *
 *   node scripts/measureFrameBudget.mjs <directory containing roms/>
 */
import { argv, exit } from 'node:process';
import { resolve } from 'node:path';
import { TestMachine } from 'jsbeeb/tests/test-machine.js';
import { findModel, TurboTubeModel } from 'jsbeeb/src/models.js';
import { setNodeBasePath } from 'jsbeeb/src/utils.js';
import { Cpu6502 } from 'jsbeeb/src/6502.js';
import { FakeVideo } from 'jsbeeb/src/video.js';
import { FakeSoundChip } from 'jsbeeb/src/soundchip.js';

/** A Model B runs at 2 MHz, and its display is 50 frames a second. */
export const HOST_CLOCK_HZ = 2_000_000;
export const FRAMES_PER_SECOND = 50;
export const CYCLES_PER_FRAME = HOST_CLOCK_HZ / FRAMES_PER_SECOND;

/** Screen sizes, from what the machine answered in measureBbcScreenModes. */
export const SCREEN_BYTES = { 'MODE 2': 20480, 'MODE 1': 20480, 'MODE 5': 10240, 'MODE 4': 10240 };

/** How many bytes each routine moves, so cycles can be divided by it. */
export const MOVED_BYTES = 4096;

/*
 * The floor: putting a byte on screen and nothing else.
 *
 * Sixteen stores per pass so the loop overhead is spread thin, which is what a
 * real inner loop does. The screen is written through absolute indexed stores
 * because that is how a blitter reaches it.
 */
export const FILL_ROUTINE = `
ORG &2000
.start
  LDA #&FF
  LDX #0
  LDY #16
.page
  ${Array.from({ length: 16 }, (unused, index) => `STA &3000+${index * 256},X`).join('\n  ')}
  INX
  BNE page
.done
  RTS
`;

/*
 * The realistic cost: a byte read from somewhere and written to the screen.
 *
 * This is what showing a composed frame costs the host, whether the bytes came
 * across the Tube or out of its own memory. The source is host RAM here so the
 * measurement is of the copy itself and not of the link.
 */
export const COPY_ROUTINE = `
ORG &2000
.start
  LDX #0
.page
  ${Array.from({ length: 16 }, (unused, index) => `LDA &4000+${index * 256},X\n  STA &3000+${index * 256},X`).join('\n  ')}
  INX
  BNE page
.done
  RTS
`;

/*
 * Pulling a byte across the Tube and putting it on screen.
 *
 * This is the number that decides the architecture. If the parasite composes a
 * frame, every byte of it has to cross, and the host is the slow end: a 65C102
 * at 4 MHz can push far faster than a 6502 at 2 MHz can take. So the host's own
 * read-and-store loop is the ceiling, whatever the transfer protocol on top.
 *
 * &FEE5 is register 3's data port, which is the one the Tube's block transfers
 * use. No protocol is run here because none would make the host's side cheaper,
 * and a measurement of the ceiling is what the design needs.
 */
export const TUBE_ROUTINE = `
ORG &2000
.start
  LDX #0
.page
  ${Array.from({ length: 16 }, (unused, index) => `LDA &FEE5\n  STA &3000+${index * 256},X`).join('\n  ')}
  INX
  BNE page
.done
  RTS
`;

/*
 * The same transfer with a second processor actually on the other end.
 *
 * The blind read above is the ceiling, and a game cannot run at the ceiling:
 * nothing keeps the two sides in step, so a host that reads before the
 * parasite has written takes a stale byte, and the first program written to
 * the blind figure painted its rows wherever stale reads sent them. A real
 * transfer waits on register 3's status flag: data available on the host,
 * room on the parasite. This measures that, with a 65C102 at 4 MHz sending as
 * fast as its own flag allows. Both of the ULA's modes for register 3 are
 * measured: the one-byte mode the machine boots in, and the two-byte mode,
 * which the host's routine sets itself with S and V in the control register
 * at &FEE0.
 *
 * The flag is checked before every byte in both modes. In two-byte mode the
 * host's flag is raised once two bytes are in, which invites reading two for
 * one check, and that is a race: after the first read the parasite's room
 * flag is up again, and whether the second byte the host reads is the one it
 * wanted depends on which side got there first. A first version of this read
 * pairs, measured a better figure, and would have painted a game's rows out
 * of step. The sender counts, so what arrived can be checked against what was
 * sent, and a measurement whose bytes are wrong is no measurement.
 */
const waitOnHost = (label) => `.${label}\n  BIT &FEE4\n  BPL ${label}`;
export const TUBE_HANDSHAKE_ROUTINE = `
ORG &2000
.start
  LDA #%10010000
  STA &FEE0
  LDX #0
.page
  ${Array.from({ length: 16 }, (unused, index) => `${waitOnHost(`w${index}`)}\n  LDA &FEE5\n  STA &3000+${index * 256},X`).join('\n  ')}
  INX
  BEQ done
  JMP page
.done
  RTS
`;
export const TUBE_HANDSHAKE_ONE_BYTE_ROUTINE = `
ORG &2000
.start
  LDA #%00010000
  STA &FEE0
  LDX #0
.page
  ${Array.from({ length: 16 }, (unused, index) => `${waitOnHost(`w${index}`)}\n  LDA &FEE5\n  STA &3000+${index * 256},X`).join('\n  ')}
  INX
  BEQ done
  JMP page
.done
  RTS
`;
/** The parasite's side: a counting byte into register 3 whenever there is room, for ever. */
export const PARASITE_SENDER = `
ORG &2000
.start
  SEI
  LDX #0
.again
  BIT &FEFC
  BVC again
  STX &FEFD
  INX
  JMP again
`;

/**
 * What the host stored, checked against what the parasite sent: 4,096 bytes
 * that count up from wherever the count was, each one more than the last.
 * The host's sixteen pages are filled in an order that is not the address
 * order, so the check follows the routine's order.
 */
function checkReceived(machine, label) {
  const bytes = [];
  for (let x = 0; x < 256; x += 1) for (let page = 0; page < 16; page += 1) bytes.push(machine.readbyte(0x3000 + page * 256 + x));
  let wrong = 0;
  for (let index = 1; index < bytes.length; index += 1) if (bytes[index] !== ((bytes[index - 1] + 1) & 0xff)) wrong += 1;
  if (wrong) throw new Error(`${label}: ${wrong} of ${bytes.length} received bytes were not the next in the sequence the parasite sent`);
  console.log(`${label}: every one of ${bytes.length.toLocaleString()} bytes received was the next one sent`);
}

/*
 * Reloading the VideoNuLA palette, which is how a four-colour mode gets an
 * arcade's colour.
 *
 * The NuLA takes a colour as two writes to &FE23. Reloading all sixteen between
 * raster bands gives each band its own palette, so a mode with four logical
 * colours can still show a different four in the sky, on the horizon and on the
 * ground. Whether that is affordable is the question this answers.
 *
 * Sixteen colours, thirty-two writes, done 256 times.
 */
export const NULA_PALETTE_ROUTINE = `
ORG &2000
.start
  LDY #0
.again
  ${Array.from({ length: 16 }, (unused, index) => `LDA #&${(index * 16).toString(16).padStart(2, '0')}\n  STA &FE23\n  LDA #&${(index * 7 & 0xff).toString(16).padStart(2, '0')}\n  STA &FE23`).join('\n  ')}
  INY
  BEQ done
  JMP again
.done
  RTS
`;

/*
 * The hardware scroll: the 6845's start address, high byte then low.
 *
 * Done a thousand times so the per-scroll cost is readable against the loop
 * that drives it rather than lost in measurement noise.
 */
export const SCROLL_ROUTINE = `
ORG &2000
.start
  LDY #0
.again
  LDA #12
  STA &FE00
  LDA #&30
  STA &FE01
  LDA #13
  STA &FE00
  STY &FE01
  INY
  BNE again
.done
  RTS
`;

/** Where the emulator's clock is now, in host cycles since it started. */
function absoluteCycles(machine) {
  const cpu = machine.processor;
  return cpu.cycleSeconds * machine.model.cyclesPerSecond + cpu.currentCycles;
}

/**
 * Run one routine and count the cycles it took.
 *
 * The program is entered by setting the program counter and is finished when it
 * reaches its own `done` label, which is watched for rather than waited out, so
 * a routine that never gets there fails instead of reporting a timeout as a
 * measurement.
 */
async function time(machine, assemble6502, source) {
  const artifact = assemble6502(source, '6502', 0x2000, {}, 'bbc-b');
  const problems = artifact.diagnostics.filter((item) => item.severity !== 'info');
  if (problems.length) throw new Error(`the routine did not assemble: ${problems.map((item) => item.message).join('; ')}`);
  const done = artifact.symbols?.done ?? artifact.symbols?.DONE;
  if (done === undefined) throw new Error('the routine has no done label to stop at');

  for (let offset = 0; offset < artifact.bytes.length; offset += 1) machine.writebyte(0x2000 + offset, artifact.bytes[offset]);
  machine.processor.pc = 0x2000;
  const started = absoluteCycles(machine);
  let finished = null;
  const hook = machine.processor.debugInstruction.add((address) => {
    if (address === done && finished === null) finished = absoluteCycles(machine);
    return false;
  });
  for (let index = 0; index < 40 && finished === null; index += 1) await machine.runFor(200_000);
  hook.remove();
  if (finished === null) throw new Error('the routine never reached its done label');
  return finished - started;
}

/**
 * A Model B with a 65C102 behind its Tube, booted to the prompt, with the
 * sender running on the parasite. The host routine is then timed exactly as
 * the others are.
 */
async function tubeMachine(assemble6502, createBbcCpu) {
  const machine = new TestMachine('B');
  machine.processor = createBbcCpu(Cpu6502, findModel('B'), { video: new FakeVideo(), soundChip: new FakeSoundChip(), tube: TurboTubeModel });
  machine.processor.config.extraRoms = ['b/dnfs120.rom'];
  await machine.initialise();
  machine.startCapture();
  let banner = '';
  for (let index = 0; index < 40 && !banner.trimEnd().endsWith('>'); index += 1) {
    await machine.runFor(1_000_000);
    banner += machine.drainText({ raw: true });
  }
  const tube = machine.processor.tube;
  if (!tube) throw new Error('the machine has no second processor');
  const sender = assemble6502(PARASITE_SENDER, '6502', 0x2000, {}, 'bbc-b');
  for (let offset = 0; offset < sender.bytes.length; offset += 1) tube.writemem(0x2000 + offset, sender.bytes[offset]);
  tube.pc = 0x2000;
  await machine.runFor(10_000);
  console.log('second processor:', JSON.stringify(banner.split('\n').filter(Boolean)[0]), 'sending');
  return machine;
}

async function main() {
  const base = argv[2];
  if (!base) {
    console.error('Give the directory holding the roms/ tree this build reads firmware from.');
    exit(2);
  }
  setNodeBasePath(resolve(base));
  const { assemble6502 } = await import('../src/build/assembler6502.ts');
  const { createBbcCpu } = await import('../src/emulator/bbcCpuFactory.ts');

  const machine = new TestMachine('B');
  await machine.initialise();
  machine.startCapture();
  let banner = '';
  for (let index = 0; index < 40 && !banner.trimEnd().endsWith('>'); index += 1) {
    await machine.runFor(1_000_000);
    banner += machine.drainText({ raw: true });
  }
  console.log('machine:', JSON.stringify(banner.split('\n').filter(Boolean)[0]));
  console.log(`one frame at ${FRAMES_PER_SECOND} Hz is ${CYCLES_PER_FRAME.toLocaleString()} cycles`);
  console.log('');

  const fill = await time(machine, assemble6502, FILL_ROUTINE);
  const copy = await time(machine, assemble6502, COPY_ROUTINE);
  const tube = await time(machine, assemble6502, TUBE_ROUTINE);
  const scroll = await time(machine, assemble6502, SCROLL_ROUTINE);
  const palette = await time(machine, assemble6502, NULA_PALETTE_ROUTINE);

  /* The one-byte mode first, because it is the mode the machine boots in.
   * Changing mode with bytes already in the register loses one of them at
   * the change, which is a fact about changing mode and not about either. */
  const withParasite = await tubeMachine(assemble6502, createBbcCpu);
  const handshakeOneByte = await time(withParasite, assemble6502, TUBE_HANDSHAKE_ONE_BYTE_ROUTINE);
  checkReceived(withParasite, 'one-byte mode');
  const handshake = await time(withParasite, assemble6502, TUBE_HANDSHAKE_ROUTINE);
  checkReceived(withParasite, 'two-byte mode');
  console.log('');

  for (const [name, cycles] of [['fill', fill], ['copy', copy], ['tube, blind', tube], ['tube, kept in step, one-byte mode', handshakeOneByte], ['tube, kept in step, two-byte mode', handshake]]) {
    const perByte = cycles / MOVED_BYTES;
    const perFrame = Math.floor(CYCLES_PER_FRAME / perByte);
    console.log(`${name.padEnd(32)} ${MOVED_BYTES.toLocaleString()} bytes in ${cycles.toLocaleString()} cycles`);
    console.log(`      ${perByte.toFixed(2)} cycles a byte, so ${perFrame.toLocaleString()} bytes in one frame`);
    for (const [mode, bytes] of Object.entries(SCREEN_BYTES)) {
      const frames = bytes / perFrame;
      console.log(`      ${mode}: ${bytes.toLocaleString()} bytes is ${frames.toFixed(2)} frames, ${(100 / frames).toFixed(1)}% of a screen a frame`);
    }
    console.log('');
  }

  console.log(`scroll 256 start-address changes in ${scroll.toLocaleString()} cycles, ${(scroll / 256).toFixed(1)} cycles each`);
  console.log(`      ${((scroll / 256) / CYCLES_PER_FRAME * 100).toFixed(3)}% of a frame, so the hardware scroll itself is free`);
  console.log('');
  console.log(`palette 256 full sixteen-colour NuLA reloads in ${palette.toLocaleString()} cycles, ${(palette / 256).toFixed(0)} cycles each`);
  console.log(`      ${((palette / 256) / CYCLES_PER_FRAME * 100).toFixed(2)}% of a frame each, so ${Math.floor(CYCLES_PER_FRAME / (palette / 256))} full reloads fit in one frame`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) await main();
