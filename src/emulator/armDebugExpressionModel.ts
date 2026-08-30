export type ArmDebugExpressionPlan = { kind: 'value'; value: number; source: string } | { kind: 'memory'; address: number; width: 1 | 2 | 4; source: string };

function numberValue(token: string) {
  if (/^&[0-9a-f]+$/i.test(token)) return Number.parseInt(token.slice(1), 16);
  if (/^0x[0-9a-f]+$/i.test(token)) return Number.parseInt(token.slice(2), 16);
  if (/^\d+$/.test(token)) return Number.parseInt(token, 10);
  return undefined;
}

export function parseArmDebugExpression(expression: string, symbols: Record<string, number>, registers: number[], pc: number): ArmDebugExpressionPlan {
  const text = expression.trim();
  if (!text || text.length > 128) throw new Error('Expression must contain 1 to 128 characters');
  const memory = text.match(/^(u8|u16|u32)\s*\((.*)\)$/i);
  const body = (memory?.[2] ?? text).trim();
  const parts = body.match(/^([A-Za-z_.$][\w.$]*|&[0-9a-f]+|0x[0-9a-f]+|\d+)\s*(?:([+-])\s*(&[0-9a-f]+|0x[0-9a-f]+|\d+))?$/i);
  if (!parts) throw new Error('Use R0 to R15, PC, a build symbol or a number with one optional numeric offset');
  const token = parts[1]!;
  let value = numberValue(token);
  let source = 'numeric literal';
  const register = token.match(/^r(1[0-5]|\d)$/i);
  if (register) { const index = Number(register[1]); value = index === 15 ? pc : registers[index]; source = `live R${index}${index === 15 ? ' execute PC' : ' register'}`; }
  else if (/^pc$/i.test(token)) { value = pc; source = 'live execute PC'; }
  else if (value === undefined) { const symbol = Object.entries(symbols).find(([name]) => name.toLowerCase() === token.toLowerCase()); if (symbol) { value = symbol[1]; source = `current build symbol ${symbol[0]}`; } }
  if (value === undefined) throw new Error(`Unknown ARM register, build symbol or number: ${token}`);
  if (parts[3]) { const offset = numberValue(parts[3])!; value += parts[2] === '-' ? -offset : offset; source += ` ${parts[2]} ${offset}`; }
  if (!Number.isInteger(value) || value < 0 || value > 0x03ffffff) throw new Error('Expression result is outside the ARM 26-bit logical address space');
  if (!memory) return { kind: 'value', value: value >>> 0, source };
  const width = memory[1]!.toLowerCase() === 'u8' ? 1 : memory[1]!.toLowerCase() === 'u16' ? 2 : 4;
  if (value + width > 0x04000000) throw new Error('Memory expression crosses the ARM 26-bit logical address boundary');
  return { kind: 'memory', address: value, width, source: `${memory[1]!.toLowerCase()} from ${source}` };
}

export function renderArmDebugMemoryValue(bytes: number[], width: 1 | 2 | 4) {
  if (bytes.length < width) throw new Error('The emulator returned fewer bytes than the expression requires');
  let value = 0;
  for (let index = 0; index < width; index++) value = (value | (bytes[index]! << (index * 8))) >>> 0;
  return value;
}

export function verifiedArmLinkFrame(artifact: { origin: number; bytes: Uint8Array; symbols: Record<string, number>; sourceLocations: Record<number, { fileName: string; line: number }> } | null, linkRegister: number) {
  const returnAddress = linkRegister & 0x03fffffc;
  const callSite = returnAddress - 4;
  if (!artifact || callSite < artifact.origin || callSite + 3 >= artifact.origin + artifact.bytes.length) return null;
  const offset = callSite - artifact.origin;
  const word = (artifact.bytes[offset]! | artifact.bytes[offset + 1]! << 8 | artifact.bytes[offset + 2]! << 16 | artifact.bytes[offset + 3]! << 24) >>> 0;
  if ((word & 0x0f000000) !== 0x0b000000) return null;
  let displacement = (word & 0x00ffffff) << 2;
  if (displacement & 0x02000000) displacement |= 0xfc000000;
  const target = (callSite + 8 + displacement) & 0x03fffffc;
  const symbol = Object.entries(artifact.symbols).find(([, address]) => address === target)?.[0];
  return { returnAddress, callSite, target, symbol, source: artifact.sourceLocations[callSite], confidence: 'R14 resolves immediately after a BL instruction in the exact current artifact' };
}
