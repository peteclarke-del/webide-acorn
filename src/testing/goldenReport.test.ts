// @vitest-environment node

/* Two failures with identical pixel counts can have entirely different causes.
 * These check that the report tells them apart.
 */
import { describe, expect, it } from 'vitest';
import { compareAudioWrites, locateDifference } from './goldenReport';
import { bytesToBase64 } from './screenAssertion';

/** An opaque black image of the given size, with anything painted over it. */
function image(paint: (x: number, y: number) => [number, number, number] | null, size = 4): string {
  const bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const colour = paint(x, y) ?? [0, 0, 0];
      bytes[offset] = colour[0]; bytes[offset + 1] = colour[1]; bytes[offset + 2] = colour[2]; bytes[offset + 3] = 255;
    }
  }
  return bytesToBase64(bytes);
}

const black = image(() => null);

describe('where the difference is', () => {
  it('says the images agree when they do', () => {
    const located = locateDifference(black, black, 4, 4, 0);
    expect(located).toMatchObject({ bounds: null, worst: null, differingPixels: 0 });
    expect(located.summary).toMatch(/agree within the tolerance allowed/);
  });

  it('gives the smallest box holding every differing pixel', () => {
    const changed = image((x, y) => (x >= 1 && x <= 2 && y === 2 ? [255, 255, 255] : null));
    const located = locateDifference(black, changed, 4, 4, 0);
    expect(located.bounds).toEqual({ left: 1, top: 2, right: 2, bottom: 2, width: 2, height: 1 });
    expect(located.differingPixels).toBe(2);
  });

  it('points at the single worst pixel and how far out it is', () => {
    const changed = image((x, y) => (x === 3 && y === 0 ? [10, 0, 0] : x === 0 && y === 3 ? [200, 0, 0] : null));
    const located = locateDifference(black, changed, 4, 4, 0);
    expect(located.worst).toEqual({ x: 0, y: 3, channelDelta: 200 });
  });

  it('distinguishes something that moved wholesale from a thin scatter', () => {
    /* The number of differing pixels is identical in both; the shape is what
     * says which kind of failure this is. Sized 16 by 16 rather than 4 by 4
     * because on a four-pixel-wide image four corners genuinely are a quarter
     * of the box, and loosening the thresholds to make a toy fixture pass would
     * weaken the distinction on a real golden. */
    const bigBlack = image(() => null, 16);
    const solid = image((x, y) => (x <= 1 && y <= 1 ? [255, 255, 255] : null), 16);
    const scattered = image((x, y) => ((x === 0 && y === 0) || (x === 15 && y === 15) || (x === 15 && y === 0) || (x === 0 && y === 15) ? [255, 255, 255] : null), 16);

    const gathered = locateDifference(bigBlack, solid, 16, 16, 0);
    const spread = locateDifference(bigBlack, scattered, 16, 16, 0);
    expect(gathered.differingPixels).toBe(spread.differingPixels);
    expect(gathered.summary).toMatch(/gathered into one area/);
    expect(spread.summary).toMatch(/scattered thinly/);
    expect(gathered.density).toBeGreaterThan(spread.density);
  });

  it('honours the tolerance the assertion used, so both call the same pixels different', () => {
    const nearly = image((x, y) => (x === 0 && y === 0 ? [8, 0, 0] : null));
    expect(locateDifference(black, nearly, 4, 4, 8).differingPixels).toBe(0);
    expect(locateDifference(black, nearly, 4, 4, 7).differingPixels).toBe(1);
  });

  it('refuses images that are not the size they claim', () => {
    expect(() => locateDifference(black, black, 3, 3, 0)).toThrow(/is 36 bytes and these are 64/);
    expect(() => locateDifference(black, bytesToBase64(new Uint8Array(4)), 4, 4, 0)).toThrow(/not the same size/);
  });
});

describe('where the sound differs', () => {
  it('says both streams agree when they do', () => {
    expect(compareAudioWrites([0x9f, 0x80], [0x9f, 0x80])).toMatchObject({ firstDifferingIndex: null, differingWrites: 0 });
    expect(compareAudioWrites([1], [1]).summary).toMatch(/same 1 writes/);
  });

  it('points at the first write that differs, which points at the instruction', () => {
    const compared = compareAudioWrites([0x9f, 0x80, 0x00], [0x9f, 0x81, 0x00]);
    expect(compared.firstDifferingIndex).toBe(1);
    expect(compared.differingWrites).toBe(1);
    expect(compared.summary).toMatch(/first at index 1/);
  });

  it('tells a stream of a different length from one that says something else', () => {
    /* Driving the sound chip a different number of times is a different fault
     * from driving it the same number of times with different values. */
    expect(compareAudioWrites([1, 2, 3], [1, 2]).summary).toMatch(/driving the sound chip a different number of times/);
    expect(compareAudioWrites([1, 2, 3], [1, 9, 3]).summary).toMatch(/writing as often as before and writing something else/);
  });

  it('shows a few writes either side of the first difference', () => {
    const expected = Array.from({ length: 20 }, (_, index) => index);
    const actual = [...expected];
    actual[10] = 99;
    const compared = compareAudioWrites(expected, actual);
    expect(compared.context.map((entry) => entry.index)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(compared.context.find((entry) => entry.index === 10)).toEqual({ index: 10, expected: 10, actual: 99 });
  });

  it('shows a missing write as absent rather than as zero', () => {
    const compared = compareAudioWrites([1, 2, 3], [1]);
    expect(compared.context.find((entry) => entry.index === 1)).toEqual({ index: 1, expected: 2, actual: null });
  });
});
