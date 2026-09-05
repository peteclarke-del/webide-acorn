// @vitest-environment node

/* The question these answer is not "does the search find things" but "does it
 * put the right thing first for the machine somebody is actually on", which is
 * where a documentation search earns or loses its keep.
 */
import { describe, expect, it } from 'vitest';
import { emptyLibrary, installPack, type PackLibrary } from './packLibrary';
import { packsForTarget, referencesFor, searchCoverage, searchReferences } from './referenceSearch';

const AT = '2026-08-30T00:00:00Z';

const entry = (overrides: Record<string, unknown>) => ({
  id: 'e', title: 'Entry', body: 'Body text.', anchors: [], citations: [], topics: [], ...overrides,
});

const pack = (overrides: Record<string, unknown>) => ({
  schema: '8bit-net.reference-pack', version: 1,
  id: 'p', title: 'Pack', packVersion: '1', publisher: 'Publisher', tier: 'publisher',
  licence: { name: 'All rights reserved', quotable: true, insertable: false },
  applicability: { machines: [], processors: [], dialects: [], versions: [] },
  entries: [entry({})],
  ...overrides,
});

function library(...packs: Array<Record<string, unknown>>): PackLibrary {
  return packs.reduce((held, next) => installPack(held, next, AT).library, emptyLibrary());
}

describe('what the search puts first', () => {
  it('puts an entry that says it documents the thing above one that merely mentions it', () => {
    /* An anchor match is an answer; a text match is a lead, and the difference
     * is reported rather than folded into a number. */
    const held = library(pack({
      entries: [
        entry({ id: 'mentions', title: 'Timing notes', body: 'You often see OSBYTE here.' }),
        entry({ id: 'documents', title: 'OSBYTE &13', body: 'Waits for vertical sync.', anchors: [{ kind: 'oscall', value: 'OSBYTE', number: 0x13 }] }),
      ],
    }));
    const hits = searchReferences(held, 'OSBYTE');
    expect(hits.map((hit) => hit.entry.id)).toEqual(['documents', 'mentions']);
    expect(hits[0]!.matchKind).toBe('anchor');
    expect(hits[0]!.matchedAnchor).toBe('OSBYTE');
    expect(hits[1]!.matchKind).toBe('text');
  });

  it('prefers a pack that names the machine being worked on', () => {
    const held = library(
      pack({ id: 'master', title: 'Master Reference', applicability: { machines: ['master'], processors: [], dialects: [], versions: [] }, entries: [entry({ id: 'm', title: 'ACCCON latch' })] }),
      pack({ id: 'modelb', title: 'Model B Guide', applicability: { machines: ['bbc-b'], processors: [], dialects: [], versions: [] }, entries: [entry({ id: 'b', title: 'ACCCON latch' })] }),
    );
    const hits = searchReferences(held, 'ACCCON', { target: { machineId: 'bbc-b' } });
    expect(hits[0]!.entry.id).toBe('b');
    expect(hits[0]!.applicability).toBe('declared');
    expect(hits[1]!.applicability).toBe('other');
  });

  it('shows a pack for another machine below the rest rather than hiding it', () => {
    /* Sometimes the Master manual is the only place a thing is written down,
     * and hiding it would be a worse lie than ranking it low. */
    const held = library(pack({
      id: 'master', applicability: { machines: ['master'], processors: [], dialects: [], versions: [] },
      entries: [entry({ id: 'only-place', title: 'Shadow memory' })],
    }));
    const hits = searchReferences(held, 'shadow', { target: { machineId: 'bbc-b' } });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.applicability).toBe('other');
  });

  it('treats a pack that names no machine as not thereby wrong for yours', () => {
    const held = library(pack({ entries: [entry({ id: 'general', title: '6502 addressing modes' })] }));
    expect(searchReferences(held, 'addressing', { target: { machineId: 'bbc-b' } })[0]!.applicability).toBe('unrestricted');
  });

  it('puts a publisher above a forum post about the same call, and generated text below both', () => {
    const held = library(
      pack({ id: 'forum', tier: 'community', licence: { name: 'CC-BY-4.0', quotable: true, insertable: true }, entries: [entry({ id: 'c', title: 'OSWRCH', anchors: [{ kind: 'oscall', value: 'OSWRCH' }] })] }),
      pack({ id: 'manual', tier: 'publisher', entries: [entry({ id: 'p', title: 'OSWRCH', anchors: [{ kind: 'oscall', value: 'OSWRCH' }] })] }),
      pack({ id: 'machine', tier: 'generated', licence: { name: 'None', quotable: false, insertable: false }, entries: [entry({ id: 'g', title: 'OSWRCH', anchors: [{ kind: 'oscall', value: 'OSWRCH' }], citations: [] })] }),
    );
    const hits = searchReferences(held, 'OSWRCH');
    expect(hits.map((hit) => hit.entry.id)).toEqual(['p', 'c', 'g']);
    expect(hits.map((hit) => hit.authoritative)).toEqual([true, false, false]);
  });
});

describe('how a query is read', () => {
  it('matches an address however it was written', () => {
    const held = library(pack({ entries: [entry({ id: 'romsel', title: 'ROMSEL', anchors: [{ kind: 'address', value: 'ROMSEL', number: 0xfe30 }] })] }));
    for (const query of ['&FE30', 'FE30', 'fe30', '0xFE30', '$FE30']) {
      expect(searchReferences(held, query).map((hit) => hit.entry.id)).toEqual(['romsel']);
    }
  });

  it('matches an opcode whatever its case', () => {
    const held = library(pack({ entries: [entry({ id: 'lda', title: 'LDA', anchors: [{ kind: 'opcode', value: 'LDA' }] })] }));
    expect(searchReferences(held, 'lda')[0]!.matchKind).toBe('anchor');
  });

  it('answers an empty query with nothing rather than with everything', () => {
    /* A panel that lists every page it holds before being asked has answered a
     * question nobody put to it. */
    const held = library(pack({}));
    expect(searchReferences(held, '')).toEqual([]);
    expect(searchReferences(held, '   ')).toEqual([]);
  });
});

describe('what the search could not look at', () => {
  it('distinguishes an empty library from one that simply does not cover this', () => {
    /* Both show an empty list and they are very different situations. */
    expect(searchCoverage(emptyLibrary())).toMatchObject({ packsSearched: 0, entriesSearched: 0 });
    const held = library(pack({ entries: [entry({}), entry({ id: 'e2' })] }));
    expect(searchCoverage(held)).toMatchObject({ packsSearched: 1, entriesSearched: 2, packsExcluded: [] });
  });

  it('names a pack left out for its licence, with the reason', () => {
    const held = library(pack({ id: 'locked', title: 'Locked Manual', licence: { name: 'Proprietary', quotable: false, insertable: false } }));
    const coverage = searchCoverage(held, { quotableOnly: true });
    expect(coverage.packsSearched).toBe(0);
    expect(coverage.packsExcluded[0]).toMatchObject({ title: 'Locked Manual' });
    expect(coverage.packsExcluded[0]!.reason).toMatch(/does not permit quoting/);
    expect(searchReferences(held, 'Entry', { quotableOnly: true })).toEqual([]);
  });
});

describe('references for one exact thing', () => {
  it('answers what documents this anchor, and nothing loosely worded', () => {
    const held = library(pack({
      entries: [
        entry({ id: 'exact', title: 'LDA', anchors: [{ kind: 'opcode', value: 'LDA' }] }),
        entry({ id: 'prose', title: 'Loading the accumulator', body: 'Use LDA for this.' }),
      ],
    }));
    const hits = referencesFor(held, { kind: 'opcode', value: 'LDA' });
    expect(hits.map((hit) => hit.entry.id)).toEqual(['exact']);
  });

  it('does not answer for an anchor of a different kind that happens to share a name', () => {
    const held = library(pack({ entries: [entry({ id: 'sym', anchors: [{ kind: 'symbol', value: 'OSWRCH' }] })] }));
    expect(referencesFor(held, { kind: 'oscall', value: 'OSWRCH' })).toEqual([]);
    expect(referencesFor(held, { kind: 'symbol', value: 'OSWRCH' })).toHaveLength(1);
  });

  it('finds a numbered call by its number as well as its name', () => {
    const held = library(pack({ entries: [entry({ id: 'swi', anchors: [{ kind: 'swi', value: 'OS_WriteC', number: 0 }] })] }));
    expect(referencesFor(held, { kind: 'swi', value: 'something-else', number: 0 })).toHaveLength(1);
  });
});

describe('which packs bear on a target', () => {
  it('labels each held pack by whether it names this machine', () => {
    const held = library(
      pack({ id: 'a', applicability: { machines: ['bbc-b'], processors: [], dialects: [], versions: [] } }),
      pack({ id: 'b', applicability: { machines: ['master'], processors: [], dialects: [], versions: [] } }),
      pack({ id: 'c' }),
    );
    const labelled = packsForTarget(held, { machineId: 'bbc-b' });
    expect(labelled.map((item) => [item.pack.id, item.applicability])).toEqual([
      ['a', 'declared'], ['b', 'other'], ['c', 'unrestricted'],
    ]);
  });
});
