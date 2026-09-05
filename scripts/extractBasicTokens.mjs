#!/usr/bin/env node
/*
 * Reads a BBC BASIC keyword table out of a language ROM.
 *
 * The tables for the other BASIC ROMs were not going to be transcribed by hand:
 * a hand-copied table of 128 entries has a typo in it and nothing would find
 * that typo until somebody's program decoded wrongly. They are read from the
 * ROM instead.
 *
 * What makes that trustworthy is that the same reader reproduces the BASIC II
 * table this repository already carries — transcribed independently, by hand,
 * long before this existed. If the reader is wrong, that comparison fails.
 *
 * The format is a keyword in printable ASCII, then a token byte, then a flag
 * byte. The table ends where the bytes stop looking like one: the next thing is
 * not a keyword. Every one of the four 6502 ROMs read here ends at the same
 * keyword, which is the corroboration that the rule is the table's and not this
 * file's.
 *
 * The terminator used to be "a flag byte with its top bit set is code rather
 * than a flag", which gave the same answer on those four ROMs and the wrong one
 * on an ARM BASIC. There, `&80` is an ordinary flag — it is what `INSTR(`,
 * `LEFT$(`, `MID$(` and the other keywords ending in a bracket carry — and the
 * rule cut BBC BASIC V's table off at `INT`, two thirds of the way through. So
 * the terminator is the keyword pattern alone, which stops in the same place on
 * every 6502 ROM read here and stops on ARM where BASIC's own " unlistable
 * token" message begins.
 *
 * ROMs are never committed. Run this against firmware you already have.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const KEYWORD = /^[A-Z][A-Z0-9$(]{0,9}$/;

/** @returns {{ keyword: string, token: number, flag: number }[]} */
export function readTokenTable(bytes) {
  let best = [];
  for (let start = 0; start + 4 < bytes.length; start += 1) {
    /* Every one of these tables begins with AND at &80; finding it is how the
     * table is located without knowing where a particular ROM puts it. */
    if (!(bytes[start] === 0x41 && bytes[start + 1] === 0x4e && bytes[start + 2] === 0x44 && bytes[start + 3] === 0x80)) continue;
    const entries = [];
    let index = start;
    while (index < bytes.length) {
      let end = index;
      let keyword = '';
      while (end < bytes.length && bytes[end] >= 0x20 && bytes[end] < 0x7f) { keyword += String.fromCharCode(bytes[end]); end += 1; }
      if (!keyword || end + 1 >= bytes.length) break;
      const token = bytes[end];
      const flag = bytes[end + 1];
      /* A token is &7F or above — BASIC V uses &7F for OTHERWISE. The flag is
       * not tested: on ARM BASIC &80 is an ordinary flag value, so testing it
       * truncates that table rather than terminating it. */
      if (token < 0x7f || !KEYWORD.test(keyword)) break;
      entries.push({ keyword, token, flag });
      index = end + 2;
    }
    if (entries.length > best.length) best = entries;
  }

  return best;
}

/*
 * How an entry's flag byte turns into the bytes BASIC actually emits.
 *
 * This is measured, not inferred. The 6502 BASICs put one byte per keyword and
 * the flag says nothing about encoding, but an ARM BASIC prefixes some keywords
 * — which is why twenty-three token bytes in its table are shared by two or
 * three entries each. Reading the bits was not enough to settle which: the
 * obvious reading put APPEND and SUM in the same group under the same token.
 *
 * So the mapping was measured. Every distinct flag value in BBC BASIC V 1.05
 * was typed into a real RISC OS 3.11 machine running on this build's own A310
 * core, and the tokenised program was read back out of its memory. Sixty-seven
 * keywords across all seventeen flag values, and the answers are these.
 */
export const TOKEN_PREFIX = Object.freeze({ C6: 0xc6, C7: 0xc7, C8: 0xc8 });

/**
 * The prefix an entry is emitted behind, `'pseudo'` for a keyword that has a
 * separate statement form, or null for a plain one-byte token.
 *
 * @param {number} flag
 * @returns {number|'pseudo'|null}
 */
export function encodingOf(flag) {
  /* &08 marks a prefixed keyword; &04 and &40 choose which prefix. Measured:
   * SUM and BEAT (flag &0E) come back as &C6; the eighteen entries with &09,
   * &0A, &18 and &28 come back as &C7; the twenty-one with &49 and &4A come
   * back as &C8. */
  if (flag & 0x08) {
    if (flag & 0x40) return TOKEN_PREFIX.C8;
    return (flag & 0x04) ? TOKEN_PREFIX.C6 : TOKEN_PREFIX.C7;
  }
  /* &40 without &08 is a pseudo-variable: the table token is what BASIC emits
   * for it on the right of an assignment, and it has a second token, absent
   * from the table, for the left. Measured: PTR, PAGE, TIME, LOMEM and HIMEM
   * come back as &CF to &D3 as statements and as their table tokens — &8F to
   * &93 — as functions. */
  if (flag & 0x40) return 'pseudo';
  return null;
}

/**
 * Statement forms that are not in the table at all, in the table's own order.
 *
 * Two kinds, both measured rather than assumed. The five pseudo-variables take
 * &CF to &D3 when they are assigned to. And `ELSE`, whose table token &8B is
 * what it takes inside `IF ... THEN ... ELSE ...`, takes &CC when it begins a
 * statement — typing `ELSE` on its own line produced &CC, and
 * `IF A=1 THEN 920 ELSE 930` produced &8B.
 */
export const STATEMENT_FORMS = Object.freeze({ 0xcc: 'ELSE', 0xcf: 'PTR', 0xd0: 'PAGE', 0xd1: 'TIME', 0xd2: 'LOMEM', 0xd3: 'HIMEM' });

/**
 * A line number inside a program, which is not a token and not text.
 *
 * `&8D` introduces three bytes carrying the number with its top bits moved out
 * of the way, so that none of them can look like a token or a terminator. A
 * reader that did not know this would print three bytes of noise after every
 * GOTO. Measured against four line numbers: 900, 910, 920 and 940 came back as
 * `8D 74 44 43`, `8D 74 4E 43`, `8D 74 58 43` and `8D 74 6C 43`.
 */
export const LINE_NUMBER_TOKEN = 0x8d;

/** @param {number[]} triple */
export function decodeLineNumber(triple) {
  const [first, second, third] = triple;
  /* The first byte carries the two top bits of each of the other two, moved out
   * of the way so that neither can look like a token or a terminator, and then
   * exclusive-ored with &54. */
  const carried = (first ^ 0x54) & 0xff;
  const low = (second & 0x3f) | ((carried << 2) & 0xc0);
  const high = (third & 0x3f) << 8;
  return (high | low | ((carried << 12) & 0xc000)) & 0xffff;
}

/** @param {number} line */
export function encodeLineNumber(line) {
  const first = (((line & 0xc0) >> 2) | ((line & 0xc000) >> 12)) ^ 0x54;
  return [first & 0xff, (line & 0x3f) | 0x40, ((line >> 8) & 0x3f) | 0x40];
}

/* Compared as resolved paths: a directory with a space in it does not
 * survive a naive comparison against a file URL. */
if (argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(argv[1])) {
  const path = argv[2];
  if (!path) { process.stderr.write('Usage: extractBasicTokens.mjs <rom>\n'); exit(2); }
  const bytes = new Uint8Array(await readFile(path));
  const entries = readTokenTable(bytes);
  if (!entries.length) { process.stderr.write(`No BBC BASIC keyword table was found in ${path}.\n`); exit(1); }
  process.stdout.write(`${JSON.stringify({
    source: path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    entries: entries.length,
    lastKeyword: entries[entries.length - 1].keyword,
    table: entries.map(({ keyword, token }) => [token, keyword]),
  }, null, 2)}\n`);
}
