export function packTwoBitPixels(pixels: readonly number[]): Uint8Array {
  return Uint8Array.from(
    Array.from({ length: Math.ceil(pixels.length / 4) }, (_, byteIndex) =>
      [0, 1, 2, 3].reduce(
        (byte, offset) => byte | (((pixels[byteIndex * 4 + offset] ?? 0) & 3) << (6 - offset * 2)),
        0,
      ),
    ),
  );
}

/** BBC Micro MODE 5 hardware layout: colour bit 1 occupies bits 7..4 and bit 0 bits 3..0. */
export function packBbcMode5Pixels(pixels: readonly number[]): Uint8Array {
  return Uint8Array.from(
    Array.from({ length: Math.ceil(pixels.length / 4) }, (_, byteIndex) =>
      [0, 1, 2, 3].reduce((byte, offset) => {
        const colour = (pixels[byteIndex * 4 + offset] ?? 0) & 3;
        return byte | ((colour & 2) << (6 - offset)) | ((colour & 1) << (3 - offset));
      }, 0),
    ),
  );
}

export function packOpaqueMask(mask: readonly number[]): Uint8Array {
  return Uint8Array.from(Array.from({ length: Math.ceil(mask.length / 8) }, (_, byteIndex) =>
    Array.from({ length: 8 }, (__, offset) => mask[byteIndex * 8 + offset] === 1 ? 1 << (7 - offset) : 0).reduce((byte, bit) => byte | bit, 0)));
}

/* Inverses of the packers above. Both packings are bijective over whole bytes,
 * so unpacking then repacking a byte run reproduces it exactly. Import paths
 * rely on that: a pixel asset derived from existing assembler data must
 * regenerate the original bytes rather than an approximation of them. */
export function unpackTwoBitPixels(bytes: Uint8Array | readonly number[]): number[] {
  return Array.from(bytes).flatMap((byte) => [0, 1, 2, 3].map((offset) => (byte >> (6 - offset * 2)) & 3));
}

export function unpackBbcMode5Pixels(bytes: Uint8Array | readonly number[]): number[] {
  return Array.from(bytes).flatMap((byte) => [0, 1, 2, 3].map((offset) =>
    (((byte >> (7 - offset)) & 1) << 1) | ((byte >> (3 - offset)) & 1)));
}
