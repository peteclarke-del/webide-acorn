import { describe, expect, it } from 'vitest';
import { buildEntryUpdate, buildProfileDefines, buildProfileKeepsDebugMetadata, buildProfileManifest, createBuildProvenance, createBuildTarget, migrateBuildTarget, provenanceMatches, resolveAssemblyEntryPoint, shouldScheduleBackgroundBuild, validateBuildTarget } from './buildTarget';
import type { ProjectFile, ProjectTarget } from '../project/project';

const file: ProjectFile = { id: 'main', name: 'main.asm', language: '6502', content: 'ORG &1900\nRTS', modified: false };
const machineTarget: ProjectTarget = { platformClass: '8-16-bit', machineId: 'bbc-b', variant: 'B', romId: 'os12', enabledCapabilities: ['dfs'] };

describe('build target manifest', () => {
  it('rejects incompatible entry files, unsafe output paths and 65C12 on NMOS machines', () => {
    const target = { ...createBuildTarget(file), toolchainId: '8bit-net.asm.65c12' as const, outputName: '../escape.bin' };
    expect(validateBuildTarget(target, [file], { cpu: 'MOS 6502 @ 2 MHz' })).toEqual(expect.arrayContaining([
      expect.stringContaining('without paths'), expect.stringContaining('65C12 instruction set'),
    ]));
  });

  it('produces stable provenance and changes it for source or output changes', () => {
    const target = { ...createBuildTarget(file), id: 'build-main' };
    const first = createBuildProvenance(target, machineTarget, [file], { kind: '6502-binary', bytes: Uint8Array.of(0x60) });
    const repeated = createBuildProvenance(target, machineTarget, [file], { kind: '6502-binary', bytes: Uint8Array.of(0x60) });
    const changed = createBuildProvenance(target, machineTarget, [{ ...file, content: `${file.content}\nNOP` }], { kind: '6502-binary', bytes: Uint8Array.of(0x60, 0xea) });
    expect(repeated).toEqual(first);
    expect(changed.fingerprint).not.toBe(first.fingerprint);
    expect(first.output.fingerprint).toBe('e50c2abf');
    expect(first.output.sha256).toHaveLength(64);
    expect(first.inputs[0]?.sha256).toHaveLength(64);
    expect(first.toolchainDigest).toHaveLength(64);
    expect(provenanceMatches(first, target, machineTarget, [file])).toBe(true);
    expect(provenanceMatches(first, target, machineTarget, [{ ...file, content: `${file.content}\nNOP` }])).toBe(false);
    expect(provenanceMatches(first, { ...target, outputName: 'other.bin' }, machineTarget, [file])).toBe(false);
  });

  it('keeps Atom and BBC BASIC toolchains machine-specific', () => {
    const basic: ProjectFile = { ...file, name: 'main.bas', language: 'bbc-basic', content: '10 END' };
    const target = createBuildTarget(basic);
    expect(validateBuildTarget(target, [basic], { id: 'atom', cpu: 'MOS 6502 @ 1 MHz' })).toContain('Select the Atom BASIC text packer for an Acorn Atom target');
    expect(validateBuildTarget({ ...target, toolchainId: '8bit-net.basic.atom' }, [basic], { id: 'bbc-b', cpu: 'MOS 6502 @ 2 MHz' })).toContain('The Atom BASIC text packer requires an Acorn Atom target');
    expect(validateBuildTarget({ ...target, profile: 'size' }, [basic], { id: 'bbc-b', cpu: 'MOS 6502 @ 2 MHz' })).toContain('The BASIC packers support the debug/no-transform profile only');
  });

  it('creates a bounded ARM2 native target only for the first Archimedes tier', () => {
    const arm: ProjectFile = { ...file, name: 'main.arm', language: 'arm', content: '.global _start\n_start:\n mov r0, #1' };
    const target = createBuildTarget(arm);
    expect(target).toMatchObject({ toolchainId: 'gnu.arm-none-eabi-binutils', language: 'arm', outputType: 'arm-binary', memoryLayout: { defaultOrigin: '&00008000', maximumAddress: '&000FFFFF' } });
    expect(validateBuildTarget(target, [arm], { id: 'archimedes-a300', cpu: 'ARM2 @ 8 MHz' })).toEqual([]);
    expect(validateBuildTarget(target, [arm], { id: 'bbc-b', cpu: 'MOS 6502 @ 2 MHz' })).toContain('The first ARM2 raw-binary adapter is scoped to the A300, A400/1 and A3000 Archimedes profiles');
    expect(validateBuildTarget({ ...target, memoryLayout: { defaultOrigin: '&8002', maximumAddress: '&FFFFF' } }, [arm], { id: 'archimedes-a300', cpu: 'ARM2 @ 8 MHz' })).toContain('ARM2 output must use a word-aligned range from &00008000 through &03FFFFFF');
  });

  it('resolves declared symbol/address entry points only inside the produced image', () => {
    const target = createBuildTarget(file);
    const artifact = { origin: 0x1900, entryPoint: 0x1900, bytes: Uint8Array.of(0xea, 0x60), symbols: { START: 0x1900, done: 0x1901 } };
    expect(resolveAssemblyEntryPoint({ ...target, entryPoint: { mode: 'symbol', value: 'DONE' } }, artifact)).toEqual({ entryPoint: 0x1901 });
    expect(resolveAssemblyEntryPoint({ ...target, entryPoint: { mode: 'address', value: '&1900' } }, artifact)).toEqual({ entryPoint: 0x1900 });
    expect(resolveAssemblyEntryPoint({ ...target, entryPoint: { mode: 'symbol', value: 'missing' } }, artifact).error).toMatch(/not produced/);
    expect(resolveAssemblyEntryPoint({ ...target, entryPoint: { mode: 'address', value: '&2000' } }, artifact).error).toMatch(/outside/);
  });

  it('migrates legacy targets and schedules only eligible unpinned background builds', () => {
    const current = createBuildTarget(file);
    const migrated = migrateBuildTarget({ schemaVersion: 1 } as never, { id: 'old', name: 'Old build', entryFileId: file.id, toolchainId: '8bit-net.asm.6502', outputName: 'old.bin' });
    expect(migrated).toMatchObject({ schemaVersion: 5, buildPolicy: 'manual', entryPoint: { mode: 'source', value: '' }, machineProfile: 'project', language: '6502', roots: ['.'], sourceFileIds: ['main'], profile: 'debug', profileOptions: { customGoal: 'balanced', debugMetadata: 'full' } });
    expect(shouldScheduleBackgroundBuild({ ...current, buildPolicy: 'on-save' }, 'save', file.id)).toBe(true);
    expect(shouldScheduleBackgroundBuild({ ...current, buildPolicy: 'on-save' }, 'save', 'other')).toBe(false);
    expect(shouldScheduleBackgroundBuild({ ...current, buildPolicy: 'on-save' }, 'save', 'included', false, ['main', 'included'])).toBe(true);
    expect(shouldScheduleBackgroundBuild({ ...current, buildPolicy: 'live' }, 'change')).toBe(true);
    expect(shouldScheduleBackgroundBuild({ ...current, buildPolicy: 'live' }, 'change', '*', true)).toBe(false);
  });

  it('defines explicit profile intent and models custom debug fidelity honestly', () => {
    const target = createBuildTarget(file);
    expect(buildProfileDefines({ ...target, profile: 'speed' })).toMatchObject({ BUILD_PROFILE_SPEED: 1, BUILD_PROFILE_DEBUG: 0 });
    const custom = { ...target, profile: 'custom' as const, profileOptions: { customGoal: 'size' as const, debugMetadata: 'none' as const } };
    expect(buildProfileDefines(custom)).toMatchObject({ BUILD_PROFILE_SIZE: 1, BUILD_PROFILE_CUSTOM: 1 });
    expect(buildProfileKeepsDebugMetadata(custom)).toBe(false);
    expect(buildProfileManifest('size').sizeImpact).toMatch(/measured output size/i);
    expect(validateBuildTarget({ ...target, defines: ['BUILD_PROFILE_SPEED=1'] }, [file], { cpu: 'MOS 6502 @ 2 MHz' })).toContain('BUILD_PROFILE_SPEED is reserved for the selected build profile');
  });

  it('validates the complete declaration including defines, source units and dependency cycles', () => {
    const target = { ...createBuildTarget(file), id: 'one', defines: ['FEATURE=&01', 'FEATURE=&02'], sourceFileIds: ['main', 'missing'], dependencyTargetIds: ['two'] };
    const other = { ...createBuildTarget(file), id: 'two', dependencyTargetIds: ['one'] };
    expect(validateBuildTarget(target, [file], { cpu: 'MOS 6502 @ 2 MHz' }, [target, other])).toEqual(expect.arrayContaining([
      'Duplicate define FEATURE', 'A declared source unit is missing from the project', 'Build-target dependencies contain a cycle',
    ]));
  });

  it('requires one root source unit for BeebAsm without hiding included project inputs', () => {
    const helper: ProjectFile = { ...file, id: 'helper', name: 'helper.asm' };
    const target = { ...createBuildTarget(file), toolchainId: 'stardot.beebasm' as const, toolchainVersion: '2026.08.1', sourceFileIds: ['main', 'helper'] };
    expect(validateBuildTarget(target, [file, helper], { cpu: 'MOS 6502 @ 2 MHz' })).toContain('BeebAsm requires one root source unit; use INCLUDE for subordinate files');
  });

  it('retargets only automatic names and outputs when the entry language changes', () => {
    const basic: ProjectFile = { ...file, name: 'main.bas', language: 'bbc-basic' };
    const target = createBuildTarget(basic);
    expect(buildEntryUpdate(target, basic, file, '8bit-net.asm.6502')).toMatchObject({ entryFileId: 'main', name: 'main build', outputName: 'main.bin', toolchainId: '8bit-net.asm.6502' });
    expect(buildEntryUpdate({ ...target, name: 'Release', outputName: 'custom.rom' }, basic, file, '8bit-net.asm.6502')).not.toMatchObject({ name: 'main build', outputName: 'main.bin' });
  });
});
