import { describe, expect, it } from 'vitest';
import { validateWatchpointSpec, watchpointKey, watchpointMatches, type WatchpointSpec } from './watchpointModel';

describe('hardware watchpoint model', () => {
  const change: WatchpointSpec = { address: 0x2000, access: 'change', enabled: true };

  it('validates the exact supported one-byte main-RAM scope', () => {
    expect(validateWatchpointSpec({ ...change, condition: { operator: 'eq', value: 0x41 } })).toEqual({ ...change, condition: { operator: 'eq', value: 0x41 } });
    expect(() => validateWatchpointSpec({ ...change, address: 0x8000 })).toThrow(/main RAM/);
    expect(() => validateWatchpointSpec({ ...change, condition: { operator: 'eq', value: 256 } })).toThrow(/one byte/);
  });

  it('distinguishes write access from actual value changes', () => {
    expect(watchpointMatches({ ...change, access: 'write' }, 0x10, 0x10)).toBe(true);
    expect(watchpointMatches(change, 0x10, 0x10)).toBe(false);
    expect(watchpointMatches(change, 0x10, 0x11)).toBe(true);
  });

  it('applies byte conditions and creates access-specific identities', () => {
    expect(watchpointMatches({ ...change, condition: { operator: 'eq', value: 0x41 } }, 0, 0x41)).toBe(true);
    expect(watchpointMatches({ ...change, condition: { operator: 'ne', value: 0x41 } }, 0, 0x41)).toBe(false);
    expect(watchpointKey(change)).toBe('change:8192');
    expect(watchpointKey({ ...change, access: 'read' })).toBe('read:8192');
  });
});
