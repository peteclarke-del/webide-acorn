import { MOS_CALLS, opcodeTable, type AddressMode } from '../analysis/disassembler6502';
import type { Processor } from '../analysis/types';
import type { BuildProvenance } from './buildTarget';

export interface BuildDiagnostic {
  line: number;
  column: number;
  severity: 'error' | 'warning';
  message: string;
  fileId?: string;
  fileName?: string;
  stage?: string;
}

export interface RetainedArtifactDocument { id: string; label: string; filename: string; content: string; bytes: number; sha256: string }

export interface SourceLocation { fileId: string; fileName: string; line: number }

export interface AssemblyArtifact {
  kind: '6502-binary';
  bytes: Uint8Array;
  origin: number;
  entryPoint: number;
  processor: Processor;
  symbols: Record<string, number>;
  sourceMap: Record<number, number>;
  sourceLocations: Record<number, SourceLocation>;
  entryFileId: string;
  dependencies: string[];
  sourceFiles: Record<string, { name: string; content: string }>;
  diagnostics: BuildDiagnostic[];
  listing: string[];
  retainedDocuments?: RetainedArtifactDocument[];
  provenance?: BuildProvenance;
}

interface ParsedLine {
  line: number;
  source: string;
  label?: string;
  operation?: string;
  operand: string;
  address: number;
  size: number;
}

const BRANCHES = new Set(['BCC', 'BCS', 'BEQ', 'BMI', 'BNE', 'BPL', 'BRA', 'BVC', 'BVS']);

export function assemble6502(source: string, processor: Processor = '6502', defaultOrigin = 0x1900, initialSymbols: Record<string, number> = {}): AssemblyArtifact {
  const diagnostics: BuildDiagnostic[] = [];
  const symbols: Record<string, number> = {
    ...Object.fromEntries(Object.entries(MOS_CALLS).map(([address, name]) => [name, Number(address)])),
    ...Object.fromEntries(Object.entries(initialSymbols).map(([name, value]) => [name.toUpperCase(), value])),
  };
  const parsed: ParsedLine[] = [];
  let pc = defaultOrigin;
  let firstOrigin: number | undefined;

  source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n').forEach((sourceLine, index) => {
    const lineNumber = index + 1;
    const code = stripComment(sourceLine).trim();
    const row: ParsedLine = { line: lineNumber, source: sourceLine, operand: '', address: pc, size: 0 };
    if (!code) { parsed.push(row); return; }

    let remainder = code;
    const labelMatch = remainder.match(/^(?:\.([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*):)\s*/);
    if (labelMatch) {
      row.label = (labelMatch[1] ?? labelMatch[2])!;
      const key = row.label.toUpperCase();
      if (symbols[key] !== undefined) diagnostic(diagnostics, lineNumber, `Duplicate symbol ${row.label}`);
      else symbols[key] = pc;
      remainder = remainder.slice(labelMatch[0].length).trim();
    }
    if (!remainder) { parsed.push(row); return; }

    const assignment = remainder.match(/^(?:\*\s*=|ORG\b)\s*(.+)$/i);
    if (assignment) {
      const value = evaluate(assignment[1]!, symbols);
      if (value === undefined || value < 0 || value > 0xffff) diagnostic(diagnostics, lineNumber, 'ORG requires a 16-bit constant');
      else { pc = value; row.address = value; firstOrigin ??= value; }
      row.operation = 'ORG'; row.operand = assignment[1]!.trim(); parsed.push(row); return;
    }

    /* A symbolic constant: `OSWRCH = &FFEE`. BeebAsm accepts these and real
     * Acorn source is full of them, so source imported from a BeebAsm project
     * assembled everywhere except here until this was added. The value has to
     * be evaluable where it is written — a constant that depends on a label
     * defined further down is reported rather than silently resolved to zero. */
    const constant = remainder.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (constant) {
      const key = constant[1]!.toUpperCase();
      const value = evaluate(constant[2]!, symbols);
      if (value === undefined) diagnostic(diagnostics, lineNumber, `${constant[1]} is assigned an expression that cannot be evaluated here: ${constant[2]!.trim()}`);
      else if (value < 0 || value > 0xffff) diagnostic(diagnostics, lineNumber, `${constant[1]} is assigned ${value}, which is not a 16-bit value`);
      /* Restating a known address at the value it already has is what real
       * Acorn source does — `OSWRCH = &FFEE` appears at the top of almost every
       * listing, and this assembler already knows the MOS calls. Agreeing is
       * accepted; disagreeing is reported with both values, because that is a
       * genuine mistake rather than a restatement. */
      else if (symbols[key] !== undefined && symbols[key] !== value) diagnostic(diagnostics, lineNumber, `${constant[1]} is already ${hex(symbols[key]!)} and cannot be reassigned to ${hex(value)}`);
      else symbols[key] = value;
      parsed.push(row);
      return;
    }

    const parts = remainder.match(/^([A-Za-z]{2,8})\b\s*(.*)$/);
    if (!parts) { diagnostic(diagnostics, lineNumber, 'Expected an instruction, directive, label, or ORG'); parsed.push(row); return; }
    row.operation = parts[1]!.toUpperCase();
    row.operand = parts[2]!.trim();
    row.address = pc;
    firstOrigin ??= pc;
    row.size = estimateSize(row.operation, row.operand, processor, symbols, diagnostics, lineNumber);
    if (row.size > 0x10000 - pc) {
      diagnostic(diagnostics, lineNumber, `Output of ${row.size} bytes exceeds the 16-bit address space at ${hex(pc)}`);
      row.operation = undefined; row.size = 0;
    } else pc += row.size;
    parsed.push(row);
  });

  const origin = firstOrigin ?? defaultOrigin;
  const chunks: Array<{ address: number; bytes: number[]; line: number; source: string }> = [];
  const sourceMap: Record<number, number> = {};
  for (const row of parsed) {
    if (!row.operation || row.operation === 'ORG') continue;
    const bytes = encode(row.operation, row.operand, row.address, processor, symbols, diagnostics, row.line);
    if (!bytes) continue;
    chunks.push({ address: row.address, bytes, line: row.line, source: row.source });
    bytes.forEach((_, offset) => { sourceMap[(row.address + offset) & 0xffff] = row.line; });
  }

  const end = chunks.reduce((maximum, chunk) => Math.max(maximum, chunk.address + chunk.bytes.length), origin);
  const bytes = new Uint8Array(Math.max(0, end - origin));
  chunks.forEach((chunk) => bytes.set(chunk.bytes, chunk.address - origin));
  const entryPoint = symbols.START ?? symbols.ENTRY ?? origin;
  const listing = chunks.map((chunk) => `${hex(chunk.address)}  ${chunk.bytes.map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ').padEnd(10)}  ${chunk.source.trim()}`);
  const sourceLocations = Object.fromEntries(Object.entries(sourceMap).map(([address, line]) => [address, { fileId: '', fileName: 'source', line }]));
  return { kind: '6502-binary', bytes, origin, entryPoint, processor, symbols, sourceMap, sourceLocations, entryFileId: '', dependencies: [], sourceFiles: { source: { name: 'source', content: source } }, diagnostics, listing };
}

function estimateSize(operation: string, operand: string, processor: Processor, symbols: Record<string, number>, diagnostics: BuildDiagnostic[], line: number): number {
  if (operation === 'SKIP') {
    const reserved = evaluate(operand, symbols);
    if (reserved === undefined || reserved < 1 || reserved > 0x10000) { diagnostic(diagnostics, line, 'SKIP requires a constant reservation of 1 to 65,536 bytes'); return 0; }
    return reserved;
  }
  if (operation === 'EQUB' || operation === 'BYTE') return dataItems(operand).reduce((sum, item) => sum + (isString(item) ? decodeString(item).length : 1), 0);
  if (operation === 'EQUS' || operation === 'TEXT') return decodeString(operand).length;
  if (operation === 'EQUW' || operation === 'WORD') return dataItems(operand).length * 2;
  const mode = addressingMode(operation, operand, symbols);
  const opcode = opcodeFor(operation, mode, processor);
  if (opcode === undefined) { diagnostic(diagnostics, line, `${operation} does not support ${mode} addressing on ${processor.toUpperCase()}`); return 0; }
  return modeSize(mode);
}

function encode(operation: string, operand: string, address: number, processor: Processor, symbols: Record<string, number>, diagnostics: BuildDiagnostic[], line: number): number[] | undefined {
  /* Reserved space advances the program counter in pass one but contributes no
   * bytes, so a trailing reservation never pads the emitted binary. */
  if (operation === 'SKIP') return undefined;
  if (operation === 'EQUB' || operation === 'BYTE') {
    return dataItems(operand).flatMap((item) => isString(item) ? decodeString(item) : [checkedByte(item, symbols, diagnostics, line)]);
  }
  if (operation === 'EQUS' || operation === 'TEXT') return decodeString(operand);
  if (operation === 'EQUW' || operation === 'WORD') return dataItems(operand).flatMap((item) => {
    const value = requiredValue(item, symbols, diagnostics, line);
    return [value & 0xff, value >>> 8 & 0xff];
  });
  const mode = addressingMode(operation, operand, symbols);
  const opcode = opcodeFor(operation, mode, processor);
  if (opcode === undefined) return undefined;
  if (mode === 'imp' || mode === 'acc') return [opcode];
  const expression = operand.replace(/^#/, '').replace(/^\(/, '').replace(/\)(?:,Y)?$/i, '').replace(/,[XY]$/i, '').trim();
  const value = requiredValue(expression, symbols, diagnostics, line);
  if (mode === 'rel') {
    const displacement = value - address - 2;
    if (displacement < -128 || displacement > 127) diagnostic(diagnostics, line, `Branch target is out of range (${displacement})`);
    return [opcode, displacement & 0xff];
  }
  return modeSize(mode) === 2 ? [opcode, value & 0xff] : [opcode, value & 0xff, value >>> 8 & 0xff];
}

function addressingMode(operation: string, operand: string, symbols: Record<string, number>): AddressMode {
  if (!operand) return 'imp';
  if (operand.toUpperCase() === 'A') return 'acc';
  if (BRANCHES.has(operation)) return 'rel';
  if (operand.startsWith('#')) return 'imm';
  if (/^\(.+,X\)$/i.test(operand)) {
    const value = evaluate(operand.slice(1, -3), symbols);
    return value !== undefined && value <= 0xff ? 'indx' : 'iax';
  }
  if (/^\(.+\),Y$/i.test(operand)) return 'indy';
  if (/^\(.+\)$/i.test(operand)) return evaluate(operand.slice(1, -1), symbols) !== undefined && evaluate(operand.slice(1, -1), symbols)! <= 0xff ? 'zpi' : 'ind';
  const indexed = operand.match(/^(.*),([XY])$/i);
  const expression = indexed?.[1]?.trim() ?? operand;
  const literal = /^\s*(?:&[0-9a-f]+|\$[0-9a-f]+|%[01]+|\d+|'[^']')\s*$/i.test(expression);
  const value = evaluate(expression, symbols);
  const zeroPage = literal && value !== undefined && value <= 0xff;
  if (indexed?.[2]?.toUpperCase() === 'X') return zeroPage ? 'zpx' : 'absx';
  if (indexed?.[2]?.toUpperCase() === 'Y') return zeroPage ? 'zpy' : 'absy';
  return zeroPage ? 'zp' : 'abs';
}

function opcodeFor(mnemonic: string, mode: AddressMode, processor: Processor): number | undefined {
  const index = opcodeTable(processor).findIndex((opcode) => opcode?.mnemonic === mnemonic && opcode.mode === mode);
  return index < 0 ? undefined : index;
}

function modeSize(mode: AddressMode): number {
  return ['imp', 'acc'].includes(mode) ? 1 : ['abs', 'absx', 'absy', 'ind', 'iax'].includes(mode) ? 3 : 2;
}

function evaluate(expression: string, symbols: Record<string, number>): number | undefined {
  const trimmed = expression.trim();
  /* Acorn-style low/high byte selection. Any real program needs these to load a
   * 16-bit label into an 8-bit register or zero-page pointer. */
  const selector = /^([<>])\s*(.+)$/s.exec(trimmed);
  if (selector) {
    const value = evaluate(selector[2]!, symbols);
    if (value === undefined || value < 0 || value > 0xffff) return undefined;
    return selector[1] === '<' ? value & 0xff : (value >>> 8) & 0xff;
  }
  const match = trimmed.match(/^(.+?)(?:\s*([+-])\s*(.+))?$/);
  if (!match) return undefined;
  const base = atom(match[1]!, symbols);
  if (base === undefined) return undefined;
  if (!match[2]) return base;
  const offset = atom(match[3]!, symbols);
  if (offset === undefined) return undefined;
  return match[2] === '+' ? base + offset : base - offset;
}

function atom(value: string, symbols: Record<string, number>): number | undefined {
  const token = value.trim();
  if (/^&[0-9a-f]+$/i.test(token)) return Number.parseInt(token.slice(1), 16);
  if (/^\$[0-9a-f]+$/i.test(token)) return Number.parseInt(token.slice(1), 16);
  if (/^%[01]+$/i.test(token)) return Number.parseInt(token.slice(1), 2);
  if (/^\d+$/.test(token)) return Number.parseInt(token, 10);
  if (/^'.'$/s.test(token)) return token.charCodeAt(1);
  return symbols[token.toUpperCase()];
}

function requiredValue(expression: string, symbols: Record<string, number>, diagnostics: BuildDiagnostic[], line: number): number {
  const value = evaluate(expression, symbols);
  if (value === undefined) { diagnostic(diagnostics, line, `Unknown or invalid expression: ${expression}`); return 0; }
  if (value < 0 || value > 0xffff) diagnostic(diagnostics, line, `Value is outside the 16-bit range: ${expression}`);
  return value & 0xffff;
}

function checkedByte(expression: string, symbols: Record<string, number>, diagnostics: BuildDiagnostic[], line: number): number {
  const value = requiredValue(expression, symbols, diagnostics, line);
  if (value > 0xff) diagnostic(diagnostics, line, `Byte value is outside the 8-bit range: ${expression}`);
  return value & 0xff;
}

function stripComment(line: string): string {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') quoted = !quoted;
    if (line[index] === ';' && !quoted) return line.slice(0, index);
  }
  return line;
}

function dataItems(value: string): string[] {
  const items: string[] = []; let quoted = false; let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '"') quoted = !quoted;
    if (value[index] === ',' && !quoted) { items.push(value.slice(start, index).trim()); start = index + 1; }
  }
  const final = value.slice(start).trim(); if (final) items.push(final);
  return items;
}

function isString(value: string): boolean { return /^".*"$/s.test(value.trim()); }
function decodeString(value: string): number[] { return Array.from(value.trim().slice(1, -1)).map((character) => character.charCodeAt(0) & 0xff); }
function diagnostic(diagnostics: BuildDiagnostic[], line: number, message: string) { diagnostics.push({ line, column: 1, severity: 'error', message }); }
function hex(value: number) { return `&${value.toString(16).toUpperCase().padStart(4, '0')}`; }
