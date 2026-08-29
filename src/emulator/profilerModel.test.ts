import { describe, expect, it } from 'vitest';
import { compareProfileMetric, profileBuildFingerprint, profilerMemoryRegion, validateProfilerConfig } from './profilerModel';

describe('profiler model', () => {
  it('validates bounded capture settings', () => {
    expect(validateProfilerConfig({ maxAddresses: 256, frameCapacity: 16, captureBus: true })).toEqual({ maxAddresses: 256, frameCapacity: 16, captureBus: true });
    expect(() => validateProfilerConfig({ maxAddresses: 255 })).toThrow(/256/);
    expect(() => validateProfilerConfig({ frameCapacity: 1025 })).toThrow(/1,024/);
  });

  it('classifies mapped bus addresses without inventing device ownership', () => {
    expect(profilerMemoryRegion(0x2000)).toBe('Main RAM');
    expect(profilerMemoryRegion(0x8000)).toBe('Sideways ROM/RAM');
    expect(profilerMemoryRegion(0xc000)).toBe('OS ROM');
    expect(profilerMemoryRegion(0xfe40)).toBe('I/O and expansion');
    expect(profilerMemoryRegion(0xfffc)).toBe('OS ROM and vectors');
  });

  it('creates deterministic build identities and exact metric deltas', () => {
    expect(profileBuildFingerprint([0x60, 0xea], 0x1900)).toBe(profileBuildFingerprint([0x60, 0xea], 0x1900));
    expect(profileBuildFingerprint([0x60, 0xea], 0x1900)).not.toBe(profileBuildFingerprint([0x60, 0xeb], 0x1900));
    expect(compareProfileMetric({ instructions: 12, cycles: 30 }, { instructions: 10, cycles: 25 })).toMatchObject({ instructionDelta: 2, cycleDelta: 5 });
  });
});
