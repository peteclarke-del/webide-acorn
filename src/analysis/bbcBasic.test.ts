import { describe, expect, it } from 'vitest';
import { decodeTokenizedBasic } from './bbcBasic';

function program(...lines: Array<[number, number[]]>) {
  const bytes: number[] = [];
  for (const [lineNumber, body] of lines) {
    bytes.push(0x0d, lineNumber >> 8, lineNumber & 0xff, body.length + 4, ...body);
  }
  bytes.push(0x0d, 0xff);
  return Uint8Array.from(bytes);
}

describe('BBC BASIC II listing', () => {
  it('decodes ROM keyword tokens while preserving tokens inside strings', () => {
    const result = decodeTokenizedBasic(program(
      [10, [0xeb, 0x37]],
      [20, [0xf1, 0x22, 0xeb, 0x22]],
    ));

    expect(result?.lines.map((line) => `${line.lineNumber} ${line.source}`)).toEqual([
      '10 MODE7',
      '20 PRINT"ë"',
    ]);
    expect(result?.programLength).toBe(16);
  });

  it('decodes the protected three-byte line-number representation', () => {
    // BASIC II encoding for line 100.
    const low = 100;
    const high = 0;
    const control = (((((low & 0xc0) | ((high & 0xc0) >> 2)) >> 2) ^ 0x54) & 0xff);
    const result = decodeTokenizedBasic(program([10, [0xe5, 0x8d, control, (low & 0x3f) | 0x40, high | 0x40]]));
    expect(result?.lines[0]?.source).toBe('GOTO100');
  });

  it('does not expand high bytes after REM or DATA', () => {
    const result = decodeTokenizedBasic(program(
      [10, [0xf4, 0x20, 0xeb]],
      [20, [0xdc, 0x20, 0xf1]],
    ));
    expect(result?.lines.map((line) => line.source)).toEqual(['REM ë', 'DATA ñ']);
  });

  it('rejects arbitrary data that merely begins with a carriage return', () => {
    expect(decodeTokenizedBasic(Uint8Array.from([0x0d, 0x00, 0x0a, 0xff]))).toBeNull();
  });
});
