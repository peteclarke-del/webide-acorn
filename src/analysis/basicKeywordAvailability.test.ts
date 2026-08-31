// @vitest-environment node

/* What the ROMs say about a keyword, which is everything this build can say
 * about the ones nobody has written prose for. */
import { describe, expect, it } from 'vitest';
import { basicKeywordAvailability, catalogueCoverage } from './basicKeywordAvailability';
import { basicLanguageItems } from '../language/acornLanguageReference';

describe('what the ROMs say about a keyword', () => {
  it('reports a keyword every tabled BASIC has', () => {
    const found = basicKeywordAvailability('PRINT')!;
    expect(found.everywhere).toBe(true);
    expect(found.dialects).toHaveLength(4);
    expect(found.summary).toMatch(/every BBC BASIC this build has a table for, token &F1/);
  });

  it('names the machines when a keyword is not on all of them', () => {
    /* EDIT is BASIC IV's alone, and saying so is the useful part: a program
     * using it will not run on a Model B. */
    const found = basicKeywordAvailability('EDIT')!;
    expect(found.everywhere).toBe(false);
    expect(found.dialects.map((entry) => entry.id)).toEqual(['bbc-basic-4']);
    expect(found.summary).toMatch(/A keyword of BBC BASIC IV — and not of the others/);
  });

  it('finds a spelling that shares its token with another', () => {
    /* COLOR is in the map for one ROM and an alias in the other; looking only
     * at the map would report it missing from the machine that has it. */
    const found = basicKeywordAvailability('COLOR')!;
    expect(found.dialects.map((entry) => entry.id)).toEqual(['bbc-basic-3', 'bbc-basic-4']);
    expect(found.dialects.every((entry) => entry.tokens.includes(0xfb))).toBe(true);
  });

  it('says nothing about a word no ROM defines, rather than guessing', () => {
    expect(basicKeywordAvailability('BEATS')).toBeNull();
    expect(basicKeywordAvailability('')).toBeNull();
  });

  it('is case-insensitive, as a listing is', () => {
    expect(basicKeywordAvailability('print')?.keyword).toBe('PRINT');
  });

  it('reports both tokens of a pseudo-variable rather than only the first', () => {
    /* PAGE is &90 read and &D0 assigned. Reporting one would make the other
     * decode as an unknown byte. */
    const found = basicKeywordAvailability('PAGE')!;
    expect(found.dialects[0]!.tokens).toEqual([0x90, 0xd0]);
    expect(found.summary).toMatch(/one token for reading and another for assigning/);
  });
});

describe('how much of the language the written reference covers', () => {
  it('measures the gap against the ROM rather than against a kept list', () => {
    /* The denominator comes from firmware, so adding a keyword to the
     * reference moves the number and nothing else does. */
    const documented = basicLanguageItems().map((item) => item.token);
    const coverage = catalogueCoverage(documented);
    const second = coverage.find((entry) => entry.dialect === 'bbc-basic-2')!;
    /* 121 distinct spellings across 126 table entries: five pseudo-variables
     * are listed twice, once for reading and once for assigning. */
    expect(second.keywords).toBe(121);
    expect(second.documented).toBeGreaterThan(0);
    expect(second.documented).toBeLessThan(second.keywords);
    expect(second.undocumented).toHaveLength(second.keywords - second.documented);
  });

  it('names what is missing, so the gap is a list rather than a feeling', () => {
    const coverage = catalogueCoverage(['PRINT']);
    const second = coverage.find((entry) => entry.dialect === 'bbc-basic-2')!;
    expect(second.documented).toBe(1);
    expect(second.undocumented).toContain('ADVAL');
    expect(second.undocumented).not.toContain('PRINT');
  });

  it('counts every dialect, so a keyword added only to the Master is not lost', () => {
    expect(catalogueCoverage([]).map((entry) => entry.dialect))
      .toEqual(['bbc-basic-1', 'bbc-basic-2', 'bbc-basic-3', 'bbc-basic-4']);
  });
});
