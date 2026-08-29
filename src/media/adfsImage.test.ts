import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { extractAdfsFile, parseAdfsCatalogue } from './adfsCatalogue';
import { createAdfsEDisc, createAdfsEImage } from './adfsImage';

describe('deterministic ADFS E image writer', () => {
  it('round-trips an exact typed file through the independent new-map reader', () => {
    const bytes = new TextEncoder().encode('RISC OS application payload');
    const first = createAdfsEImage({ title: 'WEBIDE', name: 'RunImage', filetype: 0xff8, bytes });
    const second = createAdfsEImage({ title: 'WEBIDE', name: 'RunImage', filetype: 0xff8, bytes });
    expect(first.image.every((byte, index) => byte === second.image[index])).toBe(true); expect(first.image).toHaveLength(819200);
    const catalogue = parseAdfsCatalogue(first.image); expect(catalogue).toMatchObject({ format: 'ADFS E', title: 'WEBIDE', warnings: [], entries: [{ name: 'RunImage', filetype: 0xff8, length: bytes.length, discAddress: 0x301 }] });
    expect(Array.from(extractAdfsFile(first.image, catalogue.entries[0]!))).toEqual(Array.from(bytes));
  });

  it('rejects unsafe metadata and files which exceed the bounded one-file layout', () => {
    expect(() => createAdfsEImage({ title: 'WEBIDE', name: '../BAD', filetype: 0xff8, bytes: new Uint8Array() })).toThrow('without dots');
    expect(() => createAdfsEImage({ title: 'WEBIDE', name: 'FILE', filetype: 0x1000, bytes: new Uint8Array() })).toThrow('filetype');
    expect(() => createAdfsEImage({ title: 'WEBIDE', name: 'FILE', filetype: 0xff8, bytes: new Uint8Array(814000) })).toThrow(/more than an 800 KiB ADFS E image has room for/);
  });

  it('still writes the exact image that passed the RISC OS 3.11 execution gate', () => {
    /* A real machine loaded and ran an image from this writer. That evidence is
     * about specific bytes, so a change to the layout invalidates it whether or
     * not the catalogue still parses. This digest is what makes such a change
     * announce itself instead of quietly retiring the acceptance run. */
    const image = createAdfsEImage({ title: 'DiscDemo', name: 'DiscDemo', filetype: 0xff8, executionAddress: 0x8000, bytes: new Uint8Array(1024).fill(0xe1) }).image;
    expect(createHash('sha256').update(image).digest('hex')).toBe('e294e3faaf5e1631d4a9c90ebd4f2d6d7390645175e7dc656c0852e3e217cdb1');
  });
});

describe('a whole disc of files', () => {
  const payload = (fill: number, length: number) => new Uint8Array(length).fill(fill);

  it('places every file, and each one reads back exactly through the independent reader', () => {
    const files = [
      { name: 'Sprites', bytes: payload(0x11, 3000), filetype: 0xff9 },
      { name: '!Run', bytes: payload(0x22, 90), filetype: 0xfeb },
      { name: 'RunImage', bytes: payload(0x33, 40000), filetype: 0xff8, executionAddress: 0x8000 },
    ];
    const created = createAdfsEDisc({ title: 'WEBIDE', files });
    expect(created.catalogue.warnings).toEqual([]);
    for (const file of files) {
      const entry = created.catalogue.entries.find((candidate) => candidate.name === file.name);
      expect(entry).toBeDefined();
      expect(entry!.length).toBe(file.bytes.length);
      expect(Array.from(extractAdfsFile(created.image, entry!))).toEqual(Array.from(file.bytes));
    }
  });

  it('sorts the catalogue, so the order files were handed over never shows up on the disc', () => {
    /* ADFS keeps a directory sorted and its own reader warns when one is not,
     * so accepting the caller's order would produce a disc that complains
     * about itself. */
    const files = [
      { name: 'Zebra', bytes: payload(1, 100), filetype: 0xffd },
      { name: 'apple', bytes: payload(2, 100), filetype: 0xffd },
      { name: 'Mango', bytes: payload(3, 100), filetype: 0xffd },
    ];
    const forwards = createAdfsEDisc({ title: 'WEBIDE', files });
    const backwards = createAdfsEDisc({ title: 'WEBIDE', files: [...files].reverse() });
    expect(forwards.catalogue.entries.map((entry) => entry.name)).toEqual(['apple', 'Mango', 'Zebra']);
    expect(Array.from(forwards.image)).toEqual(Array.from(backwards.image));
  });

  it('gives every file its own fragment, so no two files share storage', () => {
    const created = createAdfsEDisc({
      title: 'WEBIDE',
      files: [
        { name: 'One', bytes: payload(1, 5000), filetype: 0xffd },
        { name: 'Two', bytes: payload(2, 5000), filetype: 0xffd },
        { name: 'Three', bytes: payload(3, 5000), filetype: 0xffd },
      ],
    });
    const fragments = created.catalogue.entries.map((entry) => entry.discAddress >>> 8);
    expect(new Set(fragments).size).toBe(fragments.length);
    expect(fragments).not.toContain(2);
  });

  it('refuses two names that ADFS would not tell apart', () => {
    expect(() => createAdfsEDisc({ title: 'WEBIDE', files: [
      { name: 'Data', bytes: payload(1, 10), filetype: 0xffd },
      { name: 'DATA', bytes: payload(2, 10), filetype: 0xffd },
    ] })).toThrow(/does not distinguish names by case/);
  });

  it('says by how much a disc is over capacity rather than only that it is', () => {
    expect(() => createAdfsEDisc({ title: 'WEBIDE', files: [
      { name: 'Big', bytes: payload(1, 500000), filetype: 0xffd },
      { name: 'Also', bytes: payload(2, 400000), filetype: 0xffd },
    ] })).toThrow(/\d[\d,]* bytes more than an 800 KiB ADFS E image has room for/);
  });

  it('refuses more objects than a root directory can hold, and an empty disc', () => {
    const many = Array.from({ length: 78 }, (_, index) => ({ name: `F${index}`, bytes: payload(index & 0xff, 10), filetype: 0xffd }));
    expect(() => createAdfsEDisc({ title: 'WEBIDE', files: many })).toThrow(/at most 77 objects/);
    expect(() => createAdfsEDisc({ title: 'WEBIDE', files: [] })).toThrow(/at least one file/);
  });

  it('writes subdirectories, and every file in them reads back exactly', () => {
    /* A RISC OS application is a directory with things inside it, so a writer
     * that could only fill the root could not produce one. */
    const created = createAdfsEDisc({
      title: 'WEBIDE',
      files: [
        { name: 'ReadMe', bytes: new TextEncoder().encode('notes'), filetype: 0xfff },
        { name: '!Demo', children: [
          { name: '!Run', bytes: new TextEncoder().encode('Run <Obey$Dir>.RunImage\n'), filetype: 0xfeb },
          { name: 'RunImage', bytes: payload(0x44, 6000), filetype: 0xff8, executionAddress: 0x8000 },
          { name: 'Resources', children: [
            { name: 'Sprites', bytes: payload(0x55, 1500), filetype: 0xff9 },
          ] },
        ] },
      ],
    });
    expect(created.catalogue.warnings).toEqual([]);
    const root = created.catalogue.entries;
    expect(root.map((entry) => entry.name)).toEqual(['!Demo', 'ReadMe']);
    const application = root[0]!;
    expect(application.directory).toBe(true);
    expect(application.children!.map((entry) => entry.name)).toEqual(['!Run', 'Resources', 'RunImage']);
    const runImage = application.children!.find((entry) => entry.name === 'RunImage')!;
    expect(runImage.filetype).toBe(0xff8);
    expect(Array.from(extractAdfsFile(created.image, runImage))).toEqual(Array.from(payload(0x44, 6000)));
    const sprites = application.children!.find((entry) => entry.name === 'Resources')!.children!.find((entry) => entry.name === 'Sprites')!;
    expect(Array.from(extractAdfsFile(created.image, sprites))).toEqual(Array.from(payload(0x55, 1500)));
  });

  it('refuses a tree nested deeper than its own reader will descend', () => {
    /* A disc this build could write and could not read back would be a disc
     * whose correctness nothing here can check. */
    let node: { name: string; children: unknown[] } = { name: 'Leaf', children: [{ name: 'File', bytes: payload(1, 8), filetype: 0xffd }] };
    for (let depth = 0; depth < 20; depth += 1) node = { name: `D${depth}`, children: [node] };
    expect(() => createAdfsEDisc({ title: 'WEBIDE', files: [node as never] })).toThrow(/nested deeper than 16 directories/);
  });

  it('names the directory that holds two objects ADFS would not tell apart', () => {
    expect(() => createAdfsEDisc({ title: 'WEBIDE', files: [
      { name: 'Apps', children: [
        { name: 'Thing', bytes: payload(1, 8), filetype: 0xffd },
        { name: 'THING', bytes: payload(2, 8), filetype: 0xffd },
      ] },
    ] })).toThrow(/\$\.Apps holds two objects called THING/);
  });

  it('writes the lock bit when a file is asked for locked', () => {
    const created = createAdfsEDisc({ title: 'WEBIDE', files: [{ name: 'Fixed', bytes: payload(7, 64), filetype: 0xffd, locked: true }] });
    expect(created.catalogue.entries[0]!.locked).toBe(true);
  });
});
