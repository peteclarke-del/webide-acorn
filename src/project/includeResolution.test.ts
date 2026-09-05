import { describe, expect, it } from 'vitest';
import { basenameOf, directoryOf, resolveIncluded, resolveRelativeName } from './includeResolution';

const project = (...names: string[]) => new Map(names.map((name) => [name.toLowerCase(), name]));

describe('where an include points', () => {
  it('finds the file beside the one doing the including first', () => {
    /* Two files called sprites.s: the one in the same folder is the one the
     * author meant, exactly as their original assembler would have read it. */
    const files = project('src/main.s', 'src/sprites.s', 'sprites.s');
    expect(resolveIncluded(files, 'sprites.s', 'src/main.s')).toBe('src/sprites.s');
    expect(resolveIncluded(files, 'sprites.s', 'main.s')).toBe('sprites.s');
  });

  it('reads a path from the top of the project when nothing sits beside it', () => {
    const files = project('src/main.s', 'lib/maths.s');
    expect(resolveIncluded(files, 'lib/maths.s', 'src/main.s')).toBe('lib/maths.s');
  });

  it('follows a relative path out of the folder and back down', () => {
    const files = project('src/game/main.s', 'src/lib/maths.s');
    expect(resolveIncluded(files, '../lib/maths.s', 'src/game/main.s')).toBe('src/lib/maths.s');
    expect(resolveIncluded(files, './main.s', 'src/game/main.s')).toBe('src/game/main.s');
  });

  it('refuses a path that climbs above the project rather than clamping it', () => {
    expect(resolveRelativeName('src/', '../../escape.s')).toBeNull();
    expect(resolveIncluded(project('escape.s'), '../../escape.s', 'src/main.s')).toBeUndefined();
  });

  it('still answers an include written before the files gained folders', () => {
    const files = project('src/lib/maths.s');
    expect(resolveIncluded(files, 'maths.s', 'main.s')).toBe('src/lib/maths.s');
  });

  it('refuses to guess when two folders hold the same name', () => {
    /* Guessing here would build a different program from the one on disk and
     * say nothing about it, so an unresolved include is the safer answer. */
    const files = project('a/maths.s', 'b/maths.s');
    expect(resolveIncluded(files, 'maths.s', 'main.s')).toBeUndefined();
  });

  it('ignores case, because the machines and the filesystems disagree about it', () => {
    expect(resolveIncluded(project('src/Maths.S'), 'MATHS.s', 'src/main.s')).toBe('src/Maths.S');
  });

  it('takes a backslash as a separator, because DOS-era sources are written that way', () => {
    expect(resolveIncluded(project('src/lib/maths.s'), 'lib\\maths.s', 'src/main.s')).toBe('src/lib/maths.s');
  });

  it('answers nothing for an empty request', () => {
    expect(resolveIncluded(project('main.s'), '   ', 'main.s')).toBeUndefined();
  });

  it('splits a name into its folder and its basename', () => {
    expect(directoryOf('src/lib/maths.s')).toBe('src/lib/');
    expect(directoryOf('maths.s')).toBe('');
    expect(basenameOf('src/lib/maths.s')).toBe('maths.s');
    expect(basenameOf('maths.s')).toBe('maths.s');
  });
});
