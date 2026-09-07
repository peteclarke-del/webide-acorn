// @vitest-environment node

/* The requirement is to refuse an ambiguous dialect safely, and the tables
 * make that the common case rather than the rare one. */
import { describe, expect, it } from 'vitest';
import { BASIC_DIALECTS } from './basicDialects';
import { inferTextDialect, inferTokenisedDialect } from './basicDialectInference';

const bytes = (...values: number[]) => Uint8Array.from(values);

describe('how much a tokenised file can say about itself', () => {
  it('has almost nothing to go on, and that is a fact about the ROMs', () => {
    /* Exactly one token belongs to a single keyword *table*. Every refusal
     * below rests on that, so this contract should be the thing that notices if
     * it stops being true.
     *
     * The unit is the table rather than the dialect because two dialects now
     * share one: BASIC V and BASIC VI carry the identical table — measured in
     * every RISC OS 6 ROM, which holds both modules — and differ only in how a
     * real number is stored, which no token records. Counted by dialect the
     * answer would be zero unique tokens, and that would say the evidence had
     * vanished when it had only stopped naming one of two names for it. */
    const owners = new Map<number, string[]>();
    const tables = new Map<number, object[]>();
    for (const dialect of BASIC_DIALECTS) {
      for (const token of Object.keys(dialect.tokens).map(Number)) {
        owners.set(token, [...(owners.get(token) ?? []), dialect.id]);
        tables.set(token, [...(tables.get(token) ?? []), dialect.tokens]);
      }
    }
    const unique = [...tables].filter(([, carried]) => new Set(carried).size === 1);
    expect(unique).toHaveLength(1);
    expect(unique[0]![0]).toBe(0x7f);
    expect(owners.get(0x7f)).toEqual(['bbc-basic-5', 'bbc-basic-6']);
  });

  it('narrows to the two dialects a distinguishing token proves, and names neither', () => {
    /*
     * &7F is OTHERWISE, which only the ARM BASIC table has. That rules out all
     * four 6502 dialects, which is real and useful; what it cannot do is choose
     * between BASIC V and BASIC VI, because they are one table under two names.
     *
     * This used to name BASIC V, and stopped when BASIC VI was added. Refusing
     * to name one is the honest answer, and reporting both candidates keeps the
     * fact that was actually established.
     */
    const inferred = inferTokenisedDialect(bytes(0x0d, 0x00, 0x0a, 0x7f, 0x0d));
    expect(inferred.dialect).toBeNull();
    expect(inferred.candidates).toEqual(['bbc-basic-5', 'bbc-basic-6']);
    expect(inferred.reason).toMatch(/share one keyword table/);
    expect(inferred.reason).toMatch(/BBC BASIC V and BBC BASIC VI/);
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
    expect(inferred.candidates).toEqual(['bbc-basic-5', 'bbc-basic-6']);
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
