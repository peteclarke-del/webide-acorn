import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectFile, ProjectTarget } from '../project/project';
import { createBuildTarget } from './buildTarget';
import { BuildExecutionError, type BuildRequest, type BuildResultMetadata } from './buildService';
import { detectNativeToolchain, invokeNativeToolchain } from './nativeToolchainAdapter';

const file: ProjectFile = { id: 'main', name: 'main.s', language: '6502', content: '.segment "CODE"\n_start: lda #$41\n rts\n', modified: false };
const machineTarget: ProjectTarget = { platformClass: '8-16-bit', machineId: 'bbc-b', variant: 'bbc-b', romId: 'os-1.20-basic2', enabledCapabilities: [] };
const target = { ...createBuildTarget(file), id: 'native', toolchainId: 'cc65.ca65-ld65' as const, toolchainVersion: '2026.08.1' };
const request: BuildRequest = { target, targets: [target], files: [file], machine: { id: 'bbc-b', cpu: 'MOS 6502 @ 2 MHz' }, machineTarget };
const metadata = (reason: BuildResultMetadata['exit']['reason'], errors: number): BuildResultMetadata => ({
  schema: '8bit-net.build-result', version: 1,
  invocation: { adapterId: 'cc65.ca65-ld65', adapterVersion: '2026.08.1', toolchainDigest: 'digest', engine: 'server-native', profile: 'debug', machineId: 'bbc-b', dependencyTargetIds: [] },
  exit: { reason, errors, warnings: 0 }, timing: { durationMs: 2 }, cache: { status: 'bypassed', reason: 'native', entries: 0, hits: 0, misses: 0, corruptions: 0, evictions: 0 },
  inputs: [], artifacts: [], size: { outputBytes: errors ? 0 : 3, mappedBytes: errors ? 0 : 3, unmappedBytes: 0, symbols: errors ? 0 : 1, sourceFiles: 1 }, diagnostics: errors ? [{ severity: 'error', message: 'Syntax error', line: 2, column: 4, fileId: 'main', fileName: 'main.s' }] : [], logs: [],
});

afterEach(() => vi.unstubAllGlobals());

describe('native toolchain browser adapter', () => {
  it('advertises only a ready, compatible adapter manifest', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'cc65.ca65-ld65', ready: true, label: 'ca65', adapterVersion: '2026.08.1', packageVersion: '2.19-1', digest: 'd', ca65: { version: 'ca65', sha256: 'a' }, ld65: { version: 'ld65', sha256: 'b' } }), { status: 200 })));
    expect((await detectNativeToolchain())?.packageVersion).toBe('2.19-1');
  });

  it('routes ARM2 builds to the distinct adapter and preserves raw-format facts', async () => {
    const armFile: ProjectFile = { id: 'arm', name: 'main.arm', language: 'arm', content: '.global _start\n_start:\n mov r0, #1', modified: false };
    const armTarget = { ...createBuildTarget(armFile), id: 'arm-native' };
    const armMachine: ProjectTarget = { platformClass: '32-bit', machineId: 'archimedes-a300', variant: 'A310', romId: 'riscos200', enabledCapabilities: [] };
    let requestedUrl = '';
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      requestedUrl = url; const sent = JSON.parse(String(init?.body));
      expect(sent.target).toMatchObject({ processor: 'arm2', origin: 0x8000, maximumAddress: 0x0fffff });
      const result = { ...metadata('succeeded', 0), invocation: { ...metadata('succeeded', 0).invocation, adapterId: 'gnu.arm-none-eabi-binutils', machineId: 'archimedes-a300' } };
      return new Response(JSON.stringify({ schema: '8bit-net.native-build-response', version: 1, result, artifact: { kind: 'arm-binary', bytesBase64: 'AQAAA+7//+o=', origin: 0x8000, entryPoint: 0x8000, processor: 'arm2', endianness: 'little', containerFormat: 'raw', riscOsFiletype: null, symbols: { _start: 0x8000 }, sourceLocations: { 32768: { fileId: 'arm', fileName: 'main.arm', line: 3 } }, sourceMap: { 32768: 3 }, entryFileId: 'arm', dependencies: ['main.arm'], listing: ['[main.arm:3] &00008000 01 00 A0 E3 mov r0,#1'], diagnostics: [] }, documents: [] }), { status: 200 });
    }));
    const built = await invokeNativeToolchain({ target: armTarget, targets: [armTarget], files: [armFile], machine: { id: 'archimedes-a300', cpu: 'ARM2 @ 8 MHz' }, machineTarget: armMachine });
    expect(requestedUrl).toBe('/api/v1/builds/arm-binutils');
    expect(built.artifact).toMatchObject({ kind: 'arm-binary', processor: 'arm2', containerFormat: 'raw', riscOsFiletype: null, entryPoint: 0x8000 });
    expect(built.artifact.provenance?.target.toolchainId).toBe('gnu.arm-none-eabi-binutils');
  });

  it('routes BeebAsm targets to their distinct endpoint and retains INCLUDE inputs', async () => {
    const include: ProjectFile = { id: 'lib', name: 'lib.asm', language: '6502', content: 'RTS', modified: false };
    const beebFile: ProjectFile = { ...file, name: 'main.asm', content: 'ORG &1900\n.start\nINCLUDE "lib.asm"\nSAVE start,P%,start' };
    const beebTarget = { ...target, toolchainId: 'stardot.beebasm' as const, entryFileId: 'main', sourceFileIds: ['main'] };
    let requestedUrl = '';
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      requestedUrl = url; const sent = JSON.parse(String(init?.body)); expect(sent.files.map((item: { id: string }) => item.id)).toEqual(['main', 'lib']);
      const result = { ...metadata('succeeded', 0), invocation: { ...metadata('succeeded', 0).invocation, adapterId: 'stardot.beebasm' } };
      return new Response(JSON.stringify({ schema: '8bit-net.native-build-response', version: 1, result, artifact: { kind: '6502-binary', bytesBase64: 'YA==', origin: 0x1900, entryPoint: 0x1900, processor: '6502', symbols: { start: 0x1900 }, sourceLocations: { 6400: { fileId: 'lib', fileName: 'lib.asm', line: 1 } }, sourceMap: { 6400: 1 }, entryFileId: 'main', dependencies: ['main.asm', 'lib.asm'], listing: ['[lib.asm:1] &1900 60 RTS'], diagnostics: [] }, documents: [] }), { status: 200 });
    }));
    const built = await invokeNativeToolchain({ ...request, target: beebTarget, files: [beebFile, include] });
    expect(requestedUrl).toBe('/api/v1/builds/beebasm'); expect(Array.from(built.artifact.bytes)).toEqual([0x60]);
  });

  it('normalizes exact bytes, source locations, documents and project provenance', async () => {
    const result = metadata('succeeded', 0);
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body));
      expect(sent.sourceUnitIds).toEqual(['main']); expect(sent.target.processor).toBe('6502');
      return new Response(JSON.stringify({ schema: '8bit-net.native-build-response', version: 1, result, artifact: { kind: '6502-binary', bytesBase64: 'qUFg', origin: 0x1900, entryPoint: 0x1900, processor: '6502', symbols: { _start: 0x1900 }, sourceLocations: { 6400: { fileId: 'main', fileName: 'main.s', line: 2 } }, sourceMap: { 6400: 2 }, entryFileId: 'main', dependencies: ['main.s'], listing: ['[main.s:2] &1900 A9 41'], diagnostics: [] }, documents: [{ id: 'linker-map', label: 'Map', filename: 'main.map', content: 'map', bytes: 3, sha256: 'hash' }] }), { status: 200 });
    }));
    const built = await invokeNativeToolchain(request);
    expect(Array.from(built.artifact.bytes)).toEqual([0xa9, 0x41, 0x60]);
    expect(built.artifact.kind === '6502-binary' && built.artifact.sourceLocations[0x1900]?.line).toBe(2);
    expect(built.artifact.kind === '6502-binary' && built.artifact.retainedDocuments?.[0]?.id).toBe('linker-map');
    expect(built.artifact.provenance?.target.toolchainId).toBe('cc65.ca65-ld65');
  });

  it('keeps a diagnostic-only native response artifact-free', async () => {
    const result = metadata('diagnostics', 1);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ schema: '8bit-net.native-build-response', version: 1, result, artifact: null, documents: [] }), { status: 200 })));
    await expect(invokeNativeToolchain(request)).rejects.toMatchObject({ name: 'BuildExecutionError', result });
    try { await invokeNativeToolchain(request); } catch (error) { expect(error).toBeInstanceOf(BuildExecutionError); }
  });
});

describe('what the server cache is told', () => {
  it('asks the builder to rebuild when the person asked for a rebuild', async () => {
    /* The builder keeps results between requests, so Rebuild has to mean
     * rebuild on both sides or it means nothing on one of them. */
    const sent: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      const artifact = { kind: '6502-binary', bytesBase64: 'qUFg', origin: 0x1900, entryPoint: 0x1900, processor: '6502', symbols: { _start: 0x1900 }, sourceLocations: {}, sourceMap: {}, entryFileId: 'main', dependencies: ['main.s'], listing: [], diagnostics: [] };
      return new Response(JSON.stringify({ schema: '8bit-net.native-build-response', version: 1, result: metadata('succeeded', 0), artifact, documents: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    await invokeNativeToolchain(request);
    await invokeNativeToolchain({ ...request, cacheMode: 'bypass' });

    expect((sent[0] as { cache: unknown }).cache).toEqual({ bypass: false });
    expect((sent[1] as { cache: unknown }).cache).toEqual({ bypass: true });
    vi.unstubAllGlobals();
  });
});
