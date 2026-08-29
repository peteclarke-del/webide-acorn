import { describe, expect, it } from 'vitest';
import { decodeInstructionState } from './instructionState';

const memory = (entries: Record<number, number>) => (address: number) => entries[address & 0xffff] ?? 0;

describe('live 6502 instruction state', () => {
  it('resolves indexed and zero-page indirect effective addresses without memory side effects', () => {
    const absoluteX = decodeInstructionState({ pc: 0x1900, a: 0, x: 2, y: 0, opcodeSpec: 'LDA abs,x', nmos: true, read: memory({ 0x1900: 0xbd, 0x1901: 0xff, 0x1902: 0x20, 0x2101: 0x41 }) });
    expect(absoluteX).toMatchObject({ opcode: 0xbd, addressingMode: 'Absolute, X', effectiveAddress: 0x2101, operandValue: 0x41, pageCrossed: true, bytes: [0xbd, 0xff, 0x20] });
    const indirectY = decodeInstructionState({ pc: 0x2000, a: 0, x: 0, y: 3, opcodeSpec: 'STA (),y', nmos: false, read: memory({ 0x2000: 0x91, 0x2001: 0xff, 0x00ff: 0xfe, 0x0000: 0x30, 0x3101: 0x55 }) });
    expect(indirectY).toMatchObject({ pointerAddress: 0xff, effectiveAddress: 0x3101, operandValue: 0x55, pageCrossed: true });
  });

  it('reflects the NMOS indirect-JMP page-wrap behavior selected by the actual core', () => {
    const read = memory({ 0x1000: 0x6c, 0x1001: 0xff, 0x1002: 0x20, 0x20ff: 0x34, 0x2000: 0x12, 0x2100: 0x56 });
    expect(decodeInstructionState({ pc: 0x1000, a: 0, x: 0, y: 0, opcodeSpec: 'JMP (abs)', nmos: true, read }).effectiveAddress).toBe(0x1234);
    expect(decodeInstructionState({ pc: 0x1000, a: 0, x: 0, y: 0, opcodeSpec: 'JMP (abs)', nmos: false, read }).effectiveAddress).toBe(0x5634);
  });

  it('reports relative and 65C02 bit-branch targets while leaving implied operations honest', () => {
    expect(decodeInstructionState({ pc: 0x1900, a: 0, x: 0, y: 0, opcodeSpec: 'BNE branch', nmos: true, read: memory({ 0x1900: 0xd0, 0x1901: 0xfc }) }).branchTarget).toBe(0x18fe);
    expect(decodeInstructionState({ pc: 0x1900, a: 0, x: 0, y: 0, opcodeSpec: 'BBR0 zp,branch', nmos: false, read: memory({ 0x1900: 0x0f, 0x1901: 0x44, 0x1902: 0x05, 0x44: 1 }) })).toMatchObject({ effectiveAddress: 0x44, operandValue: 1, branchTarget: 0x1908, length: 3 });
    expect(decodeInstructionState({ pc: 0x1900, a: 0, x: 0, y: 0, opcodeSpec: 'INY', nmos: true, read: memory({ 0x1900: 0xc8 }) })).toMatchObject({ addressingMode: 'Implied', effectiveAddress: undefined, bytes: [0xc8] });
  });
});
