/* Property and fuzz coverage for every media parser.
 *
 * These parsers read binary a user did not write: disk images, tape images and
 * Acorn file containers. They are the largest untrusted-input surface in the
 * product, so the contract they are held to here is deliberately blunt. For any
 * input at all, a parser must either return a structure that satisfies its own
 * declared invariants, or throw an `Error` with a message. It must never hang,
 * never read outside its input, never return a half-built structure, and never
 * report a length or offset that its own image cannot support.
 *
 * Inputs come from a seeded generator, so a failure names a reproducible case.
 */
import { describe, expect, it } from 'vitest';
import { parseDfsCatalogue, extractDfsFile } from './dfsCatalogue';
import { parseAdfsCatalogue, extractAdfsFile } from './adfsCatalogue';
import { parseAtomAtm, createAtomAtm } from './atomAtm';
import { detectTapeFormat, validateTapeImage, MAX_TAPE_IMAGE_BYTES } from './tapeFormat';
import { openDfsImageProject, createDfsImageFromFiles } from './dfsImage';
import { splitDfsDsdImage, openDfsDsdProject, createDfsDsdImage, DFS_DSD_IMAGE_SIZE } from './dfsDsdImage';

function random(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 0x100000000;
  };
}

function noise(next: () => number, length: number): Uint8Array {
  return Uint8Array.from({ length }, () => Math.floor(next() * 256));
}

/** Sizes that matter: empty, tiny, exactly a sector, real image sizes, odd. */
const INTERESTING_SIZES = [0, 1, 7, 255, 256, 511, 512, 513, 1024, 200 * 1024, 400 * 1024, 640 * 1024];

interface Parser {
  name: string;
  parse: (bytes: Uint8Array) => unknown;
  /** Extra invariant check on anything the parser accepted. */
  check?: (result: never, bytes: Uint8Array) => void;
}

const PARSERS: Parser[] = [
  {
    name: 'DFS catalogue',
    parse: parseDfsCatalogue,
    check: (result: never, bytes) => {
      const catalogue = result as ReturnType<typeof parseDfsCatalogue>;
      for (const entry of catalogue.files) {
        /* An accepted entry must describe data the image can actually hold. */
        expect(entry.startSector * 256 + entry.length).toBeLessThanOrEqual(Math.max(bytes.length, entry.startSector * 256));
        expect(entry.length).toBeGreaterThanOrEqual(0);
        expect(entry.name.length).toBeGreaterThan(0);
      }
    },
  },
  {
    name: 'ADFS catalogue',
    parse: parseAdfsCatalogue,
    check: (result: never) => {
      const catalogue = result as ReturnType<typeof parseAdfsCatalogue>;
      for (const entry of catalogue.entries) {
        expect(entry.length).toBeGreaterThanOrEqual(0);
        expect(entry.name.length).toBeGreaterThan(0);
      }
    },
  },
  {
    name: 'Atom ATM',
    parse: parseAtomAtm,
    check: (result: never) => {
      const file = result as ReturnType<typeof parseAtomAtm>;
      expect(file.name.length).toBeLessThanOrEqual(16);
      expect(file.bytes.length).toBeLessThanOrEqual(0x10000);
    },
  },
  { name: 'tape image', parse: validateTapeImage },
  { name: 'DFS image project', parse: openDfsImageProject },
  { name: 'DFS double-sided project', parse: openDfsDsdProject },
];

const CASES = 120;

describe.each(PARSERS)('$name parser', (parser) => {
  it('either parses or refuses random bytes, and never returns something malformed', () => {
    const next = random(0x9e37);
    for (let index = 0; index < CASES; index += 1) {
      const size = INTERESTING_SIZES[Math.floor(next() * INTERESTING_SIZES.length)]!;
      const bytes = noise(next, size);
      try {
        const result = parser.parse(bytes);
        expect(result, `case ${index} size ${size}`).toBeTypeOf('object');
        parser.check?.(result as never, bytes);
      } catch (error) {
        expect(error, `case ${index} size ${size}`).toBeInstanceOf(Error);
        expect((error as Error).message, `case ${index} size ${size}`).not.toBe('');
      }
    }
  }, 30_000);

  it('refuses or survives every empty and single-byte input', () => {
    for (const bytes of [new Uint8Array(0), new Uint8Array(1), Uint8Array.from([0xff]), new Uint8Array(2)]) {
      try { expect(parser.parse(bytes)).toBeTypeOf('object'); }
      catch (error) { expect(error).toBeInstanceOf(Error); }
    }
  });

  it('is not disturbed by a single flipped bit in an otherwise valid image', () => {
    const next = random(0x1234);
    const valid = createDfsImageFromFiles({ title: 'FUZZ', bootOption: 0, cycle: 0, files: [{ name: 'DATA', directory: '$', loadAddress: 0x1900, executionAddress: 0x1900, locked: false, bytes: noise(next, 512) }] }).image;
    for (let index = 0; index < 40; index += 1) {
      const mutated = valid.slice();
      const position = Math.floor(next() * mutated.length);
      mutated[position] = mutated[position]! ^ (1 << Math.floor(next() * 8));
      try { parser.parse(mutated); }
      catch (error) { expect(error, `flip at ${position}`).toBeInstanceOf(Error); }
    }
  }, 30_000);
});

describe('DFS catalogue invariants', () => {
  const next = random(0xbeef);

  it('round-trips a written image through its own reader', () => {
    const payload = noise(next, 1024);
    const created = createDfsImageFromFiles({
      title: 'ROUNDTRIP', bootOption: 3, cycle: 5,
      files: [{ name: 'PROG', directory: '$', loadAddress: 0x1900, executionAddress: 0x8023, locked: true, bytes: payload }],
    });
    const catalogue = parseDfsCatalogue(created.image);
    expect(catalogue.title).toBe('ROUNDTRIP');
    expect(catalogue.bootOption).toBe(3);
    expect(catalogue.files).toHaveLength(1);
    expect(catalogue.files[0]).toMatchObject({ name: 'PROG', directory: '$', loadAddress: 0x1900, executionAddress: 0x8023, locked: true, length: payload.length });
    expect(Array.from(extractDfsFile(created.image, catalogue.files[0]!))).toEqual(Array.from(payload));
  });

  it('refuses to extract an extent the image cannot hold rather than reading past its end', () => {
    const created = createDfsImageFromFiles({ title: 'T', bootOption: 0, cycle: 0, files: [{ name: 'A', directory: '$', loadAddress: 0, executionAddress: 0, locked: false, bytes: noise(next, 300) }] });
    const catalogue = parseDfsCatalogue(created.image);
    expect(extractDfsFile(created.image, catalogue.files[0]!)).toHaveLength(300);
    /* Truncated on a sector boundary the reader accepts, the entry's extent no
     * longer fits, and extraction says so instead of returning a short read. */
    const truncated = created.image.slice(0, 512);
    expect(() => extractDfsFile(truncated, catalogue.files[0]!)).toThrow(/extent is outside the DFS image/);
  });

  it('refuses a catalogue claiming more files than the format holds', () => {
    const bytes = new Uint8Array(200 * 1024);
    bytes[0x105] = 0xff;
    expect(() => parseDfsCatalogue(bytes)).toThrow();
  });
});

describe('tape image validation', () => {
  it('names a format only when the signature is really there', () => {
    expect(detectTapeFormat(new Uint8Array(0))).toBeNull();
    expect(detectTapeFormat(noise(random(0x77), 64))).toBeNull();
    expect(() => validateTapeImage(new Uint8Array(0))).toThrow();
  });

  it('refuses an image beyond the declared size bound', () => {
    expect(() => validateTapeImage(new Uint8Array(MAX_TAPE_IMAGE_BYTES + 1))).toThrow();
  });
});

describe('double-sided DFS images', () => {
  const next = random(0x5150);

  it('splits into two sides of the declared size and refuses anything else', () => {
    const image = noise(next, DFS_DSD_IMAGE_SIZE);
    const [first, second] = splitDfsDsdImage(image);
    expect(first).toHaveLength(DFS_DSD_IMAGE_SIZE / 2);
    expect(second).toHaveLength(DFS_DSD_IMAGE_SIZE / 2);
    expect(() => splitDfsDsdImage(new Uint8Array(DFS_DSD_IMAGE_SIZE - 1))).toThrow();
  });

  it('writes and re-reads both sides independently', () => {
    const created = createDfsDsdImage({
      sides: [
        { title: 'SIDE0', bootOption: 0, cycle: 0, files: [{ name: 'ONE', directory: '$', loadAddress: 0, executionAddress: 0, locked: false, bytes: noise(next, 256) }] },
        { title: 'SIDE2', bootOption: 1, cycle: 0, files: [{ name: 'TWO', directory: '$', loadAddress: 0, executionAddress: 0, locked: false, bytes: noise(next, 256) }] },
      ],
    });
    expect(created.image).toHaveLength(DFS_DSD_IMAGE_SIZE);
    const reopened = openDfsDsdProject(created.image);
    expect(reopened.sides[0]!.title).toBe('SIDE0');
    expect(reopened.sides[1]!.title).toBe('SIDE2');
    expect(reopened.sides[0]!.files[0]!.name).toBe('ONE');
    expect(reopened.sides[1]!.files[0]!.name).toBe('TWO');
  });
});

describe('Atom ATM containers', () => {
  it('round-trips a written container', () => {
    const payload = noise(random(0x2020), 64);
    const parsed = parseAtomAtm(createAtomAtm({ name: 'ATOMFILE', loadAddress: 0x2900, executionAddress: 0x2900, bytes: payload }));
    expect(parsed.name).toBe('ATOMFILE');
    expect(parsed.loadAddress).toBe(0x2900);
    expect(Array.from(parsed.bytes)).toEqual(Array.from(payload));
  });

  it('refuses a container whose declared length exceeds its bytes', () => {
    const bytes = createAtomAtm({ name: 'A', loadAddress: 0, executionAddress: 0, bytes: noise(random(1), 16) });
    const truncated = bytes.slice(0, bytes.length - 8);
    expect(() => parseAtomAtm(truncated)).toThrow();
  });
});

describe('ADFS catalogue invariants', () => {
  it('refuses an image that is too small to hold a catalogue', () => {
    for (const size of [0, 1, 256, 1024]) {
      expect(() => parseAdfsCatalogue(new Uint8Array(size)), `size ${size}`).toThrow();
    }
  });

  it('never extracts beyond the image it was given', () => {
    const next = random(0x3141);
    for (let index = 0; index < 20; index += 1) {
      const bytes = noise(next, 640 * 1024);
      try {
        const catalogue = parseAdfsCatalogue(bytes);
        for (const entry of catalogue.entries.slice(0, 4)) {
          expect(extractAdfsFile(bytes, entry).length).toBeLessThanOrEqual(bytes.length);
        }
      } catch (error) { expect(error).toBeInstanceOf(Error); }
    }
  }, 30_000);
});
