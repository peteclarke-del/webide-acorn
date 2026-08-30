/* Checking that the reference panel is not quietly misleading anyone.
 *
 * A fixed set of questions with expected answers would only ever check the
 * documentation somebody thought to write questions about, and a library is
 * whatever a person imported. So this checks invariants against the library
 * that is actually there: properties that have to hold whatever is in it, and
 * that can only be checked once something is.
 *
 * The invariants are all versions of one idea. Two passages of text about the
 * same thing are not equally trustworthy, and the panel must never present them
 * as though they were — not by labelling, not by ordering, and not by omission.
 *
 * A run against an empty library reports that it examined nothing. That is the
 * distinction this file exists to keep: "checked and found nothing wrong" and
 * "had nothing to check" are different results, and reporting the second as the
 * first would make this whole file decorative.
 */
import { isAuthoritative, type ReferenceEntry, type SourceTier } from './referencePack';
import type { PackLibrary } from './packLibrary';
import { referencesFor, searchReferences, type SearchHit, type SearchTarget } from './referenceSearch';

export type AccuracyRule =
  | 'generated-never-authoritative'
  | 'generated-never-cites'
  | 'publisher-outranks-community'
  | 'target-relevance'
  | 'anchor-outranks-prose'
  | 'insertable-implies-quotable';

export interface AccuracyFinding {
  rule: AccuracyRule;
  detail: string;
  /** Where to look. */
  packId: string;
  entryId?: string;
}

export interface AccuracyReport {
  findings: AccuracyFinding[];
  /** What was examined, so a clean report can be told from an empty one. */
  examined: { packs: number; entries: number; anchors: number; comparisons: number };
  /** Rules that had nothing to examine, named rather than counted as passes. */
  unexercised: AccuracyRule[];
}

/** Every anchor in the library, with the entries that claim it. */
function anchorIndex(library: PackLibrary): Map<string, Array<{ packId: string; entry: ReferenceEntry }>> {
  const index = new Map<string, Array<{ packId: string; entry: ReferenceEntry }>>();
  for (const held of library.packs) {
    for (const entry of held.pack.entries) {
      for (const anchor of entry.anchors) {
        const key = `${anchor.kind}:${anchor.value.toLowerCase()}`;
        index.set(key, [...(index.get(key) ?? []), { packId: held.pack.id, entry }]);
      }
    }
  }
  return index;
}

const tierRank: Record<SourceTier, number> = { publisher: 3, independent: 2, community: 1, generated: 0 };

/**
 * Run the invariants against a library.
 *
 * `target` is the machine the person is working on, because two of the
 * invariants are about relevance and relevance has no meaning without one.
 */
export function evaluateAccuracy(library: PackLibrary, target?: SearchTarget): AccuracyReport {
  const findings: AccuracyFinding[] = [];
  const exercised = new Set<AccuracyRule>();
  let anchors = 0;
  let comparisons = 0;
  let entries = 0;

  for (const held of library.packs) {
    /* A pack that permits inserting what it does not permit quoting cannot be
     * described coherently, and the parser refuses it — this catches a library
     * assembled some other way. */
    exercised.add('insertable-implies-quotable');
    if (held.pack.licence.insertable && !held.pack.licence.quotable) {
      findings.push({
        rule: 'insertable-implies-quotable', packId: held.pack.id,
        detail: `${held.pack.title} permits its text being inserted into source but not quoted, which cannot both be true.`,
      });
    }

    for (const entry of held.pack.entries) {
      entries += 1;
      anchors += entry.anchors.length;

      exercised.add('generated-never-authoritative');
      if (entry.tier === 'generated' && isAuthoritative(entry.tier)) {
        findings.push({
          rule: 'generated-never-authoritative', packId: held.pack.id, entryId: entry.id,
          detail: `${entry.title} is machine-generated and is being treated as authoritative.`,
        });
      }

      if (entry.tier === 'generated') {
        exercised.add('generated-never-cites');
        if (entry.citations.length) {
          findings.push({
            rule: 'generated-never-cites', packId: held.pack.id, entryId: entry.id,
            detail: `${entry.title} is machine-generated and carries ${entry.citations.length} citation(s). A citation claims a document says this, and nothing generated can make that claim.`,
          });
        }
      }
    }
  }

  /* Ordering, checked by asking the search the same question a person would.
   * Where two entries claim the same anchor and one comes from a better-founded
   * source, the better-founded one has to come first. */
  for (const [key, claimants] of anchorIndex(library)) {
    if (claimants.length < 2) continue;
    const [kind, value] = key.split(':');
    const ranked = referencesFor(library, { kind: kind as ReferenceEntry['anchors'][number]['kind'], value: value! }, { target });
    if (ranked.length < 2) continue;
    exercised.add('publisher-outranks-community');
    comparisons += 1;
    for (let index = 1; index < ranked.length; index += 1) {
      const above = ranked[index - 1]!;
      const below = ranked[index]!;
      /* Only compared where applicability is equal, because relevance to the
       * machine in front of somebody legitimately outranks provenance. */
      if (above.applicability !== below.applicability) continue;
      if (tierRank[above.tier] < tierRank[below.tier]) {
        findings.push({
          rule: 'publisher-outranks-community', packId: above.packId, entryId: above.entry.id,
          detail: `For ${kind} ${value}, ${above.tier} material from ${above.packTitle} is ranked above ${below.tier} material from ${below.packTitle}.`,
        });
      }
    }
  }

  /* Relevance, checked the same way: where a pack names the target machine and
   * another names a different one, the first has to come first. */
  if (target?.machineId) {
    const sample = library.packs.flatMap((held) => held.pack.entries.slice(0, 1).map((entry) => ({ held, entry })));
    for (const { entry } of sample) {
      const hits = searchReferences(library, entry.title, { target });
      if (hits.length < 2) continue;
      exercised.add('target-relevance');
      comparisons += 1;
      const misordered = hits.findIndex((hit, index) => index > 0
        && hits[index - 1]!.applicability === 'other' && hit.applicability === 'declared'
        && hits[index - 1]!.matchKind === hit.matchKind);
      if (misordered > 0) {
        findings.push({
          rule: 'target-relevance', packId: hits[misordered - 1]!.packId,
          detail: `Searching "${entry.title}" for ${target.machineId} put ${hits[misordered - 1]!.packTitle}, which names a different machine, above ${hits[misordered]!.packTitle}, which names this one.`,
        });
      }
    }
  }

  /* An entry that says it documents a thing has to beat one that merely
   * mentions it. */
  for (const [key, claimants] of anchorIndex(library)) {
    const [kind, value] = key.split(':');
    const hits = searchReferences(library, value!, { target });
    if (hits.length < 2) continue;
    const anchored = hits.filter((hit) => hit.matchKind === 'anchor');
    const prose = hits.filter((hit) => hit.matchKind !== 'anchor');
    if (!anchored.length || !prose.length) continue;
    exercised.add('anchor-outranks-prose');
    comparisons += 1;
    const worstAnchored = hits.lastIndexOf(anchored[anchored.length - 1]!);
    const bestProse = hits.indexOf(prose[0]!);
    if (bestProse < worstAnchored) {
      findings.push({
        rule: 'anchor-outranks-prose', packId: prose[0]!.packId, entryId: prose[0]!.entry.id,
        detail: `Searching "${value}" put ${prose[0]!.entry.title}, which only mentions it, above an entry that says it documents ${kind} ${value}.`,
      });
    }
    void claimants;
  }

  const allRules: AccuracyRule[] = [
    'generated-never-authoritative', 'generated-never-cites', 'publisher-outranks-community',
    'target-relevance', 'anchor-outranks-prose', 'insertable-implies-quotable',
  ];

  return {
    findings,
    examined: { packs: library.packs.length, entries, anchors, comparisons },
    unexercised: allRules.filter((rule) => !exercised.has(rule)),
  };
}

/**
 * The report in words, for a settings panel.
 *
 * Says what was examined before it says what was found, because a clean result
 * over nothing is the failure mode this whole file guards against.
 */
export function describeAccuracy(report: AccuracyReport): string {
  if (!report.examined.packs) {
    return 'No reference packs are held, so nothing was checked. This is not a clean result; it is an empty one.';
  }
  const scope = `${report.examined.entries.toLocaleString()} entries across ${report.examined.packs} pack${report.examined.packs === 1 ? '' : 's'}, ${report.examined.anchors.toLocaleString()} anchors and ${report.examined.comparisons} ordering comparison${report.examined.comparisons === 1 ? '' : 's'}`;
  if (report.findings.length) {
    return `${report.findings.length} problem${report.findings.length === 1 ? '' : 's'} found in ${scope}: ${report.findings[0]!.detail}`;
  }
  const unexercised = report.unexercised.length
    ? ` ${report.unexercised.length} rule${report.unexercised.length === 1 ? '' : 's'} had nothing to examine: ${report.unexercised.join(', ')}.`
    : '';
  return `Checked ${scope}; nothing found.${unexercised}`;
}

/** The hits a panel may present as authoritative, and the rest, kept separate. */
export function partitionByStanding(hits: SearchHit[]): { authoritative: SearchHit[]; unverified: SearchHit[] } {
  return {
    authoritative: hits.filter((hit) => hit.authoritative),
    unverified: hits.filter((hit) => !hit.authoritative),
  };
}
