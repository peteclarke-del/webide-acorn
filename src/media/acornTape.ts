/*
 * Making a tape a real machine will load.
 *
 * Until now this build could read a UEF and hand it to an emulator, and could
 * not produce one. That is the difference between running your game and
 * finishing it: an Atom and an Electron shipped with a cassette recorder, and a
 * game that cannot leave the workbench on the medium the machine actually had
 * is a game nobody else can play.
 *
 * Two formats are involved and they are not the same thing.
 *
 * The **UEF container** is what an emulator reads: a header and a list of
 * chunks, each an identifier, a length and its bytes. Which chunks are
 * understood is not a matter of opinion — it is whatever the reader that will
 * be asked to load this implements — so the ones used here are taken from
 * jsbeeb's own tape reader, which is the code that will actually be handed the
 * file: carrier tone, a gap, and implicit-format data.
 *
 * The **Acorn block format** inside that byte stream is not the emulator's at
 * all. It is the operating system's: the MOS reads a header naming the file, its
 * load and execution addresses, which block this is and how long it is, checks
 * it, then reads the data and checks that. No emulator validates it, which means
 * no emulator can tell you it is wrong — a tape with a bad checksum simply never
 * finishes loading.
 *
 * So the block format here is verified the only way it can be: by writing a tape,
 * giving it to a real machine, and requiring the machine to load it and produce
 * the bytes that went in. `acornTape.test.ts` holds the encoder to the bytes a
 * BBC actually accepted.
 */

/** The 1200 baud tones a UEF describes, which the machine's ACIA is clocked for. */
export const TAPE_BAUD = 1200;

/** Chunk identifiers, from the reader that will be asked to load this. */
export const UEF_CHUNK = Object.freeze({
  origin: 0x0000,
  implicitData: 0x0100,
  carrierTone: 0x0110,
  /*
   * The gap is given in seconds as a float, not as the integer chunk beside it.
   * The integer form is read as a divisor by at least one of the readers this
   * build hands tapes to, and a gap that means different lengths of silence to
   * different readers is a tape that loads in some places and not others.
   */
  gap: 0x0116,
});

const SIGNATURE = [0x55, 0x45, 0x46, 0x20, 0x46, 0x69, 0x6c, 0x65, 0x21, 0x00];

export interface TapeFile {
  /** Up to ten characters, which is what the header field holds. */
  name: string;
  loadAddress: number;
  executionAddress: number;
  bytes: Uint8Array;
}

export class TapeError extends Error {
  constructor(message: string) { super(message); this.name = 'TapeError'; }
}

/**
 * The CRC the Acorn tape format uses, over a run of bytes.
 *
 * A 16-bit CRC with the polynomial &1021, fed most significant bit first, which
 * is the one the MOS computes and compares. It is written big-endian on the
 * tape, unlike everything else in the header, and that asymmetry is real rather
 * than a mistake here.
 */
export function tapeCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

/** The largest a single block's data may be, which the header's length field fixes. */
export const MAX_BLOCK_BYTES = 256;
/** The header's name field, which is why a tape file name is short. */
export const MAX_NAME_LENGTH = 10;

function requireName(name: string): number[] {
  if (!/^[\x20-\x7e]{1,10}$/.test(name)) {
    throw new TapeError(`A tape file name is 1 to ${MAX_NAME_LENGTH} printable characters, and ${JSON.stringify(name)} is not.`);
  }
  return [...name].map((character) => character.charCodeAt(0));
}

function requireAddress(value: number, what: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new TapeError(`${what} is a 32-bit address and ${value} is not one.`);
  }
  return value >>> 0;
}

const u16 = (value: number): number[] => [value & 0xff, (value >>> 8) & 0xff];
const u32 = (value: number): number[] => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];

/**
 * One block, as the operating system expects to read it.
 *
 * Synchronisation byte, then the name and a terminator, then the addresses, the
 * block number, its length, a flag and four reserved bytes, then the header's
 * own check; then the data and its check. The header is checked separately from
 * the data because the machine has to trust the length before it reads that
 * many bytes.
 */
export function encodeTapeBlock(file: TapeFile, blockNumber: number, data: Uint8Array, last: boolean): Uint8Array {
  if (data.length > MAX_BLOCK_BYTES) throw new TapeError(`A tape block carries at most ${MAX_BLOCK_BYTES} bytes and this one has ${data.length}.`);
  if (!Number.isInteger(blockNumber) || blockNumber < 0 || blockNumber > 0xffff) throw new TapeError(`A block number is 0 to 65535 and ${blockNumber} is not.`);
  const header = [
    ...requireName(file.name), 0x00,
    ...u32(requireAddress(file.loadAddress, 'A load address')),
    ...u32(requireAddress(file.executionAddress, 'An execution address')),
    ...u16(blockNumber),
    ...u16(data.length),
    /* Bit 7 says this is the last block; the rest are for things this build
     * does not produce — locked files and blocks with no data. */
    last ? 0x80 : 0x00,
    0x00, 0x00, 0x00, 0x00,
  ];
  const headerCrc = tapeCrc(Uint8Array.from(header));
  const block = [
    0x2a, ...header, (headerCrc >>> 8) & 0xff, headerCrc & 0xff,
  ];
  if (data.length) {
    const dataCrc = tapeCrc(data);
    block.push(...data, (dataCrc >>> 8) & 0xff, dataCrc & 0xff);
  }
  return Uint8Array.from(block);
}

/** Every block of one file, in order, each carrying its place in the sequence. */
export function encodeTapeFile(file: TapeFile): Uint8Array[] {
  if (!file.bytes.length) throw new TapeError('A tape file with no bytes would record a name and nothing to load.');
  const blocks: Uint8Array[] = [];
  for (let offset = 0; offset < file.bytes.length; offset += MAX_BLOCK_BYTES) {
    const chunk = file.bytes.subarray(offset, Math.min(offset + MAX_BLOCK_BYTES, file.bytes.length));
    const last = offset + chunk.length >= file.bytes.length;
    blocks.push(encodeTapeBlock(file, blocks.length, chunk, last));
  }
  return blocks;
}

function chunk(id: number, data: number[]): number[] {
  return [...u16(id), ...u32(data.length), ...data];
}

/** A float in the format a UEF gap or tone carries, which is IEEE single. */
function seconds(value: number): number[] {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setFloat32(0, value, true);
  return [...new Uint8Array(buffer)];
}

export interface TapeOptions {
  /** Text recorded in the file saying what produced it. */
  origin?: string;
  /** Leader before each file, in seconds. The machine needs one to lock on. */
  carrierSeconds?: number;
  /** Silence between blocks, in seconds, which is where the machine catches up. */
  gapSeconds?: number;
}

/**
 * A UEF holding these files, in order, ready to be loaded.
 *
 * Each file gets a leader long enough for the machine to lock onto, then its
 * blocks with a short gap between them, because a machine that is still writing
 * the previous block into memory is not listening.
 */
export function createTapeImage(files: readonly TapeFile[], options: TapeOptions = {}): Uint8Array {
  if (!files.length) throw new TapeError('A tape with no files on it would be a tape nobody can load anything from.');
  const carrier = options.carrierSeconds ?? 2;
  const gap = options.gapSeconds ?? 0.2;
  const body: number[] = [];
  body.push(...chunk(UEF_CHUNK.origin, [...(options.origin ?? '8bit-net Acorn Workbench')].map((c) => c.charCodeAt(0)).concat(0)));
  for (const file of files) {
    body.push(...chunk(UEF_CHUNK.carrierTone, u16(Math.round(carrier * TAPE_BAUD * 2))));
    const blocks = encodeTapeFile(file);
    for (const [index, block] of blocks.entries()) {
      body.push(...chunk(UEF_CHUNK.implicitData, [...block]));
      if (index < blocks.length - 1) {
        body.push(...chunk(UEF_CHUNK.gap, seconds(gap)));
        body.push(...chunk(UEF_CHUNK.carrierTone, u16(Math.round(0.9 * TAPE_BAUD * 2))));
      }
    }
    body.push(...chunk(UEF_CHUNK.gap, seconds(gap * 2)));
  }
  /* Version 0.10, which is what the readers this build hands tapes to expect. */
  return Uint8Array.from([...SIGNATURE, 0x0a, 0x00, ...body]);
}

/*
 * The Atom's tape is a different format, because the Atom is a different
 * machine. Its blocks carry up to 256 bytes like the BBC's, but the header is
 * shorter, its addresses are 16-bit and written high byte first, its file names
 * may be longer, and it protects itself with a single summed byte rather than a
 * CRC. None of that is a variation on the BBC format; it predates it.
 */

/** The Atom's name field, which is longer than the BBC's. */
export const MAX_ATOM_NAME_LENGTH = 13;

function requireAtomName(name: string): number[] {
  if (!/^[\x20-\x7e]{1,13}$/.test(name)) {
    throw new TapeError(`An Atom tape file name is 1 to ${MAX_ATOM_NAME_LENGTH} printable characters, and ${JSON.stringify(name)} is not.`);
  }
  return [...name].map((character) => character.charCodeAt(0));
}

function requireAtomAddress(value: number, what: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new TapeError(`${what} on the Atom is a 16-bit address and ${value} is not one.`);
  }
  return value;
}

/** One Atom block: four synchronising asterisks, the header, the data, and the sum. */
export function encodeAtomTapeBlock(file: TapeFile, blockNumber: number, data: Uint8Array, first: boolean, last: boolean): Uint8Array {
  if (!data.length || data.length > MAX_BLOCK_BYTES) throw new TapeError(`An Atom tape block carries 1 to ${MAX_BLOCK_BYTES} bytes and this one has ${data.length}.`);
  if (!Number.isInteger(blockNumber) || blockNumber < 0 || blockNumber > 0xffff) throw new TapeError(`A block number is 0 to 65535 and ${blockNumber} is not.`);
  const load = requireAtomAddress(file.loadAddress, 'A load address');
  const execution = requireAtomAddress(file.executionAddress, 'An execution address');
  /* Bit 7 says more blocks follow, bit 6 that this one carries data, bit 5 that
   * it is not the first. The Atom's ROM reads all three to decide whether to
   * keep listening. */
  const flags = (last ? 0x00 : 0x80) | 0x40 | (first ? 0x00 : 0x20);
  const header = [
    ...requireAtomName(file.name), 0x0d,
    flags,
    (blockNumber >>> 8) & 0xff, blockNumber & 0xff,
    (data.length - 1) & 0xff,
    (execution >>> 8) & 0xff, execution & 0xff,
    (load >>> 8) & 0xff, load & 0xff,
  ];
  /*
   * The sum covers the four synchronising asterisks as well as the header and
   * the data. That is not what a reading of the format suggests, and leaving
   * them out produces a tape the Atom rejects with SUM ERROR 6 having already
   * placed the right bytes in memory — the load is undone at the last step. The
   * machine settled it: see ACORN_TAPE_MEASUREMENTS.
   */
  const body = [0x2a, 0x2a, 0x2a, 0x2a, ...header, ...data];
  let sum = 0;
  for (const byte of body) sum = (sum + byte) & 0xff;
  return Uint8Array.from([...body, sum]);
}

/**
 * Every Atom block of one file, in order.
 *
 * Each block carries its own load address rather than the file's. The BBC's
 * blocks all repeat the file's address and the MOS advances as it goes; the
 * Atom's ROM writes each block exactly where its header says, so a file whose
 * blocks all name the same address loads entirely on top of itself. That is not
 * a theory: the second block of a 300-byte file landed back at &2900 and left
 * &2A00 untouched until each block named its own address.
 */
export function encodeAtomTapeFile(file: TapeFile): Uint8Array[] {
  if (!file.bytes.length) throw new TapeError('An Atom tape file with no bytes would record a name and nothing to load.');
  const blocks: Uint8Array[] = [];
  for (let offset = 0; offset < file.bytes.length; offset += MAX_BLOCK_BYTES) {
    const chunk = file.bytes.subarray(offset, Math.min(offset + MAX_BLOCK_BYTES, file.bytes.length));
    const at = { ...file, loadAddress: requireAtomAddress(file.loadAddress, 'A load address') + offset };
    blocks.push(encodeAtomTapeBlock(at, blocks.length, chunk, offset === 0, offset + chunk.length >= file.bytes.length));
  }
  return blocks;
}

/**
 * A UEF holding these files in the Atom's own block format.
 *
 * The container is the same; what travels inside it is not. The Atom needs a
 * longer gap between blocks than the BBC because its ROM writes the block away
 * before it starts listening again, and a tape that does not wait loses the
 * next block's header.
 */
export function createAtomTapeImage(files: readonly TapeFile[], options: TapeOptions = {}): Uint8Array {
  if (!files.length) throw new TapeError('A tape with no files on it would be a tape nobody can load anything from.');
  const carrier = options.carrierSeconds ?? 2;
  const gap = options.gapSeconds ?? 0.5;
  const body: number[] = [];
  body.push(...chunk(UEF_CHUNK.origin, [...(options.origin ?? '8bit-net Acorn Workbench')].map((c) => c.charCodeAt(0)).concat(0)));
  for (const file of files) {
    const blocks = encodeAtomTapeFile(file);
    for (const [index, block] of blocks.entries()) {
      /* The leader before each block is the same length as the first. Shorter
       * ones were measured to fail: at 0.5 s and at 0.2 s the Atom read the
       * first block and then sat in its pulse loop for ever. */
      body.push(...chunk(UEF_CHUNK.carrierTone, u16(Math.round(carrier * TAPE_BAUD * 2))));
      body.push(...chunk(UEF_CHUNK.implicitData, [...block]));
      if (index === blocks.length - 1) body.push(...chunk(UEF_CHUNK.gap, seconds(gap)));
    }
  }
  return Uint8Array.from([...SIGNATURE, 0x0a, 0x00, ...body]);
}
