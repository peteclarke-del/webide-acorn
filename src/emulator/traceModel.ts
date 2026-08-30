import type { DecodedInstructionState } from './instructionState';

export type TraceEventKind = 'instruction' | 'memory-read' | 'memory-write' | 'interrupt';

export interface TraceConfig {
  capacity: number;
  sampleEvery: number;
  captureBus: boolean;
  eventKinds: TraceEventKind[];
  addressStart?: number;
  addressEnd?: number;
  opcode?: number;
  pauseOnMatch: boolean;
  trigger?: { kind: 'address' | 'opcode' | 'memory-read' | 'memory-write' | 'interrupt'; value?: number };
  preTriggerRecords: number;
  postTriggerRecords: number;
  pauseOnTrigger: boolean;
}

export interface TraceTriggerCandidate {
  pc: number;
  instruction: DecodedInstructionState;
  accesses: Array<{ type: 'read' | 'write'; address: number }>;
  interruptBefore: { irqAccepted: boolean; nmiEdge: boolean };
  interruptAfter: { irqAccepted: boolean; nmiEdge: boolean };
}

export function validateTraceConfig(input: Record<string, unknown>): TraceConfig {
  const capacity = input.capacity;
  if (!Number.isInteger(capacity) || (capacity as number) < 64 || (capacity as number) > 4096) throw new Error('Trace capacity must be between 64 and 4,096 records');
  const optional16 = (name: 'addressStart' | 'addressEnd') => {
    const value = input[name];
    if (value === undefined) return undefined;
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 0xffff) throw new Error(`${name} must be a 16-bit address`);
    return value as number;
  };
  const addressStart = optional16('addressStart');
  const addressEnd = optional16('addressEnd');
  if ((addressStart === undefined) !== (addressEnd === undefined)) throw new Error('Trace address filter requires both start and end');
  if (addressStart !== undefined && addressEnd !== undefined && addressStart > addressEnd) throw new Error('Trace address start must not exceed its end');
  const opcode = input.opcode;
  if (opcode !== undefined && (!Number.isInteger(opcode) || (opcode as number) < 0 || (opcode as number) > 0xff)) throw new Error('Trace opcode filter must be one byte');
  const triggerKind = input.triggerKind;
  const captureBus = input.captureBus === undefined ? true : Boolean(input.captureBus);
  const rawEventKinds = input.eventKinds ?? ['instruction'];
  if (!Array.isArray(rawEventKinds) || rawEventKinds.length < 1 || rawEventKinds.length > 4 || rawEventKinds.some((kind) => !['instruction', 'memory-read', 'memory-write', 'interrupt'].includes(String(kind)))) throw new Error('Trace event filters must select one or more supported event kinds');
  const eventKinds = Array.from(new Set(rawEventKinds as TraceEventKind[]));
  const sampleEvery = Number(input.sampleEvery ?? 1);
  if (!Number.isInteger(sampleEvery) || sampleEvery < 1 || sampleEvery > 1024) throw new Error('Trace sampling interval must be 1–1,024 instructions');
  if (triggerKind !== undefined && sampleEvery !== 1) throw new Error('Triggered trace requires every instruction to be sampled');
  if ((triggerKind === 'memory-read' || triggerKind === 'memory-write') && !captureBus) throw new Error('Memory triggers require data-bus capture');
  if (eventKinds.some((kind) => kind === 'memory-read' || kind === 'memory-write') && !captureBus) throw new Error('Memory event filters require data-bus capture');
  if (triggerKind !== undefined && !['address', 'opcode', 'memory-read', 'memory-write', 'interrupt'].includes(String(triggerKind))) throw new Error('Trace trigger kind is unsupported');
  const triggerValue = input.triggerValue;
  const triggerNeedsValue = triggerKind !== undefined && triggerKind !== 'interrupt';
  if (triggerNeedsValue && (!Number.isInteger(triggerValue) || (triggerValue as number) < 0 || (triggerValue as number) > (triggerKind === 'opcode' ? 0xff : 0xffff))) throw new Error(`Trace ${triggerKind} trigger requires ${triggerKind === 'opcode' ? 'an 8-bit opcode' : 'a 16-bit address'}`);
  const preTriggerRecords = input.preTriggerRecords ?? 0;
  const postTriggerRecords = input.postTriggerRecords ?? 0;
  if (!Number.isInteger(preTriggerRecords) || (preTriggerRecords as number) < 0 || (preTriggerRecords as number) >= (capacity as number)) throw new Error('Pre-trigger records must fit inside the trace capacity');
  if (!Number.isInteger(postTriggerRecords) || (postTriggerRecords as number) < 0 || (postTriggerRecords as number) >= (capacity as number)) throw new Error('Post-trigger records must fit inside the trace capacity');
  if (triggerKind !== undefined && (preTriggerRecords as number) + (postTriggerRecords as number) + 1 > (capacity as number)) throw new Error('Pre-trigger, trigger and post-trigger records exceed trace capacity');
  return {
    capacity: capacity as number, sampleEvery, captureBus, eventKinds, addressStart, addressEnd, opcode: opcode as number | undefined, pauseOnMatch: Boolean(input.pauseOnMatch),
    trigger: triggerKind === undefined ? undefined : { kind: triggerKind as NonNullable<TraceConfig['trigger']>['kind'], ...(triggerNeedsValue ? { value: triggerValue as number } : {}) },
    preTriggerRecords: preTriggerRecords as number, postTriggerRecords: postTriggerRecords as number, pauseOnTrigger: Boolean(input.pauseOnTrigger),
  };
}

export function traceInstructionMatches(config: TraceConfig, pc: number, instruction: DecodedInstructionState) {
  if (config.addressStart !== undefined && config.addressEnd !== undefined && (pc < config.addressStart || pc > config.addressEnd)) return false;
  if (config.opcode !== undefined && instruction.opcode !== config.opcode) return false;
  return true;
}

export function traceTriggerMatches(config: TraceConfig, record: TraceTriggerCandidate) {
  const trigger = config.trigger;
  if (!trigger) return false;
  if (trigger.kind === 'address') return record.pc === trigger.value;
  if (trigger.kind === 'opcode') return record.instruction.opcode === trigger.value;
  if (trigger.kind === 'memory-read' || trigger.kind === 'memory-write') return record.accesses.some((access) => access.type === (trigger.kind === 'memory-read' ? 'read' : 'write') && access.address === trigger.value);
  return record.interruptBefore.irqAccepted !== record.interruptAfter.irqAccepted || record.interruptBefore.nmiEdge !== record.interruptAfter.nmiEdge;
}
