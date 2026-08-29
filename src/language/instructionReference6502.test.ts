import { describe, expect, it } from 'vitest';
import { instructionLanguageItem } from './instructionReference6502';

describe('6502 instruction reference', () => {
  it('derives supported syntax and cycle variability from the real opcode table', () => {
    const branch = instructionLanguageItem('BNE', '6502')!;
    expect(branch.signature).toBe('BNE label');
    expect(branch.documentation).toMatchObject({
      flags: [],
      cycles: [{ form: 'PC-relative branch', minimum: 2, maximum: 4, variability: expect.stringMatching(/not taken.*page/i) }],
      compatibility: { supported: true, appliesTo: expect.arrayContaining(['NMOS 6502', '65C12 subset used by BBC Master']) },
      citations: [expect.objectContaining({ title: 'W65C02S Datasheet', section: expect.stringContaining('4-1'), version: '2024-02-15' })],
    });
    expect(branch.source?.version).toMatch(/^wdc-w65c02s-/);
  });

  it('reports target incompatibility instead of hiding known CMOS instructions', () => {
    const incompatible = instructionLanguageItem('STZ', '6502')!;
    expect(incompatible.documentation?.compatibility).toMatchObject({ supported: false, warning: expect.stringMatching(/not available.*NMOS 6502/i) });
    expect(incompatible.signature).toMatch(/STZ zp/);
    expect(instructionLanguageItem('STZ', '65c02')?.documentation?.compatibility?.supported).toBe(true);
  });

  it('documents flags, memory effects and processor-specific indirect JMP behavior', () => {
    const load = instructionLanguageItem('LDA', '6502')!;
    expect(load.documentation?.flags).toEqual(['N', 'Z']);
    expect(load.documentation?.cycles).toEqual(expect.arrayContaining([expect.objectContaining({ form: 'Absolute, X', minimum: 4, maximum: 5 })]));
    const nmosJump = instructionLanguageItem('JMP', '6502')!;
    expect(nmosJump.documentation?.compatibility?.warning).toMatch(/wraps.*page boundary/i);
    expect(nmosJump.documentation?.cycles).toEqual(expect.arrayContaining([expect.objectContaining({ form: 'Absolute indirect', minimum: 5, maximum: 5 })]));
    const cmosJump = instructionLanguageItem('JMP', '65c02')!;
    expect(cmosJump.documentation?.cycles).toEqual(expect.arrayContaining([expect.objectContaining({ form: 'Absolute indirect', minimum: 6, maximum: 6 })]));
  });
});
