/* Rewriting an ADFS directory without destroying what this adapter does not
 * model.
 *
 * The DFS adapter already works this way and the reason is the same here. A
 * catalogue holds more than the fields any one implementation reads: bytes a
 * third-party filing system uses, remnants in unused entry slots, tail fields
 * whose meaning this build does not depend on. Rewriting only the modelled
 * fields and zeroing the rest looks correct — the image still mounts, the files
 * are still there — and quietly discards somebody else's data.
 *
 * So opening a directory captures every byte the parser does not interpret, and
 * writing lays those bytes down first, then the fields that are modelled over
 * the top. A directory that has not been changed comes back byte for byte,
 * which is the only way to know the preservation is real rather than asserted.
 *
 * What is modelled, and therefore what a rewrite may legitimately change: the
 * update sequence, each entry's name, load and execution addresses, length,
 * disc address and attributes, the directory name and title, and the check
 * byte. Everything else is carried.
 */
import { adfsDirectoryCheckByte, adfsFieldText, type AdfsCatalogue, type AdfsFileEntry } from './adfsCatalogue';

const DIRECTORY_SIZE = 0x800;
const HEADER_SIZE = 5;
const ENTRY_SIZE = 26;
const MAX_ENTRIES = 77;
const TAIL_OFFSET = HEADER_SIZE + ENTRY_SIZE * MAX_ENTRIES;

/**
 * The bytes of a directory this adapter does not interpret, kept so a rewrite
 * can put them back exactly where they were.
 */
export interface AdfsPreservedDirectory {
  /** Everything between the sequence byte and the first entry. */
  header: Uint8Array;
  /** Entry slots after the terminator, which may hold earlier contents. */
  unusedEntries: Uint8Array;
  /**
   * Each used entry's ten-byte name field exactly as it was, keyed by the name
   * that field decodes to.
   *
   * Every other byte of an entry is modelled, so this is the whole of what an
   * entry can carry that this build does not understand: ADFS terminates a
   * short name with a carriage return and leaves the rest of the field holding
   * whatever the previous occupant of that slot left there. Keyed by name
   * rather than by position so an entry that moves — because a rename resorted
   * the catalogue — still finds its own bytes rather than its neighbour's.
   */
  nameFields: Map<string, Uint8Array>;
  /** The tail, minus the name, title and trailing sequence this build writes. */
  tail: Uint8Array;
  /** How many entries were in use when the directory was read. */
  usedEntries: number;
}

export interface AdfsDirectoryWriteResult {
  directory: Uint8Array;
  /**
   * Preserved bytes a larger catalogue had to claim. Reported rather than
   * silently overwritten, because losing them is a real loss even when it is
   * unavoidable.
   */
  preservedBytesOverwritten: number;
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function writeU24(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
}

/*
 * Write a fixed-width text field without clobbering what follows it.
 *
 * ADFS terminates a short name with a carriage return and leaves the rest of
 * the field as it was, so those bytes are whatever the last thing to use that
 * slot left behind. Filling them with padding is the same mistake as zeroing an
 * unused catalogue entry: it looks tidier and it destroys data this build does
 * not model. So the characters and one terminator are written, and the tail of
 * the field is left for the preserved bytes underneath to show through.
 */
function writeName(bytes: Uint8Array, offset: number, value: string, length: number): void {
  const written = Math.min(value.length, length);
  for (let index = 0; index < written; index += 1) {
    const code = value.charCodeAt(index);
    bytes[offset + index] = code > 0xff ? 0x3f : code;
  }
  if (written < length) bytes[offset + written] = 0x0d;
}

/** How many entry slots a directory is using, by its terminator. */
export function usedEntryCount(directory: Uint8Array): number {
  for (let index = 0; index < MAX_ENTRIES; index += 1) {
    if (directory[HEADER_SIZE + index * ENTRY_SIZE] === 0) return index;
  }
  return MAX_ENTRIES;
}

/**
 * Capture what a rewrite must not lose.
 *
 * Deliberately captures the whole of each region rather than a list of named
 * unknown fields: naming them would mean claiming to know which bytes have
 * meaning, and the point of this is that some of them have meaning this build
 * does not know about.
 */
export function preserveAdfsDirectory(directory: Uint8Array): AdfsPreservedDirectory {
  if (directory.length !== DIRECTORY_SIZE) throw new Error('An ADFS directory is exactly 2 KiB.');
  const used = usedEntryCount(directory);
  const nameFields = new Map<string, Uint8Array>();
  for (let index = 0; index < used; index += 1) {
    const offset = HEADER_SIZE + index * ENTRY_SIZE;
    const field = directory.slice(offset, offset + 10);
    /* Decoded with the parser's own decoder, so the key here is the same string
     * the catalogue will present and the writer will look up. */
    nameFields.set(adfsFieldText(field), field);
  }
  return {
    /* The sequence byte at 0 is modelled; bytes 1 to 4 are the signature. */
    header: directory.slice(1, HEADER_SIZE),
    unusedEntries: directory.slice(HEADER_SIZE + used * ENTRY_SIZE, TAIL_OFFSET),
    tail: directory.slice(TAIL_OFFSET, DIRECTORY_SIZE),
    nameFields,
    usedEntries: used,
  };
}

/**
 * Write a directory from its modelled fields, laying the preserved bytes down
 * first so anything this adapter does not understand survives.
 *
 * The check byte is recomputed rather than carried, because it is a function of
 * the bytes around it: carrying a stale one would produce an image that fails
 * its own validation.
 */
export function writeAdfsDirectory(
  entries: readonly AdfsFileEntry[],
  meta: { name: string; title: string; sequence: number },
  preserved: AdfsPreservedDirectory,
): AdfsDirectoryWriteResult {
  if (entries.length > MAX_ENTRIES) throw new Error(`An ADFS directory holds at most ${MAX_ENTRIES} objects; this one has ${entries.length}.`);
  const directory = new Uint8Array(DIRECTORY_SIZE);

  /* Preserved bytes first, so the modelled fields overwrite them rather than
   * the other way round. */
  directory.set(preserved.header, 1);
  directory.set(preserved.tail, TAIL_OFFSET);
  const unusedStart = HEADER_SIZE + entries.length * ENTRY_SIZE;
  const room = TAIL_OFFSET - unusedStart;
  const carried = Math.min(room, preserved.unusedEntries.length);
  const dropped = Math.max(0, preserved.unusedEntries.length - carried);
  /* Anchored at the end of the entry area rather than at the start of the free
   * space, so every carried byte keeps the offset it had: a directory that grew
   * claims from the front of the region, and a shrunken one leaves the earlier
   * remnant exactly where it was. A remnant that moved would be a different
   * remnant, because whatever wrote it recorded where it put it. */
  directory.set(preserved.unusedEntries.subarray(dropped), TAIL_OFFSET - carried);

  directory[0] = meta.sequence & 0xff;
  writeName(directory, 1, 'Nick', 4);

  entries.forEach((entry, index) => {
    const offset = HEADER_SIZE + index * ENTRY_SIZE;
    /* An entry whose name has not changed keeps its name field whole, padding
     * and remnant included. A renamed one gets a freshly written field, because
     * the bytes after the old terminator belonged to the old name. */
    const preservedField = preserved.nameFields.get(entry.name);
    if (preservedField) directory.set(preservedField, offset);
    else writeName(directory, offset, entry.name, 10);
    writeU32(directory, offset + 0x0a, entry.loadAddress >>> 0);
    writeU32(directory, offset + 0x0e, entry.executionAddress >>> 0);
    writeU32(directory, offset + 0x12, entry.length >>> 0);
    writeU24(directory, offset + 0x16, entry.discAddress);
    directory[offset + 0x19] = entry.attributes & 0xff;
  });
  if (entries.length < MAX_ENTRIES) directory[HEADER_SIZE + entries.length * ENTRY_SIZE] = 0;

  writeName(directory, TAIL_OFFSET + 0x06, meta.title, 0x13);
  writeName(directory, TAIL_OFFSET + 0x19, meta.name, 0x0a);
  directory[TAIL_OFFSET + 0x23] = meta.sequence & 0xff;
  writeName(directory, TAIL_OFFSET + 0x24, 'Nick', 4);
  directory[DIRECTORY_SIZE - 1] = adfsDirectoryCheckByte(directory);

  return { directory, preservedBytesOverwritten: dropped };
}

/**
 * Rewrite a directory exactly as it was read, which is the check that the
 * preservation is real.
 *
 * A round trip that produces the same bytes proves the adapter carried
 * everything it does not model. Anything less proves it did not, whatever the
 * modelled fields say.
 */
export function rewriteAdfsDirectory(directory: Uint8Array, catalogue: Pick<AdfsCatalogue, 'name' | 'title' | 'sequence'>, entries: readonly AdfsFileEntry[]): AdfsDirectoryWriteResult {
  return writeAdfsDirectory(entries, { name: catalogue.name, title: catalogue.title, sequence: catalogue.sequence }, preserveAdfsDirectory(directory));
}
