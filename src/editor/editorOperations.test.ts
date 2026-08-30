import { describe, expect, it } from 'vitest';
import { applyEditorCommand, editorCopyRange, editorCut, replaceEditorSelection } from './editorOperations';

describe('source editor operations', () => {
  it('copies or cuts the current line when there is no selection', () => {
    const source = 'ONE\nTWO\nTHREE';
    expect(editorCopyRange(source, { start: 5, end: 5 })).toEqual({ start: 4, end: 8, text: 'TWO\n' });
    expect(editorCut(source, { start: 5, end: 5 })).toMatchObject({ content: 'ONE\nTHREE', start: 4, end: 4 });
  });
  it('duplicates, deletes, joins and moves complete selected lines', () => {
    const source = 'ONE\nTWO\nTHREE';
    expect(applyEditorCommand(source, { start: 4, end: 7 }, 'duplicate-lines', '6502').content).toBe('ONE\nTWO\nTWO\nTHREE');
    expect(applyEditorCommand(source, { start: 4, end: 7 }, 'delete-lines', '6502').content).toBe('ONE\nTHREE');
    expect(applyEditorCommand(source, { start: 4, end: 7 }, 'move-lines-up', '6502').content).toBe('TWO\nONE\nTHREE');
    expect(applyEditorCommand(source, { start: 4, end: 7 }, 'move-lines-down', '6502').content).toBe('ONE\nTHREE\nTWO');
    expect(applyEditorCommand(source, { start: 0, end: 3 }, 'join-lines', '6502').content).toBe('ONE TWO\nTHREE');
  });
  it('uses language-aware comments and reversible indentation', () => {
    const basic = applyEditorCommand('10 PRINT "X"\n20 END', { start: 0, end: 25 }, 'toggle-comment', 'bbc-basic');
    expect(basic.content).toBe('10 REM PRINT "X"\n20 REM END');
    expect(applyEditorCommand(basic.content, basic, 'toggle-comment', 'bbc-basic').content).toBe('10 PRINT "X"\n20 END');
    const assembly = applyEditorCommand('  LDA #1\nlabel', { start: 0, end: 14 }, 'toggle-comment', '6502');
    expect(assembly.content).toBe('  ; LDA #1\n; label');
    expect(applyEditorCommand(applyEditorCommand('A\n B', { start: 0, end: 4 }, 'indent-lines', '6502').content, { start: 0, end: 8 }, 'outdent-lines', '6502').content).toBe('A\n B');
  });
  it('replaces selections and transforms case or trailing whitespace deterministically', () => {
    expect(replaceEditorSelection('ABC DEF', { start: 4, end: 7 }, 'XYZ')).toMatchObject({ content: 'ABC XYZ', start: 7, end: 7 });
    expect(applyEditorCommand('abc\ndef', { start: 0, end: 3 }, 'uppercase', '6502').content).toBe('ABC\ndef');
    expect(applyEditorCommand('PRINT mixed', { start: 6, end: 11 }, 'uppercase', 'bbc-basic').content).toBe('PRINT MIXED');
    expect(applyEditorCommand('A  \nB\t', { start: 0, end: 0 }, 'trim-trailing', '6502').content).toBe('A\nB');
  });
  it('splits at the caret, expands tabs at stable tab stops, and formats bounded source', () => {
    expect(applyEditorCommand('PRINT', { start: 2, end: 2 }, 'split-line', 'bbc-basic')).toMatchObject({ content: 'PR\nINT', start: 3, end: 3 });
    expect(applyEditorCommand('\tLDA\t#1', { start: 0, end: 7 }, 'tabs-to-spaces', '6502').content).toBe('  LDA #1');
    expect(applyEditorCommand('  LDA\t#1  \n\tRTS\t', { start: 0, end: 0 }, 'format-document', '6502').content).toBe('  LDA #1\n  RTS');
    expect(applyEditorCommand('A\t  \nB\t  ', { start: 0, end: 3 }, 'format-selection', 'bbc-basic').content).toBe('A\nB\t  ');
  });
  it('toggles a C block comment around the exact selection', () => {
    const commented = applyEditorCommand('int result;', { start: 4, end: 10 }, 'toggle-block-comment', 'c');
    expect(commented.content).toBe('int /* result */;');
    expect(applyEditorCommand(commented.content, { start: 4, end: 16 }, 'toggle-block-comment', 'c').content).toBe('int result;');
    const lineCommented = applyEditorCommand('  int result;', { start: 0, end: 13 }, 'toggle-comment', 'c');
    expect(lineCommented.content).toBe('  // int result;');
    expect(applyEditorCommand(lineCommented.content, lineCommented, 'toggle-comment', 'c').content).toBe('  int result;');
  });
});
