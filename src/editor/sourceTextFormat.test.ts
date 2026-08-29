import { describe, expect, it } from 'vitest';
import { decodeSourceText, detectLineEnding, encodeSourceText } from './sourceTextFormat';

describe('source text format', () => {
  it('detects, normalizes and byte-exactly recreates UTF-8 BOM CRLF source', () => {
    const input = Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('10 PRINT "£"\r\n20 END\r\n')]);
    const decoded = decodeSourceText(input);
    expect(decoded).toEqual({ content: '10 PRINT "£"\n20 END\n', encoding: 'utf-8-bom', lineEnding: 'crlf', mixedLineEndings: false });
    expect(encodeSourceText(decoded.content, decoded.encoding, decoded.lineEnding)).toEqual(input);
  });

  it('falls back to Windows-1252 and refuses an unrepresentable download', () => {
    const decoded = decodeSourceText(Uint8Array.from([0x50, 0x52, 0x49, 0x4e, 0x54, 0x20, 0x93, 0x41, 0x94, 0x0d]));
    expect(decoded).toMatchObject({ content: 'PRINT “A”\n', encoding: 'windows-1252', lineEnding: 'cr' });
    expect(encodeSourceText(decoded.content, 'windows-1252', 'cr')).toEqual(Uint8Array.from([0x50, 0x52, 0x49, 0x4e, 0x54, 0x20, 0x93, 0x41, 0x94, 0x0d]));
    expect(() => encodeSourceText('PRINT "🙂"', 'windows-1252', 'lf')).toThrow(/cannot be represented/);
  });

  it('reports mixed line endings while choosing the dominant convention', () => {
    expect(detectLineEnding('a\r\nb\r\nc\n')).toEqual({ lineEnding: 'crlf', mixed: true });
  });
});
