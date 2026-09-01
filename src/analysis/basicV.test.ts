import { describe, expect, it } from 'vitest';
import { BBC_BASIC_II_TOKENS, decodeTokenizedBasic } from './bbcBasic';
import { BASIC_DIALECTS, BBC_BASIC_5 } from './basicDialects';
import { BASIC_V_MEASUREMENTS, BASIC_V_MEASUREMENT_SOURCE } from './basicVMeasurements';

/* The tables the decoder is given for a BASIC V program. */
const TABLES = {
  label: 'BBC BASIC V',
  tokens: BBC_BASIC_5.tokens,
  extended: BBC_BASIC_5.extended,
  statementForms: BBC_BASIC_5.statementForms,
} as const;

/** One line of a tokenised program, in the format BASIC stores. */
function program(body: readonly number[], lineNumber = 10): Uint8Array {
  return Uint8Array.from([0x0d, lineNumber >> 8, lineNumber & 0xff, body.length + 4, ...body, 0x0d, 0xff]);
}

describe('BBC BASIC V, against what the machine actually did', () => {
  it('decodes every measured line back to the text that was typed', () => {
    /* This is the whole of the evidence for the two-byte encoding, and it is
     * checked rather than described: each of these byte sequences came out of a
     * real RISC OS 3.11 machine after the text beside it was typed in. A rule
     * that stopped matching the machine fails here. */
    expect(BASIC_V_MEASUREMENTS.length).toBeGreaterThan(90);
    const wrong: string[] = [];
    for (const [typed, bytes] of BASIC_V_MEASUREMENTS) {
      const listing = decodeTokenizedBasic(program(bytes), TABLES);
      const source = listing?.lines[0]?.source;
      if (source !== typed) wrong.push(`${typed} decoded as ${JSON.stringify(source)}`);
    }
    expect(wrong).toEqual([]);
  });

  it('reads a two-byte keyword as one keyword rather than as its prefix and a token', () => {
    /* &C7 &8E is APPEND. Read a byte at a time it would be two keywords, and
     * both of them would be words the reader recognises — which is why this
     * fails silently rather than loudly when it is wrong. */
    const listing = decodeTokenizedBasic(program([0xc7, 0x8e]), TABLES);
    expect(listing?.lines[0]?.source).toBe('APPEND');
    expect(BBC_BASIC_5.tokens[0x8e]).toBe('OPENIN');
  });

  it('tells the three prefixes apart, which the same second byte depends on', () => {
    /* &8E after each prefix is a different keyword, and after none of them is a
     * fourth. That is the ambiguity the measurement existed to resolve. */
    expect(decodeTokenizedBasic(program([0xc6, 0x8e]), TABLES)?.lines[0]?.source).toBe('SUM');
    expect(decodeTokenizedBasic(program([0xc7, 0x8e]), TABLES)?.lines[0]?.source).toBe('APPEND');
    expect(decodeTokenizedBasic(program([0xc8, 0x8e]), TABLES)?.lines[0]?.source).toBe('CASE');
    expect(decodeTokenizedBasic(program([0x8e]), TABLES)?.lines[0]?.source).toBe('OPENIN');
  });

  it('reads both forms of a pseudo-variable, which are different tokens', () => {
    expect(decodeTokenizedBasic(program([0xd3, 0x3d, 0x31]), TABLES)?.lines[0]?.source).toBe('HIMEM=1');
    expect(decodeTokenizedBasic(program([0x41, 0x3d, 0x93]), TABLES)?.lines[0]?.source).toBe('A=HIMEM');
  });

  it('reads both forms of ELSE, which are different tokens', () => {
    expect(decodeTokenizedBasic(program([0xcc]), TABLES)?.lines[0]?.source).toBe('ELSE');
    expect(decodeTokenizedBasic(program([0xe7, 0x41, 0x3d, 0x31, 0x8c, 0x8d, 0x74, 0x58, 0x43, 0x8b, 0x8d, 0x74, 0x62, 0x43]), TABLES)?.lines[0]?.source)
      .toBe('IFA=1THEN920ELSE930');
  });

  it('says so when a two-byte keyword is truncated rather than inventing one', () => {
    const listing = decodeTokenizedBasic(program([0xc7]), TABLES);
    expect(listing?.lines[0]?.source).toBe('[&C7]');
    expect(listing?.warnings.join(' ')).toContain('truncated or unknown');
  });

  it('leaves the 6502 decode exactly as it was, with no prefixes to find', () => {
    /* BASIC II has no two-byte keywords, so &C7 there is a keyword of its own
     * and must stay one. A decoder that looked for prefixes everywhere would
     * quietly change what every existing file says. */
    const listing = decodeTokenizedBasic(program([0xc7, 0x8e]));
    expect(listing?.dialect).toBe('BBC BASIC II');
    expect(listing?.lines[0]?.source).toBe(`${BBC_BASIC_II_TOKENS[0xc7]}${BBC_BASIC_II_TOKENS[0x8e]}`);
    expect(listing?.lines[0]?.source).not.toBe('APPEND');
  });

  it('carries the table and the measurement from the same firmware', () => {
    /* A table read from one ROM and a measurement taken on another would agree
     * about nothing in particular. */
    expect(BASIC_V_MEASUREMENT_SOURCE.sha256).toBe(BBC_BASIC_5.provenance.sha256);
    expect(BASIC_V_MEASUREMENT_SOURCE.firmware).toContain('BBC BASIC V 1.05');
  });

  it('is the only dialect here with two-byte keywords, and the others say so by having none', () => {
    for (const dialect of BASIC_DIALECTS) {
      if (dialect.id === 'bbc-basic-5') expect(Object.keys(dialect.extended ?? {})).toHaveLength(3);
      else expect(dialect.extended, dialect.label).toBeUndefined();
    }
  });
});

describe('which BASIC a tokenised file is read against', () => {
  it('reads an ARM machine’s file as BASIC V and a 6502 machine’s as BASIC II', async () => {
    /* The dialect comes from the machine because it is almost never in the
     * file. The same bytes therefore decode to different keywords depending on
     * what somebody selected, and that is correct rather than unfortunate:
     * &C7 &8E is APPEND on an Archimedes and two other keywords on a BBC. */
    const { analyseFile } = await import('./fileAnalysis');
    const bytes = program([0xc7, 0x8e]);
    const options = { origin: 0x8000, entryPoint: 0x8000 } as const;
    const arm = analyseFile(bytes, 'listing', { ...options, processor: 'arm2', tokenisedBasicDialect: 'bbc-basic-5' });
    const bbc = analyseFile(bytes, 'listing', { ...options, processor: '6502', tokenisedBasicDialect: 'bbc-basic-2' });
    expect(arm.kind).toBe('bbc-basic');
    expect(bbc.kind).toBe('bbc-basic');
    expect(arm.kind === 'bbc-basic' && arm.dialect).toBe('BBC BASIC V');
    expect(bbc.kind === 'bbc-basic' && bbc.dialect).toBe('BBC BASIC II');
    expect(arm.kind === 'bbc-basic' && arm.lines[0]!.source).toBe('APPEND');
    expect(bbc.kind === 'bbc-basic' && bbc.lines[0]!.source).not.toBe('APPEND');
  });

  it('defaults to BASIC II rather than to whichever was asked for last', async () => {
    const { analyseFile } = await import('./fileAnalysis');
    const listing = analyseFile(program([0xc7, 0x8e]), 'listing', { origin: 0x8000, entryPoint: 0x8000, processor: '6502' });
    expect(listing.kind === 'bbc-basic' && listing.dialect).toBe('BBC BASIC II');
  });
});
