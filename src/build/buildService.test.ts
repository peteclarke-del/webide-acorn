import { assert, describe, expect, it } from 'vitest';
import { createBuildTarget } from './buildTarget';
import { BuildExecutionError, executeBuild } from './buildService';
import type { ProjectFile, ProjectTarget } from '../project/project';

const machineTarget: ProjectTarget = { platformClass: '8-16-bit', machineId: 'bbc-b', variant: 'BBC B', romId: 'os12-basic2-dfs', enabledCapabilities: ['dfs'] };

describe('shared build service', () => {
  it('produces the same complete assembly artifact needed by worker and foreground callers', () => {
    const file: ProjectFile = { id: 'main', name: 'main.asm', language: '6502', content: 'ORG &1900\n.start\n LDX #3\n.done\n RTS', modified: true };
    const target = { ...createBuildTarget(file), entryPoint: { mode: 'symbol' as const, value: 'done' } };
    const result = executeBuild({ target, files: [file], machine: { id: 'bbc-b', cpu: 'MOS 6502 @ 2 MHz' }, machineTarget });
    expect(result.errors).toBe(0);
    expect(result.artifact).toMatchObject({ kind: '6502-binary', origin: 0x1900, entryPoint: 0x1902, bytes: Uint8Array.of(0xa2, 0x03, 0x60) });
    expect(result.artifact.provenance?.inputs).toHaveLength(1);
    expect(result.metadata).toMatchObject({
      schema: '8bit-net.build-result', version: 1,
      invocation: { adapterId: '8bit-net.asm.6502', adapterVersion: '2026.08.2', engine: 'browser-local', profile: 'debug', machineId: 'bbc-b' },
      exit: { reason: 'succeeded', errors: 0, warnings: 0 },
      cache: { status: 'miss' },
      artifacts: [{ name: 'main.bin', kind: '6502-binary', bytes: 3 }],
      size: { outputBytes: 3, mappedBytes: 3, unmappedBytes: 0, origin: 0x1900, end: 0x1902 },
    });
    expect(result.metadata.timing.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.metadata.invocation.toolchainDigest).toHaveLength(64);
    expect(result.metadata.inputs[0]?.sha256).toHaveLength(64);
    expect(result.metadata.artifacts[0]?.sha256).toHaveLength(64);
    expect(result.metadata.logs).toHaveLength(4);
    expect(result.metadata.logs.at(-1)).toMatch(/Cache miss/);
  });

  it('normalizes BASIC diagnostics with navigable file identity', () => {
    const file: ProjectFile = { id: 'basic', name: 'main.bas', language: 'bbc-basic', content: 'PRINT "NO LINE"', modified: true };
    const target = createBuildTarget(file);
    const result = executeBuild({ target, files: [file], machine: { id: 'bbc-b', cpu: 'MOS 6502 @ 2 MHz' }, machineTarget });
    expect(result.errors).toBeGreaterThan(0);
    expect(result.artifact.diagnostics[0]).toMatchObject({ fileId: 'basic', fileName: 'main.bas', line: 1 });
    expect(result.metadata.exit.reason).toBe('diagnostics');
  });

  it('rejects invalid target configuration before invoking a toolchain', () => {
    const file: ProjectFile = { id: 'main', name: 'main.asm', language: '6502', content: 'RTS', modified: false };
    try {
      executeBuild({ target: { ...createBuildTarget(file), outputName: '../escape' }, files: [file], machine: { id: 'bbc-b', cpu: 'MOS 6502 @ 2 MHz' }, machineTarget });
      throw new Error('Expected build validation to fail');
    } catch (error) {
      /* Asserted, then narrowed by assertion rather than by an early return:
       * a conditional return here would silently drop the rest of the test. */
      expect(error).toBeInstanceOf(BuildExecutionError);
      assert(error instanceof BuildExecutionError);
      expect(error.result).toMatchObject({ exit: { reason: 'invalid-configuration', errors: 1 }, artifacts: [], size: { outputBytes: 0 }, diagnostics: [{ fileId: 'main', fileName: 'main.asm', line: 1, column: 1, severity: 'error', message: expect.stringContaining('without paths') }] });
      expect(error.result.inputs).toHaveLength(1);
    }
  });

  it('honours declared defines, linked source units and memory ceilings', () => {
    const main: ProjectFile = { id: 'main', name: 'main.asm', language: '6502', content: 'JSR helper\nRTS', modified: true };
    const helper: ProjectFile = { id: 'helper', name: 'helper.asm', language: '6502', content: '.helper\nLDA #FEATURE\nRTS', modified: true };
    const target = { ...createBuildTarget(main), sourceFileIds: ['main', 'helper'], defines: ['FEATURE=&2A'], memoryLayout: { defaultOrigin: '&2000', maximumAddress: '&2006' } };
    const result = executeBuild({ target, targets: [target], files: [main, helper], machine: { id: 'bbc-b', cpu: 'MOS 6502 @ 2 MHz' }, machineTarget });
    expect(result.errors).toBe(0);
    expect(result.artifact).toMatchObject({ kind: '6502-binary', origin: 0x2000, bytes: Uint8Array.of(0x20, 0x04, 0x20, 0x60, 0xa9, 0x2a, 0x60) });
    expect(result.artifact.provenance?.inputs.map((input) => input.id).sort()).toEqual(['helper', 'main']);
    expect(executeBuild({ target: { ...target, memoryLayout: { ...target.memoryLayout, maximumAddress: '&2005' } }, targets: [target], files: [main, helper], machine: { id: 'bbc-b', cpu: 'MOS 6502 @ 2 MHz' }, machineTarget }).errors).toBe(1);
  });

  it('builds dependencies first and blocks the selected target when one fails', () => {
    const main: ProjectFile = { id: 'main', name: 'main.asm', language: '6502', content: 'RTS', modified: true };
    const broken: ProjectFile = { id: 'broken', name: 'broken.asm', language: '6502', content: 'NOPE', modified: true };
    const dependency = { ...createBuildTarget(broken), id: 'dependency', name: 'Library' };
    const target = { ...createBuildTarget(main), id: 'application', dependencyTargetIds: ['dependency'] };
    try { executeBuild({ target, targets: [target, dependency], files: [main, broken], machine: { id: 'bbc-b', cpu: 'MOS 6502 @ 2 MHz' }, machineTarget }); }
    catch (error) {
      expect(error).toBeInstanceOf(BuildExecutionError);
      expect((error as BuildExecutionError).result.exit.reason).toBe('dependency-failure');
      expect((error as Error).message).toMatch(/dependency Library produced/);
      return;
    }
    throw new Error('Expected dependency build to fail');
  });

  it('makes profile intent a real compile input and applies custom metadata fidelity', () => {
    const file: ProjectFile = { id: 'main', name: 'profile.asm', language: '6502', content: 'ORG &3000\n.start\nEQUB BUILD_PROFILE_DEBUG, BUILD_PROFILE_SIZE, BUILD_PROFILE_SPEED, BUILD_PROFILE_CUSTOM\nRTS', modified: true };
    const base = createBuildTarget(file);
    const speed = executeBuild({ target: { ...base, profile: 'speed' }, files: [file], machine: { id: 'bbc-b', cpu: 'MOS 6502 @ 2 MHz' }, machineTarget });
    expect(speed.artifact.bytes).toEqual(Uint8Array.of(0, 0, 1, 0, 0x60));
    const customTarget = { ...base, profile: 'custom' as const, profileOptions: { customGoal: 'size' as const, debugMetadata: 'none' as const } };
    const custom = executeBuild({ target: customTarget, files: [file], machine: { id: 'bbc-b', cpu: 'MOS 6502 @ 2 MHz' }, machineTarget });
    expect(custom.artifact.bytes).toEqual(Uint8Array.of(0, 1, 0, 1, 0x60));
    expect(custom.artifact).toMatchObject({ kind: '6502-binary', sourceMap: {}, sourceLocations: {}, listing: [] });
    expect(custom.artifact.provenance?.target).toMatchObject({ profile: 'custom', profileOptions: { customGoal: 'size', debugMetadata: 'none' } });
  });
});
