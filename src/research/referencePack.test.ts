// @vitest-environment node

/* What a pack has to say about itself before this build will hold it. The
 * refusals are the substance here: a pack that arrives incomplete and is
 * repaired on the way in becomes a pack the product then describes wrongly.
 */
import { describe, expect, it } from 'vitest';
import {
  PACK_LIMITS,
  ReferencePackError,
  isAuthoritative,
  parseReferencePack,
  referencePackDigest,
  tierCaveat,
} from './referencePack';

const pack = (overrides: Record<string, unknown> = {}, entryOverrides: Record<string, unknown> = {}) => ({
  schema: '8bit-net.reference-pack',
  version: 1,
  id: 'acorn-user-guide',
  title: 'BBC Microcomputer User Guide',
  packVersion: '1981-1',
  publisher: 'Acorn Computers',
  tier: 'publisher',
  licence: { name: 'All rights reserved', quotable: true, insertable: false, holder: 'Acorn Computers' },
  applicability: { machines: ['bbc-b'], processors: ['6502'], dialects: ['bbc-basic'], versions: ['os1.20'] },
  entries: [{
    id: 'osbyte-19',
    title: 'OSBYTE &13 — wait for vertical sync',
    body: 'Waits for the next vertical synchronisation pulse.',
    anchors: [{ kind: 'oscall', value: 'OSBYTE', number: 0x13 }],
    citations: [{ title: 'BBC Microcomputer User Guide', section: 'OSBYTE calls', page: 452 }],
    topics: ['timing'],
    ...entryOverrides,
  }],
  ...overrides,
});

describe('reading a reference pack', () => {
  it('reads a complete pack, keeping what it was told rather than normalising it away', () => {
    const parsed = parseReferencePack(pack());
    expect(parsed.id).toBe('acorn-user-guide');
    expect(parsed.tier).toBe('publisher');
    expect(parsed.licence).toEqual({ name: 'All rights reserved', quotable: true, insertable: false, holder: 'Acorn Computers' });
    expect(parsed.applicability.machines).toEqual(['bbc-b']);
    expect(parsed.entries[0]!.anchors).toEqual([{ kind: 'oscall', value: 'OSBYTE', number: 0x13 }]);
    expect(parsed.entries[0]!.citations[0]!.page).toBe(452);
    /* An entry inherits the pack's tier when it does not state one. */
    expect(parsed.entries[0]!.tier).toBe('publisher');
  });

  it('lets one entry carry a different tier from the pack around it', () => {
    /* A manual with community notes beside it is a real shape, and flattening
     * them to one tier would misdescribe half the pack. */
    const parsed = parseReferencePack(pack({}, { tier: 'community', citations: [] }));
    expect(parsed.tier).toBe('publisher');
    expect(parsed.entries[0]!.tier).toBe('community');
  });

  it('refuses something that is not a pack of this schema and version', () => {
    expect(() => parseReferencePack(null)).toThrow(ReferencePackError);
    expect(() => parseReferencePack(pack({ schema: 'something.else' }))).toThrow(/is not a reference pack/);
    expect(() => parseReferencePack(pack({ version: 2 }))).toThrow(/reads version 1/);
  });

  it('refuses a tier it does not recognise instead of choosing the safest one', () => {
    /* Choosing for it would hide the problem behind a reasonable-looking
     * label, and the label is the thing being trusted. */
    expect(() => parseReferencePack(pack({ tier: 'official' }))).toThrow(/source tier is one of/);
  });

  it('refuses a pack that does not say what may be done with its text', () => {
    expect(() => parseReferencePack(pack({ licence: undefined }))).toThrow(/records no licence/);
    expect(() => parseReferencePack(pack({ licence: { name: 'MIT' } }))).toThrow(/quoted.*inserted|separate permissions/);
  });

  it('refuses a licence that permits inserting what it does not permit quoting', () => {
    expect(() => parseReferencePack(pack({ licence: { name: 'Odd', quotable: false, insertable: true } })))
      .toThrow(/inserting is the stronger permission/);
  });

  it('refuses generated text that claims a citation', () => {
    /* A citation asserts that a document says this. Nothing generated can make
     * that assertion, so carrying one would launder it into evidence. */
    expect(() => parseReferencePack(pack({ tier: 'generated' }))).toThrow(/does not get to cite a source/);
    expect(() => parseReferencePack(pack({ tier: 'generated' }, { citations: [] }))).not.toThrow();
  });

  it('refuses duplicate entry identifiers, because a reference has to be addressable', () => {
    const twice = pack();
    (twice.entries as unknown[]).push({ ...(twice.entries[0] as object) });
    expect(() => parseReferencePack(twice)).toThrow(/appears twice/);
  });

  it('refuses an anchor kind nothing would ever match', () => {
    expect(() => parseReferencePack(pack({}, { anchors: [{ kind: 'sprite', value: 'X' }] })))
      .toThrow(/does not model/);
  });

  it('refuses an empty pack and one past its bounds', () => {
    expect(() => parseReferencePack(pack({ entries: [] }))).toThrow(/holds no entries/);
    expect(() => parseReferencePack(pack({}, { body: 'x'.repeat(PACK_LIMITS.entryBodyCharacters + 1) }))).toThrow(/limit is/);
    expect(() => parseReferencePack(pack({ id: 'Not An Id' }))).toThrow(/not a valid|is not/);
  });
});

describe('what a tier means', () => {
  it('names the two tiers that may be read as authoritative and the two that may not', () => {
    expect(isAuthoritative('publisher')).toBe(true);
    expect(isAuthoritative('independent')).toBe(true);
    expect(isAuthoritative('community')).toBe(false);
    expect(isAuthoritative('generated')).toBe(false);
  });

  it('gives the reader a reason rather than only a label', () => {
    expect(tierCaveat('publisher')).toBeNull();
    expect(tierCaveat('independent')).toBeNull();
    expect(tierCaveat('community')).toMatch(/check anything you depend on/);
    expect(tierCaveat('generated')).toMatch(/never cited as a source/);
  });
});

describe('the digest that says whether a pack changed', () => {
  it('describes the content and not the formatting it arrived in', () => {
    const ordered = parseReferencePack(pack());
    const shuffled = parseReferencePack({ ...pack(), title: 'BBC Microcomputer User Guide' });
    expect(referencePackDigest(ordered)).toBe(referencePackDigest(shuffled));
  });

  it('changes when the text changes, even if the version number does not', () => {
    /* The case this exists for: a publisher reissues a pack under the same
     * number with a paragraph corrected. */
    const before = parseReferencePack(pack());
    const after = parseReferencePack(pack({}, { body: 'Waits for the next vertical synchronisation pulse. See also OSBYTE &00.' }));
    expect(after.packVersion).toBe(before.packVersion);
    expect(referencePackDigest(after)).not.toBe(referencePackDigest(before));
  });
});
