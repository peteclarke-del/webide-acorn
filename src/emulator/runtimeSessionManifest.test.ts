import { describe, expect, it } from 'vitest';
import { createRuntimeSessionManifest, validateRuntimeSessionManifest } from './runtimeSessionManifest';

const input = {
  id: 'session-1', createdAt: '2026-08-25T10:00:00.000Z', adapter: { id: 'jsbeeb' as const, version: '1.19.1' },
  machine: { platformClass: '8bit', machineId: 'bbc-b', label: 'Acorn BBC Model B', variant: 'Model B', model: 'B-DFS0.9', romSetId: 'os12-basic2-dfs', enabledCapabilities: ['sideways-ram', 'dfs'] },
  roms: [{ key: 'os12-basic2-dfs/os.rom', filename: 'os.rom', size: 16384, sha256: 'a'.repeat(64) }],
  boot: { tube: false, extraRoms: [], keyboardLayout: 'physical', runtimeSpeed: 1, fastBootMs: 0 }, substitutions: [], limitations: ['No guest disk write-back export'],
};

describe('immutable runtime session manifest', () => {
  it('normalizes order, fingerprints exact content and deeply freezes collections', () => {
    const manifest = createRuntimeSessionManifest(input);
    expect(manifest.machine.enabledCapabilities).toEqual(['dfs', 'sideways-ram']);
    expect(manifest.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.roms[0])).toBe(true);
    expect(createRuntimeSessionManifest({ ...input, machine: { ...input.machine, enabledCapabilities: [...input.machine.enabledCapabilities].reverse() } }).fingerprint).toBe(manifest.fingerprint);
  });

  it('rejects incomplete ROM provenance and tampered fingerprints', () => {
    expect(() => createRuntimeSessionManifest({ ...input, roms: [] })).toThrow(/at least one/);
    const manifest = createRuntimeSessionManifest(input);
    expect(() => validateRuntimeSessionManifest({ ...manifest, fingerprint: '0'.repeat(64) })).toThrow(/does not match/);
  });

  it('revalidates a structured-cloned manifest', () => {
    const manifest = createRuntimeSessionManifest(input);
    expect(validateRuntimeSessionManifest(JSON.parse(JSON.stringify(manifest))).fingerprint).toBe(manifest.fingerprint);
  });
});
