/* Changing a catalogue entry in an ADFS image, in place.
 *
 * Reading an ADFS image worked and writing one meant creating a new one from
 * scratch. That is enough to get a build onto a disc and not enough to work on
 * one: fixing a load address, locking a finished binary or correcting a name
 * meant rebuilding the image and losing everything else on it.
 *
 * What this does not do is as important as what it does. It does not move a
 * file, change its length, allocate or free a sector, or touch the free-space
 * map. Every operation here changes fields inside one directory block and
 * nothing else, which is why it can be done without a working allocator and
 * without any risk of the map and the catalogue disagreeing afterwards.
 *
 * The directory is rewritten through the preserving writer, so the bytes this
 * build does not model survive the edit, and the result is parsed again before
 * it is returned. An image that would not parse is not handed back with a
 * warning attached; it is refused, and the original is left alone.
 */
import {
  adfsObjectExtents,
  adfsRootOffset,
  parseAdfsCatalogue,
  type AdfsCatalogue,
  type AdfsFileEntry,
} from './adfsCatalogue';
import { rewriteAdfsDirectory } from './adfsDirectory';

const DIRECTORY_SIZE = 0x800;

/** The fields of an entry this editor is willing to change. */
export interface AdfsEntryChange {
  name?: string;
  loadAddress?: number;
  executionAddress?: number;
  locked?: boolean;
}

export interface AdfsEditResult {
  image: Uint8Array;
  /**
   * Bytes this adapter did not model that the edit could not keep. Reported
   * rather than left to be found by comparing images.
   */
  preservedBytesOverwritten: number;
  /** What the re-parsed image says about itself after the edit. */
  warnings: string[];
}

export class AdfsEditError extends Error {
  constructor(message: string) { super(message); this.name = 'AdfsEditError'; }
}

/**
 * Whether a name is one ADFS can hold.
 *
 * The characters refused here are the ones the filing system itself gives a
 * meaning: the path separator, the wildcards, and the special directory names.
 * A name containing one of them cannot be typed at the machine to reach the
 * file, so accepting it would create a file nobody could open.
 */
export function adfsNameProblem(name: string): string | null {
  if (!name.length) return 'A name cannot be empty.';
  if (name.length > 10) return `An ADFS name is at most 10 characters; "${name}" is ${name.length}.`;
  for (const character of name) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code > 0x7e) return `"${name}" contains a character the machine cannot type.`;
    if ('.:*#$&@^%\\'.includes(character)) return `"${name}" contains ${character}, which ADFS reads as a path or wildcard character rather than as part of a name.`;
  }
  return null;
}

function flatten(entries: readonly AdfsFileEntry[]): AdfsFileEntry[] {
  return entries.flatMap((entry) => [entry, ...flatten(entry.children ?? [])]);
}

/** The entries of the directory holding `path`, and where that directory lives. */
function locateParent(image: Uint8Array, catalogue: AdfsCatalogue, path: string): {
  entries: AdfsFileEntry[];
  extents: Array<{ start: number; length: number }>;
  parentPath: string;
} {
  const separator = path.lastIndexOf('.');
  if (separator < 0) throw new AdfsEditError(`"${path}" is not a full ADFS path; a path starts at the root, as in $.MyFile.`);
  const parentPath = path.slice(0, separator);
  if (parentPath === '$') {
    const start = adfsRootOffset(catalogue.format);
    return { entries: catalogue.entries, extents: [{ start, length: DIRECTORY_SIZE }], parentPath };
  }
  const parent = flatten(catalogue.entries).find((entry) => entry.path === parentPath && entry.directory);
  if (!parent) throw new AdfsEditError(`This image has no directory ${parentPath}, so there is nothing at ${path} to change.`);
  return {
    entries: parent.children ?? [],
    extents: adfsObjectExtents(image, catalogue.format, { discAddress: parent.discAddress, length: DIRECTORY_SIZE }),
    parentPath,
  };
}

function writeExtents(image: Uint8Array, extents: ReadonlyArray<{ start: number; length: number }>, bytes: Uint8Array): void {
  let taken = 0;
  for (const extent of extents) {
    image.set(bytes.subarray(taken, taken + extent.length), extent.start);
    taken += extent.length;
  }
  if (taken !== bytes.length) throw new AdfsEditError(`The directory occupies ${taken} bytes on this disc and ${bytes.length} were written, so the edit was refused rather than written short.`);
}

/**
 * Apply a change to one catalogue entry and return the whole image.
 *
 * The update sequence of the directory is advanced, because that is what it is
 * for: ADFS uses it to notice that a directory it has cached is out of date,
 * and a machine that had this directory open before the edit needs to see that
 * it has moved on.
 */
export function editAdfsEntry(image: Uint8Array, path: string, change: AdfsEntryChange): AdfsEditResult {
  const catalogue = parseAdfsCatalogue(image);
  const { entries, extents, parentPath } = locateParent(image, catalogue, path);
  const target = entries.find((entry) => entry.path === path);
  if (!target) throw new AdfsEditError(`${parentPath} holds no object called ${path.slice(parentPath.length + 1)}.`);

  if (change.name !== undefined) {
    const problem = adfsNameProblem(change.name);
    if (problem) throw new AdfsEditError(problem);
    const identity = change.name.toLocaleUpperCase('en-GB');
    const clash = entries.find((entry) => entry !== target && entry.name.toLocaleUpperCase('en-GB') === identity);
    if (clash) throw new AdfsEditError(`${parentPath} already holds ${clash.name}, and ADFS does not distinguish names by case.`);
  }
  for (const [field, value] of [['load address', change.loadAddress], ['execution address', change.executionAddress]] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 0xffffffff)) {
      throw new AdfsEditError(`A ${field} is a 32-bit value; ${value} is not one.`);
    }
  }

  const attributes = change.locked === undefined
    ? target.attributes
    : (change.locked ? target.attributes | 0x04 : target.attributes & ~0x04);
  const edited: AdfsFileEntry = {
    ...target,
    name: change.name ?? target.name,
    loadAddress: change.loadAddress ?? target.loadAddress,
    executionAddress: change.executionAddress ?? target.executionAddress,
    attributes,
    locked: (attributes & 0x04) !== 0,
  };

  /* ADFS keeps a directory sorted, and the parser warns when one is not, so a
   * rename has to be placed rather than left where the old name sorted. */
  const next = entries
    .map((entry) => entry === target ? edited : entry)
    .sort((left, right) => left.name.toLocaleUpperCase('en-GB') < right.name.toLocaleUpperCase('en-GB') ? -1 : 1);

  const directory = new Uint8Array(DIRECTORY_SIZE);
  let taken = 0;
  for (const extent of extents) {
    directory.set(image.subarray(extent.start, extent.start + extent.length), taken);
    taken += extent.length;
  }
  const meta = parentPath === '$'
    ? { name: catalogue.name, title: catalogue.title, sequence: (catalogue.sequence + 1) & 0xff }
    : readDirectoryMeta(directory);
  const written = rewriteAdfsDirectory(directory, meta, next);

  const result = image.slice();
  writeExtents(result, extents, written.directory);

  /* Parsed again before it is returned. A refusal here means the edit is
   * dropped and the caller keeps the image it had, which is the only outcome
   * that cannot leave someone holding a disc that will not mount. */
  let reparsed: AdfsCatalogue;
  try {
    reparsed = parseAdfsCatalogue(result);
  } catch (error) {
    throw new AdfsEditError(`The edited image no longer parses (${error instanceof Error ? error.message : String(error)}), so it was not applied and your image is unchanged.`);
  }
  if (!flatten(reparsed.entries).some((entry) => entry.name === edited.name && entry.discAddress === edited.discAddress)) {
    throw new AdfsEditError('The edited image parses but does not contain the changed entry, so it was not applied and your image is unchanged.');
  }

  return { image: result, preservedBytesOverwritten: written.preservedBytesOverwritten, warnings: reparsed.warnings };
}

/* A subdirectory's own name, title and sequence live in its tail, and the
 * catalogue only reports the root's. Read from the block itself rather than
 * carried from anywhere else, so the values written back are the ones that were
 * there. */
function readDirectoryMeta(directory: Uint8Array): { name: string; title: string; sequence: number } {
  const tail = 5 + 26 * 77;
  const read = (offset: number, length: number) => {
    const bytes = directory.subarray(tail + offset, tail + offset + length);
    const end = bytes.findIndex((byte) => byte === 0 || byte === 13);
    return String.fromCharCode(...(end < 0 ? bytes : bytes.subarray(0, end))).replace(/[ -]/g, '').trimEnd();
  };
  return { title: read(0x06, 0x13), name: read(0x19, 0x0a), sequence: (directory[0]! + 1) & 0xff };
}
