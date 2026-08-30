export type WatchpointAccess = 'read' | 'write' | 'change';
export interface WatchpointCondition { operator: 'eq' | 'ne'; value: number }
export interface WatchpointSpec {
  address: number;
  access: WatchpointAccess;
  enabled: boolean;
  condition?: WatchpointCondition;
}

export function validateWatchpointSpec(input: WatchpointSpec): WatchpointSpec {
  if (!Number.isInteger(input.address) || input.address < 0 || input.address >= 0x8000) throw new Error('Watchpoint address must be in mapped main RAM from &0000 to &7FFF');
  if (!['read', 'write', 'change'].includes(input.access)) throw new Error('Watchpoint access must be read, write, or change');
  if (input.condition && (!['eq', 'ne'].includes(input.condition.operator) || !Number.isInteger(input.condition.value) || input.condition.value < 0 || input.condition.value > 0xff)) throw new Error('Watchpoint condition must compare one byte from &00 to &FF');
  return { address: input.address, access: input.access, enabled: !!input.enabled, ...(input.condition ? { condition: { ...input.condition } } : {}) };
}

export function watchpointMatches(spec: WatchpointSpec, oldValue: number | undefined, value: number): boolean {
  if (spec.access === 'change' && oldValue === value) return false;
  if (!spec.condition) return true;
  return spec.condition.operator === 'eq' ? value === spec.condition.value : value !== spec.condition.value;
}

export function watchpointKey(spec: Pick<WatchpointSpec, 'access' | 'address'>): string {
  return `${spec.access}:${spec.address & 0xffff}`;
}
