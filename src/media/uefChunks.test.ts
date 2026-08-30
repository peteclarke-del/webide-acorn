/* The contract that matters is the round trip: a UEF this build does not
 * understand a single chunk of still comes back byte for byte. Everything else
 * here supports that claim or checks a refusal is explained.
 */
import { describe, expect, it } from 'vitest';
import { UefError, describeUef, readUef, replaceUefChunk, writeUef } from './uefChunks';

const HEADER = [0x55, 0x45, 0x46, 0x20, 0x46, 0x69, 0x6c, 0x65, 0x21, 0x00, 0x0a, 0x00];

function chunk(id: number, data: number[]): number[] {
  return [
    id & 0xff, (id >>> 8) & 0xff,
    data.length & 0xff, (data.length >>> 8) & 0xff, (data.length >>> 16) & 0xff, (data.length >>> 24) & 0xff,
    ...data,
  ];
}

function uef(...chunks: number[][]): Uint8Array {
  return new Uint8Array([...HEADER, ...chunks.flat()]);
}

describe('readUef', () => {
  it('reads the chunk sequence and the header version', () => {
    const image = readUef(uef(chunk(0x0000, [0x41, 0x42]), chunk(0x0110, [0x01, 0x00])));
    expect(image.majorVersion).toBe(0);
    expect(image.minorVersion).toBe(0x0a);
    expect(image.chunks.map((entry) => entry.id)).toEqual([0x0000, 0x0110]);
    expect([...image.chunks[0]!.data]).toEqual([0x41, 0x42]);
    expect(image.warnings).toEqual([]);
  });

  it('records where each chunk began, so a report can point at the file', () => {
    const image = readUef(uef(chunk(0x0000, [0x41]), chunk(0x0005, [])));
    expect(image.chunks.map((entry) => entry.offset)).toEqual([12, 19]);
  });

  it('says a gzip-compressed UEF is compressed rather than unrecognised', () => {
    const compressed = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(() => readUef(compressed)).toThrow(UefError);
    expect(() => readUef(compressed)).toThrow(/gzip-compressed/);
  });

  it('refuses a file that does not carry a UEF header', () => {
    expect(() => readUef(new Uint8Array(64))).toThrow(/does not begin with a UEF header/);
  });

  it('reports a truncated chunk with the numbers rather than dropping it silently', () => {
    const truncated = new Uint8Array([...HEADER, ...chunk(0x0100, [1, 2, 3]).slice(0, 8)]);
    const image = readUef(truncated);
    expect(image.chunks).toHaveLength(0);
    expect(image.warnings[0]).toMatch(/&0100/);
    expect(image.warnings[0]).toMatch(/truncated/);
  });

  it('says so when a UEF carries nothing at all', () => {
    expect(readUef(new Uint8Array(HEADER)).warnings).toEqual(['This UEF carries no chunks at all.']);
  });
});

describe('writeUef', () => {
  it('reproduces a file byte for byte when nothing has been changed', () => {
    const original = uef(
      chunk(0x0000, [...new TextEncoder().encode('origin text')]),
      /* An identifier this build models nothing about, which is the point. */
      chunk(0x7f42, [0xde, 0xad, 0xbe, 0xef]),
      chunk(0x0100, [0x2a, 0x00, 0xff]),
    );
    expect([...writeUef(readUef(original))]).toEqual([...original]);
  });

  it('carries a trailing fragment rather than discarding it', () => {
    const withTail = new Uint8Array([...uef(chunk(0x0000, [1])), 0x99, 0x88]);
    const image = readUef(withTail);
    expect([...image.trailing]).toEqual([0x99, 0x88]);
    expect([...writeUef(image)]).toEqual([...withTail]);
  });

  it('writes a length that spans more than two bytes', () => {
    const big = new Array(0x10001).fill(0x5a);
    const original = uef(chunk(0x0102, big));
    const image = readUef(original);
    expect(image.chunks[0]!.data.length).toBe(0x10001);
    expect([...writeUef(image)]).toEqual([...original]);
  });
});

describe('replaceUefChunk', () => {
  it('changes one chunk and leaves every other byte alone', () => {
    const image = readUef(uef(chunk(0x7f42, [1, 2, 3]), chunk(0x0100, [9]), chunk(0x7f43, [4, 5])));
    const edited = replaceUefChunk(image, 1, new Uint8Array([7, 7, 7]));
    const bytes = writeUef(edited);
    const reread = readUef(bytes);
    expect(reread.chunks.map((entry) => entry.id)).toEqual([0x7f42, 0x0100, 0x7f43]);
    expect([...reread.chunks[0]!.data]).toEqual([1, 2, 3]);
    expect([...reread.chunks[1]!.data]).toEqual([7, 7, 7]);
    expect([...reread.chunks[2]!.data]).toEqual([4, 5]);
  });

  it('does not mutate the image it was given', () => {
    const image = readUef(uef(chunk(0x0100, [9])));
    replaceUefChunk(image, 0, new Uint8Array([1, 2, 3]));
    expect([...image.chunks[0]!.data]).toEqual([9]);
  });

  it('says how many chunks there are when asked for one that is not there', () => {
    const image = readUef(uef(chunk(0x0100, [9])));
    expect(() => replaceUefChunk(image, 3, new Uint8Array())).toThrow(/has 1 chunks, so there is no chunk 3/);
  });
});

describe('describeUef', () => {
  it('reports identifiers and sizes without claiming to know what they mean', () => {
    const image = readUef(uef(chunk(0x0100, [1, 2]), chunk(0x0000, [3]), chunk(0x0100, [4, 5, 6])));
    expect(describeUef(image)).toEqual([
      { id: '&0000', bytes: 1, count: 1 },
      { id: '&0100', bytes: 5, count: 2 },
    ]);
  });
});
