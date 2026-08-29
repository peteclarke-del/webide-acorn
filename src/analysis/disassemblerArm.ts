import type { AnalysisProcessor, Disassembly, DisassemblyRow } from './types';

type ArmProcessor = Extract<AnalysisProcessor, 'arm2' | 'arm3'>;
type Flow = 'next' | 'branch' | 'call' | 'stop';
interface DecodedArm { mnemonic: string; operand: string; target?: number; comment?: string; flow: Flow; condition: number }

const CONDITIONS = ['EQ', 'NE', 'CS', 'CC', 'MI', 'PL', 'VS', 'VC', 'HI', 'LS', 'GE', 'LT', 'GT', 'LE', '', 'NV'];
const DATA_OPERATIONS = ['AND', 'EOR', 'SUB', 'RSB', 'ADD', 'ADC', 'SBC', 'RSC', 'TST', 'TEQ', 'CMP', 'CMN', 'ORR', 'MOV', 'BIC', 'MVN'];
const SHIFT_NAMES = ['LSL', 'LSR', 'ASR', 'ROR'];
const SWIS: Record<number, string> = {
  0x00: 'OS_WriteC', 0x01: 'OS_WriteS', 0x02: 'OS_Write0', 0x03: 'OS_NewLine',
  0x04: 'OS_ReadC', 0x05: 'OS_CLI', 0x06: 'OS_Byte', 0x07: 'OS_Word',
  0x08: 'OS_File', 0x09: 'OS_Args', 0x0a: 'OS_BGet', 0x0b: 'OS_BPut',
  0x0c: 'OS_GBPB', 0x0d: 'OS_Find', 0x0e: 'OS_ReadLine', 0x10: 'OS_GetEnv',
  0x11: 'OS_Exit', 0x12: 'OS_SetEnv', 0x13: 'OS_IntOn', 0x14: 'OS_IntOff',
  0x15: 'OS_CallBack', 0x16: 'OS_EnterOS', 0x17: 'OS_BreakPt', 0x18: 'OS_BreakCtrl',
  0x19: 'OS_UnusedSWI', 0x1a: 'OS_UpdateMEMC', 0x1b: 'OS_SetCallBack',
  0x1c: 'OS_Mouse', 0x1d: 'OS_Heap', 0x1e: 'OS_Module', 0x1f: 'OS_Claim',
  0x20: 'OS_Release', 0x21: 'OS_ReadUnsigned', 0x22: 'OS_GenerateEvent',
  0x23: 'OS_ReadVarVal', 0x24: 'OS_SetVarVal', 0x25: 'OS_GSInit', 0x26: 'OS_GSRead',
  0x27: 'OS_GSTrans', 0x28: 'OS_BinaryToDecimal', 0x29: 'OS_FSControl',
  0x2a: 'OS_ChangeDynamicArea', 0x2b: 'OS_GenerateError', 0x2c: 'OS_ReadEscapeState',
};

function hex(value: number, width = 8) { return `&${(value >>> 0).toString(16).toUpperCase().padStart(width, '0')}`; }
function register(value: number) { return value === 13 ? 'SP' : value === 14 ? 'LR' : value === 15 ? 'PC' : `R${value}`; }
function ror(value: number, amount: number) { const shift = amount & 31; return shift ? ((value >>> shift) | (value << (32 - shift))) >>> 0 : value >>> 0; }

function registerOperand(word: number): string {
  const rm = register(word & 15);
  const type = (word >>> 5) & 3;
  if (((word >>> 4) & 1) === 1) return `${rm}, ${SHIFT_NAMES[type]} ${register((word >>> 8) & 15)}`;
  let amount = (word >>> 7) & 31;
  if (type === 0 && amount === 0) return rm;
  if ((type === 1 || type === 2) && amount === 0) amount = 32;
  if (type === 3 && amount === 0) return `${rm}, RRX`;
  return `${rm}, ${SHIFT_NAMES[type]} #${amount}`;
}

function operand2(word: number): string {
  if (((word >>> 25) & 1) === 0) return registerOperand(word);
  const rotation = ((word >>> 8) & 15) * 2;
  const immediate = ror(word & 0xff, rotation);
  return `#${hex(immediate, immediate <= 0xff ? 2 : 8)}`;
}

function registerList(mask: number): string {
  const names: string[] = [];
  let start = -1;
  const flush = (end: number) => {
    if (start < 0) return;
    names.push(end - start >= 2 ? `${register(start)}-${register(end)}` : end === start ? register(start) : `${register(start)},${register(end)}`);
    start = -1;
  };
  for (let index = 0; index <= 16; index += 1) {
    const present = index < 16 && (mask & (1 << index)) !== 0;
    if (present && start < 0) start = index;
    if (!present) flush(index - 1);
  }
  return `{${names.join(',')}}`;
}

export function decodeArmWord(word: number, address: number, processor: ArmProcessor): DecodedArm {
  word >>>= 0;
  const condition = word >>> 28;
  const suffix = CONDITIONS[condition]!;

  if ((word & 0x0fc000f0) === 0x00000090) {
    const accumulate = (word & 0x00200000) !== 0;
    const setFlags = (word & 0x00100000) !== 0;
    const rd = register((word >>> 16) & 15); const rn = register((word >>> 12) & 15);
    const rs = register((word >>> 8) & 15); const rm = register(word & 15);
    return { mnemonic: `${accumulate ? 'MLA' : 'MUL'}${suffix}${setFlags ? 'S' : ''}`, operand: accumulate ? `${rd}, ${rm}, ${rs}, ${rn}` : `${rd}, ${rm}, ${rs}`, flow: 'next', condition };
  }

  if (processor === 'arm3' && (word & 0x0fb00ff0) === 0x01000090) {
    const byte = (word & 0x00400000) !== 0;
    return { mnemonic: `SWP${suffix}${byte ? 'B' : ''}`, operand: `${register((word >>> 12) & 15)}, ${register(word & 15)}, [${register((word >>> 16) & 15)}]`, comment: 'ARM3 atomic swap', flow: 'next', condition };
  }

  if (processor === 'arm3' && (word & 0x0fbf0fff) === 0x010f0000) {
    const psr = (word & 0x00400000) !== 0 ? 'SPSR' : 'CPSR';
    return { mnemonic: `MRS${suffix}`, operand: `${register((word >>> 12) & 15)}, ${psr}`, comment: 'ARM3 program status register read', flow: 'next', condition };
  }

  if (processor === 'arm3' && ((word & 0x0fb0fff0) === 0x0120f000 || (word & 0x0fb0f000) === 0x0320f000)) {
    const psr = (word & 0x00400000) !== 0 ? 'SPSR' : 'CPSR';
    const fieldMask = (word >>> 16) & 15;
    const fields = ['c', 'x', 's', 'f'].filter((_, index) => (fieldMask & (1 << index)) !== 0).join('') || 'none';
    const source = (word & 0x02000000) !== 0 ? operand2(word) : register(word & 15);
    return { mnemonic: `MSR${suffix}`, operand: `${psr}_${fields}, ${source}`, comment: 'ARM3 program status register write', flow: 'next', condition };
  }

  const group = (word >>> 25) & 7;
  if (group === 0 || group === 1) {
    const opcode = (word >>> 21) & 15;
    const operation = DATA_OPERATIONS[opcode]!;
    const setFlags = (word & 0x00100000) !== 0;
    const rn = register((word >>> 16) & 15); const rd = register((word >>> 12) & 15);
    const second = operand2(word);
    const test = opcode >= 8 && opcode <= 11;
    const move = opcode === 13 || opcode === 15;
    const operand = test ? `${rn}, ${second}` : move ? `${rd}, ${second}` : `${rd}, ${rn}, ${second}`;
    const writesPc = !test && ((word >>> 12) & 15) === 15;
    return { mnemonic: `${operation}${suffix}${!test && setFlags ? 'S' : ''}`, operand, flow: writesPc && condition === 14 ? 'stop' : 'next', condition };
  }

  if (group === 2 || group === 3) {
    const load = (word & 0x00100000) !== 0; const byte = (word & 0x00400000) !== 0;
    const pre = (word & 0x01000000) !== 0; const up = (word & 0x00800000) !== 0; const writeBack = (word & 0x00200000) !== 0;
    const rn = register((word >>> 16) & 15); const rd = register((word >>> 12) & 15);
    const rawOffset = (word & 0x02000000) !== 0 ? registerOperand(word) : `#${hex(word & 0xfff, 3)}`;
    const offset = (word & 0xfff) === 0 && (word & 0x02000000) === 0 ? '' : `${up ? '' : '-'}${rawOffset}`;
    const addressOperand = pre ? `[${rn}${offset ? `, ${offset}` : ''}]${writeBack ? '!' : ''}` : `[${rn}], ${offset || '#&000'}`;
    return { mnemonic: `${load ? 'LDR' : 'STR'}${suffix}${byte ? 'B' : ''}${!pre && writeBack ? 'T' : ''}`, operand: `${rd}, ${addressOperand}`, flow: load && rd === 'PC' && condition === 14 ? 'stop' : 'next', condition };
  }

  if (group === 4) {
    const load = (word & 0x00100000) !== 0; const pre = (word & 0x01000000) !== 0; const up = (word & 0x00800000) !== 0;
    const mode = up ? (pre ? 'IB' : 'IA') : (pre ? 'DB' : 'DA');
    const rn = register((word >>> 16) & 15); const list = registerList(word & 0xffff);
    const writeBack = (word & 0x00200000) !== 0 ? '!' : ''; const user = (word & 0x00400000) !== 0 ? '^' : '';
    const loadsPc = load && (word & 0x8000) !== 0;
    return { mnemonic: `${load ? 'LDM' : 'STM'}${suffix}${mode}`, operand: `${rn}${writeBack}, ${list}${user}`, flow: loadsPc && condition === 14 ? 'stop' : 'next', condition };
  }

  if (group === 5) {
    let displacement = word & 0x00ffffff;
    if (displacement & 0x00800000) displacement |= 0xff000000;
    const target = (address + 8 + (displacement << 2)) & 0x03fffffc;
    const link = (word & 0x01000000) !== 0;
    return { mnemonic: `${link ? 'BL' : 'B'}${suffix}`, operand: hex(target), target, comment: link ? 'Branch with link' : suffix ? `Conditional branch ${suffix}` : 'Branch', flow: link ? 'call' : 'branch', condition };
  }

  if (group === 6) {
    const load = (word & 0x00100000) !== 0; const pre = (word & 0x01000000) !== 0; const up = (word & 0x00800000) !== 0;
    const cp = (word >>> 8) & 15; const crd = (word >>> 12) & 15; const rn = register((word >>> 16) & 15);
    const offset = (word & 0xff) * 4; const rendered = `${up ? '' : '-'}#${hex(offset, 3)}`;
    return { mnemonic: `${load ? 'LDC' : 'STC'}${suffix}${(word & 0x00400000) ? 'L' : ''}`, operand: `P${cp}, C${crd}, [${rn}${pre ? `, ${rendered}]${(word & 0x00200000) ? '!' : ''}` : `], ${rendered}`}`, comment: 'Coprocessor data transfer', flow: 'next', condition };
  }

  if (group === 7 && (word & 0x01000000) !== 0) {
    const swi = word & 0x00ffffff; const name = SWIS[swi];
    return { mnemonic: `SWI${suffix}`, operand: name ?? hex(swi, 6), comment: name ? `RISC OS ${name}` : 'Software interrupt', flow: 'next', condition };
  }

  if (group === 7 && (word & 0x10) !== 0) {
    const read = (word & 0x00100000) !== 0; const cp = (word >>> 8) & 15;
    return { mnemonic: `${read ? 'MRC' : 'MCR'}${suffix}`, operand: `P${cp}, ${(word >>> 21) & 7}, ${register((word >>> 12) & 15)}, C${(word >>> 16) & 15}, C${word & 15}, ${(word >>> 5) & 7}`, comment: 'Coprocessor register transfer', flow: 'next', condition };
  }

  if (group === 7) {
    const cp = (word >>> 8) & 15;
    return { mnemonic: `CDP${suffix}`, operand: `P${cp}, ${(word >>> 20) & 15}, C${(word >>> 12) & 15}, C${(word >>> 16) & 15}, C${word & 15}, ${(word >>> 5) & 7}`, comment: 'Coprocessor data operation', flow: 'next', condition };
  }

  return { mnemonic: 'EQUD', operand: hex(word), comment: 'Unclassified ARM word', flow: 'stop', condition };
}

export function disassembleArm(source: Uint8Array, origin: number, entryPoint: number, processor: ArmProcessor): Disassembly {
  const warnings: string[] = [];
  origin &= 0x03ffffff; entryPoint &= 0x03ffffff;
  if ((origin & 3) !== 0) warnings.push(`Load address ${hex(origin)} is not word aligned; instruction rows retain the supplied byte address.`);
  const capacity = Math.max(0, 0x04000000 - origin);
  const bytes = source.length > capacity ? source.slice(0, capacity) : source;
  if (bytes.length < source.length) warnings.push(`${source.length - bytes.length} byte(s) beyond the ARM2/ARM3 26-bit address space were not analysed.`);
  if (entryPoint < origin || entryPoint >= origin + bytes.length || ((entryPoint - origin) & 3) !== 0) {
    warnings.push(`Entry point ${hex(entryPoint)} is outside the aligned file words; analysis starts at ${hex(origin)}.`);
    entryPoint = origin;
  }
  if ((bytes.length & 3) !== 0) warnings.push(`${bytes.length & 3} trailing byte(s) cannot form a 32-bit ARM instruction and are retained as data.`);

  const decoded = new Map<number, DecodedArm>();
  const references = new Map<number, number[]>();
  const queue = [entryPoint];
  const enqueue = (target: number, sourceAddress: number) => {
    /* Appended in place rather than rebuilt. Copying the list on every
     * reference costs the square of how many things name one address, and a run
     * of conditional branches to a single word is exactly that: 32,768 of them
     * took twenty-two seconds, past the ceiling the analysis worker would have
     * refused it at. */
    const incoming = references.get(target);
    if (incoming) incoming.push(sourceAddress);
    else references.set(target, [sourceAddress]);
    if (target >= origin && target + 3 < origin + bytes.length && ((target - origin) & 3) === 0) queue.push(target);
  };
  /* Walked by index for the same reason the 6502 reader is: taking the first
   * element of an array costs what is left in it, and a chain of branches puts
   * one entry here per instruction. */
  let queueIndex = 0;
  while (queueIndex < queue.length) {
    let address = queue[queueIndex]!;
    queueIndex += 1;
    while (address >= origin && address + 3 < origin + bytes.length && !decoded.has(address)) {
      const offset = address - origin;
      const word = (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
      const instruction = decodeArmWord(word, address, processor);
      decoded.set(address, instruction);
      if (instruction.target !== undefined) enqueue(instruction.target, address);
      const conditional = instruction.condition !== 14;
      if (instruction.flow === 'stop' && !conditional) break;
      if (instruction.flow === 'branch' && !conditional) break;
      address += 4;
    }
  }

  const labels: Record<number, string> = { [entryPoint]: `program_entry_${hex(entryPoint).slice(1)}` };
  for (const [target, incoming] of references) if (target >= origin && target < origin + bytes.length) {
    labels[target] = incoming.some((address) => target <= address) ? `loop_${hex(target).slice(1)}` : `location_${hex(target).slice(1)}`;
  }
  const rows: DisassemblyRow[] = [];
  for (let offset = 0; offset < bytes.length;) {
    const address = origin + offset;
    const instruction = decoded.get(address);
    if (instruction && offset + 4 <= bytes.length) {
      const operand = instruction.target !== undefined && labels[instruction.target]
        ? instruction.operand.replace(hex(instruction.target), labels[instruction.target]!) : instruction.operand;
      rows.push({ address, offset, bytes: Array.from(bytes.slice(offset, offset + 4)), kind: 'instruction', mnemonic: instruction.mnemonic, operand, target: instruction.target, label: labels[address], comment: instruction.comment, references: references.get(address) ?? [], reachable: true });
      offset += 4; continue;
    }
    if (offset + 4 <= bytes.length) {
      const word = (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
      rows.push({ address, offset, bytes: Array.from(bytes.slice(offset, offset + 4)), kind: 'bytes', mnemonic: 'EQUD', operand: hex(word), label: labels[address], comment: 'Unreached 32-bit word', references: references.get(address) ?? [], reachable: false });
      offset += 4; continue;
    }
    const chunk = Array.from(bytes.slice(offset));
    rows.push({ address, offset, bytes: chunk, kind: 'bytes', mnemonic: 'EQUB', operand: chunk.map((byte) => hex(byte, 2)).join(','), label: labels[address], comment: 'Trailing bytes', references: references.get(address) ?? [], reachable: false });
    offset = bytes.length;
  }
  const codeByteCount = rows.filter((row) => row.kind === 'instruction').reduce((total, row) => total + row.bytes.length, 0);
  return { kind: 'machine-code', processor, origin, entryPoint, rows, labels, codeByteCount, dataByteCount: bytes.length - codeByteCount, warnings };
}
