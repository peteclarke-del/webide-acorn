// @vitest-environment node

/* The point of these is that asking by kind is not the same as asking by word.
 * A project symbol called OSWRCH and the OS call OSWRCH are different questions
 * with different right answers, and the failure being guarded against is a
 * lookup that answers the wrong one confidently.
 */
import { describe, expect, it } from 'vitest';
import { emptyLibrary, installPack, type PackLibrary } from './packLibrary';
import { hasReferencesFor, resolveReferenceLink } from './referenceLinks';

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

const both = () => library(pack({
  entries: [
    entry({ id: 'call', title: 'The OSWRCH call', anchors: [{ kind: 'oscall', value: 'OSWRCH', number: 0xffee }] }),
    entry({ id: 'symbol', title: 'A routine somebody named OSWRCH', anchors: [{ kind: 'symbol', value: 'OSWRCH' }] }),
  ],
}));

describe('asking by kind rather than by word', () => {
  it('answers the OS call for an OS call and the symbol for a symbol', () => {
    expect(resolveReferenceLink(both(), { from: 'os-call', token: 'OSWRCH' }).hits.map((hit) => hit.entry.id)).toEqual(['call']);
    expect(resolveReferenceLink(both(), { from: 'project-symbol', token: 'OSWRCH' }).hits.map((hit) => hit.entry.id)).toEqual(['symbol']);
  });

  it('asks for both an opcode and a symbol when hovering assembly, because it could be either', () => {
    const held = library(pack({ entries: [entry({ id: 'op', title: 'LDA', anchors: [{ kind: 'opcode', value: 'LDA' }] })] }));
    const resolved = resolveReferenceLink(held, { from: 'hover', token: 'LDA', language: '6502' });
    expect(resolved.anchors.map((anchor) => anchor.kind)).toEqual(['opcode', 'symbol']);
    expect(resolved.hits).toHaveLength(1);
  });

  it('asks about a topic rather than an opcode when hovering BASIC', () => {
    const resolved = resolveReferenceLink(emptyLibrary(), { from: 'hover', token: 'PRINT', language: 'bbc-basic' });
    expect(resolved.anchors.map((anchor) => anchor.kind)).toEqual(['topic', 'symbol']);
  });

  it('asks about a disassembly row by its mnemonic and by the address it reaches', () => {
    const held = library(pack({
      entries: [
        entry({ id: 'jsr', title: 'JSR', anchors: [{ kind: 'opcode', value: 'JSR' }] }),
        entry({ id: 'target', title: 'The OSWRCH entry', anchors: [{ kind: 'address', value: '&FFEE', number: 0xffee }] }),
      ],
    }));
    const resolved = resolveReferenceLink(held, { from: 'disassembly', mnemonic: 'JSR', processor: '6502', target: 0xffee });
    expect(resolved.hits.map((hit) => hit.entry.id).sort()).toEqual(['jsr', 'target']);
    expect(resolved.question).toMatch(/JSR or &FFEE/);
  });

  it('asks about a hardware register by its name and by its address', () => {
    const held = library(pack({ entries: [entry({ id: 'romsel', title: 'ROMSEL', anchors: [{ kind: 'address', value: '&FE30', number: 0xfe30 }] })] }));
    const resolved = resolveReferenceLink(held, { from: 'hardware-register', token: 'ROMSEL', address: 0xfe30 });
    expect(resolved.hits.map((hit) => hit.entry.id)).toEqual(['romsel']);
  });

  it('does not answer an entry twice when two anchors both reach it', () => {
    const held = library(pack({ entries: [entry({ id: 'one', anchors: [{ kind: 'opcode', value: 'LDA' }, { kind: 'symbol', value: 'LDA' }] })] }));
    expect(resolveReferenceLink(held, { from: 'hover', token: 'LDA', language: '6502' }).hits).toHaveLength(1);
  });
});

describe('what it refuses to guess at', () => {
  it('searches a diagnostic by its code and never by its message', () => {
    /* A message is prose that changes between toolchain versions; searching it
     * would find whatever happened to share a word with it. */
    const withoutCode = resolveReferenceLink(emptyLibrary(), { from: 'diagnostic', message: 'branch out of range' });
    expect(withoutCode.anchors).toEqual([]);
    expect(withoutCode.absence).toMatch(/whatever happened to share a word with it/);

    const withCode = resolveReferenceLink(emptyLibrary(), { from: 'diagnostic', code: 'E1234', message: 'branch out of range' });
    expect(withCode.anchors).toEqual([{ kind: 'topic', value: 'E1234' }]);
  });

  it('finds nothing rather than something loosely worded', () => {
    /* A panel that always finds something teaches people that finding
     * something means nothing. */
    const held = library(pack({ entries: [entry({ id: 'prose', title: 'Notes', body: 'This mentions OSWRCH in passing.' })] }));
    const resolved = resolveReferenceLink(held, { from: 'os-call', token: 'OSWRCH' });
    expect(resolved.hits).toEqual([]);
    expect(resolved.absence).toMatch(/says it documents this/);
  });

  it('distinguishes having no packs from having packs that do not cover this', () => {
    expect(resolveReferenceLink(emptyLibrary(), { from: 'os-call', token: 'OSWRCH' }).absence)
      .toMatch(/No reference packs are held/);
    expect(resolveReferenceLink(library(pack({})), { from: 'os-call', token: 'OSWRCH' }).absence)
      .toMatch(/Nothing in the 1 pack held/);
  });

  it('says the workbench\'s own knowledge is unaffected either way', () => {
    for (const held of [emptyLibrary(), library(pack({}))]) {
      expect(resolveReferenceLink(held, { from: 'os-call', token: 'OSWRCH' }).absence).toMatch(/maintained knowledge/);
    }
  });
});

describe('deciding whether to offer the lookup at all', () => {
  it('reports whether anything would be found', () => {
    expect(hasReferencesFor(both(), { from: 'os-call', token: 'OSWRCH' })).toBe(true);
    expect(hasReferencesFor(both(), { from: 'swi', token: 'OSWRCH' })).toBe(false);
    expect(hasReferencesFor(emptyLibrary(), { from: 'os-call', token: 'OSWRCH' })).toBe(false);
  });
});
