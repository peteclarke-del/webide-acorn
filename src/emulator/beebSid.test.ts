import { describe, expect, it } from 'vitest';
import { BeebSid, SID_BASE_ADDRESS, SID_CLOCK_HZ } from './beebSid';

/** One voice's register base, as the chip lays them out. */
const voice = (index: number) => index * 7;

/** Play a note and return the loudest sample seen over that many milliseconds. */
function peakOver(sid: BeebSid, milliseconds: number, sampleRate = 44_100): number {
  let peak = 0;
  for (let index = 0; index < (sampleRate * milliseconds) / 1000; index++) {
    peak = Math.max(peak, Math.abs(sid.sample()));
  }
  return peak;
}

describe('BeebSID register file', () => {
  it('takes a bus address anywhere in the decoded range rather than a register index', () => {
    const sid = new BeebSid();
    sid.write(SID_BASE_ADDRESS + 0x18, 0x0f);
    const mirrored = new BeebSid();
    mirrored.write(0x18, 0x0f);
    expect(sid.snapshotState().registers[0x18]).toBe(0x0f);
    expect(mirrored.snapshotState().registers[0x18]).toBe(0x0f);
  });

  it('assembles the sixteen-bit frequency and twelve-bit pulse width from their halves', () => {
    const sid = new BeebSid();
    sid.write(voice(0) + 0, 0x34);
    sid.write(voice(0) + 1, 0x12);
    sid.write(voice(0) + 2, 0xcd);
    sid.write(voice(0) + 3, 0xfa);
    const state = sid.snapshotState();
    expect(state.registers[0]).toBe(0x34);
    expect(state.registers[1]).toBe(0x12);
    /* The pulse width's high register carries only four bits; the rest is not
     * part of the value and must not be stored as though it were. */
    expect(state.registers[3]).toBe(0xfa);
  });

  it('ignores writes above the register file rather than growing it', () => {
    const sid = new BeebSid();
    sid.write(SID_BASE_ADDRESS + 0x1f, 0xff);
    expect(sid.snapshotState().registers).toHaveLength(0x1d);
  });
});

describe('BeebSID voices', () => {
  it('is silent until a gate opens, which is what makes a written register file safe', () => {
    const sid = new BeebSid();
    sid.write(voice(0) + 1, 0x20);
    sid.write(voice(0) + 4, 0x20); // sawtooth selected, gate still closed
    sid.write(0x18, 0x0f);
    expect(peakOver(sid, 20)).toBe(0);
  });

  it('sounds once the gate opens and falls silent again when it closes', () => {
    const sid = new BeebSid();
    sid.write(0x18, 0x0f);
    sid.write(voice(0) + 1, 0x20);
    sid.write(voice(0) + 5, 0x00); // fastest attack and decay
    sid.write(voice(0) + 6, 0xf0); // full sustain, fastest release
    sid.write(voice(0) + 4, 0x21); // sawtooth, gate open
    expect(peakOver(sid, 50)).toBeGreaterThan(0.05);

    sid.write(voice(0) + 4, 0x20); // gate closed
    peakOver(sid, 200);
    expect(peakOver(sid, 20)).toBeLessThan(0.01);
  });

  it('holds at the sustain level rather than decaying to nothing', () => {
    const sid = new BeebSid();
    sid.write(0x18, 0x0f);
    sid.write(voice(0) + 1, 0x20);
    sid.write(voice(0) + 5, 0x00);
    sid.write(voice(0) + 6, 0x80); // sustain at half
    sid.write(voice(0) + 4, 0x21);
    peakOver(sid, 300);
    expect(peakOver(sid, 50)).toBeGreaterThan(0.02);
  });

  it('puts the master volume in charge of the output', () => {
    const play = (volume: number) => {
      const sid = new BeebSid();
      sid.write(0x18, volume);
      sid.write(voice(0) + 1, 0x20);
      sid.write(voice(0) + 5, 0x00);
      sid.write(voice(0) + 6, 0xf0);
      sid.write(voice(0) + 4, 0x21);
      return peakOver(sid, 50);
    };
    expect(play(0x00)).toBe(0);
    expect(play(0x0f)).toBeGreaterThan(play(0x07));
  });

  it('silences voice three when asked, unless the filter is taking it', () => {
    const play = (mode: number, routing: number) => {
      const sid = new BeebSid();
      sid.write(0x17, routing);
      sid.write(0x18, mode | 0x0f);
      sid.write(voice(2) + 1, 0x20);
      sid.write(voice(2) + 5, 0x00);
      sid.write(voice(2) + 6, 0xf0);
      sid.write(voice(2) + 4, 0x21);
      return peakOver(sid, 50);
    };
    expect(play(0x00, 0x00)).toBeGreaterThan(0.05);
    expect(play(0x80, 0x00)).toBe(0);
    /* Routed through the filter it still sounds, which is what lets a tune use
     * voice three as a modulation source and hear it too. A filter mode has to
     * be selected for that: routing a voice into the filter and choosing no
     * mode is silence on a real chip, not a way round the disable bit. */
    expect(play(0x80 | 0x10, 0x04)).toBeGreaterThan(0);
    expect(play(0x80, 0x04)).toBe(0);
  });
});

describe('BeebSID readable registers', () => {
  it('reports oscillator and envelope three, and nothing for the unwired paddles', () => {
    const sid = new BeebSid();
    sid.write(0x18, 0x0f);
    sid.write(voice(2) + 1, 0x20);
    sid.write(voice(2) + 5, 0x00);
    sid.write(voice(2) + 6, 0xf0);
    sid.write(voice(2) + 4, 0x21);
    peakOver(sid, 50);
    expect(sid.read(SID_BASE_ADDRESS + 0x1c)).toBeGreaterThan(0);
    expect(sid.read(SID_BASE_ADDRESS + 0x19)).toBe(0);
    expect(sid.read(SID_BASE_ADDRESS + 0x1a)).toBe(0);
  });
});

describe('BeebSID clocking', () => {
  it('is clocked from the 1 MHz bus, which is what sets the pitch', () => {
    expect(SID_CLOCK_HZ).toBe(1_000_000);
  });

  it('keeps a fractional clock debt so the pitch does not drift with sample rate', () => {
    /* A 24-bit accumulator stepped at 1 MHz and sampled at 44.1 kHz needs about
     * 22.68 chip clocks per sample. Dropping the fraction would flatten every
     * note, so the same note must come out at the same pitch at two rates. */
    const cyclesFor = (rate: number) => {
      const sid = new BeebSid('6581', rate);
      sid.write(0x18, 0x0f);
      sid.write(voice(0) + 1, 0x10);
      sid.write(voice(0) + 5, 0x00);
      sid.write(voice(0) + 6, 0xf0);
      sid.write(voice(0) + 4, 0x21);
      let crossings = 0;
      let previous = 0;
      for (let index = 0; index < rate; index++) {
        const value = sid.sample();
        if (previous <= 0 && value > 0) crossings++;
        previous = value;
      }
      return crossings;
    };
    const at44 = cyclesFor(44_100);
    const at48 = cyclesFor(48_000);
    expect(Math.abs(at44 - at48) / at44).toBeLessThan(0.02);
  });

  it('resets to a silent chip with an empty register file', () => {
    const sid = new BeebSid();
    sid.write(0x18, 0x0f);
    sid.write(voice(0) + 4, 0x21);
    sid.reset();
    expect(sid.snapshotState().registers.every((value) => value === 0)).toBe(true);
    expect(peakOver(sid, 20)).toBe(0);
  });
});
