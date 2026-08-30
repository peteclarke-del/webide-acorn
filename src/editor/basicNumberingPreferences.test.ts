// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readBasicNumberingPreferences, writeBasicNumberingPreferences } from './basicNumberingPreferences';

describe('BASIC numbering preferences', () => {
  it('persists separate validated BBC and Atom settings', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(writeBasicNumberingPreferences('bbc', { enabled: false, start: 100, increment: 20 }, storage)).toBe(true);
    expect(writeBasicNumberingPreferences('atom', { enabled: true, start: 5, increment: 5 }, storage)).toBe(true);
    expect(readBasicNumberingPreferences('bbc', storage)).toEqual({ enabled: false, start: 100, increment: 20 });
    expect(readBasicNumberingPreferences('atom', storage)).toEqual({ enabled: true, start: 5, increment: 5 });
  });

  it('recovers defaults from malformed, denied and out-of-range storage', () => {
    expect(readBasicNumberingPreferences('bbc', { getItem: () => '{bad' })).toEqual({ enabled: true, start: 10, increment: 10 });
    expect(readBasicNumberingPreferences('bbc', { getItem: () => JSON.stringify({ enabled: true, start: 40000, increment: 0 }) })).toEqual({ enabled: true, start: 10, increment: 10 });
    expect(writeBasicNumberingPreferences('bbc', { enabled: true, start: -1, increment: 10 }, { setItem: () => undefined })).toBe(false);
  });
});
