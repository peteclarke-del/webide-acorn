import { describe, expect, it } from 'vitest';
import { cyclesForPresentationFrame, isRuntimeSpeed, validateRuntimeSpeed } from './runtimeSpeedModel';

describe('qualified emulator runtime speed', () => {
  it('scales real CPU cycle budgets without changing the presentation rate', () => {
    expect(cyclesForPresentationFrame(2_000_000, 0.5)).toBe(20_000);
    expect(cyclesForPresentationFrame(2_000_000, 1)).toBe(40_000);
    expect(cyclesForPresentationFrame(2_000_000, 2)).toBe(80_000);
    expect(cyclesForPresentationFrame(2_000_000, 4)).toBe(160_000);
  });

  it('accepts only maintained rates', () => {
    expect(isRuntimeSpeed(0.5)).toBe(true);
    expect(isRuntimeSpeed(4)).toBe(true);
    expect(isRuntimeSpeed(3)).toBe(false);
    expect(() => validateRuntimeSpeed('2')).toThrow(/0.5x/);
  });

  it('refuses invalid timing inputs', () => {
    expect(() => cyclesForPresentationFrame(0, 1)).toThrow(/positive/);
    expect(() => cyclesForPresentationFrame(2_000_000, 1, 0)).toThrow(/positive/);
  });
});
