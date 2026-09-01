import { describe, expect, it } from 'vitest';
import { loadTapeFromData } from 'jsbeeb/src/tapes.js';
import {
  TAPE_BAUD, UEF_CHUNK, MAX_BLOCK_BYTES, MAX_NAME_LENGTH, MAX_ATOM_NAME_LENGTH, TapeError,
  tapeCrc, encodeTapeBlock, encodeTapeFile, createTapeImage,
  encodeAtomTapeBlock, encodeAtomTapeFile, createAtomTapeImage,
} from './acornTape';
import {
  measurementPayload, BBC_MEASURED_FILE, BBC_MEASURED_BLOCKS, BBC_MEASURED_IMAGE,
  ATOM_MEASURED_FILE, ATOM_MEASURED_BLOCKS, ATOM_MEASURED_IMAGE,
  BBC_B_TAPE_LOAD, MASTER_TAPE_LOAD, ATOM_TAPE_LOAD, BBC_B_TAPE_CHAIN,
} from './acornTapeMeasurements';
import { readUef, describeUef } from './uefChunks';

const hex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (text: string): Uint8Array => Uint8Array.from(text.match(/.{2}/g)!.map((pair) => parseInt(pair, 16)));

const bbcFile = () => ({ name: BBC_MEASURED_FILE.name, loadAddress: BBC_MEASURED_FILE.loadAddress, executionAddress: BBC_MEASURED_FILE.executionAddress, bytes: measurementPayload(BBC_MEASURED_FILE.length, BBC_MEASURED_FILE.step, BBC_MEASURED_FILE.seed) });
const atomFile = () => ({ name: ATOM_MEASURED_FILE.name, loadAddress: ATOM_MEASURED_FILE.loadAddress, executionAddress: ATOM_MEASURED_FILE.executionAddress, bytes: measurementPayload(ATOM_MEASURED_FILE.length, ATOM_MEASURED_FILE.step, ATOM_MEASURED_FILE.seed) });

/*
 * Read a tape the way the emulator this build ships reads it, and give back the
 * bytes it delivered to the machine. No ROMs are involved: the container is the
 * emulator's business, not the operating system's, so this runs anywhere.
 */
async function deliver(image: Uint8Array): Promise<number[]> {
  const received: number[] = [];
  /* The reader narrates every chunk it reaches. That is useful when somebody is
   * debugging a tape by hand and is noise in a test reporter, so it is quiet
   * here and restored afterwards rather than left muted for the whole file. */
  const narration = console.log;
  console.log = () => {};
  const acia = { receive: (byte: number) => received.push(byte), tone: () => {}, setTapeCarrier: () => {}, receiveBit: () => {} };
  /* Only the two fields the container reader touches; no machine is booted. */
  const model = { isAtom: false, cyclesPerSecond: 2_000_000 } as unknown as Parameters<typeof loadTapeFromData>[2];
  const tape = await loadTapeFromData('measured.uef', image, model);
  if (!tape) throw new Error('The emulator did not recognise the image as a tape at all');
  /* Poll until the reader runs out of tape; it returns undefined at the end. */
  try {
    for (let i = 0; i < 4_000_000; i += 1) if (tape.poll(acia) === undefined) break;
  } finally {
    console.log = narration;
  }
  return received;
}

describe('the Acorn tape block format', () => {
  it('produces, for the BBC, exactly the blocks a BBC B and a Master accepted', () => {
    expect(encodeTapeFile(bbcFile()).map(hex)).toEqual([...BBC_MEASURED_BLOCKS]);
  });

  it('produces exactly the image those machines loaded', () => {
    expect(hex(createTapeImage([bbcFile()]))).toBe(BBC_MEASURED_IMAGE);
  });

  it('records that both machines loaded every byte, and what they printed', () => {
    expect(BBC_B_TAPE_LOAD.loaded).toBe(true);
    expect(MASTER_TAPE_LOAD.loaded).toBe(true);
    expect(BBC_B_TAPE_LOAD.transcript).toContain('Searching');
    expect(BBC_B_TAPE_LOAD.transcript).toContain('Loading');
    expect(BBC_B_TAPE_LOAD.transcript).toContain('GAME       01');
    expect(MASTER_TAPE_LOAD.transcript).toContain('GAME       01');
  });

  it('carries a BBC BASIC program a machine then ran', () => {
    expect(BBC_B_TAPE_CHAIN.transcript).toContain('TAPE LOADED');
    expect(BBC_B_TAPE_CHAIN.transcript).toContain('DONE');
    expect(BBC_B_TAPE_CHAIN.transcript).not.toContain('Bad');
  });

  it('splits at 256 bytes and marks only the final block as last', () => {
    const bytes = new Uint8Array(MAX_BLOCK_BYTES * 2 + 1).fill(0x5a);
    const blocks = encodeTapeFile({ name: 'SPLIT', loadAddress: 0x2000, executionAddress: 0x2000, bytes });
    expect(blocks).toHaveLength(3);
    const flagAt = 1 + 'SPLIT'.length + 1 + 4 + 4 + 2 + 2;
    expect(blocks.map((block) => block[flagAt])).toEqual([0x00, 0x00, 0x80]);
    /* Header, its check, the data and its check. */
    expect(blocks[0]!.length).toBe(1 + 5 + 1 + 4 + 4 + 2 + 2 + 5 + 2 + MAX_BLOCK_BYTES + 2);
    expect(blocks[2]!.length).toBe(1 + 5 + 1 + 4 + 4 + 2 + 2 + 5 + 2 + 1 + 2);
  });

  it('numbers its blocks in order and repeats the file address in each', () => {
    const bytes = new Uint8Array(700).fill(1);
    const blocks = encodeTapeFile({ name: 'N', loadAddress: 0x1234, executionAddress: 0x5678, bytes });
    const numberAt = 1 + 1 + 1 + 4 + 4;
    expect(blocks.map((block) => block[numberAt]! | (block[numberAt + 1]! << 8))).toEqual([0, 1, 2]);
    for (const block of blocks) {
      expect([block[3], block[4], block[5], block[6]]).toEqual([0x34, 0x12, 0x00, 0x00]);
      expect([block[7], block[8], block[9], block[10]]).toEqual([0x78, 0x56, 0x00, 0x00]);
    }
  });

  it('checks the header separately from the data, because the machine has to trust the length first', () => {
    const block = encodeTapeBlock({ name: 'X', loadAddress: 0, executionAddress: 0, bytes: new Uint8Array() }, 0, Uint8Array.from([1, 2, 3]), true);
    const headerCrc = tapeCrc(block.subarray(1, block.length - 7));
    expect([block[block.length - 7], block[block.length - 6]]).toEqual([(headerCrc >>> 8) & 0xff, headerCrc & 0xff]);
    const dataCrc = tapeCrc(Uint8Array.from([1, 2, 3]));
    expect([block[block.length - 2], block[block.length - 1]]).toEqual([(dataCrc >>> 8) & 0xff, dataCrc & 0xff]);
  });

  it('computes the CRC the format specifies, most significant bit first', () => {
    expect(tapeCrc(new Uint8Array())).toBe(0);
    expect(tapeCrc(Uint8Array.from([0x00]))).toBe(0x0000);
    expect(tapeCrc(Uint8Array.from([0x01]))).toBe(0x1021);
    expect(tapeCrc(Uint8Array.from([0xff, 0xff]))).toBe(tapeCrc(Uint8Array.from([0xff, 0xff])));
    expect(tapeCrc(Uint8Array.from([1, 2, 3]))).not.toBe(tapeCrc(Uint8Array.from([3, 2, 1])));
  });

  it('refuses names, sizes and addresses the format cannot carry', () => {
    const file = { name: 'GAME', loadAddress: 0, executionAddress: 0, bytes: Uint8Array.from([1]) };
    expect(() => encodeTapeBlock({ ...file, name: 'X'.repeat(MAX_NAME_LENGTH + 1) }, 0, Uint8Array.from([1]), true)).toThrow(TapeError);
    expect(() => encodeTapeBlock({ ...file, name: '' }, 0, Uint8Array.from([1]), true)).toThrow(TapeError);
    expect(() => encodeTapeBlock({ ...file, name: 'aéb' }, 0, Uint8Array.from([1]), true)).toThrow(TapeError);
    expect(() => encodeTapeBlock(file, 0, new Uint8Array(MAX_BLOCK_BYTES + 1), true)).toThrow(TapeError);
    expect(() => encodeTapeBlock(file, -1, Uint8Array.from([1]), true)).toThrow(TapeError);
    expect(() => encodeTapeBlock({ ...file, loadAddress: -1 }, 0, Uint8Array.from([1]), true)).toThrow(TapeError);
    expect(() => encodeTapeFile({ ...file, bytes: new Uint8Array() })).toThrow(TapeError);
    expect(() => createTapeImage([])).toThrow(TapeError);
  });
});

describe('the Atom tape block format', () => {
  it('produces exactly the blocks an Acorn Atom accepted', () => {
    expect(encodeAtomTapeFile(atomFile()).map(hex)).toEqual([...ATOM_MEASURED_BLOCKS]);
  });

  it('produces exactly the image the Atom loaded, and every byte arrived', () => {
    expect(hex(createAtomTapeImage([atomFile()]))).toBe(ATOM_MEASURED_IMAGE);
    expect(ATOM_TAPE_LOAD.loaded).toBe(true);
    expect(ATOM_TAPE_LOAD.transcript).toContain('PLAY TAPE');
    expect(ATOM_TAPE_LOAD.transcript).not.toContain('ERROR');
  });

  it('sums the four synchronising asterisks along with everything else', () => {
    const block = encodeAtomTapeBlock({ name: 'S', loadAddress: 0x2900, executionAddress: 0x2900, bytes: new Uint8Array() }, 0, Uint8Array.from([9, 9]), true, true);
    expect([...block.subarray(0, 4)]).toEqual([0x2a, 0x2a, 0x2a, 0x2a]);
    const summed = block.subarray(0, block.length - 1).reduce((total, byte) => (total + byte) & 0xff, 0);
    expect(block[block.length - 1]).toBe(summed);
    const withoutSync = block.subarray(4, block.length - 1).reduce((total, byte) => (total + byte) & 0xff, 0);
    expect(block[block.length - 1]).not.toBe(withoutSync);
  });

  it('gives every block its own load address', () => {
    const blocks = encodeAtomTapeFile({ name: 'M', loadAddress: 0x2900, executionAddress: 0x2900, bytes: new Uint8Array(600).fill(2) });
    expect(blocks).toHaveLength(3);
    const loadAt = 4 + 1 + 1 + 1 + 2 + 1 + 2;
    expect(blocks.map((block) => (block[loadAt]! << 8) | block[loadAt + 1]!)).toEqual([0x2900, 0x2a00, 0x2b00]);
  });

  it('writes its addresses high byte first, unlike the BBC', () => {
    const block = encodeAtomTapeBlock({ name: 'A', loadAddress: 0x1234, executionAddress: 0x5678, bytes: new Uint8Array() }, 0, Uint8Array.from([0]), true, true);
    expect([...block.subarray(4 + 2 + 1 + 2 + 1, 4 + 2 + 1 + 2 + 1 + 4)]).toEqual([0x56, 0x78, 0x12, 0x34]);
  });

  it('records the block length as one less than it is, which is why a block cannot be empty', () => {
    const block = encodeAtomTapeBlock({ name: 'A', loadAddress: 0, executionAddress: 0, bytes: new Uint8Array() }, 0, new Uint8Array(MAX_BLOCK_BYTES).fill(3), true, true);
    expect(block[4 + 2 + 1 + 2]).toBe(0xff);
    expect(() => encodeAtomTapeBlock({ name: 'A', loadAddress: 0, executionAddress: 0, bytes: new Uint8Array() }, 0, new Uint8Array(), true, true)).toThrow(TapeError);
  });

  it('marks the first, the middle and the last block differently', () => {
    const blocks = encodeAtomTapeFile({ name: 'F', loadAddress: 0x2900, executionAddress: 0x2900, bytes: new Uint8Array(600).fill(4) });
    const flagAt = 4 + 1 + 1;
    expect(blocks.map((block) => block[flagAt])).toEqual([0xc0, 0xe0, 0x60]);
  });

  it('refuses names and addresses the Atom cannot carry', () => {
    const file = { name: 'GAME', loadAddress: 0x2900, executionAddress: 0x2900, bytes: Uint8Array.from([1]) };
    expect(() => encodeAtomTapeBlock({ ...file, name: 'X'.repeat(MAX_ATOM_NAME_LENGTH + 1) }, 0, Uint8Array.from([1]), true, true)).toThrow(TapeError);
    expect(() => encodeAtomTapeBlock({ ...file, loadAddress: 0x10000 }, 0, Uint8Array.from([1]), true, true)).toThrow(TapeError);
    expect(() => encodeAtomTapeBlock({ ...file, executionAddress: -1 }, 0, Uint8Array.from([1]), true, true)).toThrow(TapeError);
    expect(() => createAtomTapeImage([])).toThrow(TapeError);
  });
});

describe('the UEF container these tapes travel in', () => {
  it('is read by the emulator this build ships, byte for byte', async () => {
    const file = bbcFile();
    const expected = encodeTapeFile(file).flatMap((block) => [...block]);
    await expect(deliver(createTapeImage([file]))).resolves.toEqual(expected);
  });

  it("carries the Atom's blocks through the same reader unchanged", async () => {
    const file = atomFile();
    const expected = encodeAtomTapeFile(file).flatMap((block) => [...block]);
    await expect(deliver(createAtomTapeImage([file]))).resolves.toEqual(expected);
  });

  it('opens with an origin chunk, because the reader discards whatever comes first', async () => {
    const image = createTapeImage([bbcFile()]);
    expect(image[12]! | (image[13]! << 8)).toBe(UEF_CHUNK.origin);
    const identified = readUef(image);
    expect(identified.chunks[0]!.id).toBe(UEF_CHUNK.origin);
    expect(describeUef(identified).map((entry) => entry.id)).toContain('&0116');
  });

  it('gives the gap in seconds rather than as a divisor', () => {
    const image = createTapeImage([bbcFile()], { gapSeconds: 0.25 });
    const gaps = readUef(image).chunks.filter((chunk) => chunk.id === UEF_CHUNK.gap);
    expect(gaps.length).toBeGreaterThan(0);
    for (const gap of gaps) expect(gap.data.length).toBe(4);
    expect(UEF_CHUNK.gap).toBe(0x0116);
  });

  it("leads each file with a carrier counted in cycles of the tape's own tone", () => {
    const image = createTapeImage([bbcFile()], { carrierSeconds: 3 });
    const tones = readUef(image).chunks.filter((chunk) => chunk.id === UEF_CHUNK.carrierTone);
    expect(tones.length).toBeGreaterThan(0);
    expect(tones[0]!.data[0]! | (tones[0]!.data[1]! << 8)).toBe(3 * TAPE_BAUD * 2);
  });

  it('keeps several files apart on one tape', async () => {
    const first = { name: 'ONE', loadAddress: 0x2000, executionAddress: 0x2000, bytes: Uint8Array.from([1, 2, 3]) };
    const second = { name: 'TWO', loadAddress: 0x3000, executionAddress: 0x3000, bytes: Uint8Array.from([4, 5, 6]) };
    const delivered = await deliver(createTapeImage([first, second]));
    expect(delivered).toEqual([...encodeTapeFile(first)[0]!, ...encodeTapeFile(second)[0]!]);
  });

  it("round-trips through this build's own reader with the same chunks", () => {
    const identified = readUef(createTapeImage([bbcFile()]));
    expect(identified.chunks.map((chunk) => chunk.id)).toContain(UEF_CHUNK.implicitData);
    expect(fromHex(BBC_MEASURED_IMAGE)).toEqual(createTapeImage([bbcFile()]));
  });
});
