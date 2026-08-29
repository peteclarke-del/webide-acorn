import { describe, expect, it } from 'vitest';
import { packBbcMode5Pixels, packOpaqueMask, packTwoBitPixels, unpackBbcMode5Pixels, unpackTwoBitPixels } from './pixelPacking';

describe('packTwoBitPixels', () => {
  it('packs four palette indices most-significant pixel first', () => {
    expect(Array.from(packTwoBitPixels([0, 1, 2, 3]))).toEqual([0x1b]);
  });

  it('masks palette values and pads incomplete bytes with zero', () => {
    expect(Array.from(packTwoBitPixels([3, 4, 5, 6, 7]))).toEqual([0xc6, 0xc0]);
  });
});

describe('packBbcMode5Pixels', () => {
  it('places the two colour bits in the BBC hardware bit planes', () => {
    expect(Array.from(packBbcMode5Pixels([0, 1, 2, 3]))).toEqual([0x35]);
    expect(Array.from(packBbcMode5Pixels([3, 0, 0, 0]))).toEqual([0x88]);
  });
});

describe('packOpaqueMask', () => {
  it('packs one-is-opaque mask pixels most-significant bit first', () => {
    expect(Array.from(packOpaqueMask([1, 0, 1, 0, 0, 1, 0, 1, 1]))).toEqual([0xa5, 0x80]);
  });
});

describe('packing inverses', () => {
  const every2bpp = Array.from({ length: 256 }, (_, index) => index);

  it('round-trips every byte through the portable logical packing', () => {
    expect(Array.from(packTwoBitPixels(unpackTwoBitPixels(every2bpp)))).toEqual(every2bpp);
  });

  it('round-trips every byte through the BBC MODE 5 hardware packing', () => {
    expect(Array.from(packBbcMode5Pixels(unpackBbcMode5Pixels(every2bpp)))).toEqual(every2bpp);
  });

  it('recovers the pixel colours the MODE 5 packer split across nibbles', () => {
    const pixels = [0, 1, 2, 3, 3, 2, 1, 0];
    expect(unpackBbcMode5Pixels(packBbcMode5Pixels(pixels))).toEqual(pixels);
    expect(unpackTwoBitPixels(packTwoBitPixels(pixels))).toEqual(pixels);
  });
});
