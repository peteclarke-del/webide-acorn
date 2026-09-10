// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { Cpu6502 } from 'jsbeeb/src/6502.js';
import { findModel, TubeModel } from 'jsbeeb/src/models.js';
import { FakeVideo } from 'jsbeeb/src/video.js';
import { FakeSoundChip } from 'jsbeeb/src/soundchip.js';
import { createBbcCpu } from './bbcCpuFactory';
import { fitParasiteInstructionHooks, type ParasiteProcessor } from './parasiteHooks';

/*
 * The fitted loop against the pinned core's own parasite, with no firmware:
 * a Model B with a 6502 second processor is built and not booted, the
 * parasite's RAM is filled by hand, and its execute is driven directly. This
 * holds two things: that the core's Tube6502 still has the shape the fitted
 * loop relies on (cycles, the clock ratio, the fetch, the runner, the
 * interrupt latch), and that a hook stops it at the address asked for with
 * the host asked to halt.
 */
function parasiteOnAModelB() {
  const cpu = createBbcCpu(Cpu6502, findModel('B'), { video: new FakeVideo(), soundChip: new FakeSoundChip(), tube: TubeModel }) as unknown as {
    tube: ParasiteProcessor & { writemem(address: number, value: number): void; romPaged: boolean; a: number };
    stop(): void;
    halted: boolean;
  };
  return cpu;
}

describe('the pinned core\'s second processor under the fitted hooks', () => {
  it('has the shape the fitted loop relies on', () => {
    const cpu = parasiteOnAModelB();
    const parasite = cpu.tube;
    expect(typeof parasite.cycles).toBe('number');
    expect(parasite.cyclesPerHostCycle).toBeGreaterThan(0);
    expect(parasite.cpuMultiplier).toBeGreaterThan(0);
    expect(typeof parasite.readmem).toBe('function');
    expect(typeof parasite.incpc).toBe('function');
    expect(typeof parasite.runner?.run).toBe('function');
    expect(typeof parasite.brk).toBe('function');
    expect(typeof parasite.execute).toBe('function');
    expect(typeof cpu.stop).toBe('function');
  });

  it('stops the real parasite at a breakpoint address before the instruction there runs, and halts the host', () => {
    const cpu = parasiteOnAModelB();
    const parasite = cpu.tube;
    /* LDA #&11 at &0800, LDA #&22 at &0802, LDA #&33 at &0804, then a loop. */
    const program = [0xa9, 0x11, 0xa9, 0x22, 0xa9, 0x33, 0x4c, 0x06, 0x08];
    program.forEach((byte, offset) => parasite.writemem(0x0800 + offset, byte));
    parasite.pc = 0x0800;
    parasite.romPaged = false;
    const stop = vi.spyOn(cpu, 'stop');
    const hooks = fitParasiteInstructionHooks(parasite, cpu);
    const seen: number[] = [];
    hooks.add((pc) => { seen.push(pc); return pc === 0x0804; });
    parasite.execute(64);
    expect(parasite.pc).toBe(0x0804);
    expect(parasite.a).toBe(0x22);
    expect(seen).toEqual([0x0800, 0x0802, 0x0804]);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(hooks.stopped).toBe(true);
    /* Resumed, it runs the instruction it stopped on and carries on. */
    parasite.execute(64);
    expect(parasite.a).toBe(0x33);
    expect(hooks.stopped).toBe(false);
  });
});
