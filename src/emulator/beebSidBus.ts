/*
 * Putting BeebSID on the 1 MHz bus.
 *
 * `beebSid.ts` is the chip; this is the wire. jsbeeb reaches every 1 MHz bus
 * device through `readDevice` and `writeDevice`, and its own handler for
 * &FC20 to &FC3F is a bare `break`, so a subclass that answers those addresses
 * and defers everything else is the whole of what is needed. Nothing in the
 * engine is patched and nothing else changes behaviour.
 *
 * It is a mixin rather than a class because the B+ is already a subclass of
 * jsbeeb's processor. A machine can be a B+, or have a SID, or both, and a
 * second fixed subclass could not express the third case.
 */
import { BeebSid, SID_ADDRESS_MASK, SID_BASE_ADDRESS, type SidModel } from './beebSid';

/** The bus addresses BeebSID answers on, which is the range jsbeeb decodes. */
export const SID_ADDRESS_FIRST = SID_BASE_ADDRESS;
export const SID_ADDRESS_LAST = SID_BASE_ADDRESS + SID_ADDRESS_MASK;

export function sidHandles(address: number): boolean {
  return address >= SID_ADDRESS_FIRST && address <= SID_ADDRESS_LAST;
}

/** What a processor has to offer for a SID to be fitted to it. */
interface DeviceBus {
  readDevice(address: number): number;
  writeDevice(address: number, value: number): void;
  reset(hard: boolean): void;
}

/* TypeScript requires a mixin's base to be constructible with a rest
 * parameter, which is why this is `any[]` and not the engine's own argument
 * list. The cast is at the factory call, where the arguments are known. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructor<T> = new (...args: any[]) => T;

/**
 * Fit a BeebSID to a processor class.
 *
 * The returned class carries a `beebSid` the audio path can pull samples from.
 * A machine without one keeps jsbeeb's own behaviour exactly, because the base
 * class is what answers every address this one does not claim.
 */
export function withBeebSid<T extends Constructor<DeviceBus>>(Base: T, model: SidModel = '6581', sampleRate = 44_100) {
  return class extends Base {
    readonly beebSid = new BeebSid(model, sampleRate);

    override readDevice(address: number): number {
      /*
       * Only four of the chip's registers can be read, and the two paddle
       * registers have nothing wired to them on a BeebSID. The chip answers
       * for its whole range rather than letting the base class return whatever
       * an undecoded 1 MHz bus read returns, because a fitted chip does drive
       * the bus.
       */
      if (sidHandles(address)) return this.beebSid.read(address);
      return super.readDevice(address);
    }

    override writeDevice(address: number, value: number): void {
      if (sidHandles(address)) { this.beebSid.write(address, value); return; }
      super.writeDevice(address, value);
    }

    override reset(hard: boolean): void {
      super.reset(hard);
      /*
       * A hard reset silences the chip. A soft one does not: BREAK on a real
       * machine does not reach the 1 MHz bus, and a tune playing through a
       * BeebSID survives it.
       */
      if (hard) this.beebSid.reset();
    }
  };
}
