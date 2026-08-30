import { describe, expect, it } from 'vitest';
import { createProjectFile } from '../project/project';
import { buildProjectLanguageIndex, findProjectReferences } from './projectLanguageService';
import { previewProjectRename } from './projectRename';

describe('safe project symbol rename', () => {
  it('previews a connected 6502 declaration and every linked reference', () => {
    const main = { ...createProjectFile('main.asm', 'INCLUDE "worker.asm"\n.start\n  JSR worker\n  JMP worker'), id: 'main' };
    const worker = { ...createProjectFile('worker.asm', '.worker\n  RTS'), id: 'worker' };
    const files = [main, worker];
    const index = buildProjectLanguageIndex(files);
    const references = findProjectReferences(main, main.content.indexOf('worker', 22), index);
    const preview = previewProjectRename(files, index, references, 'update_screen');
    expect(preview.errors).toEqual([]);
    expect(preview.changes).toHaveLength(2);
    expect(preview.changes.find((change) => change.fileId === 'main')?.after).toContain('JSR update_screen\n  JMP update_screen');
    expect(preview.changes.find((change) => change.fileId === 'worker')?.after).toContain('.update_screen');
    expect(preview.changes.reduce((total, change) => total + change.replacements, 0)).toBe(3);
  });

  it('refuses collisions, invalid identifiers and stale source ranges', () => {
    const file = { ...createProjectFile('main.arm', 'start:\n  B loop\nloop:\n  B loop'), id: 'arm' };
    const index = buildProjectLanguageIndex([file]);
    const references = findProjectReferences(file, file.content.indexOf('loop'), index);
    expect(previewProjectRename([file], index, references, 'start').errors[0]).toContain('collides');
    expect(previewProjectRename([file], index, references, 'not valid').errors[0]).toContain('identifier');
    const changed = { ...file, content: file.content.replace('B loop', 'B gone') };
    expect(previewProjectRename([changed], index, references, 'again').errors[0]).toContain('no longer contains');
  });

  it('renames uniquely resolved BASIC routines while preserving PROC and FN semantics', () => {
    const file = { ...createProjectFile('main.bas', '10 DEF PROCdraw\n20 PROCdraw'), id: 'basic' };
    const index = buildProjectLanguageIndex([file]);
    const references = findProjectReferences(file, file.content.lastIndexOf('PROCdraw'), index);
    const preview = previewProjectRename([file], index, references, 'PROCpaint');
    expect(preview.errors).toEqual([]);
    expect(preview.changes[0]?.after).toBe('10 DEF PROCpaint\n20 PROCpaint');
    expect(previewProjectRename([file], index, references, 'FNpaint').errors).toContain('A BASIC routine rename cannot change a PROC into an FN or an FN into a PROC.');
  });

  it('renames a connected C function and keeps C case-sensitive collision rules', () => {
    const main = { ...createProjectFile('main.c', '#include "draw.h"\nint main(void) { return draw(); }'), id: 'main' };
    const header = { ...createProjectFile('draw.h', 'int draw(void) { return 1; }'), id: 'header' };
    const files = [main, header]; const index = buildProjectLanguageIndex(files);
    const references = findProjectReferences(main, main.content.indexOf('draw()'), index);
    const preview = previewProjectRename(files, index, references, 'render');
    expect(preview.errors).toEqual([]);
    expect(preview.changes.find((change) => change.fileId === 'main')?.after).toContain('render()');
    expect(preview.changes.find((change) => change.fileId === 'header')?.after).toContain('int render(void)');
  });

  it('blocks protected, conditional and unresolved occurrences before creating changes', () => {
    const main = { ...createProjectFile('main.asm', 'INCLUDE "worker.asm"\n.start\n JSR worker'), id: 'main' };
    const protectedFile = { ...createProjectFile('worker.asm', '.worker\n RTS'), id: 'worker', kind: 'imported' as const, access: 'read-only' as const };
    let files = [main, protectedFile]; let index = buildProjectLanguageIndex(files); let references = findProjectReferences(main, main.content.indexOf('worker', 22), index);
    expect(previewProjectRename(files, index, references, 'paint').errors.join(' ')).toContain('read-only');

    const conditional = { ...protectedFile, kind: 'authored' as const, access: 'editable' as const, content: 'IF FEATURE\n.worker\nENDIF\n RTS' };
    files = [main, conditional]; index = buildProjectLanguageIndex(files); references = findProjectReferences(main, main.content.indexOf('worker', 22), index);
    expect(previewProjectRename(files, index, references, 'paint').errors.join(' ')).toContain('conditional compilation');

    const unresolved = { ...conditional, content: '.worker\n LDA worker' };
    files = [main, unresolved]; index = buildProjectLanguageIndex(files); references = findProjectReferences(main, main.content.indexOf('worker', 22), index);
    expect(previewProjectRename(files, index, references, 'paint').errors.join(' ')).toContain('unresolved occurrence');
  });
});
