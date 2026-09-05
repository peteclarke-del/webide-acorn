/*
 * The catalogue an S, M or L disc carries, and how its sectors are found.
 *
 * These are the ADFS discs that predate the Archimedes: an old free-space map,
 * which this build already reads for D-format discs, and an *old* directory,
 * which it did not read at all. The two are independent — D format pairs the old
 * map with the new 77-entry directory — so the only thing missing was this.
 *
 * None of it is written from recollection. RISC OS 3.11 was booted on this
 * build's own pinned A310 core, told to format an L disc, given files and
 * subdirectories, told to list them, and then dismounted so that everything it
 * held was on the disc rather than in its cache. The image was read back out of
 * the emulator and every field below is what was found in it, against a listing
 * the machine itself printed. `adfsOldMeasurements.ts` keeps the sectors.
 *
 * Two things that measurement settled which no amount of care would have:
 *
 * The attributes are not a byte. They are the top bits of the first four
 * characters of the name — read, write, locked, directory — so a reader that
 * took the name as ASCII would produce `\xe1\xecpha` for a file called `alpha`
 * and lose the attributes entirely.
 *
 * And a double-sided image is interleaved. ADFS numbers L-format sectors
 * through all eighty tracks of side 0 and then all eighty of side 1, while the
 * image stores them track by track with both sides together. A directory near
 * the start therefore lands where a naive reader expects and one further in does
 * not, which is exactly the bug that looks like a corrupt disc rather than a
 * wrong offset. Five directories spread across a disc confirmed the mapping.
 */

export const OLD_DIRECTORY_BYTES = 1280;
export const OLD_DIRECTORY_SECTORS = 5;
export const OLD_DIRECTORY_ENTRIES = 47;
export const OLD_ENTRY_BYTES = 26;
/** Where the root directory lives on every one of these discs. */
export const OLD_ROOT_SECTOR = 2;

const HEADER_BYTES = 5;
const TAIL_OFFSET = HEADER_BYTES + OLD_ENTRY_BYTES * OLD_DIRECTORY_ENTRIES;
const SIGNATURE = 'Hugo';

export interface OldDiscGeometry {
  sectorsPerTrack: number;
  tracks: number;
  sides: number;
}

export interface OldDirectoryEntry {
  name: string;
  loadAddress: number;
  executionAddress: number;
  length: number;
  /** Logical sector the object starts at, which is not a byte offset. */
  startSector: number;
  readable: boolean;
  writable: boolean;
  locked: boolean;
  directory: boolean;
  /** Present only where the load address carries one, as `&FFFxxx00`. */
  filetype?: number;
}

export interface OldDirectory {
  /** The directory's own name, from its tail. */
  name: string;
  title: string;
  /** Logical sector of the parent; the root is its own parent. */
  parentSector: number;
  sequence: number;
  entries: OldDirectoryEntry[];
  /*
   * The byte the machine stored, and nothing more is claimed about it.
   *
   * Every other structure here is verified: both signatures, the sequence
   * number appearing identically at each end, and the free-space map's own
   * checksums, which this build already computes and which reproduce these
   * discs exactly. This one is recorded and not checked, because the algorithm
   * that produces it was not established. A broad search over accumulator
   * shapes — forward and reverse, with and without carry, with and without a
   * rotate, over every plausible range — reproduced none of the twelve
   * directories measured across four discs. Checking it against a guess would
   * be worse than not checking it: it would reject good discs and say they were
   * damaged.
   */
  storedCheckByte: number;
}

/** How many sectors a geometry holds, which is what bounds a logical address. */
export function oldSectorCount(geometry: OldDiscGeometry): number {
  return geometry.sectorsPerTrack * geometry.tracks * geometry.sides;
}

/**
 * Where a logical sector sits in an image.
 *
 * On a single-sided disc these are the same number. On a double-sided one they
 * are not, and the difference is the whole of why an L disc read naively looks
 * corrupt after the first track.
 *
 * A logical sector past the end of the disc is refused rather than wrapped. It
 * has to be: the mapping shuffles, so sector 2560 of a 2560-sector disc lands
 * on file sector 32, which is a real sector holding somebody else's data. A
 * bounds check on the file offset alone would let that through and the reader
 * would return the wrong bytes without complaint.
 */
export function oldImageSector(logical: number, geometry: OldDiscGeometry): number {
  if (!Number.isInteger(logical) || logical < 0 || logical >= oldSectorCount(geometry)) {
    throw new Error(`Sector ${logical} is not on a disc of ${oldSectorCount(geometry)} sectors, so this catalogue points off the disc.`);
  }
  const perSide = geometry.sectorsPerTrack * geometry.tracks;
  const side = Math.floor(logical / perSide);
  const within = logical % perSide;
  const track = Math.floor(within / geometry.sectorsPerTrack);
  return track * geometry.sectorsPerTrack * geometry.sides + side * geometry.sectorsPerTrack + (within % geometry.sectorsPerTrack);
}

/** A run of logical sectors, gathered in the order the disc numbers them. */
export function readOldSectors(image: Uint8Array, logical: number, count: number, geometry: OldDiscGeometry, sectorBytes = 256): Uint8Array {
  const out = new Uint8Array(count * sectorBytes);
  for (let index = 0; index < count; index += 1) {
    const at = oldImageSector(logical + index, geometry) * sectorBytes;
    if (at + sectorBytes > image.length) throw new Error(`Sector ${logical + index} lies past the end of this image, so the catalogue points outside the disc.`);
    out.set(image.subarray(at, at + sectorBytes), index * sectorBytes);
  }
  return out;
}

const text = (bytes: Uint8Array): string => String.fromCharCode(...bytes);

/**
 * Read one old directory.
 *
 * Refuses rather than guesses: a directory without both signatures, or whose
 * sequence number differs between its head and its tail, is not one of these
 * and reading it would produce names and lengths that are not on the disc.
 */
export function parseOldDirectory(directory: Uint8Array, path: string): OldDirectory {
  if (directory.length !== OLD_DIRECTORY_BYTES) throw new Error(`An old ADFS directory is ${OLD_DIRECTORY_BYTES} bytes and ${path} is ${directory.length}.`);
  const head = text(directory.subarray(1, 5));
  const tail = text(directory.subarray(TAIL_OFFSET + 0x30, TAIL_OFFSET + 0x34));
  if (head !== SIGNATURE || tail !== SIGNATURE) throw new Error(`${path} does not carry the ${SIGNATURE} signature at both ends, so it is not an old ADFS directory.`);
  const sequence = directory[0]!;
  if (directory[TAIL_OFFSET + 0x2f] !== sequence) throw new Error(`${path} was written with a sequence number of ${sequence} and closed with ${directory[TAIL_OFFSET + 0x2f]}, so it was caught half-written.`);

  const entries: OldDirectoryEntry[] = [];
  for (let index = 0; index < OLD_DIRECTORY_ENTRIES; index += 1) {
    const offset = HEADER_BYTES + index * OLD_ENTRY_BYTES;
    if (directory[offset] === 0) break;
    const raw = directory.subarray(offset, offset + 10);
    const name = text(raw.map((value) => value & 0x7f)).split('\r')[0]!.trimEnd();
    const loadAddress = u32(directory, offset + 0x0a);
    entries.push({
      name,
      loadAddress,
      executionAddress: u32(directory, offset + 0x0e),
      length: u32(directory, offset + 0x12),
      startSector: u24(directory, offset + 0x16),
      /* The attributes live in the top bits of the name, one per character. */
      readable: (raw[0]! & 0x80) !== 0,
      writable: (raw[1]! & 0x80) !== 0,
      locked: (raw[2]! & 0x80) !== 0,
      directory: (raw[3]! & 0x80) !== 0,
      ...((loadAddress >>> 20) === 0xfff ? { filetype: (loadAddress >>> 8) & 0xfff } : {}),
    });
  }

  return {
    name: text(directory.subarray(TAIL_OFFSET + 0x01, TAIL_OFFSET + 0x0b)).split('\r')[0]!.trimEnd(),
    parentSector: u24(directory, TAIL_OFFSET + 0x0b),
    title: text(directory.subarray(TAIL_OFFSET + 0x0e, TAIL_OFFSET + 0x21)).split('\r')[0]!.trimEnd(),
    sequence,
    entries,
    storedCheckByte: directory[OLD_DIRECTORY_BYTES - 1]!,
  };
}

/** The disc name, which the map splits alternately between its two sectors. */
export function oldDiscName(image: Uint8Array): string {
  let name = '';
  for (let index = 0; index < 5; index += 1) {
    name += String.fromCharCode(image[0xf7 + index]!, image[0x1f6 + index]!);
  }
  return name.replace(/\0+$/, '').trimEnd();
}

function u24(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}
