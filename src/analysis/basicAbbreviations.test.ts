// @vitest-environment node

/* The rule is the ROM's table order, not anything alphabetical, and the
 * dangerous mistake is expanding something inside a string or a REM. */
import { describe, expect, it } from 'vitest';
import { BBC_BASIC_2, BBC_BASIC_3, BBC_BASIC_4 } from './basicDialects';
import { expandAbbreviation, expandLine, findAbbreviations } from './basicAbbreviations';

describe('resolving an abbreviation the way the machine does', () => {
  it('takes the first keyword the ROM lists, not the first alphabetically', () => {
    /* PAGE and PI both start with P and come earlier alphabetically; the table
     * reaches PRINT first, which is why P. is PRINT on a real machine. */
    expect(expandAbbreviation(BBC_BASIC_2, 'P.')).toBe('PRINT');
    expect(BBC_BASIC_2.order.indexOf('PRINT')).toBeLessThan(BBC_BASIC_2.order.indexOf('PAGE'));
  });

  it('expands the abbreviations every BBC user knows', () => {
    for (const [written, keyword] of [['F.', 'FOR'], ['N.', 'NEXT'], ['REP.', 'REPEAT'], ['U.', 'UNTIL'], ['GOS.', 'GOSUB'], ['V.', 'VDU']]) {
      expect(expandAbbreviation(BBC_BASIC_2, written!), written).toBe(keyword);
    }
  });

  it('accepts a full keyword written out, since a prefix of itself still matches', () => {
    expect(expandAbbreviation(BBC_BASIC_2, 'PRINT.')).toBe('PRINT');
  });

  it('is case-insensitive, because a machine reading a listing is', () => {
    expect(expandAbbreviation(BBC_BASIC_2, 'p.')).toBe('PRINT');
  });

  it('refuses a prefix that matches nothing rather than guessing', () => {
    expect(expandAbbreviation(BBC_BASIC_2, 'ZZ.')).toBeNull();
    expect(expandAbbreviation(BBC_BASIC_2, '.')).toBeNull();
  });

  it('lets two dialects disagree, because their tables do', () => {
    /* The US ROM lists COLOR first and the Master lists COLOUR, so the same
     * abbreviation is a different keyword on each machine. Resolving against
     * one table for every dialect would be wrong on the other. */
    expect(expandAbbreviation(BBC_BASIC_3, 'COLO.')).toBe('COLOR');
    expect(expandAbbreviation(BBC_BASIC_4, 'COLO.')).toBe('COLOUR');
  });
});

describe('what must never be expanded', () => {
  it('leaves text inside a string alone', () => {
    /* A P. in a message is two characters somebody typed. */
    expect(expandLine(BBC_BASIC_2, '10 PRINT "P. is not a keyword here"'))
      .toBe('10 PRINT "P. is not a keyword here"');
  });

  it('leaves a REM tail alone to the end of the line', () => {
    expect(expandLine(BBC_BASIC_2, '20 REM F. and N. are prose here'))
      .toBe('20 REM F. and N. are prose here');
  });

  it('leaves a DATA payload alone', () => {
    expect(expandLine(BBC_BASIC_2, '30 DATA P.,F.,N.')).toBe('30 DATA P.,F.,N.');
  });

  it('protects the rest of the line when a string is never closed', () => {
    /* The machine would read it as string content too, so expanding after it
     * would edit what it thinks is data. */
    expect(expandLine(BBC_BASIC_2, '40 PRINT "unterminated P.')).toBe('40 PRINT "unterminated P.');
  });
});

describe('expanding a whole line', () => {
  it('expands several abbreviations and leaves everything else exactly as it was', () => {
    expect(expandLine(BBC_BASIC_2, '10 F.I=1TO10:P.I:N.')).toBe('10 FORI=1TO10:PRINTI:NEXT');
  });

  it('reports what it could not expand instead of quietly leaving it', () => {
    const found = findAbbreviations(BBC_BASIC_2, '10 ZZ. P.');
    expect(found.map((entry) => entry.keyword)).toEqual([null, 'PRINT']);
    expect(found[0]!.reason).toMatch(/matches no keyword in BBC BASIC II/);
  });

  it('gives each abbreviation its exact range, so a caller can show or replace it', () => {
    const [only] = findAbbreviations(BBC_BASIC_2, '10 P.');
    expect(only).toMatchObject({ written: 'P.', start: 3, end: 5, keyword: 'PRINT' });
  });

  it('changes nothing in a line that has no abbreviation', () => {
    expect(expandLine(BBC_BASIC_2, '10 PRINT "hello"')).toBe('10 PRINT "hello"');
  });
});
