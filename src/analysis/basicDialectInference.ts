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

/** Tokens defined by exactly one of the tabled dialects, and by which. */
function distinguishingTokens(): Map<number, BasicDialect> {
  const owners = new Map<number, BasicDialect[]>();
  for (const dialect of BASIC_DIALECTS) {
    for (const token of Object.keys(dialect.tokens).map(Number)) {
      owners.set(token, [...(owners.get(token) ?? []), dialect]);
    }
  }
  const unique = new Map<number, BasicDialect>();
  for (const [token, dialects] of owners) if (dialects.length === 1) unique.set(token, dialects[0]!);

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
  for (const byte of bytes) {
    const owner = unique.get(byte);
    if (!owner || seen.has(owner.id)) continue;
    seen.add(owner.id);
    evidence.push({
      dialect: owner.id,
      detail: `Token &${byte.toString(16).toUpperCase().padStart(2, '0')} is ${owner.tokens[byte]}, which only ${owner.label} defines.`,
    });
  }
  if (evidence.length === 1) {
    const only = evidence[0]!;
    return { dialect: only.dialect, candidates: [only.dialect], evidence, reason: only.detail };
  }
  if (evidence.length > 1) {
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
