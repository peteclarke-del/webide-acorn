import { describe, expect, it } from 'vitest';
import { executeBuildAll } from './buildAll';
import { createBuildTarget } from './buildTarget';
import { BuildExecutionError, type BuildResponse } from './buildService';
import type { ProjectFile } from '../project/project';

const file = (id: string): ProjectFile => ({ id, name: `${id}.asm`, language: '6502', content: 'RTS', modified: false });
const target = (id: string, dependencies: string[] = []) => ({ ...createBuildTarget(file(id)), id, name: id, dependencyTargetIds: dependencies });
const response = (errors = 0): BuildResponse => ({
  errors,
  artifact: { kind: '6502-binary', bytes: Uint8Array.of(0x60), origin: 0x1900, entryPoint: 0x1900, processor: '6502', symbols: {}, sourceMap: {}, sourceLocations: {}, entryFileId: '', dependencies: [], sourceFiles: {}, diagnostics: [], listing: [] },
  metadata: { schema: '8bit-net.build-result', version: 1, invocation: { adapterId: 'test', adapterVersion: '1', toolchainDigest: 'digest', engine: 'browser-local', profile: 'debug', machineId: 'test', dependencyTargetIds: [] }, exit: { reason: errors ? 'diagnostics' : 'succeeded', errors, warnings: 0 }, timing: { durationMs: 0 }, cache: { status: 'bypassed', reason: 'test', entries: 0, hits: 0, misses: 0, corruptions: 0, evictions: 0 }, inputs: [], artifacts: [{ name: 'test.bin', kind: '6502-binary', bytes: 1, fingerprint: 'test', sha256: 'digest' }], size: { outputBytes: 1, mappedBytes: 0, unmappedBytes: 1, origin: 0x1900, end: 0x1900, symbols: 0, sourceFiles: 0 }, diagnostics: [], logs: [] },
});

describe('bounded build-all scheduler', () => {
  it('never exceeds its concurrency bound and starts dependants after dependencies', async () => {
    const targets = [target('app', ['core']), target('tools'), target('core')];
    let running = 0; let maximum = 0; const starts: string[] = [];
    const records = await executeBuildAll(targets, async (item) => {
      starts.push(item.id); running += 1; maximum = Math.max(maximum, running);
      await new Promise((resolve) => setTimeout(resolve, item.id === 'core' ? 10 : 2)); running -= 1;
      return response();
    }, { concurrency: 2 });
    expect(maximum).toBe(2);
    expect(starts.indexOf('app')).toBeGreaterThan(starts.indexOf('core'));
    expect(records.map((record) => [record.targetId, record.status])).toEqual([['core', 'succeeded'], ['app', 'succeeded'], ['tools', 'succeeded']]);
  });

  it('skips downstream targets after a dependency build error', async () => {
    const records = await executeBuildAll([target('app', ['core']), target('core')], async (item) => response(item.id === 'core' ? 1 : 0));
    expect(records.map((record) => record.status)).toEqual(['failed', 'skipped']);
  });

  it('cancels running and queued work through one abort signal', async () => {
    const controller = new AbortController();
    const promise = executeBuildAll([target('a'), target('b'), target('c')], (_item, _deps, signal) => new Promise((resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
      setTimeout(() => resolve(response()), 100);
    }), { concurrency: 2, signal: controller.signal });
    controller.abort();
    expect((await promise).map((record) => record.status)).toEqual(['cancelled', 'cancelled', 'cancelled']);
  });

  it('retains a normalized failure envelope without fabricating an artifact', async () => {
    const failure = { ...response().metadata, exit: { reason: 'adapter-failure' as const, errors: 1, warnings: 0 }, artifacts: [], diagnostics: [{ line: 1, column: 1, severity: 'error' as const, message: 'adapter stopped' }] };
    const records = await executeBuildAll([target('broken')], async () => { throw new BuildExecutionError('adapter stopped', failure); });
    expect(records[0]).toMatchObject({ status: 'failed', message: 'adapter stopped', failure: { exit: { reason: 'adapter-failure' }, artifacts: [] } });
    expect(records[0]?.response).toBeUndefined();
  });
});
