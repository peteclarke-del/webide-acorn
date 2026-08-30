// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  PROFILE_MANIFEST_SCHEMA,
  PROFILE_MANIFEST_VERSION,
  ProfileManifestError,
  manifestNoteSummary,
  readProfileManifest,
  writeProfileManifest,
} from './profileManifest';
import { machineProfiles } from '../data/machines';

const manifest = (overrides: Record<string, unknown> = {}, version = PROFILE_MANIFEST_VERSION) => ({
  schema: PROFILE_MANIFEST_SCHEMA,
  version,
  profile: {
    id: 'bbc-b-clone',
    platformClass: '8-16-bit',
    family: 'BBC Micro',
    label: 'A machine from elsewhere',
    shortLabel: 'Elsewhere',
    generation: '1981',
    cpu: 'MOS 6502A @ 2 MHz',
    memory: '32 KB RAM',
    variants: ['Standard'],
    roms: [{ id: 'os12', label: 'OS 1.20', detail: 'Canonical' }],
    capabilities: [{ id: 'dfs', label: 'DFS disk system', description: 'Disk', state: 'supported' }],
    accent: '#dfc782',
    ...overrides,
  },
});

describe('a manifest this build can read', () => {
  it('round-trips a shipped profile without changing it or reporting anything', () => {
    /* The catalogue this build ships must survive its own writer and reader,
     * or the format does not describe the thing it claims to. */
    for (const profile of machineProfiles) {
      const result = readProfileManifest(writeProfileManifest(profile));
      expect(result.profile.id, profile.id).toBe(profile.id);
      expect(result.profile.variants, profile.id).toEqual(profile.variants);
      expect(result.profile.capabilities.map((capability) => capability.id), profile.id).toEqual(profile.capabilities.map((capability) => capability.id));
      expect(result.notes, profile.id).toEqual([]);
    }
  });

  it('writes the version this build produces', () => {
    expect(writeProfileManifest(machineProfiles[0]!)).toMatchObject({
      schema: PROFILE_MANIFEST_SCHEMA,
      version: PROFILE_MANIFEST_VERSION,
    });
  });
});

describe('a manifest from another version', () => {
  it('reads version 1 and says it migrated it forward', () => {
    const result = readProfileManifest(manifest({}, 1));
    expect(result.from).toBe(1);
    expect(result.notes.map((note) => note.kind)).toContain('migrated');
    expect(result.notes.find((note) => note.kind === 'migrated')!.reason).toContain(String(PROFILE_MANIFEST_VERSION));
  });

  it('reads a version 1 capability as unrestricted, because that is what version 1 meant', () => {
    /* Version 1 had no per-variant restriction. Carrying the field forward from
     * a document that could not express it would invent a restriction. */
    const result = readProfileManifest(manifest({
      capabilities: [{ id: 'dfs', label: 'DFS', description: '', state: 'supported', requiresVariant: 'Some variant' }],
    }, 1));
    expect(result.profile.capabilities[0]!.requiresVariant).toBeUndefined();
  });

  it('keeps a version 2 capability’s variant restriction', () => {
    const result = readProfileManifest(manifest({
      capabilities: [{ id: 'adfs', label: 'ADFS', description: '', state: 'supported', requiresVariant: 'Model B · 1770 DFS' }],
    }));
    expect(result.profile.capabilities[0]!.requiresVariant).toBe('Model B · 1770 DFS');
    expect(result.notes).toEqual([]);
  });

  it('refuses a manifest from a newer build by name rather than calling it broken', () => {
    expect(() => readProfileManifest(manifest({}, PROFILE_MANIFEST_VERSION + 1)))
      .toThrow(`newer version of the workbench (manifest version ${PROFILE_MANIFEST_VERSION + 1}; this build reads up to ${PROFILE_MANIFEST_VERSION})`);
  });

  it('refuses a version that is not a whole number at least one', () => {
    for (const version of [0, -1, 1.5, '2', null]) {
      expect(() => readProfileManifest(manifest({}, version as number)), String(version)).toThrow(ProfileManifestError);
    }
  });
});

describe('a manifest that is not one', () => {
  it('refuses anything that does not declare the schema', () => {
    expect(() => readProfileManifest({ version: 1, profile: {} })).toThrow(/must declare schema/);
    expect(() => readProfileManifest({ schema: 'something-else', version: 1, profile: {} })).toThrow(/must declare schema/);
    expect(() => readProfileManifest(null)).toThrow(/must be an object/);
    expect(() => readProfileManifest('a string')).toThrow(/must be an object/);
  });

  it('refuses one that carries no profile, or a profile with no identity', () => {
    expect(() => readProfileManifest({ schema: PROFILE_MANIFEST_SCHEMA, version: 1 })).toThrow(/carries no machine profile/);
    expect(() => readProfileManifest(manifest({ id: '' }))).toThrow(/identifier and a label/);
    expect(() => readProfileManifest(manifest({ label: '   ' }))).toThrow(/identifier and a label/);
  });
});

describe('fields this build cannot use', () => {
  it('drops a capability whose state is not one this product defines, rather than guessing', () => {
    /* Defaulting to supported would claim hardware; defaulting to planned would
     * silently remove a capability the machine has. Neither is this build's
     * decision, so the entry is dropped and named. */
    const result = readProfileManifest(manifest({
      capabilities: [
        { id: 'dfs', label: 'DFS', description: '', state: 'supported' },
        { id: 'mystery', label: 'Mystery board', description: '', state: 'probably' },
        { id: 'nostate', label: 'No state', description: '' },
      ],
    }));
    expect(result.profile.capabilities.map((capability) => capability.id)).toEqual(['dfs']);
    const dropped = result.notes.filter((note) => note.kind === 'dropped-capability');
    expect(dropped).toHaveLength(2);
    expect(dropped[0]!.reason).toMatch(/will not guess/i);
  });

  it('drops a capability or ROM with no identity, naming what it dropped', () => {
    const result = readProfileManifest(manifest({
      capabilities: [{ id: '', label: 'Nameless', description: '', state: 'supported' }, 'not an object'],
      roms: [{ id: 'ok', label: 'Fine' }, { id: '', label: 'Nameless' }, 42],
    }));
    expect(result.profile.capabilities).toEqual([]);
    expect(result.profile.roms.map((rom) => rom.id)).toEqual(['ok']);
    expect(result.notes.filter((note) => note.kind === 'dropped-capability')).toHaveLength(2);
    expect(result.notes.filter((note) => note.kind === 'dropped-rom')).toHaveLength(2);
  });

  it('reports an unknown platform class and says the profile should be checked', () => {
    const result = readProfileManifest(manifest({ platformClass: '128-bit' }));
    const note = result.notes.find((entry) => entry.kind === 'unknown-platform-class')!;
    expect(note.found).toBe('128-bit');
    expect(note.reason).toMatch(/should be checked before it is used/i);
    /* It is still usable, because a partly usable profile beats a refused one
     * provided nothing was invented in silence. */
    expect(result.profile.id).toBe('bbc-b-clone');
  });

  it('keeps a profile selectable when it lists no usable variant, and says it did', () => {
    const result = readProfileManifest(manifest({ variants: ['', '  '] }));
    expect(result.profile.variants).toEqual(['Standard']);
    expect(result.notes.some((note) => note.kind === 'defaulted-field')).toBe(true);
  });

  it('drops a duplicate variant rather than offering the same choice twice', () => {
    const result = readProfileManifest(manifest({ variants: ['Standard', 'Standard', 'Turbo'] }));
    expect(result.profile.variants).toEqual(['Standard', 'Turbo']);
    expect(result.notes.some((note) => note.kind === 'dropped-variant' && note.found === 'Standard')).toBe(true);
  });

  it('corrects a malformed accent rather than refusing the machine over a colour', () => {
    expect(readProfileManifest(manifest({ accent: 'not a colour' })).profile.accent).toBe('#8b8b8b');
    expect(readProfileManifest(manifest({ accent: '#ABCDEF' })).profile.accent).toBe('#ABCDEF');
  });

  it('carries the prose saying why a capability is not fitted', () => {
    const result = readProfileManifest(manifest({
      capabilities: [{ id: 'econet', label: 'Econet', description: '', state: 'planned', requirement: 'Needs the Econet ROM and an adapter that models the clock.' }],
    }));
    expect(result.profile.capabilities[0]!.requirement).toContain('Econet ROM');
  });

  it('says every change in one line each, so an interface can show them', () => {
    const result = readProfileManifest(manifest({ platformClass: 'unknown', variants: [] }));
    const lines = manifestNoteSummary(result.notes);
    expect(lines.length).toBe(result.notes.length);
    for (const line of lines) expect(line.length).toBeGreaterThan(20);
  });
});
