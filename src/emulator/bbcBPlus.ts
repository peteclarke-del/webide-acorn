/*
 * A BBC Model B+, built on the core that does not have one.
 *
 * jsbeeb models the Model B, the Master and the Atom, and no B+ — not in the
 * version pinned here and not in the current one. That is why this build could
 * describe a B+ and not run it, and why every capability on that profile said
 * so rather than pretending.
 *
 * A B+ is not a Model B with different firmware. It has twenty kilobytes of
 * shadow screen RAM and twelve kilobytes of paged RAM at &8000, and both are
 * reached through paging a Model B does not do. But it is not a Master either,
 * and the difference matters: a Master has ANDY, HAZEL and LYNNE with a control
 * register whose bits mean different things. Running B+ firmware on the Master
 * model would boot something, and it would be wrong exactly where a B+ program
 * differs from a Model B one — which is the only place anybody would use a B+.
 *
 * So this is the smallest honest thing: the Model B machine, with the B+'s own
 * two paging rules written against jsbeeb's own memory tables, and nothing else
 * claimed. What it does is checked by booting the real OS 2.00 and asking the
 * machine — see `bbcBPlusMeasurements.ts` for what it answered.
 *
 * The memory map inside jsbeeb's array, chosen to match the shape its Master
 * already uses so the video path needs no special case:
 *
 *   0x00000 - 0x08000   the base 32K of RAM
 *   0x08000 - 0x0B000   ANDY, 12K, paged over &8000-&AFFF
 *   0x0B000 - 0x10000   shadow, 20K, paged over &3000-&7FFF
 */
import { Cpu6502 } from 'jsbeeb/src/6502.js';
import { Cmos } from 'jsbeeb/src/cmos.js';
import { FakeDdNoise } from 'jsbeeb/src/ddnoise.js';
import { FakeRelayNoise } from 'jsbeeb/src/relaynoise.js';
import { FakeMusic5000 } from 'jsbeeb/src/music5000.js';

/** Where ANDY and the shadow screen live inside the machine's RAM array. */
export const BPLUS_ANDY_BASE = 0x8000;
export const BPLUS_SHADOW_BASE = 0xb000;
/** ANDY covers &8000-&AFFF, which is memory pages 128 to 175. */
export const BPLUS_ANDY_PAGES = Object.freeze({ first: 128, last: 176 });
/** The shadow screen covers &3000-&7FFF, which is pages 48 to 127. */
export const BPLUS_SHADOW_PAGES = Object.freeze({ first: 48, last: 128 });

/**
 * The B+ control register at &FE34.
 *
 * Only two bits are modelled, because only two are claimed. Bit 7 selects the
 * shadow screen; bit 6 chooses whether the &3000-&7FFF accesses that reach it
 * are only those made by code in the &C000-&DFFF operating-system region, or
 * all of them.
 */
export const BPLUS_CONTROL = Object.freeze({ shadow: 0x80, allAccesses: 0x40 });

/** ROMSEL bit 7 pages ANDY in over the sideways ROM area. */
export const BPLUS_ROMSEL_ANDY = 0x80;

interface JsBeebMemoryTables {
  memLook: Int32Array;
  memStat: Uint8Array;
  romsel: number;
  romOffset: number;
  osOffset: number;
  videoDisplayPage: number;
  model: { swram: boolean[] };
}

/**
 * The Model B+ processor: a Model B with the B+'s paging.
 *
 * Two overrides and nothing else. `romSelect` is jsbeeb's, with ANDY laid over
 * the sideways area when ROMSEL asks for it; the control register is new,
 * because on a Model B the address it lives at is a mirror of ROMSEL and on a
 * Master it is a register that means something else.
 */
export class BPlusCpu6502 extends Cpu6502 {
  /** The last value written to &FE34, so the machine can be asked about it. */
  bplusControl = 0;

  romSelect(value: number): void {
    super.romSelect(value);
    const self = this as unknown as JsBeebMemoryTables;
    if (!(value & BPLUS_ROMSEL_ANDY)) return;
    /* ANDY is twelve kilobytes of RAM laid over the paged ROM at &8000, and it
     * lives at 0x8000 in the machine's array — the same address it appears at,
     * so the offset is zero. A Master pages four kilobytes here; a B+ pages
     * three times as much, and a program that uses the extra eight would find
     * ROM underneath if this said 144. */
    for (let page = BPLUS_ANDY_PAGES.first; page < BPLUS_ANDY_PAGES.last; page += 1) {
      self.memLook[page] = self.memLook[256 + page] = 0;
      self.memStat[page] = self.memStat[256 + page] = 1;
    }
  }

  /**
   * Write the B+ control register.
   *
   * jsbeeb keeps two views of memory: one for ordinary access and one for the
   * bytes an instruction is fetched through. The B+ uses that distinction for
   * its shadow screen exactly as the Master does — the operating system's
   * screen driver lives at &C000-&DFFF and reaches the shadow while everything
   * else reaches main memory — so the second view is what carries it.
   */
  writeBPlusControl(value: number): void {
    this.bplusControl = value & 0xff;
    const self = this as unknown as JsBeebMemoryTables;
    const shadow = (value & BPLUS_CONTROL.shadow) !== 0;
    const everything = (value & BPLUS_CONTROL.allAccesses) !== 0;
    /* The display is fetched 0x3000 above the offset already, so the shadow at
     * 0xB000 is reached by adding 0x8000 — the same arithmetic the Master's
     * video path uses, which is why the shadow was put at the same place. */
    self.videoDisplayPage = shadow ? 0x8000 : 0x0000;
    for (let page = BPLUS_SHADOW_PAGES.first; page < BPLUS_SHADOW_PAGES.last; page += 1) {
      self.memLook[page] = shadow && everything ? 0x8000 : 0;
      self.memLook[256 + page] = shadow ? 0x8000 : 0;
    }
  }

  writeDevice(address: number, value: number): void {
    /* &FE34 is a mirror of ROMSEL on a Model B and a different register on a
     * Master, so neither of jsbeeb's answers is the B+'s. */
    if ((address & 0xfffc) === 0xfe34) { this.writeBPlusControl(value); return; }
    (super.writeDevice as (address: number, value: number) => void)(address, value);
  }
}

export interface BPlusModelOptions {
  /** The paths this machine's firmware is fetched from, operating system first. */
  os: readonly string[];
  name?: string;
  /** Which sideways banks are RAM. A B+ 64K has none; a B+ 128 has four. */
  swram?: readonly boolean[];
}

/** A B+ 64K: twelve kilobytes of ANDY and twenty of shadow, and no more. */
export const BPLUS_64K_SWRAM: readonly boolean[] = Object.freeze(Array<boolean>(16).fill(false));

/**
 * A B+ 128: the same machine with four banks of sideways RAM.
 *
 * Banks 0 to 3, which is where the B+ 128 fits its sixty-four kilobytes and
 * what its own operating system counts when it reports how much memory it
 * found.
 */
export const BPLUS_128_SWRAM: readonly boolean[] = Object.freeze(
  Array.from({ length: 16 }, (_, bank) => bank < 4),
);

/**
 * A B+ machine description, derived from one jsbeeb already has.
 *
 * Derived rather than written out, because everything a B+ shares with a Model
 * B — the clock, the processor, the video, the VIAs — should stay shared. A
 * copy would be a second place for those to drift.
 */
export function bplusModelFrom<T extends object>(base: T, options: BPlusModelOptions): T {
  /* The models jsbeeb publishes are frozen, on purpose: they are shared across
   * every machine in the process, so one session's settings cannot leak into
   * the next. Defining own properties rather than assigning them keeps that
   * promise — the original is untouched and this one is its own object. */
  return Object.create(base, {
    name: { value: options.name ?? 'BBC Model B+ 64K', enumerable: true },
    os: { value: options.os, enumerable: true },
    isBPlus: { value: true, enumerable: true },
    /* jsbeeb's Model B declares eight banks of sideways RAM so that games
     * written for a machine with a RAM board work. A B+ 64K has none, and the
     * operating system counts what it finds: inheriting the Model B's banks
     * made the machine introduce itself as "Acorn OS 96K", which is not a
     * machine Acorn made. */
    swram: { value: options.swram ?? BPLUS_64K_SWRAM, enumerable: true },
  }) as T;
}

/*
 * The B+ machines this build adds to the core, and how to make one.
 *
 * jsbeeb resolves a machine by name and publishes no B+, so the workbench asks
 * here first and falls back to the engine. Keeping the two lookups in one place
 * means the adapter matrix can state exactly which models come from the pinned
 * engine and which this build supplies, rather than either quietly covering for
 * the other.
 */
export interface BPlusModelDefinition {
  /** The name the adapter and the ROM sets use. */
  synonym: string;
  label: string;
  /** The Model B this one is derived from, by the engine's own name. */
  derivedFrom: string;
  swram: readonly boolean[];
  /** The order firmware is fetched in: operating system, then sideways ROMs. */
  os: readonly string[];
}

export const BPLUS_MODELS: readonly BPlusModelDefinition[] = Object.freeze([
  Object.freeze({
    synonym: 'BPlus',
    label: 'BBC Model B+ 64K',
    derivedFrom: 'B1770',
    swram: BPLUS_64K_SWRAM,
    os: Object.freeze(['bplus/os2.rom', 'bplus/BASIC2.ROM', 'bplus/dfs223.rom']),
  }),
  Object.freeze({
    synonym: 'BPlusADFS',
    label: 'BBC Model B+ 64K (ADFS)',
    derivedFrom: 'B1770A',
    swram: BPLUS_64K_SWRAM,
    /* ADFS ahead of DFS, so it takes the higher bank and wins the filing
     * system, which is the same ordering the engine uses for the Model B. */
    os: Object.freeze(['bplus/os2.rom', 'bplus/BASIC2.ROM', 'bplus/adfs130.rom', 'bplus/dfs223.rom']),
  }),
]);

export function bplusModelDefinition(name: string): BPlusModelDefinition | undefined {
  return BPLUS_MODELS.find((candidate) => candidate.synonym.toLowerCase() === name.toLowerCase());
}

/**
 * The machine a name asks for, whether the engine has it or this build adds it.
 *
 * The workbench asks here rather than asking jsbeeb directly, because "the
 * engine has no B+" is true and "this product cannot run one" is not. Anything
 * the engine does publish is returned untouched.
 */
export function resolveMachineModel<T extends object>(
  name: string,
  fromEngine: (name: string) => T | null | undefined,
): { model: T; bplus: BPlusModelDefinition | null } | null {
  const bplus = bplusModelDefinition(name);
  if (bplus) {
    const base = fromEngine(bplus.derivedFrom);
    if (!base) throw new Error(`The ${bplus.label} is built on the engine's ${bplus.derivedFrom}, which this engine does not publish`);
    return { model: bplusModelFrom(base, { os: bplus.os, name: bplus.label, swram: bplus.swram }), bplus };
  }
  const model = fromEngine(name);
  return model ? { model, bplus: null } : null;
}

/**
 * Build a B+ with the furniture the engine's own factory would have supplied.
 *
 * `fake6502` chooses between the engine's two processor classes and knows
 * nothing of a third, so this is that function's body with one class swapped
 * and nothing else changed. It lives here rather than in the runtime so that
 * everything the B+ needs is in the file that explains what a B+ is.
 */
export function createBPlusCpu<M extends object, C>(model: M, parts: { video: unknown; soundChip: unknown }): C {
  return new BPlusCpu6502(model as never, {
    dbgr: { setCpu: () => {} },
    video: parts.video,
    soundChip: parts.soundChip,
    ddNoise: new FakeDdNoise(),
    relayNoise: new FakeRelayNoise(),
    music5000: new FakeMusic5000(),
    cmos: new Cmos(),
    /* No Tube: a B+ has the interface, and this build has never completed a
     * Tube boot on a BBC-family host, so claiming one here would be a second
     * unproven thing riding on a new machine. */
    config: { tube: null },
  }) as unknown as C;
}
