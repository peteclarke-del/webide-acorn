import type { ProjectFile } from '../project/project';
import type { ProjectLanguageIndex, ProjectReferenceResult } from './projectLanguageService';

export interface ProjectRenameFileChange {
  fileId: string;
  fileName: string;
  replacements: number;
  before: string;
  after: string;
  lines: number[];
}

export interface ProjectRenamePreview {
  token: string;
  replacement: string;
  changes: ProjectRenameFileChange[];
  errors: string[];
}

const normalized = (value: string, language: ProjectFile['language']) => language === 'c' ? value.replace(/^\./, '') : value.replace(/^\./, '').toUpperCase();

function offsetAt(content: string, line: number, column: number) {
  if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) return null;
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const newline = content.indexOf('\n', offset);
    if (newline < 0) return null;
    offset = newline + 1;
  }
  const result = offset + column - 1;
  return result <= content.length ? result : null;
}

export function previewProjectRename(files: readonly ProjectFile[], index: ProjectLanguageIndex, references: ProjectReferenceResult, replacementInput: string): ProjectRenamePreview {
  const replacement = replacementInput.trim();
  const errors: string[] = [];
  const declaration = references.declarations[0];
  if (references.status !== 'resolved' || references.declarations.length !== 1 || !declaration) errors.push(references.reason || 'The symbol does not resolve to one declaration.');
  const language = declaration?.language ?? 'text';
  const originalToken = language === 'c' && declaration ? declaration.token : references.token;
  const supportedDeclaration = declaration && ((language === '6502' || language === 'arm') && declaration.kind === 'label' || language === 'c' && declaration.kind === 'function' || language === 'bbc-basic' && (declaration.kind === 'procedure' || declaration.kind === 'function'));
  if (declaration && !supportedDeclaration) errors.push(declaration.language === 'bbc-basic' && declaration.kind === 'line' ? 'Use BASIC renumber for numeric line targets.' : 'Safe rename supports uniquely resolved assembly labels, C functions, and BBC or Atom BASIC PROC/FN routines.');
  const validIdentifier = language === 'bbc-basic' ? /^(?:PROC|FN)[A-Za-z_][A-Za-z0-9_]{0,75}$/i.test(replacement) : /^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(replacement);
  if (!validIdentifier) errors.push(language === 'bbc-basic' ? 'The replacement must retain a PROC or FN prefix followed by a valid BASIC routine name.' : 'The replacement must be a 1 to 80 character identifier beginning with a letter or underscore.');
  if (language === 'bbc-basic' && /^(PROC|FN)/i.exec(replacement)?.[1]?.toUpperCase() !== /^(PROC|FN)/i.exec(originalToken)?.[1]?.toUpperCase()) errors.push('A BASIC routine rename cannot change a PROC into an FN or an FN into a PROC.');
  if (replacement && normalized(replacement, language) === normalized(originalToken, language)) errors.push(`The replacement is unchanged after ${language === 'c' ? 'C' : language === 'bbc-basic' ? 'BASIC' : 'assembler'} symbol normalization.`);
  if (declaration && index.symbols.some((symbol) => symbol.language === language && normalized(symbol.token, language) === normalized(replacement, language) && normalized(symbol.token, language) !== normalized(originalToken, language))) errors.push(`The replacement ${replacement} collides with an existing ${language.toUpperCase()} symbol.`);
  const candidateFiles = declaration ? relatedRenameFiles(files, index, declaration.fileId, language) : [];
  const known = new Set(references.locations.map((location) => `${location.fileId}:${location.line}:${location.column}:${location.length}`));
  for (const file of candidateFiles) {
    const occurrences = identifierOccurrences(file, originalToken);
    if (!occurrences.length) continue;
    if (file.access === 'read-only' || file.kind === 'generated') errors.push(`${file.name} contains ${originalToken} but is read-only; rename cannot exclude a protected occurrence.`);
    if (hasConditionalCompilation(file)) errors.push(`${file.name} contains conditional compilation; rename is blocked until the active branches are supplied by an authoritative language service.`);
    const unknown = occurrences.find((occurrence) => !known.has(`${file.id}:${occurrence.line}:${occurrence.column}:${occurrence.length}`));
    if (unknown) errors.push(`${file.name}:${unknown.line}:${unknown.column} contains an unresolved occurrence of ${originalToken}; rename cannot safely exclude or classify it.`);
  }
  if (errors.length) return { token: originalToken, replacement, changes: [], errors };

  const changes: ProjectRenameFileChange[] = [];
  for (const file of files) {
    const locations = references.locations.filter((location) => location.fileId === file.id);
    if (!locations.length) continue;
    const edits = locations.map((location) => {
      const start = offsetAt(file.content, location.line, location.column);
      const source = start === null ? '' : file.content.slice(start, start + location.length);
      if (start === null || normalized(source, language) !== normalized(originalToken, language)) {
        errors.push(`${file.name}:${location.line}:${location.column} no longer contains ${originalToken}; refresh references before renaming.`);
        return null;
      }
      return { start, end: start + location.length, value: source.startsWith('.') ? `.${replacement}` : replacement, line: location.line };
    });
    if (edits.some((edit) => edit === null)) continue;
    const ordered = (edits as Array<{ start: number; end: number; value: string; line: number }>).sort((left, right) => right.start - left.start);
    let after = file.content;
    for (const edit of ordered) after = `${after.slice(0, edit.start)}${edit.value}${after.slice(edit.end)}`;
    changes.push({ fileId: file.id, fileName: file.name, replacements: ordered.length, before: file.content, after, lines: Array.from(new Set(ordered.map((edit) => edit.line))).sort((a, b) => a - b) });
  }
  if (!errors.length && !changes.length) errors.push('No safe declaration or reference ranges were found.');
  return { token: originalToken, replacement, changes: errors.length ? [] : changes, errors };
}

function relatedRenameFiles(files: readonly ProjectFile[], index: ProjectLanguageIndex, start: string, language: ProjectFile['language']) {
  if (language === 'bbc-basic') return files.filter((file) => file.id === start);
  const adjacent = new Map<string, Set<string>>(files.map((file) => [file.id, new Set()]));
  for (const [from, targets] of index.includes) for (const target of targets) { adjacent.get(from)?.add(target); adjacent.get(target)?.add(from); }
  const visited = new Set<string>(); const pending = [start];
  while (pending.length) { const current = pending.pop()!; if (visited.has(current)) continue; visited.add(current); for (const next of adjacent.get(current) ?? []) pending.push(next); }
  return files.filter((file) => visited.has(file.id) && file.language === language);
}

function hasConditionalCompilation(file: ProjectFile) {
  if (file.language === 'c') return /^\s*#\s*(?:if|ifdef|ifndef|elif|else|endif)\b/im.test(file.content);
  if (file.language === '6502' || file.language === 'arm') return /^\s*(?:\.?if(?:def|ndef)?|\.?elif|\.?else|\.?endif)\b/im.test(file.content);
  return false;
}

function identifierOccurrences(file: ProjectFile, token: string) {
  const masked = maskNonCode(file);
  const expression = new RegExp(`${file.language === '6502' ? '\\.?': ''}${escapeRegExp(token.replace(/^\./, ''))}`, file.language === 'c' ? 'g' : 'gi');
  return Array.from(masked.matchAll(expression)).flatMap((match) => {
    const start = match.index!; const before = masked[start - 1] ?? ''; const after = masked[start + match[0]!.length] ?? '';
    if (/[A-Za-z0-9_]/.test(before) || /[A-Za-z0-9_]/.test(after)) return [];
    const offset = start + (match[0]!.startsWith('.') ? 1 : 0); const prefix = file.content.slice(0, offset); const lineStart = prefix.lastIndexOf('\n') + 1;
    return [{ line: prefix.split('\n').length, column: offset - lineStart + 1, length: token.replace(/^\./, '').length }];
  });
}

function maskNonCode(file: ProjectFile) {
  const source = file.content; const result = source.split(''); let quote = ''; let lineComment = false; let blockComment = false;
  for (let index = 0; index < result.length; index += 1) {
    const character = source[index]!; const next = source[index + 1] ?? '';
    if (character === '\n') { quote = ''; lineComment = false; continue; }
    if (lineComment) { result[index] = ' '; continue; }
    if (blockComment) { result[index] = ' '; if (character === '*' && next === '/') { result[index + 1] = ' '; blockComment = false; index += 1; } continue; }
    if (quote) { result[index] = ' '; if (character === '\\') { if (index + 1 < result.length) result[++index] = ' '; } else if (character === quote) quote = ''; continue; }
    if (character === '"' || (file.language === 'c' && character === "'")) { quote = character; result[index] = ' '; continue; }
    const tail = source.slice(index);
    if (file.language === 'c' && character === '/' && next === '*') { blockComment = true; result[index] = result[index + 1] = ' '; index += 1; continue; }
    if (file.language === 'c' && character === '/' && next === '/' || (file.language === '6502' || file.language === 'arm') && (character === ';' || file.language === 'arm' && character === '@') || file.language === 'bbc-basic' && /^(?:REM|DATA)\b/i.test(tail)) { lineComment = true; result[index] = ' '; }
  }
  return result.join('');
}

function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
