export type DebugExpressionPlan =
  | { kind: 'value'; value: number; source: string }
  | { kind: 'memory'; address: number; width: 1 | 2; source: string };

function parseNumber(token: string): number | undefined {
  const value = token.trim();
  if (/^&[0-9a-f]+$/i.test(value)) return Number.parseInt(value.slice(1), 16);
  if (/^\$[0-9a-f]+$/i.test(value)) return Number.parseInt(value.slice(1), 16);
  if (/^0x[0-9a-f]+$/i.test(value)) return Number.parseInt(value.slice(2), 16);
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10);
  return undefined;
}

function resolveAtom(token: string, symbols: Record<string, number>, registers: Record<string, number>) {
  const numeric = parseNumber(token);
  if (numeric !== undefined) return { value: numeric, source: 'numeric literal' };
  const register = Object.entries(registers).find(([name]) => name.toLowerCase() === token.toLowerCase());
  if (register) return { value: register[1], source: `live ${register[0].toUpperCase()} register` };
  const symbol = Object.entries(symbols).find(([name]) => name.toLowerCase() === token.toLowerCase());
  if (symbol) return { value: symbol[1], source: `current build symbol ${symbol[0]}` };
  throw new Error(`Unknown register, build symbol or number: ${token}`);
}

function resolveAddress(expression: string, symbols: Record<string, number>, registers: Record<string, number>) {
  const match = expression.trim().match(/^([A-Za-z_.$][\w.$]*|&[0-9a-f]+|\$[0-9a-f]+|0x[0-9a-f]+|\d+)\s*(?:([+-])\s*(&[0-9a-f]+|\$[0-9a-f]+|0x[0-9a-f]+|\d+))?$/i);
  if (!match) throw new Error('Use a register, build symbol or number with one optional numeric + or - offset');
  const base = resolveAtom(match[1]!, symbols, registers);
  const offset = match[3] ? parseNumber(match[3])! * (match[2] === '-' ? -1 : 1) : 0;
  const value = base.value + offset;
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new Error('Expression result is outside the 16-bit address space');
  return { value, source: `${base.source}${offset ? ` ${offset > 0 ? '+' : '-'} ${Math.abs(offset)}` : ''}` };
}

export function parseDebugExpression(expression: string, symbols: Record<string, number>, registers: Record<string, number>): DebugExpressionPlan {
  const text = expression.trim();
  if (!text || text.length > 128) throw new Error('Expression must contain 1 to 128 characters');
  const memory = text.match(/^(byte|word)\s*\((.*)\)$/i);
  if (memory) {
    const address = resolveAddress(memory[2]!, symbols, registers);
    return { kind: 'memory', address: address.value, width: memory[1]!.toLowerCase() === 'word' ? 2 : 1, source: `${memory[1]!.toLowerCase()} from ${address.source}` };
  }
  const value = resolveAddress(text, symbols, registers);
  return { kind: 'value', value: value.value, source: value.source };
}

export function renderDebugMemoryValue(bytes: number[], width: 1 | 2) {
  if (bytes.length < width) throw new Error('The emulator returned fewer bytes than the expression requires');
  return width === 1 ? bytes[0]! : bytes[0]! | (bytes[1]! << 8);
}
