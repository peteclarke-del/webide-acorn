import { describe, expect, it } from 'vitest';
import { armBreakpointWireSpec, renderArmLogpointMessage, validateArmBreakpointSpec } from './armBreakpointModel';

describe('ARM breakpoint model', () => {
  it('validates and encodes live register comparisons', () => {
    expect(armBreakpointWireSpec({ address: 0x8000, hitTarget: 3, condition: { register: 4, operator: 'gte', value: 0x12345678 } })).toEqual({ address: 0x8000, hitTarget: 3, action: 0, conditions: [{ register: 4, operator: 6, value: 0x12345678 }] });
    expect(armBreakpointWireSpec({ address: 0x8000, conditions: [{ register: 0, operator: 'eq', value: 1 }, { register: 1, operator: 'ne', value: 2 }] }).conditions).toEqual([{ register: 0, operator: 1, value: 1 }, { register: 1, operator: 2, value: 2 }]);
  });
  it('rejects unaligned addresses, invalid registers and unbounded hit targets', () => {
    expect(() => validateArmBreakpointSpec({ address: 0x8002 })).toThrow(/aligned/);
    expect(() => validateArmBreakpointSpec({ address: 0x8000, condition: { register: 16, operator: 'eq', value: 0 } })).toThrow(/condition/);
    expect(() => validateArmBreakpointSpec({ address: 0x8000, hitTarget: 0 })).toThrow(/hit target/);
    expect(() => validateArmBreakpointSpec({ address: 0x8000, conditions: Array.from({ length: 5 }, () => ({ register: 0, operator: 'eq' as const, value: 0 })) })).toThrow(/four/);
    expect(() => validateArmBreakpointSpec({ address: 0x8000, condition: { register: 0, operator: 'eq', value: 0 }, conditions: [] })).toThrow(/either/);
  });
  it('validates logging actions and renders only captured ARM values', () => {
    expect(armBreakpointWireSpec({ address: 0x8004, action: 'log', logMessage: 'loop {hits} PC={pc} R1={r1}' })).toMatchObject({ action: 1, logMessage: 'loop {hits} PC={pc} R1={r1}' });
    expect(() => validateArmBreakpointSpec({ address: 0x8004, action: 'log' })).toThrow(/require a log message/);
    expect(() => validateArmBreakpointSpec({ address: 0x8004, action: 'pause-log', logMessage: '{memory}' })).toThrow(/placeholder/);
    expect(renderArmLogpointMessage('hit {hits} at {PC}; r1={R1}', { sequence: 7, address: 0x8004, hits: 3, registers: [2, 9, ...Array(14).fill(0)] })).toBe('hit 3 at &00008004; r1=&00000009');
  });
});
