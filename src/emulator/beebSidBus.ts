/*
 * Putting BeebSID on the 1 MHz bus.
 *
 * `beebSid.ts` is the chip; this is the wire. jsbeeb reaches every 1 MHz bus
 * device through `readDevice` and `writeDevice`, and its own handler for
 * &FC20 to &FC3F is a bare `break`, so answering those addresses and deferring
 * everything else is the whole of what is needed. Nothing in the engine is
 * patched on disk and no other address changes behaviour.
 *
 * It fits an already-built processor rather than subclassing one. jsbeeb's own
 * factory chooses between its processor classes and this build adds a third for
 * the B+, so a machine can be a Model B, a B+ or a Master and a subclass per
 * combination would multiply for no gain. Wrapping the two methods on the
 * instance is what the audio path here already does to the sound chip's `poke`
 * and the speaker's `pushBit`, so it is the shape this codebase already uses
 * for exactly this problem.
 */
import { BeebSid, SID_ADDRESS_MASK, SID_BASE_ADDRESS, type SidModel } from './beebSid';

/** The bus addresses BeebSID answers on, which is the range jsbeeb decodes. */
export const SID_ADDRESS_FIRST = SID_BASE_ADDRESS;
export const SID_ADDRESS_LAST = SID_BASE_ADDRESS + SID_ADDRESS_MASK;

export function sidHandles(address: number): boolean {
  return address >= SID_ADDRESS_FIRST && address <= SID_ADDRESS_LAST;
}

/** What a processor has to offer for a SID to be fitted to it. */
export interface SidHost {
  readDevice(address: number): number;
  writeDevice(address: number, value: number): void;
  reset(hard: boolean): void;
  beebSid?: BeebSid;
}

/**
 * Fit a BeebSID to a machine, and hand back the chip.
 *
 * Fitting twice returns the chip already fitted rather than stacking a second
 * one, because a machine has one 1 MHz bus and a second wrap would answer the
 * same addresses twice.
 */
export function fitBeebSid(host: SidHost, model: SidModel = '6581', sampleRate = 44_100): BeebSid {
  if (host.beebSid) return host.beebSid;
  const sid = new BeebSid(model, sampleRate);
  const read = host.readDevice.bind(host);
  const write = host.writeDevice.bind(host);
  const reset = host.reset.bind(host);

  /*
   * Only four of the chip's registers can be read, and the two paddle
   * registers have nothing wired to them on a BeebSID. The chip answers for its
   * whole range rather than letting the machine return whatever an undecoded
   * 1 MHz bus read returns, because a fitted chip does drive the bus.
   */
  host.readDevice = (address: number) => (sidHandles(address) ? sid.read(address) : read(address));
  host.writeDevice = (address: number, value: number) => {
    if (sidHandles(address)) { sid.write(address, value); return; }
    write(address, value);
  };
  /*
   * A hard reset silences the chip. A soft one does not: BREAK on a real
   * machine does not reach the 1 MHz bus, and a tune playing through a BeebSID
   * survives it.
   */
  host.reset = (hard: boolean) => { reset(hard); if (hard) sid.reset(); };

  host.beebSid = sid;
  return sid;
}
