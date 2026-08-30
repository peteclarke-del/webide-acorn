import { opcodeTable, type AddressMode } from '../analysis/disassembler6502';
import type { Processor } from '../analysis/types';
import { estimate6502Cycles } from '../emulator/liveDisassemblyModel';
import type { LanguageItem, LanguageItemDocumentation } from './languageService';

const REFERENCE_VERSION = 'wdc-w65c02s-2024.02+acorn-6502-1';

const descriptions: Record<string, string> = {
  ADC: 'Add the operand and carry flag to the accumulator.', AND: 'AND the operand with the accumulator.', ASL: 'Shift the operand left by one bit; bit 7 moves into carry.',
  BCC: 'Branch when carry is clear.', BCS: 'Branch when carry is set.', BEQ: 'Branch when zero is set.', BIT: 'Test operand bits against the accumulator without changing the accumulator.',
  BMI: 'Branch when negative is set.', BNE: 'Branch when zero is clear.', BPL: 'Branch when negative is clear.', BRA: 'Branch unconditionally (65C02/65C12).',
  BRK: 'Enter the software-interrupt sequence, pushing the return address and status before loading the IRQ/BRK vector.', BVC: 'Branch when overflow is clear.', BVS: 'Branch when overflow is set.',
  CLC: 'Clear carry.', CLD: 'Clear decimal mode.', CLI: 'Clear interrupt disable.', CLV: 'Clear overflow.',
  CMP: 'Compare the accumulator with the operand by performing a non-stored subtraction.', CPX: 'Compare X with the operand.', CPY: 'Compare Y with the operand.',
  DEC: 'Decrement memory or, on 65C02/65C12, the accumulator.', DEX: 'Decrement X.', DEY: 'Decrement Y.', EOR: 'Exclusive-OR the operand with the accumulator.',
  INC: 'Increment memory or, on 65C02/65C12, the accumulator.', INX: 'Increment X.', INY: 'Increment Y.', JMP: 'Load the program counter from the target address.',
  JSR: 'Call a subroutine by pushing the address before the next instruction and loading the target into the program counter.', LDA: 'Load A (the accumulator) from the operand.',
  LDX: 'Load X from the operand.', LDY: 'Load Y from the operand.', LSR: 'Shift the operand right by one bit; bit 0 moves into carry and bit 7 becomes zero.',
  NOP: 'Perform no program-visible operation other than advancing the program counter.', ORA: 'OR the operand with the accumulator.', PHA: 'Push the accumulator onto the hardware stack.',
  PHP: 'Push a status-byte representation onto the hardware stack.', PHX: 'Push X onto the hardware stack (65C02/65C12).', PHY: 'Push Y onto the hardware stack (65C02/65C12).',
  PLA: 'Pull the accumulator from the hardware stack.', PLP: 'Pull the processor status from the hardware stack.', PLX: 'Pull X from the hardware stack (65C02/65C12).',
  PLY: 'Pull Y from the hardware stack (65C02/65C12).', ROL: 'Rotate the operand left through carry.', ROR: 'Rotate the operand right through carry.',
  RTI: 'Return from an interrupt by restoring status and the program counter from the stack.', RTS: 'Return from a subroutine by restoring and incrementing the stacked program counter.',
  SBC: 'Subtract the operand and inverted carry (borrow) from the accumulator.', SEC: 'Set carry.', SED: 'Set decimal mode.', SEI: 'Set interrupt disable.',
  STA: 'Store the accumulator to memory.', STX: 'Store X to memory.', STY: 'Store Y to memory.', STZ: 'Store zero to memory (65C02/65C12).',
  TAX: 'Copy the accumulator to X.', TAY: 'Copy the accumulator to Y.', TRB: 'Test accumulator bits, then reset those bits in memory (65C02/65C12).',
  TSB: 'Test accumulator bits, then set those bits in memory (65C02/65C12).', TSX: 'Copy the stack pointer to X.', TXA: 'Copy X to the accumulator.',
  TXS: 'Copy X to the stack pointer.', TYA: 'Copy Y to the accumulator.',
};

const flags: Record<string, string[]> = {
  ADC: ['N=result bit 7', 'V=signed overflow', 'Z=result is zero', 'C=unsigned carry'], AND: ['N', 'Z'], ASL: ['N', 'Z', 'C=old bit 7'],
  BIT: ['Z=A AND operand is zero', 'N=operand bit 7 except immediate', 'V=operand bit 6 except immediate'], BRK: ['I=set after status push'],
  CLC: ['C=0'], CLD: ['D=0'], CLI: ['I=0'], CLV: ['V=0'], CMP: ['N', 'Z', 'C=A ≥ operand'], CPX: ['N', 'Z', 'C=X ≥ operand'], CPY: ['N', 'Z', 'C=Y ≥ operand'],
  DEC: ['N', 'Z'], DEX: ['N', 'Z'], DEY: ['N', 'Z'], EOR: ['N', 'Z'], INC: ['N', 'Z'], INX: ['N', 'Z'], INY: ['N', 'Z'],
  LDA: ['N', 'Z'], LDX: ['N', 'Z'], LDY: ['N', 'Z'], LSR: ['N=0', 'Z', 'C=old bit 0'], ORA: ['N', 'Z'], PLA: ['N', 'Z'],
  PLP: ['N,V,D,I,Z,C restored'], PLX: ['N', 'Z'], PLY: ['N', 'Z'], ROL: ['N', 'Z', 'C=old bit 7'], ROR: ['N', 'Z', 'C=old bit 0'],
  RTI: ['N,V,D,I,Z,C restored'], SBC: ['N', 'V=signed overflow', 'Z', 'C=no borrow'], SEC: ['C=1'], SED: ['D=1'], SEI: ['I=1'],
  TAX: ['N', 'Z'], TAY: ['N', 'Z'], TRB: ['Z=A AND old memory is zero'], TSB: ['Z=A AND old memory is zero'], TSX: ['N', 'Z'], TXA: ['N', 'Z'], TYA: ['N', 'Z'],
};

const effects: Record<string, string[]> = {
  ADC: ['Reads A, carry and operand; writes A. Decimal-mode arithmetic differs between NMOS 6502 and CMOS 65C02.'], SBC: ['Reads A, carry and operand; writes A. Decimal-mode arithmetic differs between NMOS 6502 and CMOS 65C02.'],
  BRK: ['Writes PC and status to stack page &0100; reads vector &FFFE–&FFFF; consumes a signature/padding byte.'], JSR: ['Writes a two-byte return address to stack page &0100.'],
  RTS: ['Reads a two-byte return address from stack page &0100.'], RTI: ['Reads status and a two-byte return address from stack page &0100.'],
  PHA: ['Writes A to stack page &0100 and decrements S.'], PHP: ['Writes status to stack page &0100 and decrements S.'], PHX: ['Writes X to stack page &0100 and decrements S.'], PHY: ['Writes Y to stack page &0100 and decrements S.'],
  PLA: ['Increments S and reads A from stack page &0100.'], PLP: ['Increments S and reads status from stack page &0100.'], PLX: ['Increments S and reads X from stack page &0100.'], PLY: ['Increments S and reads Y from stack page &0100.'],
  JMP: ['Writes PC; indirect forms read the destination pointer from memory. NMOS JMP (&xxFF) wraps the high-byte read within the page; 65C02 fixes this.'],
  TRB: ['Reads then writes memory; the write clears every bit selected by A.'], TSB: ['Reads then writes memory; the write sets every bit selected by A.'],
};

const related: Record<string, string[]> = {
  ADC: ['SBC', 'CLC', 'SEC', 'SED'], SBC: ['ADC', 'CLC', 'SEC', 'SED'], ASL: ['LSR', 'ROL', 'ROR'], LSR: ['ASL', 'ROL', 'ROR'], ROL: ['ROR', 'ASL'], ROR: ['ROL', 'LSR'],
  BIT: ['TRB', 'TSB'], TRB: ['BIT', 'TSB'], TSB: ['BIT', 'TRB'], JSR: ['RTS', 'JMP'], RTS: ['JSR'], BRK: ['RTI'], RTI: ['BRK'],
  LDA: ['STA', 'LDX', 'LDY'], LDX: ['STX', 'LDA'], LDY: ['STY', 'LDA'], STA: ['LDA', 'STZ'], STZ: ['STA'], CMP: ['CPX', 'CPY', 'SBC'],
};

const modeMetadata: Record<AddressMode, { name: string; operand: string; example: string }> = {
  imp: { name: 'Implied', operand: '', example: '' }, acc: { name: 'Accumulator', operand: 'A', example: 'A' }, imm: { name: 'Immediate', operand: '#value', example: '#&20' },
  zp: { name: 'Zero page', operand: 'zp', example: '&70' }, zpx: { name: 'Zero page, X', operand: 'zp,X', example: '&70,X' }, zpy: { name: 'Zero page, Y', operand: 'zp,Y', example: '&70,Y' },
  indx: { name: 'Indexed indirect, X', operand: '(zp,X)', example: '(&70,X)' }, indy: { name: 'Indirect indexed, Y', operand: '(zp),Y', example: '(&70),Y' }, zpi: { name: 'Zero-page indirect', operand: '(zp)', example: '(&70)' },
  rel: { name: 'PC-relative branch', operand: 'label', example: 'loop' }, abs: { name: 'Absolute', operand: 'address', example: '&4000' }, absx: { name: 'Absolute, X', operand: 'address,X', example: '&4000,X' },
  absy: { name: 'Absolute, Y', operand: 'address,Y', example: '&4000,Y' }, ind: { name: 'Absolute indirect', operand: '(address)', example: '(&4000)' }, iax: { name: 'Absolute indexed indirect, X', operand: '(address,X)', example: '(&4000,X)' },
};

export function instructionLanguageItem(token: string, processor: Processor): LanguageItem | undefined {
  const mnemonic = token.toUpperCase();
  const allModes = modesFor(mnemonic, '65c02');
  if (!allModes.length) return undefined;
  const modes = modesFor(mnemonic, processor);
  const cmosOnly = !modesFor(mnemonic, '6502').length;
  const supported = modes.length > 0;
  const documentedModes = (supported ? modes : allModes).map((mode) => cycleForm(mnemonic, mode, processor));
  const syntax = documentedModes.map((form) => `${mnemonic}${form.operand ? ` ${form.operand}` : ''}`).join(' | ');
  const documentation: LanguageItemDocumentation = {
    category: cmosOnly ? '65C02/65C12 instruction' : '6502-family instruction',
    parameters: documentedModes.some((form) => form.operand) ? [{ name: 'operand', detail: 'Address, value, accumulator or branch label according to the selected addressing form.', range: '8-bit immediate/zero-page or 16-bit address; relative branches must assemble within range.' }] : [],
    result: resultFor(mnemonic),
    examples: documentedModes.slice(0, 3).map((form) => `${mnemonic}${form.example ? ` ${form.example}` : ''}`),
    sideEffects: effects[mnemonic] ?? defaultEffects(mnemonic),
    flags: flags[mnemonic] ?? [],
    cycles: documentedModes.map(({ name, minimum, maximum, variability }) => ({ form: name, minimum, maximum, variability })),
    compatibility: {
      supported,
      appliesTo: cmosOnly ? ['65C02', '65C12 subset used by BBC Master'] : ['NMOS 6502', '65C02', '65C12 subset used by BBC Master'],
      warning: supported ? compatibilityWarning(mnemonic, processor) : `${mnemonic} is not available on the selected NMOS 6502 target. Select a 65C02/65C12 machine or replace the instruction.`,
    },
    related: related[mnemonic] ?? [],
    citations: [{ title: 'W65C02S Datasheet', url: 'https://www.westerndesigncenter.com/documentation/w65c02s.pdf', section: 'Section 4; Tables 4-1 and 4-2', version: '2024-02-15' }],
  };
  return {
    token: mnemonic, kind: 'opcode', detail: descriptions[mnemonic] ?? `${mnemonic} is a documented 6502-family instruction.`, signature: syntax,
    languages: ['6502'], parameters: documentation.parameters?.map((parameter) => parameter.name), documentation,
    source: { kind: 'builtin', label: 'WDC W65C02S Datasheet · §4', version: REFERENCE_VERSION },
  };
}

function modesFor(mnemonic: string, processor: Processor) {
  return Array.from(new Set(opcodeTable(processor).flatMap((opcode) => opcode?.mnemonic === mnemonic ? [opcode.mode] : [])));
}

function cycleForm(mnemonic: string, mode: AddressMode, processor: Processor) {
  const metadata = modeMetadata[mode];
  let estimate = estimate6502Cycles(mnemonic, metadata.name);
  if (['ASL', 'LSR', 'ROL', 'ROR', 'INC', 'DEC', 'TSB', 'TRB'].includes(mnemonic) && mode === 'absx') estimate = processor === '6502' ? { minimum: 7, maximum: 7 } : { minimum: 6, maximum: 6 };
  if (mnemonic === 'JMP' && mode === 'ind') estimate = processor === '6502' ? { minimum: 5, maximum: 5 } : { minimum: 6, maximum: 6 };
  if (mode === 'iax') estimate = { minimum: 6, maximum: 6 };
  if (mode === 'zpi') estimate = { minimum: 5, maximum: 5 };
  const variability = mode === 'rel' ? (mnemonic === 'BRA' ? '3 cycles; add 1 when the destination crosses a page.' : '2 cycles not taken; add 1 when taken and another when a taken branch crosses a page.')
    : estimate.minimum !== estimate.maximum ? 'Maximum applies when indexed address formation crosses a page; store timings remain fixed.' : undefined;
  return { ...metadata, ...estimate, variability };
}

function resultFor(mnemonic: string) {
  if (['ADC', 'AND', 'EOR', 'LDA', 'LSR', 'ORA', 'PLA', 'ROL', 'ROR', 'SBC', 'TXA', 'TYA'].includes(mnemonic)) return 'Accumulator and/or status flags are updated as described.';
  if (['LDX', 'PLX', 'TAX', 'TSX'].includes(mnemonic)) return 'X and status flags are updated.';
  if (['LDY', 'PLY', 'TAY'].includes(mnemonic)) return 'Y and status flags are updated.';
  if (['STA', 'STX', 'STY', 'STZ', 'TRB', 'TSB'].includes(mnemonic)) return 'The addressed memory location is written.';
  if (/^B/.test(mnemonic) || ['JMP', 'JSR', 'RTI', 'RTS'].includes(mnemonic)) return 'Program control may continue at a different address.';
  return 'See the flag and side-effect fields for program-visible results.';
}

function defaultEffects(mnemonic: string) {
  if (['STA', 'STX', 'STY', 'STZ'].includes(mnemonic)) return ['Writes the selected register value (or zero) to the effective memory address.'];
  if (['ASL', 'DEC', 'INC', 'LSR', 'ROL', 'ROR'].includes(mnemonic)) return ['Accumulator form writes the accumulator; memory forms perform a read-modify-write at the effective address.'];
  if (/^B(?:CC|CS|EQ|MI|NE|PL|VC|VS|RA)$/.test(mnemonic)) return ['Reads the relevant status condition and may write PC; no general-purpose register or memory operand is changed.'];
  return [];
}

function compatibilityWarning(mnemonic: string, processor: Processor) {
  if (mnemonic === 'JMP') return processor === '6502' ? 'NMOS indirect JMP wraps the pointer high-byte read at a page boundary.' : 'CMOS indirect JMP fixes the NMOS page-boundary wrap behavior and takes one additional cycle.';
  if (['ADC', 'SBC'].includes(mnemonic)) return 'Decimal-mode flags and interrupt decimal-state behavior differ between NMOS 6502 and CMOS derivatives; verify target-specific code.';
  return undefined;
}
