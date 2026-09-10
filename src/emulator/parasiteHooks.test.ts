import { describe, expect, it, vi } from 'vitest';
import { fitParasiteInstructionHooks, type ParasiteProcessor } from './parasiteHooks';

/*
 * A parasite that counts, so what the fitted loop did to it can be read:
 * each instruction advances the program counter by one and costs one cycle.
 * The host is a stop flag.
 */
/* A host whose halt behaves as the core's: set by stop, cleared when it is run. */
function fakeHost() {
  const host = { halted: false, stop: vi.fn(() => { host.halted = true; }), run() { host.halted = false; } };
  return host;
}

function fakeParasite(): ParasiteProcessor & { executed: number[]; originalCalls: number } {
  const parasite = {
    cycles: 0, cyclesPerHostCycle: 2, cpuMultiplier: 1, pc: 0x0800, takeInt: false,
    executed: [] as number[], originalCalls: 0,
    readmem: (address: number) => address & 0xff,
    incpc() { this.pc = (this.pc + 1) & 0xffff; },
    runner: { run(opcode: number) { parasite.executed.push(opcode); parasite.cycles -= 1; } },
    brk: vi.fn(),
    execute(cycles: number) { this.originalCalls += 1; this.cycles += cycles * 2; while (this.cycles > 0) { const opcode = this.readmem(this.pc); this.incpc(); this.runner.run(opcode); } },
  };
  return parasite;
}

describe('instruction hooks fitted to the second processor', () => {
  it('leaves the core\'s own loop in charge until a hook is installed', () => {
    const parasite = fakeParasite();
    const host = fakeHost();
    const hooks = fitParasiteInstructionHooks(parasite, host);
    parasite.execute(4);
    expect(parasite.originalCalls).toBe(1);
    expect(parasite.executed).toHaveLength(8);
    expect(hooks.active).toBe(false);
    /* And gives it back when the last hook is removed. */
    const remove = hooks.add(() => false);
    expect(hooks.active).toBe(true);
    remove();
    parasite.execute(1);
    expect(parasite.originalCalls).toBe(2);
  });

  it('stops the parasite at the address a hook asks for, before it runs, and halts the host', () => {
    const parasite = fakeParasite();
    const host = fakeHost();
    const hooks = fitParasiteInstructionHooks(parasite, host);
    hooks.add((pc) => pc === 0x0803);
    parasite.execute(10);
    expect(parasite.pc).toBe(0x0803);
    expect(parasite.executed).toEqual([0x00, 0x01, 0x02]);
    expect(host.stop).toHaveBeenCalledTimes(1);
    expect(hooks.stopped).toBe(true);
    /* The parasite keeps the cycles it was owed; nothing ran on the sly. */
    expect(parasite.cycles).toBe(17);
  });

  it('stays stopped while the host is halted, however often the host asks for its time', () => {
    /* The host clocks the parasite more than once within one instruction.
     * A breakpoint that let the parasite run on through those calls stopped
     * it and then showed it a hundred instructions further along. */
    const parasite = fakeParasite();
    const host = fakeHost();
    const hooks = fitParasiteInstructionHooks(parasite, host);
    hooks.add((pc) => pc === 0x0803);
    parasite.execute(10);
    parasite.execute(10);
    parasite.execute(10);
    expect(parasite.pc).toBe(0x0803);
    expect(parasite.executed).toHaveLength(3);
    expect(parasite.cycles).toBe(17);
    expect(hooks.stopped).toBe(true);
  });

  it('steps past the breakpoint it stopped on when resumed, then honours it again on the next visit', () => {
    const parasite = fakeParasite();
    const host = fakeHost();
    const hooks = fitParasiteInstructionHooks(parasite, host);
    hooks.add((pc) => pc === 0x0803);
    parasite.execute(10);
    host.run();
    parasite.execute(0);
    expect(parasite.pc).toBeGreaterThan(0x0803);
    expect(hooks.stopped).toBe(false);
    expect(host.stop).toHaveBeenCalledTimes(1);
    /* Round again: the counter wraps the address space in a fake, so put it back. */
    parasite.pc = 0x0800; parasite.cycles = 0;
    parasite.execute(10);
    expect(parasite.pc).toBe(0x0803);
    expect(host.stop).toHaveBeenCalledTimes(2);
  });

  it('runs every installed hook and stops if any of them asks', () => {
    const parasite = fakeParasite();
    const host = fakeHost();
    const hooks = fitParasiteInstructionHooks(parasite, host);
    const seen: number[] = [];
    hooks.add((pc) => { seen.push(pc); return false; });
    hooks.add((pc) => pc === 0x0802);
    parasite.execute(10);
    expect(seen).toEqual([0x0800, 0x0801, 0x0802]);
    expect(parasite.pc).toBe(0x0802);
  });

  it('takes a pending interrupt after an instruction, as the core\'s loop does', () => {
    const parasite = fakeParasite();
    const hooks = fitParasiteInstructionHooks(parasite, fakeHost());
    hooks.add(() => false);
    parasite.takeInt = true;
    parasite.execute(2);
    expect(parasite.brk).toHaveBeenCalledWith(true);
  });
});
