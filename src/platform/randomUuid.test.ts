import { describe, expect, it, vi } from 'vitest';
import { installRandomUuidCompatibility, uuidV4FromBytes } from './randomUuid';

describe('random UUID compatibility', () => {
  it('sets RFC 4122 version and variant bits without mutating the source', () => {
    const source = new Uint8Array(16).fill(0xff);
    expect(uuidV4FromBytes(source)).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(source.every((value) => value === 0xff)).toBe(true);
  });

  it('retains a native implementation and installs a secure fallback only when absent', () => {
    const native = vi.fn(() => 'native' as `${string}-${string}-${string}-${string}-${string}`);
    const withNative = { getRandomValues: vi.fn(), randomUUID: native };
    installRandomUuidCompatibility(withNative);
    expect(withNative.randomUUID()).toBe('native');
    const getRandomValues = ((bytes: Uint8Array) => { bytes.fill(0); return bytes; }) as Crypto['getRandomValues'];
    const fallback: Pick<Crypto, 'getRandomValues'> & { randomUUID?: () => `${string}-${string}-${string}-${string}-${string}` } = { getRandomValues };
    installRandomUuidCompatibility(fallback);
    expect(fallback.randomUUID?.()).toBe('00000000-0000-4000-8000-000000000000');
  });
});
