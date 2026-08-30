import { describe, expect, it } from 'vitest';
import { armSourceLocationKey, armSourceStepOverTarget, validateArmSourceLocations } from './armSourceStepModel';

const locations = { 0x8000: { fileId: 'main', fileName: 'main.s', line: 2 }, 0x8004: { fileId: 'main', fileName: 'main.s', line: 2 }, 0x8008: { fileId: 'main', fileName: 'main.s', line: 3 }, 0x8010: { fileId: 'lib', fileName: 'lib.s', line: 1 } };

describe('ARM source stepping model', () => {
  it('finds the next linear source statement while skipping same-line instructions', () => expect(armSourceStepOverTarget(0x8000, locations)).toBe(0x8008));
  it('returns no target without current debug metadata or a following statement', () => { expect(armSourceStepOverTarget(0x800c, locations)).toBeNull(); expect(armSourceStepOverTarget(0x8010, locations)).toBeNull(); });
  it('validates bounded aligned source metadata and stable location identity', () => {
    expect(validateArmSourceLocations(locations, 0x8000, 0x20)).toEqual(locations);
    expect(armSourceLocationKey(locations[0x8000])).toBe('main:2');
    expect(() => validateArmSourceLocations({ 0x8002: locations[0x8000]! }, 0x8000, 0x20)).toThrow(/aligned/);
  });
});
