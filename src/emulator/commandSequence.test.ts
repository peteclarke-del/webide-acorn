import { describe, expect, it } from 'vitest';
import { CommandSequence } from './commandSequence';

describe('isolated emulator command sequence', () => {
  it('accepts strictly increasing command IDs and rejects duplicates or stale delivery', () => {
    const sequence = new CommandSequence();
    expect(sequence.accept(1)).toBe(true);
    expect(sequence.accept(1)).toBe(false);
    expect(sequence.accept(0)).toBe(false);
    expect(sequence.accept(3)).toBe(true);
    expect(sequence.accept(2)).toBe(false);
  });

  it('allows unsequenced lifecycle controls and resets for a new machine session', () => {
    const sequence = new CommandSequence();
    expect(sequence.accept(undefined)).toBe(true);
    expect(sequence.accept(9)).toBe(true);
    sequence.reset();
    expect(sequence.accept(1)).toBe(true);
  });

  it('rejects non-integer and unsafe IDs', () => {
    const sequence = new CommandSequence();
    expect(sequence.accept(Number.NaN)).toBe(false);
    expect(sequence.accept(1.5)).toBe(false);
    expect(sequence.accept(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  });
});
