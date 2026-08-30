import { describe, expect, it } from 'vitest';
import { isEmulatorDisplayFilter, validateEmulatorDisplayFilter, validateMachineVolume } from './audioDisplayControlModel';

describe('emulator audio and display controls', () => {
  it('accepts bounded whole volume percentages', () => {
    expect(validateMachineVolume(0)).toBe(0);
    expect(validateMachineVolume(73)).toBe(73);
    expect(validateMachineVolume(100)).toBe(100);
    expect(() => validateMachineVolume(12.5)).toThrow(/whole/);
    expect(() => validateMachineVolume(101)).toThrow(/0 to 100/);
  });

  it('accepts only maintained framebuffer filters', () => {
    expect(isEmulatorDisplayFilter('nearest')).toBe(true);
    expect(validateEmulatorDisplayFilter('linear')).toBe('linear');
    expect(() => validateEmulatorDisplayFilter('crt')).toThrow(/nearest-neighbour/);
  });
});
