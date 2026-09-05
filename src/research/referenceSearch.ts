/* Finding the right page for the machine somebody is actually working on.
 *
 * A search over imported documentation is not the same problem as a search over
 * a codebase, because the answers are not equally applicable. A page about the
 * Master's ACCCON latch is correct and useless to somebody building for a Model
 * B, and putting it first because the words matched would be the search telling
 * a small lie about relevance.
 *
 * So applicability is part of the ranking rather than a filter applied
 * afterwards, and it is a preference rather than a rule: a pack that does not
 * name a machine at all is not thereby wrong for yours, and a pack that names a
 * different one is shown *below* the rest rather than hidden. Hiding it would
 * be a second small lie, because sometimes the Master manual is the only place
 * a thing is written down.
 *
 * Two kinds of match are distinguished, and the distinction is reported rather
 * than folded into a score. An anchor match means the entry says it documents
 * this exact thing — this opcode, this address, this SWI. A text match means
 * the words appear. The first is an answer; the second is a lead.
 */
import { isAuthoritative, type ReferenceEntry, type ReferencePack, type SourceTier } from './referencePack';
import type { InstalledPack, PackLibrary } from './packLibrary';

export interface SearchTarget {
  machineId?: string;
  processor?: string;
  dialect?: string;
  /** Firmware or OS version, where the caller knows it. */
  version?: string;
}

export type MatchKind = 'anchor' | 'title' | 'text';

export interface SearchHit {
  packId: string;
  packTitle: string;
  publisher: string;
  entry: ReferenceEntry;
  tier: SourceTier;
  /** Whether this entry may be presented as authoritative. */
  authoritative: boolean;
  /** How it matched: an anchor is an answer, text is a lead. */
  matchKind: MatchKind;
  /** Whether the pack names the caller's machine, names a different one, or names none. */
  applicability: 'declared' | 'unrestricted' | 'other';
  /** Which anchor matched, when one did. */
  matchedAnchor?: string;
  score: number;
}

export interface SearchOptions {
  target?: SearchTarget;
  /** Restrict to entries that could be quoted, for a caller that intends to. */
  quotableOnly?: boolean;
  limit?: number;
}

const DEFAULT_LIMIT = 50;

/* Anchors are matched on the thing itself, so `&FE30`, `FE30` and `fe30` are
 * the same address and `LDA`/`lda` the same opcode. */
function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/^[&$]|^0x/, '').replace(/^#/, '');
}

function numberFrom(query: string): number | null {
  const cleaned = query.trim().replace(/^[&$]/, '').replace(/^0x/i, '');
  if (!/^[0-9a-f]+$/i.test(cleaned)) return null;
  /* A bare decimal-looking string is read as hexadecimal too, because Acorn
   * documentation addresses are hexadecimal and a person typing `FE30` and a
   * person typing `1234` both mean the address they read on the page. */
  const value = Number.parseInt(cleaned, 16);
  return Number.isFinite(value) ? value : null;
}

function applicabilityOf(pack: ReferencePack, target: SearchTarget | undefined): SearchHit['applicability'] {
  if (!target) return 'unrestricted';
  const declared: Array<[readonly string[], string | undefined]> = [
    [pack.applicability.machines, target.machineId],
    [pack.applicability.processors, target.processor],
    [pack.applicability.dialects, target.dialect],
    [pack.applicability.versions, target.version],
  ];
  let sawRestriction = false;
  for (const [list, wanted] of declared) {
    if (!list.length) continue;
    sawRestriction = true;
    if (wanted && list.includes(wanted)) return 'declared';
  }
  return sawRestriction ? 'other' : 'unrestricted';
}

/*
 * Ranking, written out rather than tuned, so it can be argued with.
 *
 * An anchor match outweighs everything because it is the entry saying it
 * documents this exact thing. Applicability to the caller's machine comes next,
 * then whether the entry may be read as authoritative — a publisher's page
 * above a forum post about the same call. Text matches sort under all of it.
 */
const SCORES = {
  anchor: 1000,
  title: 300,
  text: 100,
  declaredMachine: 60,
  unrestricted: 20,
  otherMachine: 0,
  authoritative: 30,
  /* Generated text sits below everything else that matched at all. */
  generated: -80,
} as const;

function scoreOf(hit: Omit<SearchHit, 'score'>): number {
  const base = hit.matchKind === 'anchor' ? SCORES.anchor : hit.matchKind === 'title' ? SCORES.title : SCORES.text;
  const applicability = hit.applicability === 'declared' ? SCORES.declaredMachine
    : hit.applicability === 'unrestricted' ? SCORES.unrestricted
    : SCORES.otherMachine;
  const standing = hit.tier === 'generated' ? SCORES.generated : hit.authoritative ? SCORES.authoritative : 0;
  return base + applicability + standing;
}

function matchEntry(entry: ReferenceEntry, needle: string, wantedNumber: number | null): { kind: MatchKind; anchor?: string } | null {
  for (const anchor of entry.anchors) {
    if (normalise(anchor.value) === needle) return { kind: 'anchor', anchor: anchor.value };
    if (wantedNumber !== null && anchor.number === wantedNumber) return { kind: 'anchor', anchor: anchor.value };
  }
  if (entry.title.toLowerCase().includes(needle)) return { kind: 'title' };
  if (entry.body.toLowerCase().includes(needle)) return { kind: 'text' };
  if (entry.topics.some((topic) => topic.toLowerCase().includes(needle))) return { kind: 'text' };
  return null;
}

/**
 * Search the library.
 *
 * An empty query returns nothing rather than everything: a reference panel that
 * lists every page it holds before being asked has answered a question nobody
 * put to it.
 */
export function searchReferences(library: PackLibrary, query: string, options: SearchOptions = {}): SearchHit[] {
  const needle = normalise(query);
  if (!needle) return [];
  const wantedNumber = numberFrom(query);
  const hits: SearchHit[] = [];

  for (const held of library.packs) {
    if (options.quotableOnly && !held.pack.licence.quotable) continue;
    const applicability = applicabilityOf(held.pack, options.target);
    for (const entry of held.pack.entries) {
      const match = matchEntry(entry, needle, wantedNumber);
      if (!match) continue;
      const partial: Omit<SearchHit, 'score'> = {
        packId: held.pack.id,
        packTitle: held.pack.title,
        publisher: held.pack.publisher,
        entry,
        tier: entry.tier,
        authoritative: isAuthoritative(entry.tier),
        matchKind: match.kind,
        applicability,
        ...(match.anchor ? { matchedAnchor: match.anchor } : {}),
      };
      hits.push({ ...partial, score: scoreOf(partial) });
    }
  }

  return hits
    .sort((left, right) => right.score - left.score
      || (left.packTitle < right.packTitle ? -1 : left.packTitle > right.packTitle ? 1 : 0)
      || (left.entry.title < right.entry.title ? -1 : 1))
    .slice(0, options.limit ?? DEFAULT_LIMIT);
}

/**
 * What the search could not look at, so a thin result is explained rather than
 * left to look like an absence of documentation.
 *
 * A person searching an empty library and a person searching a full one that
 * happens not to cover their machine see the same empty list, and they are in
 * very different situations.
 */
export function searchCoverage(library: PackLibrary, options: SearchOptions = {}): {
  packsSearched: number;
  entriesSearched: number;
  packsExcluded: Array<{ title: string; reason: string }>;
} {
  const excluded: Array<{ title: string; reason: string }> = [];
  let packsSearched = 0;
  let entriesSearched = 0;
  for (const held of library.packs) {
    if (options.quotableOnly && !held.pack.licence.quotable) {
      excluded.push({ title: held.pack.title, reason: `its licence (${held.pack.licence.name}) does not permit quoting` });
      continue;
    }
    packsSearched += 1;
    entriesSearched += held.pack.entries.length;
  }
  return { packsSearched, entriesSearched, packsExcluded: excluded };
}

/**
 * The references that bear on one thing the editor already knows about — an
 * opcode under the caret, an address in a disassembly, a SWI in a diagnostic.
 *
 * Separate from the free-text search because the question is different: this
 * asks what documents this exact thing, and returns nothing rather than
 * something loosely worded when nothing does.
 */
export function referencesFor(
  library: PackLibrary,
  anchor: { kind: ReferenceEntry['anchors'][number]['kind']; value: string; number?: number },
  options: SearchOptions = {},
): SearchHit[] {
  const needle = normalise(anchor.value);
  const hits: SearchHit[] = [];
  for (const held of library.packs) {
    const applicability = applicabilityOf(held.pack, options.target);
    for (const entry of held.pack.entries) {
      const matched = entry.anchors.find((candidate) => candidate.kind === anchor.kind
        && (normalise(candidate.value) === needle || (anchor.number !== undefined && candidate.number === anchor.number)));
      if (!matched) continue;
      const partial: Omit<SearchHit, 'score'> = {
        packId: held.pack.id, packTitle: held.pack.title, publisher: held.pack.publisher,
        entry, tier: entry.tier, authoritative: isAuthoritative(entry.tier),
        matchKind: 'anchor', applicability, matchedAnchor: matched.value,
      };
      hits.push({ ...partial, score: scoreOf(partial) });
    }
  }
  return hits.sort((left, right) => right.score - left.score).slice(0, options.limit ?? DEFAULT_LIMIT);
}

/** Every pack that could answer for a given target, for a panel that lists them. */
export function packsForTarget(library: PackLibrary, target: SearchTarget | undefined): Array<InstalledPack & { applicability: SearchHit['applicability'] }> {
  return library.packs.map((held) => ({ ...held, applicability: applicabilityOf(held.pack, target) }));
}
