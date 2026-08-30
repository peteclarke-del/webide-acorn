export type MemoryRadix = 'hex' | 'decimal';
export type MemoryTextMode = 'ascii' | 'acorn';

export interface MemoryRow { address: number; values: string[]; ascii: string; acorn: string }

const literal = (value: string) => {
  const text = value.trim();
  if (/^&[0-9a-f]+$/i.test(text)) return Number.parseInt(text.slice(1), 16);
  if (/^\$[0-9a-f]+$/i.test(text)) return Number.parseInt(text.slice(1), 16);
  if (/^0x[0-9a-f]+$/i.test(text)) return Number.parseInt(text.slice(2), 16);
  if (/^[0-9]+$/.test(text)) return Number.parseInt(text, 10);
  return null;
};

export function resolveMemoryExpression(input: string, symbols: Record<string, number> = {}) {
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*|&[0-9a-f]+|\$[0-9a-f]+|0x[0-9a-f]+|[0-9]+)\s*(?:([+-])\s*(&[0-9a-f]+|\$[0-9a-f]+|0x[0-9a-f]+|[0-9]+))?\s*$/i.exec(input);
  if (!match) return null;
  const base = literal(match[1]!) ?? symbols[match[1]!.toUpperCase()];
  const offset = match[3] ? literal(match[3]) : 0;
  if (!Number.isInteger(base) || offset === null) return null;
  const value = (base as number) + (match[2] === '-' ? -offset : offset);
  return value >= 0 && value <= 0xffff ? value : null;
}

export function renderMemoryText(byte: number, mode: MemoryTextMode) {
  const value = byte & 0xff;
  if (mode === 'acorn' && value === 0x60) return '£';
  return value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : '·';
}

export function formatMemoryRows(address: number, bytes: number[], width: number, radix: MemoryRadix): MemoryRow[] {
  if (![8, 16, 32].includes(width)) throw new Error('Memory row width must be 8, 16 or 32 bytes');
  return Array.from({ length: Math.ceil(bytes.length / width) }, (_, row) => {
    const slice = bytes.slice(row * width, (row + 1) * width);
    return { address: address + row * width, values: slice.map((byte) => radix === 'hex' ? (byte & 0xff).toString(16).toUpperCase().padStart(2, '0') : String(byte & 0xff).padStart(3, '0')), ascii: slice.map((byte) => renderMemoryText(byte, 'ascii')).join(''), acorn: slice.map((byte) => renderMemoryText(byte, 'acorn')).join('') };
  });
}

export function parseMemorySearch(input: string, mode: 'bytes' | 'text') {
  if (mode === 'text') {
    const bytes = Array.from(new TextEncoder().encode(input));
    if (!bytes.length || bytes.length > 256 || bytes.some((byte) => byte > 0x7f)) throw new Error('Text search requires 1–256 ASCII characters');
    return bytes as Array<number | null>;
  }
  const tokens = input.trim().split(/[\s,]+/).filter(Boolean);
  if (!tokens.length || tokens.length > 256) throw new Error('Byte search requires 1–256 values');
  return tokens.map((token) => {
    if (token === '?' || token === '??') return null;
    const value = Number.parseInt(token.replace(/^(?:&|\$|0x)/i, ''), 16);
    if (!/^(?:&|\$|0x)?[0-9a-f]{1,2}$/i.test(token) || value < 0 || value > 0xff) throw new Error(`Invalid search byte ${token}`);
    return value;
  });
}

export function searchMemory(address: number, bytes: number[], pattern: Array<number | null>, limit = 256) {
  const matches: number[] = [];
  for (let offset = 0; offset + pattern.length <= bytes.length && matches.length < limit; offset++) {
    if (pattern.every((value, index) => value === null || bytes[offset + index] === value)) matches.push(address + offset);
  }
  return matches;
}

export function changedMemoryAddresses(currentAddress: number, current: number[], snapshotAddress: number, snapshot: number[]) {
  const changed = new Set<number>();
  current.forEach((byte, index) => {
    const address = currentAddress + index; const snapshotIndex = address - snapshotAddress;
    if (snapshotIndex >= 0 && snapshotIndex < snapshot.length && snapshot[snapshotIndex] !== byte) changed.add(address);
  });
  return changed;
}

export function readLittleEndianPointer(address: number, bytes: number[], selectedAddress: number) {
  const offset = selectedAddress - address;
  return offset >= 0 && offset + 1 < bytes.length ? bytes[offset]! | (bytes[offset + 1]! << 8) : null;
}
