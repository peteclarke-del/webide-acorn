/*
 * Expanding the abbreviations BBC BASIC accepts, and refusing the ones it does not.
 *
 * `P.` is PRINT, and which keyword a prefix means is decided by the ROM's own
 * table order rather than by anything alphabetical: the machine takes the first
 * keyword in its table that the prefix matches. So this resolves against the
 * order read out of each ROM, and a different BASIC can legitimately expand the
 * same abbreviation differently.
 *
 * The rule is applied and not approximated. A prefix that matches nothing is
 * left alone rather than guessed at, and text inside a string, a REM tail or a
 * DATA payload is never touched — those are program content and the tokeniser
 * does not read them either.
 */
import type { BasicDialect } from './basicDialects';

export interface Abbreviation {
  /** The abbreviation as written, including its full stop. */
  written: string;
  keyword: string | null;
  /** Where it was in the line, so a caller can show or replace it. */
  start: number;
  end: number;
  /** Said when nothing matches, rather than leaving a silent non-expansion. */
  reason: string | null;
}

/** The keyword an abbreviation means in this dialect, or null when none does. */
export function expandAbbreviation(dialect: BasicDialect, written: string): string | null {
  const prefix = written.endsWith('.') ? written.slice(0, -1) : written;
  if (!prefix) return null;
  const upper = prefix.toUpperCase();
  /* The machine's own order decides. `P.` is PRINT rather than PAGE or PI
   * because PRINT is what its table reaches first. */
  return dialect.order.find((keyword) => keyword.startsWith(upper)) ?? null;
}

/*
 * Where a line is program text rather than something to expand.
 *
 * Strings, REM tails and DATA payloads are content: a `P.` inside one is two
 * characters somebody typed, not an abbreviation, and expanding it would edit
 * their data.
 */
function contentSpans(line: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let index = 0;
  let quoted = false;
  let quoteStart = 0;
  while (index < line.length) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted) { spans.push([quoteStart, index + 1]); quoted = false; }
      else { quoted = true; quoteStart = index; }
      index += 1;
      continue;
    }
    if (!quoted) {
      const rest = line.slice(index).toUpperCase();
      /* REM and DATA run to the end of the line, which is where the real
       * tokeniser stops as well. */
      if (rest.startsWith('REM') || rest.startsWith('DATA')) { spans.push([index, line.length]); break; }
    }
    index += 1;
  }
  /* An unterminated string still protects the rest of the line: the machine
   * would read it as string content too. */
  if (quoted) spans.push([quoteStart, line.length]);

  return spans;
}

function inContent(spans: Array<[number, number]>, start: number): boolean {
  return spans.some(([from, to]) => start >= from && start < to);
}

/** Every abbreviation in a line, expanded or refused with a reason. */
export function findAbbreviations(dialect: BasicDialect, line: string): Abbreviation[] {
  const spans = contentSpans(line);
  const found: Abbreviation[] = [];
  const pattern = /[A-Za-z][A-Za-z]*\./g;
  let match = pattern.exec(line);
  while (match !== null) {
    const start = match.index;
    if (!inContent(spans, start)) {
      const written = match[0];
      const keyword = expandAbbreviation(dialect, written);
      found.push({
        written,
        keyword,
        start,
        end: start + written.length,
        reason: keyword ? null : `${written} matches no keyword in ${dialect.label}, so it is left as it was written.`,
      });
    }
    match = pattern.exec(line);
  }

  return found;
}

/** A line with its abbreviations expanded. Content is never touched. */
export function expandLine(dialect: BasicDialect, line: string): string {
  const found = findAbbreviations(dialect, line).filter((entry) => entry.keyword);
  let expanded = '';
  let cursor = 0;
  for (const entry of found) {
    expanded += line.slice(cursor, entry.start) + entry.keyword;
    cursor = entry.end;
  }

  return expanded + line.slice(cursor);
}
