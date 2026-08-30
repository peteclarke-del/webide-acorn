/* Writing an ADFS E floppy image.
 *
 * This began as a one-file writer, which was enough to get a single ARM binary
 * onto a disc RISC OS would run and not enough to ship anything: a program with
 * a sprite file, a template and a !Run alongside it needs them all on the same
 * disc, and rebuilding a one-file image per file does not produce that.
 *
 * The allocator here is deliberately the simplest one that produces a disc
 * FileCore accepts: files are laid down in catalogue order, each in one
 * contiguous fragment, with the whole of the remaining disc as a single free
 * fragment after them. It never fragments a file and never reuses freed space,
 * because nothing on a freshly written image has been freed. That restraint is
 * why the map and the catalogue cannot disagree.
 */
import { adfsDirectoryCheckByte, adfsNewMapZoneCheckByte, extractAdfsFile, parseAdfsCatalogue, type AdfsCatalogue, type AdfsFileEntry } from './adfsCatalogue';

/** One file to place on a new image. */
export interface AdfsFileRequest {
  name: string;
  bytes: Uint8Array;
  filetype: number;
  executionAddress?: number;
  locked?: boolean;
}

export interface CreateAdfsEImageRequest {
  title: string;
  name: string;
  bytes: Uint8Array;
  filetype: number;
  executionAddress?: number;
}

/** A subdirectory, and whatever it holds. */
export interface AdfsDirectoryRequest {
  name: string;
  children: readonly AdfsNodeRequest[];
}

export type AdfsNodeRequest = AdfsFileRequest | AdfsDirectoryRequest;

/** A whole disc, written in one pass. */
export interface CreateAdfsEDiscRequest {
  title: string;
  files: readonly AdfsNodeRequest[];
}

function isDirectoryRequest(node: AdfsNodeRequest): node is AdfsDirectoryRequest {
  return Array.isArray((node as AdfsDirectoryRequest).children);
}

export interface CreatedAdfsEImage { image: Uint8Array; catalogue: AdfsCatalogue }

const IMAGE_SIZE = 800 * 1024;
const SECTOR_SIZE = 1024;
const MAP_BITS_START = 0x40 * 8;
const BYTES_PER_MAP_BIT = 128;
const USABLE_MAP_BITS = IMAGE_SIZE / BYTES_PER_MAP_BIT;
const ROOT_OFFSET = 0x800;
const DIRECTORY_SIZE = 0x800;
const ENTRY_OFFSET = 5;
const ENTRY_SIZE = 26;
const MAX_ENTRIES = 77;
const TAIL_OFFSET = 5 + MAX_ENTRIES * ENTRY_SIZE;
/** The first four kilobytes hold both copies of the map and the root. */
const RESERVED_MAP_BITS = 32;
/** A cell has to be wide enough for a fragment id and its stop bit. */
const MIN_CELL_BITS = 16;
/** Fragment 2 is the root directory, so files start at 3. */
const FIRST_FILE_FRAGMENT = 3;

function checkedText(value: string, limit: number, label: string): Uint8Array {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > limit || /[.\x00-\x1f\x7f-\xff]/.test(trimmed)) throw new Error(`${label} must contain 1–${limit} printable seven-bit characters without dots`);
  return new TextEncoder().encode(trimmed);
}

function writeLe(bytes: Uint8Array, offset: number, value: number, length: number): void {
  for (let index = 0; index < length; index += 1) bytes[offset + index] = (value >>> (index * 8)) & 0xff;
}

function writeBits(bytes: Uint8Array, position: number, length: number, value: number): void {
  for (let index = 0; index < length; index += 1) {
    const offset = (position + index) >> 3; const mask = 1 << ((position + index) & 7);
    bytes[offset] = (value >>> index) & 1 ? bytes[offset]! | mask : bytes[offset]! & ~mask;
  }
}

/* A disc identifier derived from what is actually on the disc, so two builds of
 * the same content produce the same image and a changed file produces a
 * different one. Nothing depends on it being unpredictable. */
function discId(title: Uint8Array, files: ReadonlyArray<{ name: Uint8Array; bytes: Uint8Array }>): number {
  let value = 0x811c;
  const feed = (byte: number) => { value = ((value ^ byte) * 0x0101) & 0xffff; };
  for (const byte of title) feed(byte);
  for (const file of files) { for (const byte of file.name) feed(byte); for (const byte of file.bytes) feed(byte); }
  return value || 1;
}

/** How many map bits a file of this size occupies. */
function cellBits(length: number): number {
  return Math.max(MIN_CELL_BITS, Math.ceil(length / BYTES_PER_MAP_BIT));
}

/** The directory bit, with ordinary read and write access. */
const DIRECTORY_ATTRIBUTES = 0x0b;
/** The parser stops descending here, so a deeper tree could not be read back. */
const MAX_DEPTH = 16;

interface PlannedNode {
  name: string;
  encodedName: Uint8Array;
  /** The file's content and metadata, or null when this node is a directory. */
  file: AdfsFileRequest | null;
  children: PlannedNode[];
  fragment: number;
  position: number;
  bits: number;
  discAddress: number;
  /** The disc address of the directory this node sits in. */
  parentAddress: number;
}

/*
 * Check and order one directory's worth of nodes.
 *
 * Sorting happens here rather than at the point of writing because ADFS keeps a
 * catalogue sorted and its own reader warns when one is not, so the order the
 * caller happened to use must not reach the disc.
 */
function planNodes(nodes: readonly AdfsNodeRequest[], path: string, depth: number): PlannedNode[] {
  if (depth > MAX_DEPTH) throw new Error(`${path} is nested deeper than ${MAX_DEPTH} directories, which is as far as this build's reader will descend.`);
  if (nodes.length > MAX_ENTRIES) throw new Error(`An ADFS directory holds at most ${MAX_ENTRIES} objects; ${path} was given ${nodes.length}.`);
  const seen = new Set<string>();
  const planned = nodes.map((node) => {
    const encodedName = checkedText(node.name, 10, 'ADFS filename');
    const identity = node.name.toLocaleUpperCase('en-GB');
    if (seen.has(identity)) throw new Error(`${path} holds two objects called ${node.name}, and ADFS does not distinguish names by case.`);
    seen.add(identity);
    if (isDirectoryRequest(node)) {
      return {
        name: node.name, encodedName, file: null,
        children: planNodes(node.children, `${path}.${node.name}`, depth + 1),
        fragment: 0, position: 0, bits: MIN_CELL_BITS, discAddress: 0, parentAddress: 0,
      };
    }
    if (!Number.isInteger(node.filetype) || node.filetype < 0 || node.filetype > 0xfff) throw new Error('RISC OS filetype must be between &000 and &FFF');
    return {
      name: node.name, encodedName, file: node, children: [],
      fragment: 0, position: 0, bits: cellBits(node.bytes.length), discAddress: 0, parentAddress: 0,
    };
  });
  return planned.sort((left, right) => left.name.toLocaleUpperCase('en-GB') < right.name.toLocaleUpperCase('en-GB') ? -1 : 1);
}

/* Every node in the order they are allocated: each directory's own contents
 * together, level by level. A flat disc therefore lays out exactly as it did
 * before subdirectories existed, which is what keeps the image that passed the
 * RISC OS execution gate unchanged. */
function inAllocationOrder(roots: readonly PlannedNode[]): PlannedNode[] {
  const ordered: PlannedNode[] = [];
  let level: PlannedNode[] = [...roots];
  while (level.length) {
    ordered.push(...level);
    level = level.flatMap((node) => node.children);
  }
  return ordered;
}

function writeDirectoryBlock(block: Uint8Array, options: { name: Uint8Array; title: Uint8Array; parentAddress: number; entries: readonly PlannedNode[] }): void {
  block[0] = 1; block.set(new TextEncoder().encode('Nick'), 1);
  options.entries.forEach((node, index) => {
    const offset = ENTRY_OFFSET + index * ENTRY_SIZE;
    block.fill(13, offset, offset + 10); block.set(node.encodedName, offset);
    if (node.file) {
      writeLe(block, offset + 0x0a, (0xfff00000 | (node.file.filetype << 8)) >>> 0, 4);
      writeLe(block, offset + 0x0e, node.file.executionAddress ?? 0, 4);
      writeLe(block, offset + 0x12, node.file.bytes.length, 4);
      block[offset + 0x19] = node.file.locked ? 0x13 | 0x04 : 0x13;
    } else {
      /* A directory carries no load or execution address, and its length is the
       * size of the block it points at. */
      writeLe(block, offset + 0x12, DIRECTORY_SIZE, 4);
      block[offset + 0x19] = DIRECTORY_ATTRIBUTES;
    }
    writeLe(block, offset + 0x16, node.discAddress, 3);
  });
  writeLe(block, TAIL_OFFSET + 3, options.parentAddress, 3);
  block.fill(13, TAIL_OFFSET + 6, TAIL_OFFSET + 0x23);
  block.set(options.title, TAIL_OFFSET + 6);
  block.set(options.name, TAIL_OFFSET + 0x19);
  block[TAIL_OFFSET + 0x23] = 1;
  block.set(new TextEncoder().encode('Nick'), TAIL_OFFSET + 0x24);
  block[DIRECTORY_SIZE - 1] = adfsDirectoryCheckByte(block);
}

/**
 * Write an 800 KiB ADFS E image holding the given tree.
 *
 * Every object — file or directory — gets one contiguous fragment, allocated a
 * level at a time, with the whole of the remaining disc left as a single free
 * fragment. Nothing is ever fragmented and nothing freed is ever reused,
 * because on a freshly written image nothing has been freed.
 */
export function createAdfsEDisc(request: CreateAdfsEDiscRequest): CreatedAdfsEImage {
  const title = checkedText(request.title, 10, 'Disk title');
  if (!request.files.length) throw new Error('An ADFS image needs at least one file; an empty disc has nothing to validate against.');

  const roots = planNodes(request.files, '$', 1);
  const ordered = inAllocationOrder(roots);

  /* Laid out first so a disc that does not fit is refused before any of it is
   * written, and the refusal can say by how much. */
  let position = RESERVED_MAP_BITS;
  ordered.forEach((node, index) => {
    node.fragment = FIRST_FILE_FRAGMENT + index;
    node.position = position;
    node.discAddress = (node.fragment << 8) | 1;
    position += node.bits;
  });
  if (position + MIN_CELL_BITS > USABLE_MAP_BITS) {
    const over = (position + MIN_CELL_BITS - USABLE_MAP_BITS) * BYTES_PER_MAP_BIT;
    throw new Error(`These files need ${over.toLocaleString()} bytes more than an 800 KiB ADFS E image has room for.`);
  }
  const freePosition = position;
  /* A directory block records where its parent is, and the root is its own
   * parent. Set after allocation, because until then nothing has an address. */
  const linkParents = (nodes: readonly PlannedNode[], parentAddress: number): void => {
    for (const node of nodes) { node.parentAddress = parentAddress; linkParents(node.children, node.discAddress); }
  };
  linkParents(roots, 0x203);

  const image = new Uint8Array(IMAGE_SIZE);
  // Standard one-zone E disc record. The map is duplicated in sectors 0 and 1.
  image.set([10, 5, 2, 2, 15, 7, 1, 0, 0, 1], 4); writeLe(image, 0x0e, 0x0520, 2);
  writeLe(image, 0x10, 0x203, 4); writeLe(image, 0x14, IMAGE_SIZE, 4);
  writeLe(image, 0x18, discId(title, ordered.filter((node) => node.file).map((node) => ({ name: node.encodedName, bytes: node.file!.bytes }))), 2);
  image.set(title, 0x1a); image.fill(0x20, 0x1a + title.length, 0x24); image[3] = 0xff;
  const freeLink = MAP_BITS_START + freePosition - 8;
  writeLe(image, 1, 0x8000 | freeLink, 2);
  /* Cell one: both map copies and the root directory, as fragment 2. */
  writeBits(image, MAP_BITS_START, 15, 2); writeBits(image, MAP_BITS_START + RESERVED_MAP_BITS - 1, 1, 1);
  for (const node of ordered) {
    writeBits(image, MAP_BITS_START + node.position, 15, node.fragment);
    writeBits(image, MAP_BITS_START + node.position + node.bits - 1, 1, 1);
  }
  /* The rest of the disc is one free cell, terminated by the last usable bit. */
  writeBits(image, MAP_BITS_START + USABLE_MAP_BITS - 1, 1, 1);
  image[0] = adfsNewMapZoneCheckByte(image, SECTOR_SIZE); image.copyWithin(SECTOR_SIZE, 0, SECTOR_SIZE);

  writeDirectoryBlock(image.subarray(ROOT_OFFSET, ROOT_OFFSET + DIRECTORY_SIZE), {
    name: new TextEncoder().encode('$'), title, parentAddress: 0x203, entries: roots,
  });
  for (const node of ordered) {
    const start = node.position * BYTES_PER_MAP_BIT;
    if (node.file) { image.set(node.file.bytes, start); continue; }
    writeDirectoryBlock(image.subarray(start, start + DIRECTORY_SIZE), {
      name: node.encodedName, title: node.encodedName, parentAddress: node.parentAddress, entries: node.children,
    });
  }

  /* Read back through the same parser the product uses on somebody else's disc,
   * so what is handed over has been proved by the reader rather than asserted
   * by the writer. */
  const catalogue = parseAdfsCatalogue(image);
  if (catalogue.warnings.length) throw new Error(`The written image reports ${catalogue.warnings[0]}`);
  const check = (planned: readonly PlannedNode[], parsed: readonly AdfsFileEntry[], path: string): void => {
    if (parsed.length !== planned.length) throw new Error(`Independent ADFS E validation found ${parsed.length} objects in ${path} rather than ${planned.length}`);
    planned.forEach((node, index) => {
      const entry = parsed[index]!;
      const expected = new TextDecoder().decode(node.encodedName);
      if (entry.name !== expected) throw new Error(`Independent ADFS E validation did not reproduce ${path}.${expected}`);
      if (node.file) {
        if (entry.length !== node.file.bytes.length || !extractAdfsFile(image, entry).every((byte, offset) => byte === node.file!.bytes[offset])) {
          throw new Error(`Independent ADFS E validation did not reproduce ${path}.${expected}`);
        }
        return;
      }
      if (!entry.directory) throw new Error(`Independent ADFS E validation did not read ${path}.${expected} back as a directory`);
      check(node.children, entry.children ?? [], `${path}.${expected}`);
    });
  };
  check(roots, catalogue.entries, '$');
  return { image, catalogue };
}

/** The one-file case, which is what the ARM build path produces. */
export function createAdfsEImage(request: CreateAdfsEImageRequest): CreatedAdfsEImage {
  return createAdfsEDisc({
    title: request.title,
    files: [{
      name: request.name,
      bytes: request.bytes,
      filetype: request.filetype,
      ...(request.executionAddress === undefined ? {} : { executionAddress: request.executionAddress }),
    }],
  });
}
