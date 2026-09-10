#!/usr/bin/env node
/*
 * Runs a program on the second processor, and proves it ran there.
 *
 * The whole reason to put a Tube behind a BBC is to run the program somewhere
 * that is not the host: thirty kilobytes with no screen in it, at three or four
 * megahertz rather than two, while the host keeps the display and the filing
 * system. Until this, a program could be loaded into the host and run, or
 * loaded into the parasite by a test plan, and there was no way to build one in
 * the workbench and have it execute on the other side of the Tube.
 *
 * A pass here has to be something the host could not have produced, or it says
 * nothing. So the program writes to &8000. On the parasite that is ordinary
 * RAM holding the language the host transferred; on the host it is a sideways
 * ROM slot, where a write is ignored and a read gives back a ROM byte. The
 * arithmetic is chosen so every value checked is one the program computed
 * rather than one it was given: &10 plus &32 is &42, and &42 appears nowhere in
 * the source.
 *
 * ROMs are never committed. Run this against firmware you already have:
 *
 *   node scripts/measureParasiteProgram.mjs <directory containing roms/>
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

/** Where a parasite program is loaded, which is the same range the runtime allows. */
export const PROGRAM_ORIGIN = 0x2000;

/*
 * The program. Interrupts are masked first, and that is not a detail: without
 * it the parasite's client operating system takes the Tube interrupt and
 * carries the program counter out of the halt loop.
 */
export const PARASITE_PROGRAM = `
ORG &2000
.start
  SEI
  LDA #&10
  CLC
  ADC #&32
  STA &8000
  LDX &8000
  LDY #&5A
  STY &2100
.done
  JMP done
`;

async function main() {
  const base = argv[2];
  if (!base) {
    console.error('Give the directory holding the roms/ tree this build reads firmware from.');
    exit(2);
  }
  setNodeBasePath(resolve(base));
  const { createBbcCpu } = await import('../src/emulator/bbcCpuFactory.ts');
  const { assemble6502 } = await import('../src/build/assembler6502.ts');

  const artifact = assemble6502(PARASITE_PROGRAM, '6502', PROGRAM_ORIGIN, {}, 'bbc-b');
  const problems = artifact.diagnostics.filter((item) => item.severity !== 'info');
  if (problems.length) throw new Error(`the program did not assemble: ${problems.map((item) => item.message).join('; ')}`);

  for (const [label, model, parasite, banks] of [
    ['Model B, 6502  ', 'B', TubeModel, [TUBE_HOST_ROM]],
    ['Model B, 65C102', 'B', TurboTubeModel, [TUBE_HOST_ROM]],
    ['Master, 65C102 ', 'Master', TurboTubeModel, []],
  ]) {
    const machine = new TestMachine(model);
    machine.processor = createBbcCpu(Cpu6502, findModel(model), {
      video: new FakeVideo(), soundChip: new FakeSoundChip(), tube: parasite,
    });
    machine.processor.config.extraRoms = [...banks];
    await machine.initialise();
    machine.startCapture();
    let banner = '';
    for (let index = 0; index < 40 && !banner.trimEnd().endsWith('>'); index += 1) {
      await machine.runFor(1_000_000);
      banner += machine.drainText({ raw: true });
    }
    const tube = machine.processor.tube;
    if (!tube) throw new Error(`${label} has no parasite`);

    for (let offset = 0; offset < artifact.bytes.length; offset += 1) {
      tube.writemem(PROGRAM_ORIGIN + offset, artifact.bytes[offset]);
    }
    tube.pc = PROGRAM_ORIGIN;
    await machine.runFor(2_000_000);

    /* Read from the snapshot rather than through readmem: a read at &FEF8 to
     * &FEFF reaches the ULA and can consume FIFO state. */
    const state = tube.snapshotState({ includeRoms: true });
    const memory = state.memory;
    const computed = memory[0x8000];
    const marker = memory[0x2100];
    console.log(
      `${label}  ${JSON.stringify(banner.split('\n').filter(Boolean)[0])}` +
      `  &8000 = &${computed.toString(16).toUpperCase()}` +
      `  &2100 = &${marker.toString(16).toUpperCase()}` +
      `  X = &${Number(state.x ?? 0).toString(16).toUpperCase()}`,
    );
  }
  console.log('');
  console.log('On the host &8000 is a sideways ROM slot: a write there is ignored and a read gives a ROM byte,');
  console.log('so &42 in parasite RAM at &8000 is a result only the second processor could have produced.');
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) await main();
