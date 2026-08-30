export const ARM26_MAX_ADDRESS = 0x03ffffff;
export const ARM_MEMORY_MAX_READ = 4096;

function parseLiteral(value: string): number | null {
  const text = value.trim();
  if (/^&[0-9a-f]+$/i.test(text)) return Number.parseInt(text.slice(1), 16);
  if (/^\$[0-9a-f]+$/i.test(text)) return Number.parseInt(text.slice(1), 16);
  if (/^0x[0-9a-f]+$/i.test(text)) return Number.parseInt(text.slice(2), 16);
  if (/^[0-9]+$/.test(text)) return Number.parseInt(text, 10);
  return null;
}

function resolveArmExpression(input: string, symbols: Record<string, number>, maximum: number): number | null {
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*|&[0-9a-f]+|\$[0-9a-f]+|0x[0-9a-f]+|[0-9]+)\s*(?:([+-])\s*(&[0-9a-f]+|\$[0-9a-f]+|0x[0-9a-f]+|[0-9]+))?\s*$/i.exec(input);
  if (!match) return null;
  const base = parseLiteral(match[1]!) ?? symbols[match[1]!.toUpperCase()];
  const offset = match[3] ? parseLiteral(match[3]) : 0;
  if (!Number.isInteger(base) || offset === null) return null;
  const result = (base as number) + (match[2] === '-' ? -offset : offset);
  return result >= 0 && result <= maximum ? result : null;
}

export function resolveArmMemoryExpression(input: string, symbols: Record<string, number> = {}): number | null {
  return resolveArmExpression(input, symbols, ARM26_MAX_ADDRESS);
}

export function resolveArmValueExpression(input: string, symbols: Record<string, number> = {}): number | null {
  return resolveArmExpression(input, symbols, 0xffffffff);
}

export function validateArmMemoryRead(address: number, length: number): { address: number; length: number } {
  if (!Number.isInteger(address) || address < 0 || address > ARM26_MAX_ADDRESS) throw new Error('ARM memory address must be a 26-bit integer');
  if (!Number.isInteger(length) || length < 1 || length > ARM_MEMORY_MAX_READ) throw new Error('ARM memory length must be 1–4,096 bytes');
  if (address + length - 1 > ARM26_MAX_ADDRESS) throw new Error('ARM memory read must not wrap past the 26-bit address space');
  return { address, length };
}

export function armMemoryPageAddress(address: number, length: number, direction: -1 | 1): number {
  validateArmMemoryRead(address, length);
  return direction < 0 ? Math.max(0, address - length) : Math.min(ARM26_MAX_ADDRESS - length + 1, address + length);
}

export function readArmLittleEndianWord(address: number, bytes: number[], selectedAddress: number): number | null {
  const offset = selectedAddress - address;
  if (offset < 0 || offset + 3 >= bytes.length) return null;
  return ((bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0);
}

export function formatArmMemoryText(address: number, bytes: number[], columns = 16): string {
  if (![8, 16, 32].includes(columns)) throw new Error('ARM memory export columns must be 8, 16 or 32');
  return Array.from({ length: Math.ceil(bytes.length / columns) }, (_, row) => {
    const slice = bytes.slice(row * columns, (row + 1) * columns);
    const location = `&${(address + row * columns).toString(16).toUpperCase().padStart(8, '0')}`;
    const hex = slice.map((byte) => (byte & 0xff).toString(16).toUpperCase().padStart(2, '0')).join(' ');
    const ascii = slice.map((byte) => byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '·').join('');
    return `${location}  ${hex.padEnd(columns * 3 - 1)}  ${ascii}`;
  }).join('\n');
}
