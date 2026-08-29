import { describe, expect, it } from 'vitest';
import { disassemble6502 } from './disassembler6502';
import { correlateRuntimeCoverage, rowCoverageLabel, type RuntimeCoverageInput } from './runtimeCoverage';

/* 1900 LDA #&00 / 1902 JMP (&1910) / 1905 LDA #&42 / 1907 RTS / … */
const BYTES = Uint8Array.from([0xa9, 0x00, 0x6c, 0x10, 0x19, 0xa9, 0x42, 0x60]);
const DIGEST = '1'.repeat(64);
const OTHER_DIGEST = '2'.repeat(64);
const analysis = disassemble6502(BYTES, 0x1900, 0x1900, '6502');

const profiler = (addresses: Array<{ address: number; instructions: number; cycles: number }>, extra: Partial<RuntimeCoverageInput['profiler'] & object> = {}) => ({
  enabled: true, instructions: 100, untrackedInstructions: 0, uniqueAddresses: addresses.length,
  source: 'live jsbeeb instruction hook', addresses, ...extra,
});

const manifest = (overrides: Partial<{ outputSha256: string; origin: number; bytes: number; name: string }> = {}) => ({
  outputSha256: DIGEST, origin: 0x1900, bytes: BYTES.length, name: 'probe.bin', ...overrides,
});

describe('static analysis and runtime coverage correlation', () => {
  it('says nothing about coverage when no machine is attached', () => {
    const result = correlateRuntimeCoverage({ analysis, analysedSha256: DIGEST, programManifest: manifest(), profiler: null });
    expect(result.status).toBe('no-runtime');
    expect(result.entries.size).toBe(0);
    expect(result.reason).toContain('No machine is attached');
  });

  it('asks for the profiler rather than inferring coverage from static reachability', () => {
    const result = correlateRuntimeCoverage({
      analysis, analysedSha256: DIGEST, programManifest: manifest(),
      profiler: profiler([{ address: 0x1900, instructions: 5, cycles: 10 }], { enabled: false }),
    });
    expect(result.status).toBe('profiler-off');
    expect(result.executedRows).toBe(0);
  });

  it('refuses to attribute coverage when the machine reports no loaded program', () => {
    const result = correlateRuntimeCoverage({
      analysis, analysedSha256: DIGEST, programManifest: null,
      profiler: profiler([{ address: 0x1900, instructions: 5, cycles: 10 }]),
    });
    expect(result.status).toBe('no-program');
  });

  it('refuses to overlay coverage from a different program, naming what is running', () => {
    const result = correlateRuntimeCoverage({
      analysis, analysedSha256: DIGEST, programManifest: manifest({ outputSha256: OTHER_DIGEST, name: 'game.bin' }),
      profiler: profiler([{ address: 0x1900, instructions: 5, cycles: 10 }]),
    });
    expect(result.status).toBe('different-program');
    expect(result.reason).toContain('game.bin');
    expect(result.entries.size).toBe(0);
  });

  it('refuses when the same bytes were loaded somewhere else, and says where', () => {
    const result = correlateRuntimeCoverage({
      analysis, analysedSha256: DIGEST, programManifest: manifest({ origin: 0x2000 }),
      profiler: profiler([{ address: 0x2000, instructions: 5, cycles: 10 }]),
    });
    expect(result.status).toBe('different-origin');
    expect(result.reason).toContain('&2000');
    expect(result.reason).toContain('&1900');
  });

  it('binds coverage when the digest and load address both match', () => {
    const result = correlateRuntimeCoverage({
      analysis, analysedSha256: DIGEST.toUpperCase(), programManifest: manifest(),
      profiler: profiler([
        { address: 0x1900, instructions: 3, cycles: 6 },
        { address: 0x1902, instructions: 3, cycles: 15 },
      ]),
    });
    expect(result.status).toBe('bound');
    expect(result.executedRows).toBe(2);
    expect(result.entries.get(0x1902)).toEqual({ address: 0x1902, instructions: 3, cycles: 15 });
    expect(result.reason).toContain('live jsbeeb instruction hook');
  });

  it('counts reachable rows the machine never reached, keeping the two kinds of evidence apart', () => {
    const result = correlateRuntimeCoverage({
      analysis, analysedSha256: DIGEST, programManifest: manifest(),
      profiler: profiler([{ address: 0x1900, instructions: 1, cycles: 2 }]),
    });
    expect(result.executedRows).toBe(1);
    expect(result.reachableNeverExecuted).toBeGreaterThan(0);
    expect(result.summary).toContain('reachable but never reached');
  });

  it('reports execution of bytes static analysis did not call code, rather than reclassifying them', () => {
    /* &1905 is only reachable through the pointer, so the listing calls it
     * data. The machine executing it is exactly the finding worth surfacing. */
    const dataRow = analysis.rows.find((row) => row.address === 0x1905);
    expect(dataRow?.kind).not.toBe('instruction');
    const result = correlateRuntimeCoverage({
      analysis, analysedSha256: DIGEST, programManifest: manifest(),
      profiler: profiler([{ address: 0x1905, instructions: 2, cycles: 4 }]),
    });
    expect(result.executedOutsideStaticCode).toBeGreaterThan(0);
    expect(result.summary).toContain('static analysis did not call code');
  });

  it('counts profiler samples outside the analysed file separately instead of dropping them', () => {
    const result = correlateRuntimeCoverage({
      analysis, analysedSha256: DIGEST, programManifest: manifest(),
      profiler: profiler([
        { address: 0x1900, instructions: 1, cycles: 2 },
        { address: 0xffee, instructions: 40, cycles: 90 },
      ]),
    });
    expect(result.entriesOutsideFile).toBe(1);
    expect(result.summary).toContain('1 sample outside this file');
  });

  it('carries the profiler\'s own unattributed count into the summary', () => {
    const result = correlateRuntimeCoverage({
      analysis, analysedSha256: DIGEST, programManifest: manifest(),
      profiler: profiler([{ address: 0x1900, instructions: 1, cycles: 2 }], { untrackedInstructions: 12 }),
    });
    expect(result.summary).toContain('12 instructions the profiler could not attribute');
  });

  it('labels a row only when the correlation is bound, and says plainly when a row was not seen', () => {
    const bound = correlateRuntimeCoverage({
      analysis, analysedSha256: DIGEST, programManifest: manifest(),
      profiler: profiler([{ address: 0x1900, instructions: 3, cycles: 6 }]),
    });
    expect(rowCoverageLabel(bound, 0x1900, 2)).toBe('3 × · 6 cycles');
    expect(rowCoverageLabel(bound, 0x1902, 3)).toBe('not observed executing');

    const refused = correlateRuntimeCoverage({ analysis, analysedSha256: DIGEST, programManifest: manifest(), profiler: null });
    expect(rowCoverageLabel(refused, 0x1900, 2)).toBeNull();
  });

  it('sums samples that fall inside one multi-byte row', () => {
    const bound = correlateRuntimeCoverage({
      analysis, analysedSha256: DIGEST, programManifest: manifest(),
      profiler: profiler([
        { address: 0x1902, instructions: 2, cycles: 10 },
        { address: 0x1903, instructions: 1, cycles: 5 },
      ]),
    });
    expect(rowCoverageLabel(bound, 0x1902, 3)).toBe('3 × · 15 cycles');
    expect(bound.executedRows).toBe(1);
  });
});
