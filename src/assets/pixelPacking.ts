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


/*
 * The layout BBC sprite and screen data is actually written in.
 *
 * The two packings above describe how four pixels sit inside one byte. They say
 * nothing about the order the bytes come in, and both callers assumed the
 * obvious one: byte 0 is the leftmost four pixels of row 0, byte 1 the next
 * four, and so on to the end of the row. The BBC does not store a picture that
 * way. Its display memory is a series of eight-scanline blocks — one byte per
 * scanline, eight bytes for a four-pixel-wide column, then the next column
 * across, and only after a whole band of eight rows does it move down.
 *
 * Every generator that targets the machine emits that order, because it is what
 * the hardware reads and what a blitter copies. Reading a real game's sprites
 * as linear rows produced a recognisable figure sliced into vertical strips and
 * shuffled, which is what "it is not reading the sprite data correctly" looks
 * like from the outside.
 *
 * Both functions are inverses over any picture whose width is a multiple of
 * four pixels and whose height is a multiple of eight rows. Anything else is
 * not expressible in this layout and is refused by the caller rather than
 * silently reshaped.
 */
export const SCREEN_BLOCK_ROWS = 8;
export const SCREEN_BLOCK_COLUMNS = 4;

export function fitsScreenBlocks(width: number, height: number): boolean {
  return width % SCREEN_BLOCK_COLUMNS === 0 && height % SCREEN_BLOCK_ROWS === 0;
}

/** Byte positions in screen order, one per group of four pixels. */
function screenBlockOrder(width: number, height: number): Array<{ x: number; y: number }> {
  const order: Array<{ x: number; y: number }> = [];
  for (let band = 0; band < height; band += SCREEN_BLOCK_ROWS) {
    for (let column = 0; column < width; column += SCREEN_BLOCK_COLUMNS) {
      for (let row = band; row < band + SCREEN_BLOCK_ROWS; row += 1) order.push({ x: column, y: row });
    }
  }
  return order;
}

export function unpackBbcScreenBlocks(bytes: Uint8Array | readonly number[], width: number, height: number): number[] | null {
  if (!fitsScreenBlocks(width, height)) return null;
  const order = screenBlockOrder(width, height);
  if (bytes.length !== order.length) return null;
  const pixels = new Array<number>(width * height).fill(0);
  order.forEach((at, index) => {
    const byte = bytes[index]!;
    for (let offset = 0; offset < SCREEN_BLOCK_COLUMNS; offset += 1) {
      pixels[at.y * width + at.x + offset] = (((byte >> (7 - offset)) & 1) << 1) | ((byte >> (3 - offset)) & 1);
    }
  });
  return pixels;
}

export function packBbcScreenBlocks(pixels: readonly number[], width: number, height: number): Uint8Array | null {
  if (!fitsScreenBlocks(width, height) || pixels.length !== width * height) return null;
  const order = screenBlockOrder(width, height);
  return Uint8Array.from(order.map((at) => {
    let byte = 0;
    for (let offset = 0; offset < SCREEN_BLOCK_COLUMNS; offset += 1) {
      const colour = (pixels[at.y * width + at.x + offset] ?? 0) & 3;
      byte |= ((colour & 2) << (6 - offset)) | ((colour & 1) << (3 - offset));
    }
    return byte;
  }));
}
