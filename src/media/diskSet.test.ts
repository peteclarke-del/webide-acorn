import { describe, expect, it } from 'vitest';
import { parseDfsCatalogue, extractDfsFile } from './dfsCatalogue';
import { splitDfsDsdImage } from './dfsDsdImage';
import {
  DFS_MAX_CATALOGUE_ENTRIES,
  DFS_SECTOR_SIZE,
  DISK_SET_SCHEMA,
  buildDiskSet,
  diskSetBuildPlan,
  diskSetSideQuota,
  diskSetSummary,
  generatedBootText,
  validateDiskSet,
  type DiskSetResolvedEntry,
} from './diskSet';

const entry = (id: string, name: string, targetId = 'game') => ({ id, name, source: { kind: 'build-target', targetId } });

const singleSided = {
  schema: DISK_SET_SCHEMA, version: 1, id: 'set', name: 'Acorn Harvest release',
  discs: [{
    id: 'disc-1', label: 'Harvest', format: 'dfs-ssd',
    sides: [{ title: 'HARVEST', entries: [entry('a', 'GAME'), entry('b', 'LOADER', 'loader')], boot: { action: 'run', entryId: 'b' } }],
  }],
};

const resolved = (sizes: Record<string, number>): Map<string, DiskSetResolvedEntry> => new Map(
  Object.entries(sizes).map(([id, size]) => [id, { bytes: Uint8Array.from({ length: size }, (_, index) => (index + id.charCodeAt(0)) & 0xff), loadAddress: 0x1900, executionAddress: 0x1900 }]),
);

describe('disk sets', () => {
  it('validates a set and freezes what it returns', () => {
    const set = validateDiskSet(singleSided);
    expect(set.name).toBe('Acorn Harvest release');
    expect(set.discs[0]!.sides[0]!.entries.map((item) => item.name)).toEqual(['GAME', 'LOADER']);
    expect(Object.isFrozen(set)).toBe(true);
  });

  it('defaults a directory to the DFS root rather than leaving it unset', () => {
    const set = validateDiskSet(singleSided);
    expect(set.discs[0]!.sides[0]!.entries[0]!.directory).toBe('$');
  });

  it('explains exactly what is wrong with a set it refuses', () => {
    expect(() => validateDiskSet({ ...singleSided, schema: 'other' })).toThrow(/must declare schema/);
    expect(() => validateDiskSet({ ...singleSided, version: 2 })).toThrow(/version 1 is required/);
    expect(() => validateDiskSet({ ...singleSided, discs: [] })).toThrow(/at least one disc/);
    expect(() => validateDiskSet({
      ...singleSided,
      discs: [{ ...singleSided.discs[0], format: 'dfs-dsd' }],
    })).toThrow(/exactly 2 sides/);
    expect(() => validateDiskSet({
      ...singleSided,
      discs: [{ ...singleSided.discs[0], sides: [{ title: 'X', entries: [entry('a', 'GAME'), entry('b', 'GAME')], boot: { action: 'none' } }] }],
    })).toThrow(/would write \$\.GAME twice/);
    expect(() => validateDiskSet({
      ...singleSided,
      discs: [{ ...singleSided.discs[0], sides: [{ title: 'X', entries: [entry('a', 'TOOLONGNAME')], boot: { action: 'none' } }] }],
    })).toThrow(/1 to 7 printable/);
    expect(() => validateDiskSet({
      ...singleSided,
      discs: [{ ...singleSided.discs[0], sides: [{ title: 'X', entries: [entry('a', 'GAME')], boot: { action: 'run' } }] }],
    })).toThrow(/names no file to act on/);
    expect(() => validateDiskSet({
      ...singleSided,
      discs: [{ ...singleSided.discs[0], sides: [{ title: 'X', entries: [entry('a', 'GAME')], boot: { action: 'run', entryId: 'missing' } }] }],
    })).toThrow(/which is not on that side/);
    expect(() => validateDiskSet({
      ...singleSided,
      discs: [{ ...singleSided.discs[0], sides: [{ title: 'X', entries: [{ id: 'a', name: 'GAME', source: { kind: 'somewhere' } }], boot: { action: 'none' } }] }],
    })).toThrow(/unknown source/);
  });

  it('names the build targets once each, in the order they are first needed', () => {
    const set = validateDiskSet({
      ...singleSided,
      discs: [
        { id: 'one', label: 'One', format: 'dfs-ssd', sides: [{ title: 'ONE', entries: [entry('a', 'GAME', 'game'), entry('b', 'LOAD', 'loader')], boot: { action: 'none' } }] },
        { id: 'two', label: 'Two', format: 'dfs-ssd', sides: [{ title: 'TWO', entries: [entry('c', 'GAME2', 'game'), entry('d', 'EXTRA', 'extra')], boot: { action: 'none' } }] },
      ],
    });
    expect(diskSetBuildPlan(set)).toEqual(['game', 'loader', 'extra']);
  });

  it('sizes a side by whole sectors, because that is how DFS allocates', () => {
    const set = validateDiskSet(singleSided);
    const quota = diskSetSideQuota(set.discs[0]!.sides[0]!, new Map([['a', 1], ['b', DFS_SECTOR_SIZE + 1]]));
    expect(quota.usedBytes).toBe(1 + DFS_SECTOR_SIZE + 1);
    expect(quota.usedSectors).toBe(1 + 2);
    expect(quota.fits).toBe(true);
    expect(quota.reasons).toEqual([]);
  });

  it('quantifies the shortfall when a side does not fit, before anything is written', () => {
    const set = validateDiskSet(singleSided);
    const quota = diskSetSideQuota(set.discs[0]!.sides[0]!, new Map([['a', 200 * 1024], ['b', 8 * 1024]]));
    expect(quota.fits).toBe(false);
    expect(quota.overflowBytes).toBeGreaterThan(0);
    expect(quota.reasons.join(' ')).toMatch(/sectors more than the 798 a DFS side holds/);
  });

  it('says a side cannot be sized yet rather than reporting a wrong total', () => {
    const set = validateDiskSet(singleSided);
    const quota = diskSetSideQuota(set.discs[0]!.sides[0]!, new Map([['a', 512]]));
    expect(quota.fits).toBe(false);
    expect(quota.reasons.join(' ')).toContain('no bytes yet');
  });

  it('refuses a side that names more files than a DFS catalogue holds', () => {
    const entries = Array.from({ length: DFS_MAX_CATALOGUE_ENTRIES + 1 }, (_, index) => entry(`e${index}`, `F${index}`));
    expect(() => validateDiskSet({
      ...singleSided,
      discs: [{ ...singleSided.discs[0], sides: [{ title: 'X', entries, boot: { action: 'none' } }] }],
    })).toThrow(/more than the 31 entries/);
  });

  it('writes a single-sided image whose catalogue reads back byte for byte', () => {
    const set = validateDiskSet(singleSided);
    const supplied = resolved({ a: 700, b: 40 });
    const built = buildDiskSet(set, supplied);
    expect(built.discs).toHaveLength(1);
    expect(built.discs[0]!.filename).toBe('Harvest.ssd');
    const catalogue = parseDfsCatalogue(built.discs[0]!.image);
    expect(catalogue.warnings).toEqual([]);
    expect(catalogue.title).toBe('HARVEST');
    expect(catalogue.bootOption).toBe(2);
    expect(catalogue.files.map((file) => file.name)).toEqual(['GAME', 'LOADER']);
    for (const file of catalogue.files) {
      const id = file.name === 'GAME' ? 'a' : 'b';
      expect(Array.from(extractDfsFile(built.discs[0]!.image, file))).toEqual(Array.from(supplied.get(id)!.bytes));
    }
  });

  it('writes both sides of a double-sided image independently', () => {
    const set = validateDiskSet({
      ...singleSided,
      discs: [{
        id: 'disc-1', label: 'Two sides', format: 'dfs-dsd',
        sides: [
          { title: 'SIDE0', entries: [entry('a', 'GAME')], boot: { action: 'exec', entryId: 'a' } },
          { title: 'SIDE2', entries: [entry('b', 'DATA', 'data')], boot: { action: 'none' } },
        ],
      }],
    });
    const supplied = resolved({ a: 300, b: 900 });
    const built = buildDiskSet(set, supplied);
    expect(built.discs[0]!.filename).toBe('Two-sides.dsd');
    const [side0, side2] = splitDfsDsdImage(built.discs[0]!.image);
    expect(parseDfsCatalogue(side0).title).toBe('SIDE0');
    expect(parseDfsCatalogue(side0).bootOption).toBe(3);
    expect(parseDfsCatalogue(side2).title).toBe('SIDE2');
    expect(Array.from(extractDfsFile(side2, parseDfsCatalogue(side2).files[0]!))).toEqual(Array.from(supplied.get('b')!.bytes));
  });

  it('refuses to write a disc that is missing bytes it declares, naming the file', () => {
    const set = validateDiskSet(singleSided);
    expect(() => buildDiskSet(set, resolved({ a: 100 }))).toThrow(/\$\.LOADER but no bytes were supplied/);
  });

  it('lets an entry override the artifact addresses without changing the artifact', () => {
    const set = validateDiskSet({
      ...singleSided,
      discs: [{ ...singleSided.discs[0], sides: [{ title: 'X', entries: [{ ...entry('a', 'GAME'), loadAddress: 0x2000, executionAddress: 0x2003 }], boot: { action: 'none' } }] }],
    });
    const built = buildDiskSet(set, resolved({ a: 64 }));
    const file = parseDfsCatalogue(built.discs[0]!.image).files[0]!;
    expect(file.loadAddress).toBe(0x2000);
    expect(file.executionAddress).toBe(0x2003);
  });

  it('generates a boot file that runs the other files on the side, in order', () => {
    const set = validateDiskSet({
      ...singleSided,
      discs: [{
        ...singleSided.discs[0],
        sides: [{
          title: 'X',
          entries: [
            { id: 'boot', name: '!BOOT', source: { kind: 'generated-boot' } },
            entry('a', 'GAME'),
            { ...entry('b', 'MUSIC', 'music'), directory: 'M' },
          ],
          boot: { action: 'exec', entryId: 'boot' },
        }],
      }],
    });
    expect(generatedBootText(set.discs[0]!.sides[0]!)).toBe('*RUN GAME\r*RUN M.MUSIC\r');
  });

  it('summarises the whole set in one line', () => {
    const set = validateDiskSet(singleSided);
    expect(diskSetSummary(set)).toBe('1 disc · 1 side · 2 files · 2 build targets');
  });

  it('turns a label into a safe filename without losing the label', () => {
    const set = validateDiskSet({ ...singleSided, discs: [{ ...singleSided.discs[0], label: 'Harvest / v1.0 (release)' }] });
    const built = buildDiskSet(set, resolved({ a: 10, b: 10 }));
    expect(built.discs[0]!.label).toBe('Harvest / v1.0 (release)');
    expect(built.discs[0]!.filename).toBe('Harvest-v1.0-release.ssd');
  });
});
