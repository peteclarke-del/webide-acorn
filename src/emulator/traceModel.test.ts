import { describe, expect, it } from 'vitest';
import { traceInstructionMatches, traceTriggerMatches, validateTraceConfig } from './traceModel';

const instruction = { opcode: 0xa9, opcodeSpec: 'LDA imm', mnemonic: 'LDA', addressingMode: 'Immediate', length: 2, bytes: [0xa9, 0x41], pageCrossed: false };

describe('hardware trace configuration', () => {
  it('validates bounded capacity and optional address/opcode filters', () => {
    expect(validateTraceConfig({ capacity: 256, addressStart: 0x1900, addressEnd: 0x19ff, opcode: 0xa9, pauseOnMatch: true })).toEqual({ capacity: 256, sampleEvery: 1, captureBus: true, eventKinds: ['instruction'], addressStart: 0x1900, addressEnd: 0x19ff, opcode: 0xa9, pauseOnMatch: true, preTriggerRecords: 0, postTriggerRecords: 0, pauseOnTrigger: false });
    expect(() => validateTraceConfig({ capacity: 32 })).toThrow(/64/);
    expect(() => validateTraceConfig({ capacity: 5000 })).toThrow(/4,096/);
    expect(() => validateTraceConfig({ capacity: 64, addressStart: 0x2000 })).toThrow(/both/);
    expect(() => validateTraceConfig({ capacity: 64, addressStart: 0x2000, addressEnd: 0x1000 })).toThrow(/must not exceed/);
    expect(() => validateTraceConfig({ capacity: 64, opcode: 0x100 })).toThrow(/one byte/);
    expect(() => validateTraceConfig({ capacity: 64, triggerKind: 'opcode', triggerValue: 0x100 })).toThrow(/8-bit/);
    expect(() => validateTraceConfig({ capacity: 64, triggerKind: 'memory-write', triggerValue: 0x2000, preTriggerRecords: 32, postTriggerRecords: 32 })).toThrow(/exceed/);
    expect(validateTraceConfig({ capacity: 64, sampleEvery: 16, captureBus: false })).toMatchObject({ sampleEvery: 16, captureBus: false, eventKinds: ['instruction'] });
    expect(() => validateTraceConfig({ capacity: 64, sampleEvery: 2, triggerKind: 'address', triggerValue: 0x1900 })).toThrow(/every instruction/);
    expect(() => validateTraceConfig({ capacity: 64, captureBus: false, triggerKind: 'memory-write', triggerValue: 0x2000 })).toThrow(/data-bus/);
    expect(validateTraceConfig({ capacity: 64, eventKinds: ['instruction', 'memory-write'] })).toMatchObject({ eventKinds: ['instruction', 'memory-write'] });
    expect(() => validateTraceConfig({ capacity: 64, captureBus: false, eventKinds: ['memory-read'] })).toThrow(/event filters/);
  });

  it('matches the conjunction of address and opcode filters', () => {
    const config = validateTraceConfig({ capacity: 64, addressStart: 0x1900, addressEnd: 0x19ff, opcode: 0xa9 });
    expect(traceInstructionMatches(config, 0x1900, instruction)).toBe(true);
    expect(traceInstructionMatches(config, 0x2000, instruction)).toBe(false);
    expect(traceInstructionMatches(config, 0x1900, { ...instruction, opcode: 0x8d })).toBe(false);
  });

  it('matches independent address, opcode, bus and interrupt triggers', () => {
    const candidate = { pc: 0x1900, instruction, accesses: [{ type: 'write' as const, address: 0x2000 }], interruptBefore: { irqAccepted: false, nmiEdge: false }, interruptAfter: { irqAccepted: true, nmiEdge: false } };
    expect(traceTriggerMatches(validateTraceConfig({ capacity: 64, triggerKind: 'address', triggerValue: 0x1900 }), candidate)).toBe(true);
    expect(traceTriggerMatches(validateTraceConfig({ capacity: 64, triggerKind: 'opcode', triggerValue: 0xa9 }), candidate)).toBe(true);
    expect(traceTriggerMatches(validateTraceConfig({ capacity: 64, triggerKind: 'memory-write', triggerValue: 0x2000 }), candidate)).toBe(true);
    expect(traceTriggerMatches(validateTraceConfig({ capacity: 64, triggerKind: 'memory-read', triggerValue: 0x2000 }), candidate)).toBe(false);
    expect(traceTriggerMatches(validateTraceConfig({ capacity: 64, triggerKind: 'interrupt' }), candidate)).toBe(true);
  });
});
