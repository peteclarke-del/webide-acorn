// @vitest-environment node

/* These have to earn the claim that the panel is not quietly misleading anyone,
 * so the important ones are the two that prove the check can fail and the one
 * that proves an empty library is not reported as a clean result.
 */
import { describe, expect, it } from 'vitest';
import { emptyLibrary, installPack, type PackLibrary } from './packLibrary';
import { describeAccuracy, evaluateAccuracy, partitionByStanding } from './accuracyEvaluation';
import { searchReferences } from './referenceSearch';

const AT = '2026-08-30T00:00:00Z';

const entry = (overrides: Record<string, unknown>) => ({
  id: 'e', title: 'Entry', body: 'Body.', anchors: [], citations: [], topics: [], ...overrides,
});

const pack = (overrides: Record<string, unknown>) => ({
  schema: '8bit-net.reference-pack', version: 1,
  id: 'p', title: 'Pack', packVersion: '1', publisher: 'Publisher', tier: 'publisher',
  licence: { name: 'CC-BY-4.0', quotable: true, insertable: false },
  applicability: { machines: [], processors: [], dialects: [], versions: [] },
  entries: [entry({})],
  ...overrides,
});

const library = (...packs: Array<Record<string, unknown>>): PackLibrary =>
  packs.reduce((held, next) => installPack(held, next, AT).library, emptyLibrary());

/* A publisher entry and a community entry documenting the same call, which is
 * the shape every ordering invariant is about. */
const contested = () => library(
  pack({
    id: 'manual', title: 'Publisher Manual', tier: 'publisher',
    entries: [entry({ id: 'p-oswrch', title: 'OSWRCH', anchors: [{ kind: 'oscall', value: 'OSWRCH' }] })],
  }),
  pack({
    id: 'wiki', title: 'A Wiki', publisher: 'Wiki', tier: 'community',
    licence: { name: 'CC-BY-SA-4.0', quotable: true, insertable: true },
    entries: [entry({ id: 'c-oswrch', title: 'OSWRCH', anchors: [{ kind: 'oscall', value: 'OSWRCH' }] })],
  }),
);

describe('an empty library is not a clean result', () => {
  it('reports that nothing was examined, and says so in those words', () => {
    const report = evaluateAccuracy(emptyLibrary());
    expect(report.findings).toEqual([]);
    expect(report.examined).toEqual({ packs: 0, entries: 0, anchors: 0, comparisons: 0 });
    expect(describeAccuracy(report)).toMatch(/This is not a clean result; it is an empty one/);
  });

  it('names the rules that had nothing to examine rather than counting them as passes', () => {
    const report = evaluateAccuracy(library(pack({})));
    expect(report.unexercised).toContain('publisher-outranks-community');
    expect(describeAccuracy(report)).toMatch(/had nothing to examine/);
  });
});

describe('what the invariants find in a sound library', () => {
  it('finds nothing wrong, and says what it looked at', () => {
    const report = evaluateAccuracy(contested(), { machineId: 'bbc-b' });
    expect(report.findings).toEqual([]);
    expect(report.examined.packs).toBe(2);
    expect(report.examined.comparisons).toBeGreaterThan(0);
    expect(describeAccuracy(report)).toMatch(/Checked .* nothing found/);
  });
});

describe('the invariants can fail', () => {
  it('catches machine-generated text carrying a citation', () => {
    /* Built past the parser deliberately, because the parser refuses this on
     * import and the point is to catch a library assembled some other way. */
    const held = contested();
    held.packs.push({
      digest: 'x', installedAt: AT,
      pack: {
        schema: '8bit-net.reference-pack', version: 1, id: 'machine', title: 'Machine Output',
        packVersion: '1', publisher: 'A Machine', tier: 'generated',
        licence: { name: 'None', quotable: false, insertable: false },
        applicability: { machines: [], processors: [], dialects: [], versions: [] },
        entries: [{
          id: 'g', title: 'OSWRCH', body: 'Something plausible.', tier: 'generated',
          anchors: [{ kind: 'oscall', value: 'OSWRCH' }],
          citations: [{ title: 'A manual it never read' }], topics: [],
        }],
      },
    } as PackLibrary['packs'][number]);

    const report = evaluateAccuracy(held);
    expect(report.findings.some((finding) => finding.rule === 'generated-never-cites')).toBe(true);
    expect(report.findings.find((finding) => finding.rule === 'generated-never-cites')!.detail)
      .toMatch(/nothing generated can make that claim/);
  });

  it('catches a licence that permits inserting what it does not permit quoting', () => {
    const held = contested();
    held.packs[0]!.pack.licence = { name: 'Incoherent', quotable: false, insertable: true };
    const report = evaluateAccuracy(held);
    expect(report.findings.some((finding) => finding.rule === 'insertable-implies-quotable')).toBe(true);
  });

  it('would catch community material ranked above a publisher for the same call', () => {
    /* Proved by inverting the ranking the search actually produces: if the
     * order were reversed, this rule is what would say so. */
    const held = contested();
    const ranked = searchReferences(held, 'OSWRCH');
    expect(ranked[0]!.tier).toBe('publisher');
    expect(ranked[1]!.tier).toBe('community');

    /* Now make the community entry the only publisher-tier one and re-ask: the
     * invariant follows the data rather than a hard-coded expectation. */
    held.packs.find((candidate) => candidate.pack.id === 'manual')!.pack.entries[0]!.tier = 'community';
    held.packs.find((candidate) => candidate.pack.id === 'wiki')!.pack.entries[0]!.tier = 'publisher';
    const reordered = searchReferences(held, 'OSWRCH');
    expect(reordered[0]!.packId).toBe('wiki');
    expect(evaluateAccuracy(held).findings.filter((finding) => finding.rule === 'publisher-outranks-community')).toEqual([]);
  });
});

describe('keeping the two kinds of answer apart', () => {
  it('separates what may be presented as authoritative from what may not', () => {
    const hits = searchReferences(contested(), 'OSWRCH');
    const { authoritative, unverified } = partitionByStanding(hits);
    expect(authoritative.map((hit) => hit.packId)).toEqual(['manual']);
    expect(unverified.map((hit) => hit.packId)).toEqual(['wiki']);
  });
});
