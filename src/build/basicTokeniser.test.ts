import { describe, expect, it } from 'vitest';
import { decodeTokenizedBasic } from '../analysis/bbcBasic';
import { encodeLineReference, prepareAtomBasic, tokenizeBasic } from './basicTokeniser';

describe('BBC BASIC II tokeniser adapter', () => {
  it('tokenises and round-trips keywords, strings, comments and line targets', () => {
    const artifact = tokenizeBasic('10 MODE 7\n20 PRINT "GOTO 100"\n30 GOTO 100\n40 REM PRINT remains text\n100 END');
    expect(artifact.diagnostics).toEqual([]);
    expect(artifact.bytes).toContain(0xeb);
    expect(artifact.bytes).toContain(0x8d);
    expect(decodeTokenizedBasic(artifact.bytes)?.lines.map((line) => `${line.lineNumber} ${line.source}`)).toEqual([
      '10 MODE 7', '20 PRINT "GOTO 100"', '30 GOTO 100', '40 REM PRINT remains text', '100 END',
    ]);
  });
  it('uses the protected line-number encoding expected by the decoder', () => {
    const bytes = encodeLineReference(32767);
    const artifact = Uint8Array.from([0x0d, 0, 10, 9, 0xe5, ...bytes, 0x0d, 0xff]);
    expect(decodeTokenizedBasic(artifact)?.lines[0]?.source).toBe('GOTO32767');
  });
  it('reports unnumbered, duplicate, out-of-order and oversized lines', () => {
    const artifact = tokenizeBasic(`PRINT "NO"\n20 END\n20 END\n10 ${'A'.repeat(260)}`);
    expect(artifact.diagnostics.map((item) => item.message).join(' ')).toMatch(/must begin.*Duplicate.*not greater.*maximum/);
  });
});

describe('Atom BASIC source packer', () => {
  it('preserves Atom text syntax and emits a deterministic ASCII program', () => {
    const built = prepareAtomBasic('10 GOSUB a\n100aPRINT "ATOM"\'\n110 RETURN');
    expect(built).toMatchObject({ kind: 'atom-basic-text', dialect: 'Atom BASIC', lineCount: 3, diagnostics: [] });
    expect(new TextDecoder().decode(built.bytes)).toBe('10 GOSUB a\n100aPRINT "ATOM"\'\n110 RETURN\n');
  });

  it('rejects invalid line numbers, duplicates and non-ASCII keyboard payloads', () => {
    const built = prepareAtomBasic('0 PRINT "NO"\n10 PRINT "OK"\n10 PRINT "DUP"\n20 PRINT "£"');
    expect(built.diagnostics.filter((item) => item.severity === 'error').map((item) => item.message).join(' ')).toMatch(/outside 1–32767.*Duplicate.*printable ASCII/);
  });
});
