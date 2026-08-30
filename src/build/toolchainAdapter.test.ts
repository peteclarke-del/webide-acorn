import { describe, expect, it } from 'vitest';
import type { ProjectFile } from '../project/project';
import { createBuildTarget } from './buildTarget';
import { BROWSER_TOOLCHAIN_ADAPTERS, browserToolchainAdapter, invokeBrowserToolchain } from './toolchainAdapter';

const assembly: ProjectFile = { id: 'asm', name: 'main.asm', language: '6502', content: 'RTS', modified: false };

describe('browser toolchain adapter registry', () => {
  it('detects every pinned manifest exactly once with declared profile capabilities', () => {
    expect(BROWSER_TOOLCHAIN_ADAPTERS.map((adapter) => adapter.manifest.id)).toEqual([
      '8bit-net.basic.bbc2', '8bit-net.basic.atom', '8bit-net.asm.6502', '8bit-net.asm.65c12',
    ]);
    expect(new Set(BROWSER_TOOLCHAIN_ADAPTERS.map((adapter) => adapter.manifest.id)).size).toBe(BROWSER_TOOLCHAIN_ADAPTERS.length);
    expect(browserToolchainAdapter('8bit-net.asm.6502')?.profileIds).toEqual(['debug', 'size', 'speed', 'custom']);
    expect(browserToolchainAdapter('8bit-net.basic.bbc2')?.profileIds).toEqual(['debug']);
  });

  it('invokes through the common contract and rejects an unregistered capability', () => {
    const target = createBuildTarget(assembly);
    expect(invokeBrowserToolchain({ target, entry: assembly, files: [assembly] })).toMatchObject({ kind: '6502-binary', bytes: Uint8Array.of(0x60) });
    const basic: ProjectFile = { ...assembly, id: 'basic', name: 'main.bas', language: 'bbc-basic', content: '10 END' };
    const basicTarget = { ...createBuildTarget(basic), profile: 'size' as const };
    expect(() => invokeBrowserToolchain({ target: basicTarget, entry: basic, files: [basic] })).toThrow(/does not support the size build profile/);
  });
});
