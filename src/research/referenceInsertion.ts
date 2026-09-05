/* Putting a passage from somebody else's documentation into somebody's source.
 *
 * This is the one thing the research panel does that leaves a permanent mark on
 * a person's work and on their licence position, so it is the one thing that is
 * refused by default.
 *
 * Three questions are asked, and each is answered separately because they fail
 * for different reasons and a person can act on only one of them at a time:
 *
 *   - May this text be copied at all? That is the pack's licence, and a "no"
 *     here is final. Most published manuals are readable and not copyable, and
 *     treating "we could show it" as "we may copy it" is how a project acquires
 *     a licence problem nobody noticed.
 *   - Is it the right dialect? A 6502 example in a C file is not a licence
 *     question but it is still wrong, and this reports it rather than deciding:
 *     an example in a neighbouring dialect is often exactly what somebody wants
 *     to adapt.
 *   - What will the file end up saying about where this came from? Provenance
 *     is written into the source as a comment, in the comment syntax of the
 *     language it is going into, because a record that lives anywhere else is a
 *     record that gets separated from the code.
 *
 * Nothing here applies anything. It produces a preview and the exact text an
 * apply would insert; the caller applies it, and the caller's own history is
 * what undoes it.
 */
import type { SearchHit } from './referenceSearch';
import type { ReferencePack, SourceTier } from './referencePack';
import { isAuthoritative, tierCaveat } from './referencePack';

/** The languages this build can write a provenance comment in. */
export type InsertionLanguage = '6502' | 'arm' | 'c' | 'bbc-basic';

/*
 * Comment syntax per language, taken from what this product's own emitters
 * write rather than from memory: the ARM assembly exporter writes `@`, the
 * 6502 one writes `;`.
 */
const COMMENT: Record<InsertionLanguage, { line: string } | { open: string; close: string }> = {
  '6502': { line: ';' },
  arm: { line: '@' },
  c: { open: '/*', close: '*/' },
  'bbc-basic': { line: 'REM' },
};

export type InsertionRefusal =
  | { reason: 'licence'; detail: string }
  | { reason: 'empty'; detail: string };

export interface DialectVerdict {
  /** `match`, `different` or `unstated` — never guessed. */
  standing: 'match' | 'different' | 'unstated';
  detail: string;
}

export interface InsertionPreview {
  /** Exactly what an apply would put into the file, provenance included. */
  text: string;
  /** The passage on its own, for a preview that shows it separately. */
  body: string;
  /** The provenance comment on its own. */
  provenance: string;
  dialect: DialectVerdict;
  /** Present when the text may be shown but should not be read as authoritative. */
  caveat: string | null;
  tier: SourceTier;
}

export type InsertionProposal =
  | { permitted: true; preview: InsertionPreview }
  | { permitted: false; refusal: InsertionRefusal };

function comment(language: InsertionLanguage, lines: string[]): string {
  const syntax = COMMENT[language];
  if ('open' in syntax) {
    return [syntax.open, ...lines.map((line) => ` * ${line}`), ` ${syntax.close}`].join('\n');
  }
  return lines.map((line) => `${syntax.line} ${line}`).join('\n');
}

function dialectVerdict(entryDialect: string | undefined, target: string | undefined): DialectVerdict {
  if (!entryDialect) {
    return { standing: 'unstated', detail: 'This entry does not say which dialect its example is written in, so whether it will assemble here is not something this build can tell you.' };
  }
  if (!target) {
    return { standing: 'unstated', detail: `This example is written for ${entryDialect}, and no dialect was given for the file it is going into.` };
  }
  if (entryDialect === target) {
    return { standing: 'match', detail: `This example is written for ${entryDialect}, which is what this file is.` };
  }
  return {
    standing: 'different',
    detail: `This example is written for ${entryDialect} and this file is ${target}. It is offered because a neighbouring dialect is often what somebody wants to adapt, not because it will assemble as it stands.`,
  };
}

/**
 * Work out whether a passage may be inserted, and what it would look like.
 *
 * The licence is checked against the pack the entry came from rather than
 * against the entry, because permission is granted over a document.
 */
export function proposeInsertion(
  hit: SearchHit,
  pack: Pick<ReferencePack, 'id' | 'title' | 'packVersion' | 'publisher' | 'licence'>,
  language: InsertionLanguage,
  targetDialect?: string,
): InsertionProposal {
  if (!pack.licence.insertable) {
    return {
      permitted: false,
      refusal: {
        reason: 'licence',
        detail: `${pack.title} is licensed as ${pack.licence.name}, which does not permit its text being copied into your own source. It can be read and cited here; it cannot be inserted.${pack.licence.url ? ` The terms are at ${pack.licence.url}.` : ''}`,
      },
    };
  }

  const body = hit.entry.body.trim();
  if (!body) {
    return { permitted: false, refusal: { reason: 'empty', detail: 'This entry carries no text to insert.' } };
  }

  const citation = hit.entry.citations[0];
  const lines = [
    `From ${pack.title} (${pack.publisher}), version ${pack.packVersion}.`,
    `Entry "${hit.entry.title}" [${pack.id}#${hit.entry.id}].`,
    ...(citation ? [`Cited as: ${[citation.title, citation.section, citation.page ? `p.${citation.page}` : ''].filter(Boolean).join(', ')}.`] : []),
    `Licence: ${pack.licence.name}${pack.licence.holder ? `, ${pack.licence.holder}` : ''}.`,
    ...(isAuthoritative(hit.entry.tier) ? [] : [`Source tier: ${hit.entry.tier}. ${tierCaveat(hit.entry.tier) ?? ''}`.trim()]),
  ];
  const provenance = comment(language, lines);

  return {
    permitted: true,
    preview: {
      text: `${provenance}\n${body}\n`,
      body,
      provenance,
      dialect: dialectVerdict(hit.entry.exampleDialect, targetDialect),
      caveat: tierCaveat(hit.entry.tier),
      tier: hit.entry.tier,
    },
  };
}

export interface AppliedInsertion {
  /** The file's new content. */
  content: string;
  /** What was there before, so the caller can put it back. */
  previousContent: string;
  /** Where the inserted text begins and ends in the new content. */
  range: { start: number; end: number };
}

/**
 * Produce the file's new content, and everything needed to reverse it.
 *
 * Applying is deliberately a separate step from proposing: a preview that
 * inserted as a side effect of being looked at would be a preview nobody could
 * safely open.
 */
export function applyInsertion(content: string, preview: InsertionPreview, offset: number): AppliedInsertion {
  const at = Math.max(0, Math.min(offset, content.length));
  /* Placed on its own lines, so an insertion never lands in the middle of a
   * statement and quietly change what the line before it means. */
  const before = content.slice(0, at);
  const after = content.slice(at);
  const leading = before && !before.endsWith('\n') ? '\n' : '';
  const trailing = after && !after.startsWith('\n') ? '\n' : '';
  const inserted = `${leading}${preview.text}${trailing}`;
  return {
    content: `${before}${inserted}${after}`,
    previousContent: content,
    range: { start: at + leading.length, end: at + inserted.length - trailing.length },
  };
}

/** Put a file back exactly as it was before an insertion. */
export function undoInsertion(applied: AppliedInsertion): string {
  return applied.previousContent;
}
