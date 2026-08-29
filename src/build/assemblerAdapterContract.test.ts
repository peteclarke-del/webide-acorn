import { describe, expect, it } from 'vitest';
import type { ProjectFile, ProjectTarget } from '../project/project';
import { createBuildTarget, type BuildTarget } from './buildTarget';
import { executeBuild } from './buildService';

const machineTarget: ProjectTarget = { platformClass: '8-16-bit', machineId: 'bbc-b', variant: 'BBC B', romId: 'os12-basic2-dfs', enabledCapabilities: ['dfs'] };
const machine = { id: 'bbc-b', cpu: 'MOS 6502 @ 2 MHz' };
const source = (id: string, name: string, content: string): ProjectFile => ({ id, name, language: '6502', content, modified: false });
const request = (target: BuildTarget, files: ProjectFile[]) => ({ target, targets: [target], files, machine, machineTarget, cacheMode: 'bypass' as const });

describe('first 6502 toolchain adapter contract', () => {
  it('is byte-for-byte and metadata reproducible for identical declared inputs', () => {
    const main = source('main', 'main.asm', 'ORG &2000\n.start\nLDA #&41\nJSR OSWRCH\nRTS');
    const target = { ...createBuildTarget(main), id: 'reproducible-target', name: 'Reproducible', outputName: 'main.bin' };
    const first = executeBuild(request(target, [main]));
    const second = executeBuild(request(structuredClone(target), [structuredClone(main)]));
    expect(second.artifact).toEqual(first.artifact);
    expect({ ...second.metadata, timing: { durationMs: 0 } }).toEqual({ ...first.metadata, timing: { durationMs: 0 } });
    expect(first.artifact.provenance).toMatchObject({
      schema: '8bit-net.build-provenance', version: 2, fingerprintAlgorithm: 'fnv1a32', digestAlgorithm: 'sha256',
      target: { id: 'reproducible-target', toolchainId: '8bit-net.asm.6502', toolchainVersion: '2026.08.2' },
      toolchain: { execution: 'browser-local', deterministic: true, processor: '6502' },
      output: { kind: '6502-binary', bytes: 6 },
    });
    expect(JSON.stringify(first.artifact.provenance)).not.toMatch(/timestamp|createdAt|random|seed/i);
  });

  it('maps every emitted byte to its immutable file and line across includes', () => {
    const main = source('main', 'main.asm', 'ORG &3000\n.start\nJSR helper\nRTS\nINCLUDE "helper.inc"');
    const helper = source('helper', 'helper.inc', '.helper\nLDA #&2A\nRTS');
    const target = createBuildTarget(main);
    const result = executeBuild(request(target, [main, helper]));
    expect(result.errors).toBe(0);
    expect(result.artifact.kind).toBe('6502-binary');
    if (result.artifact.kind !== '6502-binary') throw new Error('Expected assembly artifact');
    expect(result.artifact.bytes).toEqual(Uint8Array.of(0x20, 0x04, 0x30, 0x60, 0xa9, 0x2a, 0x60));
    expect(Object.keys(result.artifact.sourceLocations)).toHaveLength(result.artifact.bytes.length);
    expect(result.artifact.sourceLocations).toMatchObject({
      12288: { fileId: 'main', fileName: 'main.asm', line: 3 },
      12291: { fileId: 'main', fileName: 'main.asm', line: 4 },
      12292: { fileId: 'helper', fileName: 'helper.inc', line: 2 },
      12294: { fileId: 'helper', fileName: 'helper.inc', line: 3 },
    });
    expect(result.artifact.sourceFiles).toEqual({ main: { name: 'main.asm', content: main.content }, helper: { name: 'helper.inc', content: helper.content } });
  });

  it('normalizes multi-file failures without publishing a successful result', () => {
    const main = source('main', 'main.asm', 'ORG &1900\nINCLUDE "broken.inc"\nRTS');
    const broken = source('broken', 'broken.inc', '.broken\nLDA #missing');
    const result = executeBuild(request(createBuildTarget(main), [main, broken]));
    expect(result.errors).toBeGreaterThan(0);
    expect(result.errors).toBe(result.artifact.diagnostics.filter((item) => item.severity === 'error').length);
    expect(result.artifact.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileId: 'broken', fileName: 'broken.inc', line: 2, column: 1, severity: 'error', message: expect.stringMatching(/missing/i) }),
    ]));
  });

  it('enforces the selected processor instruction set', () => {
    const main = source('main', 'main.asm', 'ORG &1900\nBRA done\nNOP\n.done\nRTS');
    const nmos = executeBuild(request(createBuildTarget(main), [main]));
    expect(nmos.errors).toBeGreaterThan(0);
    expect(nmos.artifact.diagnostics.some((item) => /does not support.*6502/i.test(item.message))).toBe(true);
    const cmosTarget = { ...createBuildTarget(main), toolchainId: '8bit-net.asm.65c12' as const, toolchainVersion: '2026.08.2' };
    const cmos = executeBuild({ ...request(cmosTarget, [main]), machine: { id: 'master', cpu: 'WDC 65C12 @ 2 MHz' }, machineTarget: { ...machineTarget, machineId: 'master' } });
    expect(cmos.errors).toBe(0);
    expect(cmos.artifact).toMatchObject({ kind: '6502-binary', processor: '65c02', bytes: Uint8Array.of(0x80, 0x01, 0xea, 0x60) });
  });
});
