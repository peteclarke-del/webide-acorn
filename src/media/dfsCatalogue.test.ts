import { describe, expect, it } from 'vitest';
import { extractDfsFile, parseDfsCatalogue } from './dfsCatalogue';

function fixture() {
  const image = new Uint8Array(800 * 256);
  image.set(Array.from('DEMO    ').map((char) => char.charCodeAt(0)), 0);
  image.set(Array.from('DISK').map((char) => char.charCodeAt(0)), 256);
  image[260] = 7;
  image[261] = 8;
  image[262] = 0x23;
  image[263] = 0x20;
  image.set(Array.from('HELLO  ').map((char) => char.charCodeAt(0)), 8);
  image[15] = 0x80 | '$'.charCodeAt(0);
  image[264] = 0x00; image[265] = 0x19;
  image[266] = 0x23; image[267] = 0x19;
  image[268] = 0x2c; image[269] = 0x01;
  image[270] = 0x00; image[271] = 0x02;
  return image;
}

describe('DFS SSD catalogue reader', () => {
  it('decodes disk metadata and file addresses without mutating the image', () => {
    const image = fixture();
    const before = image.slice();
    const result = parseDfsCatalogue(image);
    expect(result).toMatchObject({ title: 'DEMO    DISK', cycle: 7, bootOption: 2, declaredSectors: 800, imageSectors: 800, warnings: [] });
    expect(result.files).toEqual([{ name: 'HELLO', directory: '$', locked: true, loadAddress: 0x1900, executionAddress: 0x1923, length: 300, startSector: 2 }]);
    expect(image.every((byte, index) => byte === before[index])).toBe(true);
  });

  it('rejects truncated, unaligned and impossible catalogues', () => {
    expect(() => parseDfsCatalogue(new Uint8Array(511))).toThrow('at least two');
    expect(() => parseDfsCatalogue(new Uint8Array(513))).toThrow('whole number');
    const invalid = new Uint8Array(512); invalid[261] = 7;
    expect(() => parseDfsCatalogue(invalid)).toThrow('file-count');
  });

  it('reports geometry and file extent problems as non-destructive warnings', () => {
    const image = fixture(); image[263] = 0x90;
    const result = parseDfsCatalogue(image);
    expect(result.warnings.some((warning) => warning.includes('declares'))).toBe(true);
  });

  it('reports catalogue and inter-file extent overlap without trusting file order', () => {
    const image = fixture();
    image[261] = 16;
    image.set(Array.from('SECOND ').map((char) => char.charCodeAt(0)), 16);
    image[23] = '$'.charCodeAt(0);
    image[272] = 0x00; image[273] = 0x20;
    image[274] = 0x00; image[275] = 0x20;
    image[276] = 0x01; image[277] = 0x00;
    image[278] = 0x00; image[279] = 0x02;
    expect(parseDfsCatalogue(image).warnings.some((warning) => warning.includes('overlaps $.HELLO'))).toBe(true);
    image[279] = 0x01;
    expect(parseDfsCatalogue(image).warnings.some((warning) => warning.includes('catalogue sectors'))).toBe(true);
  });

  it('extracts only a catalogue-owned bounded extent', () => {
    const image = fixture(); image.fill(0x41, 512, 812);
    const entry = parseDfsCatalogue(image).files[0]!;
    expect(extractDfsFile(image, entry)).toEqual(new Uint8Array(300).fill(0x41));
    expect(() => extractDfsFile(image, { ...entry, startSector: 799 })).toThrow('does not belong');
  });
});
