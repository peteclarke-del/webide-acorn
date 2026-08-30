import type { SourceLanguage } from '../project/project';

export interface EditorSelection { start: number; end: number }
export interface EditorEdit extends EditorSelection { content: string; label: string }
export type EditorCommand = 'duplicate-lines' | 'delete-lines' | 'move-lines-up' | 'move-lines-down' | 'indent-lines' | 'outdent-lines' | 'toggle-comment' | 'toggle-block-comment' | 'uppercase' | 'lowercase' | 'join-lines' | 'split-line' | 'tabs-to-spaces' | 'format-selection' | 'format-document' | 'trim-trailing';

export function applyEditorCommand(content: string, selection: EditorSelection, command: EditorCommand, language: SourceLanguage): EditorEdit {
  const selected = normalizeSelection(content, selection);
  if (command === 'split-line') {
    const next = `${content.slice(0, selected.start)}\n${content.slice(selected.start)}`;
    return { content: next, start: selected.start + 1, end: selected.start + 1, label: 'Split line' };
  }
  if (command === 'trim-trailing') {
    const next = content.split('\n').map((line) => line.replace(/[ \t]+$/g, '')).join('\n');
    return { content: next, start: Math.min(selected.start, next.length), end: Math.min(selected.end, next.length), label: 'Trim trailing whitespace' };
  }
  if (command === 'move-lines-up' || command === 'move-lines-down') return moveLines(content, selected, command === 'move-lines-up' ? -1 : 1);
  const range = command === 'format-document'
    ? { start: 0, end: content.length }
    : (command === 'uppercase' || command === 'lowercase') && selected.start !== selected.end
      ? selected
      : selectedLineRange(content, selected);
  if (command === 'duplicate-lines') return duplicateLines(content, range);
  if (command === 'delete-lines') return deleteLines(content, range);
  if (command === 'join-lines') return joinLines(content, range);
  if (command === 'toggle-block-comment') return toggleBlockComment(content, selected.start === selected.end ? range : selected);
  const block = content.slice(range.start, range.end);
  let transformed = block;
  let label: string = command;
  if (command === 'indent-lines') { transformed = block.split('\n').map((line) => line ? `  ${line}` : line).join('\n'); label = 'Indent lines'; }
  if (command === 'outdent-lines') { transformed = block.split('\n').map((line) => line.replace(/^(?:\t| {1,2})/, '')).join('\n'); label = 'Outdent lines'; }
  if (command === 'toggle-comment') { transformed = toggleComments(block, language); label = 'Toggle comments'; }
  if (command === 'tabs-to-spaces') { transformed = expandTabs(block); label = 'Convert tabs to spaces'; }
  if (command === 'format-selection' || command === 'format-document') { transformed = formatSource(block); label = command === 'format-document' ? 'Format document' : 'Format selection'; }
  if (command === 'uppercase') { transformed = block.toUpperCase(); label = 'Uppercase'; }
  if (command === 'lowercase') { transformed = block.toLowerCase(); label = 'Lowercase'; }
  const next = `${content.slice(0, range.start)}${transformed}${content.slice(range.end)}`;
  return { content: next, start: range.start, end: range.start + transformed.length, label };
}

export function replaceEditorSelection(content: string, selection: EditorSelection, value: string, label = 'Paste'): EditorEdit {
  const selected = normalizeSelection(content, selection);
  const next = `${content.slice(0, selected.start)}${value}${content.slice(selected.end)}`;
  const caret = selected.start + value.length;
  return { content: next, start: caret, end: caret, label };
}

export function editorCopyRange(content: string, selection: EditorSelection) {
  const selected = normalizeSelection(content, selection);
  if (selected.start !== selected.end) return { ...selected, text: content.slice(selected.start, selected.end) };
  const line = selectedLineRange(content, selected);
  const end = line.end < content.length && content[line.end] === '\n' ? line.end + 1 : line.end;
  return { start: line.start, end, text: content.slice(line.start, end) };
}

export function editorCut(content: string, selection: EditorSelection): EditorEdit {
  const copied = editorCopyRange(content, selection);
  const next = `${content.slice(0, copied.start)}${content.slice(copied.end)}`;
  return { content: next, start: copied.start, end: copied.start, label: 'Cut' };
}

function normalizeSelection(content: string, selection: EditorSelection) {
  const start = Math.max(0, Math.min(content.length, Math.min(selection.start, selection.end)));
  const end = Math.max(start, Math.min(content.length, Math.max(selection.start, selection.end)));
  return { start, end };
}

function selectedLineRange(content: string, selection: EditorSelection) {
  const start = content.lastIndexOf('\n', Math.max(0, selection.start - 1)) + 1;
  const effectiveEnd = selection.end > selection.start && content[selection.end - 1] === '\n' ? selection.end - 1 : selection.end;
  const newline = content.indexOf('\n', effectiveEnd);
  return { start, end: newline < 0 ? content.length : newline };
}

function duplicateLines(content: string, range: EditorSelection): EditorEdit {
  const block = content.slice(range.start, range.end);
  if (range.end < content.length && content[range.end] === '\n') {
    const insertion = range.end + 1;
    const next = `${content.slice(0, insertion)}${block}\n${content.slice(insertion)}`;
    return { content: next, start: insertion, end: insertion + block.length, label: 'Duplicate lines' };
  }
  const separator = range.start === 0 && !content ? '' : '\n';
  const next = `${content}${separator}${block}`;
  return { content: next, start: content.length + separator.length, end: next.length, label: 'Duplicate lines' };
}

function deleteLines(content: string, range: EditorSelection): EditorEdit {
  if (range.end < content.length && content[range.end] === '\n') return { content: `${content.slice(0, range.start)}${content.slice(range.end + 1)}`, start: range.start, end: range.start, label: 'Delete lines' };
  const start = range.start > 0 ? range.start - 1 : range.start;
  return { content: `${content.slice(0, start)}${content.slice(range.end)}`, start, end: start, label: 'Delete lines' };
}

function moveLines(content: string, selection: EditorSelection, direction: -1 | 1): EditorEdit {
  const lines = content.split('\n');
  const startLine = lineIndexAt(content, selection.start);
  const endPosition = selection.end > selection.start && content[selection.end - 1] === '\n' ? selection.end - 1 : selection.end;
  const endLine = lineIndexAt(content, endPosition);
  if ((direction < 0 && startLine === 0) || (direction > 0 && endLine >= lines.length - 1)) return { content, ...selection, label: direction < 0 ? 'Move lines up' : 'Move lines down' };
  const block = lines.splice(startLine, endLine - startLine + 1);
  const insertion = direction < 0 ? startLine - 1 : startLine + 1;
  lines.splice(insertion, 0, ...block);
  const next = lines.join('\n');
  const start = offsetForLine(lines, insertion);
  const end = offsetForLine(lines, insertion + block.length - 1) + lines[insertion + block.length - 1]!.length;
  return { content: next, start, end, label: direction < 0 ? 'Move lines up' : 'Move lines down' };
}

function joinLines(content: string, range: EditorSelection): EditorEdit {
  const following = content.indexOf('\n', range.end);
  const end = following < 0 ? content.length : (() => { const next = content.indexOf('\n', following + 1); return next < 0 ? content.length : next; })();
  const block = content.slice(range.start, end);
  const joined = block.replace(/[ \t]*\n[ \t]*/g, ' ');
  return { content: `${content.slice(0, range.start)}${joined}${content.slice(end)}`, start: range.start, end: range.start + joined.length, label: 'Join lines' };
}

function toggleComments(block: string, language: SourceLanguage) {
  const lines = block.split('\n');
  const commented = lines.filter((line) => line.trim()).every((line) => language === 'bbc-basic' ? /^\s*\d{1,5}\s+REM(?:\s|$)/i.test(line) || /^\s*REM(?:\s|$)/i.test(line) : language === 'c' ? /^\s*\/\//.test(line) : /^\s*;/.test(line));
  return lines.map((line) => {
    if (!line.trim()) return line;
    if (language === 'bbc-basic') {
      const numbered = line.match(/^(\s*\d{1,5}\s+)(.*)$/);
      const prefix = numbered?.[1] ?? line.match(/^\s*/)?.[0] ?? '';
      const body = numbered?.[2] ?? line.slice(prefix.length);
      return commented ? `${prefix}${body.replace(/^REM\s?/i, '')}` : `${prefix}REM ${body}`;
    }
    if (language === 'c') return commented ? line.replace(/^(\s*)\/\/\s?/, '$1') : line.replace(/^(\s*)/, '$1// ');
    return commented ? line.replace(/^(\s*);\s?/, '$1') : line.replace(/^(\s*)/, '$1; ');
  }).join('\n');
}

function toggleBlockComment(content: string, range: EditorSelection): EditorEdit {
  const block = content.slice(range.start, range.end);
  const match = block.match(/^(\s*)\/\* ?([\s\S]*?) ?\*\/(\s*)$/);
  const transformed = match ? `${match[1]}${match[2]}${match[3]}` : `/* ${block} */`;
  return { content: `${content.slice(0, range.start)}${transformed}${content.slice(range.end)}`, start: range.start, end: range.start + transformed.length, label: 'Toggle block comment' };
}

function expandTabs(block: string, tabSize = 2) {
  return block.split('\n').map((line) => {
    let column = 0; let result = '';
    for (const character of line) {
      if (character !== '\t') { result += character; column += 1; continue; }
      const spaces = tabSize - (column % tabSize); result += ' '.repeat(spaces); column += spaces;
    }
    return result;
  }).join('\n');
}

function formatSource(block: string) {
  return expandTabs(block).split('\n').map((line) => line.replace(/[ \t]+$/g, '')).join('\n');
}

function lineIndexAt(content: string, position: number) { return content.slice(0, Math.max(0, Math.min(content.length, position))).split('\n').length - 1; }
function offsetForLine(lines: string[], target: number) { let offset = 0; for (let index = 0; index < target; index++) offset += lines[index]!.length + 1; return offset; }
