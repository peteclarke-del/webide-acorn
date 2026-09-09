/*
 * A 6581/8580 for BeebSID, on the 1 MHz bus at &FC20.
 *
 * The pinned jsbeeb decodes &FC20 to &FC3F and does nothing with it: the case
 * body in its write path is a bare `break`, so a program can write the whole
 * register file and hear silence. That is the honest behaviour for a core that
 * models no SID, and it is why a soundtrack could be written here and never
 * play. This is the chip behind those addresses.
 *
 * What this is, and what it is not. It is a register-accurate SID voice engine:
 * three oscillators with the real 24-bit phase accumulator, the four waveforms,
 * ring modulation and hard sync, three envelope generators driven by the
 * published rate table, and the master volume and voice-3-disable bits. Music
 * written for a SID plays, and plays at the right pitch and the right envelope
 * shape, because all of that is digital and specified.
 *
 * It is not a model of the analogue parts. The 6581's filter is a switched
 * capacitor design whose cutoff curve varies between individual chips, and its
 * distortion and the famous non-zero output with the volume at zero come from
 * analogue behaviour nobody has captured in a specification. The filter here is
 * a state-variable filter tuned to the published cutoff range, which tracks the
 * intent of a tune rather than the sound of one particular chip. Anything that
 * depends on a specific 6581's character will not sound like that chip, and
 * this file says so rather than implying otherwise.
 *
 * The register map is the chip's own, offset from &FC20:
 *
 *   00-06, 07-0D, 0E-14   the three voices, seven registers each
 *   15-16                 filter cutoff, 11 bits across two registers
 *   17                    resonance and which voices the filter takes
 *   18                    filter mode and master volume
 *   19-1C                 read-only: two paddles, oscillator 3, envelope 3
 */

/** The chip is clocked from the 1 MHz bus, as BeebSID wires it. */
export const SID_CLOCK_HZ = 1_000_000;

/** The register file is 29 bytes, mirrored through the 32-byte decode. */
export const SID_REGISTER_COUNT = 0x1d;

/** Where BeebSID answers on the 1 MHz bus. */
export const SID_BASE_ADDRESS = 0xfc20;
export const SID_ADDRESS_MASK = 0x1f;

/** Which SID is fitted. They differ in filter range and in waveform mixing. */
export type SidModel = '6581' | '8580';

const WAVE_TRIANGLE = 0x10;
const WAVE_SAWTOOTH = 0x20;
const WAVE_PULSE = 0x40;
const WAVE_NOISE = 0x80;
const CONTROL_GATE = 0x01;
const CONTROL_SYNC = 0x02;
const CONTROL_RING = 0x04;
const CONTROL_TEST = 0x08;

/*
 * The envelope rate table, in chip clocks per step, straight from the 6581 data
 * sheet's attack and decay/release timings. The decay and release columns are
 * three times their attack counterpart, which is how the chip is built rather
 * than a coincidence worth hiding behind a multiplier.
 */
const ATTACK_PERIODS = [
  9, 32, 63, 95, 149, 220, 267, 313, 392, 977, 1954, 3126, 3907, 11_720, 19_532, 31_251,
] as const;

/** Where the envelope's exponential decay changes slope, as the chip does it. */
const EXPONENTIAL_STEPS: ReadonlyArray<readonly [number, number]> = [
  [0x5d, 1], [0x36, 2], [0x1a, 4], [0x0e, 8], [0x06, 16], [0x00, 30],
];

type EnvelopePhase = 'attack' | 'decay' | 'sustain' | 'release';

class SidEnvelope {
  private phase: EnvelopePhase = 'release';
  private counter = 0;
  private exponentialCounter = 0;
  level = 0;

  attack = 0;
  decay = 0;
  sustain = 0;
  release = 0;
  private gate = false;

  setGate(open: boolean): void {
    if (open === this.gate) return;
    this.gate = open;
    /*
     * A gate opening restarts the attack from wherever the level happens to be
     * rather than from zero, which is what makes a retriggered note on a
     * still-sounding voice sound the way it does.
     */
    this.phase = open ? 'attack' : 'release';
    this.counter = 0;
    this.exponentialCounter = 0;
  }

  /** The divider the level is falling through, which flattens as it decays. */
  private exponentialPeriod(): number {
    for (const [threshold, divider] of EXPONENTIAL_STEPS) if (this.level > threshold) return divider;
    return 30;
  }

  step(): void {
    const rate = this.phase === 'attack' ? this.attack : this.phase === 'decay' ? this.decay : this.release;
    const period = ATTACK_PERIODS[rate & 0x0f]! * (this.phase === 'attack' ? 1 : 3);
    if (++this.counter < period) return;
    this.counter = 0;

    if (this.phase === 'attack') {
      /* Attack is linear: the one phase the chip does not divide down. */
      if (this.level < 0xff) this.level += 1;
      if (this.level >= 0xff) { this.level = 0xff; this.phase = 'decay'; }
      return;
    }

    if (this.phase === 'sustain') {
      /* Sustain is a level, not a rate. It holds until the gate closes, and it
       * follows the sustain register if a tune changes it mid-note. */
      const target = (this.sustain & 0x0f) * 0x11;
      if (this.level > target) this.phase = 'decay';
      return;
    }

    if (++this.exponentialCounter < this.exponentialPeriod()) return;
    this.exponentialCounter = 0;
    const floor = this.phase === 'decay' ? (this.sustain & 0x0f) * 0x11 : 0;
    if (this.level > floor) this.level -= 1;
    if (this.phase === 'decay' && this.level <= floor) this.phase = 'sustain';
  }
}

class SidVoice {
  accumulator = 0;
  private noise = 0x7ffff8;
  private previousMsb = false;
  frequency = 0;
  pulseWidth = 0;
  control = 0;
  readonly envelope = new SidEnvelope();

  reset(): void {
    this.accumulator = 0;
    this.noise = 0x7ffff8;
    this.previousMsb = false;
  }

  get msb(): boolean { return (this.accumulator & 0x800000) !== 0; }

  /** One chip clock. `syncSource` is the voice wired to this one's sync input. */
  step(syncSource: SidVoice): void {
    this.envelope.step();
    if (this.control & CONTROL_TEST) { this.accumulator = 0; return; }

    const before = this.msb;
    this.accumulator = (this.accumulator + this.frequency) & 0xffffff;

    /* Hard sync resets this oscillator when the source's MSB rises, which is
     * the whole of the effect: the source keeps its own phase. */
    if (this.control & CONTROL_SYNC && syncSource.roseThisStep) this.accumulator = 0;

    /* The noise register shifts on the accumulator's bit 19 rising, not on
     * every clock, which is why noise pitch follows the frequency register. */
    const bit19 = (this.accumulator & 0x080000) !== 0;
    if (bit19 && !this.previousMsb) {
      const feedback = ((this.noise >> 22) ^ (this.noise >> 17)) & 1;
      this.noise = ((this.noise << 1) | feedback) & 0x7fffff;
    }
    this.previousMsb = bit19;
    this.rose = !before && this.msb;
  }

  private rose = false;
  get roseThisStep(): boolean { return this.rose; }

  /**
   * The oscillator output as a 12-bit unsigned value.
   *
   * Combining waveforms on a real SID ANDs them together through the chip's own
   * wiring, which produces the ragged shapes tunes use deliberately. That AND is
   * modelled; the exact combined-waveform sample tables of an individual chip
   * are not.
   */
  output(ringSource: SidVoice): number {
    const wave = this.control & 0xf0;
    if (wave === 0) return 0;
    let value = 0xfff;

    if (wave & WAVE_TRIANGLE) {
      /* Ring modulation replaces this oscillator's MSB with the exclusive or of
       * the two, which only affects the triangle. */
      const msb = (this.control & CONTROL_RING ? this.accumulator ^ ringSource.accumulator : this.accumulator) & 0x800000;
      const folded = (msb ? ~this.accumulator : this.accumulator) >>> 11;
      value &= (folded & 0xfff);
    }
    if (wave & WAVE_SAWTOOTH) value &= (this.accumulator >>> 12) & 0xfff;
    if (wave & WAVE_PULSE) value &= (this.accumulator >>> 12) >= (this.pulseWidth & 0xfff) ? 0xfff : 0x000;
    if (wave & WAVE_NOISE) {
      const n = this.noise;
      value &= (((n >> 11) & 0x800) | ((n >> 10) & 0x400) | ((n >> 7) & 0x200) | ((n >> 5) & 0x100)
        | ((n >> 4) & 0x080) | ((n >> 1) & 0x040) | ((n << 1) & 0x020) | ((n << 2) & 0x010)) & 0xfff;
    }
    return value;
  }
}

/**
 * A state-variable filter standing in for the chip's analogue one.
 *
 * The published cutoff range is about 30 Hz to 12 kHz on a 6581 and 30 Hz to
 * 12.5 kHz on an 8580, and the register is 11 bits. Real chips vary widely
 * around that curve, so this tracks the specification rather than any one part.
 */
class SidFilter {
  private low = 0;
  private band = 0;

  step(input: number, cutoff: number, resonance: number, sampleRate: number): { low: number; band: number; high: number } {
    const hz = 30 + (cutoff / 2047) * (12_000 - 30);
    const f = Math.min(1, (2 * Math.PI * hz) / sampleRate);
    const q = 1 / Math.max(0.5, 0.707 + (resonance / 15) * 3);
    const high = input - this.low - q * this.band;
    this.band += f * high;
    this.low += f * this.band;
    return { low: this.low, band: this.band, high };
  }

  reset(): void { this.low = 0; this.band = 0; }
}

/**
 * BeebSID.
 *
 * `write` takes a bus address anywhere in the decoded range and the byte; the
 * caller does not have to reduce it to a register index. `sample` advances the
 * chip by however many chip clocks one output sample is worth and returns that
 * sample in the range -1 to 1.
 */
export class BeebSid {
  private readonly registers = new Uint8Array(SID_REGISTER_COUNT);
  private readonly voices = [new SidVoice(), new SidVoice(), new SidVoice()] as const;
  private readonly filter = new SidFilter();
  private clockDebt = 0;

  constructor(readonly model: SidModel = '6581', private readonly sampleRate = 44_100) {}

  reset(): void {
    this.registers.fill(0);
    for (const voice of this.voices) {
      voice.reset();
      voice.frequency = 0; voice.pulseWidth = 0; voice.control = 0;
      voice.envelope.setGate(false);
      voice.envelope.level = 0;
    }
    this.filter.reset();
    this.clockDebt = 0;
  }

  /** The register file as it stands, for a state snapshot or an inspector. */
  snapshotState(): { registers: number[]; envelopes: number[]; model: SidModel } {
    return {
      registers: Array.from(this.registers),
      envelopes: this.voices.map((voice) => voice.envelope.level),
      model: this.model,
    };
  }

  write(address: number, value: number): void {
    const index = address & SID_ADDRESS_MASK;
    if (index >= SID_REGISTER_COUNT) return;
    const byte = value & 0xff;
    this.registers[index] = byte;

    const voice = this.voices[Math.floor(index / 7)];
    if (voice && index < 21) {
      const offset = index % 7;
      if (offset === 0) voice.frequency = (voice.frequency & 0xff00) | byte;
      else if (offset === 1) voice.frequency = (voice.frequency & 0x00ff) | (byte << 8);
      else if (offset === 2) voice.pulseWidth = (voice.pulseWidth & 0x0f00) | byte;
      else if (offset === 3) voice.pulseWidth = (voice.pulseWidth & 0x00ff) | ((byte & 0x0f) << 8);
      else if (offset === 4) { voice.control = byte; voice.envelope.setGate((byte & CONTROL_GATE) !== 0); }
      else if (offset === 5) { voice.envelope.attack = byte >> 4; voice.envelope.decay = byte & 0x0f; }
      else if (offset === 6) { voice.envelope.sustain = byte >> 4; voice.envelope.release = byte & 0x0f; }
    }
  }

  /**
   * The four readable registers.
   *
   * The paddle registers have nothing wired to them on a BeebSID, so they read
   * zero rather than an invented value. Oscillator and envelope 3 are real and
   * are what a tune reads to drive graphics from the music.
   */
  read(address: number): number {
    const index = address & SID_ADDRESS_MASK;
    if (index === 0x1b) return (this.voices[2]!.output(this.voices[1]!) >> 4) & 0xff;
    if (index === 0x1c) return this.voices[2]!.envelope.level & 0xff;
    if (index === 0x19 || index === 0x1a) return 0;
    return 0;
  }

  /** Advance by one output sample and return it, in the range -1 to 1. */
  sample(): number {
    this.clockDebt += SID_CLOCK_HZ / this.sampleRate;
    const steps = Math.floor(this.clockDebt);
    this.clockDebt -= steps;
    for (let step = 0; step < steps; step++) {
      this.voices[0]!.step(this.voices[2]!);
      this.voices[1]!.step(this.voices[0]!);
      this.voices[2]!.step(this.voices[1]!);
    }

    const routing = this.registers[0x17]!;
    const modeVolume = this.registers[0x18]!;
    const cutoff = ((this.registers[0x16]! << 3) | (this.registers[0x15]! & 0x07)) & 0x7ff;
    const ringSources = [this.voices[2]!, this.voices[0]!, this.voices[1]!] as const;

    let filtered = 0;
    let direct = 0;
    for (let index = 0; index < 3; index++) {
      const voice = this.voices[index]!;
      /* Bit 7 of the mode register silences voice 3 unless it is filtered, so a
       * tune can use it purely as a modulation source. */
      if (index === 2 && modeVolume & 0x80 && !(routing & 0x04)) continue;
      const signal = ((voice.output(ringSources[index]!) - 0x800) / 0x800) * (voice.envelope.level / 0xff);
      if (routing & (1 << index)) filtered += signal; else direct += signal;
    }

    const { low, band, high } = this.filter.step(filtered, cutoff, routing >> 4, this.sampleRate);
    let output = direct;
    if (modeVolume & 0x10) output += low;
    if (modeVolume & 0x20) output += band;
    if (modeVolume & 0x40) output += high;

    return Math.max(-1, Math.min(1, (output / 3) * ((modeVolume & 0x0f) / 15)));
  }
}
