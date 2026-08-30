// @vitest-environment node

/* The contracts an in-place ADFS edit has to meet: the change lands, everything
 * else in the image is untouched, the bytes this build does not model survive,
 * and anything that would produce an unmountable disc is refused outright
 * rather than returned with a warning.
 */
import { describe, expect, it } from 'vitest';
import { createAdfsEImage } from './adfsImage';
import { extractAdfsFile, parseAdfsCatalogue } from './adfsCatalogue';
import { AdfsEditError, adfsNameProblem, editAdfsEntry } from './adfsEdit';

function image(): Uint8Array {
  return createAdfsEImage({
    title: 'PROOF',
    name: 'PROOF',
    filetype: 0xff8,
    executionAddress: 0x8000,
    bytes: new Uint8Array(512).fill(0x60),
  }).image;
}

const only = (bytes: Uint8Array) => parseAdfsCatalogue(bytes).entries[0]!;

describe('changing one entry', () => {
  it('changes the load and execution addresses and nothing else about the object', () => {
    const original = image();
    const entry = only(original);
    const result = editAdfsEntry(original, entry.path, { loadAddress: 0xfff00000, executionAddress: 0x1234 });
    const edited = only(result.image);
    expect(edited.loadAddress).toBe(0xfff00000);
    expect(edited.executionAddress).toBe(0x1234);
    expect(edited.length).toBe(entry.length);
    expect(edited.discAddress).toBe(entry.discAddress);
    expect(Array.from(extractAdfsFile(result.image, edited))).toEqual(Array.from(extractAdfsFile(original, entry)));
  });

  it('locks and unlocks without disturbing the other attribute bits', () => {
    const original = image();
    const entry = only(original);
    const locked = editAdfsEntry(original, entry.path, { locked: true }).image;
    expect(only(locked).locked).toBe(true);
    expect(only(locked).attributes & ~0x04).toBe(entry.attributes & ~0x04);
    const unlocked = editAdfsEntry(locked, entry.path, { locked: false }).image;
    expect(only(unlocked).locked).toBe(false);
    expect(only(unlocked).attributes).toBe(entry.attributes & ~0x04);
  });

  it('renames an object, and the renamed object still holds the same bytes', () => {
    const original = image();
    const entry = only(original);
    const result = editAdfsEntry(original, entry.path, { name: 'RENAMED' });
    const edited = only(result.image);
    expect(edited.name).toBe('RENAMED');
    expect(Array.from(extractAdfsFile(result.image, edited))).toEqual(Array.from(extractAdfsFile(original, entry)));
  });

  it('leaves the image identical outside the one directory block it edits', () => {
    /* An edit that quietly rewrote the free-space map, or renumbered a sector,
     * would still pass every check above. This is the one that notices. */
    const original = image();
    const entry = only(original);
    const edited = editAdfsEntry(original, entry.path, { executionAddress: 0x4321 }).image;
    const differing: number[] = [];
    for (let offset = 0; offset < original.length; offset += 1) {
      if (original[offset] !== edited[offset]) differing.push(offset);
    }
    expect(differing.length).toBeGreaterThan(0);
    const root = 0x800;
    expect(differing.every((offset) => offset >= root && offset < root + 0x800)).toBe(true);
  });

  it('advances the update sequence, which is how a machine notices a cached directory is stale', () => {
    const original = image();
    const entry = only(original);
    const before = parseAdfsCatalogue(original).sequence;
    const after = parseAdfsCatalogue(editAdfsEntry(original, entry.path, { locked: true }).image).sequence;
    expect(after).toBe((before + 1) & 0xff);
  });

  it('reports the warnings the re-parsed image raises rather than its own idea of them', () => {
    const original = image();
    const result = editAdfsEntry(original, only(original).path, { locked: true });
    expect(result.warnings).toEqual(parseAdfsCatalogue(result.image).warnings);
  });

  it('does not modify the image it was given', () => {
    const original = image();
    const before = Array.from(original);
    editAdfsEntry(original, only(original).path, { name: 'OTHER' });
    expect(Array.from(original)).toEqual(before);
  });
});

describe('what an edit refuses', () => {
  it('refuses a name ADFS cannot hold, naming the character and why', () => {
    const original = image();
    const path = only(original).path;
    expect(() => editAdfsEntry(original, path, { name: 'A.B' })).toThrow(/path or wildcard character/);
    expect(() => editAdfsEntry(original, path, { name: 'ELEVENCHARS' })).toThrow(/at most 10 characters/);
    expect(() => editAdfsEntry(original, path, { name: '' })).toThrow(/cannot be empty/);
  });

  it('refuses an address that is not a 32-bit value', () => {
    const original = image();
    const path = only(original).path;
    expect(() => editAdfsEntry(original, path, { loadAddress: -1 })).toThrow(/32-bit value/);
    expect(() => editAdfsEntry(original, path, { executionAddress: 2 ** 32 })).toThrow(/32-bit value/);
  });

  it('refuses a path that names nothing on this disc', () => {
    const original = image();
    expect(() => editAdfsEntry(original, '$.NoSuch', {})).toThrow(AdfsEditError);
    expect(() => editAdfsEntry(original, '$.Missing.Deeper', {})).toThrow(/no directory \$\.Missing/);
  });

  it('refuses a bare name, because a path starts at the root', () => {
    expect(() => editAdfsEntry(image(), 'JustAName', {})).toThrow(/not a full ADFS path/);
  });
});

describe('names ADFS can hold', () => {
  it('accepts an ordinary name and refuses each character the filing system claims', () => {
    expect(adfsNameProblem('Sprites')).toBeNull();
    for (const character of ['.', ':', '*', '#', '$', '&', '@', '^', '%', '\\']) {
      expect(adfsNameProblem(`A${character}B`)).toMatch(/path or wildcard/);
    }
    expect(adfsNameProblem('A\u0001B')).toMatch(/cannot type/);
  });
});
