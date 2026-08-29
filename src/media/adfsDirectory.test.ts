// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createAdfsEImage } from './adfsImage';
import { adfsDirectoryCheckByte, parseAdfsCatalogue } from './adfsCatalogue';
import {
  preserveAdfsDirectory,
  rewriteAdfsDirectory,
  usedEntryCount,
  writeAdfsDirectory,
} from './adfsDirectory';

const DIRECTORY_SIZE = 0x800;
const ROOT_OFFSET = 0x800;

/* A real image, built by the product's own writer, so the round trip is
 * checked against something a machine would actually mount. */
function image(): Uint8Array {
  return createAdfsEImage({
    title: 'PROOF',
    name: 'PROOF',
    filetype: 0xff8,
    executionAddress: 0x8000,
    bytes: new Uint8Array(512).fill(0x60),
  }).image;
}

const rootOf = (bytes: Uint8Array) => bytes.slice(ROOT_OFFSET, ROOT_OFFSET + DIRECTORY_SIZE);

describe('what a directory is using', () => {
  it('counts entries up to the terminator, not to the end of the slots', () => {
    const root = rootOf(image());
    expect(usedEntryCount(root)).toBe(1);
  });

  it('refuses anything that is not exactly one directory block', () => {
    expect(() => preserveAdfsDirectory(new Uint8Array(1024))).toThrow(/exactly 2 KiB/);
  });
});

describe('rewriting a directory that has not changed', () => {
  it('produces the same bytes, which is the only proof the preservation is real', () => {
    /* A rewrite that only restores the modelled fields still mounts and still
     * lists the same files, so nothing short of a byte comparison distinguishes
     * a correct adapter from one that quietly discarded somebody else's data. */
    const bytes = image();
    const root = rootOf(bytes);
    const catalogue = parseAdfsCatalogue(bytes);
    const result = rewriteAdfsDirectory(root, catalogue, catalogue.entries);
    expect(Array.from(result.directory)).toEqual(Array.from(root));
    expect(result.preservedBytesOverwritten).toBe(0);
  });

  it('carries the remnant left in a name field after its terminator', () => {
    /* A short name ends with a carriage return and the rest of the ten-byte
     * field is whatever the previous occupant of that slot left there. Every
     * other byte of an entry is modelled, so this is the whole of what an entry
     * can carry that this adapter does not understand — and a writer that
     * padded the field out would destroy all of it while still producing an
     * image that mounts and lists correctly. */
    const bytes = image();
    const root = rootOf(bytes);
    const nameField = 5;
    const terminator = root.indexOf(0x0d, nameField);
    expect(terminator).toBeGreaterThan(nameField);
    expect(terminator).toBeLessThan(nameField + 10);
    root[terminator + 1] = 0xbe;
    root[terminator + 2] = 0xef;
    root[root.length - 1] = adfsDirectoryCheckByte(root);

    const catalogue = parseAdfsCatalogue(bytes);
    const rewritten = rewriteAdfsDirectory(root, catalogue, catalogue.entries).directory;
    expect(Array.from(rewritten)).toEqual(Array.from(root));
  });

  it('writes a fresh name field when the entry was renamed, because the remnant was the old name\'s', () => {
    const bytes = image();
    const root = rootOf(bytes);
    const terminator = root.indexOf(0x0d, 5);
    root[terminator + 1] = 0xbe;
    root[root.length - 1] = adfsDirectoryCheckByte(root);

    const catalogue = parseAdfsCatalogue(bytes);
    const renamed = catalogue.entries.map((entry) => ({ ...entry, name: 'RENAMED' }));
    const rewritten = rewriteAdfsDirectory(root, catalogue, renamed).directory;
    /* The new name, then a terminator, then nothing carried over from before. */
    expect(Array.from(rewritten.slice(5, 5 + 10))).toEqual([...'RENAMED'].map((character) => character.charCodeAt(0)).concat([0x0d, 0, 0]));
  });

  it('carries bytes in unused entry slots that no field of this adapter reads', () => {
    /* Remnants of earlier entries live here. They mean nothing to this build
     * and may mean something to whatever wrote them. */
    const bytes = image();
    const root = rootOf(bytes);
    const marker = 0xa5;
    root[5 + 26 * 40] = marker;
    root[5 + 26 * 41 + 3] = marker;

    const catalogue = parseAdfsCatalogue(bytes);
    const result = rewriteAdfsDirectory(root, catalogue, catalogue.entries);
    expect(result.directory[5 + 26 * 40]).toBe(marker);
    expect(result.directory[5 + 26 * 41 + 3]).toBe(marker);
  });

  it('carries tail bytes this adapter does not interpret', () => {
    const bytes = image();
    const root = rootOf(bytes);
    const tailOffset = 5 + 26 * 77;
    /* The three bytes after the end marker are a parent pointer this build
     * does not model. */
    root[tailOffset + 3] = 0x11;
    root[tailOffset + 4] = 0x22;
    root[tailOffset + 5] = 0x33;

    const catalogue = parseAdfsCatalogue(bytes);
    const result = rewriteAdfsDirectory(root, catalogue, catalogue.entries);
    expect(Array.from(result.directory.subarray(tailOffset + 3, tailOffset + 6))).toEqual([0x11, 0x22, 0x33]);
  });

  it('recomputes the check byte rather than carrying a stale one', () => {
    /* The check byte is a function of the bytes around it, so carrying it
     * would produce an image that fails its own validation. */
    const bytes = image();
    const root = rootOf(bytes);
    const catalogue = parseAdfsCatalogue(bytes);
    const changed = catalogue.entries.map((entry) => ({ ...entry, length: entry.length + 256 }));
    const result = writeAdfsDirectory(changed, catalogue, preserveAdfsDirectory(root));
    expect(result.directory[DIRECTORY_SIZE - 1]).not.toBe(root[DIRECTORY_SIZE - 1]);

    /* And the rewritten image still parses, which is what the check byte is
     * for. */
    const rebuilt = bytes.slice();
    rebuilt.set(result.directory, ROOT_OFFSET);
    expect(() => parseAdfsCatalogue(rebuilt)).not.toThrow();
  });
});

describe('a directory that changed size', () => {
  it('reports the preserved bytes a larger catalogue had to claim', () => {
    /* Losing them is a real loss even when it is unavoidable, so the count is
     * returned rather than the overwrite being silent. */
    const bytes = image();
    const root = rootOf(bytes);
    const catalogue = parseAdfsCatalogue(bytes);
    const entry = catalogue.entries[0]!;
    const grown = Array.from({ length: 20 }, (_, index) => ({ ...entry, name: `FILE${index}`, path: `$.FILE${index}` }));
    const result = writeAdfsDirectory(grown, catalogue, preserveAdfsDirectory(root));
    expect(result.preservedBytesOverwritten).toBe(19 * 26);
  });

  it('leaves an earlier remnant where it was when the catalogue shrinks', () => {
    const bytes = image();
    const root = rootOf(bytes);
    const marker = 0x5a;
    root[0x7c0] = marker;
    const catalogue = parseAdfsCatalogue(bytes);
    const result = writeAdfsDirectory([], catalogue, preserveAdfsDirectory(root));
    expect(result.directory[0x7c0]).toBe(marker);
    expect(result.preservedBytesOverwritten).toBe(0);
  });

  it('refuses more objects than a directory can hold rather than truncating', () => {
    const bytes = image();
    const catalogue = parseAdfsCatalogue(bytes);
    const entry = catalogue.entries[0]!;
    const tooMany = Array.from({ length: 78 }, (_, index) => ({ ...entry, name: `F${index}` }));
    expect(() => writeAdfsDirectory(tooMany, catalogue, preserveAdfsDirectory(rootOf(bytes))))
      .toThrow(/at most 77 objects/);
  });
});

describe('what a rewrite is allowed to change', () => {
  it('writes the modelled fields over the preserved bytes rather than under them', () => {
    const bytes = image();
    const root = rootOf(bytes);
    const catalogue = parseAdfsCatalogue(bytes);
    const renamed = catalogue.entries.map((entry) => ({ ...entry, name: 'Renamed', length: 4096 }));
    const result = writeAdfsDirectory(renamed, { ...catalogue, title: 'NEWTITLE' }, preserveAdfsDirectory(root));

    const rebuilt = bytes.slice();
    rebuilt.set(result.directory, ROOT_OFFSET);
    const reparsed = parseAdfsCatalogue(rebuilt);
    expect(reparsed.entries[0]!.name).toBe('Renamed');
    expect(reparsed.entries[0]!.length).toBe(4096);
    expect(reparsed.title).toBe('NEWTITLE');
  });

  it('round-trips through the real parser, so a rewrite stays mountable', () => {
    const bytes = image();
    const catalogue = parseAdfsCatalogue(bytes);
    const result = rewriteAdfsDirectory(rootOf(bytes), catalogue, catalogue.entries);
    const rebuilt = bytes.slice();
    rebuilt.set(result.directory, ROOT_OFFSET);
    const reparsed = parseAdfsCatalogue(rebuilt);
    expect(reparsed.warnings).toEqual(catalogue.warnings);
    expect(reparsed.entries.map((entry) => entry.path)).toEqual(catalogue.entries.map((entry) => entry.path));
  });
});
