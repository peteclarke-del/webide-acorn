import { describe, expect, it } from 'vitest';
import { extractDfsFile } from './dfsCatalogue';
import { createDfsImage, createDfsImageFromFiles, openDfsImageProject } from './dfsImage';

describe('deterministic DFS image writer', () => {
  it('packages one exact artifact and independently validates its catalogue and extent', () => {
    const bytes = Uint8Array.from([0xa9, 0x41, 0x20, 0xee, 0xff, 0x60]);
    const first = createDfsImage({ title: '8BIT DEV', name: 'PROOF', loadAddress: 0x1900, executionAddress: 0x1900, bytes });
    const second = createDfsImage({ title: '8BIT DEV', name: 'PROOF', loadAddress: 0x1900, executionAddress: 0x1900, bytes });
    expect(first.image.every((byte, index) => byte === second.image[index])).toBe(true);
    expect(first.image).toHaveLength(800 * 256);
    expect(first.catalogue).toMatchObject({ title: '8BIT DEV', declaredSectors: 800, imageSectors: 800, warnings: [] });
    expect(first.catalogue.files).toEqual([{ name: 'PROOF', directory: '$', locked: false, loadAddress: 0x1900, executionAddress: 0x1900, length: 6, startSector: 2 }]);
    expect(Array.from(first.image.slice(512, 518))).toEqual(Array.from(bytes));
  });

  it('rejects unsafe metadata, invalid addresses, empty files and capacity overflow', () => {
    const valid = { title: 'DISK', name: 'FILE', loadAddress: 0x1900, executionAddress: 0x1900, bytes: Uint8Array.of(0x60) };
    expect(() => createDfsImage({ ...valid, name: '../FILE' })).toThrow('directory or extension');
    expect(() => createDfsImage({ ...valid, loadAddress: 0x40000 })).toThrow('18-bit');
    expect(() => createDfsImage({ ...valid, bytes: new Uint8Array() })).toThrow('at least one');
    expect(() => createDfsImage({ ...valid, bytes: new Uint8Array(799 * 256) })).toThrow('needs 801 sectors but the disc declares 800');
  });

  it('writes boot metadata and byte-exact non-overlapping multi-file extents', () => {
    const created = createDfsImageFromFiles({ title: 'MULTI', cycle: 42, bootOption: 3, files: [
      { name: '!BOOT', directory: '$', loadAddress: 0, executionAddress: 0, bytes: new TextEncoder().encode('*RUN GAME\r') },
      { name: 'GAME', directory: '$', locked: true, loadAddress: 0x1900, executionAddress: 0x1900, bytes: new Uint8Array(300).map((_, index) => index & 0xff) },
    ] });
    expect(created.catalogue).toMatchObject({ title: 'MULTI', cycle: 42, bootOption: 3, warnings: [], files: [{ name: '!BOOT', startSector: 2 }, { name: 'GAME', locked: true, startSector: 3 }] });
    expect(new TextDecoder().decode(extractDfsFile(created.image, created.catalogue.files[0]!))).toBe('*RUN GAME\r');
    expect(extractDfsFile(created.image, created.catalogue.files[1]!)).toEqual(new Uint8Array(300).map((_, index) => index & 0xff));
    expect(() => createDfsImageFromFiles({ title: 'BAD', files: [
      { name: 'same', loadAddress: 0, executionAddress: 0, bytes: Uint8Array.of(1) }, { name: 'SAME', loadAddress: 0, executionAddress: 0, bytes: Uint8Array.of(2) },
    ] })).toThrow('Duplicate');
  });

  it('opens a valid SSD into editable logical files and rewrites equivalent content', () => {
    const source = createDfsImageFromFiles({ title: 'EDIT ME', cycle: 8, bootOption: 2, files: [
      { name: 'ONE', loadAddress: 0x1200, executionAddress: 0x1203, bytes: Uint8Array.of(1, 2, 3) },
      { name: 'TWO', directory: 'A', locked: true, loadAddress: 0x20000, executionAddress: 0x20010, bytes: new Uint8Array(400).fill(0x5a) },
    ] });
    const project = openDfsImageProject(source.image); expect(project).toMatchObject({ title: 'EDIT ME', cycle: 8, bootOption: 2, files: [{ name: 'ONE' }, { name: 'TWO', directory: 'A', locked: true }] });
    project.title = 'REWRITTEN'; project.bootOption = 3; project.files[0]!.name = 'BOOT';
    const rewritten = createDfsImageFromFiles(project); expect(rewritten.catalogue).toMatchObject({ title: 'REWRITTEN', bootOption: 3, warnings: [], files: [{ name: 'BOOT' }, { name: 'TWO' }] });
    expect(extractDfsFile(rewritten.image, rewritten.catalogue.files[1]!)).toEqual(new Uint8Array(400).fill(0x5a));
    const damaged = source.image.slice(); damaged[263] = 1;
    expect(() => openDfsImageProject(damaged)).toThrow('cannot be edited safely');
  });

  it('creates a valid empty catalogue for blank media and rejects more than 31 entries', () => {
    const empty = createDfsImageFromFiles({ title: 'EMPTY', cycle: 1, files: [] });
    expect(empty.catalogue).toMatchObject({ title: 'EMPTY', cycle: 1, files: [], warnings: [] });
    expect(() => createDfsImageFromFiles({ title: 'FULL', files: Array.from({ length: 32 }, (_, index) => ({ name: `F${index}`, loadAddress: 0, executionAddress: 0, bytes: Uint8Array.of(index) })) })).toThrow('no more than 31');
  });
});

describe('DFS unknown-metadata preservation', () => {
  /* An image carrying bytes this adapter does not model: the two unused bits of
   * the boot-option byte, and data after the last catalogue entry in both
   * catalogue sectors. */
  function imageWithUnknowns(): Uint8Array {
    const created = createDfsImageFromFiles({
      title: 'WATFORD', cycle: 7, bootOption: 3,
      files: [{ name: 'FIRST', loadAddress: 0x1900, executionAddress: 0x1900, bytes: Uint8Array.of(1, 2, 3) }],
    });
    const image = created.image.slice();
    image[256 + 6] = (image[256 + 6]! & 0xf3) | 0x0c;
    for (let offset = 16; offset < 256; offset += 1) {
      image[offset] = (offset * 3) & 0xff;
      image[256 + offset] = (offset * 5) & 0xff;
    }
    return image;
  }

  it('carries the declared geometry and the unmodelled catalogue bytes through an edit', () => {
    const original = imageWithUnknowns();
    const project = openDfsImageProject(original);
    expect(project.declaredSectors).toBe(800);
    expect(project.preserved?.optionBits).toBe(3);
    expect(project.preserved?.sector0Tail.offset).toBe(16);
    expect(project.preserved?.sector0Tail.bytes[0]).toBe((16 * 3) & 0xff);

    const rewritten = createDfsImageFromFiles(project);
    /* Both catalogue sectors come back byte for byte, which is the whole claim. */
    expect(Array.from(rewritten.image.subarray(0, 512))).toEqual(Array.from(original.subarray(0, 512)));
    expect(rewritten.preservedBytesOverwritten).toBeUndefined();
  });

  it('lets new catalogue entries claim preserved bytes and reports the overwrite', () => {
    const project = openDfsImageProject(imageWithUnknowns());
    const rewritten = createDfsImageFromFiles({
      ...project,
      files: [...project.files, { name: 'SECOND', loadAddress: 0x2000, executionAddress: 0x2000, bytes: Uint8Array.of(9) }],
    });
    expect(rewritten.catalogue.files.map((file) => file.name)).toEqual(['FIRST', 'SECOND']);
    /* One extra entry claims eight bytes in each of the two catalogue sectors. */
    expect(rewritten.preservedBytesOverwritten).toBe(16);
    /* Everything past the new catalogue is still the original data. */
    expect(Array.from(rewritten.image.subarray(24, 256))).toEqual(Array.from(imageWithUnknowns().subarray(24, 256)));
  });

  it('writes a 40-track image when the catalogue declares one, rather than assuming 80', () => {
    const created = createDfsImageFromFiles({
      title: 'FORTY', declaredSectors: 400,
      files: [{ name: 'PROG', loadAddress: 0x1900, executionAddress: 0x1900, bytes: Uint8Array.of(0x60) }],
    });
    expect(created.image.length).toBe(400 * 256);
    expect(created.catalogue.declaredSectors).toBe(400);
    expect(created.catalogue.warnings).toEqual([]);
    const reopened = openDfsImageProject(created.image);
    expect(reopened.declaredSectors).toBe(400);
    expect(createDfsImageFromFiles(reopened).image.length).toBe(400 * 256);
  });

  it('refuses a file set that does not fit the declared geometry, naming both numbers', () => {
    expect(() => createDfsImageFromFiles({
      title: 'FORTY', declaredSectors: 400,
      files: [{ name: 'BIG', loadAddress: 0x1900, executionAddress: 0x1900, bytes: new Uint8Array(399 * 256) }],
    })).toThrow('needs 401 sectors but the disc declares 400');
  });

  it('refuses a declared geometry a DFS catalogue could not express', () => {
    const files = [{ name: 'P', loadAddress: 0, executionAddress: 0, bytes: Uint8Array.of(1) }];
    expect(() => createDfsImageFromFiles({ title: 'X', declaredSectors: 1, files })).toThrow('between 2 and 1023');
    expect(() => createDfsImageFromFiles({ title: 'X', declaredSectors: 1024, files })).toThrow('between 2 and 1023');
  });
});
