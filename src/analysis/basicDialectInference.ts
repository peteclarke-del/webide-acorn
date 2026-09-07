/*
 * Working out which BASIC a file is, and refusing when the file does not say.
 *
 * The requirement asks for this to refuse ambiguous dialects safely, and that
 * is the whole difficulty: most short BASIC programs are valid in every dialect
 * and there is nothing in them to tell one from another. Choosing anyway would
 * decode somebody's program under the wrong table and produce plausible,
 * subtly-wrong text — which is worse than saying "this could be any of these".
 *
 * So evidence has to be positive and specific: a token only one dialect
 * defines, or a line structure only one dialect uses. Frequency is not
 * evidence, and neither is a keyword every dialect shares.
 *
 * How little evidence there usually is came out of the tables themselves: of
 * the four 6502-family BASICs read here, exactly one token belongs to a single
 * dialect — &CE, EDIT, which only BASIC IV has. Every other token is shared.
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
 * Tokens defined by exactly one keyword table, and by the dialects that share it.
 *
 * Grouped by *table* rather than by dialect, which matters as soon as two
 * dialects share one. BASIC V and BASIC VI do: they were measured to carry the
 * same table in every RISC OS 6 ROM, differing only in how a real number is
 * stored, which no token records. Counting owners by dialect made every token
 * they share non-unique, and the inference went from naming BASIC V to naming
 * nothing at all — losing the true and useful fact that the file is an ARM
 * BASIC and none of the four 6502 ones.
 *
 * So a token unique to a table is still evidence. What it cannot do is choose
 * between the dialects that share that table, and the answer says so rather
 * than picking one.
 */
function distinguishingTokens(): Map<number, BasicDialect[]> {
  const owners = new Map<number, BasicDialect[]>();
  for (const dialect of BASIC_DIALECTS) {
    for (const token of Object.keys(dialect.tokens).map(Number)) {
      owners.set(token, [...(owners.get(token) ?? []), dialect]);
    }
  }
  const unique = new Map<number, BasicDialect[]>();
  for (const [token, dialects] of owners) {
    /* One table, however many names it goes by: every dialect here has to be
     * carrying the identical table object for the token to still count. */
    const [first] = dialects;
    if (first && dialects.every((candidate) => candidate.tokens === first.tokens)) unique.set(token, dialects);
  }

  return unique;
}

/**
 * Infer from tokenised bytes.
 *
 * A token no other dialect defines is real evidence. Everything else is not:
 * two dialects that share every token in a file are indistinguishable by it,
 * and this says so rather than preferring the commonest.
 */
export function inferTokenisedDialect(bytes: Uint8Array): DialectInference {
  const unique = distinguishingTokens();
  const evidence: DialectEvidence[] = [];
  const seen = new Set<BasicDialectId>();
  /* Each table that showed a token of its own, in the order they were met. */
  const tables: BasicDialect[][] = [];
  for (const byte of bytes) {
    const owners = unique.get(byte);
    if (!owners) continue;
    const first = owners[0]!;
    if (seen.has(first.id)) continue;
    for (const owner of owners) seen.add(owner.id);
    tables.push(owners);
    const names = owners.map((owner) => owner.label);
    evidence.push({
      dialect: first.id,
      detail: owners.length === 1
        ? `Token &${byte.toString(16).toUpperCase().padStart(2, '0')} is ${first.tokens[byte]}, which only ${first.label} defines.`
        : `Token &${byte.toString(16).toUpperCase().padStart(2, '0')} is ${first.tokens[byte]}, which only ${names.join(' and ')} define. They share one keyword table, so no token can tell them apart.`,
    });
  }
  if (tables.length === 1) {
    const owners = tables[0]!;
    const only = evidence[0]!;
    /* Named only when one dialect owns the table. Two dialects sharing it is
     * not an ambiguity to resolve; it is a fact about the ROMs. */
    return {
      dialect: owners.length === 1 ? owners[0]!.id : null,
      candidates: owners.map((owner) => owner.id),
      evidence,
      reason: only.detail,
    };
  }
  if (tables.length > 1) {
    /* Tokens from two dialects in one file is not a dialect, it is a file that
     * is not what it claims — or a reader that has lost its place. Either way
     * it is not something to resolve by picking the commonest. */
    return {
      dialect: null,
      candidates: [...seen],
      evidence,
      reason: `This carries tokens that belong to more than one BASIC — ${evidence.map((entry) => entry.detail).join(' ')} No single dialect explains it, so none is claimed.`,
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
/* The same shape the Atom decoder recognises — a single lower-case letter
 * immediately after the line number and immediately before an upper-case
 * keyword — rather than a second rule that could disagree with it. */
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
