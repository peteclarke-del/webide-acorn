import { BBC_BASIC_II_TOKENS } from '../analysis/bbcBasic';
import type { BuildDiagnostic } from './assembler6502';
import type { BuildProvenance } from './buildTarget';

export interface BasicArtifact {
  kind: 'bbc-basic-program' | 'atom-basic-text';
  bytes: Uint8Array;
  dialect: 'BBC BASIC II' | 'Atom BASIC';
  lineCount: number;
  diagnostics: BuildDiagnostic[];
  listing: string[];
  provenance?: BuildProvenance;
}

/** Atom BASIC stores program lines as text rather than BBC BASIC tokens. This
 * produces a deterministic ASCII payload suitable for file export or entry
 * through an authentic Atom interpreter. */
export function prepareAtomBasic(source: string): BasicArtifact {
  const diagnostics: BuildDiagnostic[] = [];
  const listing: string[] = [];
  const seen = new Set<number>();
  let previous = 0;
  for (const [index, physical] of source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n').entries()) {
    if (!physical.trim()) continue;
    const match = physical.match(/^\s*(\d{1,5})(?:\s?)(.*)$/);
    if (!match) { addDiagnostic(diagnostics, index + 1, 'Atom BASIC program lines must begin with a line number'); continue; }
    const lineNumber = Number(match[1]);
    const body = match[2]!;
    if (lineNumber < 1 || lineNumber > 32767) { addDiagnostic(diagnostics, index + 1, `Atom BASIC line number ${lineNumber} is outside 1–32767`); continue; }
    if (seen.has(lineNumber)) { addDiagnostic(diagnostics, index + 1, `Duplicate Atom BASIC line number ${lineNumber}`); continue; }
    if (lineNumber <= previous) addDiagnostic(diagnostics, index + 1, `Line ${lineNumber} is not greater than the previous line`, 'warning');
    const unsupported = Array.from(body).find((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) > 0x7e);
    if (unsupported) { addDiagnostic(diagnostics, index + 1, `Atom keyboard-entry artifacts support printable ASCII only; unsupported U+${unsupported.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`); continue; }
    if (body.length > 255) { addDiagnostic(diagnostics, index + 1, `Atom BASIC source line ${lineNumber} exceeds the bounded 255-character editor payload`); continue; }
    seen.add(lineNumber); previous = lineNumber;
    const separator = /^[a-z](?=[A-Z])/.test(body) ? '' : ' ';
    listing.push(`${lineNumber}${body ? `${separator}${body}` : ''}`);
  }
  if (!listing.length && !diagnostics.some((item) => item.severity === 'error')) addDiagnostic(diagnostics, 1, 'The Atom BASIC source contains no numbered program lines');
  const text = listing.length ? `${listing.join('\n')}\n` : '';
  return { kind: 'atom-basic-text', bytes: new TextEncoder().encode(text), dialect: 'Atom BASIC', lineCount: listing.length, diagnostics, listing };
}

const TOKEN_BY_KEYWORD = Object.entries(BBC_BASIC_II_TOKENS).map(([value, keyword]) => ({ value: Number(value), keyword })).sort((a, b) => b.keyword.length - a.keyword.length);
const LINE_TARGET_TOKENS = new Set([0x8b, 0x8c, 0xe4, 0xe5, 0xf7]); // ELSE, THEN, GOSUB, GOTO, RESTORE

export function tokenizeBasic(source: string): BasicArtifact {
  const diagnostics: BuildDiagnostic[] = [];
  const output: number[] = [];
  const listing: string[] = [];
  let previous = -1;
  const seen = new Set<number>();
  const physicalLines = source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  for (let index = 0; index < physicalLines.length; index += 1) {
    const physical = physicalLines[index]!;
    if (!physical.trim()) continue;
    const match = physical.match(/^\s*(\d{1,5})(?:\s?)(.*)$/);
    if (!match) { addDiagnostic(diagnostics, index + 1, 'BBC BASIC build lines must begin with a line number'); continue; }
    const lineNumber = Number(match[1]); const bodySource = match[2]!;
    if (lineNumber < 0 || lineNumber > 32767) { addDiagnostic(diagnostics, index + 1, `Line number ${lineNumber} is outside 0–32767`); continue; }
    if (seen.has(lineNumber)) { addDiagnostic(diagnostics, index + 1, `Duplicate BASIC line number ${lineNumber}`); continue; }
    if (lineNumber <= previous) addDiagnostic(diagnostics, index + 1, `Line ${lineNumber} is not greater than the previous line`, 'warning');
    seen.add(lineNumber); previous = lineNumber;
    const body = tokenizeBody(bodySource);
    const recordLength = body.length + 4;
    if (recordLength > 255) { addDiagnostic(diagnostics, index + 1, `Tokenized line ${lineNumber} is ${recordLength} bytes; the maximum is 255`); continue; }
    output.push(0x0d, lineNumber >>> 8, lineNumber & 0xff, recordLength, ...body);
    listing.push(`${lineNumber} ${bodySource}`);
  }
  output.push(0x0d, 0xff);
  return { kind: 'bbc-basic-program', bytes: Uint8Array.from(output), dialect: 'BBC BASIC II', lineCount: listing.length, diagnostics, listing };
}

function tokenizeBody(source: string): number[] {
  const output: number[] = []; let position = 0; let quoted = false; let literalTail = false; let expectsLine = false;
  while (position < source.length) {
    const character = source[position]!;
    if (character === '"') { quoted = !quoted; output.push(0x22); position += 1; continue; }
    if (!quoted && !literalTail && expectsLine) {
      const whitespace = source.slice(position).match(/^\s*/)?.[0] ?? '';
      output.push(...Array.from(whitespace).map((item) => item.charCodeAt(0))); position += whitespace.length;
      const number = source.slice(position).match(/^\d{1,5}/)?.[0];
      if (number) { output.push(...encodeLineReference(Number(number))); position += number.length; expectsLine = false; continue; }
      expectsLine = false;
    }
    if (!quoted && !literalTail) {
      const candidate = TOKEN_BY_KEYWORD.find(({ keyword }) => {
        if (source.slice(position, position + keyword.length).toUpperCase() !== keyword) return false;
        const wordStart = /[A-Z]/.test(keyword[0]!); const wordEnd = /[A-Z$]/.test(keyword.at(-1)!);
        const before = source[position - 1] ?? ''; const after = source[position + keyword.length] ?? '';
        return !(wordStart && /[A-Za-z0-9_$%]/.test(before)) && !(wordEnd && /[A-Za-z0-9_$%]/.test(after));
      });
      if (candidate) {
        output.push(candidate.value); position += candidate.keyword.length;
        if (candidate.value === 0xf4 || candidate.value === 0xdc) literalTail = true;
        if (LINE_TARGET_TOKENS.has(candidate.value)) expectsLine = true;
        continue;
      }
    }
    output.push(character.charCodeAt(0) & 0xff); position += 1;
  }
  return output;
}

export function encodeLineReference(lineNumber: number): number[] {
  const low = lineNumber & 0xff; const high = lineNumber >>> 8 & 0xff;
  const control = (((((low & 0xc0) | ((high & 0xc0) >>> 2)) >>> 2) ^ 0x54) & 0xff);
  return [0x8d, control, (low & 0x3f) | 0x40, (high & 0x3f) | 0x40];
}

function addDiagnostic(diagnostics: BuildDiagnostic[], line: number, message: string, severity: BuildDiagnostic['severity'] = 'error') { diagnostics.push({ line, column: 1, severity, message }); }
