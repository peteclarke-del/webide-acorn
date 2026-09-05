/* Versioned, editable sample documents for the Archimedes' VIDC sound system.
 *
 * The encoder in `vidcSample.ts` settles what a byte means. This settles what a
 * person edits and what comes out of it: a sample, the rate and stereo
 * placement it is played at, the buffer it is played from, and generated ARM
 * source that programs the hardware to play it.
 *
 * Three things here are established from the pinned core's own decoding rather
 * than from recollection, because getting any of them wrong produces silence or
 * noise with nothing to say why:
 *
 *   - VIDC is written by storing a word anywhere in its address space with the
 *     register in bits 31 to 24 of the data — `writevidc` in `src/vidc.c`
 *     dispatches on `v >> 24`, and `src/mem.c` routes &03400000 to &035FFFFF
 *     to it, in supervisor mode only.
 *   - MEMC takes its register from address bits 17 to 19 and its DMA address
 *     from bits 2 to 16 — `writememc` in `src/memc.c` switches on `(a >> 17) &
 *     7` and its `getdmaaddr` masks fifteen bits, so sound DMA can only reach
 *     the first 512 KiB of physical memory and only in units of sixteen bytes.
 *   - Sound DMA fetches sixteen bytes at a time and wraps when the pointer
 *     equals the end register, so the end register holds the address of the
 *     last block and not the address after the buffer. `pollsound` in
 *     `src/sound.c` advances `spos += 16` and compares `spos == ssend`.
 *
 * What is deliberately not generated is a RISC OS sound-system call. This build
 * has no authoritative source for those SWIs, and a player written from memory
 * would be the fabrication this product refuses. The generated source programs
 * the hardware directly and says in as many words what it assumes.
 */
import { sha256Hex } from '../build/digest';
import { decodeBase64, encodeBase64 } from './screenDocument';
import {
  channelSampleRateHz, encodePcm16, encodeVidcLevel, SFR_MAX_PERIOD_US, SFR_MIN_PERIOD_US,
  soundFrequencyRegister, stereoRegistersForChannel, STEREO_IMAGE_REGISTER_ADDRESSES,
  STEREO_IMAGE_VALUES, VidcSampleError, vidcPartForMachine,
  type VidcChannelMode, type VidcPart,
} from './vidcSample';

export const VIDC_SAMPLE_SCHEMA = '8bit-net.vidc-sample' as const;

/** Sound DMA moves sixteen bytes at a time, so a buffer is measured in them. */
export const DMA_BLOCK_BYTES = 16;

/**
 * The furthest sound DMA can reach.
 *
 * `getdmaaddr` keeps fifteen bits of a sixteen-byte unit, so the addressable
 * region is the first 512 KiB of physical memory and nothing beyond it can be
 * played however the machine is configured.
 */
export const MEMC_SOUND_DMA_LIMIT = 0x8000 * DMA_BLOCK_BYTES;

/** A working limit on document size, well inside what DMA can address. */
export const MAX_SAMPLE_BYTES = 0x40000;

export const VIDC_BASE = 0x03400000;
export const MEMC_BASE = 0x03600000;
/** MEMC register numbers, from the switch in `writememc`. */
export const MEMC_SOUND_START = 4;
export const MEMC_SOUND_END = 5;
export const MEMC_SOUND_POINTER = 6;
/** The Sound Frequency Register's address in VIDC's register map. */
export const VIDC_SFR_ADDRESS = 0xc0;

export const CHANNEL_MODES: readonly VidcChannelMode[] = Object.freeze([1, 2, 4, 8]);

export interface VidcSampleDocument {
  schema: typeof VIDC_SAMPLE_SCHEMA;
  version: 1;
  name: string;
  /** The machine the sample is encoded for. It fixes the byte order. */
  machineId: string;
  /** The Sound Frequency Register's period, in whole microseconds. */
  periodMicroseconds: number;
  channelMode: VidcChannelMode;
  /** One stereo image value per channel, in the order the channels interleave. */
  stereoImages: number[];
  /** The physical address the buffer is programmed at. */
  bufferAddress: number;
  /** Signed 16-bit PCM, little-endian, interleaved by channel. */
  pcmBase64: string;
}

export class VidcSampleDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VidcSampleDocumentError';
  }
}

/* ---- reading and writing ------------------------------------------------- */

function assertStereoImage(value: number, channel: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 7) {
    throw new VidcSampleDocumentError(`A stereo image is a value from 0 to 7; channel ${channel} has ${value}.`);
  }
  if (value === 0) {
    /* The datasheet calls 0 Undefined rather than centre. Writing it would
     * produce whatever the part happens to do, which is not something a
     * document gets to mean. */
    throw new VidcSampleDocumentError(`Stereo image 0 is ${STEREO_IMAGE_VALUES[0]!.detail.toLowerCase().replace(/\.$/, '')}, so channel ${channel} cannot be placed there. Choose 1 to 7.`);
  }
}

export function pcmFrames(document: Pick<VidcSampleDocument, 'pcmBase64'>): Int16Array {
  const bytes = decodeBase64(document.pcmBase64);
  if (bytes.length % 2 !== 0) {
    throw new VidcSampleDocumentError('Sixteen-bit sample data has an odd number of bytes, so it is not sixteen-bit sample data.');
  }
  const samples = new Int16Array(bytes.length / 2);
  for (let index = 0; index < samples.length; index += 1) {
    const low = bytes[index * 2]!;
    const high = bytes[index * 2 + 1]!;
    const value = low | (high << 8);
    samples[index] = value >= 0x8000 ? value - 0x10000 : value;
  }
  return samples;
}

export function encodePcmFrames(samples: Int16Array | readonly number[]): string {
  const bytes = new Uint8Array(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index]! & 0xffff;
    bytes[index * 2] = value & 0xff;
    bytes[index * 2 + 1] = (value >>> 8) & 0xff;
  }
  return encodeBase64(bytes);
}

export function createVidcSampleDocument(
  name = 'untitled-sample',
  machineId = 'archimedes-a300',
  samples: Int16Array | readonly number[] = new Int16Array(DMA_BLOCK_BYTES),
): VidcSampleDocument {
  return parseVidcSampleDocument({
    schema: VIDC_SAMPLE_SCHEMA,
    version: 1,
    name,
    machineId,
    /* 62 microseconds is a byte rate near 16 kHz, which is a rate a sample of
     * any length fits in the DMA region at. */
    periodMicroseconds: 62,
    channelMode: 1,
    stereoImages: [4],
    /* Not zero: the first pages of physical memory are the machine's, and a
     * document that defaulted a buffer on top of them would look plausible and
     * be wrong. This is a stated placeholder inside the DMA region. */
    bufferAddress: 0x10000,
    pcmBase64: encodePcmFrames(samples),
  });
}

export function parseVidcSampleDocument(value: string | unknown): VidcSampleDocument {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object') throw new VidcSampleDocumentError('A sample document must be an object.');
  const candidate = parsed as Record<string, unknown>;
  if (candidate.schema !== VIDC_SAMPLE_SCHEMA) {
    throw new VidcSampleDocumentError(`A sample document must declare schema ${VIDC_SAMPLE_SCHEMA}; this one declares ${String(candidate.schema)}.`);
  }
  if (candidate.version !== 1) {
    throw new VidcSampleDocumentError(`This build reads version 1 sample documents; this one is version ${String(candidate.version)}.`);
  }
  if (typeof candidate.name !== 'string' || !candidate.name.trim() || candidate.name.length > 80) {
    throw new VidcSampleDocumentError('A sample name must contain 1 to 80 characters.');
  }
  if (typeof candidate.machineId !== 'string') throw new VidcSampleDocumentError('A sample document must name the machine it is encoded for.');
  /* Throws by name when the machine has no established byte order, which is the
   * refusal that keeps a sample from being encoded for a guess. */
  vidcPartForMachine(candidate.machineId);

  const period = candidate.periodMicroseconds;
  if (typeof period !== 'number' || !Number.isInteger(period) || period < SFR_MIN_PERIOD_US || period > SFR_MAX_PERIOD_US) {
    throw new VidcSampleDocumentError(`A sample period is a whole number of microseconds from ${SFR_MIN_PERIOD_US} to ${SFR_MAX_PERIOD_US}; ${String(period)} is not.`);
  }
  const channelMode = candidate.channelMode;
  if (typeof channelMode !== 'number' || !CHANNEL_MODES.includes(channelMode as VidcChannelMode)) {
    throw new VidcSampleDocumentError(`VIDC has 1, 2, 4 or 8 channel modes; ${String(channelMode)} is not one of them.`);
  }
  const mode = channelMode as VidcChannelMode;

  const images = candidate.stereoImages;
  if (!Array.isArray(images) || images.length !== mode) {
    throw new VidcSampleDocumentError(`${mode}-channel mode needs ${mode} stereo images; this document has ${Array.isArray(images) ? images.length : 'none'}.`);
  }
  images.forEach((image, channel) => assertStereoImage(image as number, channel));

  const address = candidate.bufferAddress;
  if (typeof address !== 'number' || !Number.isInteger(address) || address < 0) {
    throw new VidcSampleDocumentError('A buffer address must be a whole number of bytes.');
  }
  if (address % DMA_BLOCK_BYTES !== 0) {
    throw new VidcSampleDocumentError(`Sound DMA addresses sixteen bytes at a time, so a buffer starts on a multiple of ${DMA_BLOCK_BYTES}; &${address.toString(16).toUpperCase()} does not.`);
  }
  if (typeof candidate.pcmBase64 !== 'string') throw new VidcSampleDocumentError('Sample data must be a base64 string.');
  let samples: Int16Array;
  try {
    samples = pcmFrames({ pcmBase64: candidate.pcmBase64 });
  } catch (error) {
    if (error instanceof VidcSampleDocumentError) throw error;
    throw new VidcSampleDocumentError('Sample data is not valid base64.');
  }
  if (samples.length === 0) throw new VidcSampleDocumentError('A sample document holds no sample.');
  if (samples.length % mode !== 0) {
    throw new VidcSampleDocumentError(`${mode}-channel sample data comes in complete frames, and ${samples.length} samples is not a whole number of them.`);
  }
  if (samples.length > MAX_SAMPLE_BYTES) {
    throw new VidcSampleDocumentError(`A sample is limited to ${MAX_SAMPLE_BYTES} bytes once encoded; this one is ${samples.length}.`);
  }
  const encodedLength = paddedLength(samples.length);
  if (address + encodedLength > MEMC_SOUND_DMA_LIMIT) {
    throw new VidcSampleDocumentError(
      `Sound DMA reaches the first ${MEMC_SOUND_DMA_LIMIT} bytes of physical memory, and a ${encodedLength}-byte buffer at &${address.toString(16).toUpperCase()} ends past it.`,
    );
  }

  return {
    schema: VIDC_SAMPLE_SCHEMA,
    version: 1,
    name: candidate.name,
    machineId: candidate.machineId,
    periodMicroseconds: period,
    channelMode: mode,
    stereoImages: images.map((image) => image as number),
    bufferAddress: address,
    pcmBase64: encodePcmFrames(samples),
  };
}

export function serializeVidcSampleDocument(document: VidcSampleDocument): string {
  return `${JSON.stringify(parseVidcSampleDocument(document), null, 2)}\n`;
}

/** How long the encoded buffer is once rounded up to whole DMA blocks. */
export function paddedLength(byteCount: number): number {
  return Math.ceil(Math.max(byteCount, 1) / DMA_BLOCK_BYTES) * DMA_BLOCK_BYTES;
}

/* ---- editing ------------------------------------------------------------- */

/**
 * Change the channel count, keeping the placements that still have a channel.
 *
 * Sample data is not reinterpreted. The same bytes mean different things at
 * different channel counts — byte n belongs to channel n modulo the count —
 * and silently rewriting somebody's sample to preserve what it sounded like
 * would be a change they did not ask for.
 */
export function setChannelMode(document: VidcSampleDocument, channelMode: VidcChannelMode): VidcSampleDocument {
  const kept = Array.from({ length: channelMode }, (_, channel) => document.stereoImages[channel] ?? 4);
  const samples = pcmFrames(document);
  const frames = Math.floor(samples.length / channelMode) * channelMode;
  return parseVidcSampleDocument({
    ...document,
    channelMode,
    stereoImages: kept,
    pcmBase64: encodePcmFrames(samples.subarray(0, Math.max(frames, channelMode))),
  });
}

export function setStereoImage(document: VidcSampleDocument, channel: number, image: number): VidcSampleDocument {
  if (!Number.isInteger(channel) || channel < 0 || channel >= document.channelMode) {
    throw new VidcSampleDocumentError(`In ${document.channelMode}-channel mode the channels are 0 to ${document.channelMode - 1}; ${channel} is not one of them.`);
  }
  const stereoImages = [...document.stereoImages];
  stereoImages[channel] = image;
  return parseVidcSampleDocument({ ...document, stereoImages });
}

export function setSamplePcm(document: VidcSampleDocument, samples: Int16Array | readonly number[]): VidcSampleDocument {
  return parseVidcSampleDocument({ ...document, pcmBase64: encodePcmFrames(samples) });
}

/** Keep the samples between two frame indices, the second exclusive. */
export function trimSample(document: VidcSampleDocument, fromFrame: number, toFrame: number): VidcSampleDocument {
  const samples = pcmFrames(document);
  const frames = samples.length / document.channelMode;
  if (!Number.isInteger(fromFrame) || !Number.isInteger(toFrame) || fromFrame < 0 || toFrame > frames || fromFrame >= toFrame) {
    throw new VidcSampleDocumentError(`A trim runs from one frame to a later one within the ${frames} this sample has; ${fromFrame} to ${toFrame} does not.`);
  }
  return setSamplePcm(document, samples.subarray(fromFrame * document.channelMode, toFrame * document.channelMode));
}

export type Waveform = 'sine' | 'square' | 'sawtooth' | 'triangle';

/**
 * A sample to start from, so the workflow can be exercised without a file.
 *
 * The rate is taken from the document rather than given, because a tone
 * generated at a rate the document is not played at is a tone at the wrong
 * pitch, and that is a mistake nobody would see until they heard it.
 */
export function synthesiseTone(
  document: VidcSampleDocument,
  { hertz, milliseconds, waveform = 'sine', amplitude = 0.8 }: { hertz: number; milliseconds: number; waveform?: Waveform; amplitude?: number },
): VidcSampleDocument {
  const rate = channelSampleRateHz(document.periodMicroseconds, document.channelMode);
  if (!Number.isFinite(hertz) || hertz <= 0 || hertz > rate / 2) {
    throw new VidcSampleDocumentError(`A tone this sample can carry is between 0 and ${(rate / 2).toFixed(0)} Hz, which is half its ${rate.toFixed(0)} Hz channel rate; ${hertz} is not.`);
  }
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) throw new VidcSampleDocumentError('A tone must have a positive length.');
  if (!Number.isFinite(amplitude) || amplitude <= 0 || amplitude > 1) throw new VidcSampleDocumentError('A tone amplitude runs above 0 and up to 1.');

  const frames = Math.max(1, Math.round((milliseconds / 1000) * rate));
  const samples = new Int16Array(frames * document.channelMode);
  for (let frame = 0; frame < frames; frame += 1) {
    const phase = (frame * hertz) / rate;
    const cycle = phase - Math.floor(phase);
    const value = waveform === 'sine' ? Math.sin(cycle * 2 * Math.PI)
      : waveform === 'square' ? (cycle < 0.5 ? 1 : -1)
      : waveform === 'sawtooth' ? cycle * 2 - 1
      : cycle < 0.5 ? cycle * 4 - 1 : 3 - cycle * 4;
    const scaled = Math.max(-32768, Math.min(32767, Math.round(value * amplitude * 32767)));
    for (let channel = 0; channel < document.channelMode; channel += 1) {
      samples[frame * document.channelMode + channel] = scaled;
    }
  }
  return setSamplePcm(document, samples);
}

/* ---- generation ---------------------------------------------------------- */

export interface VidcSampleOutput {
  /** The companded bytes, padded to whole DMA blocks. */
  bytes: Uint8Array;
  assembly: string;
  manifest: {
    schema: '8bit-net.generated-vidc-sample';
    version: 1;
    sourceSchema: typeof VIDC_SAMPLE_SCHEMA;
    sourceVersion: 1;
    name: string;
    machineId: string;
    part: VidcPart;
    partReason: string;
    channelMode: VidcChannelMode;
    periodMicroseconds: number;
    byteRateHz: number;
    channelRateHz: number;
    frames: number;
    byteLength: number;
    /** Bytes of silence added to reach a whole number of DMA blocks. */
    paddingBytes: number;
    bufferAddress: number;
    bufferEndAddress: number;
    /** Samples the encoder had to clip because they exceeded full scale. */
    clippedSamples: number;
    /** The worst companding error, as a fraction of full scale. */
    worstError: number;
    stereoRegisters: Array<{ channel: number; image: number; registers: number[] }>;
    soundFrequencyRegister: number;
    /** What the generated player assumes rather than does, said plainly. */
    assumptions: string[];
    sha256: string;
  };
}

export function sampleLabel(name: string): string {
  return `sample_${name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z_]/, '_$&')}`;
}

function word(value: number): string {
  return `&${(value >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

function byte(value: number): string {
  return `&${value.toString(16).toUpperCase().padStart(2, '0')}`;
}

/** The word written to VIDC to set one register. */
export function vidcWriteWord(register: number, value: number): number {
  if (!Number.isInteger(register) || register < 0 || register > 0xff) {
    throw new VidcSampleError(`A VIDC register address is one byte; ${register} is not.`);
  }
  return ((register << 24) >>> 0) | (value & 0x00ffffff);
}

/** The MEMC address written to set one sound DMA register to a buffer address. */
export function memcSoundAddress(register: number, address: number): number {
  if (register < MEMC_SOUND_START || register > MEMC_SOUND_POINTER) {
    throw new VidcSampleError(`The sound DMA registers are ${MEMC_SOUND_START} to ${MEMC_SOUND_POINTER}; ${register} is not one of them.`);
  }
  if (address % DMA_BLOCK_BYTES !== 0 || address < 0 || address >= MEMC_SOUND_DMA_LIMIT) {
    throw new VidcSampleError(`A sound DMA address is a multiple of ${DMA_BLOCK_BYTES} below ${MEMC_SOUND_DMA_LIMIT}; ${address} is not.`);
  }
  /* getdmaaddr keeps address bits 2 to 16 and the value it yields counts
   * sixteen-byte units, so the address goes in shifted down four and up two. */
  return (MEMC_BASE | (register << 17) | (((address / DMA_BLOCK_BYTES) & 0x7fff) << 2)) >>> 0;
}

export function generateVidcSampleOutput(document: VidcSampleDocument): VidcSampleOutput {
  const validated = parseVidcSampleDocument(document);
  const choice = vidcPartForMachine(validated.machineId);
  const samples = pcmFrames(validated);
  const encoded = encodePcm16(samples, choice.part);

  /* DMA moves whole sixteen-byte blocks, so a buffer that is not a whole
   * number of them would play whatever follows it. The padding is silence and
   * the manifest says how much of it there is. */
  const silence = encodeVidcLevel(0, choice.part).byte;
  const length = paddedLength(encoded.bytes.length);
  const bytes = new Uint8Array(length).fill(silence);
  bytes.set(encoded.bytes, 0);

  const label = sampleLabel(validated.name);
  const sfr = soundFrequencyRegister(validated.periodMicroseconds);
  const endAddress = validated.bufferAddress + length - DMA_BLOCK_BYTES;
  const byteRate = 1_000_000 / validated.periodMicroseconds;
  const channelRate = channelSampleRateHz(validated.periodMicroseconds, validated.channelMode);
  const stereoRegisters = validated.stereoImages.map((image, channel) => ({
    channel,
    image,
    registers: stereoRegistersForChannel(channel, validated.channelMode),
  }));

  const assumptions = [
    'Sound DMA is already enabled. MEMC control is write-only and its other fields — page size and operating-system mode — cannot be read back, so a generated player that set the sound DMA bit would have to guess at the rest and would break the machine if it guessed wrong. RISC OS leaves sound DMA running, which is the case this was built and measured against.',
    'The buffer address is physical. MEMC sound DMA addresses physical memory, and an address obtained from RISC OS is logical; translating one to the other is the caller’s to do and this generator does not pretend to.',
    'VIDC and MEMC are written in supervisor mode. The pinned core takes a data abort on a write from user mode.',
  ];

  const stereoLines = stereoRegisters.flatMap(({ channel, image, registers }) => [
    `  ; channel ${channel} at stereo image ${image} · ${STEREO_IMAGE_VALUES[image]!.label}`,
    ...registers.map((register) => [
      `  LDR R0, =${word(vidcWriteWord(STEREO_IMAGE_REGISTER_ADDRESSES[register]!, image))}`,
      '  STR R0, [R1]',
    ].join('\n')),
  ]);

  const rows: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += DMA_BLOCK_BYTES) {
    const block = Array.from(bytes.subarray(offset, offset + DMA_BLOCK_BYTES), byte).join(', ');
    rows.push(`  DCB ${block} ; +${offset.toString(16).toUpperCase().padStart(4, '0')}`);
  }

  const assembly = [
    `; Generated VIDC sample ${validated.name} · ${samples.length / validated.channelMode} frames on ${validated.channelMode} channel${validated.channelMode === 1 ? '' : 's'}`,
    `; Encoded in the ${choice.part.toUpperCase()} byte order. ${choice.reason}`,
    `; ${length} bytes at ${byteRate.toFixed(0)} bytes per second · ${channelRate.toFixed(0)} Hz per channel`,
    `; Worst companding error ${(encoded.worstError * 100).toFixed(2)}% of full scale · ${encoded.clipped} sample${encoded.clipped === 1 ? '' : 's'} clipped`,
    `; SHA-256 ${sha256Hex(bytes)}`,
    ';',
    '; This player assumes:',
    ...assumptions.map((assumption) => `;   • ${assumption}`),
    '',
    `.${label}_play`,
    `  LDR R1, =${word(VIDC_BASE)} ; VIDC takes its register from bits 31-24 of the data`,
    '',
    `  ; Sound Frequency Register: period ${validated.periodMicroseconds} µs written as (N-1) with the test bit set`,
    `  LDR R0, =${word(vidcWriteWord(VIDC_SFR_ADDRESS, sfr))}`,
    '  STR R0, [R1]',
    '',
    ...stereoLines,
    '',
    '  ; MEMC takes its register from address bits 17-19 and its address from bits 2-16,',
    '  ; so a MEMC write carries everything in the address and nothing in the data.',
    '  ; The value stored is immaterial and R0 is stored to itself for that reason.',
    '  ; The end register holds the last block, not the byte after the buffer.',
    `  LDR R0, =${word(memcSoundAddress(MEMC_SOUND_START, validated.bufferAddress))} ; start &${validated.bufferAddress.toString(16).toUpperCase()}`,
    '  STR R0, [R0]',
    `  LDR R0, =${word(memcSoundAddress(MEMC_SOUND_END, endAddress))} ; end &${endAddress.toString(16).toUpperCase()}`,
    '  STR R0, [R0]',
    `  LDR R0, =${word(memcSoundAddress(MEMC_SOUND_POINTER, validated.bufferAddress))} ; pointer, whose write starts the buffer`,
    '  STR R0, [R0]',
    '  MOVS PC, R14',
    '',
    `; The sample itself. It has to be copied to physical &${validated.bufferAddress.toString(16).toUpperCase()} before playing;`,
    '; assembling it here only puts the bytes somewhere they can be copied from.',
    `.${label}_data`,
    ...rows,
    `.${label}_end`,
    '',
  ].join('\n');

  return {
    bytes,
    assembly,
    manifest: {
      schema: '8bit-net.generated-vidc-sample',
      version: 1,
      sourceSchema: VIDC_SAMPLE_SCHEMA,
      sourceVersion: 1,
      name: validated.name,
      machineId: validated.machineId,
      part: choice.part,
      partReason: choice.reason,
      channelMode: validated.channelMode,
      periodMicroseconds: validated.periodMicroseconds,
      byteRateHz: byteRate,
      channelRateHz: channelRate,
      frames: samples.length / validated.channelMode,
      byteLength: length,
      paddingBytes: length - encoded.bytes.length,
      bufferAddress: validated.bufferAddress,
      bufferEndAddress: endAddress,
      clippedSamples: encoded.clipped,
      worstError: encoded.worstError,
      stereoRegisters,
      soundFrequencyRegister: sfr,
      assumptions,
      sha256: sha256Hex(bytes),
    },
  };
}

/* ---- import -------------------------------------------------------------- */

/**
 * Read the PCM out of a RIFF WAVE file, or refuse it by name.
 *
 * Only uncompressed integer PCM is read. Everything else is refused saying what
 * it is, because a reader that quietly misinterpreted a compressed or floating
 * point file would produce a sample that is noise, and noise is exactly what a
 * person cannot tell from a bug in the encoder.
 */
export function readWavPcm16(bytes: Uint8Array): { samples: Int16Array; channels: number; sampleRateHz: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
    throw new VidcSampleDocumentError('That is not a RIFF WAVE file: it does not begin with RIFF and WAVE.');
  }

  let format: { audioFormat: number; channels: number; sampleRateHz: number; bitsPerSample: number } | null = null;
  let data: Uint8Array | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunk = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (body + size > bytes.length) {
      throw new VidcSampleDocumentError(`The ${chunk} chunk claims ${size} bytes and the file has ${bytes.length - body} left, so the file is truncated.`);
    }
    if (chunk === 'fmt ' && size >= 16) {
      format = {
        audioFormat: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRateHz: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (chunk === 'data') {
      data = bytes.subarray(body, body + size);
    }
    /* RIFF chunks are padded to even lengths. */
    offset = body + size + (size % 2);
  }

  if (!format) throw new VidcSampleDocumentError('That WAVE file has no fmt chunk, so nothing says how to read its samples.');
  if (!data) throw new VidcSampleDocumentError('That WAVE file has no data chunk, so it holds no samples.');
  /* 1 is WAVE_FORMAT_PCM. 3 is IEEE float and 0xFFFE is extensible; both are
   * named rather than attempted. */
  if (format.audioFormat !== 1) {
    const named = format.audioFormat === 3 ? 'floating point' : format.audioFormat === 0xfffe ? 'WAVE_FORMAT_EXTENSIBLE' : `format ${format.audioFormat}`;
    throw new VidcSampleDocumentError(`This build reads uncompressed integer PCM, and that file is ${named}. Convert it to 8- or 16-bit PCM first.`);
  }
  if (format.channels < 1 || format.channels > 8) {
    throw new VidcSampleDocumentError(`A WAVE file of ${format.channels} channels cannot be played by VIDC, which has at most 8.`);
  }

  let samples: Int16Array;
  if (format.bitsPerSample === 16) {
    samples = new Int16Array(Math.floor(data.length / 2));
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = (data[index * 2]! | (data[index * 2 + 1]! << 8)) << 16 >> 16;
    }
  } else if (format.bitsPerSample === 8) {
    /* Eight-bit WAVE samples are unsigned with 128 as silence. */
    samples = new Int16Array(data.length);
    for (let index = 0; index < data.length; index += 1) samples[index] = (data[index]! - 128) * 256;
  } else {
    throw new VidcSampleDocumentError(`This build reads 8- and 16-bit PCM, and that file is ${format.bitsPerSample}-bit.`);
  }
  if (samples.length === 0) throw new VidcSampleDocumentError('That WAVE file holds no samples.');

  return { samples, channels: format.channels, sampleRateHz: format.sampleRateHz };
}

/**
 * Resample to the rate a document plays at, by nearest neighbour.
 *
 * Nearest neighbour is named rather than hidden: it is audibly coarse on a
 * large rate change, and a caller told which method was used can decide to
 * resample elsewhere. Choosing the period that is closest to the file's own
 * rate first is what keeps that from mattering.
 */
export function resampleForDocument(
  document: VidcSampleDocument,
  source: { samples: Int16Array; channels: number; sampleRateHz: number },
): Int16Array {
  const target = channelSampleRateHz(document.periodMicroseconds, document.channelMode);
  const sourceFrames = Math.floor(source.samples.length / source.channels);
  const frames = Math.max(1, Math.round((sourceFrames * target) / source.sampleRateHz));
  const out = new Int16Array(frames * document.channelMode);
  for (let frame = 0; frame < frames; frame += 1) {
    const from = Math.min(sourceFrames - 1, Math.floor((frame * source.sampleRateHz) / target));
    for (let channel = 0; channel < document.channelMode; channel += 1) {
      /* Fewer channels in the file than the document wants repeats the last
       * one it has, rather than leaving a channel silent without saying so. */
      const sourceChannel = Math.min(channel, source.channels - 1);
      out[frame * document.channelMode + channel] = source.samples[from * source.channels + sourceChannel] ?? 0;
    }
  }
  return out;
}

/** The period whose channel rate is closest to a rate a file was recorded at. */
export function closestPeriodForRate(sampleRateHz: number, channelMode: VidcChannelMode): number {
  let best = SFR_MIN_PERIOD_US;
  let bestError = Infinity;
  for (let period = SFR_MIN_PERIOD_US; period <= SFR_MAX_PERIOD_US; period += 1) {
    const error = Math.abs(channelSampleRateHz(period, channelMode) - sampleRateHz);
    if (error < bestError) {
      bestError = error;
      best = period;
    }
  }
  return best;
}
