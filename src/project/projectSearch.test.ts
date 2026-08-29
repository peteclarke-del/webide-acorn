import { describe, expect, it } from 'vitest';
import type { ProjectFile } from './project';
import { MAX_PROJECT_SEARCH_MATCHES, replaceProjectMatches, searchProject } from './projectSearch';

const file = (id: string, name: string, content: string): ProjectFile => ({ id, name, content, language: '6502', modified: false });
const insensitive = { caseSensitive: false, wholeWord: false };

describe('project search', () => {
  it('finds literal matches across files with exact source locations', () => {
    const result = searchProject([file('a', 'main.asm', 'LDA #1\nJSR helper'), file('b', 'helper.asm', '.helper\nLDA #2')], 'lda', insensitive);
    expect(result.matches).toEqual([
      expect.objectContaining({ fileId: 'a', line: 1, column: 1, start: 0, length: 3 }),
      expect.objectContaining({ fileId: 'b', line: 2, column: 1, start: 8, length: 3 }),
    ]);
    expect(result).toMatchObject({ scannedFiles: 2, truncated: false });
  });

  it('supports case-sensitive and whole-word matching', () => {
    const files = [file('a', 'words.asm', 'loop LOOP loop2 _loop loop')];
    expect(searchProject(files, 'loop', { caseSensitive: true, wholeWord: true }).matches.map((match) => match.column)).toEqual([1, 23]);
    expect(searchProject(files, 'loop', { caseSensitive: false, wholeWord: true }).matches.map((match) => match.column)).toEqual([1, 6, 23]);
  });

  it('replaces every complete match while preserving untouched file identities', () => {
    const first = file('a', 'one.asm', 'LDA value\nSTA value');
    const second = file('b', 'two.asm', 'unchanged');
    const result = replaceProjectMatches([first, second], 'value', 'buffer', insensitive);
    expect(result).toMatchObject({ replacements: 2, changedFiles: 1 });
    expect(result.files[0]).toMatchObject({ content: 'LDA buffer\nSTA buffer', modified: true });
    expect(result.files[1]).toBe(second);
  });

  it('searches and replaces regular expressions with capture groups', () => {
    const files = [file('a', 'numbers.asm', 'LDA #&01\nLDA #&A0\nLDA value')];
    const options = { caseSensitive: false, wholeWord: false, regularExpression: true };
    const result = searchProject(files, 'LDA\\s+#&([0-9A-F]{2})', options);
    expect(result.matches.map((match) => [match.line, match.column, match.length])).toEqual([[1, 1, 8], [2, 1, 8]]);
    expect(replaceProjectMatches(files, 'LDA\\s+#&([0-9A-F]{2})', 'LDX #&$1', options).files[0]?.content).toBe('LDX #&01\nLDX #&A0\nLDA value');
  });

  it('reports invalid and empty regular-expression matches without throwing', () => {
    expect(searchProject([file('a', 'main.asm', 'LDA')], '(', { ...insensitive, regularExpression: true }).error).toMatch(/regular expression/i);
    expect(searchProject([file('a', 'main.asm', 'LDA')], '^', { ...insensitive, regularExpression: true }).error).toMatch(/empty text/);
  });

  it('bounds result growth and refuses partial replacement', () => {
    const crowded = file('a', 'crowded.asm', Array.from({ length: MAX_PROJECT_SEARCH_MATCHES + 1 }, () => 'x').join('\n'));
    expect(searchProject([crowded], 'x', insensitive)).toMatchObject({ truncated: true, matches: { length: MAX_PROJECT_SEARCH_MATCHES } });
    expect(() => replaceProjectMatches([crowded], 'x', 'y', insensitive)).toThrow(/truncated/);
  });
});
