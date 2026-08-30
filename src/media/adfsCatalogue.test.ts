import { describe, expect, it } from 'vitest';
import { adfsDirectoryCheckByte, adfsNewMapZoneCheckByte, extractAdfsFile, parseAdfsCatalogue } from './adfsCatalogue';

function fixture(): Uint8Array {
  const image = new Uint8Array(800 * 1024);
  const root = 0x400;
  const tail = root + 5 + 77 * 26;
  image[root] = 0x12;
  image.set(new TextEncoder().encode('Nick'), root + 1);
  image.set(new TextEncoder().encode('!Demo'), root + 5);
  image.set([0x34, 0x12, 0xff, 0xff], root + 5 + 0x0a);
  image.set([0x78, 0x56, 0x34, 0x12], root + 5 + 0x0e);
  image.set([0x20, 0, 0, 0], root + 5 + 0x12);
  image.set([3, 2, 1], root + 5 + 0x16);
  image[root + 5 + 0x19] = 0x07;
  image.set(new TextEncoder().encode('Demo disc'), tail + 0x06);
  image.set(new TextEncoder().encode('$'), tail + 0x19);
  image[tail + 0x23] = 0x12;
  image.set(new TextEncoder().encode('Nick'), tail + 0x24);
  image[root + 0x7ff] = adfsDirectoryCheckByte(image.subarray(root, root + 0x800));
  image.set([0x80, 0x0c, 0x00], 0xfc);
  image[0xff] = mapChecksum(image, 0);
  image[0x1ff] = mapChecksum(image, 0x100);
  return image;
}

function mapChecksum(image: Uint8Array, start: number): number {
  let sum = 0; let carry = 0;
  for (let offset = start + 0xfe; offset >= start; offset -= 1) { const total = sum + carry + image[offset]!; sum = total & 0xff; carry = total > 0xff ? 1 : 0; }
  return sum;
}

describe('ADFS D root catalogue reader', () => {
  it('decodes a bounded new-directory root without mutating the image', () => {
    const image = fixture();
    const before = image.slice();
    expect(parseAdfsCatalogue(image)).toEqual({
      format: 'ADFS D', title: 'Demo disc', name: '$', sequence: 0x12, warnings: [],
      entries: [{ name: '!Demo', path: '$.!Demo', loadAddress: 0xffff1234, executionAddress: 0x12345678, length: 32, discAddress: 0x010203, attributes: 0x07, directory: false, locked: true, filetype: 0xf12 }],
    });
    expect(image.every((byte, index) => byte === before[index])).toBe(true);
  });

  it('rejects the wrong geometry and missing D-format directory signatures', () => {
    expect(() => parseAdfsCatalogue(new Uint8Array(640 * 1024))).toThrow('exactly 800 KiB');
    const image = fixture(); image[0x401] = 0;
    expect(() => parseAdfsCatalogue(image)).toThrow('signatures');
    const damaged = fixture(); damaged[0x405] = damaged[0x405]! ^ 1;
    expect(() => parseAdfsCatalogue(damaged)).toThrow('checksum');
    const damagedMap = fixture(); damagedMap[0x10] = 1;
    expect(() => parseAdfsCatalogue(damagedMap)).toThrow('free-space map checksum');
  });

  it('reports sequence, tail and duplicate-name damage without hiding readable entries', () => {
    const image = fixture();
    const root = 0x400; const tail = root + 5 + 77 * 26; const second = root + 5 + 26;
    image.set(new TextEncoder().encode('!Demo'), second);
    image[second + 0x19] = 0x03;
    image[tail] = 1; image[tail + 1] = 1; image[tail + 0x23] = 0x13;
    image[root + 0x7ff] = adfsDirectoryCheckByte(image.subarray(root, root + 0x800));
    const parsed = parseAdfsCatalogue(image);
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('sequence'), expect.stringContaining('end marker'), expect.stringContaining('reserved'), expect.stringContaining('Duplicate'),
    ]));
  });

  it('traverses D-format subdirectories and extracts an exact file extent', () => {
    const image = fixture(); const root = 0x400; const rootEntry = root + 5;
    image.set([0, 8, 0, 0], rootEntry + 0x12); image.set([0x10, 0, 0], rootEntry + 0x16); image[rootEntry + 0x19] = 0x0f;
    image[root + 0x7ff] = adfsDirectoryCheckByte(image.subarray(root, root + 0x800));
    const child = 0x1000; const tail = child + 5 + 77 * 26;
    image[child] = 3; image.set(new TextEncoder().encode('Nick'), child + 1); image.set(new TextEncoder().encode('Child'), child + 5);
    image.set([4, 0, 0, 0], child + 5 + 0x12); image.set([0x20, 0, 0], child + 5 + 0x16); image[child + 5 + 0x19] = 0x03;
    image.set(new TextEncoder().encode('Subdirectory'), tail + 0x06); image.set(new TextEncoder().encode('!Demo'), tail + 0x19); image[tail + 0x23] = 3; image.set(new TextEncoder().encode('Nick'), tail + 0x24);
    image[child + 0x7ff] = adfsDirectoryCheckByte(image.subarray(child, child + 0x800)); image.set(new TextEncoder().encode('DATA'), 0x2000);
    const parsed = parseAdfsCatalogue(image); const file = parsed.entries[0]!.children?.[0];
    expect(file).toMatchObject({ path: '$.!Demo.Child', directory: false, length: 4 });
    expect(new TextDecoder().decode(extractAdfsFile(image, file!))).toBe('DATA');
  });

  it('decodes the standard one-zone ADFS E geometry used by RISC OS floppies', () => {
    const oldMap = fixture();
    const image = new Uint8Array(800 * 1024);
    image.set(oldMap.subarray(0x400, 0xc00), 0x800);
    image[4] = 10; image[5] = 5; image[6] = 2; image[7] = 2; image[8] = 15; image[9] = 7; image[13] = 1;
    image.set([3, 2, 0, 0], 0x10);
    image.set([0, 128, 12, 0], 0x14);
    image.set([17, 0, 0, 0], 0x800 + 5 + 0x12);
    image.set([1, 3, 0], 0x800 + 5 + 0x16);
    image[0x800 + 5 + 0x19] = 0x03;
    setBits(image, 0x40 * 8, 15, 2); setBits(image, 0x40 * 8 + 31, 1, 1);
    setBits(image, 0x40 * 8 + 32, 15, 3); setBits(image, 0x40 * 8 + 47, 1, 1);
    image.set(new TextEncoder().encode('ADFS E extraction'), 0x1000);
    image[0x800 + 0x7ff] = adfsDirectoryCheckByte(image.subarray(0x800, 0x1000));
    image[0] = adfsNewMapZoneCheckByte(image, 1024);
    const parsed = parseAdfsCatalogue(image);
    expect(parsed).toMatchObject({ format: 'ADFS E', title: 'Demo disc', name: '$', entries: [{ name: '!Demo', path: '$.!Demo', discAddress: 0x301 }], warnings: [] });
    expect(new TextDecoder().decode(extractAdfsFile(image, parsed.entries[0]!))).toBe('ADFS E extraction');
    image[0x40] = image[0x40]! ^ 1;
    expect(() => parseAdfsCatalogue(image)).toThrow('allocation-map checksum');
  });
});

function setBits(image: Uint8Array, position: number, length: number, value: number): void {
  for (let index = 0; index < length; index += 1) {
    const mask = 1 << ((position + index) & 7);
    const byte = (position + index) >> 3;
    image[byte] = (value >> index) & 1 ? image[byte]! | mask : image[byte]! & ~mask;
  }
}
