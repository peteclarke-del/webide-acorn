/*
 * Instruction hooks for the second processor.
 *
 * The pinned core gives the host processor a debug hook at every instruction,
 * which is what breakpoints, stepping and tracing are built on. The parasite
 * behind the Tube is a full processor with the same hook machinery, but its
 * own execute loop never consults it: it fetches, steps and runs, and that is
 * all. So a breakpoint on a parasite address could never fire, and the
 * workbench refused to debug a second-processor program by name rather than
 * pretend.
 *
 * This fits the parasite with a loop that does consult a hook. It is the
 * core's loop with one check added, installed on the instance the same way the
 * BeebSID and BeebSCSI cards are fitted to the host, and it is used only while
 * a hook is installed; without one the core's own loop runs untouched.
 *
 * Stopping is the part that needs care. The host clocks the parasite from
 * inside its own instruction loop, so a parasite hook that wants the machine
 * to stop has to stop both: it leaves the parasite at the instruction it was
 * about to execute, and asks the host to halt, which the host does at the end
 * of its current instruction. On resume the parasite skips the hook once at
 * that address, as the host does after its own breakpoint, so the same
 * breakpoint does not fire again before a single instruction has run.
 */

/** What the fitted loop needs of the parasite, which is what Tube6502 has. */
export interface ParasiteProcessor {
  cycles: number;
  cyclesPerHostCycle: number;
  cpuMultiplier: number;
  pc: number;
  takeInt: boolean;
  readmem(address: number): number;
  incpc(): void;
  runner: { run(opcode: number): void };
  brk(isIrq: boolean): void;
  execute(cycles: number): void;
}

/** What it needs of the host: a way to halt it at the end of its instruction. */
export interface ParasiteHost {
  stop(): void;
}

/**
 * A hook is told the address and opcode about to execute. Returning true stops
 * the machine before that instruction runs.
 */
export type ParasiteInstructionHook = (pc: number, opcode: number) => boolean;

export interface ParasiteHooks {
  /** Install a hook; the returned function removes it. */
  add(hook: ParasiteInstructionHook): () => void;
  /** Whether any hook is installed, which is when the fitted loop is in use. */
  readonly active: boolean;
  /** True from a stop until the next instruction runs. */
  readonly stopped: boolean;
  /** The core's own execute, for anything that wants it back. */
  readonly original: (cycles: number) => void;
}

export function fitParasiteInstructionHooks(parasite: ParasiteProcessor, host: ParasiteHost): ParasiteHooks {
  const original = parasite.execute.bind(parasite);
  const hooks: ParasiteInstructionHook[] = [];
  /* Set by a stop and cleared once an instruction has run, so a resumed
   * parasite steps past the breakpoint it stopped on. */
  let resume = false;
  let stopped = false;

  parasite.execute = (cycles: number) => {
    if (!hooks.length) { original(cycles); return; }
    /* The core's own loop, with the hook consulted before each fetch. The
     * fetch itself is kept as a read of the opcode, as the core does it. */
    parasite.cycles += cycles * parasite.cyclesPerHostCycle * parasite.cpuMultiplier;
    if (parasite.cycles < 3) return;
    while (parasite.cycles > 0) {
      const pc = parasite.pc;
      const opcode = parasite.readmem(pc);
      if (!resume && hooks.some((hook) => hook(pc, opcode))) {
        resume = true;
        stopped = true;
        host.stop();
        return;
      }
      resume = false;
      stopped = false;
      parasite.incpc();
      parasite.runner.run(opcode);
      if (parasite.takeInt) parasite.brk(true);
    }
  };

  return {
    add(hook) {
      hooks.push(hook);
      return () => { const index = hooks.indexOf(hook); if (index >= 0) hooks.splice(index, 1); };
    },
    get active() { return hooks.length > 0; },
    get stopped() { return stopped; },
    original,
  };
}
