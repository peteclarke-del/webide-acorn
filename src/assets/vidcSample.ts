/* Encoding sound samples the way VIDC actually consumes them.
 *
 * This was blocked, deliberately, for want of a primary source. The A310
 * adapter could already observe the hardware — VIDC sound period and frequency,
 * MEMC sound DMA start, end, pointer and position — but the byte format the
 * sound DMA consumes was not established anywhere in this build, and shipping
 * an encoder from recollection would have put fabricated sample data in front
 * of people.
 *
 * It is no longer from recollection. Everything below is taken from the Acorn
 * VIDC Datasheet, Part No 0460,020, Issue No 1.0, 30 September 1986, section
 * 6.10 "Sound System" and section 5.22 "Sound Frequency Register", and the
 * quotations in the comments are that document's own words.
 *
 * The one thing worth reading twice is the bit order. The datasheet says: "Note
 * that the order of the bits used to generate the sound values differs between
 * VIDC1 and VIDC2." They are not the same byte with a different name — the sign
 * bit moves from D7 to D0 and everything shifts. Encoding for the wrong one
 * produces noise, so the part is named at every call rather than defaulted.
 */

/** Which part the bytes are for. Not interchangeable; see the note above. */
export type VidcPart = 'vidc1' | 'vidc2';

/**
 * The transfer characteristic, from section 6.10:
 *
 *   "The DAC transfer characteristic consists of 8 linear segments (chords).
 *    Each chord consists of 16 steps, and the step size in one chord is twice
 *    the step size in the preceding chord. This gives an approximation to the
 *    'µ255 law'."
 *
 * Working that through with the datasheet's own figure, which marks the chord
 * boundaries at 0, i, 3i, 7i, 15i, 31i, 63i, 127i and a maximum of 247i: the
 * step in chord 4 is i, so the step in chord 0 is i/16. Everything here is
 * therefore counted in sixteenths of i, which keeps every value a whole number.
 */
export const VIDC_STEP_UNITS = [1, 2, 4, 8, 16, 32, 64, 128] as const;

/** Where each chord begins, in the same sixteenths of i. */
export const VIDC_CHORD_BASE_UNITS = [0, 16, 48, 112, 240, 496, 1008, 2032] as const;

/**
 * The largest magnitude a sample can express: chord 7, point 15.
 *
 * 2032 + 15 × 128 = 3952 sixteenths, which is 247i — exactly the maximum the
 * datasheet's figure marks, and the arithmetic agreeing with the printed figure
 * is the check that the step sizes above were read correctly.
 */
export const VIDC_MAX_MAGNITUDE_UNITS = 3952;

export interface VidcSampleFields {
  /** 0 or 1, as the datasheet's SIGN bit. */
  sign: number;
  /** 0 to 7. */
  chord: number;
  /** 0 to 15, the point on that chord. */
  point: number;
}

export class VidcSampleError extends Error {
  constructor(message: string) { super(message); this.name = 'VidcSampleError'; }
}

/** The output magnitude a chord and point describe, in sixteenths of i. */
export function magnitudeUnits(chord: number, point: number): number {
  if (!Number.isInteger(chord) || chord < 0 || chord > 7) throw new VidcSampleError(`A chord is 0 to 7; ${chord} is not.`);
  if (!Number.isInteger(point) || point < 0 || point > 15) throw new VidcSampleError(`A point on a chord is 0 to 15; ${point} is not.`);
  return VIDC_CHORD_BASE_UNITS[chord]! + point * VIDC_STEP_UNITS[chord]!;
}

/**
 * Pack the fields into a byte, in the order the named part reads them.
 *
 * VIDC1, from the datasheet's diagram:
 *   D7 SIGN | D6 D5 D4 CHORD SELECT | D3 D2 D1 D0 POINT on CHORD
 *
 * VIDC2, from the same diagram:
 *   D7 D6 D5 CHORD SELECT | D4 D3 D2 D1 POINT on CHORD | D0 SIGN
 */
export function packVidcSample(fields: VidcSampleFields, part: VidcPart): number {
  const { sign, chord, point } = fields;
  if (sign !== 0 && sign !== 1) throw new VidcSampleError(`A sign bit is 0 or 1; ${sign} is not.`);
  /* Validated here as well as in magnitudeUnits, because a caller may pack
   * fields it did not compute. */
  magnitudeUnits(chord, point);
  return part === 'vidc1'
    ? ((sign & 1) << 7) | ((chord & 7) << 4) | (point & 15)
    : ((chord & 7) << 5) | ((point & 15) << 1) | (sign & 1);
}

/** Read a byte back into its fields, for the part that wrote it. */
export function unpackVidcSample(byte: number, part: VidcPart): VidcSampleFields {
  if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new VidcSampleError(`A sample byte is 0 to 255; ${byte} is not.`);
  return part === 'vidc1'
    ? { sign: (byte >> 7) & 1, chord: (byte >> 4) & 7, point: byte & 15 }
    : { sign: byte & 1, chord: (byte >> 5) & 7, point: (byte >> 1) & 15 };
}

/**
 * The signed level a byte produces, in sixteenths of i.
 *
 * The sign is which of the two output pin pairs the eighth bit steers the DAC
 * to — section 6.10: "The eighth bit steers the DAC output to one of 2 pairs of
 * output pins, one pair designated '+' and the other pair '-'." A negative
 * number here means that pair, not a two's-complement value.
 */
export function decodeVidcSample(byte: number, part: VidcPart): number {
  const { sign, chord, point } = unpackVidcSample(byte, part);
  const magnitude = magnitudeUnits(chord, point);
  return sign ? -magnitude : magnitude;
}

/**
 * Encode a linear sample as the nearest value VIDC can actually produce.
 *
 * Nearest rather than truncated, and the error is returned rather than
 * discarded: the encoding is lossy by design — it is a companding law — and a
 * caller converting a whole waveform is entitled to know how far from it the
 * result landed.
 *
 * `level` is in the same sixteenths of i the rest of this module counts in, so
 * the caller decides what full scale means rather than this module assuming it.
 */
export function encodeVidcLevel(level: number, part: VidcPart): { byte: number; encoded: number; error: number; clipped: boolean } {
  if (!Number.isFinite(level)) throw new VidcSampleError('A sample level has to be a finite number.');
  const sign = level < 0 ? 1 : 0;
  const wanted = Math.abs(level);
  const clipped = wanted > VIDC_MAX_MAGNITUDE_UNITS;
  const target = clipped ? VIDC_MAX_MAGNITUDE_UNITS : wanted;

  /* The chord whose range contains the target. Searched from the top so a
   * value sitting exactly on a boundary takes the lower chord, which is the
   * one that can represent it with the finer step. */
  let chord = 0;
  for (let candidate = 7; candidate >= 0; candidate -= 1) {
    if (target >= VIDC_CHORD_BASE_UNITS[candidate]!) { chord = candidate; break; }
  }
  const step = VIDC_STEP_UNITS[chord]!;
  const point = Math.min(15, Math.max(0, Math.round((target - VIDC_CHORD_BASE_UNITS[chord]!) / step)));
  const encoded = magnitudeUnits(chord, point);
  const byte = packVidcSample({ sign, chord, point }, part);
  return { byte, encoded: sign ? -encoded : encoded, error: (sign ? -encoded : encoded) - level, clipped };
}

/**
 * Convert signed 16-bit PCM to VIDC sample bytes.
 *
 * Full scale is mapped to the largest magnitude VIDC can express, so the
 * loudest part of the source is the loudest thing the hardware can produce and
 * nothing is quietly attenuated.
 */
export function encodePcm16(samples: Int16Array | readonly number[], part: VidcPart): { bytes: Uint8Array; worstError: number; clipped: number } {
  const bytes = new Uint8Array(samples.length);
  let worstError = 0;
  let clipped = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]!;
    const level = (sample / 32768) * VIDC_MAX_MAGNITUDE_UNITS;
    const result = encodeVidcLevel(level, part);
    bytes[index] = result.byte;
    if (result.clipped) clipped += 1;
    worstError = Math.max(worstError, Math.abs(result.error));
  }
  return { bytes, worstError, clipped };
}

/* --- the registers that make the bytes mean something ---------------------- */

/**
 * Sound Frequency Register, section 5.22:
 *
 *   "This register defines the byte sample rate of the sound data. It is
 *    defined in units of 1µs. If a sample period of Nµs is required, then (N-1)
 *    should be programmed into the SFR. N may take any value between 3 and 256.
 *    ... Bit 8 in the SFR is used as a test bit, and should always be set to 1."
 */
export const SFR_MIN_PERIOD_US = 3;
export const SFR_MAX_PERIOD_US = 256;

export function soundFrequencyRegister(periodMicroseconds: number): number {
  if (!Number.isInteger(periodMicroseconds) || periodMicroseconds < SFR_MIN_PERIOD_US || periodMicroseconds > SFR_MAX_PERIOD_US) {
    throw new VidcSampleError(`A VIDC sample period is a whole number of microseconds from ${SFR_MIN_PERIOD_US} to ${SFR_MAX_PERIOD_US}; ${periodMicroseconds} is not.`);
  }
  /* (N-1) in bits 0 to 7, and bit 8 set, which the datasheet says must always
   * be: "When this bit is set LOW, all the internal timing signals are
   * cleared." */
  return ((periodMicroseconds - 1) & 0xff) | 0x100;
}

/**
 * The rate one channel is actually sampled at.
 *
 * Section 6.10: "In eight channel mode the bytes for each channel are sampled
 * at one-eighth of the frequency of single channel mode for a given value in
 * the SFR." The byte rate is what the SFR sets; the per-channel rate is that
 * divided between the channels.
 */
export function channelSampleRateHz(periodMicroseconds: number, channels: VidcChannelMode): number {
  if (!Number.isInteger(periodMicroseconds) || periodMicroseconds < SFR_MIN_PERIOD_US || periodMicroseconds > SFR_MAX_PERIOD_US) {
    throw new VidcSampleError(`A VIDC sample period is a whole number of microseconds from ${SFR_MIN_PERIOD_US} to ${SFR_MAX_PERIOD_US}; ${periodMicroseconds} is not.`);
  }
  return 1_000_000 / (periodMicroseconds * channels);
}

/** Section 6.10: "The system can operate in 1, 2, 4 or 8 channel modes." */
export type VidcChannelMode = 1 | 2 | 4 | 8;

/**
 * Stereo position, section 5.5 Table 3.
 *
 * Value 0 is `Undefined` in the datasheet — not centre, and not silence. It is
 * modelled as its own thing rather than mapped to something reasonable,
 * because a register the documentation declines to define is not one this build
 * gets to define on its behalf.
 */
export const STEREO_IMAGE_VALUES = [
  { value: 0, label: 'undefined', detail: 'The datasheet does not define this value. It is not centre and it is not silence.' },
  { value: 1, label: '100% left', detail: '' },
  { value: 2, label: '83% left', detail: '' },
  { value: 3, label: '67% left', detail: '' },
  { value: 4, label: 'centre', detail: '' },
  { value: 5, label: '67% right', detail: '' },
  { value: 6, label: '83% right', detail: '' },
  { value: 7, label: '100% right', detail: '' },
] as const;

/**
 * Which stereo image registers have to be programmed alike for a channel count.
 *
 * Section 6.10 spells this out and it is easy to get wrong: "When only 4
 * channels are used, registers 4,5,6,7 should be programmed to the same values
 * as registers 0,1,2,3 respectively. When only 2 channels are used, registers
 * 0,2,4 & 6 pertain to one channel ... and registers 1,3,5 & 7 pertain to the
 * other channel. When only one channel is used, all 8 registers should be
 * programmed to the same value."
 */
export function stereoRegistersForChannel(channel: number, mode: VidcChannelMode): number[] {
  if (!Number.isInteger(channel) || channel < 0 || channel >= mode) {
    throw new VidcSampleError(`In ${mode}-channel mode the channels are 0 to ${mode - 1}; ${channel} is not one of them.`);
  }
  const registers: number[] = [];
  for (let register = 0; register < 8; register += 1) {
    if (register % mode === channel) registers.push(register);
  }
  return registers;
}

/** The eight stereo image register addresses, from Table 2. */
export const STEREO_IMAGE_REGISTER_ADDRESSES: Readonly<Record<number, number>> = Object.freeze({
  0: 0x64, 1: 0x68, 2: 0x6c, 3: 0x70, 4: 0x74, 5: 0x78, 6: 0x7c, 7: 0x60,
});

/*
 * What the qualified A310 core actually does with a sound byte.
 *
 * The datasheet names VIDC1 and VIDC2 and gives each a different bit order.
 * The A310 carries VIDC1a, a speed-graded VIDC1, and taking the VIDC1 order to
 * apply to it is an inference rather than something the datasheet states. It
 * was measured instead: RISC OS 3.11 keeps sound DMA running, so the whole
 * region sound DMA can reach was filled with a known byte alternating against
 * &00 and the level the machine produced was captured through the core's own
 * PCM tap. Nothing in the core's decode table was read; only what came out of
 * it. Each byte was measured twice, the second reading being the byte alone,
 * and the levels are relative to &FF.
 *
 * The answer is VIDC2, which is not what the inference said. These figures are
 * kept here so the module carries its own evidence, and so a change to the
 * decoding fails against a measurement rather than against an opinion.
 *
 * This says what the core this product runs does. It is not evidence about
 * VIDC1a silicon, and it does not make the datasheet wrong — an emulator can
 * be wrong too, and this measurement cannot tell the two apart.
 */
export const A310_MEASURED_LEVELS: ReadonlyArray<{ byte: number; ratio: number }> = Object.freeze([
  { byte: 0xff, ratio: 1.00000 },
  { byte: 0xbf, ratio: 0.24695 },
  { byte: 0x80, ratio: 0.06067 },
  { byte: 0x7f, ratio: 0.05866 },
  { byte: 0x71, ratio: 0.04447 },
  { byte: 0x3f, ratio: 0.01159 },
  { byte: 0x1f, ratio: 0.00378 },
]);
