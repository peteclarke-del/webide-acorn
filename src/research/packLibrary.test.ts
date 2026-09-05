// @vitest-environment node

/* Importing the same thing twice is the case worth getting right, because it is
 * the one that happens by accident. These separate the three ways it can look
 * the same from outside and mean different things.
 */
import { describe, expect, it } from 'vitest';
import { ReferencePackError } from './referencePack';
import {
  LIBRARY_LIMITS,
  emptyLibrary,
  installPack,
  libraryStanding,
  parsePackLibrary,
  removePack,
} from './packLibrary';

const AT = '2026-08-30T00:00:00Z';
const LATER = '2026-08-30T01:00:00Z';

const pack = (overrides: Record<string, unknown> = {}) => ({
  schema: '8bit-net.reference-pack',
  version: 1,
  id: 'user-guide',
  title: 'BBC Microcomputer User Guide',
  packVersion: '1981-1',
  publisher: 'Acorn Computers',
  tier: 'publisher',
  licence: { name: 'All rights reserved', quotable: true, insertable: false },
  applicability: { machines: ['bbc-b'], processors: ['6502'], dialects: [], versions: [] },
  entries: [{ id: 'osbyte-19', title: 'OSBYTE &13', body: 'Waits for vertical sync.', anchors: [], citations: [], topics: [] }],
  ...overrides,
});

describe('taking a pack into the library', () => {
  it('imports one and says what arrived', () => {
    const { library, action, summary } = installPack(emptyLibrary(), pack(), AT);
    expect(action).toBe('installed');
    expect(library.packs).toHaveLength(1);
    expect(library.packs[0]!.installedAt).toBe(AT);
    expect(summary).toMatch(/1 entries from Acorn Computers|imported/);
    expect(library.audit[0]).toMatchObject({ action: 'installed', packId: 'user-guide', at: AT });
  });

  it('changes nothing when the very same pack is imported again', () => {
    /* Reasonable to do by accident, so the answer is that nothing changed —
     * not an error, and not a silent no-op that leaves the person guessing. */
    const first = installPack(emptyLibrary(), pack(), AT);
    const second = installPack(first.library, pack(), LATER);
    expect(second.action).toBe('unchanged');
    expect(second.library).toBe(first.library);
    expect(second.summary).toMatch(/already held at this exact content/);
    expect(second.library.audit).toHaveLength(1);
  });

  it('treats altered text as an update and says what it replaced', () => {
    const first = installPack(emptyLibrary(), pack(), AT);
    const revised = pack({ entries: [{ id: 'osbyte-19', title: 'OSBYTE &13', body: 'Waits for vertical sync. See also OSBYTE &00.', anchors: [], citations: [], topics: [] }] });
    const second = installPack(first.library, revised, LATER);
    expect(second.action).toBe('updated');
    expect(second.digest).not.toBe(first.digest);
    expect(second.library.packs).toHaveLength(1);
    expect(second.library.packs[0]!.installedAt).toBe(AT);
    expect(second.library.packs[0]!.updatedAt).toBe(LATER);
    expect(second.library.audit[0]).toMatchObject({ action: 'updated', replacedDigest: first.digest, replacedVersion: '1981-1' });
  });

  it('says plainly when a reissue carries the same version number as the text it replaced', () => {
    /* The case a version number alone would hide. */
    const first = installPack(emptyLibrary(), pack(), AT);
    const corrected = pack({ entries: [{ id: 'osbyte-19', title: 'OSBYTE &13', body: 'Corrected text.', anchors: [], citations: [], topics: [] }] });
    const second = installPack(first.library, corrected, LATER);
    expect(second.summary).toMatch(/same version number and different content/);
  });

  it('refuses a different publisher claiming an identifier already in use', () => {
    /* Two publishers can both reasonably ship `user-guide`; letting one
     * overwrite the other would lose a document nobody agreed to lose. */
    const first = installPack(emptyLibrary(), pack(), AT);
    expect(() => installPack(first.library, pack({ publisher: 'Someone Else' }), LATER))
      .toThrow(/lose a document nobody agreed to lose/);
  });

  it('refuses to exceed what it will hold, rather than dropping something quietly', () => {
    let library = emptyLibrary();
    for (let index = 0; index < LIBRARY_LIMITS.packs; index += 1) {
      library = installPack(library, pack({ id: `pack-${index}` }), AT).library;
    }
    expect(library.packs).toHaveLength(LIBRARY_LIMITS.packs);
    expect(() => installPack(library, pack({ id: 'one-too-many' }), AT)).toThrow(/which is the limit/);
  });
});

describe('taking a pack out again', () => {
  it('removes it and records what was removed', () => {
    const { library } = installPack(emptyLibrary(), pack(), AT);
    const removed = removePack(library, 'user-guide', LATER);
    expect(removed.library.packs).toEqual([]);
    expect(removed.summary).toMatch(/was removed, along with its 1 entries/);
    expect(removed.library.audit[0]).toMatchObject({ action: 'removed', packId: 'user-guide', at: LATER });
  });

  it('refuses to remove something it does not hold', () => {
    expect(() => removePack(emptyLibrary(), 'absent', AT)).toThrow(ReferencePackError);
  });
});

describe('what the library holds', () => {
  it('reports the mix of tiers, not only the totals', () => {
    /* A library that is nine tenths community material answers very
     * differently from one that is not, and the counts alone do not say so. */
    let library = installPack(emptyLibrary(), pack(), AT).library;
    library = installPack(library, pack({
      id: 'wiki-notes', publisher: 'A Wiki', tier: 'community',
      licence: { name: 'CC-BY-SA-4.0', quotable: true, insertable: true },
      entries: [
        { id: 'note-1', title: 'Note', body: 'Something.', anchors: [], citations: [], topics: [] },
        { id: 'note-2', title: 'Note', body: 'Something else.', anchors: [], citations: [], topics: [] },
      ],
    }), AT).library;

    const standing = libraryStanding(library);
    expect(standing).toMatchObject({ packs: 2, entries: 3, insertable: 1 });
    expect(standing.byTier).toEqual([{ tier: 'community', entries: 2 }, { tier: 'publisher', entries: 1 }]);
  });
});

describe('reading a library back from storage', () => {
  it('re-parses and re-digests rather than trusting what was stored', () => {
    const { library } = installPack(emptyLibrary(), pack(), AT);
    const restored = parsePackLibrary(JSON.parse(JSON.stringify(library)));
    expect(restored.dropped).toEqual([]);
    expect(restored.library.packs[0]!.digest).toBe(library.packs[0]!.digest);
  });

  it('drops a stored pack whose digest does not match its content, and says so', () => {
    /* Storage is not a trusted channel: a person can edit it, and a partial
     * write can leave half a record. */
    const { library } = installPack(emptyLibrary(), pack(), AT);
    const tampered = JSON.parse(JSON.stringify(library));
    tampered.packs[0].pack.entries[0].body = 'Something nobody published.';
    const restored = parsePackLibrary(tampered);
    expect(restored.library.packs).toEqual([]);
    expect(restored.dropped[0]).toMatch(/digest that does not match its content/);
  });

  it('drops a stored pack that no longer parses, with its reason', () => {
    const restored = parsePackLibrary({ packs: [{ pack: { schema: 'wrong' }, digest: 'x' }], audit: [] });
    expect(restored.library.packs).toEqual([]);
    expect(restored.dropped[0]).toMatch(/was not loaded: /);
  });

  it('reads nothing out of nothing rather than throwing', () => {
    expect(parsePackLibrary(null).library).toEqual(emptyLibrary());
    expect(parsePackLibrary('not a library').library).toEqual(emptyLibrary());
  });
});
