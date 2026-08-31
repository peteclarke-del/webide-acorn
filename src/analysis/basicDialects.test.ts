// @vitest-environment node

/*
 * The tables are read out of ROMs rather than transcribed, so what has to be
 * checked is the reading. The strongest available check is that the same
 * method reproduces the BASIC II table this repository already carried,
 * transcribed independently and by hand — and that check runs here, without a
 * ROM, because the generated table is in the repository and the transcription
 * still is too.
 */
import { describe, expect, it } from 'vitest';
import { BBC_BASIC_II_TOKENS } from './bbcBasic';
import { BASIC_DIALECTS, BBC_BASIC_1, BBC_BASIC_2, BBC_BASIC_3, BBC_BASIC_4, basicDialect } from './basicDialects';

describe('the generated tables against the hand transcription', () => {
  it('reproduces the BASIC II table exactly, which is what makes the others trustworthy', () => {
    expect(BBC_BASIC_2.tokens).toEqual(BBC_BASIC_II_TOKENS);
  });

  it('ends every table at the same keyword, which is the table’s rule and not the reader’s', () => {
    /* Four ROMs of different vintages stopping at the same place is
     * corroboration that the end was found rather than chosen. */
    for (const dialect of BASIC_DIALECTS) {
      expect(dialect.order[dialect.order.length - 1], dialect.label).toBe('HIMEM');
    }
  });

  it('records which firmware each table came from', () => {
    /* No ROM is in this repository, so the digest is how somebody checks a
     * table against the thing it claims to have been read from. */
    for (const dialect of BASIC_DIALECTS) {
      expect(dialect.provenance.sha256, dialect.label).toMatch(/^[0-9a-f]{64}$/);
      expect(dialect.provenance.source, dialect.label).toBeTruthy();
    }
    /* And they are four different ROMs, not one read four times. */
    expect(new Set(BASIC_DIALECTS.map((dialect) => dialect.provenance.sha256)).size).toBe(4);
  });
});

describe('what the tables say about the language', () => {
  it('grows across the ROMs rather than being reshuffled', () => {
    expect(BBC_BASIC_1.order.length).toBeLessThan(BBC_BASIC_2.order.length);
    expect(BBC_BASIC_2.order.length).toBeLessThan(BBC_BASIC_3.order.length);
    expect(BBC_BASIC_3.order.length).toBeLessThan(BBC_BASIC_4.order.length);
  });

  it('keeps both spellings where two share a token, and says which shares with which', () => {
    /* COLOUR and COLOR are the same token; a map alone would silently drop
     * one, and which the ROM lists first is which that machine lists back. */
    expect(BBC_BASIC_3.aliases).toEqual([{ keyword: 'COLOUR', sameAs: 'COLOR', token: 0xfb }]);
    expect(BBC_BASIC_4.aliases).toEqual([{ keyword: 'COLOR', sameAs: 'COLOUR', token: 0xfb }]);
    expect(BBC_BASIC_3.tokens[0xfb]).toBe('COLOR');
    expect(BBC_BASIC_4.tokens[0xfb]).toBe('COLOUR');
  });

  it('gives BASIC IV the keyword the earlier ROMs do not have', () => {
    expect(BBC_BASIC_4.tokens[0xce]).toBe('EDIT');
    expect(BBC_BASIC_2.tokens[0xce]).toBeUndefined();
  });

  it('has no dialect claiming a token twice in its own map', () => {
    for (const dialect of BASIC_DIALECTS) {
      const tokens = Object.keys(dialect.tokens);
      expect(new Set(tokens).size, dialect.label).toBe(tokens.length);
    }
  });

  it('finds a dialect by name and refuses one it does not have', () => {
    expect(basicDialect('bbc-basic-4')?.label).toBe('BBC BASIC IV');
    /* BASIC V and VI are deliberately absent rather than approximated. */
    expect(basicDialect('atom-basic')).toBeUndefined();
  });
});
