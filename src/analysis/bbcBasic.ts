import type { BasicLine, BasicListing } from './types';

// BBC BASIC II token values, transcribed from the BBC Micro language ROM table.
export const BBC_BASIC_II_TOKENS: Record<number, string> = {
  0x80: 'AND', 0x81: 'DIV', 0x82: 'EOR', 0x83: 'MOD', 0x84: 'OR',
  0x85: 'ERROR', 0x86: 'LINE', 0x87: 'OFF', 0x88: 'STEP', 0x89: 'SPC',
  0x8a: 'TAB(', 0x8b: 'ELSE', 0x8c: 'THEN', 0x8e: 'OPENIN', 0x8f: 'PTR',
  0x90: 'PAGE', 0x91: 'TIME', 0x92: 'LOMEM', 0x93: 'HIMEM', 0x94: 'ABS',
  0x95: 'ACS', 0x96: 'ADVAL', 0x97: 'ASC', 0x98: 'ASN', 0x99: 'ATN',
  0x9a: 'BGET', 0x9b: 'COS', 0x9c: 'COUNT', 0x9d: 'DEG', 0x9e: 'ERL',
  0x9f: 'ERR', 0xa0: 'EVAL', 0xa1: 'EXP', 0xa2: 'EXT', 0xa3: 'FALSE',
  0xa4: 'FN', 0xa5: 'GET', 0xa6: 'INKEY', 0xa7: 'INSTR(', 0xa8: 'INT',
  0xa9: 'LEN', 0xaa: 'LN', 0xab: 'LOG', 0xac: 'NOT', 0xad: 'OPENUP',
  0xae: 'OPENOUT', 0xaf: 'PI', 0xb0: 'POINT(', 0xb1: 'POS', 0xb2: 'RAD',
  0xb3: 'RND', 0xb4: 'SGN', 0xb5: 'SIN', 0xb6: 'SQR', 0xb7: 'TAN',
  0xb8: 'TO', 0xb9: 'TRUE', 0xba: 'USR', 0xbb: 'VAL', 0xbc: 'VPOS',
  0xbd: 'CHR$', 0xbe: 'GET$', 0xbf: 'INKEY$', 0xc0: 'LEFT$(',
  0xc1: 'MID$(', 0xc2: 'RIGHT$(', 0xc3: 'STR$', 0xc4: 'STRING$(',
  0xc5: 'EOF', 0xc6: 'AUTO', 0xc7: 'DELETE', 0xc8: 'LOAD', 0xc9: 'LIST',
  0xca: 'NEW', 0xcb: 'OLD', 0xcc: 'RENUMBER', 0xcd: 'SAVE',
  0xcf: 'PTR', 0xd0: 'PAGE', 0xd1: 'TIME', 0xd2: 'LOMEM', 0xd3: 'HIMEM',
  0xd4: 'SOUND', 0xd5: 'BPUT', 0xd6: 'CALL', 0xd7: 'CHAIN', 0xd8: 'CLEAR',
  0xd9: 'CLOSE', 0xda: 'CLG', 0xdb: 'CLS', 0xdc: 'DATA', 0xdd: 'DEF',
  0xde: 'DIM', 0xdf: 'DRAW', 0xe0: 'END', 0xe1: 'ENDPROC',
  0xe2: 'ENVELOPE', 0xe3: 'FOR', 0xe4: 'GOSUB', 0xe5: 'GOTO', 0xe6: 'GCOL',
  0xe7: 'IF', 0xe8: 'INPUT', 0xe9: 'LET', 0xea: 'LOCAL', 0xeb: 'MODE',
  0xec: 'MOVE', 0xed: 'NEXT', 0xee: 'ON', 0xef: 'VDU', 0xf0: 'PLOT',
  0xf1: 'PRINT', 0xf2: 'PROC', 0xf3: 'READ', 0xf4: 'REM', 0xf5: 'REPEAT',
  0xf6: 'REPORT', 0xf7: 'RESTORE', 0xf8: 'RETURN', 0xf9: 'RUN',
  0xfa: 'STOP', 0xfb: 'COLOUR', 0xfc: 'TRACE', 0xfd: 'UNTIL',
  0xfe: 'WIDTH', 0xff: 'OSCLI',
};

function decodeLineReference(control: number, byte2: number, byte3: number): number {
  const shifted = (control << 2) & 0xff;
  const low = (shifted & 0xc0) ^ byte2;
  const high = ((shifted << 2) & 0xff) ^ byte3;
  return low | (high << 8);
}

function decodeBody(body: Uint8Array): { source: string; warnings: string[] } {
  let source = '';
  const warnings: string[] = [];
  let quoted = false;
  let literalTail = false;

  for (let index = 0; index < body.length; index += 1) {
    const value = body[index]!;
    if (value === 0x22) {
      quoted = !quoted;
      source += '"';
    } else if (!quoted && !literalTail && value === 0x8d) {
      if (index + 3 >= body.length) {
        warnings.push('A line-number token is truncated; its raw bytes were preserved visibly.');
        source += '[&8D]';
      } else {
        source += String(decodeLineReference(body[index + 1]!, body[index + 2]!, body[index + 3]!));
        index += 3;
      }
    } else if (!quoted && !literalTail && BBC_BASIC_II_TOKENS[value]) {
      source += BBC_BASIC_II_TOKENS[value];
      // BASIC II's tokeniser stops at REM and DATA. High bytes in the
      // remainder are literal program content, not more keyword tokens.
      if (value === 0xf4 || value === 0xdc) literalTail = true;
    } else if (value === 0x0d) {
      source += '[CR]';
      warnings.push('An unexpected carriage return was found inside a BASIC line.');
    } else {
      source += String.fromCharCode(value);
    }
  }

  return { source, warnings };
}

export function decodeTokenizedBasic(bytes: Uint8Array): BasicListing | null {
  const lines: BasicLine[] = [];
  const warnings: string[] = [];
  let offset = 0;
  let previousLine = -1;

  while (offset + 1 < bytes.length && bytes[offset] === 0x0d) {
    if (bytes[offset + 1] === 0xff) {
      if (!lines.length) return null;
      return {
        kind: 'bbc-basic',
        dialect: 'BBC BASIC II',
        encoding: 'tokenized',
        lines,
        programLength: offset + 2,
        trailingByteCount: bytes.length - offset - 2,
        warnings,
      };
    }
    if (offset + 4 > bytes.length) return null;
    const length = bytes[offset + 3]!;
    if (length < 5 || offset + length > bytes.length) return null;
    const lineNumber = (bytes[offset + 1]! << 8) | bytes[offset + 2]!;
    if (lineNumber > 32767) return null;
    if (lineNumber <= previousLine) {
      warnings.push(`Line ${lineNumber} is duplicate or out of order.`);
    }
    const decoded = decodeBody(bytes.slice(offset + 4, offset + length));
    warnings.push(...decoded.warnings.map((warning) => `Line ${lineNumber}: ${warning}`));
    lines.push({ lineNumber, source: decoded.source, offset, byteLength: length });
    previousLine = lineNumber;
    offset += length;
  }
  return null;
}

export function isProbablyText(bytes: Uint8Array): boolean {
  if (!bytes.length || bytes.includes(0)) return false;
  const printable = bytes.reduce(
    (count, value) => count + (value === 9 || value === 10 || value === 13 || (value >= 32 && value < 127) ? 1 : 0),
    0,
  );
  return printable / bytes.length >= 0.82;
}

export function decodePlainText(bytes: Uint8Array): string {
  return new TextDecoder('windows-1252').decode(bytes).replace(/\r\n?/g, '\n');
}
