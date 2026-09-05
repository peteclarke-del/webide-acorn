// @vitest-environment node

/* This is the one path that leaves a permanent mark on somebody's work and on
 * their licence position, so what these check hardest is what it refuses.
 */
import { describe, expect, it } from 'vitest';
import { applyInsertion, proposeInsertion, undoInsertion, type InsertionLanguage } from './referenceInsertion';
import type { SearchHit } from './referenceSearch';

const licence = (overrides: Record<string, unknown> = {}) => ({
  name: 'CC-BY-4.0', quotable: true, insertable: true, ...overrides,
});

const pack = (overrides: Record<string, unknown> = {}) => ({
  id: 'beeb-notes', title: 'Beeb Notes', packVersion: '3', publisher: 'A Publisher',
  licence: licence(), ...overrides,
} as Parameters<typeof proposeInsertion>[1]);

const hit = (entry: Record<string, unknown> = {}): SearchHit => ({
  packId: 'beeb-notes', packTitle: 'Beeb Notes', publisher: 'A Publisher',
  entry: {
    id: 'vsync', title: 'Waiting for vsync', body: 'LDA #19\nJSR &FFF4',
    tier: 'publisher', anchors: [], citations: [{ title: 'Beeb Notes', section: 'Timing', page: 12 }], topics: [],
    ...entry,
  } as SearchHit['entry'],
  tier: (entry.tier as SearchHit['tier']) ?? 'publisher',
  authoritative: (entry.tier ?? 'publisher') === 'publisher',
  matchKind: 'anchor', applicability: 'declared', score: 1,
});

describe('whether a passage may be inserted at all', () => {
  it('refuses text whose licence does not permit copying, and names the licence', () => {
    /* Most published manuals are readable and not copyable. Treating "we could
     * show it" as "we may copy it" is how a licence problem arrives unnoticed. */
    const proposal = proposeInsertion(hit(), pack({ licence: licence({ name: 'All rights reserved', insertable: false }) }), '6502');
    expect(proposal.permitted).toBe(false);
    if (proposal.permitted) throw new Error('unreachable');
    expect(proposal.refusal.reason).toBe('licence');
    expect(proposal.refusal.detail).toMatch(/All rights reserved/);
    expect(proposal.refusal.detail).toMatch(/It can be read and cited here; it cannot be inserted/);
  });

  it('points at the terms when the pack says where they are', () => {
    const proposal = proposeInsertion(hit(), pack({ licence: licence({ insertable: false, url: 'https://example.invalid/terms' }) }), '6502');
    if (proposal.permitted) throw new Error('unreachable');
    expect(proposal.refusal.detail).toMatch(/https:\/\/example\.invalid\/terms/);
  });

  it('refuses an entry with nothing to insert', () => {
    const proposal = proposeInsertion(hit({ body: '   ' }), pack(), '6502');
    expect(proposal.permitted).toBe(false);
  });
});

describe('what the file ends up saying about where the text came from', () => {
  const provenanceFor = (language: InsertionLanguage) => {
    const proposal = proposeInsertion(hit(), pack(), language);
    if (!proposal.permitted) throw new Error('expected a permitted proposal');
    return proposal.preview.provenance;
  };

  it('writes the provenance in the comment syntax of the language it is going into', () => {
    /* Taken from this product's own emitters: the ARM exporter writes `@` and
     * the 6502 one writes `;`. */
    expect(provenanceFor('6502').split('\n').every((line) => line.startsWith('; '))).toBe(true);
    expect(provenanceFor('arm').split('\n').every((line) => line.startsWith('@ '))).toBe(true);
    expect(provenanceFor('bbc-basic').split('\n').every((line) => line.startsWith('REM '))).toBe(true);
    const c = provenanceFor('c');
    expect(c.startsWith('/*')).toBe(true);
    expect(c.trimEnd().endsWith('*/')).toBe(true);
  });

  it('records the pack, the entry, the citation and the licence', () => {
    const provenance = provenanceFor('6502');
    expect(provenance).toMatch(/Beeb Notes \(A Publisher\), version 3/);
    expect(provenance).toMatch(/beeb-notes#vsync/);
    expect(provenance).toMatch(/Cited as: Beeb Notes, Timing, p\.12/);
    expect(provenance).toMatch(/Licence: CC-BY-4\.0/);
  });

  it('marks text that may be shown but not read as authoritative', () => {
    const proposal = proposeInsertion(hit({ tier: 'community', citations: [] }), pack(), '6502');
    if (!proposal.permitted) throw new Error('expected a permitted proposal');
    expect(proposal.preview.provenance).toMatch(/Source tier: community/);
    expect(proposal.preview.caveat).toMatch(/check anything you depend on/);
  });

  it('says nothing about tier when the source is a publisher, because there is nothing to warn about', () => {
    const proposal = proposeInsertion(hit(), pack(), '6502');
    if (!proposal.permitted) throw new Error('expected a permitted proposal');
    expect(proposal.preview.provenance).not.toMatch(/Source tier/);
    expect(proposal.preview.caveat).toBeNull();
  });
});

describe('whether it is the right dialect', () => {
  it('reports a match, a difference and an unstated dialect as three different things', () => {
    const verdict = (entryDialect: string | undefined, target: string | undefined) => {
      const proposal = proposeInsertion(hit({ exampleDialect: entryDialect }), pack(), '6502', target);
      if (!proposal.permitted) throw new Error('expected a permitted proposal');
      return proposal.preview.dialect;
    };
    expect(verdict('beebasm', 'beebasm').standing).toBe('match');
    expect(verdict('beebasm', 'ca65').standing).toBe('different');
    expect(verdict(undefined, 'beebasm').standing).toBe('unstated');
    expect(verdict('beebasm', undefined).standing).toBe('unstated');
  });

  it('offers a neighbouring dialect rather than refusing it, and says why', () => {
    /* Not a licence question, and often exactly what somebody wants to adapt. */
    const proposal = proposeInsertion(hit({ exampleDialect: 'beebasm' }), pack(), '6502', 'ca65');
    if (!proposal.permitted) throw new Error('expected a permitted proposal');
    expect(proposal.preview.dialect.detail).toMatch(/not because it will assemble as it stands/);
  });
});

describe('applying and undoing', () => {
  const preview = () => {
    const proposal = proposeInsertion(hit(), pack(), '6502');
    if (!proposal.permitted) throw new Error('expected a permitted proposal');
    return proposal.preview;
  };

  it('inserts on its own lines rather than into the middle of a statement', () => {
    const applied = applyInsertion('LDA #1', preview(), 3);
    expect(applied.content.startsWith('LDA\n; From Beeb Notes')).toBe(true);
    expect(applied.content.endsWith('\n #1')).toBe(true);
  });

  it('reports the range it inserted, and that range holds exactly the inserted text', () => {
    const applied = applyInsertion('start\nend\n', preview(), 6);
    expect(applied.content.slice(applied.range.start, applied.range.end)).toBe(preview().text);
  });

  it('puts the file back exactly as it was', () => {
    const before = 'ORG &1900\n.start\n RTS\n';
    const applied = applyInsertion(before, preview(), 11);
    expect(applied.content).not.toBe(before);
    expect(undoInsertion(applied)).toBe(before);
  });

  it('accepts an offset outside the file rather than producing something strange', () => {
    expect(applyInsertion('abc', preview(), 999).content.startsWith('abc\n')).toBe(true);
    expect(applyInsertion('abc', preview(), -5).content.endsWith('abc')).toBe(true);
  });
});
