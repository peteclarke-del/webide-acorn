import { describe, expect, it } from 'vitest';
import { artifactWindowStart, compareArtifacts, crc32Hex, parseArtifactSearch, searchArtifact } from './artifactInspector';

describe('bounded build artifact inspector model', () => {
  it('parses common Acorn hex notation and finds overlapping byte sequences', () => {
    expect(Array.from(parseArtifactSearch('&A9, $41 0x20', 'hex'))).toEqual([0xa9, 0x41, 0x20]);
    expect(searchArtifact(Uint8Array.from([0x41, 0x41, 0x41]), 'AA', 'text')).toMatchObject({ offsets: [0, 1], total: 2, truncated: false });
    expect(() => parseArtifactSearch('A9 4', 'hex')).toThrow('complete byte pairs');
  });

  it('bounds retained matches without hiding the true count', () => {
    const result = searchArtifact(new Uint8Array(32).fill(0), '00', 'hex', 3);
    expect(result).toMatchObject({ offsets: [0, 1, 2], total: 32, truncated: true });
  });

  it('reports changed, added and removed bytes with a bounded exact diff', () => {
    expect(compareArtifacts(Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 9, 3, 4]))).toEqual({ equal: false, changed: 1, added: 1, removed: 0, differences: [{ offset: 1, left: 2, right: 9 }, { offset: 3, left: undefined, right: 4 }], truncated: false });
    expect(compareArtifacts(Uint8Array.from([1, 2]), Uint8Array.from([1]))).toMatchObject({ removed: 1 });
  });

  it('computes a standard CRC-32 and clamps aligned viewer windows', () => {
    expect(crc32Hex(new TextEncoder().encode('123456789'))).toBe('CBF43926');
    expect(artifactWindowStart(37, 1024)).toBe(32);
    expect(artifactWindowStart(9999, 300)).toBe(48);
    expect(artifactWindowStart(20, 100)).toBe(0);
  });
});
