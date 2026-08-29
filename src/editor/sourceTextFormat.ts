export type SourceEncoding = 'utf-8' | 'utf-8-bom' | 'windows-1252';
export type SourceLineEnding = 'lf' | 'crlf' | 'cr';
export const LARGE_SOURCE_WARNING_BYTES = 256 * 1024;
export const MAX_SOURCE_FILE_BYTES = 1024 * 1024;
export const MAX_PROJECT_SOURCE_BYTES = 8 * 1024 * 1024;

export function sourceUtf8ByteLength(content: string) { return new TextEncoder().encode(content).length; }

export interface DecodedSourceText {
  content: string;
  encoding: SourceEncoding;
  lineEnding: SourceLineEnding;
  mixedLineEndings: boolean;
}

const WINDOWS_1252_SPECIAL = ['€', '\u0081', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u008d', 'Ž', '\u008f', '\u0090', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u009d', 'ž', 'Ÿ'];
const WINDOWS_1252_REVERSE = new Map(WINDOWS_1252_SPECIAL.map((character, index) => [character, 0x80 + index]));

export function detectLineEnding(text: string): { lineEnding: SourceLineEnding; mixed: boolean } {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const withoutCrlf = text.replaceAll('\r\n', '');
  const lf = (withoutCrlf.match(/\n/g) ?? []).length;
  const cr = (withoutCrlf.match(/\r/g) ?? []).length;
  const kinds = [crlf, lf, cr].filter((count) => count > 0).length;
  if (crlf >= lf && crlf >= cr && crlf > 0) return { lineEnding: 'crlf', mixed: kinds > 1 };
  if (cr > lf && cr > 0) return { lineEnding: 'cr', mixed: kinds > 1 };
  return { lineEnding: 'lf', mixed: kinds > 1 };
}

export function decodeSourceText(bytes: Uint8Array): DecodedSourceText {
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = bom ? bytes.subarray(3) : bytes;
  let decoded: string; let encoding: SourceEncoding;
  try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(body); encoding = bom ? 'utf-8-bom' : 'utf-8'; }
  catch { decoded = Array.from(body, (byte) => byte >= 0x80 && byte <= 0x9f ? WINDOWS_1252_SPECIAL[byte - 0x80]! : String.fromCodePoint(byte)).join(''); encoding = 'windows-1252'; }
  const detected = detectLineEnding(decoded);
  return { content: decoded.replaceAll('\r\n', '\n').replaceAll('\r', '\n'), encoding, lineEnding: detected.lineEnding, mixedLineEndings: detected.mixed };
}

export function encodeSourceText(content: string, encoding: SourceEncoding, lineEnding: SourceLineEnding): Uint8Array {
  const separator = lineEnding === 'crlf' ? '\r\n' : lineEnding === 'cr' ? '\r' : '\n';
  const text = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replaceAll('\n', separator);
  if (encoding === 'utf-8' || encoding === 'utf-8-bom') {
    const bytes = new TextEncoder().encode(text);
    if (encoding === 'utf-8') return bytes;
    const result = new Uint8Array(bytes.length + 3); result.set([0xef, 0xbb, 0xbf]); result.set(bytes, 3); return result;
  }
  const output: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (code <= 0x7f || (code >= 0xa0 && code <= 0xff)) output.push(code);
    else if (WINDOWS_1252_REVERSE.has(character)) output.push(WINDOWS_1252_REVERSE.get(character)!);
    else throw new Error(`Character ${JSON.stringify(character)} cannot be represented in Windows-1252.`);
  }
  return Uint8Array.from(output);
}
