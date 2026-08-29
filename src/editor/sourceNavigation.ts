import type { ProjectFile } from '../project/project';

export interface SourceNavigationRange {
  kind: 'bracket' | 'loop';
  label: string;
  start: number;
  end: number;
  startLine: number;
  endLine: number;
}

export interface SourcePoint { line: number; column: number }

export function adjacentSourcePoint(points: SourcePoint[], current: SourcePoint, direction: 1 | -1): SourcePoint | undefined {
  if (!points.length) return undefined;
  const ordered = [...points].sort((left, right) => left.line - right.line || left.column - right.column);
  if (direction > 0) return ordered.find((point) => point.line > current.line || (point.line === current.line && point.column > current.column)) ?? ordered[0];
  return [...ordered].reverse().find((point) => point.line < current.line || (point.line === current.line && point.column < current.column)) ?? ordered.at(-1);
}

export function enclosingSourceRange(file: Pick<ProjectFile, 'content' | 'language'>, position: number): SourceNavigationRange | undefined {
  const masked = maskSource(file.content, file.language);
  const ranges = [...delimiterRanges(file.content, masked), ...(file.language === 'bbc-basic' ? basicLoopRanges(file.content, masked) : [])];
  return ranges.filter((range) => position >= range.start && position <= range.end).sort((left, right) => (left.end - left.start) - (right.end - right.start))[0];
}

function delimiterRanges(source: string, masked: string): SourceNavigationRange[] {
  const opening: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const closing = new Set(Object.values(opening));
  const stack: Array<{ token: string; position: number }> = [];
  const ranges: SourceNavigationRange[] = [];
  for (let position = 0; position < masked.length; position += 1) {
    const token = masked[position]!;
    if (opening[token]) stack.push({ token, position });
    else if (closing.has(token)) {
      const candidate = stack.at(-1);
      if (!candidate || opening[candidate.token] !== token) continue;
      stack.pop();
      ranges.push({ kind: 'bracket', label: `${candidate.token}${token} block`, start: candidate.position, end: position, startLine: lineAt(source, candidate.position), endLine: lineAt(source, position) });
    }
  }
  return ranges;
}

function basicLoopRanges(source: string, masked: string): SourceNavigationRange[] {
  const pairs: Record<string, string> = { FOR: 'NEXT', REPEAT: 'UNTIL', WHILE: 'ENDWHILE', IF: 'ENDIF' };
  const closers = new Set(Object.values(pairs));
  const stacks = new Map<string, Array<{ position: number; token: string }>>();
  const ranges: SourceNavigationRange[] = [];
  const tokenPattern = /\b(?:FOR|NEXT|REPEAT|UNTIL|WHILE|ENDWHILE|IF|ENDIF)\b/gi;
  for (const match of masked.matchAll(tokenPattern)) {
    const token = match[0]!.toUpperCase(); const position = match.index!;
    if (pairs[token]) {
      if (token === 'IF') {
        const lineEnd = masked.indexOf('\n', position);
        if (/\bTHEN\s*[^:\n]/i.test(masked.slice(position, lineEnd < 0 ? masked.length : lineEnd)) && !/\bTHEN\s*$/i.test(masked.slice(position, lineEnd < 0 ? masked.length : lineEnd).trim())) continue;
      }
      const stack = stacks.get(token) ?? []; stack.push({ position, token }); stacks.set(token, stack);
    } else if (closers.has(token)) {
      const opener = Object.keys(pairs).find((candidate) => pairs[candidate] === token)!;
      const start = stacks.get(opener)?.pop();
      if (start) ranges.push({ kind: 'loop', label: `${opener}/${token}`, start: start.position, end: position, startLine: lineAt(source, start.position), endLine: lineAt(source, position) });
    }
  }
  return ranges;
}

function maskSource(source: string, language: ProjectFile['language']): string {
  const characters = source.split('');
  let quote = ''; let comment = false;
  for (let position = 0; position < characters.length; position += 1) {
    const token = characters[position]!;
    if (token === '\n') { quote = ''; comment = false; continue; }
    if (comment) { characters[position] = ' '; continue; }
    if (quote) {
      if (token === quote && source[position - 1] !== '\\') quote = '';
      characters[position] = ' '; continue;
    }
    if (token === '"' || (token === "'" && language === 'c')) { quote = token; characters[position] = ' '; continue; }
    const tail = source.slice(position);
    if ((language === 'c' && tail.startsWith('//')) || ((language === '6502' || language === 'arm') && token === ';') || (language === 'bbc-basic' && /^(?:REM\b|DATA\b)/i.test(tail))) { comment = true; characters[position] = ' '; }
  }
  return characters.join('');
}

function lineAt(source: string, position: number) { return source.slice(0, position).split('\n').length; }
