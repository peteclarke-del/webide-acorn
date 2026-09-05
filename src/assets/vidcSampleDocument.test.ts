import { describe, expect, it } from 'vitest';
import {
  closestPeriodForRate, createVidcSampleDocument, DMA_BLOCK_BYTES, encodePcmFrames,
  generateVidcSampleOutput, MEMC_BASE, MEMC_SOUND_DMA_LIMIT, MEMC_SOUND_END, MEMC_SOUND_POINTER,
  MEMC_SOUND_START, memcSoundAddress, parseVidcSampleDocument, pcmFrames, readWavPcm16,
  resampleForDocument, serializeVidcSampleDocument, setChannelMode, setStereoImage, synthesiseTone,
  trimSample, VIDC_BASE, VIDC_SFR_ADDRESS, vidcWriteWord,
} from './vidcSampleDocument';
import { decodeVidcSample, soundFrequencyRegister } from './vidcSample';

const sample = (values: number[]) => createVidcSampleDocument('tone', 'archimedes-a300', Int16Array.from(values));

/* The pinned core's own extraction, written out here so the generated words are
 * checked against the arithmetic the emulator actually applies to them rather
 * than against a second copy of this module's intent.
 *   vidc.c   writevidc dispatches on v >> 24
 *   memc.c   writememc switches on (a >> 17) & 7
 *   memc.c   #define getdmaaddr(addr) (((addr>>2)&0x7FFF)<<2), used as <<2 again
 */
const coreVidcRegister = (word: number) => (word >>> 24) & 0xff;
const coreVidcData = (word: number) => word & 0x00ffffff;
const coreMemcRegister = (address: number) => (address >>> 17) & 7;
const coreMemcAddress = (address: number) => ((((address >>> 2) & 0x7fff) << 2) << 2) >>> 0;

describe('a sample document', () => {
  it('round-trips through serialization unchanged', () => {
    const document = sample([0, 1000, -1000, 32767]);
    expect(parseVidcSampleDocument(serializeVidcSampleDocument(document))).toEqual(document);
    expect(Array.from(pcmFrames(document))).toEqual([0, 1000, -1000, 32767]);
  });

  it('refuses a machine whose byte order has not been established', () => {
    /* The refusal that stops a sample being encoded for a guess. */
    expect(() => parseVidcSampleDocument({ ...sample([0]), machineId: 'archimedes-a5000' }))
      .toThrow(/No VIDC byte order has been established for archimedes-a5000/);
  });

  it('refuses the stereo image the datasheet declines to define', () => {
    expect(() => setStereoImage(sample([0]), 0, 0)).toThrow(/does not define this value/);
    expect(setStereoImage(sample([0]), 0, 7).stereoImages).toEqual([7]);
  });

  it('holds a buffer to what sound DMA can address', () => {
    expect(() => parseVidcSampleDocument({ ...sample([0]), bufferAddress: 0x10008 }))
      .toThrow(/starts on a multiple of 16/);
    expect(() => parseVidcSampleDocument({ ...sample([0]), bufferAddress: MEMC_SOUND_DMA_LIMIT }))
      .toThrow(/reaches the first 524288 bytes of physical memory/);
  });

  it('refuses sample data that is not whole frames of the channel count', () => {
    const stereo = setChannelMode(sample([1, 2, 3, 4]), 2);
    expect(() => parseVidcSampleDocument({ ...stereo, pcmBase64: encodePcmFrames([1, 2, 3]) }))
      .toThrow(/comes in complete frames, and 3 samples is not/);
  });

  it('keeps the sample bytes when the channel count changes rather than reinterpreting them', () => {
    /* The same bytes mean different things at different channel counts, and
     * rewriting somebody's sample to preserve the sound would be a change they
     * did not ask for. */
    const mono = sample([10, 20, 30, 40]);
    const stereo = setChannelMode(mono, 2);
    expect(Array.from(pcmFrames(stereo))).toEqual([10, 20, 30, 40]);
    expect(stereo.stereoImages).toEqual([4, 4]);
  });

  it('trims to a frame range and refuses one that is not inside the sample', () => {
    const document = sample([1, 2, 3, 4, 5, 6]);
    expect(Array.from(pcmFrames(trimSample(document, 2, 5)))).toEqual([3, 4, 5]);
    expect(() => trimSample(document, 4, 4)).toThrow(/to a later one within the 6 this sample has/);
    expect(() => trimSample(document, 0, 7)).toThrow(/within the 6 this sample has/);
  });
});

describe('generating a tone', () => {
  it('generates at the rate the document is played at, not a rate of its own', () => {
    const document = synthesiseTone(sample([0]), { hertz: 1000, milliseconds: 10 });
    /* 62 µs per byte on one channel is 16,129 Hz, so ten milliseconds is 161
     * frames. A tone generated at any other rate would be at the wrong pitch. */
    expect(pcmFrames(document).length).toBe(161);
  });

  it('refuses a tone the sample rate cannot carry', () => {
    expect(() => synthesiseTone(sample([0]), { hertz: 12000, milliseconds: 10 }))
      .toThrow(/between 0 and 8065 Hz, which is half its 16129 Hz channel rate/);
  });

  it('fills every channel of a multi-channel document', () => {
    const stereo = setChannelMode(sample([0, 0]), 2);
    const toned = synthesiseTone(stereo, { hertz: 400, milliseconds: 5, waveform: 'square' });
    const frames = pcmFrames(toned);
    expect(frames.length % 2).toBe(0);
    for (let index = 0; index < frames.length; index += 2) expect(frames[index]).toBe(frames[index + 1]);
    expect(new Set(Array.from(frames)).size).toBe(2);
  });
});

describe('the words the generated player writes', () => {
  it('puts a VIDC register where the core reads it from', () => {
    const word = vidcWriteWord(VIDC_SFR_ADDRESS, soundFrequencyRegister(62));
    expect(coreVidcRegister(word)).toBe(VIDC_SFR_ADDRESS);
    expect(coreVidcData(word)).toBe(soundFrequencyRegister(62));
  });

  it('puts a MEMC register and address where the core reads them from', () => {
    for (const register of [MEMC_SOUND_START, MEMC_SOUND_END, MEMC_SOUND_POINTER]) {
      const address = memcSoundAddress(register, 0x10000);
      expect(coreMemcRegister(address)).toBe(register);
      expect(coreMemcAddress(address)).toBe(0x10000);
      /* Within MEMC's own address space, or the write reaches something else
       * entirely. */
      expect(address >>> 20).toBe(MEMC_BASE >>> 20);
    }
  });

  it('refuses an address sound DMA cannot express rather than truncating it', () => {
    expect(() => memcSoundAddress(MEMC_SOUND_START, 0x10008)).toThrow(/multiple of 16 below 524288/);
    expect(() => memcSoundAddress(MEMC_SOUND_START, MEMC_SOUND_DMA_LIMIT)).toThrow(/below 524288/);
    expect(() => memcSoundAddress(7, 0x10000)).toThrow(/sound DMA registers are 4 to 6/);
  });
});

describe('generated output', () => {
  it('pads the buffer to whole DMA blocks with silence and says how much it added', () => {
    /* DMA moves sixteen bytes at a time, so a buffer that is not a whole
     * number of them would play whatever follows it. */
    const output = generateVidcSampleOutput(sample(Array.from({ length: 20 }, () => 0)));
    expect(output.bytes.length).toBe(32);
    expect(output.manifest.paddingBytes).toBe(12);
    expect(new Set(Array.from(output.bytes.subarray(20)))).toEqual(new Set([output.bytes[0]]));
    expect(decodeVidcSample(output.bytes[31]!, 'vidc2')).toBe(0);
  });

  it('sets the end register to the last block rather than past the buffer', () => {
    /* pollsound wraps when spos equals ssend, so an end one block too far
     * plays sixteen bytes of whatever comes next on every loop. */
    const document = parseVidcSampleDocument({ ...sample(Array.from({ length: 64 }, () => 0)), bufferAddress: 0x20000 });
    const output = generateVidcSampleOutput(document);
    expect(output.manifest.byteLength).toBe(64);
    expect(output.manifest.bufferEndAddress).toBe(0x20000 + 64 - DMA_BLOCK_BYTES);
  });

  it('programs every stereo register the channel count requires', () => {
    /* Section 6.10: in four-channel mode registers 4 to 7 repeat 0 to 3, and in
     * one-channel mode all eight hold the same value. */
    const mono = generateVidcSampleOutput(sample([0, 0])).manifest.stereoRegisters;
    expect(mono).toEqual([{ channel: 0, image: 4, registers: [0, 1, 2, 3, 4, 5, 6, 7] }]);

    const quad = generateVidcSampleOutput(setChannelMode(sample([0, 0, 0, 0]), 4)).manifest.stereoRegisters;
    expect(quad.map((entry) => entry.registers)).toEqual([[0, 4], [1, 5], [2, 6], [3, 7]]);
  });

  it('carries the reason for the byte order into what a reader sees', () => {
    /* The choice between two disagreeing sources has to reach whoever reads the
     * generated source, or it looks like an ordinary encoding decision. */
    const output = generateVidcSampleOutput(sample([0, 0]));
    expect(output.manifest.part).toBe('vidc2');
    expect(output.assembly).toContain('Measured on the qualified A310 core');
    expect(output.manifest.partReason).toMatch(/rather than the part it is descended from/);
  });

  it('says what the player assumes instead of quietly assuming it', () => {
    const output = generateVidcSampleOutput(sample([0, 0]));
    expect(output.manifest.assumptions.join(' ')).toMatch(/Sound DMA is already enabled/);
    expect(output.manifest.assumptions.join(' ')).toMatch(/buffer address is physical/);
    expect(output.manifest.assumptions.join(' ')).toMatch(/supervisor mode/);
    for (const assumption of output.manifest.assumptions) expect(output.assembly).toContain(assumption);
  });

  it('reports clipping and companding error rather than hiding either', () => {
    const loud = generateVidcSampleOutput(sample([32767, -32768, 0, 100]));
    expect(loud.manifest.worstError).toBeGreaterThan(0);
    expect(loud.manifest.clippedSamples).toBe(0);
    expect(loud.manifest.frames).toBe(4);
    expect(loud.manifest.channelRateHz).toBeCloseTo(1_000_000 / 62, 6);
  });

  it('is byte-for-byte the same for the same document', () => {
    const document = synthesiseTone(sample([0]), { hertz: 440, milliseconds: 25 });
    const first = generateVidcSampleOutput(document);
    const second = generateVidcSampleOutput(parseVidcSampleDocument(serializeVidcSampleDocument(document)));
    expect(Array.from(second.bytes)).toEqual(Array.from(first.bytes));
    expect(second.manifest.sha256).toBe(first.manifest.sha256);
    expect(second.assembly).toBe(first.assembly);
  });

  it('emits the sample as whole DMA blocks a person can count', () => {
    const output = generateVidcSampleOutput(sample(Array.from({ length: 32 }, (_, index) => index * 100)));
    const rows = output.assembly.split('\n').filter((line) => line.trim().startsWith('DCB '));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/; \+0000$/);
    expect(rows[1]).toMatch(/; \+0010$/);
    expect(output.assembly).toContain(`LDR R1, =&${VIDC_BASE.toString(16).toUpperCase().padStart(8, '0')}`);
  });
});

describe('reading a WAVE file', () => {
  function wav({ audioFormat = 1, channels = 1, rate = 8000, bits = 16, data = new Uint8Array([0, 0]) }): Uint8Array {
    const bytes = new Uint8Array(44 + data.length);
    const view = new DataView(bytes.buffer);
    const ascii = (offset: number, text: string) => { for (let index = 0; index < text.length; index += 1) bytes[offset + index] = text.charCodeAt(index); };
    ascii(0, 'RIFF'); view.setUint32(4, 36 + data.length, true); ascii(8, 'WAVE');
    ascii(12, 'fmt '); view.setUint32(16, 16, true);
    view.setUint16(20, audioFormat, true); view.setUint16(22, channels, true);
    view.setUint32(24, rate, true); view.setUint32(28, (rate * channels * bits) / 8, true);
    view.setUint16(32, (channels * bits) / 8, true); view.setUint16(34, bits, true);
    ascii(36, 'data'); view.setUint32(40, data.length, true);
    bytes.set(data, 44);
    return bytes;
  }

  it('reads sixteen-bit samples with their sign', () => {
    const data = new Uint8Array([0x00, 0x00, 0xff, 0x7f, 0x00, 0x80]);
    expect(Array.from(readWavPcm16(wav({ data })).samples)).toEqual([0, 32767, -32768]);
  });

  it('reads eight-bit samples, which are unsigned with 128 as silence', () => {
    const read = readWavPcm16(wav({ bits: 8, data: new Uint8Array([128, 255, 0]) }));
    expect(Array.from(read.samples)).toEqual([0, 32512, -32768]);
  });

  it('refuses what it cannot read, saying what the file is', () => {
    /* A reader that guessed at a compressed file would produce noise, and noise
     * is what nobody can tell from a bug in the encoder. */
    expect(() => readWavPcm16(wav({ audioFormat: 3 }))).toThrow(/that file is floating point/);
    expect(() => readWavPcm16(wav({ audioFormat: 0xfffe }))).toThrow(/WAVE_FORMAT_EXTENSIBLE/);
    expect(() => readWavPcm16(wav({ bits: 24, data: new Uint8Array(3) }))).toThrow(/reads 8- and 16-bit PCM, and that file is 24-bit/);
    expect(() => readWavPcm16(new Uint8Array(8))).toThrow(/does not begin with RIFF and WAVE/);
    expect(() => readWavPcm16(wav({ data: new Uint8Array(0) }))).toThrow(/holds no samples/);
  });

  it('refuses a truncated file rather than reading past its end', () => {
    const truncated = wav({ data: new Uint8Array([1, 2, 3, 4]) }).subarray(0, 46);
    expect(() => readWavPcm16(truncated)).toThrow(/so the file is truncated/);
  });

  it('resamples to the rate the document plays at', () => {
    const document = sample([0]);
    /* 8,000 Hz into a document playing at 16,129 Hz is 2.016 times as many
     * frames, not twice as many, and the extra repeat lands where the ratio
     * puts it rather than being spread evenly. That is what nearest neighbour
     * does, and the point of asserting the exact frames is that the coarseness
     * is visible here rather than only audible on the machine. */
    const resampled = resampleForDocument(document, { samples: Int16Array.from([100, 200, 300, 400]), channels: 1, sampleRateHz: 8000 });
    expect(resampled.length).toBe(8);
    expect(Array.from(resampled)).toEqual([100, 100, 100, 200, 200, 300, 300, 400]);
  });

  it('picks the period whose rate is closest to what a file was recorded at', () => {
    expect(closestPeriodForRate(20833, 1)).toBe(48);
    expect(closestPeriodForRate(20833, 2)).toBe(24);
    /* Rounded to whole microseconds, so an exact match is not always available
     * and the closest is chosen rather than the file's rate being claimed. */
    expect(1_000_000 / closestPeriodForRate(44100, 1)).toBeCloseTo(43478.26, 2);
  });
});
