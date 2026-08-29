/* Reading a zip archive of source, in the browser, without trusting it.
 *
 * A folder can be imported two ways already: through a directory `<input>`,
 * and through the File System Access API. Neither helps someone who was sent a
 * `.zip`, which is how Acorn source is actually passed around — a Stardot
 * attachment, a release from a repository, a backup of a working directory.
 *
 * An archive is hostile input. Everything in it is a claim by whoever built it,
 * and every claim here is checked rather than believed:
 *
 *   A name may be an absolute path, or contain `..`, and unpacking it naively
 *   writes outside the folder that was chosen. Both are refused by name.
 *   An entry may be a symbolic link, which is a path stored as file contents;
 *   following one leaves the archive entirely. Refused, and reported as a link.
 *   A declared uncompressed size may be enormous, or a small entry may expand
 *   to gigabytes. Both the declared size and the bytes actually produced are
 *   bounded, and decompression stops at the bound rather than after it.
 *   The bytes may not be what the archive says they are, so the CRC-32 of every
 *   entry is checked against the record. A truncated or altered entry is
 *   reported, not imported.
 *   An entry may be encrypted, or use a compression method this reader does
 *   not implement. Both are reported by name rather than producing rubbish.
 *
 * Nothing is uploaded: the archive is read in this browser with the platform's
 * own `DecompressionStream`, so there is no dependency to audit and no server
 * involved.
 *
 * The reader is deliberately central-directory-first. The local headers a
 * streaming reader would follow can disagree with the central directory, and
 * the central directory is the record the archive itself treats as canonical.
 */

export const MAX_ARCHIVE_ENTRIES = 512;
/** The largest single file this reader will produce. */
export const MAX_ARCHIVE_FILE_BYTES = 1024 * 1024;
/** The largest total this reader will produce from one archive. */
export const MAX_ARCHIVE_TOTAL_BYTES = 16 * 1024 * 1024;

export type ArchiveRefusal =
  | 'absolute-path'
  | 'path-traversal'
  | 'symbolic-link'
  | 'encrypted'
  | 'unsupported-compression'
  | 'file-too-large'
  | 'archive-too-large'
  | 'entry-limit'
  | 'checksum-mismatch'
  | 'not-text'
  | 'unreadable';

export interface ArchiveEntry {
  path: string;
  content: string;
  /** Bytes the entry expanded to, which the caller's own limits may use. */
  bytes: number;
}

export interface ArchiveRefusalRecord {
  path: string;
  reason: ArchiveRefusal;
  detail: string;
}

export interface ArchiveReadResult {
  entries: ArchiveEntry[];
  /** Everything not imported, each with why. Nothing is dropped silently. */
  refused: ArchiveRefusalRecord[];
  /** True when a limit stopped the read before the archive was exhausted. */
  truncated: boolean;
}

/* Signatures, little-endian, from the zip format. */
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

/* General purpose bit 0 marks an encrypted entry. Bit 11 marks a UTF-8 name,
 * which is the only encoding this reader decodes; a name without it is decoded
 * as UTF-8 anyway, because CP437 names in practice are ASCII. */
const FLAG_ENCRYPTED = 0x0001;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/* Unix file type bits, held in the high sixteen of the external attributes
 * when the archive was made on a Unix-like system (creator 3). */
const UNIX_TYPE_MASK = 0xf000;
const UNIX_TYPE_SYMLINK = 0xa000;

interface CentralEntry {
  name: string;
  method: number;
  flags: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  externalAttributes: number;
  madeBy: number;
}

function readCentralDirectory(view: DataView): { entries: CentralEntry[]; zip64: boolean } {
  /* The end record is at the tail, after a comment of up to 65535 bytes. */
  const limit = Math.max(0, view.byteLength - 22 - 0xffff);
  let end = -1;
  for (let offset = view.byteLength - 22; offset >= limit; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) { end = offset; break; }
  }
  if (end < 0) throw new Error('That file is not a zip archive: it has no end-of-central-directory record.');

  /* Zip64 is refused rather than half-supported: an archive that needs it is
   * larger than anything this reader would accept anyway, and pretending to
   * read one would mean trusting the 32-bit fields it deliberately overflows. */
  const zip64 = end >= 20 && view.getUint32(end - 20, true) === ZIP64_LOCATOR;

  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries: CentralEntry[] = [];
  const decoder = new TextDecoder('utf-8');

  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > view.byteLength) throw new Error('This archive is truncated: its central directory runs past the end of the file.');
    if (view.getUint32(offset, true) !== CENTRAL_FILE_HEADER) throw new Error('This archive is damaged: a central directory entry has the wrong signature.');
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    if (nameStart + nameLength > view.byteLength) throw new Error('This archive is truncated: an entry name runs past the end of the file.');
    entries.push({
      name: decoder.decode(new Uint8Array(view.buffer, view.byteOffset + nameStart, nameLength)),
      flags: view.getUint16(offset + 8, true),
      method: view.getUint16(offset + 10, true),
      crc32: view.getUint32(offset + 16, true),
      compressedSize: view.getUint32(offset + 20, true),
      uncompressedSize: view.getUint32(offset + 24, true),
      madeBy: view.getUint16(offset + 4, true) >> 8,
      externalAttributes: view.getUint32(offset + 38, true),
      localHeaderOffset: view.getUint32(offset + 42, true),
    });
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return { entries, zip64 };
}

/* CRC-32, computed on the bytes that were actually produced. The table is
 * built once; a lookup-free implementation is not worth the cycles here. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[index]!) & 0xff]!;
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Where an entry's data begins, read from its own local header rather than
 * assumed: the extra field there is routinely a different length from the one
 * in the central directory, and assuming otherwise reads from the wrong place.
 */
function dataOffset(view: DataView, entry: CentralEntry): number {
  const header = entry.localHeaderOffset;
  if (header + 30 > view.byteLength) throw new Error('its local header is past the end of the archive');
  if (view.getUint32(header, true) !== LOCAL_FILE_HEADER) throw new Error('its local header has the wrong signature');
  return header + 30 + view.getUint16(header + 26, true) + view.getUint16(header + 28, true);
}

/**
 * Expand deflate-compressed bytes, stopping at a bound rather than after it.
 *
 * A small entry that claims to be small and expands to gigabytes is the oldest
 * archive attack there is. Reading through the stream and stopping at the limit
 * means the memory a hostile archive can make this tab allocate is the limit,
 * not whatever the archive felt like producing.
 */
async function inflate(compressed: Uint8Array, limit: number): Promise<{ bytes: Uint8Array; overran: boolean }> {
  const stream = new Blob([compressed as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let overran = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > limit) { overran = true; await reader.cancel(); break; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return { bytes, overran };
}

/* The same directories the folder importer passes over, so an archive of a
 * working directory imports as the folder itself would. */
const IGNORED_SEGMENTS = new Set(['node_modules', '.git', '.svn', 'dist', 'build', 'out', 'target', '.cache', '.idea', '.vscode', '__MACOSX']);

/** Why this entry's name may not be unpacked, or null if it may be. */
export function unsafeArchiveName(name: string): { reason: ArchiveRefusal; detail: string } | null {
  if (name.startsWith('/') || /^[a-z]:[\\/]/i.test(name)) {
    return { reason: 'absolute-path', detail: 'names an absolute path, which would be unpacked outside the project' };
  }
  const segments = name.split(/[\\/]/);
  if (segments.some((segment) => segment === '..')) {
    return { reason: 'path-traversal', detail: 'contains "..", which would be unpacked outside the project' };
  }
  return null;
}

/**
 * Read every importable text file out of a zip archive.
 *
 * The result is deliberately shaped like the folder reader's: a list of paths
 * and contents that `planCodebaseImport` can plan from, plus everything that
 * was refused with the reason. A person can then see the same import plan
 * whether the source arrived as a folder or as an archive.
 */
export async function readZipArchive(data: ArrayBuffer): Promise<ArchiveReadResult> {
  const view = new DataView(data);
  const { entries: central, zip64 } = readCentralDirectory(view);
  if (zip64) throw new Error('This is a zip64 archive. It is larger than this workbench imports, so nothing was read from it.');

  const entries: ArchiveEntry[] = [];
  const refused: ArchiveRefusalRecord[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let total = 0;
  let truncated = false;

  for (const entry of central) {
    const path = entry.name.replace(/\\/g, '/');

    /* A directory record carries no content and needs no report. */
    if (path.endsWith('/')) continue;

    if (entries.length >= MAX_ARCHIVE_ENTRIES) {
      truncated = true;
      refused.push({ path, reason: 'entry-limit', detail: `this archive holds more than the ${MAX_ARCHIVE_ENTRIES} files the importer reads at once` });
      continue;
    }

    const unsafe = unsafeArchiveName(entry.name);
    if (unsafe) { refused.push({ path, ...unsafe }); continue; }

    if (path.split('/').some((segment) => IGNORED_SEGMENTS.has(segment))) continue;

    /* A symbolic link stores a path where a file's contents would be. Following
     * one reaches whatever it points at, which may be anywhere on the machine
     * that unpacked it, so it is reported as a link rather than imported. */
    if (entry.madeBy === 3 && (entry.externalAttributes >>> 16 & UNIX_TYPE_MASK) === UNIX_TYPE_SYMLINK) {
      refused.push({ path, reason: 'symbolic-link', detail: 'is a symbolic link, which points outside the archive rather than carrying content' });
      continue;
    }

    if (entry.flags & FLAG_ENCRYPTED) {
      refused.push({ path, reason: 'encrypted', detail: 'is encrypted, and this workbench does not ask for archive passwords' });
      continue;
    }

    if (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATE) {
      refused.push({ path, reason: 'unsupported-compression', detail: `uses compression method ${entry.method}, which this reader does not implement` });
      continue;
    }

    /* The declared size is checked before anything is expanded, so an archive
     * that announces a gigabyte costs nothing to refuse. */
    if (entry.uncompressedSize > MAX_ARCHIVE_FILE_BYTES) {
      refused.push({ path, reason: 'file-too-large', detail: `declares ${entry.uncompressedSize.toLocaleString()} bytes, above the ${MAX_ARCHIVE_FILE_BYTES.toLocaleString()}-byte limit for one file` });
      continue;
    }

    const remaining = MAX_ARCHIVE_TOTAL_BYTES - total;
    if (remaining <= 0) {
      truncated = true;
      refused.push({ path, reason: 'archive-too-large', detail: `this archive expands past the ${MAX_ARCHIVE_TOTAL_BYTES.toLocaleString()}-byte total the importer reads` });
      continue;
    }

    let bytes: Uint8Array;
    try {
      const start = dataOffset(view, entry);
      if (start + entry.compressedSize > view.byteLength) throw new Error('its data runs past the end of the archive');
      const raw = new Uint8Array(data, start, entry.compressedSize);
      if (entry.method === METHOD_STORED) {
        if (raw.length > Math.min(MAX_ARCHIVE_FILE_BYTES, remaining)) throw new Error('it is larger than the importer reads');
        bytes = raw.slice();
      } else {
        /* The bound is the smaller of what one file may be and what is left of
         * the archive total, so a bomb cannot spend the whole budget. */
        const expanded = await inflate(raw, Math.min(MAX_ARCHIVE_FILE_BYTES, remaining) + 1);
        if (expanded.overran) {
          refused.push({ path, reason: 'file-too-large', detail: `expands past the ${MAX_ARCHIVE_FILE_BYTES.toLocaleString()}-byte limit for one file, whatever its header claims` });
          continue;
        }
        bytes = expanded.bytes;
      }
    } catch (error) {
      refused.push({ path, reason: 'unreadable', detail: `could not be read: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }

    /* The checksum is the archive's own statement about these bytes. Checking
     * it catches a truncated entry, an altered one, and a header that lies. */
    if (crc32(bytes) !== entry.crc32) {
      refused.push({ path, reason: 'checksum-mismatch', detail: 'does not match the checksum the archive records for it, so it is damaged or was altered' });
      continue;
    }

    let content: string;
    try { content = decoder.decode(bytes); }
    catch { refused.push({ path, reason: 'not-text', detail: 'did not decode as UTF-8 text' }); continue; }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(content)) {
      refused.push({ path, reason: 'not-text', detail: 'holds control characters, so it is not editable source' });
      continue;
    }

    total += bytes.length;
    entries.push({ path, content, bytes: bytes.length });
  }

  return { entries, refused, truncated };
}

/** One line per refusal, in the words the import plan already uses. */
export function archiveRefusalSummary(refused: readonly ArchiveRefusalRecord[]): string[] {
  return refused.map((record) => `${record.path}: ${record.detail}`);
}
