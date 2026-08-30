import type { BasicLine, BasicListing } from './types';

export type PlainBasicDialect = 'bbc-basic-ii' | 'atom-basic';

/** Decode a host text listing without changing the original bytes. Atom BASIC
 * is deliberately a separate dialect: its program representation is numbered
 * source text and may use a lower-case label immediately after a line number. */
export function decodePlainBasic(bytes: Uint8Array, dialect: PlainBasicDialect): BasicListing {
  const lines: BasicLine[] = [];
  const warnings: string[] = [];
  const seenNumbers = new Set<number>();
  const seenLabels = new Set<string>();
  let previousLine = -1;
  let offset = 0;

  while (offset < bytes.length) {
    let end = offset;
    while (end < bytes.length && bytes[end] !== 0x0a && bytes[end] !== 0x0d) end += 1;
    const encodedLength = end - offset;
    const raw = new TextDecoder('windows-1252').decode(bytes.slice(offset, end));
    const terminatorLength = end < bytes.length && bytes[end] === 0x0d && bytes[end + 1] === 0x0a ? 2 : end < bytes.length ? 1 : 0;
    const storedOffset = offset;
    offset = end + terminatorLength;
    if (!raw.length) continue;
    const match = raw.match(/^\s*(\d{1,5})(.*)$/u);
    const lineNumber = match ? Number(match[1]) : lines.length + 1;
    let source = match ? match[2]!.replace(/^\s/, '') : raw;
    let label: string | undefined;
    if (dialect === 'atom-basic' && match) {
      const labelled = match[2]!.match(/^([a-z])(?=[A-Z])/u);
      label = labelled?.[1];
      if (label) source = match[2]!.slice(1);
    }

    if (!match) warnings.push(`Physical line ${lines.length + 1} has no Atom/BBC line number.`);
    if (lineNumber < 1 || lineNumber > 32767) warnings.push(`Line number ${lineNumber} is outside 1–32767.`);
    if (seenNumbers.has(lineNumber)) warnings.push(`Line ${lineNumber} is duplicated.`);
    if (lineNumber <= previousLine) warnings.push(`Line ${lineNumber} is out of order.`);
    if (label && seenLabels.has(label)) warnings.push(`Atom label ${label} is declared more than once.`);
    seenNumbers.add(lineNumber);
    if (label) seenLabels.add(label);

    const references = Array.from(source.matchAll(/\b(?:GOTO|GOSUB)\s*(\d{1,5}|[a-z])\b/g), (reference) => reference[1]!);
    lines.push({ lineNumber, source, offset: storedOffset, byteLength: encodedLength, label, references });
    previousLine = lineNumber;
  }

  return {
    kind: 'bbc-basic',
    dialect: dialect === 'atom-basic' ? 'Atom BASIC' : 'BBC BASIC II',
    encoding: dialect === 'atom-basic' ? 'atom-text' : 'plain-text',
    lines,
    programLength: bytes.length,
    trailingByteCount: 0,
    warnings: [
      dialect === 'atom-basic'
        ? 'This is an Atom BASIC numbered-text program; it contains no BBC keyword tokens.'
        : 'This is a plain-text BBC BASIC listing; no token bytes were present.',
      ...warnings,
    ],
  };
}
