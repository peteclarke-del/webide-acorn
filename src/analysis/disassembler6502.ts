import {
  commentLookup, indirectTargetLookup, labelLookup, regionAt,
  type AnalysisAnnotations, type AnalysisRegion,
} from './analysisAnnotations';
import type { Disassembly, DisassemblyRow, Processor } from './types';

export interface Opcode {
  mnemonic: string;
  mode: AddressMode;
  size: number;
}

export type AddressMode =
  | 'imp' | 'acc' | 'imm' | 'zp' | 'zpx' | 'zpy' | 'indx' | 'indy'
  | 'zpi' | 'rel' | 'abs' | 'absx' | 'absy' | 'ind' | 'iax';

const MODE_SIZE: Record<AddressMode, number> = {
  imp: 1, acc: 1, imm: 2, zp: 2, zpx: 2, zpy: 2, indx: 2, indy: 2,
  zpi: 2, rel: 2, abs: 3, absx: 3, absy: 3, ind: 3, iax: 3,
};

const NMOS_SPEC = `
00 BRK imp 01 ORA indx 05 ORA zp 06 ASL zp 08 PHP imp 09 ORA imm 0A ASL acc 0D ORA abs 0E ASL abs
10 BPL rel 11 ORA indy 15 ORA zpx 16 ASL zpx 18 CLC imp 19 ORA absy 1D ORA absx 1E ASL absx
20 JSR abs 21 AND indx 24 BIT zp 25 AND zp 26 ROL zp 28 PLP imp 29 AND imm 2A ROL acc 2C BIT abs 2D AND abs 2E ROL abs
30 BMI rel 31 AND indy 35 AND zpx 36 ROL zpx 38 SEC imp 39 AND absy 3D AND absx 3E ROL absx
40 RTI imp 41 EOR indx 45 EOR zp 46 LSR zp 48 PHA imp 49 EOR imm 4A LSR acc 4C JMP abs 4D EOR abs 4E LSR abs
50 BVC rel 51 EOR indy 55 EOR zpx 56 LSR zpx 58 CLI imp 59 EOR absy 5D EOR absx 5E LSR absx
60 RTS imp 61 ADC indx 65 ADC zp 66 ROR zp 68 PLA imp 69 ADC imm 6A ROR acc 6C JMP ind 6D ADC abs 6E ROR abs
70 BVS rel 71 ADC indy 75 ADC zpx 76 ROR zpx 78 SEI imp 79 ADC absy 7D ADC absx 7E ROR absx
81 STA indx 84 STY zp 85 STA zp 86 STX zp 88 DEY imp 8A TXA imp 8C STY abs 8D STA abs 8E STX abs
90 BCC rel 91 STA indy 94 STY zpx 95 STA zpx 96 STX zpy 98 TYA imp 99 STA absy 9A TXS imp 9D STA absx
A0 LDY imm A1 LDA indx A2 LDX imm A4 LDY zp A5 LDA zp A6 LDX zp A8 TAY imp A9 LDA imm AA TAX imp AC LDY abs AD LDA abs AE LDX abs
B0 BCS rel B1 LDA indy B4 LDY zpx B5 LDA zpx B6 LDX zpy B8 CLV imp B9 LDA absy BA TSX imp BC LDY absx BD LDA absx BE LDX absy
C0 CPY imm C1 CMP indx C4 CPY zp C5 CMP zp C6 DEC zp C8 INY imp C9 CMP imm CA DEX imp CC CPY abs CD CMP abs CE DEC abs
D0 BNE rel D1 CMP indy D5 CMP zpx D6 DEC zpx D8 CLD imp D9 CMP absy DD CMP absx DE DEC absx
E0 CPX imm E1 SBC indx E4 CPX zp E5 SBC zp E6 INC zp E8 INX imp E9 SBC imm EA NOP imp EC CPX abs ED SBC abs EE INC abs
F0 BEQ rel F1 SBC indy F5 SBC zpx F6 INC zpx F8 SED imp F9 SBC absy FD SBC absx FE INC absx
`.trim().split(/\s+/);

// Instructions implemented by the 65C12 used in the BBC Master, overlaid on
// the NMOS table. Rockwell bit operations are intentionally not assumed.
const CMOS_SPEC = `
04 TSB zp 0C TSB abs 12 ORA zpi 14 TRB zp 1A INC acc 1C TRB abs
32 AND zpi 34 BIT zpx 3A DEC acc 3C BIT absx
52 EOR zpi 5A PHY imp 64 STZ zp 72 ADC zpi 74 STZ zpx 7A PLY imp 7C JMP iax
80 BRA rel 89 BIT imm 92 STA zpi 9C STZ abs 9E STZ absx
B2 LDA zpi D2 CMP zpi DA PHX imp F2 SBC zpi FA PLX imp
`.trim().split(/\s+/);

export function opcodeTable(processor: Processor): Array<Opcode | undefined> {
  const table: Array<Opcode | undefined> = Array.from({ length: 256 });
  const add = (spec: string[]) => {
    for (let index = 0; index < spec.length; index += 3) {
      const mode = spec[index + 2] as AddressMode;
      table[Number.parseInt(spec[index]!, 16)] = {
        mnemonic: spec[index + 1]!, mode, size: MODE_SIZE[mode],
      };
    }
  };
  add(NMOS_SPEC);
  if (processor === '65c02') add(CMOS_SPEC);
  return table;
}

export const MOS_CALLS: Record<number, string> = {
  0xffb9: 'OSRDRM', 0xffbc: 'VDUCHR', 0xffbf: 'OSEVEN', 0xffc2: 'GSINIT',
  0xffc5: 'GSREAD', 0xffc8: 'NVRDCH', 0xffcb: 'NVWRCH', 0xffce: 'OSFIND',
  0xffd1: 'OSGBPB', 0xffd4: 'OSBPUT', 0xffd7: 'OSBGET', 0xffda: 'OSARGS',
  0xffdd: 'OSFILE', 0xffe0: 'OSRDCH', 0xffe3: 'OSASCI', 0xffe7: 'OSNEWL',
  0xffee: 'OSWRCH', 0xfff1: 'OSWORD', 0xfff4: 'OSBYTE', 0xfff7: 'OSCLI',
};

export const MOS_PURPOSES: Record<number, string> = {
  0xffb9: 'Read a byte from sideways ROM', 0xffbc: 'Send a byte through the VDU system',
  0xffbf: 'Generate an event', 0xffc2: 'Start parsing the command-line string',
  0xffc5: 'Read the next command-line item', 0xffc8: 'Read the selected input stream',
  0xffcb: 'Write to the selected output stream', 0xffce: 'Open or close a file',
  0xffd1: 'Transfer a block through the filing system', 0xffd4: 'Write one byte to an open file',
  0xffd7: 'Read one byte from an open file', 0xffda: 'Read or change open-file information',
  0xffdd: 'Perform a whole-file operation', 0xffe0: 'Read a character',
  0xffe3: 'Write a character, expanding CR', 0xffe7: 'Write a newline',
  0xffee: 'Write a character or VDU control byte', 0xfff1: 'Perform an OSWORD operation',
  0xfff4: 'Perform an OSBYTE operation', 0xfff7: 'Execute a MOS command string',
};

const BRANCH_COMMENTS: Record<string, string> = {
  BPL: 'Branch if positive', BMI: 'Branch if negative', BVC: 'Branch if overflow clear',
  BVS: 'Branch if overflow set', BCC: 'Branch if carry clear', BCS: 'Branch if carry set',
  BNE: 'Branch if not equal', BEQ: 'Branch if equal', BRA: 'Branch always',
};

const HARDWARE_REGIONS: Array<[number, number, string]> = [
  [0xfc00, 0xfcff, 'FRED expansion I/O'], [0xfd00, 0xfdff, 'JIM expansion I/O'],
  [0xfe00, 0xfe07, '6845 display controller'], [0xfe08, 0xfe0f, 'serial ACIA'],
  [0xfe10, 0xfe17, 'serial ULA'], [0xfe20, 0xfe2f, 'video ULA'],
  [0xfe30, 0xfe3f, 'ROM/memory paging latch'], [0xfe40, 0xfe5f, 'system VIA'],
  [0xfe60, 0xfe7f, 'user VIA'], [0xfe80, 0xfe9f, 'filing-system hardware'],
  [0xfea0, 0xfebf, 'Econet hardware'], [0xfec0, 0xfedf, 'analogue converter'],
  [0xfee0, 0xfeff, 'Tube interface'],
];

const VDU_CONTROLS: Record<number, string> = {
  7: 'bell', 12: 'clear text area', 13: 'carriage return', 17: 'set text colour',
  18: 'set graphics colour/action', 19: 'define logical colour', 20: 'restore colours',
  22: 'select screen mode', 23: 'program a character/system variable', 25: 'plot graphics',
  26: 'restore windows', 28: 'define text window', 29: 'set graphics origin',
  30: 'home text cursor', 31: 'position text cursor',
};

function regionComment(region: AnalysisRegion): string {
  const kind = region.kind === 'text' ? 'Marked as text' : region.kind === 'data' ? 'Marked as data' : 'Marked as code';
  return region.note ? `${kind}: ${region.note}` : kind;
}

/* Bytes inside a span the reader called text are shown as text even when a
 * few of them are not printable, because the reader's marking is the claim
 * being tested; unprintable bytes are shown as escapes rather than dropped. */
function printableCharacter(value: number): string {
  return value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : `\\x${value.toString(16).padStart(2, '0')}`;
}

function hex(value: number, width = 4): string {
  return `&${value.toString(16).toUpperCase().padStart(width, '0')}`;
}

function operandFor(bytes: Uint8Array, offset: number, address: number, opcode: Opcode) {
  const value = opcode.size === 3
    ? bytes[offset + 1]! | (bytes[offset + 2]! << 8)
    : opcode.size === 2 ? bytes[offset + 1]! : undefined;
  let target: number | undefined;
  let operand = '';
  switch (opcode.mode) {
    case 'acc': operand = 'A'; break;
    case 'imm': operand = `#${hex(value!, 2)}`; break;
    case 'zp': operand = hex(value!, 2); target = value; break;
    case 'zpx': operand = `${hex(value!, 2)},X`; target = value; break;
    case 'zpy': operand = `${hex(value!, 2)},Y`; target = value; break;
    case 'indx': operand = `(${hex(value!, 2)},X)`; break;
    case 'indy': operand = `(${hex(value!, 2)}),Y`; break;
    case 'zpi': operand = `(${hex(value!, 2)})`; break;
    case 'abs': operand = hex(value!); target = value; break;
    case 'absx': operand = `${hex(value!)},X`; target = value; break;
    case 'absy': operand = `${hex(value!)},Y`; target = value; break;
    case 'ind': operand = `(${hex(value!)})`; break;
    case 'iax': operand = `(${hex(value!)},X)`; break;
    case 'rel': {
      const displacement = value! < 0x80 ? value! : value! - 0x100;
      target = (address + 2 + displacement) & 0xffff;
      operand = hex(target);
      break;
    }
    default: break;
  }
  return { operand, target };
}

function hardwareComment(target?: number): string | undefined {
  if (target === undefined) return undefined;
  return HARDWARE_REGIONS.find(([start, end]) => target >= start && target <= end)?.[2];
}

function isPrintableText(bytes: Uint8Array, offset: number, boundary: number): number {
  let end = offset;
  while (end < boundary && end - offset < 48 && bytes[end]! >= 32 && bytes[end]! < 127) end += 1;
  return end - offset >= 4 && Array.from(bytes.slice(offset, end)).some((value) => /[A-Za-z]/.test(String.fromCharCode(value)))
    ? end - offset : 0;
}

function semanticLabels(
  rows: DisassemblyRow[],
  labels: Record<number, string>,
  callTargets: Set<number>,
) {
  const instructionRows = rows.filter((row) => row.kind === 'instruction');
  const indexByAddress = new Map(instructionRows.map((row, index) => [row.address, index]));
  for (const target of callTargets) {
    const start = indexByAddress.get(target);
    if (start === undefined) continue;
    const body = instructionRows.slice(start, start + 80);
    const calls = body.filter((row) => row.mnemonic === 'JSR').map((row) => row.target);
    const hasBackwardsFlow = body.some((row) => row.target !== undefined && row.target <= row.address);
    let purpose = 'subroutine';
    if (calls.some((value) => value === 0xffee || value === 0xffe3 || value === 0xffbc)) {
      purpose = hasBackwardsFlow ? 'write_text' : 'write_character';
    } else if (calls.includes(0xfff7)) purpose = 'execute_command';
    else if (calls.includes(0xffdd)) purpose = 'file_operation';
    else if (calls.includes(0xfff4)) purpose = 'osbyte_operation';
    else if (calls.includes(0xfff1)) purpose = 'osword_operation';
    labels[target] = `${purpose}_${target.toString(16).toUpperCase().padStart(4, '0')}`;
  }
}

export function disassemble6502(
  source: Uint8Array,
  origin: number,
  entryPoint: number,
  processor: Processor,
  /* What the reader has recorded about this binary. Reachability alone cannot
   * find an entry the loader calls from outside the file, or the destination of
   * a jump through a pointer, so those are supplied rather than guessed. */
  annotations?: AnalysisAnnotations,
): Disassembly {
  const warnings: string[] = [];
  const capacity = Math.max(0, 0x10000 - origin);
  const bytes = source.length > capacity ? source.slice(0, capacity) : source;
  if (bytes.length < source.length) warnings.push(`${source.length - bytes.length} byte(s) beyond the 16-bit address space were not analysed.`);
  if (entryPoint < origin || entryPoint >= origin + bytes.length) {
    warnings.push(`Entry point ${hex(entryPoint)} is outside the file; analysis starts at ${hex(origin)}.`);
    entryPoint = origin;
  }

  const table = opcodeTable(processor);
  const decoded = new Map<number, DisassemblyRow>();
  const occupied = new Set<number>();

  /* Regions the reader has marked as data or text are excluded from decoding
   * altogether: a byte inside one is not an instruction, whatever reaching it
   * would suggest. Regions marked code become entry points in their own right. */
  const inside = (address: number) => address >= origin && address < origin + bytes.length;
  const markedRegions = (annotations?.regions ?? []).filter((region) => inside(region.start) || inside(region.end));
  const isMarkedNonCode = (address: number) => {
    const region = annotations ? regionAt(annotations, address) : undefined;
    return region !== undefined && region.kind !== 'code';
  };
  const extraEntryPoints = (annotations?.entryPoints ?? []).filter((address) => {
    if (inside(address)) return true;
    warnings.push(`Recorded entry point ${hex(address)} is outside the analysed bytes and was not followed.`);
    return false;
  });
  const indirectTargets = annotations ? indirectTargetLookup(annotations) : new Map<number, number[]>();
  /* Only the first address of a marked code run is seeded; decoding walks the
   * rest from there, which keeps instruction boundaries the machine's rather
   * than ours. */
  const markedCodeStarts = markedRegions
    .filter((region) => region.kind === 'code' && region.end >= origin && region.start < origin + bytes.length)
    .map((region) => Math.max(region.start, origin));
  const queue = [entryPoint, ...extraEntryPoints, ...markedCodeStarts];
  const callTargets = new Set<number>();
  const controlTargets = new Map<number, Array<{ source: number; mnemonic: string }>>();
  const addTarget = (target: number, sourceAddress: number, mnemonic: string) => {
    const refs = controlTargets.get(target) ?? [];
    refs.push({ source: sourceAddress, mnemonic });
    controlTargets.set(target, refs);
    if (target >= origin && target < origin + bytes.length) queue.push(target);
  };

  /* Walked with an index rather than by taking from the front. The order is the
   * same, but removing the first element of an array is proportional to what is
   * left in it, and a bank of branches puts one entry here per instruction: a
   * 64 KiB image of nothing but branches took nearly six seconds that way, all
   * of it spent shuffling the queue rather than decoding anything. */
  let queueIndex = 0;
  while (queueIndex < queue.length) {
    let address = queue[queueIndex]!;
    queueIndex += 1;
    while (address >= origin && address < origin + bytes.length && !decoded.has(address)) {
      if (isMarkedNonCode(address)) break;
      const offset = address - origin;
      if (occupied.has(offset)) {
        warnings.push(`Control flow reaches the middle of an instruction at ${hex(address)}.`);
        break;
      }
      const opcode = table[bytes[offset]!];
      if (!opcode || offset + opcode.size > bytes.length) break;
      /* An instruction may not straddle into a span the reader marked as data. */
      let straddles = false;
      for (let index = 1; index < opcode.size; index += 1) if (isMarkedNonCode(address + index)) straddles = true;
      if (straddles) {
        warnings.push(`The instruction at ${hex(address)} would run into a span marked as data, so it was not decoded.`);
        break;
      }
      const instructionBytes = Array.from(bytes.slice(offset, offset + opcode.size));
      const { operand, target } = operandFor(bytes, offset, address, opcode);
      const row: DisassemblyRow = {
        address, offset, bytes: instructionBytes, kind: 'instruction', mnemonic: opcode.mnemonic,
        operand, target, references: [], reachable: true,
      };
      decoded.set(address, row);
      for (let index = 0; index < opcode.size; index += 1) occupied.add(offset + index);

      /* A recorded hint replaces the guess the bytes cannot make. It applies to
       * whatever instruction is at that address, so it also covers a computed
       * RTS dispatch or a JSR into a table. */
      const hinted = indirectTargets.get(address);
      if (hinted) for (const hintedTarget of hinted) addTarget(hintedTarget, address, opcode.mnemonic);

      if (opcode.mode === 'rel' && target !== undefined) {
        addTarget(target, address, opcode.mnemonic);
        if (opcode.mnemonic === 'BRA') break;
      } else if (opcode.mnemonic === 'JSR' && target !== undefined) {
        callTargets.add(target);
        addTarget(target, address, opcode.mnemonic);
      } else if (opcode.mnemonic === 'JMP') {
        if (target !== undefined) addTarget(target, address, opcode.mnemonic);
        break;
      }
      if (['RTS', 'RTI', 'BRK'].includes(opcode.mnemonic)) break;
      address += opcode.size;
    }
  }

  const rows: DisassemblyRow[] = [];
  const decodedAddresses = Array.from(decoded.keys()).sort((left, right) => left - right);
  let decodedAddressIndex = 0;
  let offset = 0;
  while (offset < bytes.length) {
    const instruction = decoded.get(origin + offset);
    if (instruction) {
      rows.push(instruction);
      offset += instruction.bytes.length;
      continue;
    }
    while (decodedAddresses[decodedAddressIndex] !== undefined && decodedAddresses[decodedAddressIndex]! <= origin + offset) decodedAddressIndex += 1;
    const nextInstruction = decodedAddresses[decodedAddressIndex] ?? origin + bytes.length;
    /* A run of undecoded bytes never crosses a marked boundary, so a region the
     * reader described keeps its own row rather than being merged into its
     * neighbours. */
    const covering = markedRegions.find((region) => origin + offset >= region.start && origin + offset <= region.end);
    const nextRegionStart = markedRegions.find((region) => region.start > origin + offset)?.start ?? origin + bytes.length;
    const limit = Math.min(nextInstruction, covering ? covering.end + 1 : nextRegionStart);
    const boundary = limit - origin;
    if (covering?.kind === 'text') {
      const chunk = Array.from(bytes.slice(offset, boundary));
      rows.push({
        address: origin + offset, offset, bytes: chunk, kind: 'text', mnemonic: 'EQUS',
        operand: `"${chunk.map((value) => printableCharacter(value)).join('').replaceAll('"', '\\"')}"`,
        comment: regionComment(covering), references: [], reachable: false,
      });
      offset = boundary;
      continue;
    }
    const textLength = covering ? 0 : isPrintableText(bytes, offset, boundary);
    if (textLength) {
      const chunk = Array.from(bytes.slice(offset, offset + textLength));
      rows.push({
        address: origin + offset, offset, bytes: chunk, kind: 'text', mnemonic: 'EQUS',
        operand: `"${chunk.map((value) => String.fromCharCode(value)).join('').replaceAll('"', '\\"')}"`,
        comment: 'Printable data', references: [], reachable: false,
      });
      offset += textLength;
      continue;
    }
    let count = 1;
    while (offset + count < boundary && count < 8 && (covering ? true : !isPrintableText(bytes, offset + count, boundary))) count += 1;
    const chunk = Array.from(bytes.slice(offset, offset + count));
    rows.push({
      address: origin + offset, offset, bytes: chunk, kind: 'bytes', mnemonic: 'EQUB',
      operand: chunk.map((value) => hex(value, 2)).join(','),
      comment: covering ? regionComment(covering) : 'Unreached data',
      references: [], reachable: false,
    });
    offset += count;
  }

  const labels: Record<number, string> = { [entryPoint]: `program_entry_${hex(entryPoint).slice(1)}` };
  /* Indexed once rather than searched per target. Every branch in a listing
   * contributes a target, so searching the rows for each one is proportional to
   * the square of the listing: a bank of branches spent seconds here finding
   * rows it had just built. */
  const rowByAddress = new Map(rows.map((row) => [row.address, row]));
  for (const [target, references] of controlTargets) {
    const targetRow = rowByAddress.get(target);
    if (targetRow) targetRow.references = references.map((reference) => reference.source);
    if (MOS_CALLS[target]) labels[target] = MOS_CALLS[target]!;
    else if (target >= origin && target < origin + bytes.length && target !== entryPoint) {
      const backwards = references.some((reference) => target <= reference.source);
      const called = references.some((reference) => reference.mnemonic === 'JSR');
      labels[target] = called ? `subroutine_${hex(target).slice(1)}` : backwards ? `loop_${hex(target).slice(1)}` : `location_${hex(target).slice(1)}`;
    }
  }
  semanticLabels(rows, labels, callTargets);
  for (const address of extraEntryPoints) {
    if (labels[address] === undefined) labels[address] = `entry_${hex(address).slice(1)}`;
  }
  /* Names the reader gave win over every generated one. They are applied after
   * generation so a recorded name is never quietly shadowed. */
  const recordedLabels = annotations ? labelLookup(annotations) : new Map<number, string>();
  for (const [address, text] of recordedLabels) labels[address] = text;
  const recordedComments = annotations ? commentLookup(annotations) : new Map<number, string>();

  let accumulator: number | undefined;
  for (const row of rows) {
    row.label = labels[row.address];
    if (row.kind !== 'instruction') {
      accumulator = undefined;
      continue;
    }
    if (row.mnemonic === 'LDA' && row.operand.startsWith('#&')) accumulator = Number.parseInt(row.operand.slice(2), 16);
    else if (['PLA', 'TXA', 'TYA', 'ADC', 'SBC', 'AND', 'ORA', 'EOR'].includes(row.mnemonic)) accumulator = undefined;
    if (row.target !== undefined && labels[row.target]) {
      row.operand = row.operand.replace(hex(row.target), labels[row.target]!);
    }
    const mosPurpose = row.mnemonic === 'JSR' && row.target !== undefined ? MOS_PURPOSES[row.target] : undefined;
    const hardware = hardwareComment(row.target);
    const branch = BRANCH_COMMENTS[row.mnemonic];
    const vdu = row.target === 0xffee && accumulator !== undefined && VDU_CONTROLS[accumulator]
      ? `VDU ${accumulator}: ${VDU_CONTROLS[accumulator]}` : undefined;
    const hinted = indirectTargets.get(row.address);
    const hintNote = hinted ? `Recorded flow to ${hinted.map((target) => labels[target] ?? hex(target)).join(', ')}` : undefined;
    row.comment = [recordedComments.get(row.address), mosPurpose, vdu, hardware, branch, hintNote].filter(Boolean).join(' · ') || undefined;
    if (row.mnemonic === 'JSR') accumulator = undefined;
  }
  /* A comment on a data or text row is still the reader's, so it is kept
   * alongside the generated description rather than replacing it. */
  for (const row of rows) {
    if (row.kind === 'instruction') continue;
    row.label = labels[row.address] ?? row.label;
    const recorded = recordedComments.get(row.address);
    if (recorded) row.comment = row.comment ? `${recorded} · ${row.comment}` : recorded;
  }

  const codeByteCount = rows.filter((row) => row.kind === 'instruction').reduce((sum, row) => sum + row.bytes.length, 0);
  return {
    kind: 'machine-code', processor, origin, entryPoint, rows, labels,
    codeByteCount, dataByteCount: bytes.length - codeByteCount, warnings,
  };
}
