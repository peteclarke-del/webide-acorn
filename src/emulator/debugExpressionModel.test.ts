import { describe, expect, it } from 'vitest';
import { parseDebugExpression, renderDebugMemoryValue } from './debugExpressionModel';

const symbols = { buffer: 0x2000, Done: 0x190a };
const registers = { a: 0x41, x: 3, pc: 0x1900 };

describe('bounded 6502 debug expressions', () => {
  it('resolves live registers, current build symbols and numeric offsets', () => {
    expect(parseDebugExpression('A', symbols, registers)).toEqual({ kind: 'value', value: 0x41, source: 'live A register' });
    expect(parseDebugExpression('done + &10', symbols, registers)).toEqual({ kind: 'value', value: 0x191a, source: 'current build symbol Done + 16' });
  });

  it('creates explicit side-effect-free byte and little-endian word read plans', () => {
    expect(parseDebugExpression('byte(buffer-1)', symbols, registers)).toMatchObject({ kind: 'memory', address: 0x1fff, width: 1 });
    expect(parseDebugExpression('word(&2000)', symbols, registers)).toMatchObject({ kind: 'memory', address: 0x2000, width: 2 });
    expect(renderDebugMemoryValue([0x34, 0x12], 2)).toBe(0x1234);
  });

  it('rejects arbitrary syntax and out-of-range addresses', () => {
    expect(() => parseDebugExpression('window.alert(1)', symbols, registers)).toThrow('Use a register');
    expect(() => parseDebugExpression('word(&FFFF)', symbols, registers)).not.toThrow();
    expect(() => parseDebugExpression('&FFFF+1', symbols, registers)).toThrow('outside the 16-bit');
  });
});
