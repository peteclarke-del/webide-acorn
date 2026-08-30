// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  MAX_BUILD_CONCURRENCY,
  PRODUCT_LIMITS,
  formatLimit,
  limitsOfKind,
  validateLimits,
  type ProductLimit,
} from './limits';
import { MAX_PROJECT_SOURCE_BYTES, MAX_SOURCE_FILE_BYTES } from '../editor/sourceTextFormat';
import { MAX_ARCHIVE_ENTRIES, MAX_ARCHIVE_FILE_BYTES, MAX_ARCHIVE_TOTAL_BYTES, readZipArchive } from './archiveImport';
import { MAX_TRASH_ENTRIES, trashFile } from './projectTrash';
import { MAX_FILENAME_LENGTH, normalizeProjectFilename } from './safeNames';
import { MAX_IMPORT_FILES, planCodebaseImport } from './codebaseImport';
import { newProject, parseProject, type LocalProject, type ProjectFile } from './project';
import { createBuildTarget } from '../build/buildTarget';
import { executeBuildAll } from '../build/buildAll';

const byId = new Map(PRODUCT_LIMITS.map((limit) => [limit.id, limit]));
const valueOf = (id: string) => byId.get(id)!.value;

describe('the register of limits', () => {
  it('is internally consistent', () => {
    expect(validateLimits()).toEqual([]);
    expect(PRODUCT_LIMITS.length).toBeGreaterThanOrEqual(20);
  });

  it('takes every number from the module that enforces it, never a second copy', () => {
    /* A register that restated the numbers would be a second set of constants,
     * and would disagree with the code the first time one changed. */
    expect(valueOf('source-file-bytes')).toBe(MAX_SOURCE_FILE_BYTES);
    expect(valueOf('project-source-bytes')).toBe(MAX_PROJECT_SOURCE_BYTES);
    expect(valueOf('filename-length')).toBe(MAX_FILENAME_LENGTH);
    expect(valueOf('import-files')).toBe(MAX_IMPORT_FILES);
    expect(valueOf('archive-entries')).toBe(MAX_ARCHIVE_ENTRIES);
    expect(valueOf('archive-file-bytes')).toBe(MAX_ARCHIVE_FILE_BYTES);
    expect(valueOf('archive-total-bytes')).toBe(MAX_ARCHIVE_TOTAL_BYTES);
    expect(valueOf('trash-entries')).toBe(MAX_TRASH_ENTRIES);
  });

  it('reports every kind of malformed entry rather than the first', () => {
    const broken = { id: '', label: ' ', kind: 'size', value: 0, unit: '', reason: 'short', onReaching: 'it fails' } as ProductLimit;
    const problems = validateLimits([broken]).map((problem) => problem.problem);
    expect(problems).toEqual(expect.arrayContaining([
      'has no identifier',
      'has no label',
      'has no positive whole value',
      'states no unit, so its value cannot be read',
      'does not say why it exists',
      'does not say what happens when it is reached',
    ]));
  });

  it('refuses an entry that only says it fails, because that tells nobody anything', () => {
    const vague: ProductLimit = {
      ...PRODUCT_LIMITS[0]!,
      onReaching: 'The operation fails and an error is shown to the user in the interface.',
    };
    expect(validateLimits([vague]).map((problem) => problem.problem))
      .toContain('says only that it fails, which tells a person nothing they can act on');
  });

  it('covers every kind of limit the product actually has', () => {
    for (const kind of ['size', 'count', 'retention', 'concurrency'] as const) {
      expect(limitsOfKind(kind).length, kind).toBeGreaterThan(0);
    }
  });

  it('writes a value in the unit it is measured in', () => {
    expect(formatLimit(byId.get('source-file-bytes')!)).toBe('1 MiB');
    expect(formatLimit(byId.get('archive-total-bytes')!)).toBe('16 MiB');
    expect(formatLimit(byId.get('trash-entries')!)).toBe('25 files');
    expect(formatLimit(byId.get('filename-length')!)).toBe('120 characters');
  });
});

/* Exercising the limits at their boundary. Each of these checks the same two
 * things: the value at the limit is accepted, and one past it is refused with
 * something a person can act on while nothing is left half-applied. */
describe('what happens at each boundary', () => {
  it('shortens a filename at the limit and keeps its extension', () => {
    const exact = `${'a'.repeat(MAX_FILENAME_LENGTH - 4)}.asm`;
    expect(normalizeProjectFilename(exact)).toEqual({ name: exact, reason: null });

    const over = normalizeProjectFilename(`${'a'.repeat(MAX_FILENAME_LENGTH)}.asm`);
    expect(over.name).toHaveLength(MAX_FILENAME_LENGTH);
    expect(over.name.endsWith('.asm')).toBe(true);
    expect(over.reason).toContain(`${MAX_FILENAME_LENGTH} characters`);
  });

  it('keeps the newest trash entries and names the ones it dropped', () => {
    const base = newProject();
    const file = (id: string): ProjectFile => ({
      ...base.files[0]!, id, name: `${id}.asm`, content: 'RTS\n', savedName: `${id}.asm`, savedContent: 'RTS\n',
    });
    let project: LocalProject = { ...base, files: [file('keep'), ...Array.from({ length: MAX_TRASH_ENTRIES + 1 }, (_, index) => file(`f${index}`))] };
    let dropped: unknown[] = [];
    for (let index = 0; index <= MAX_TRASH_ENTRIES; index += 1) {
      const result = trashFile(project, `f${index}`, '2026-08-28T09:00:00.000Z');
      project = result.project;
      dropped = result.dropped;
    }
    expect(project.trash).toHaveLength(MAX_TRASH_ENTRIES);
    /* Dropped, and said so. A trash that quietly forgets is a trash nobody
     * can rely on, which is worse than not having one. */
    expect(dropped).toHaveLength(1);
    expect(project.trash[0]!.id).toBe(`f${MAX_TRASH_ENTRIES}`);
  });

  it('reads an import up to the file limit and says it stopped rather than appearing complete', () => {
    const inputs = Array.from({ length: MAX_IMPORT_FILES + 5 }, (_, index) => ({ path: `game/f${index}.asm`, content: 'RTS\n' }));
    const plan = planCodebaseImport(inputs, 'game');
    expect(plan.files.length).toBeLessThanOrEqual(MAX_IMPORT_FILES);
    const excluded = plan.exclusions.filter((exclusion) => exclusion.reason === 'file-count-limit');
    expect(excluded.length).toBeGreaterThan(0);
    expect(excluded[0]!.detail).toContain(String(MAX_IMPORT_FILES));
  });

  it('refuses a source file one byte over the limit and leaves the project as it was', () => {
    const base = newProject();
    const oversized = { ...base.files[0]!, content: 'x'.repeat(MAX_SOURCE_FILE_BYTES + 1) };
    const document = JSON.stringify({ ...base, files: [oversized] });
    expect(() => parseProject(document)).toThrow(/1 MiB editable source-file limit/);

    /* Exactly at the limit is accepted, so the boundary is the limit and not
     * one below it. */
    const exact = { ...base.files[0]!, content: 'x'.repeat(MAX_SOURCE_FILE_BYTES), savedContent: 'x'.repeat(MAX_SOURCE_FILE_BYTES) };
    expect(() => parseProject(JSON.stringify({ ...base, files: [exact] }))).not.toThrow();
  });

  it('stops an archive entry at the expansion limit whatever its header claims', async () => {
    const { crc32 } = await import('./archiveImport');
    const encoder = new TextEncoder();
    const raw = new Uint8Array(MAX_ARCHIVE_FILE_BYTES + 64);
    const compressed = new Uint8Array(await new Response(new Blob([raw as unknown as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    const name = encoder.encode('bomb.asm');

    const local = new Uint8Array(30 + name.length + compressed.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(10, 8, true);
    localView.setUint32(14, crc32(raw), true);
    localView.setUint32(18, compressed.length, true);
    /* The header claims four bytes. The stream produces a megabyte. */
    localView.setUint32(22, 4, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(compressed, 30 + name.length);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(10, 8, true);
    centralView.setUint32(16, crc32(raw), true);
    centralView.setUint32(20, compressed.length, true);
    centralView.setUint32(24, 4, true);
    centralView.setUint16(28, name.length, true);
    central.set(name, 46);

    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, 1, true);
    endView.setUint16(10, 1, true);
    endView.setUint32(12, central.length, true);
    endView.setUint32(16, local.length, true);

    const bytes = new Uint8Array(local.length + central.length + end.length);
    bytes.set(local, 0);
    bytes.set(central, local.length);
    bytes.set(end, local.length + central.length);

    const result = await readZipArchive(bytes.buffer);
    expect(result.entries).toEqual([]);
    expect(result.refused[0]).toMatchObject({ reason: 'file-too-large' });
    expect(result.refused[0]!.detail).toContain('whatever its header claims');
  });

  it('never starts more builds at once than the concurrency limit allows', async () => {
    const base = newProject();
    const targets = Array.from({ length: MAX_BUILD_CONCURRENCY + 4 }, (_, index) => ({
      ...createBuildTarget(base.files[0]!),
      id: `t${index}`,
      name: `target ${index}`,
    }));
    let running = 0;
    let peak = 0;
    const records = await executeBuildAll(
      targets,
      async () => {
        running += 1;
        peak = Math.max(peak, running);
        await Promise.resolve();
        running -= 1;
        return { status: 'succeeded', diagnostics: [], bytes: new Uint8Array(), metadata: {} } as never;
      },
      /* Asking for more than the ceiling must not raise it. */
      { concurrency: MAX_BUILD_CONCURRENCY + 10 },
    );
    expect(peak).toBeLessThanOrEqual(MAX_BUILD_CONCURRENCY);
    expect(records).toHaveLength(targets.length);
  });
});
