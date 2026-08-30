import { describe, expect, it } from 'vitest';
import { parseArmDebugExpression, renderArmDebugMemoryValue, verifiedArmLinkFrame } from './armDebugExpressionModel';

describe('bounded ARM debug expressions and link frame', () => {
  it('resolves registers, symbols and typed memory plans', () => {
    expect(parseArmDebugExpression('R2+4', {}, [0, 1, 0x8000], 0x9000)).toMatchObject({ kind: 'value', value: 0x8004 });
    expect(parseArmDebugExpression('u32(buffer)', { buffer: 0x8100 }, [], 0x9000)).toMatchObject({ kind: 'memory', address: 0x8100, width: 4 });
    expect(renderArmDebugMemoryValue([0x78, 0x56, 0x34, 0x12], 4)).toBe(0x12345678);
  });

  it('rejects arbitrary syntax and 26-bit overflow', () => {
    expect(() => parseArmDebugExpression('R0*4', {}, [1], 0)).toThrow('Use R0');
    expect(() => parseArmDebugExpression('&3FFFFFF+1', {}, [], 0)).toThrow('outside');
  });

  it('accepts an R14 frame only when the artifact contains the preceding BL', () => {
    const artifact = { origin: 0x8000, bytes: Uint8Array.of(0, 0, 0, 0xeb), symbols: { callee: 0x8008 }, sourceLocations: { 0x8000: { fileName: 'main.s', line: 4 } } };
    expect(verifiedArmLinkFrame(artifact, 0x8004)).toMatchObject({ callSite: 0x8000, returnAddress: 0x8004, target: 0x8008, symbol: 'callee' });
    expect(verifiedArmLinkFrame({ ...artifact, bytes: Uint8Array.of(0, 0, 0xa0, 0xe1) }, 0x8004)).toBeNull();
  });
});
