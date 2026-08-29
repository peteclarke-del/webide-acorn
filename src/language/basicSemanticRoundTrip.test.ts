import { describe, expect, it } from 'vitest';
import { decodeTokenizedBasic } from '../analysis/bbcBasic';
import { prepareAtomBasic, tokenizeBasic } from '../build/basicTokeniser';
import type { ProjectFile } from '../project/project';
import { basicNavigationModel, buildProjectLanguageIndex } from './projectLanguageService';

function navigationSnapshot(content: string, atom = false) {
  const file: ProjectFile = { id: 'basic', name: atom ? 'main.atom.bas' : 'main.bas', content, language: 'bbc-basic', modified: false };
  const model = basicNavigationModel(file, buildProjectLanguageIndex([file]), atom);
  return {
    declaredLines: model.declaredLines,
    references: model.references.map(({ label, target, fromLine, fromColumn, length, status, targetLine, targetColumn, targetLength }) => ({ label, target, fromLine, fromColumn, length, status, targetLine, targetColumn, targetLength })),
    diagnostics: model.diagnostics.map(({ kind, line, column, message }) => ({ kind, line, column, message })),
  };
}

describe('BASIC navigation semantic round trips', () => {
  it('preserves BBC declarations, reference ranges and resolution through tokenized BASIC', () => {
    const plain = '10 ON X GOTO 40,100\n20 IF X THEN 100 ELSE 40\n40 GOSUB 100:RESTORE 40\n100 END';
    const artifact = tokenizeBasic(plain);
    expect(artifact.diagnostics).toEqual([]);
    const listing = decodeTokenizedBasic(artifact.bytes);
    expect(listing?.warnings).toEqual([]);
    const decoded = listing!.lines.map((line) => `${line.lineNumber} ${line.source}`).join('\n');
    expect(navigationSnapshot(decoded)).toEqual(navigationSnapshot(plain));
  });

  it('preserves Atom numeric and compact-label navigation through packed interpreter text', () => {
    const plain = "10 GOSUB a\n20 GOTO 110\n100aPRINT \"ATOM\"'\n110 RETURN";
    const packed = prepareAtomBasic(plain);
    expect(packed.diagnostics).toEqual([]);
    const decoded = new TextDecoder().decode(packed.bytes).replace(/\n$/, '');
    expect(navigationSnapshot(decoded, true)).toEqual(navigationSnapshot(plain, true));
  });
});
