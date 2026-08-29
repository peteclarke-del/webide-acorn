import { describe, expect, it } from 'vitest';
import { assemble6502 } from '../build/assembler6502';
import { Cpu6502Runtime } from './cpu6502';

describe('6502 debug runtime', () => {
  it('executes code, traps supported MOS output and records source-linked trace', () => {
    const artifact = assemble6502(`ORG &1900\n.start\n LDA #'A'\n JSR OSWRCH\n LDA #13\n JSR OSASCI\n BRK`);
    expect(artifact.diagnostics).toEqual([]);
    const cpu = new Cpu6502Runtime(); cpu.load(artifact);
    const state = cpu.run();
    expect(state.status).toBe('halted');
    expect(state.output).toBe('A\r\n');
    expect(state.instructions).toBe(5);
    expect(state.trace[0]?.sourceLine).toBe(3);
  });

  it('steps and stops before executing a breakpoint address', () => {
    const artifact = assemble6502(`ORG &2000\n.start\n LDX #1\n INX\n BRK`);
    const cpu = new Cpu6502Runtime(); cpu.load(artifact);
    expect(cpu.step().registers.x).toBe(1);
    cpu.setBreakpoint(0x2002);
    const state = cpu.run();
    expect(state.status).toBe('breakpoint');
    expect(state.registers.pc).toBe(0x2002);
    expect(cpu.run().status).toBe('halted');
  });

  it('executes memory, arithmetic, branch and subroutine operations', () => {
    const artifact = assemble6502(`ORG &3000\n.start\n LDA #2\n STA &70\n JSR add\n CMP #5\n BNE fail\n BRK\n.fail\n LDA #&FF\n BRK\n.add\n CLC\n ADC #3\n RTS`);
    const cpu = new Cpu6502Runtime(); cpu.load(artifact);
    const state = cpu.run();
    expect(state.registers.a).toBe(5);
    expect(cpu.memory[0x70]).toBe(2);
    expect(state.status).toBe('halted');
  });
});
