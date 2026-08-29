export interface InstructionRegisters { a: number; x: number; y: number }

export interface DecodedInstructionState {
  opcode: number;
  opcodeSpec: string;
  mnemonic: string;
  addressingMode: string;
  length: number;
  bytes: number[];
  effectiveAddress?: number;
  operandValue?: number;
  pointerAddress?: number;
  branchTarget?: number;
  pageCrossed: boolean;
}

interface DecodeInput extends InstructionRegisters {
  pc: number;
  opcodeSpec?: string;
  read(address: number): number;
  nmos: boolean;
}

const modeNames: Record<string, string> = {
  implied: 'Implied', A: 'Accumulator', imm: 'Immediate', zp: 'Zero page', 'zp,x': 'Zero page, X', zpx: 'Zero page, X',
  'zp,y': 'Zero page, Y', abs: 'Absolute', 'abs,x': 'Absolute, X', 'abs,y': 'Absolute, Y', branch: 'PC-relative branch',
  '(,x)': 'Indexed indirect, X', '(),y': 'Indirect indexed, Y', '()': 'Zero-page indirect', '(abs)': 'Absolute indirect',
  '(abs,x)': 'Absolute indexed indirect, X', 'zp,branch': 'Zero-page bit branch',
};

const byte = (value: number) => value & 0xff;
const word = (value: number) => value & 0xffff;
const signedByte = (value: number) => (value & 0x80 ? value - 0x100 : value);

export function decodeInstructionState(input: DecodeInput): DecodedInstructionState {
  const read = (address: number) => byte(input.read(word(address)));
  const opcode = read(input.pc);
  const opcodeSpec = input.opcodeSpec?.trim() || '???';
  const [mnemonic = '???', rawMode = 'implied'] = opcodeSpec.split(/\s+/, 2);
  const mode = rawMode === 'zpx' ? 'zp,x' : rawMode;
  let length = 1;
  let effectiveAddress: number | undefined;
  let operandValue: number | undefined;
  let pointerAddress: number | undefined;
  let branchTarget: number | undefined;
  let pageCrossed = false;
  const operand = read(input.pc + 1);
  const absolute = operand | (read(input.pc + 2) << 8);
  const readZpWord = (address: number) => read(address) | (read(byte(address + 1)) << 8);
  const readWord = (address: number) => read(address) | (read(address + 1) << 8);

  switch (mode) {
    case 'imm': length = 2; effectiveAddress = word(input.pc + 1); operandValue = operand; break;
    case 'zp': length = 2; effectiveAddress = operand; operandValue = read(effectiveAddress); break;
    case 'zp,x': length = 2; effectiveAddress = byte(operand + input.x); operandValue = read(effectiveAddress); break;
    case 'zp,y': length = 2; effectiveAddress = byte(operand + input.y); operandValue = read(effectiveAddress); break;
    case 'abs': length = 3; effectiveAddress = absolute; operandValue = read(effectiveAddress); break;
    case 'abs,x': length = 3; effectiveAddress = word(absolute + input.x); operandValue = read(effectiveAddress); pageCrossed = (absolute & 0xff00) !== (effectiveAddress & 0xff00); break;
    case 'abs,y': length = 3; effectiveAddress = word(absolute + input.y); operandValue = read(effectiveAddress); pageCrossed = (absolute & 0xff00) !== (effectiveAddress & 0xff00); break;
    case 'branch': length = 2; branchTarget = word(input.pc + 2 + signedByte(operand)); effectiveAddress = branchTarget; break;
    case '(,x)': pointerAddress = byte(operand + input.x); length = 2; effectiveAddress = readZpWord(pointerAddress); operandValue = read(effectiveAddress); break;
    case '(),y': {
      pointerAddress = operand; length = 2;
      const base = readZpWord(pointerAddress); effectiveAddress = word(base + input.y); operandValue = read(effectiveAddress);
      pageCrossed = (base & 0xff00) !== (effectiveAddress & 0xff00); break;
    }
    case '()': pointerAddress = operand; length = 2; effectiveAddress = readZpWord(pointerAddress); operandValue = read(effectiveAddress); break;
    case '(abs)': {
      pointerAddress = absolute; length = 3;
      const highAddress = input.nmos ? ((absolute & 0xff00) | byte(absolute + 1)) : word(absolute + 1);
      effectiveAddress = read(absolute) | (read(highAddress) << 8); break;
    }
    case '(abs,x)': pointerAddress = word(absolute + input.x); length = 3; effectiveAddress = readWord(pointerAddress); break;
    case 'zp,branch': length = 3; effectiveAddress = operand; operandValue = read(effectiveAddress); branchTarget = word(input.pc + 3 + signedByte(read(input.pc + 2))); break;
    default: break;
  }

  return {
    opcode, opcodeSpec, mnemonic, addressingMode: modeNames[mode] ?? `Unknown (${mode})`, length,
    bytes: Array.from({ length }, (_, offset) => read(input.pc + offset)), effectiveAddress, operandValue,
    pointerAddress, branchTarget, pageCrossed,
  };
}
