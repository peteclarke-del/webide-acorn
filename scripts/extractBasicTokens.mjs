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
 * byte. The table ends where the bytes stop looking like one: a flag byte with
 * its top bit set is code rather than a flag, and every one of the four ROMs
 * read here ends at the same keyword, which is the corroboration that the rule
 * is the table's and not this file's.
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
      /* A token is &7F or above — BASIC V uses &7F for OTHERWISE — and a flag
       * is a small bitfield. A byte with its top bit set in the flag position
       * is the code that follows the table. */
      if (token < 0x7f || flag >= 0x80 || !KEYWORD.test(keyword)) break;
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
