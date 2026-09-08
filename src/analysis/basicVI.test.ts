import { describe, expect, it } from 'vitest';
import { BASIC_DIALECTS, BBC_BASIC_5, BBC_BASIC_6, basicDialect } from './basicDialects';

/*
 * BBC BASIC VI, and the claim this repository refused to ship on trust.
 *
 * BASIC VI is BASIC V with eight-byte reals, supplied as a separate `BASIC64`
 * module, and its tokens are *widely said* to be identical to BASIC V's. Widely
 * said is exactly what this work exists not to ship: a hand-copied table has a
 * typo in it and nothing finds the typo until somebody's program decodes wrongly.
 *
 * A backlog note here once recorded, as fact, that BASIC64 "shipped on disc
 * rather than burnt into ROM". That was wrong. It rested on a search of the
 * images then held (RISC OS 2.00 to 4.39, from which BASIC64 genuinely is
 * absent), and turned a local absence into a claim about what Acorn shipped.
 * Two traps had made that negative worse than it looked: most Acorn ARM ROM
 * images are stored interleaved, so a plain string search reads scrambled bytes,
 * and `BASIC` itself does not occur in the A310 or A5000 images until they are
 * de-interleaved four ways.
 *
 * With a complete RISC OS ROM set, `BASIC64` occurs in seven images, all of them
 * RISC OS 6, and in none of the twenty-eight earlier ones. Each of those seven
 * carries *two* keyword tables, one in the `BASIC` module and one in `BASIC64`
 *, which is what makes the identity checkable rather than assumable: the two
 * can be compared inside a single image, with no second machine and nothing
 * taken on trust. They are identical in all seven, and all seven give the same
 * 161-entry table.
 *
 * Against the BASIC V table here, which was read independently out of RISC OS
 * 3.11, every keyword and every token agrees and one flag byte does not:
 * `STRING$(` carries `&80` in 3.11 and `&82` in 6.16, at the same token `&C4`.
 * It changes nothing that is derived from the flag, both leave the keyword a
 * plain one-byte token, which is why the tables can be shared, and it is
 * recorded here because "identical" would have been the wrong word.
 *
 * These cases hold the consequence of that measurement: the two dialects share
 * one table, and share it by reference so the copies cannot drift apart.
 */
describe('BBC BASIC VI', () => {
  it('is offered as a dialect of its own', () => {
    expect(basicDialect('bbc-basic-6')).toBe(BBC_BASIC_6);
    expect(BASIC_DIALECTS).toContain(BBC_BASIC_6);
    expect(BBC_BASIC_6.label).toBe('BBC BASIC VI');
  });

  it("shares BASIC V's tables rather than carrying a second copy", () => {
    /* By reference, not by value. Two copies of a table that was shown to be
     * one table is how the copies come to disagree. */
    expect(BBC_BASIC_6.tokens).toBe(BBC_BASIC_5.tokens);
    expect(BBC_BASIC_6.extended).toBe(BBC_BASIC_5.extended);
    expect(BBC_BASIC_6.statementForms).toBe(BBC_BASIC_5.statementForms);
    expect(BBC_BASIC_6.order).toBe(BBC_BASIC_5.order);
  });

  it('has a table to share, so the identity above is not vacuous', () => {
    expect(BBC_BASIC_6.order).toHaveLength(161);
    expect(BBC_BASIC_6.order[0]).toBe('AND');
    expect(BBC_BASIC_6.order.at(-1)).toBe('WIDTH');
    expect(Object.keys(BBC_BASIC_6.tokens).length).toBeGreaterThan(100);
  });

  it('keeps the COLOR spelling that shares a token with COLOUR', () => {
    /* Both spellings sit at &FB in the BASIC64 table, exactly as they do in the
     * RISC OS 3.11 BASIC V table this repository already carried. */
    expect(BBC_BASIC_6.aliases).toContainEqual({ keyword: 'COLOR', sameAs: 'COLOUR', token: 251 });
    expect(BBC_BASIC_6.order).toContain('COLOUR');
    expect(BBC_BASIC_6.order).toContain('COLOR');
  });

  it("says which firmware it was read from, and does not claim BASIC V's", () => {
    /* The tables are shared; the provenance is not. A dialect that borrowed the
     * other's provenance would be claiming a measurement it did not make. */
    expect(BBC_BASIC_6.provenance.source).toBe('riscos616');
    expect(BBC_BASIC_6.provenance.source).not.toBe(BBC_BASIC_5.provenance.source);
    expect(BBC_BASIC_6.provenance.sha256).not.toBe(BBC_BASIC_5.provenance.sha256);
    expect(BBC_BASIC_6.provenance.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(BBC_BASIC_6.provenance.detail).toMatch(/BASIC64/);
    expect(BBC_BASIC_6.provenance.detail).toMatch(/1\.37/);
  });

  it('leaves BASIC V saying it came from RISC OS 3.11', () => {
    /* The older reading must not be quietly replaced by the newer one: they are
     * two independent measurements and their agreement is the evidence. */
    expect(BBC_BASIC_5.provenance.source).toBe('riscos311');
    expect(BBC_BASIC_5.label).toBe('BBC BASIC V');
  });
});
