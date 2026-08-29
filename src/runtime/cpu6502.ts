import { opcodeTable, type AddressMode, type Opcode } from '../analysis/disassembler6502';
import type { Processor } from '../analysis/types';
import type { AssemblyArtifact } from '../build/assembler6502';

export interface CpuRegisters { a: number; x: number; y: number; sp: number; pc: number; p: number; }
export interface TraceEntry { address: number; bytes: number[]; instruction: string; registers: CpuRegisters; sourceLine?: number; }
export interface CpuSnapshot {
  registers: CpuRegisters;
  status: 'ready' | 'paused' | 'breakpoint' | 'halted' | 'fault';
  reason: string;
  instructions: number;
  output: string;
  trace: TraceEntry[];
}

const C = 0x01, Z = 0x02, I = 0x04, D = 0x08, B = 0x10, U = 0x20, V = 0x40, N = 0x80;
const BRANCH_CONDITION: Record<string, (p: number) => boolean> = {
  BCC: (p) => !(p & C), BCS: (p) => !!(p & C), BEQ: (p) => !!(p & Z),
  BMI: (p) => !!(p & N), BNE: (p) => !(p & Z), BPL: (p) => !(p & N),
  BVC: (p) => !(p & V), BVS: (p) => !!(p & V), BRA: () => true,
};

export class Cpu6502Runtime {
  readonly memory = new Uint8Array(0x10000);
  readonly breakpoints = new Set<number>();
  private sourceMap: Record<number, number> = {};
  private table: Array<Opcode | undefined>;
  private processor: Processor;
  private initialMemory = new Uint8Array(0x10000);
  private entryPoint = 0;
  private r: CpuRegisters = { a: 0, x: 0, y: 0, sp: 0xfd, pc: 0, p: U | I };
  private status: CpuSnapshot['status'] = 'ready';
  private reason = 'Program loaded';
  private instructions = 0;
  private output = '';
  private trace: TraceEntry[] = [];

  constructor(processor: Processor = '6502') {
    this.processor = processor;
    this.table = opcodeTable(processor);
  }

  load(artifact: AssemblyArtifact) {
    this.processor = artifact.processor;
    this.table = opcodeTable(artifact.processor);
    this.memory.fill(0);
    this.memory.set(artifact.bytes, artifact.origin);
    this.initialMemory = this.memory.slice();
    this.entryPoint = artifact.entryPoint;
    this.sourceMap = artifact.sourceMap;
    this.reset();
  }

  reset(): CpuSnapshot {
    this.memory.set(this.initialMemory);
    this.r = { a: 0, x: 0, y: 0, sp: 0xfd, pc: this.entryPoint, p: U | I };
    this.status = 'paused'; this.reason = 'Reset at entry point'; this.instructions = 0; this.output = ''; this.trace = [];
    return this.snapshot();
  }

  snapshot(): CpuSnapshot {
    return { registers: { ...this.r }, status: this.status, reason: this.reason, instructions: this.instructions, output: this.output, trace: [...this.trace] };
  }

  setBreakpoint(address: number, enabled = true) { if (enabled) this.breakpoints.add(address & 0xffff); else this.breakpoints.delete(address & 0xffff); }

  run(limit = 100_000): CpuSnapshot {
    const resumeFromBreakpoint = this.status === 'breakpoint';
    this.status = 'ready'; this.reason = 'Running';
    for (let count = 0; count < limit && this.status === 'ready'; count += 1) {
      if (this.breakpoints.has(this.r.pc) && !(resumeFromBreakpoint && count === 0)) { this.status = 'breakpoint'; this.reason = `Breakpoint at ${hex(this.r.pc)}`; break; }
      this.executeOne();
    }
    if (this.status === 'ready') { this.status = 'paused'; this.reason = `Instruction budget reached (${limit.toLocaleString()})`; }
    return this.snapshot();
  }

  step(): CpuSnapshot {
    if (this.status === 'halted' || this.status === 'fault') return this.snapshot();
    this.status = 'ready'; this.executeOne();
    if (this.status === 'ready') { this.status = 'paused'; this.reason = 'Instruction step complete'; }
    return this.snapshot();
  }

  pause(): CpuSnapshot { if (this.status === 'ready') { this.status = 'paused'; this.reason = 'Paused by user'; } return this.snapshot(); }

  private executeOne() {
    const start = this.r.pc;
    const opcodeByte = this.read(start);
    const opcode = this.table[opcodeByte];
    if (!opcode) { this.status = 'fault'; this.reason = `Unsupported opcode $${opcodeByte.toString(16).padStart(2, '0')} at ${hex(start)}`; return; }
    const instructionBytes = Array.from(this.memory.slice(start, start + opcode.size));
    this.r.pc = (this.r.pc + opcode.size) & 0xffff;
    const operand = this.operand(opcode.mode, start);
    const before = { ...this.r, pc: start };
    const mnemonic = opcode.mnemonic;

    if (BRANCH_CONDITION[mnemonic]) {
      if (BRANCH_CONDITION[mnemonic]!(this.r.p)) this.r.pc = operand.address!;
    } else switch (mnemonic) {
      case 'ADC': this.adc(operand.value!); break;
      case 'AND': this.r.a = this.nz(this.r.a & operand.value!); break;
      case 'ASL': this.shift(operand, (value) => { this.flag(C, !!(value & 0x80)); return value << 1; }); break;
      case 'BIT': this.flag(Z, !(this.r.a & operand.value!)); if (opcode.mode !== 'imm') { this.flag(N, !!(operand.value! & N)); this.flag(V, !!(operand.value! & V)); } break;
      case 'BRK': this.status = 'halted'; this.reason = `BRK at ${hex(start)}`; break;
      case 'CLC': this.flag(C, false); break; case 'CLD': this.flag(D, false); break; case 'CLI': this.flag(I, false); break; case 'CLV': this.flag(V, false); break;
      case 'CMP': this.compare(this.r.a, operand.value!); break; case 'CPX': this.compare(this.r.x, operand.value!); break; case 'CPY': this.compare(this.r.y, operand.value!); break;
      case 'DEC': if (opcode.mode === 'acc') this.r.a = this.nz(this.r.a - 1); else this.write(operand.address!, this.nz(operand.value! - 1)); break;
      case 'DEX': this.r.x = this.nz(this.r.x - 1); break; case 'DEY': this.r.y = this.nz(this.r.y - 1); break;
      case 'EOR': this.r.a = this.nz(this.r.a ^ operand.value!); break;
      case 'INC': if (opcode.mode === 'acc') this.r.a = this.nz(this.r.a + 1); else this.write(operand.address!, this.nz(operand.value! + 1)); break;
      case 'INX': this.r.x = this.nz(this.r.x + 1); break; case 'INY': this.r.y = this.nz(this.r.y + 1); break;
      case 'JMP': this.r.pc = operand.address!; break;
      case 'JSR': if (!this.mosCall(operand.address!)) { const returnAddress = (this.r.pc - 1) & 0xffff; this.push(returnAddress >>> 8); this.push(returnAddress); this.r.pc = operand.address!; } break;
      case 'LDA': this.r.a = this.nz(operand.value!); break; case 'LDX': this.r.x = this.nz(operand.value!); break; case 'LDY': this.r.y = this.nz(operand.value!); break;
      case 'LSR': this.shift(operand, (value) => { this.flag(C, !!(value & 1)); return value >>> 1; }); break;
      case 'NOP': break;
      case 'ORA': this.r.a = this.nz(this.r.a | operand.value!); break;
      case 'PHA': this.push(this.r.a); break; case 'PHP': this.push(this.r.p | B | U); break; case 'PHX': this.push(this.r.x); break; case 'PHY': this.push(this.r.y); break;
      case 'PLA': this.r.a = this.nz(this.pop()); break; case 'PLP': this.r.p = this.pop() | U; break; case 'PLX': this.r.x = this.nz(this.pop()); break; case 'PLY': this.r.y = this.nz(this.pop()); break;
      case 'ROL': this.shift(operand, (value) => { const carry = this.r.p & C; this.flag(C, !!(value & 0x80)); return value << 1 | carry; }); break;
      case 'ROR': this.shift(operand, (value) => { const carry = this.r.p & C ? 0x80 : 0; this.flag(C, !!(value & 1)); return value >>> 1 | carry; }); break;
      case 'RTI': this.r.p = this.pop() | U; this.r.pc = this.pop() | this.pop() << 8; break;
      case 'RTS': if (this.r.sp === 0xfd) { this.status = 'halted'; this.reason = `RTS returned from entry point at ${hex(start)}`; } else this.r.pc = ((this.pop() | this.pop() << 8) + 1) & 0xffff; break;
      case 'SBC': this.adc(operand.value! ^ 0xff); break;
      case 'SEC': this.flag(C, true); break; case 'SED': this.flag(D, true); break; case 'SEI': this.flag(I, true); break;
      case 'STA': this.write(operand.address!, this.r.a); break; case 'STX': this.write(operand.address!, this.r.x); break; case 'STY': this.write(operand.address!, this.r.y); break; case 'STZ': this.write(operand.address!, 0); break;
      case 'TAX': this.r.x = this.nz(this.r.a); break; case 'TAY': this.r.y = this.nz(this.r.a); break; case 'TSX': this.r.x = this.nz(this.r.sp); break;
      case 'TXA': this.r.a = this.nz(this.r.x); break; case 'TXS': this.r.sp = this.r.x; break; case 'TYA': this.r.a = this.nz(this.r.y); break;
      case 'TRB': this.flag(Z, !(this.r.a & operand.value!)); this.write(operand.address!, operand.value! & ~this.r.a); break;
      case 'TSB': this.flag(Z, !(this.r.a & operand.value!)); this.write(operand.address!, operand.value! | this.r.a); break;
      default: this.status = 'fault'; this.reason = `${mnemonic} execution is not implemented`; break;
    }
    this.instructions += 1;
    this.trace.push({ address: start, bytes: instructionBytes, instruction: `${mnemonic}${formatOperand(opcode.mode, instructionBytes, start)}`, registers: before, sourceLine: this.sourceMap[start] });
    if (this.trace.length > 256) this.trace.shift();
  }

  private operand(mode: AddressMode, instructionAddress: number): { address?: number; value?: number } {
    const byte = this.read(instructionAddress + 1); const word = byte | this.read(instructionAddress + 2) << 8;
    let address: number | undefined;
    switch (mode) {
      case 'imm': return { value: byte };
      case 'acc': return { value: this.r.a };
      case 'zp': address = byte; break; case 'zpx': address = byte + this.r.x & 0xff; break; case 'zpy': address = byte + this.r.y & 0xff; break;
      case 'abs': address = word; break; case 'absx': address = word + this.r.x & 0xffff; break; case 'absy': address = word + this.r.y & 0xffff; break;
      case 'indx': { const pointer = byte + this.r.x & 0xff; address = this.read(pointer) | this.read(pointer + 1 & 0xff) << 8; break; }
      case 'indy': address = (this.read(byte) | this.read(byte + 1 & 0xff) << 8) + this.r.y & 0xffff; break;
      case 'zpi': address = this.read(byte) | this.read(byte + 1 & 0xff) << 8; break;
      case 'rel': address = (instructionAddress + 2 + (byte < 0x80 ? byte : byte - 0x100)) & 0xffff; break;
      case 'ind': { const highAddress = this.processor === '6502' ? (word & 0xff00) | (word + 1 & 0xff) : word + 1 & 0xffff; address = this.read(word) | this.read(highAddress) << 8; break; }
      case 'iax': { const pointer = word + this.r.x & 0xffff; address = this.read(pointer) | this.read(pointer + 1 & 0xffff) << 8; break; }
      default: break;
    }
    return address === undefined ? {} : { address, value: this.read(address) };
  }

  private adc(value: number) {
    const a = this.r.a; const carry = this.r.p & C ? 1 : 0; const binary = a + value + carry;
    this.flag(V, !!(~(a ^ value) & (a ^ binary) & 0x80));
    if (this.r.p & D) {
      let low = (a & 0x0f) + (value & 0x0f) + carry; let high = (a >>> 4) + (value >>> 4);
      if (low > 9) { low += 6; high += 1; } if (high > 9) high += 6;
      this.flag(C, high > 15); this.r.a = this.nz((high << 4 | low & 0x0f) & 0xff);
    } else { this.flag(C, binary > 0xff); this.r.a = this.nz(binary); }
  }
  private compare(register: number, value: number) { const result = register - value; this.flag(C, register >= value); this.nz(result); }
  private shift(operand: { address?: number; value?: number }, operation: (value: number) => number) { const result = this.nz(operation(operand.value!) & 0xff); if (operand.address === undefined) this.r.a = result; else this.write(operand.address, result); }
  private nz(value: number): number { value &= 0xff; this.flag(Z, value === 0); this.flag(N, !!(value & 0x80)); return value; }
  private flag(flag: number, enabled: boolean) { this.r.p = enabled ? this.r.p | flag : this.r.p & ~flag; this.r.p |= U; }
  private read(address: number) { return this.memory[address & 0xffff]!; }
  private write(address: number, value: number) { this.memory[address & 0xffff] = value & 0xff; }
  private push(value: number) { this.write(0x100 | this.r.sp, value); this.r.sp = this.r.sp - 1 & 0xff; }
  private pop() { this.r.sp = this.r.sp + 1 & 0xff; return this.read(0x100 | this.r.sp); }
  private mosCall(address: number): boolean {
    if (address === 0xffee || address === 0xffe3 || address === 0xffbc) { this.output += String.fromCharCode(this.r.a); if (address === 0xffe3 && this.r.a === 13) this.output += '\n'; return true; }
    if (address === 0xffe7) { this.output += '\n'; return true; }
    return false;
  }
}

function formatOperand(mode: AddressMode, bytes: number[], address: number): string {
  if (mode === 'imp') return ''; if (mode === 'acc') return ' A';
  const byte = bytes[1] ?? 0; const word = byte | (bytes[2] ?? 0) << 8;
  if (mode === 'imm') return ` #$${byte.toString(16).padStart(2, '0')}`;
  if (mode === 'rel') return ` ${hex(address + 2 + (byte < 0x80 ? byte : byte - 0x100) & 0xffff)}`;
  return ` ${modeSize(mode) === 2 ? '$' + byte.toString(16).padStart(2, '0') : hex(word)}`;
}
function modeSize(mode: AddressMode) { return ['abs', 'absx', 'absy', 'ind', 'iax'].includes(mode) ? 3 : ['imp', 'acc'].includes(mode) ? 1 : 2; }
function hex(value: number) { return `$${(value & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`; }
