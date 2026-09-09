/*
 * Building a BBC-family processor with the parasite this session asked for.
 *
 * The engine's own `fake6502` fits a Tube by host: pass anything truthy and it
 * chooses the second processor Acorn sold for that machine. That is the right
 * default and it is the whole of what it offers, so a Model B could not be
 * given a 65C102 through it however the session was configured.
 *
 * This is that function's body with the parasite passed in rather than derived,
 * and with the processor class passed in too, because this build adds a third
 * one for the B+. Nothing else about it differs: the clock, the noise
 * generators and the Music 5000 stand-in are the same constructor furniture the
 * engine fits to every machine.
 */
import { Cmos } from 'jsbeeb/src/cmos.js';
import { FakeDdNoise } from 'jsbeeb/src/ddnoise.js';
import { FakeRelayNoise } from 'jsbeeb/src/relaynoise.js';
import { FakeMusic5000 } from 'jsbeeb/src/music5000.js';

export interface BbcCpuParts {
  video: unknown;
  soundChip: unknown;
  /** The parasite model, or null for a machine with no second processor. */
  tube?: unknown;
}

type CpuConstructor = new (model: never, options: Record<string, unknown>) => unknown;

/** Build a processor of the given class, with the furniture the engine supplies. */
export function createBbcCpu<M extends object, C>(CpuClass: CpuConstructor, model: M, parts: BbcCpuParts): C {
  return new CpuClass(model as never, {
    dbgr: { setCpu: () => {} },
    video: parts.video,
    soundChip: parts.soundChip,
    ddNoise: new FakeDdNoise(),
    relayNoise: new FakeRelayNoise(),
    music5000: new FakeMusic5000(),
    cmos: new Cmos(),
    config: { tube: parts.tube ?? null },
  }) as C;
}
