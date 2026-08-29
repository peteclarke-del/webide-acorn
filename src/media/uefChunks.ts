/* Reading a UEF as the chunk list it is, and writing it back unchanged.
 *
 * The cassette adapter recognised a UEF and did nothing else with it. That is
 * enough to hand one to an emulator and not enough to edit one, and the moment
 * anything edits one the same question arises that DFS and ADFS already answer:
 * what happens to the parts this build does not model?
 *
 * A UEF is a header and then a sequence of chunks, each an identifier, a length
 * and that many bytes. The structure is all this module claims to know. It does
 * not claim to know what any particular chunk means — a UEF carries origin
 * text, inlay scans, position markers and tone data among other things, and
 * asserting a meaning this build has not implemented would be inventing detail
 * about somebody's tape.
 *
 * So every chunk is carried, and a file that has not been changed is rewritten
 * byte for byte. When a later feature models a chunk it can change that one and
 * the rest still survive, which is the property that makes editing safe rather
 * than the property that makes it possible.
 */

const UEF_SIGNATURE = [0x55, 0x45, 0x46, 0x20, 0x46, 0x69, 0x6c, 0x65, 0x21, 0x00];
const HEADER_BYTES = 12;

/** A UEF is frequently stored gzip-compressed, and that is not a damaged file. */
const GZIP_MAGIC = [0x1f, 0x8b];

export interface UefChunk {
  /** The chunk identifier, as the file records it. */
  id: number;
  /** The chunk's payload. Carried, not interpreted. */
  data: Uint8Array;
  /** Where the chunk started in the file it was read from. */
  offset: number;
}

export interface UefImage {
  /** Major and minor version from the header, carried as read. */
  minorVersion: number;
  majorVersion: number;
  chunks: UefChunk[];
  /**
   * Anything after the last complete chunk. A file can carry a trailing
   * fragment, and dropping it would change the file.
   */
  trailing: Uint8Array;
  /** What was odd about the file, each stated rather than silently accepted. */
  warnings: string[];
}

export class UefError extends Error {
  constructor(message: string) { super(message); this.name = 'UefError'; }
}

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && GZIP_MAGIC.every((byte, index) => bytes[index] === byte);
}

/**
 * Read the chunk structure of a UEF.
 *
 * A compressed file is reported as compressed rather than as unrecognised,
 * because those are different problems and only one of them means the file is
 * wrong.
 */
export function readUef(bytes: Uint8Array): UefImage {
  if (isGzip(bytes)) {
    throw new UefError('This UEF is gzip-compressed. Decompress it first; a compressed file is not a damaged one, and this reader works on the plain form.');
  }
  if (bytes.length < HEADER_BYTES || !UEF_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    throw new UefError('This file does not begin with a UEF header, so it is not a UEF.');
  }

  const warnings: string[] = [];
  const chunks: UefChunk[] = [];
  let offset = HEADER_BYTES;
  while (offset + 6 <= bytes.length) {
    const id = bytes[offset]! | (bytes[offset + 1]! << 8);
    const length = (bytes[offset + 2]! | (bytes[offset + 3]! << 8) | (bytes[offset + 4]! << 16) | (bytes[offset + 5]! << 24)) >>> 0;
    const start = offset + 6;
    if (start + length > bytes.length) {
      warnings.push(`Chunk &${id.toString(16).toUpperCase().padStart(4, '0')} at byte ${offset} declares ${length.toLocaleString()} bytes and the file has ${(bytes.length - start).toLocaleString()} left, so the file is truncated.`);
      break;
    }
    chunks.push({ id, data: bytes.slice(start, start + length), offset });
    offset = start + length;
  }
  if (!chunks.length) warnings.push('This UEF carries no chunks at all.');

  return {
    minorVersion: bytes[10] ?? 0,
    majorVersion: bytes[11] ?? 0,
    chunks,
    trailing: bytes.slice(offset),
    warnings,
  };
}

/**
 * Write a chunk list back out.
 *
 * Nothing is normalised, reordered or omitted. A chunk this build does not
 * understand goes back exactly as it came in, at the same point in the
 * sequence, because its position in the file is part of what it means on a
 * tape.
 */
export function writeUef(image: UefImage): Uint8Array {
  const size = HEADER_BYTES
    + image.chunks.reduce((total, chunk) => total + 6 + chunk.data.length, 0)
    + image.trailing.length;
  const bytes = new Uint8Array(size);
  bytes.set(UEF_SIGNATURE, 0);
  bytes[10] = image.minorVersion & 0xff;
  bytes[11] = image.majorVersion & 0xff;

  let offset = HEADER_BYTES;
  for (const chunk of image.chunks) {
    bytes[offset] = chunk.id & 0xff;
    bytes[offset + 1] = (chunk.id >>> 8) & 0xff;
    const length = chunk.data.length;
    bytes[offset + 2] = length & 0xff;
    bytes[offset + 3] = (length >>> 8) & 0xff;
    bytes[offset + 4] = (length >>> 16) & 0xff;
    bytes[offset + 5] = (length >>> 24) & 0xff;
    bytes.set(chunk.data, offset + 6);
    offset += 6 + length;
  }
  bytes.set(image.trailing, offset);
  return bytes;
}

/**
 * What a UEF contains, by chunk, without claiming to know what any of it means.
 *
 * Useful because a person looking at a tape image wants to see that it has
 * something in it and roughly what shape, and a list of identifiers and sizes
 * says that honestly where an invented description would not.
 */
export function describeUef(image: UefImage): Array<{ id: string; bytes: number; count: number }> {
  const byId = new Map<number, { bytes: number; count: number }>();
  for (const chunk of image.chunks) {
    const entry = byId.get(chunk.id) ?? { bytes: 0, count: 0 };
    entry.bytes += chunk.data.length;
    entry.count += 1;
    byId.set(chunk.id, entry);
  }
  return [...byId.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([id, entry]) => ({ id: `&${id.toString(16).toUpperCase().padStart(4, '0')}`, ...entry }));
}

/**
 * Replace one chunk, leaving every other byte of the file alone.
 *
 * The only editing operation offered, because it is the only one that can be
 * performed without knowing what the surrounding chunks mean.
 */
export function replaceUefChunk(image: UefImage, index: number, data: Uint8Array): UefImage {
  if (!Number.isInteger(index) || index < 0 || index >= image.chunks.length) {
    throw new UefError(`This UEF has ${image.chunks.length} chunks, so there is no chunk ${index} to replace.`);
  }
  return {
    ...image,
    chunks: image.chunks.map((chunk, position) => position === index ? { ...chunk, data: data.slice() } : chunk),
  };
}
