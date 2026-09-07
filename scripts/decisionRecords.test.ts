import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * The decision log and its index, held to each other.
 *
 * `docs/adr/README.md` carries a table of every record, and that table is
 * maintained by hand. Nothing checked it, and the log itself records what that
 * costs: records 0006 and 0009 were both written as 0006, and a decision log
 * whose identifiers are ambiguous cannot be cited. The renumbering fixed that
 * instance; nothing stopped the next one.
 *
 * So this holds three things that a reader of the index is entitled to assume:
 * every record on disk appears in it, every row points at a file that exists,
 * and no two records share a number. It also checks each record states its
 * status, because a record with no status is a draft that reads like a decision.
 */
const ADR_DIR = resolve(process.cwd(), 'docs/adr');
const INDEX = readFileSync(resolve(ADR_DIR, 'README.md'), 'utf8');

/** Every record file on disk, by the number in its filename. */
function recordsOnDisk(): Array<{ number: string; filename: string }> {
  return readdirSync(ADR_DIR)
    .filter((name) => /^\d{4}-.+\.md$/.test(name))
    .map((filename) => ({ number: filename.slice(0, 4), filename }))
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

/** Every row of the index table, taken from its links rather than its prose. */
function rowsInIndex(): Array<{ number: string; filename: string }> {
  return [...INDEX.matchAll(/^\|\s*\[(\d{4})\]\(([^)]+)\)\s*\|/gm)].map((match) => ({ number: match[1]!, filename: match[2]! }));
}

describe('the architecture decision log', () => {
  it('has records to index', () => {
    /* If this ever reads zero the checks below all pass vacuously. */
    expect(recordsOnDisk().length).toBeGreaterThanOrEqual(10);
  });

  it('lists every record that exists', () => {
    const listed = new Set(rowsInIndex().map((row) => row.filename));
    const missing = recordsOnDisk().filter((record) => !listed.has(record.filename)).map((record) => record.filename);
    expect(missing, 'a record nobody can find from the index is a decision nobody will read').toEqual([]);
  });

  it('points every row at a record that exists', () => {
    const present = new Set(recordsOnDisk().map((record) => record.filename));
    const dangling = rowsInIndex().filter((row) => !present.has(row.filename)).map((row) => row.filename);
    expect(dangling, 'the index names a record that is not there').toEqual([]);
  });

  it('gives every record its own number', () => {
    /* The failure this log has already had once. */
    const seen = new Map<string, string[]>();
    for (const record of recordsOnDisk()) seen.set(record.number, [...(seen.get(record.number) ?? []), record.filename]);
    const clashes = [...seen.entries()].filter(([, files]) => files.length > 1).map(([number, files]) => `${number}: ${files.join(' and ')}`);
    expect(clashes, 'two records with one number cannot be cited apart').toEqual([]);
  });

  it('numbers each record consistently with its own heading', () => {
    const wrong: string[] = [];
    for (const record of recordsOnDisk()) {
      const heading = readFileSync(resolve(ADR_DIR, record.filename), 'utf8').split('\n')[0] ?? '';
      if (!heading.includes(`ADR ${record.number}`)) wrong.push(`${record.filename} heads itself "${heading.slice(0, 60)}"`);
    }
    expect(wrong, 'a record filed under one number and titled another').toEqual([]);
  });

  it('states a status on every record', () => {
    const statusless = recordsOnDisk().filter((record) =>
      !/^Status:\s*\S/m.test(readFileSync(resolve(ADR_DIR, record.filename), 'utf8'))).map((record) => record.filename);
    expect(statusless, 'a record with no status reads as decided when it may not be').toEqual([]);
  });
});
