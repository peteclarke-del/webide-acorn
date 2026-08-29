import type { LanguageItem } from './languageService';

const VERSION = 'arm2-isa+gnu-as-2026.08.1';
const citation = [{ title: 'Arm Architecture Reference Manual · legacy 32-bit instruction set', url: 'https://developer.arm.com/documentation/ddi0100/latest/', section: 'ARM instruction set', version: 'DDI 0100' }];

const instructions: Record<string, { detail: string; signature: string; parameters?: string[]; result: string; flags?: string[]; examples: string[] }> = {
  ADC: { detail: 'Add two operands and the carry input.', signature: 'ADC{cond}{S} Rd, Rn, operand2', parameters: ['Rd', 'Rn', 'operand2'], result: 'Writes Rn + operand2 + C to Rd.', flags: ['N, Z, C, V when S is present'], examples: ['ADCS r0, r1, r2'] },
  ADD: { detail: 'Add a register and a shifted-register or immediate operand.', signature: 'ADD{cond}{S} Rd, Rn, operand2', parameters: ['Rd', 'Rn', 'operand2'], result: 'Writes Rn + operand2 to Rd.', flags: ['N, Z, C, V when S is present'], examples: ['ADD r1, r0, #4'] },
  AND: { detail: 'Bitwise AND two operands.', signature: 'AND{cond}{S} Rd, Rn, operand2', parameters: ['Rd', 'Rn', 'operand2'], result: 'Writes Rn AND operand2 to Rd.', flags: ['N, Z and shifter carry when S is present'], examples: ['ANDS r0, r0, #&FF'] },
  B: { detail: 'Branch to a PC-relative label.', signature: 'B{cond} label', parameters: ['label'], result: 'Writes the branch destination to R15/PC.', examples: ['B loop', 'BNE retry'] },
  BIC: { detail: 'Clear selected bits from a register.', signature: 'BIC{cond}{S} Rd, Rn, operand2', parameters: ['Rd', 'Rn', 'operand2'], result: 'Writes Rn AND NOT operand2 to Rd.', flags: ['N, Z and shifter carry when S is present'], examples: ['BIC r0, r0, #3'] },
  BL: { detail: 'Branch with link for a subroutine call.', signature: 'BL{cond} label', parameters: ['label'], result: 'Stores the return address in R14/LR and branches.', examples: ['BL draw_sprite'] },
  CMP: { detail: 'Compare by subtracting without retaining the arithmetic result.', signature: 'CMP{cond} Rn, operand2', parameters: ['Rn', 'operand2'], result: 'Updates condition flags for Rn - operand2.', flags: ['N, Z, C, V'], examples: ['CMP r0, #0'] },
  EOR: { detail: 'Bitwise exclusive OR two operands.', signature: 'EOR{cond}{S} Rd, Rn, operand2', parameters: ['Rd', 'Rn', 'operand2'], result: 'Writes Rn XOR operand2 to Rd.', flags: ['N, Z and shifter carry when S is present'], examples: ['EOR r0, r0, r1'] },
  LDM: { detail: 'Load multiple registers from consecutive words in memory.', signature: 'LDM{cond}{mode} Rn{!}, {registers}{^}', parameters: ['Rn', 'registers'], result: 'Loads the selected register list; optional write-back updates Rn.', examples: ['LDMFD sp!, {r0-r3,pc}'] },
  LDR: { detail: 'Load one word or byte from memory.', signature: 'LDR{cond}{B} Rd, address', parameters: ['Rd', 'address'], result: 'Loads memory into Rd.', examples: ['LDR r0, [r1,#4]', 'LDRB r2, [r3]'] },
  MLA: { detail: 'Multiply two registers and accumulate a third.', signature: 'MLA{cond}{S} Rd, Rm, Rs, Rn', parameters: ['Rd', 'Rm', 'Rs', 'Rn'], result: 'Writes (Rm × Rs) + Rn to Rd.', flags: ['N and Z when S is present'], examples: ['MLA r0, r1, r2, r3'] },
  MOV: { detail: 'Copy a shifted-register or immediate operand.', signature: 'MOV{cond}{S} Rd, operand2', parameters: ['Rd', 'operand2'], result: 'Writes operand2 to Rd.', flags: ['N, Z and shifter carry when S is present'], examples: ['MOV r0, #1', 'MOV pc, lr'] },
  MUL: { detail: 'Multiply two registers.', signature: 'MUL{cond}{S} Rd, Rm, Rs', parameters: ['Rd', 'Rm', 'Rs'], result: 'Writes the low 32 bits of Rm × Rs to Rd.', flags: ['N and Z when S is present'], examples: ['MUL r0, r1, r2'] },
  MVN: { detail: 'Move the bitwise complement of an operand.', signature: 'MVN{cond}{S} Rd, operand2', parameters: ['Rd', 'operand2'], result: 'Writes NOT operand2 to Rd.', flags: ['N, Z and shifter carry when S is present'], examples: ['MVN r0, #0'] },
  ORR: { detail: 'Bitwise OR two operands.', signature: 'ORR{cond}{S} Rd, Rn, operand2', parameters: ['Rd', 'Rn', 'operand2'], result: 'Writes Rn OR operand2 to Rd.', flags: ['N, Z and shifter carry when S is present'], examples: ['ORR r0, r0, #&80'] },
  RSB: { detail: 'Reverse subtract operand order.', signature: 'RSB{cond}{S} Rd, Rn, operand2', parameters: ['Rd', 'Rn', 'operand2'], result: 'Writes operand2 - Rn to Rd.', flags: ['N, Z, C, V when S is present'], examples: ['RSB r0, r0, #0'] },
  SBC: { detail: 'Subtract with carry/borrow input.', signature: 'SBC{cond}{S} Rd, Rn, operand2', parameters: ['Rd', 'Rn', 'operand2'], result: 'Writes Rn - operand2 - NOT C to Rd.', flags: ['N, Z, C, V when S is present'], examples: ['SBCS r0, r0, r1'] },
  STM: { detail: 'Store multiple registers to consecutive words in memory.', signature: 'STM{cond}{mode} Rn{!}, {registers}{^}', parameters: ['Rn', 'registers'], result: 'Stores the selected register list; optional write-back updates Rn.', examples: ['STMFD sp!, {r0-r3,lr}'] },
  STR: { detail: 'Store one word or byte to memory.', signature: 'STR{cond}{B} Rd, address', parameters: ['Rd', 'address'], result: 'Stores Rd to memory.', examples: ['STR r0, [r1,#4]', 'STRB r2, [r3]'] },
  SUB: { detail: 'Subtract a shifted-register or immediate operand.', signature: 'SUB{cond}{S} Rd, Rn, operand2', parameters: ['Rd', 'Rn', 'operand2'], result: 'Writes Rn - operand2 to Rd.', flags: ['N, Z, C, V when S is present'], examples: ['SUBS r0, r0, #1'] },
  SWI: { detail: 'Enter the software interrupt handler using a 24-bit reason field on ARM2.', signature: 'SWI{cond} expression', parameters: ['expression'], result: 'Enters supervisor mode through the SWI vector; R14_svc receives the return address.', examples: ['SWI &00'] },
  TEQ: { detail: 'Test equivalence using exclusive OR without retaining the result.', signature: 'TEQ{cond} Rn, operand2', parameters: ['Rn', 'operand2'], result: 'Updates logical condition flags for Rn XOR operand2.', flags: ['N, Z and shifter carry'], examples: ['TEQ r0, r1'] },
  TST: { detail: 'Test bits using AND without retaining the result.', signature: 'TST{cond} Rn, operand2', parameters: ['Rn', 'operand2'], result: 'Updates logical condition flags for Rn AND operand2.', flags: ['N, Z and shifter carry'], examples: ['TST r0, #1'] },
};

export const armInstructionItems: LanguageItem[] = Object.entries(instructions).map(([token, record]) => ({
  token, kind: 'opcode', detail: record.detail, signature: record.signature, parameters: record.parameters, languages: ['arm'],
  source: { kind: 'builtin', label: 'Arm architecture instruction reference', version: VERSION },
  documentation: { category: 'ARM2 instruction', parameters: record.parameters?.map((name) => ({ name, detail: armParameter(name) })), result: record.result, flags: record.flags, examples: record.examples, compatibility: { supported: true, appliesTo: ['ARM2', 'ARM3 executing the ARM2 instruction subset'], warning: 'This adapter emits 26-bit-era ARM instructions only; Thumb and later architectural extensions are unavailable.' }, citations: citation },
}));

export const armDirectiveItems: LanguageItem[] = [
  directive('.CPU', 'Select the assembler CPU.', '.cpu arm2', 'The isolated adapter also forces -mcpu=arm2.'),
  directive('.GLOBAL', 'Export a symbol to the linker.', '.global symbol'),
  directive('.TYPE', 'Record a symbol type in ELF metadata.', '.type symbol, %function'),
  directive('.SECTION', 'Select an ELF input section.', '.section .text'),
  directive('.WORD', 'Emit one or more little-endian 32-bit words.', '.word expression[, expression…]'),
  directive('.BYTE', 'Emit one or more bytes.', '.byte expression[, expression…]'),
  directive('.ALIGN', 'Align the following location according to GNU as ARM rules.', '.align power'),
  directive('.INCLUDE', 'Include a static quoted project-local source file.', '.include "project/path"', 'Absolute paths, traversal, dynamic names and .incbin are rejected by the build sandbox.'),
];

function directive(token: string, detail: string, signature: string, warning?: string): LanguageItem {
  return { token, kind: 'directive', detail, signature, languages: ['arm'], source: { kind: 'builtin', label: 'GNU as ARM adapter reference', version: VERSION }, documentation: { category: 'GNU ARM assembler directive', examples: [signature], compatibility: { supported: true, appliesTo: ['gnu.arm-none-eabi-binutils'], warning } } };
}

function armParameter(name: string) {
  if (name === 'Rd') return 'Destination register R0–R15.';
  if (name === 'Rn') return 'First operand or address-base register R0–R15.';
  if (name === 'operand2') return 'ARM immediate or shifted-register operand.';
  if (name === 'address') return 'ARM pre/post-indexed load/store address expression.';
  if (name === 'registers') return 'Comma-separated register list or range.';
  if (name === 'label') return 'Word-aligned PC-relative branch destination.';
  return 'ARM register or assembler expression as shown by the signature.';
}
