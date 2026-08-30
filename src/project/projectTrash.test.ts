import { describe, expect, it } from 'vitest';
import { createBuildTarget } from '../build/buildTarget';
import { newProject, parseProject, type LocalProject, type ProjectFile } from './project';
import {
  MAX_TRASH_ENTRIES,
  purgeTrash,
  restoreFromTrash,
  trashEntrySummary,
  trashFile,
  validateTrash,
} from './projectTrash';

const AT = '2026-08-28T09:00:00.000Z';

function file(id: string, name: string, content = 'RTS\n'): ProjectFile {
  return {
    id, name, content, language: '6502', encoding: 'utf-8', lineEnding: 'lf',
    modified: false, saved: true, savedName: name, savedContent: content,
    savedEncoding: 'utf-8', savedLineEnding: 'lf', kind: 'authored', access: 'editable',
  };
}

function project(): LocalProject {
  const main = file('main', 'main.asm');
  const helper = file('helper', 'helper.asm');
  const base = newProject();
  return {
    ...base,
    files: [main, helper],
    buildTargets: [{ ...createBuildTarget(main), id: 'main-target', name: 'main' }, { ...createBuildTarget(helper), id: 'helper-target', name: 'helper' }],
    activeBuildTargetId: 'main-target',
    bookmarks: [
      { id: 'b1', fileId: 'helper', line: 1, column: 1, name: 'entry', description: '', scope: 'project', enabled: true, anchor: 'RTS' },
      { id: 'b2', fileId: 'main', line: 1, column: 1, name: 'other', description: '', scope: 'project', enabled: true, anchor: 'RTS' },
    ],
    breakpoints: { helper: [0x1900], main: [0x2000] },
  };
}

describe('trashing a file', () => {
  it('takes the build targets and bookmarks that referenced it, and keeps them together', () => {
    const { project: after, entry } = trashFile(project(), 'helper', AT);
    expect(after.files.map((item) => item.id)).toEqual(['main']);
    expect(after.buildTargets.map((target) => target.id)).toEqual(['main-target']);
    expect(after.bookmarks.map((bookmark) => bookmark.id)).toEqual(['b2']);
    expect(after.breakpoints).toEqual({ main: [0x2000] });

    expect(entry.id).toBe('helper');
    expect(entry.deletedAt).toBe(AT);
    expect(entry.buildTargets.map((target) => target.id)).toEqual(['helper-target']);
    expect(entry.bookmarks.map((bookmark) => bookmark.id)).toEqual(['b1']);
    expect(trashEntrySummary(entry)).toBe('restores with 1 build target and 1 bookmark');
  });

  it('refuses to empty the project', () => {
    const single = { ...project(), files: [file('main', 'main.asm')] };
    expect(() => trashFile(single, 'main', AT)).toThrow(/at least one source file/);
  });

  it('refuses a file that is not there rather than doing nothing quietly', () => {
    expect(() => trashFile(project(), 'absent', AT)).toThrow(/not in this project/);
  });

  it('leaves the project with somewhere to build from when the last target went with the file', () => {
    const one = project();
    one.buildTargets = [{ ...createBuildTarget(one.files[1]!), id: 'helper-target', name: 'helper' }];
    one.activeBuildTargetId = 'helper-target';
    const { project: after } = trashFile(one, 'helper', AT);
    expect(after.buildTargets).toHaveLength(1);
    expect(after.buildTargets[0]!.entryFileId).toBe('main');
    expect(after.activeBuildTargetId).toBe(after.buildTargets[0]!.id);
  });

  it('keeps the newest entries and reports the ones it dropped at the limit', () => {
    let current = { ...project(), files: [file('main', 'main.asm'), ...Array.from({ length: 30 }, (_, index) => file(`f${index}`, `f${index}.asm`))] };
    let dropped: unknown[] = [];
    for (let index = 0; index < 30; index += 1) {
      const result = trashFile(current, `f${index}`, AT);
      current = result.project;
      dropped = result.dropped;
    }
    expect(current.trash).toHaveLength(MAX_TRASH_ENTRIES);
    expect(current.trash[0]!.id).toBe('f29');
    expect(dropped).toHaveLength(1);
  });
});

describe('restoring from the trash', () => {
  it('puts the file, its build targets and its bookmarks back', () => {
    const { project: after } = trashFile(project(), 'helper', AT);
    const restored = restoreFromTrash(after, 'helper');
    expect(restored.project.files.map((item) => item.id).sort()).toEqual(['helper', 'main']);
    expect(restored.project.buildTargets.map((target) => target.id).sort()).toEqual(['helper-target', 'main-target']);
    expect(restored.project.bookmarks.map((bookmark) => bookmark.id).sort()).toEqual(['b1', 'b2']);
    expect(restored.project.trash).toEqual([]);
    expect(restored.renamedTo).toBeNull();
    expect(restored.skippedTargets).toEqual([]);
  });

  it('renames rather than overwriting a name taken since the deletion', () => {
    const { project: after } = trashFile(project(), 'helper', AT);
    const collided = { ...after, files: [...after.files, file('other', 'helper.asm')] };
    const restored = restoreFromTrash(collided, 'helper');
    expect(restored.renamedTo).toBe('helper-2.asm');
    expect(restored.project.files.find((item) => item.id === 'other')!.name).toBe('helper.asm');
    expect(restored.project.files.find((item) => item.id === 'helper')!.name).toBe('helper-2.asm');
  });

  it('says which build target it could not bring back, rather than replacing one', () => {
    const { project: after } = trashFile(project(), 'helper', AT);
    const reused = { ...after, buildTargets: [...after.buildTargets, { ...createBuildTarget(after.files[0]!), id: 'helper-target', name: 'something else' }] };
    const restored = restoreFromTrash(reused, 'helper');
    expect(restored.skippedTargets[0]).toContain('another build target now uses its identifier');
    expect(restored.project.buildTargets.filter((target) => target.id === 'helper-target')).toHaveLength(1);
    expect(restored.project.buildTargets.find((target) => target.id === 'helper-target')!.name).toBe('something else');
  });

  it('refuses to restore something that is not in the trash', () => {
    expect(() => restoreFromTrash(project(), 'helper')).toThrow(/not in the trash/);
  });

  it('purges one entry or all of them', () => {
    const first = trashFile(project(), 'helper', AT).project;
    expect(purgeTrash(first, 'helper').trash).toEqual([]);
    expect(purgeTrash(first).trash).toEqual([]);
    expect(purgeTrash(first, 'nothing').trash).toHaveLength(1);
  });
});

describe('trash arriving from a project file', () => {
  it('survives a round trip through the project parser', () => {
    const { project: after } = trashFile(project(), 'helper', AT);
    const reopened = parseProject(JSON.stringify(after));
    expect(reopened.trash).toHaveLength(1);
    expect(reopened.trash[0]!.file.name).toBe('helper.asm');
    expect(restoreFromTrash(reopened, 'helper').project.files).toHaveLength(2);
  });

  it('drops entries that are malformed, duplicated, or would collide with a live file', () => {
    const entries = validateTrash([
      null,
      { id: '', deletedAt: AT, file: file('a', 'a.asm') },
      { id: 'a', deletedAt: 'not a date', file: file('a', 'a.asm') },
      { id: 'a', deletedAt: AT, file: { name: 'a.asm' } },
      { id: 'live', deletedAt: AT, file: file('live', 'live.asm') },
      { id: 'good', deletedAt: AT, file: file('good', 'good.asm') },
      { id: 'good', deletedAt: AT, file: file('good', 'again.asm') },
    ], new Set(['live']));
    expect(entries.map((entry) => entry.id)).toEqual(['good']);
    expect(entries[0]!.file.name).toBe('good.asm');
  });

  it('bounds what a project file can carry', () => {
    const many = Array.from({ length: 100 }, (_, index) => ({ id: `t${index}`, deletedAt: AT, file: file(`t${index}`, `t${index}.asm`) }));
    expect(validateTrash(many, new Set()).length).toBe(MAX_TRASH_ENTRIES);
    expect(validateTrash('not a list', new Set())).toEqual([]);
  });
});
