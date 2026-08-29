import { describe, expect, it } from 'vitest';
import { appendReplayWriteDigest, replayVerificationMatches, validateReplayConfig } from './replayModel';

describe('deterministic replay model', () => {
  it('bounds checkpoint memory and instruction history', () => {
    expect(validateReplayConfig({ checkpointInterval: 64, checkpointCapacity: 16 })).toEqual({ checkpointInterval: 64, checkpointCapacity: 16 });
    expect(() => validateReplayConfig({ checkpointInterval: 0 })).toThrow(/1–4,096/);
    expect(() => validateReplayConfig({ checkpointInterval: 4096, checkpointCapacity: 64 })).toThrow(/65,536/);
  });

  it('produces an order-sensitive deterministic bus-write digest', () => {
    const first = appendReplayWriteDigest(0x811c9dc5, 0x2000, 0x41);
    expect(first).toBe(appendReplayWriteDigest(0x811c9dc5, 0x2000, 0x41));
    expect(first).not.toBe(appendReplayWriteDigest(0x811c9dc5, 0x2001, 0x41));
  });

  it('requires every captured verification field to match', () => {
    const state = { pc: 0x1900, a: 1, x: 2, y: 3, s: 0xff, p: 0x30, cycle: 100, writeDigest: 42 };
    expect(replayVerificationMatches(state, { ...state })).toBe(true);
    const boundaryWithMetadata = { ...state, index: 7, source: 'main.asm:4' };
    expect(replayVerificationMatches(boundaryWithMetadata, { ...state })).toBe(true);
    expect(replayVerificationMatches(state, { ...state, writeDigest: 43 })).toBe(false);
  });
});
