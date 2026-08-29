import { describe, expect, it } from 'vitest';
import { estimate6502Cycles, formatCycleEstimate, validateLiveDisassemblyRequest } from './liveDisassemblyModel';

describe('live disassembly model', () => {
  it('accepts bounded requests and rejects wrapping-domain abuse', () => {
    expect(validateLiveDisassemblyRequest({ address: 0xffff, instructionCount: 256, requestId: 'view-1' }).address).toBe(0xffff);
    expect(() => validateLiveDisassemblyRequest({ address: -1, instructionCount: 1, requestId: 'x' })).toThrow(/16-bit/);
    expect(() => validateLiveDisassemblyRequest({ address: 0, instructionCount: 257, requestId: 'x' })).toThrow(/1–256/);
    expect(() => validateLiveDisassemblyRequest({ address: 0, instructionCount: 1, requestId: '' })).toThrow(/request ID/);
  });

  it('reports honest fixed or ranged 6502-family cycle estimates', () => {
    expect(formatCycleEstimate(estimate6502Cycles('JSR', 'Absolute'))).toBe('6');
    expect(formatCycleEstimate(estimate6502Cycles('BNE', 'PC-relative branch'))).toBe('2–4');
    expect(formatCycleEstimate(estimate6502Cycles('LDA', 'Absolute, X'))).toBe('4–5');
    expect(formatCycleEstimate(estimate6502Cycles('STA', 'Indirect indexed, Y'))).toBe('6');
  });
});
