export type BreakpointRegister = 'a' | 'x' | 'y' | 's' | 'p' | 'pc';
export type BreakpointOperator = 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte';

export interface BreakpointCondition {
  register: BreakpointRegister;
  operator: BreakpointOperator;
  value: number;
}

export interface BreakpointSpec {
  address: number;
  enabled: boolean;
  stop: boolean;
  condition?: BreakpointCondition;
  hitTarget?: number;
  logMessage?: string;
}

export interface BreakpointRegisters { a: number; x: number; y: number; s: number; p: number; pc: number }

const REGISTERS = new Set<BreakpointRegister>(['a', 'x', 'y', 's', 'p', 'pc']);
const OPERATORS = new Set<BreakpointOperator>(['eq', 'ne', 'lt', 'lte', 'gt', 'gte']);

export function validateBreakpointSpec(input: BreakpointSpec): BreakpointSpec {
  if (!Number.isInteger(input.address) || input.address < 0 || input.address > 0xffff) throw new Error('Breakpoint address must be a 16-bit address');
  if (input.hitTarget !== undefined && (!Number.isInteger(input.hitTarget) || input.hitTarget < 1 || input.hitTarget > 1_000_000)) throw new Error('Breakpoint hit target must be between 1 and 1,000,000');
  if (input.logMessage !== undefined && input.logMessage.length > 160) throw new Error('Breakpoint log messages are limited to 160 characters');
  if (!input.stop && !input.logMessage?.trim()) throw new Error('A non-stopping breakpoint requires a log message');
  if (input.condition) {
    if (!REGISTERS.has(input.condition.register) || !OPERATORS.has(input.condition.operator)) throw new Error('Breakpoint condition is invalid');
    const maximum = input.condition.register === 'pc' ? 0xffff : 0xff;
    if (!Number.isInteger(input.condition.value) || input.condition.value < 0 || input.condition.value > maximum) throw new Error(`Breakpoint ${input.condition.register.toUpperCase()} value is out of range`);
  }
  return {
    address: input.address,
    enabled: input.enabled,
    stop: input.stop,
    ...(input.condition ? { condition: { ...input.condition } } : {}),
    ...(input.hitTarget === undefined ? {} : { hitTarget: input.hitTarget }),
    ...(input.logMessage?.trim() ? { logMessage: input.logMessage.trim() } : {}),
  };
}

export function breakpointMatches(spec: BreakpointSpec, registers: BreakpointRegisters, hits: number): boolean {
  if (!spec.enabled || (spec.hitTarget !== undefined && hits < spec.hitTarget)) return false;
  if (!spec.condition) return true;
  const actual = registers[spec.condition.register];
  const expected = spec.condition.value;
  switch (spec.condition.operator) {
    case 'eq': return actual === expected;
    case 'ne': return actual !== expected;
    case 'lt': return actual < expected;
    case 'lte': return actual <= expected;
    case 'gt': return actual > expected;
    case 'gte': return actual >= expected;
  }
}

export function renderBreakpointLog(template: string, registers: BreakpointRegisters, hits: number): string {
  return template.replace(/\{(a|x|y|s|p|pc|hits)\}/gi, (_, token: string) => {
    if (token.toLowerCase() === 'hits') return String(hits);
    const register = token.toLowerCase() as BreakpointRegister;
    const width = register === 'pc' ? 4 : 2;
    return `&${registers[register].toString(16).toUpperCase().padStart(width, '0')}`;
  });
}
