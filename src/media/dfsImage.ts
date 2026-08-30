import { extractDfsFile, parseDfsCatalogue, type DfsCatalogue } from './dfsCatalogue';

const SECTOR_SIZE = 256;
const SECTORS = 800;
const FIRST_DATA_SECTOR = 2;
const CATALOGUE_SIZE = SECTOR_SIZE * 2;
/* 40-track single-density is the other geometry DFS is written for. Anything
 * else the caller declares is accepted as long as it is a whole disc that can
 * hold a catalogue. */
const MINIMUM_SECTORS = FIRST_DATA_SECTOR;

export interface DfsImageRequest {
  title: string;
  name: string;
  directory?: string;
  locked?: boolean;
  loadAddress: number;
  executionAddress: number;
  bytes: Uint8Array;
}

export interface CreatedDfsImage {
  image: Uint8Array;
  catalogue: DfsCatalogue;
  /** Preserved catalogue bytes a larger catalogue had to claim, if any. */
  preservedBytesOverwritten?: number;
}

export interface DfsLogicalFile extends Omit<DfsImageRequest, 'title'> {}

/**
 * Bytes of a DFS catalogue this adapter does not model, captured verbatim so an
 * edit does not quietly discard them.
 *
 * `optionBits` are bits 2 and 3 of the boot-option byte, which Acorn DFS leaves
 * unused and some third-party filing systems do not. The two tails are whatever
 * sits after the last catalogue entry in each sector; several tools keep data
 * there. None of it is interpreted here — it is carried, and where a larger
 * catalogue now needs those bytes the new entries win and the overwrite is
 * reported rather than hidden.
 */
export interface DfsPreservedMetadata {
  optionBits: number;
  sector0Tail: { offset: number; bytes: number[] };
  sector1Tail: { offset: number; bytes: number[] };
}

export interface DfsImageProject {
  title: string;
  cycle?: number;
  bootOption?: number;
  /** Total sectors the catalogue declares; 800 (80-track) when not given. */
  declaredSectors?: number;
  preserved?: DfsPreservedMetadata;
  files: DfsLogicalFile[];
}

export function openDfsImageProject(image: Uint8Array): DfsImageProject {
  const catalogue = parseDfsCatalogue(image);
  if (catalogue.warnings.length) throw new Error(`DFS image cannot be edited safely: ${catalogue.warnings.join(' ')}`);
  const tailOffset = 8 + catalogue.files.length * 8;
  return {
    title: catalogue.title, cycle: catalogue.cycle, bootOption: catalogue.bootOption,
    declaredSectors: catalogue.declaredSectors,
    preserved: {
      optionBits: (image[SECTOR_SIZE + 6]! >>> 2) & 0x03,
      sector0Tail: { offset: tailOffset, bytes: Array.from(image.subarray(tailOffset, SECTOR_SIZE)) },
      sector1Tail: { offset: tailOffset, bytes: Array.from(image.subarray(SECTOR_SIZE + tailOffset, CATALOGUE_SIZE)) },
    },
    files: catalogue.files.map((file) => ({ name: file.name, directory: file.directory, locked: file.locked, loadAddress: file.loadAddress, executionAddress: file.executionAddress, bytes: extractDfsFile(image, file) })),
  };
}

function printableAscii(value: string, maximum: number, field: string): string {
  if (!value.length || value.length > maximum || !/^[\x20-\x7e]+$/.test(value)) throw new Error(`${field} must contain 1–${maximum} printable ASCII characters`);
  return value;
}

function address(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0x3ffff) throw new Error(`${field} must be an 18-bit DFS address`);
  return value;
}

/** Creates a deterministic single-sided 80-track DFS image from logical files,
 * then reparses and byte-compares every catalogue extent. */
export function createDfsImageFromFiles(request: DfsImageProject): CreatedDfsImage {
  const title = printableAscii(request.title.trim(), 12, 'DFS title');
  const cycle = request.cycle ?? 0; const bootOption = request.bootOption ?? 0;
  if (!Number.isInteger(cycle) || cycle < 0 || cycle > 255) throw new Error('DFS cycle must be between 0 and 255');
  if (!Number.isInteger(bootOption) || bootOption < 0 || bootOption > 3) throw new Error('DFS boot option must be between 0 and 3');
  if (request.files.length > 31) throw new Error('A DFS catalogue must contain no more than 31 files');
  const identities = new Set<string>(); let nextSector = FIRST_DATA_SECTOR;
  const files = request.files.map((file) => {
    const name = printableAscii(file.name.trim(), 7, 'DFS filename');
    if (name.includes('.') || name.includes('/') || name.includes('\\')) throw new Error('DFS filename must not contain a directory or extension separator');
    const directory = printableAscii((file.directory ?? '$').trim(), 1, 'DFS directory');
    const identity = `${directory}.${name}`.toUpperCase(); if (identities.has(identity)) throw new Error(`Duplicate DFS filename ${directory}.${name}`); identities.add(identity);
    const loadAddress = address(file.loadAddress, 'Load address'); const executionAddress = address(file.executionAddress, 'Execution address');
    if (!file.bytes || file.bytes.length === 0) throw new Error('DFS artifact must contain at least one byte');
    const startSector = nextSector; nextSector += Math.ceil(file.bytes.length / SECTOR_SIZE);
    return { ...file, name, directory, loadAddress, executionAddress, startSector };
  });
  const declaredSectors = request.declaredSectors ?? SECTORS;
  if (!Number.isInteger(declaredSectors) || declaredSectors < MINIMUM_SECTORS || declaredSectors > 0x3ff) throw new Error('A DFS catalogue declares between 2 and 1023 sectors');
  if (nextSector > declaredSectors) throw new Error(`DFS file set needs ${nextSector} sectors but the disc declares ${declaredSectors}`);

  const image = new Uint8Array(declaredSectors * SECTOR_SIZE);
  const encodedTitle = new TextEncoder().encode(title.padEnd(12, ' '));
  /* Unknown catalogue bytes are laid down first so the entries this adapter
   * does model overwrite them where the two overlap. */
  const preserved = request.preserved;
  let preservedOverwritten = 0;
  if (preserved) {
    image.set(Uint8Array.from(preserved.sector0Tail.bytes.slice(0, SECTOR_SIZE - preserved.sector0Tail.offset)), preserved.sector0Tail.offset);
    image.set(Uint8Array.from(preserved.sector1Tail.bytes.slice(0, SECTOR_SIZE - preserved.sector1Tail.offset)), SECTOR_SIZE + preserved.sector1Tail.offset);
    const newTail = 8 + files.length * 8;
    preservedOverwritten = Math.max(0, Math.min(newTail, SECTOR_SIZE) - preserved.sector0Tail.offset) * 2;
  }
  image.set(encodedTitle.subarray(0, 8), 0);
  image.set(encodedTitle.subarray(8, 12), SECTOR_SIZE);
  image[SECTOR_SIZE + 4] = cycle;
  image[SECTOR_SIZE + 5] = files.length * 8;
  image[SECTOR_SIZE + 6] = (bootOption << 4) | (((preserved?.optionBits ?? 0) & 0x03) << 2) | ((declaredSectors >>> 8) & 0x03);
  image[SECTOR_SIZE + 7] = declaredSectors & 0xff;
  files.forEach((file, index) => {
    const catalogueOffset = 8 + index * 8; image.set(new TextEncoder().encode(file.name.padEnd(7, ' ')), catalogueOffset); image[catalogueOffset + 7] = file.directory.charCodeAt(0) | (file.locked ? 0x80 : 0);
    const metadata = SECTOR_SIZE + catalogueOffset; image[metadata] = file.loadAddress & 0xff; image[metadata + 1] = (file.loadAddress >>> 8) & 0xff; image[metadata + 2] = file.executionAddress & 0xff; image[metadata + 3] = (file.executionAddress >>> 8) & 0xff; image[metadata + 4] = file.bytes.length & 0xff; image[metadata + 5] = (file.bytes.length >>> 8) & 0xff;
    image[metadata + 6] = ((file.executionAddress >>> 10) & 0xc0) | ((file.bytes.length >>> 12) & 0x30) | ((file.loadAddress >>> 14) & 0x0c) | ((file.startSector >>> 8) & 0x03); image[metadata + 7] = file.startSector & 0xff;
    image.set(file.bytes, file.startSector * SECTOR_SIZE);
  });

  const catalogue = parseDfsCatalogue(image);
  if (catalogue.warnings.length || catalogue.files.length !== files.length || !files.every((source, index) => {
    const file = catalogue.files[index]; return !!file && file.name === source.name && file.directory === source.directory && file.locked === !!source.locked && file.loadAddress === source.loadAddress && file.executionAddress === source.executionAddress && file.length === source.bytes.length && file.startSector === source.startSector && extractDfsFile(image, file).every((byte, byteIndex) => byte === source.bytes[byteIndex]);
  })) {
    throw new Error('Generated DFS image failed independent catalogue and extent validation');
  }
  return { image, catalogue, ...(preservedOverwritten ? { preservedBytesOverwritten: preservedOverwritten } : {}) };
}

export function createDfsImage(request: DfsImageRequest): CreatedDfsImage {
  return createDfsImageFromFiles({ title: request.title, files: [request] });
}
