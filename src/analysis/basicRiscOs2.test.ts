import { describe, expect, it } from 'vitest';
import { BASIC_DIALECTS, BBC_BASIC_5, BBC_BASIC_5_RISCOS2, BBC_BASIC_6, basicDialect } from './basicDialects';

/*
 * BBC BASIC V as RISC OS 2 shipped it, and the defect that finding it exposed.
 *
 * The tables were treated as one per language and they are one per ROM
 * generation. Reading every ARM ROM held here found five distinct ones: 157
 * entries in RISC OS 2.00, 158 in one 2.01 build, and 161 in three later
 * variants.
 *
 * That would be a gap rather than a defect if the growth were additive. It is
 * not: RISC OS 3.11 inserted CRUNCH at &C7 &90 and shifted every two-byte token
 * after it. So a tokenised RISC OS 2 program read with the later table prints
 * keywords the program does not contain — and prints them confidently, which is
 * the worst way to be wrong. The A310 this build qualifies shipped with RISC OS
 * 2, so the file is somebody's, not a hypothetical.
 *
 * These cases hold the disagreement itself, because it is the reason the
 * dialect exists. If the two tables ever stopped disagreeing, one of them would
 * have been read wrongly.
 */
describe('BBC BASIC V as RISC OS 2 shipped it', () => {
  it('is offered as a dialect of its own', () => {
    expect(basicDialect('bbc-basic-5-riscos2')).toBe(BBC_BASIC_5_RISCOS2);
    expect(BASIC_DIALECTS).toContain(BBC_BASIC_5_RISCOS2);
    expect(BBC_BASIC_5_RISCOS2.label).toBe('BBC BASIC V (RISC OS 2)');
  });

  it('is a shorter table that ends where the ARM tables end', () => {
    expect(BBC_BASIC_5_RISCOS2.order).toHaveLength(157);
    expect(BBC_BASIC_5.order).toHaveLength(161);
    expect(BBC_BASIC_5_RISCOS2.order.at(-1)).toBe('WIDTH');
  });

  it('disagrees with the later table on the tokens 3.11 shifted', () => {
    /* The three that make this a decoding defect rather than a missing dialect.
     * Same bytes, different keywords, no way for a file to say which. */
    const earlier = BBC_BASIC_5_RISCOS2.extended![0xc7]!;
    const later = BBC_BASIC_5.extended![0xc7]!;
    expect([earlier[0x94], later[0x94]]).toEqual(['LOAD', 'LIST']);
    expect([earlier[0x95], later[0x95]]).toEqual(['LVAR', 'LOAD']);
    expect([earlier[0x96], later[0x96]]).toEqual(['NEW', 'LVAR']);
  });

  it('is missing the keywords 3.11 added, which is why the shift happened', () => {
    const earlier = Object.values(BBC_BASIC_5_RISCOS2.extended![0xc7]!);
    const later = Object.values(BBC_BASIC_5.extended![0xc7]!);
    expect(earlier).not.toContain('CRUNCH');
    expect(later).toContain('CRUNCH');
    for (const added of ['CRUNCH', 'INSTALL', 'TEXTLOAD', 'TEXTSAVE']) {
      expect(later, added).toContain(added);
      expect(earlier, added).not.toContain(added);
    }
  });

  it('carries its own table rather than sharing one', () => {
    /* BASIC V and VI share a table because they were measured to be one table.
     * This one was measured to be a different table, so it must not share. */
    expect(BBC_BASIC_5_RISCOS2.tokens).not.toBe(BBC_BASIC_5.tokens);
    expect(BBC_BASIC_5_RISCOS2.extended).not.toBe(BBC_BASIC_5.extended);
    expect(BBC_BASIC_6.tokens).toBe(BBC_BASIC_5.tokens);
  });

  it('claims no statement forms, because nobody has measured them', () => {
    /*
     * BASIC V's were not read from a ROM: a linear keyword table does not carry
     * them, and they were measured by typing into a running RISC OS 3.11
     * machine on this build's own A310 core. That has not been done on RISC OS
     * 2, so this says nothing rather than borrowing the other's answer — the
     * same thing the 6502 dialects do by leaving the field out.
     */
    expect(BBC_BASIC_5_RISCOS2.statementForms).toBeUndefined();
    expect(BBC_BASIC_5.statementForms).toBeDefined();
    expect(BBC_BASIC_5_RISCOS2.provenance.detail).toMatch(/not established/i);
  });

  it('says which firmware it was read from', () => {
    expect(BBC_BASIC_5_RISCOS2.provenance.source).toBe('riscos200');
    expect(BBC_BASIC_5_RISCOS2.provenance.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(BBC_BASIC_5_RISCOS2.provenance.sha256).not.toBe(BBC_BASIC_5.provenance.sha256);
  });
});
