// @vitest-environment node

/* The requirement is to refuse an ambiguous dialect safely, and the tables
 * make that the common case rather than the rare one. */
import { describe, expect, it } from 'vitest';
import { BASIC_DIALECTS } from './basicDialects';
import { inferTextDialect, inferTokenisedDialect } from './basicDialectInference';

const bytes = (...values: number[]) => Uint8Array.from(values);

describe('how much a tokenised file can say about itself', () => {
  it('can narrow but never name, and says which bytes are not evidence at all', () => {
    /*
     * No token names a single dialect. Four narrow the answer, and nine bytes
     * that look as though they would are excluded because they mean different
     * kinds of thing in different dialects.
     *
     * That exclusion is the part worth pinning. &C6, &C7 and &C8 are ordinary
     * keywords on a 6502 BASIC — AUTO, DELETE, LOAD — and are the two-byte
     * prefixes on an ARM one. &CF to &D3 are the 6502 pseudo-variables and
     * BASIC V's statement forms. Counting a raw &C7 as proof of a 6502 BASIC
     * would convict every ARM file that lists anything, and the file would then
     * look like it carried tokens from two dialects at once.
     */
    const ambiguous = new Set<number>();
    for (const dialect of BASIC_DIALECTS) {
      for (const prefix of Object.keys(dialect.extended ?? {})) ambiguous.add(Number(prefix));
      for (const token of Object.keys(dialect.statementForms ?? {})) ambiguous.add(Number(token));
    }
    expect([...ambiguous].sort((a, b) => a - b)).toEqual([0xc6, 0xc7, 0xc8, 0xcc, 0xcf, 0xd0, 0xd1, 0xd2, 0xd3]);

    const owners = new Map<number, string[]>();
    for (const dialect of BASIC_DIALECTS) {
      for (const token of Object.keys(dialect.tokens).map(Number)) {
        if (ambiguous.has(token)) continue;
        owners.set(token, [...(owners.get(token) ?? []), dialect.id]);
      }
    }
    expect([...owners].filter(([, ids]) => ids.length === 1), 'no token names one dialect').toEqual([]);

    const narrowing = [...owners].filter(([, ids]) => ids.length < BASIC_DIALECTS.length).sort((a, b) => a[0] - b[0]);
    expect(narrowing.map(([token]) => token)).toEqual([0x7f, 0x8e, 0xce, 0xff]);
    expect(narrowing[0]![1], 'OTHERWISE rules out the 6502 family')
      .toEqual(['bbc-basic-5-riscos2', 'bbc-basic-5', 'bbc-basic-6']);
  });

  it('no longer claims &CE proves BASIC IV, because BASIC V calls it something else', () => {
    /* This is what adding a dialect did to the evidence. &CE was the one token
     * that identified BASIC IV — EDIT, which no other 6502 BASIC had — and in
     * BASIC V the same byte is ENDWHILE. A file carrying it could be either, so
     * the honest answer changed from "BASIC IV" to "cannot tell", and it
     * changed on its own because the evidence is derived from the tables rather
     * than written down beside them. */
    const inferred = inferTokenisedDialect(bytes(0xce));
    expect(inferred.dialect).toBeNull();
    expect(inferred.candidates).toContain('bbc-basic-4');
    expect(inferred.candidates).toContain('bbc-basic-5');
  });

  it('refuses when every token is shared, and says the refusal is the normal case', () => {
    /* PRINT and FOR are in every table, so a program made of them could have
     * come from any machine. Returning one would be inventing an answer. */
    const inferred = inferTokenisedDialect(bytes(0xf1, 0xe3, 0xed));
    expect(inferred.dialect).toBeNull();
    expect(inferred.candidates.length).toBeGreaterThan(1);
    expect(inferred.reason).toMatch(/share every token but one/);
  });

  it('refuses a file carrying tokens from more than one dialect rather than picking the commonest', () => {
    /* Two dialects' worth of evidence is not a dialect. It is a file that is
     * not what it claims, or a reader that has lost its place. */
    const inferred = inferTokenisedDialect(bytes(0x7f));
    expect(inferred.dialect).toBeNull();
    expect(inferred.candidates).toEqual(['bbc-basic-5-riscos2', 'bbc-basic-5', 'bbc-basic-6']);
    /* And with nothing distinguishing at all, no claim and no candidates
     * narrowed either. */
    expect(inferTokenisedDialect(bytes()).dialect).toBeNull();
  });
});

describe('what plain text can say', () => {
  it('recognises an Atom line label, which no BBC BASIC accepts', () => {
    const inferred = inferTextDialect('10aPRINT "hello"\n20bGOTO 10\n');
    expect(inferred.dialect).toBe('atom-basic');
    expect(inferred.reason).toMatch(/Atom line label/);
  });

  it('refuses ordinary BBC text rather than guessing a ROM', () => {
    /* Text carries no tokens at all, so it cannot say which ROM would have
     * tokenised it. */
    const inferred = inferTextDialect('10 PRINT "hello"\n20 GOTO 10\n');
    expect(inferred.dialect).toBeNull();
    expect(inferred.candidates).toContain('atom-basic');
    expect(inferred.reason).toMatch(/has to come from the machine it is for/);
  });

  it('is not fooled by an upper-case keyword straight after the line number', () => {
    /* `10 PRINT` is not an Atom label; only a lower-case one is. */
    expect(inferTextDialect('10 PRINT 1').dialect).toBeNull();
  });
});
