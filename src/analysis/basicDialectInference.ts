/*
 * Working out which BASIC a file is, and refusing when the file does not say.
 *
 * The requirement asks for this to refuse ambiguous dialects safely, and that
 * is the whole difficulty: most short BASIC programs are valid in every dialect
 * and there is nothing in them to tell one from another. Choosing anyway would
 * decode somebody's program under the wrong table and produce plausible,
 * subtly-wrong text, which is worse than saying "this could be any of these".
 *
 * So evidence has to be positive and specific: a token only one dialect
 * defines, or a line structure only one dialect uses. Frequency is not
 * evidence, and neither is a keyword every dialect shares.
 *
 * How little evidence there usually is came out of the tables themselves: of
 * the four 6502-family BASICs read here, exactly one token belongs to a single
 * dialect, &CE, EDIT, which only BASIC IV has. Every other token is shared.
 * So a tokenised BBC BASIC file almost never says which ROM wrote it, and an
 * inference that returned a dialect anyway would be inventing one for nearly
 * every file it saw. Saying so is the useful answer; the machine somebody
 * selected is where the dialect actually comes from.
 */
import { BASIC_DIALECTS, type BasicDialect, type BasicDialectId } from './basicDialects';

export interface DialectEvidence {
  dialect: BasicDialectId;
  /** What was found, in words that name the thing rather than a score. */
  detail: string;
}

export interface DialectInference {
  /** The one dialect the evidence points at, or null when it does not point at one. */
  dialect: BasicDialectId | null;
  candidates: BasicDialectId[];
  evidence: DialectEvidence[];
  /** Always said, including when the answer is that it cannot be told. */
  reason: string;
}

/*
 * What each token narrows the answer to.
 *
 * The first version of this asked which tokens exactly one *dialect* defines,
 * and the second which tokens exactly one *table* defines. Both were the same
 * mistake in different sizes: they treated evidence as a thing that either
 * names one answer or is worthless, and every time a dialect was added the
 * evidence appeared to vanish.
 *
 * It had not vanished. `&7F` is OTHERWISE, which the three ARM tables define and
 * no 6502 one does. That does not name a dialect and it rules out four of them,
 * which is a real and useful thing to be able to say about a file.
 *
 * So a token maps to the set of dialects that define it. A set smaller than all
 * of them is evidence; a set of one names a dialect; a set of several narrows
 * to those and says why it can go no further. Adding a dialect now changes how
 * far the evidence reaches instead of whether it exists.
 */
function narrowingTokens(): Map<number, BasicDialect[]> {
  /*
   * Bytes that mean something other than a plain token in some dialect, and so
   * cannot be read as one anywhere.
   *
   * This is not a refinement, it is the difference between evidence and a
   * mistake. &C6, &C7 and &C8 are ordinary keywords on a 6502 BASIC (AUTO,
   * DELETE, LOAD), and are the two-byte prefixes on an ARM one, where they
   * introduce the byte after them. &CF to &D3 are the 6502 pseudo-variables and
   * are BASIC V's statement forms. Counting a raw &C7 as proof of a 6502 BASIC
   * would convict every ARM file that lists anything, and the file would then
   * look like it carried tokens from two dialects at once.
   *
   * So a byte that is a prefix or a statement form anywhere is ambiguous by
   * construction and is not evidence.
   */
  const ambiguous = new Set<number>();
  for (const dialect of BASIC_DIALECTS) {
    for (const prefix of Object.keys(dialect.extended ?? {})) ambiguous.add(Number(prefix));
    for (const token of Object.keys(dialect.statementForms ?? {})) ambiguous.add(Number(token));
  }

  const owners = new Map<number, BasicDialect[]>();
  for (const dialect of BASIC_DIALECTS) {
    for (const token of Object.keys(dialect.tokens).map(Number)) {
      if (ambiguous.has(token)) continue;
      owners.set(token, [...(owners.get(token) ?? []), dialect]);
    }
  }
  const narrowing = new Map<number, BasicDialect[]>();
  for (const [token, dialects] of owners) {
    if (dialects.length < BASIC_DIALECTS.length) narrowing.set(token, dialects);
  }

  return narrowing;
}

/** How a set of owners reads in a sentence. */
function describeOwners(token: number, owners: BasicDialect[]): string {
  const byte = `&${token.toString(16).toUpperCase().padStart(2, '0')}`;
  const keyword = owners[0]!.tokens[token];
  const names = owners.map((owner) => owner.label);
  if (owners.length === 1) return `Token ${byte} is ${keyword}, which only ${names[0]} defines.`;
  const listed = `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  const shared = owners.every((owner) => owner.tokens === owners[0]!.tokens)
    ? ' They share one keyword table, so no token can tell them apart.'
    : '';
  return `Token ${byte} is ${keyword}, which only ${listed} define.${shared}`;
}

/**
 * Infer from tokenised bytes.
 *
 * A token no other dialect defines is real evidence. Everything else is not:
 * two dialects that share every token in a file are indistinguishable by it,
 * and this says so rather than preferring the commonest.
 */
export function inferTokenisedDialect(bytes: Uint8Array): DialectInference {
  const narrowing = narrowingTokens();
  const evidence: DialectEvidence[] = [];
  /* Each distinct set of owners the file narrowed to, in the order met. */
  const sets: BasicDialect[][] = [];
  const met = new Set<string>();
  for (const byte of bytes) {
    const owners = narrowing.get(byte);
    if (!owners) continue;
    const key = owners.map((owner) => owner.id).join(',');
    if (met.has(key)) continue;
    met.add(key);
    sets.push(owners);
    evidence.push({ dialect: owners[0]!.id, detail: describeOwners(byte, owners) });
  }
  const seen = new Set<BasicDialectId>(sets.flat().map((owner) => owner.id));
  if (sets.length === 1) {
    const owners = sets[0]!;
    /* Named only when the evidence leaves one dialect. Several is not an
     * ambiguity to resolve by preference; it is how far the ROMs allow anyone
     * to get. */
    return {
      dialect: owners.length === 1 ? owners[0]!.id : null,
      candidates: owners.map((owner) => owner.id),
      evidence,
      reason: evidence[0]!.detail,
    };
  }
  if (sets.length > 1) {
    /* Tokens from two dialects in one file is not a dialect, it is a file that
     * is not what it claims, or a reader that has lost its place. Either way
     * it is not something to resolve by picking the commonest. */
    return {
      dialect: null,
      candidates: [...seen],
      evidence,
      reason: `This carries tokens that belong to more than one BASIC, ${evidence.map((entry) => entry.detail).join(' ')} No single dialect explains it, so none is claimed.`,
    };
  }

  return {
    dialect: null,
    candidates: BASIC_DIALECTS.map((dialect) => dialect.id),
    evidence,
    reason: 'Every token in this file is defined by all of the tabled BASICs, so there is nothing in it that says which one wrote it. That is the usual case rather than an unlucky one: these ROMs share every token but one, so a file rarely identifies itself. Choose the dialect from the machine instead.',
  };
}

/*
 * Atom BASIC is not tokenised and does not share this evidence at all: its
 * programs are numbered text with lower-case line labels. That is a structural
 * difference rather than a token one, and it is the only positive evidence
 * this build has for the Atom.
 */
/* The same shape the Atom decoder recognises, a single lower-case letter
 * immediately after the line number and immediately before an upper-case
 * keyword, rather than a second rule that could disagree with it. */
const ATOM_LABEL = /^\s*\d{1,5}[a-z](?=[A-Z])/u;

/** Infer from source text. Structure is the only evidence text carries. */
export function inferTextDialect(text: string): DialectInference {
  const lines = text.split(/\r\n|\r|\n/).filter((line) => line.trim());
  const atomLabels = lines.filter((line) => ATOM_LABEL.test(line));
  if (atomLabels.length) {
    return {
      dialect: 'atom-basic',
      candidates: ['atom-basic'],
      evidence: [{ dialect: 'atom-basic', detail: `${atomLabels.length} line${atomLabels.length === 1 ? '' : 's'} begin with a lower-case label after the line number, which is Atom BASIC's form and not BBC BASIC's.` }],
      reason: `${atomLabels.length} line${atomLabels.length === 1 ? '' : 's'} carry an Atom line label, which no BBC BASIC accepts.`,
    };
  }

  return {
    dialect: null,
    candidates: [...BASIC_DIALECTS.map((dialect) => dialect.id), 'atom-basic'],
    evidence: [],
    reason: 'This is plain text with nothing in it that belongs to one BASIC rather than another. Text carries no tokens, so the dialect has to come from the machine it is for.',
  };
}
