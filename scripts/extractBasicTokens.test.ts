// @vitest-environment node

/* That the keyword-table reader stops where the table stops.
 *
 * The reader is the reason this repository holds no hand-transcribed tables,
 * and the thing that can go wrong with it is not misreading an entry — the
 * format is three fields — but misjudging where the table ends. A terminator
 * that stops early produces a partial table, which is worse than none: it
 * decodes most of a program and corrupts the rest, and nothing notices until
 * somebody's listing comes out wrong in one place.
 *
 * The ROMs themselves are never in this repository, so the fixtures here are
 * built in the same shape rather than copied out of firmware. They are not a
 * substitute for the reproduction contract in `src/analysis/basicDialects.test.ts`,
 * which checks the reader against a table transcribed independently by hand;
 * they are what makes the terminator itself checkable everywhere.
 */
import { describe, expect, it } from 'vitest';
import { readTokenTable } from './extractBasicTokens.mjs';

/** A table in the layout every one of these BASICs uses, then whatever follows. */
function table(entries: Array<[string, number, number]>, tail: number[] = []): Uint8Array {
  const bytes: number[] = [];
  for (const [keyword, token, flag] of entries) {
    for (const character of keyword) bytes.push(character.charCodeAt(0));
    bytes.push(token, flag);
  }
  return Uint8Array.from([...bytes, ...tail]);
}

const OPENING: Array<[string, number, number]> = [['AND', 0x80, 0x02], ['ABS', 0x94, 0x00]];

describe('the BASIC keyword-table reader', () => {
  it('reads a table and stops where code follows it', () => {
    /* A 6502 language ROM puts executable code straight after the table. */
    const bytes = table([...OPENING, ['HIMEM', 0xd3, 0x00]], [0x78, 0x47, 0xc0, 0xb4, 0xfc, 0x03]);
    expect(readTokenTable(bytes).map((entry) => entry.keyword)).toEqual(['AND', 'ABS', 'HIMEM']);
  });

  it('does not stop at a flag of &80, which is an ordinary flag on ARM BASIC', () => {
    /* This is the defect the terminator used to have. `INSTR(`, `LEFT$(`,
     * `MID$(` and every other keyword ending in a bracket carry &80 in BBC
     * BASIC V, and treating that as code cut its table off two thirds of the
     * way through — at `INT`, the entry immediately before `INSTR(`. */
    const bytes = table([...OPENING, ['INT', 0xa8, 0x00], ['INSTR(', 0xa7, 0x80], ['WIDTH', 0xfe, 0x02]], [0x20, 0x75, 0x6e]);
    expect(readTokenTable(bytes).map((entry) => entry.keyword)).toEqual(['AND', 'ABS', 'INT', 'INSTR(', 'WIDTH']);
  });

  it('stops where an ARM BASIC table ends, which is a message rather than code', () => {
    /* BBC BASIC V follows its table with its own " unlistable token" string.
     * That is printable, so only the keyword shape distinguishes it. */
    const message = [...' unlistable token'].map((character) => character.charCodeAt(0));
    const bytes = table([...OPENING, ['WIDTH', 0xfe, 0x02]], message);
    expect(readTokenTable(bytes).map((entry) => entry.keyword)).toEqual(['AND', 'ABS', 'WIDTH']);
  });

  it('keeps the token and flag of every entry, because both are the ROM\'s answer', () => {
    expect(readTokenTable(table(OPENING))).toEqual([
      { keyword: 'AND', token: 0x80, flag: 0x02 },
      { keyword: 'ABS', token: 0x94, flag: 0x00 },
    ]);
  });

  it('stops at a byte that could not be a token', () => {
    /* Below &7F is not a token in any of these ROMs — BASIC V uses &7F for
     * OTHERWISE, which is the lowest — so a smaller byte is something else. */
    const bytes = table(OPENING, [0x5a, 0x5a, 0x40, 0x00]);
    expect(readTokenTable(bytes).map((entry) => entry.keyword)).toEqual(['AND', 'ABS']);
  });

  it('finds the table wherever it sits, and prefers the longest candidate', () => {
    /* A ROM is searched rather than indexed, so a stray "AND" followed by &80
     * elsewhere must not win against the real table. */
    const decoy = Uint8Array.from([0x41, 0x4e, 0x44, 0x80, 0x00, 0x11, 0x22]);
    const real = table([...OPENING, ['PRINT', 0xf1, 0x02]], [0x00]);
    const bytes = Uint8Array.from([...decoy, ...real]);
    expect(readTokenTable(bytes).map((entry) => entry.keyword)).toEqual(['AND', 'ABS', 'PRINT']);
  });

  it('answers with nothing rather than a guess when there is no table', () => {
    expect(readTokenTable(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).toEqual([]);
  });
});
