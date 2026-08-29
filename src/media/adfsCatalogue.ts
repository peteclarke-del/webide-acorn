export interface AdfsFileEntry {
  name: string;
  path: string;
  loadAddress: number;
  executionAddress: number;
  length: number;
  discAddress: number;
  attributes: number;
  directory: boolean;
  locked: boolean;
  filetype?: number;
  children?: AdfsFileEntry[];
}

export interface AdfsCatalogue {
  format: 'ADFS D' | 'ADFS E';
  title: string;
  name: string;
  sequence: number;
  entries: AdfsFileEntry[];
  warnings: string[];
}

const D_IMAGE_SIZE = 800 * 1024;
const D_ROOT_OFFSET = 0x400;
const E_ROOT_OFFSET = 0x800;
const DIRECTORY_SIZE = 0x800;
const HEADER_SIZE = 5;
const ENTRY_SIZE = 26;
const MAX_ENTRIES = 77;
const MAX_DIRECTORY_DEPTH = 16;
const MAX_OBJECTS = 4096;

/**
 * Read one of ADFS's fixed-width text fields.
 *
 * Exported because the directory writer has to agree with this exactly: it
 * looks up an entry's preserved bytes by the name this produced, and a second
 * implementation that disagreed by one trailing space would silently fail to
 * find them. One decoder, used by both.
 */
export function adfsFieldText(bytes: Uint8Array): string {
  const end = bytes.findIndex((byte) => byte === 0 || byte === 13);
  const visible = end < 0 ? bytes : bytes.subarray(0, end);
  return String.fromCharCode(...visible).replace(/[\x00-\x1f\x7f]/g, '').trimEnd();
}

const text = adfsFieldText;

function u24(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

function rotateRight13(value: number): number {
  return ((value >>> 13) | (value << 19)) >>> 0;
}

function oldMapChecksum(image: Uint8Array, start: number): number {
  let sum = 0; let carry = 0;
  for (let offset = start + 0xfe; offset >= start; offset -= 1) {
    const total = sum + carry + image[offset]!;
    sum = total & 0xff;
    carry = total > 0xff ? 1 : 0;
  }
  return sum;
}

export function adfsNewMapZoneCheckByte(image: Uint8Array, sectorSize: number): number {
  const sum = [0, 0, 0, 0];
  let rover = sectorSize - 4;
  for (; rover > 0; rover -= 4) {
    sum[0] = sum[0]! + image[rover]! + (sum[3]! >>> 8); sum[3] = sum[3]! & 0xff;
    sum[1] = sum[1]! + image[rover + 1]! + (sum[0]! >>> 8); sum[0] = sum[0]! & 0xff;
    sum[2] = sum[2]! + image[rover + 2]! + (sum[1]! >>> 8); sum[1] = sum[1]! & 0xff;
    sum[3] = sum[3]! + image[rover + 3]! + (sum[2]! >>> 8); sum[2] = sum[2]! & 0xff;
  }
  sum[0] = sum[0]! + (sum[3]! >>> 8);
  sum[1] = sum[1]! + image[rover + 1]! + (sum[0]! >>> 8);
  sum[2] = sum[2]! + image[rover + 2]! + (sum[1]! >>> 8);
  sum[3] = sum[3]! + image[rover + 3]! + (sum[2]! >>> 8);
  return (sum[0]! ^ sum[1]! ^ sum[2]! ^ sum[3]!) & 0xff;
}

/** FileCore's new-directory checksum, kept separate for deterministic fixtures. */
export function adfsDirectoryCheckByte(directory: Uint8Array): number {
  if (directory.length !== DIRECTORY_SIZE) throw new Error('An ADFS new directory must be exactly 2 KiB');
  let check = 0;
  let last = HEADER_SIZE - ENTRY_SIZE;
  let offset = 0;
  do {
    last += ENTRY_SIZE;
    do {
      check = (u32(directory, offset) ^ rotateRight13(check)) >>> 0;
      offset += 4;
    } while (offset < (last & ~3));
  } while (directory[last] !== 0);
  while (offset < last) {
    check = (directory[offset]! ^ rotateRight13(check)) >>> 0;
    offset += 1;
  }
  for (offset = 2008; offset < 2044; offset += 4) check = (u32(directory, offset) ^ rotateRight13(check)) >>> 0;
  return (check ^ (check >>> 8) ^ (check >>> 16) ^ (check >>> 24)) & 0xff;
}

interface NewMapFragment { address: number; capacity: number }

function bit(image: Uint8Array, position: number): number {
  return (image[position >> 3]! >> (position & 7)) & 1;
}

function bits(image: Uint8Array, position: number, length: number): number {
  let value = 0;
  for (let index = 0; index < length; index += 1) value |= bit(image, position + index) << index;
  return value;
}

function newMapFragments(image: Uint8Array): Map<number, NewMapFragment[]> {
  const idLength = image[8]!;
  const bytesPerMapBit = 1 << image[9]!;
  const mapStart = 0x40 * 8;
  const usableBits = image.length / bytesPerMapBit;
  const mapSectorBits = (1 << image[4]!) * 8;
  if (idLength < 13 || idLength >= 22 || !Number.isInteger(usableBits) || usableBits <= 0 || mapStart + usableBits > mapSectorBits) throw new Error('ADFS E allocation-map geometry is invalid');
  const free = new Set<number>();
  const firstFreeLink = bits(image, 8, 16) & 0x7fff;
  if (firstFreeLink) {
    let freePointer = 8 + firstFreeLink;
    for (let guard = 0; guard <= usableBits; guard += 1) {
      const position = freePointer - mapStart;
      if (position < 0 || position >= usableBits || free.has(position)) throw new Error('ADFS E free-space chain is invalid');
      free.add(position);
      const link = bits(image, freePointer, idLength);
      if (!link) break;
      freePointer += link;
    }
  }
  const fragments = new Map<number, NewMapFragment[]>();
  for (let position = 0; position < usableBits;) {
    let length = idLength;
    while (position + length < usableBits && !bit(image, mapStart + position + length)) length += 1;
    if (position + length >= usableBits) length = usableBits - position;
    else length += 1;
    if (length <= 0) throw new Error('ADFS E allocation map contains a zero-length cell');
    if (!free.has(position)) {
      const fragmentId = bits(image, mapStart + position, idLength);
      if (fragmentId) fragments.set(fragmentId, [...(fragments.get(fragmentId) ?? []), { address: position * bytesPerMapBit, capacity: length * bytesPerMapBit }]);
    }
    position += length;
  }
  return fragments;
}

/** A contiguous run of image bytes belonging to one object. */
export interface AdfsExtent { start: number; length: number }

/*
 * Where an object's bytes actually live.
 *
 * Split out from reading them because writing one back has to visit exactly the
 * same runs in exactly the same order. An ADFS E object can be scattered across
 * several fragments, and a writer that worked that out for itself would be a
 * second answer to a question that already has one — which is how a file comes
 * back correct from a read and corrupt from a write.
 */
function objectExtents(image: Uint8Array, format: AdfsCatalogue['format'], entry: Pick<AdfsFileEntry, 'discAddress' | 'length'>, fragments?: Map<number, NewMapFragment[]>): AdfsExtent[] {
  if (entry.length === 0) return [];
  if (entry.length > image.length) throw new Error('ADFS object length exceeds the image');
  if (format === 'ADFS D') {
    const start = entry.discAddress * 256;
    if (start + entry.length > image.length) throw new Error(`ADFS D object at sector ${entry.discAddress} extends beyond the image`);
    return [{ start, length: entry.length }];
  }
  const fragmentId = entry.discAddress >>> 8;
  let skip = (entry.discAddress & 0xff) ? ((entry.discAddress & 0xff) - 1) * (1 << image[4]!) : 0;
  const chain = fragments?.get(fragmentId);
  if (!chain?.length) throw new Error(`ADFS E fragment &${fragmentId.toString(16).toUpperCase()} is not allocated`);
  const extents: AdfsExtent[] = [];
  let covered = 0;
  for (const fragment of chain) {
    if (skip >= fragment.capacity) { skip -= fragment.capacity; continue; }
    const take = Math.min(fragment.capacity - skip, entry.length - covered);
    const start = fragment.address + skip;
    if (start + take > image.length) throw new Error('ADFS E fragment extends beyond the image');
    extents.push({ start, length: take });
    covered += take; skip = 0;
    if (covered === entry.length) return extents;
  }
  throw new Error(`ADFS E object is ${entry.length - covered} bytes shorter than its catalogue length`);
}

function readObject(image: Uint8Array, format: AdfsCatalogue['format'], entry: Pick<AdfsFileEntry, 'discAddress' | 'length'>, fragments?: Map<number, NewMapFragment[]>): Uint8Array {
  const output = new Uint8Array(entry.length);
  let written = 0;
  for (const extent of objectExtents(image, format, entry, fragments)) {
    output.set(image.subarray(extent.start, extent.start + extent.length), written);
    written += extent.length;
  }
  return output;
}

/** Which byte runs of a validated image an object occupies, in order. */
export function adfsObjectExtents(image: Uint8Array, format: AdfsCatalogue['format'], entry: Pick<AdfsFileEntry, 'discAddress' | 'length'>): AdfsExtent[] {
  return objectExtents(image, format, entry, format === 'ADFS E' ? newMapFragments(image) : undefined);
}

/** Where the root directory of a validated image begins. */
export function adfsRootOffset(format: AdfsCatalogue['format']): number {
  return format === 'ADFS D' ? D_ROOT_OFFSET : E_ROOT_OFFSET;
}

function parseDirectory(directory: Uint8Array, format: AdfsCatalogue['format'], path: string, warnings: string[]): { title: string; name: string; sequence: number; entries: AdfsFileEntry[] } {
  if (directory.length !== DIRECTORY_SIZE) throw new Error(`${format} directory ${path} is not exactly 2 KiB`);
  const tailOffset = HEADER_SIZE + ENTRY_SIZE * MAX_ENTRIES;
  if (text(directory.subarray(1, 5)) !== 'Nick' || text(directory.subarray(tailOffset + 0x24, tailOffset + 0x28)) !== 'Nick') throw new Error(`${format} directory ${path} signatures are missing or invalid`);
  if (adfsDirectoryCheckByte(directory) !== directory[DIRECTORY_SIZE - 1]) throw new Error(`${format} directory ${path} checksum is invalid`);
  const sequence = directory[0]!;
  if (directory[tailOffset + 0x23] !== sequence) warnings.push(`${path} update sequence does not match its tail`);
  if (directory[tailOffset] !== 0) warnings.push(`${path} end marker is not zero`);
  if (directory[tailOffset + 1] !== 0 || directory[tailOffset + 2] !== 0) warnings.push(`${path} reserved tail bytes are not zero`);
  const entries: AdfsFileEntry[] = [];
  const identities = new Set<string>();
  let previousIdentity = '';
  for (let index = 0; index < MAX_ENTRIES; index += 1) {
    const offset = HEADER_SIZE + index * ENTRY_SIZE;
    if (directory[offset] === 0) break;
    const name = text(directory.subarray(offset, offset + 10));
    if (!name) { warnings.push(`${path} entry ${index + 1} has no readable name`); continue; }
    const identity = name.toLocaleUpperCase('en-GB');
    if (identities.has(identity)) warnings.push(`Duplicate object name ${path}.${name}`);
    if (previousIdentity && identity < previousIdentity) warnings.push(`${path} catalogue entries are not sorted at ${name}`);
    identities.add(identity); previousIdentity = identity;
    const loadAddress = u32(directory, offset + 0x0a);
    const attributes = directory[offset + 0x19]!;
    entries.push({
      name, path: `${path}.${name}`, loadAddress,
      executionAddress: u32(directory, offset + 0x0e), length: u32(directory, offset + 0x12),
      discAddress: u24(directory, offset + 0x16), attributes,
      directory: (attributes & 0x08) !== 0, locked: (attributes & 0x04) !== 0,
      ...((loadAddress >>> 20) === 0xfff ? { filetype: (loadAddress >>> 8) & 0xfff } : {}),
    });
  }
  return { title: text(directory.subarray(tailOffset + 0x06, tailOffset + 0x19)), name: text(directory.subarray(tailOffset + 0x19, tailOffset + 0x23)), sequence, entries };
}

export function parseAdfsCatalogue(image: Uint8Array): AdfsCatalogue {
  if (image.length !== D_IMAGE_SIZE) throw new Error('An ADFS D/E image must be exactly 800 KiB');
  const warnings: string[] = [];
  let format: AdfsCatalogue['format']; let rootOffset: number;
  if (u24(image, 0xfc) * 256 === D_IMAGE_SIZE) {
    format = 'ADFS D'; rootOffset = D_ROOT_OFFSET;
    if (oldMapChecksum(image, 0) !== image[0xff] || oldMapChecksum(image, 0x100) !== image[0x1ff]) throw new Error('ADFS D free-space map checksum is invalid');
    const freeEnd = image[0x1fe]!;
    if (freeEnd % 3 !== 0 || freeEnd > 82 * 3) throw new Error('ADFS D free-space table length is invalid');
    let previousEnd = 0;
    for (let offset = 0; offset < freeEnd; offset += 3) {
      const start = u24(image, offset); const length = u24(image, 0x100 + offset);
      if (!length) warnings.push(`Free-space entry ${offset / 3 + 1} has zero length`);
      if (start < previousEnd) warnings.push(`Free-space entry ${offset / 3 + 1} is unordered or overlapping`);
      if (start + length > D_IMAGE_SIZE / 256) warnings.push(`Free-space entry ${offset / 3 + 1} extends beyond the declared disk`);
      previousEnd = Math.max(previousEnd, start + length);
    }
  } else {
    format = 'ADFS E'; rootOffset = E_ROOT_OFFSET;
    if (image[4] !== 10 || image[5] !== 5 || image[6] !== 2 || image[13] !== 1 || u32(image, 0x14) !== D_IMAGE_SIZE) throw new Error('ADFS E disc record is not a supported 800 KiB one-zone floppy');
    if (adfsNewMapZoneCheckByte(image, 1 << image[4]!) !== image[0]) throw new Error('ADFS E allocation-map checksum is invalid');
  }
  const root = parseDirectory(image.slice(rootOffset, rootOffset + DIRECTORY_SIZE), format, '$', warnings);
  const fragments = format === 'ADFS E' ? newMapFragments(image) : undefined;
  const seen = new Set<number>(); let objectCount = root.entries.length;
  const descend = (entries: AdfsFileEntry[], depth: number) => {
    if (depth > MAX_DIRECTORY_DEPTH) { warnings.push(`Directory traversal stopped at depth ${MAX_DIRECTORY_DEPTH}`); return; }
    for (const entry of entries) {
      if (!entry.directory) continue;
      if (entry.length !== DIRECTORY_SIZE) warnings.push(`${entry.path} catalogue length is ${entry.length} bytes; a 2 KiB new-directory block was validated`);
      if (seen.has(entry.discAddress)) { warnings.push(`Directory cycle or shared directory detected at ${entry.path}`); continue; }
      seen.add(entry.discAddress);
      if (objectCount >= MAX_OBJECTS) { warnings.push(`Directory traversal stopped at ${MAX_OBJECTS} objects`); return; }
      try {
        const child = parseDirectory(readObject(image, format, { discAddress: entry.discAddress, length: DIRECTORY_SIZE }, fragments), format, entry.path, warnings);
        entry.children = child.entries; objectCount += child.entries.length; descend(child.entries, depth + 1);
      } catch (error) { warnings.push(`${entry.path}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  };
  descend(root.entries, 1);

  return {
    format,
    title: root.title,
    name: root.name,
    sequence: root.sequence,
    entries: root.entries,
    warnings,
  };
}

export function extractAdfsFile(image: Uint8Array, entry: AdfsFileEntry): Uint8Array {
  if (entry.directory) throw new Error('Choose a file rather than a directory to extract');
  const catalogue = parseAdfsCatalogue(image);
  const flatten = (entries: AdfsFileEntry[]): AdfsFileEntry[] => entries.flatMap((item) => [item, ...flatten(item.children ?? [])]);
  if (!flatten(catalogue.entries).some((item) => item.path === entry.path && item.discAddress === entry.discAddress && item.length === entry.length && !item.directory)) throw new Error('The selected file entry does not belong to this validated ADFS image');
  const format = catalogue.format;
  return readObject(image, format, entry, format === 'ADFS E' ? newMapFragments(image) : undefined);
}

/** @deprecated Use parseAdfsCatalogue; retained for compatible callers. */
export const parseAdfsDDirectory = parseAdfsCatalogue;
