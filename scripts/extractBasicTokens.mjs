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
