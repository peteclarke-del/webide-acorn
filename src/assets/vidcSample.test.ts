// @vitest-environment node

/* Checked against the Acorn VIDC Datasheet, Part No 0460,020, Issue No 1.0,
 * 30 September 1986 — sections 5.5, 5.22 and 6.10 — rather than against what
 * an implementation happened to do. The figures the datasheet prints are the
 * assertions: if the step sizes were read wrongly, the chord boundaries would
 * not come out at the numbers on its graph.
 */
import { describe, expect, it } from 'vitest';
import {
  A310_MEASURED_LEVELS,
  SFR_MAX_PERIOD_US,
  SFR_MIN_PERIOD_US,
  STEREO_IMAGE_REGISTER_ADDRESSES,
  STEREO_IMAGE_VALUES,
  VIDC_CHORD_BASE_UNITS,
  VIDC_MAX_MAGNITUDE_UNITS,
  VidcSampleError,
  channelSampleRateHz,
  decodeVidcSample,
  encodePcm16,
  encodeVidcLevel,
  magnitudeUnits,
  packVidcSample,
  soundFrequencyRegister,
  stereoRegistersForChannel,
  unpackVidcSample,
} from './vidcSample';

describe('the transfer characteristic the datasheet prints', () => {
  it('puts the chord boundaries exactly where its figure marks them', () => {
    /* The figure marks 0, i, 3i, 7i, 15i, 31i, 63i, 127i. Counted in
     * sixteenths of i, those are 0, 16, 48, 112, 240, 496, 1008, 2032 — and
     * the arithmetic agreeing with the printed figure is what says the step
     * sizes were read correctly. */
    expect(VIDC_CHORD_BASE_UNITS).toEqual([0, 16, 48, 112, 240, 496, 1008, 2032]);
    for (let chord = 0; chord < 7; chord += 1) {
      /* "Each chord consists of 16 steps, and the step size in one chord is
       * twice the step size in the preceding chord." */
      const step = magnitudeUnits(chord, 1) - magnitudeUnits(chord, 0);
      const nextStep = magnitudeUnits(chord + 1, 1) - magnitudeUnits(chord + 1, 0);
      expect(nextStep, `chord ${chord + 1}`).toBe(step * 2);
      /* Sixteen steps of this chord reach the base of the next. */
      expect(magnitudeUnits(chord, 0) + 16 * step).toBe(VIDC_CHORD_BASE_UNITS[chord + 1]);
    }
  });

  it('reaches the maximum of 247i the figure marks, and no further', () => {
    /* 2032 + 15 × 128 = 3952 sixteenths = 247i. */
    expect(magnitudeUnits(7, 15)).toBe(VIDC_MAX_MAGNITUDE_UNITS);
    expect(VIDC_MAX_MAGNITUDE_UNITS / 16).toBe(247);
  });

  it('refuses a chord or point outside what the format holds', () => {
    expect(() => magnitudeUnits(8, 0)).toThrow(/A chord is 0 to 7/);
    expect(() => magnitudeUnits(0, 16)).toThrow(/A point on a chord is 0 to 15/);
  });
});

describe('the bit order, which differs between the parts', () => {
  it('packs VIDC1 as sign, chord, point from D7 down', () => {
    /* "D7 SIGN | D6 D5 D4 CHORD SELECT | D3 D2 D1 D0 POINT on CHORD" */
    expect(packVidcSample({ sign: 1, chord: 0b101, point: 0b1010 }, 'vidc1')).toBe(0b1_101_1010);
    expect(packVidcSample({ sign: 0, chord: 0, point: 0 }, 'vidc1')).toBe(0);
  });

  it('packs VIDC2 as chord, point, sign from D7 down', () => {
    /* "D7 D6 D5 CHORD SELECT | D4 D3 D2 D1 POINT on CHORD | D0 SIGN" */
    expect(packVidcSample({ sign: 1, chord: 0b101, point: 0b1010 }, 'vidc2')).toBe(0b101_1010_1);
  });

  it('produces a different byte for each part from the same fields', () => {
    /* The datasheet says so explicitly, and encoding for the wrong part
     * produces noise rather than a quiet inaccuracy. */
    const fields = { sign: 1, chord: 3, point: 9 };
    expect(packVidcSample(fields, 'vidc1')).not.toBe(packVidcSample(fields, 'vidc2'));
  });

  it('round-trips every byte through both layouts', () => {
    for (const part of ['vidc1', 'vidc2'] as const) {
      for (let byte = 0; byte < 256; byte += 1) {
        expect(packVidcSample(unpackVidcSample(byte, part), part), `${part} ${byte}`).toBe(byte);
      }
    }
  });

  it('refuses a byte or a sign that is not one', () => {
    expect(() => unpackVidcSample(256, 'vidc1')).toThrow(VidcSampleError);
    expect(() => packVidcSample({ sign: 2, chord: 0, point: 0 }, 'vidc1')).toThrow(/A sign bit is 0 or 1/);
  });
});

describe('decoding a sample', () => {
  it('reads the sign as which pair of output pins, not as two’s complement', () => {
    const positive = packVidcSample({ sign: 0, chord: 4, point: 3 }, 'vidc1');
    const negative = packVidcSample({ sign: 1, chord: 4, point: 3 }, 'vidc1');
    expect(decodeVidcSample(positive, 'vidc1')).toBe(magnitudeUnits(4, 3));
    expect(decodeVidcSample(negative, 'vidc1')).toBe(-magnitudeUnits(4, 3));
  });

  it('has a negative zero as well as a positive one, as a sign-magnitude format does', () => {
    expect(decodeVidcSample(packVidcSample({ sign: 0, chord: 0, point: 0 }, 'vidc1'), 'vidc1')).toBe(0);
    expect(decodeVidcSample(packVidcSample({ sign: 1, chord: 0, point: 0 }, 'vidc1'), 'vidc1')).toBe(-0);
  });
});

describe('encoding a level', () => {
  it('lands exactly on a level the format can express', () => {
    const exact = magnitudeUnits(5, 7);
    const encoded = encodeVidcLevel(exact, 'vidc1');
    expect(encoded.encoded).toBe(exact);
    expect(encoded.error).toBe(0);
    expect(encoded.clipped).toBe(false);
  });

  it('reports how far it landed from what was asked, rather than discarding it', () => {
    /* The encoding is a companding law and is lossy by design; a caller
     * converting a waveform is entitled to know. */
    const encoded = encodeVidcLevel(2033, 'vidc1');
    expect(encoded.error).not.toBe(0);
    expect(Math.abs(encoded.error)).toBeLessThanOrEqual(64);
  });

  it('is coarser at high levels than at low ones, which is what companding means', () => {
    const quiet = encodeVidcLevel(5.4, 'vidc1');
    const loud = encodeVidcLevel(2500.4, 'vidc1');
    expect(Math.abs(quiet.error)).toBeLessThan(Math.abs(loud.error));
  });

  it('says when a level is past what the hardware can produce rather than wrapping', () => {
    const encoded = encodeVidcLevel(VIDC_MAX_MAGNITUDE_UNITS * 2, 'vidc1');
    expect(encoded.clipped).toBe(true);
    expect(encoded.encoded).toBe(VIDC_MAX_MAGNITUDE_UNITS);
  });

  it('keeps the sign of a negative level', () => {
    expect(encodeVidcLevel(-1000, 'vidc1').encoded).toBeLessThan(0);
  });

  it('refuses a level that is not a number', () => {
    expect(() => encodeVidcLevel(Number.NaN, 'vidc1')).toThrow(/finite number/);
  });
});

describe('converting PCM', () => {
  it('maps full scale to the loudest the hardware can produce', () => {
    const { bytes, clipped } = encodePcm16([32767, -32768, 0], 'vidc1');
    expect(clipped).toBe(0);
    expect(decodeVidcSample(bytes[0]!, 'vidc1')).toBe(VIDC_MAX_MAGNITUDE_UNITS);
    expect(decodeVidcSample(bytes[1]!, 'vidc1')).toBe(-VIDC_MAX_MAGNITUDE_UNITS);
    expect(Math.abs(decodeVidcSample(bytes[2]!, 'vidc1'))).toBe(0);
  });

  it('produces one byte per sample and reports the worst error over the run', () => {
    const samples = Array.from({ length: 64 }, (_, index) => Math.round(Math.sin(index / 4) * 30000));
    const { bytes, worstError } = encodePcm16(samples, 'vidc1');
    expect(bytes).toHaveLength(64);
    expect(worstError).toBeGreaterThan(0);
    expect(worstError).toBeLessThan(VIDC_MAX_MAGNITUDE_UNITS / 8);
  });
});

describe('the registers that make the bytes mean something', () => {
  it('programs the SFR as the period less one, with the test bit set', () => {
    /* "If a sample period of Nµs is required, then (N-1) should be programmed
     * into the SFR ... Bit 8 ... should always be set to 1." */
    expect(soundFrequencyRegister(3)).toBe(0x102);
    expect(soundFrequencyRegister(256)).toBe(0x1ff);
    expect(soundFrequencyRegister(100) & 0x100).toBe(0x100);
  });

  it('refuses a period the datasheet does not allow', () => {
    expect(() => soundFrequencyRegister(SFR_MIN_PERIOD_US - 1)).toThrow(/3 to 256/);
    expect(() => soundFrequencyRegister(SFR_MAX_PERIOD_US + 1)).toThrow(/3 to 256/);
  });

  it('divides the byte rate between the channels', () => {
    /* "In eight channel mode the bytes for each channel are sampled at
     * one-eighth of the frequency of single channel mode." */
    expect(channelSampleRateHz(4, 1)).toBe(250_000);
    expect(channelSampleRateHz(4, 8)).toBe(31_250);
  });

  it('keeps value 0 of a stereo image register as undefined rather than as centre', () => {
    /* A register the documentation declines to define is not one this build
     * gets to define on its behalf. */
    const undefinedValue = STEREO_IMAGE_VALUES.find((entry) => entry.value === 0)!;
    expect(undefinedValue.label).toBe('undefined');
    expect(undefinedValue.detail).toMatch(/not centre and it is not silence/);
    expect(STEREO_IMAGE_VALUES.find((entry) => entry.value === 4)!.label).toBe('centre');
  });

  it('names which stereo registers a channel needs in each mode', () => {
    /* Section 6.10 spells this out and it is easy to get wrong. */
    expect(stereoRegistersForChannel(0, 1)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(stereoRegistersForChannel(0, 2)).toEqual([0, 2, 4, 6]);
    expect(stereoRegistersForChannel(1, 2)).toEqual([1, 3, 5, 7]);
    expect(stereoRegistersForChannel(2, 4)).toEqual([2, 6]);
    expect(stereoRegistersForChannel(5, 8)).toEqual([5]);
  });

  it('refuses a channel the mode does not have', () => {
    expect(() => stereoRegistersForChannel(2, 2)).toThrow(/the channels are 0 to 1/);
  });

  it('carries the register addresses the datasheet tabulates', () => {
    /* Table 2, which is not in the order somebody would guess: register 7 is
     * at the lowest address. */
    expect(STEREO_IMAGE_REGISTER_ADDRESSES[7]).toBe(0x60);
    expect(STEREO_IMAGE_REGISTER_ADDRESSES[0]).toBe(0x64);
    expect(STEREO_IMAGE_REGISTER_ADDRESSES[6]).toBe(0x7c);
  });
});

describe('what the qualified A310 core was measured doing', () => {
  const magnitude = (byte: number, part: 'vidc1' | 'vidc2') => Math.abs(decodeVidcSample(byte, part));
  const predicted = (byte: number, part: 'vidc1' | 'vidc2') => magnitude(byte, part) / magnitude(0xff, part);

  it('matches the VIDC2 order on every byte measured', () => {
    /* Within half a percent on all seven, which a decoder that had the bit
     * order wrong could not be. */
    for (const { byte, ratio } of A310_MEASURED_LEVELS) {
      const expected = predicted(byte, 'vidc2');
      expect(Math.abs(ratio - expected), `&${byte.toString(16).toUpperCase()}`).toBeLessThan(Math.max(0.00005, expected * 0.005));
    }
  });

  it('is not the VIDC1 order, which is the inference this replaced', () => {
    /* Stated as its own assertion rather than left implied: agreeing with one
     * hypothesis only means something if the other is ruled out. &7F is full
     * scale under VIDC1 and a seventeenth of it here; &80 is silent under
     * VIDC1 and was not silent. */
    const wrong = A310_MEASURED_LEVELS.filter(({ byte, ratio }) => {
      const expected = predicted(byte, 'vidc1');
      /* Relative, with a floor small enough to still separate the quietest
       * byte measured: an absolute floor of a percent would call a level three
       * times too high a match. */
      return Math.abs(ratio - expected) > Math.max(0.0005, expected * 0.05);
    });
    expect(wrong.map(({ byte }) => byte)).toEqual([0xbf, 0x80, 0x7f, 0x71, 0x3f, 0x1f]);
    expect(predicted(0x7f, 'vidc1')).toBe(1);
    expect(predicted(0x80, 'vidc1')).toBe(0);
  });

  it('carries the measurement in order of level, with &FF as the reference', () => {
    expect(A310_MEASURED_LEVELS[0]).toEqual({ byte: 0xff, ratio: 1 });
    const ratios = A310_MEASURED_LEVELS.map((entry) => entry.ratio);
    expect([...ratios].sort((left, right) => right - left)).toEqual(ratios);
  });
});
