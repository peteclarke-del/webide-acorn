import { validateArmExecutionAddress } from './armExecutionModel';

export const ARM_BREAKPOINT_OPERATORS = { eq: 1, ne: 2, lt: 3, lte: 4, gt: 5, gte: 6 } as const;
export type ArmBreakpointOperator = keyof typeof ARM_BREAKPOINT_OPERATORS;
export const ARM_BREAKPOINT_ACTIONS = { pause: 0, log: 1, 'pause-log': 2 } as const;
export type ArmBreakpointAction = keyof typeof ARM_BREAKPOINT_ACTIONS;
export interface ArmBreakpointCondition { register: number; operator: ArmBreakpointOperator; value: number }
export interface ArmBreakpointSpec { address: number; hitTarget?: number; condition?: ArmBreakpointCondition; conditions?: ArmBreakpointCondition[]; action?: ArmBreakpointAction; logMessage?: string }
export interface ArmLogpointEvent { sequence: number; address: number; hits: number; registers: number[] }

const ARM_LOG_PLACEHOLDERS = new Set(['pc', 'hits', ...Array.from({ length: 15 }, (_, index) => `r${index}`)]);

export function validateArmBreakpointSpec(spec: ArmBreakpointSpec): ArmBreakpointSpec {
  validateArmExecutionAddress(spec.address);
  if (spec.hitTarget !== undefined && (!Number.isInteger(spec.hitTarget) || spec.hitTarget < 1 || spec.hitTarget > 1_000_000)) throw new Error('ARM breakpoint hit target must be between 1 and 1,000,000');
  if (spec.condition && spec.conditions) throw new Error('Use either condition or conditions, not both');
  const conditions = spec.conditions ?? (spec.condition ? [spec.condition] : []);
  if (conditions.length > 4) throw new Error('ARM breakpoints support at most four AND conditions');
  for (const condition of conditions) {
    if (!Number.isInteger(condition.register) || condition.register < 0 || condition.register > 15 || !(condition.operator in ARM_BREAKPOINT_OPERATORS)) throw new Error('ARM breakpoint condition is invalid');
    if (!Number.isInteger(condition.value) || condition.value < 0 || condition.value > 0xffffffff) throw new Error('ARM breakpoint comparison value must be an unsigned 32-bit integer');
  }
  const action = spec.action ?? 'pause';
  if (!(action in ARM_BREAKPOINT_ACTIONS)) throw new Error('ARM breakpoint action is invalid');
  if (spec.logMessage !== undefined) {
    if (typeof spec.logMessage !== 'string' || spec.logMessage.length > 160) throw new Error('ARM logpoint message must contain at most 160 characters');
    const invalid = [...spec.logMessage.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]!.toLowerCase()).find((placeholder) => !ARM_LOG_PLACEHOLDERS.has(placeholder));
    if (invalid) throw new Error(`Unsupported ARM logpoint placeholder {${invalid}}`);
  }
  if (action !== 'pause' && !spec.logMessage?.trim()) throw new Error('ARM logging actions require a log message');
  return { ...structuredClone(spec), conditions, condition: undefined };
}

export function armBreakpointWireSpec(spec: ArmBreakpointSpec) {
  const valid = validateArmBreakpointSpec(spec);
  const { condition: _condition, conditions, ...rest } = valid;
  return { ...rest, action: ARM_BREAKPOINT_ACTIONS[valid.action ?? 'pause'], conditions: (conditions ?? []).map((item) => ({ ...item, operator: ARM_BREAKPOINT_OPERATORS[item.operator] })) };
}

function formatArmLogValue(value: number) { return `&${(value >>> 0).toString(16).toUpperCase().padStart(8, '0')}`; }

export function renderArmLogpointMessage(template: string, event: ArmLogpointEvent): string {
  if (!Array.isArray(event.registers) || event.registers.length !== 16) throw new Error('ARM logpoint events require all 16 captured registers');
  return template.replace(/\{([^{}]+)\}/g, (token, rawName: string) => {
    const name = rawName.toLowerCase();
    if (name === 'hits') return String(event.hits);
    if (name === 'pc') return formatArmLogValue(event.address);
    if (/^r(?:[0-9]|1[0-4])$/.test(name)) return formatArmLogValue(event.registers[Number(name.slice(1))] ?? 0);
    return token;
  });
}
