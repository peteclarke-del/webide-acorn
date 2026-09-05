/*
 * Which BASICs have a keyword, taken from the ROMs rather than remembered.
 *
 * The language reference documents eighteen BBC BASIC keywords with cited
 * prose. There are a hundred and twenty-six in BASIC II alone, and writing the
 * rest would mean citing sections of a manual this build does not have — which
 * is inventing a citation, not writing documentation.
 *
 * What can be said about every one of them, exactly, is what the ROM tables
 * say: whether a machine has the keyword at all and what token it uses. That is
 * real reference information, it comes from the firmware, and it is the
 * difference between a hover that says nothing and one that says "this exists
 * on these machines, and nobody has written it up yet".
 */
import { BASIC_DIALECTS, type BasicDialectId } from './basicDialects';

export interface KeywordAvailability {
  keyword: string;
  /**
   * Every tabled dialect that defines it, and the tokens each uses.
   *
   * Usually one. Five keywords have two — HIMEM, LOMEM, PAGE, PTR and TIME —
   * because BBC BASIC gives a pseudo-variable one token for reading and
   * another for assigning, and the ROM lists it twice. Reporting only the
   * first would make the other token decode as an unknown byte.
   */
  dialects: Array<{ id: BasicDialectId; label: string; tokens: number[] }>;
  /** True where every tabled dialect has it, which is the common case. */
  everywhere: boolean;
  /** Said in the words a hover should use. */
  summary: string;
}

/** What the ROMs say about a keyword, or null when none of them has it. */
export function basicKeywordAvailability(keyword: string): KeywordAvailability | null {
  const canonical = keyword.toUpperCase();
  const dialects = BASIC_DIALECTS.flatMap((dialect) => {
    if (!dialect.order.includes(canonical)) return [];
    const tokens = Object.keys(dialect.tokens).map(Number).filter((candidate) => dialect.tokens[candidate] === canonical);
    /* A spelling that shares a token with another keeps that token; the map
     * holds whichever the ROM lists first, so the alias is looked up here. */
    const alias = dialect.aliases.find((entry) => entry.keyword === canonical)?.token;
    if (alias !== undefined && !tokens.includes(alias)) tokens.push(alias);
    tokens.sort((left, right) => left - right);
    return tokens.length ? [{ id: dialect.id, label: dialect.label, tokens }] : [];
  });
  if (!dialects.length) return null;

  const everywhere = dialects.length === BASIC_DIALECTS.length;
  const hex = (token: number) => `&${token.toString(16).toUpperCase().padStart(2, '0')}`;
  const everyToken = new Set(dialects.flatMap((entry) => entry.tokens));
  const pseudoVariable = dialects.some((entry) => entry.tokens.length > 1);
  const tokenText = pseudoVariable
    ? `listed twice with tokens ${[...everyToken].sort((left, right) => left - right).map(hex).join(' and ')}, because BBC BASIC gives a pseudo-variable one token for reading and another for assigning`
    : everyToken.size === 1
      ? `token ${hex([...everyToken][0]!)}`
      : dialects.map((entry) => `${entry.tokens.map(hex).join('/')} in ${entry.label}`).join(', ');

  return {
    keyword: canonical,
    dialects,
    everywhere,
    summary: everywhere
      ? `A keyword of every BBC BASIC this build has a table for, ${tokenText}.`
      : `A keyword of ${dialects.map((entry) => entry.label).join(', ')} — and not of the others — ${tokenText}.`,
  };
}

export interface CatalogueCoverage {
  dialect: BasicDialectId;
  label: string;
  keywords: number;
  documented: number;
  /** Named rather than counted, so the gap is a list somebody can work through. */
  undocumented: string[];
}

/**
 * How much of each dialect the written reference actually covers.
 *
 * The denominator comes from the ROM, so this cannot drift the way a
 * hand-kept list would: adding a keyword to the reference moves the number,
 * and nothing else does.
 */
export function catalogueCoverage(documented: Iterable<string>): CatalogueCoverage[] {
  const known = new Set([...documented].map((token) => token.toUpperCase()));

  return BASIC_DIALECTS.map((dialect) => {
    const keywords = [...new Set(dialect.order)];
    const undocumented = keywords.filter((keyword) => !known.has(keyword));
    return {
      dialect: dialect.id,
      label: dialect.label,
      keywords: keywords.length,
      documented: keywords.length - undocumented.length,
      undocumented,
    };
  });
}
