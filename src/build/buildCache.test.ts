import { beforeEach, describe, expect, it } from 'vitest';
import type { ProjectFile, ProjectTarget } from '../project/project';
import { buildCacheKey, buildCacheStats, clearBuildCache, corruptBuildCacheEntry } from './buildCache';
import { createBuildTarget } from './buildTarget';
import { executeBuild, type BuildRequest } from './buildService';
import { createPixelAssetDocument, serializePixelAssetDocument } from '../assets/pixelAssetDocument';

const machineTarget: ProjectTarget = { platformClass: '8-16-bit', machineId: 'bbc-b', variant: 'BBC B', romId: 'os12-basic2-dfs', enabledCapabilities: ['dfs'] };
const file: ProjectFile = { id: 'main', name: 'main.asm', language: '6502', content: 'ORG &2000\nRTS', modified: false };
const request = (files: ProjectFile[] = [file]): BuildRequest => ({ target: { ...createBuildTarget(file), id: 'cache-target' }, targets: [], files, machine: { id: 'bbc-b', cpu: 'MOS 6502 @ 2 MHz' }, machineTarget });

describe('browser-local content-addressed build cache', () => {
  beforeEach(clearBuildCache);

  it('returns integrity-verified hits and exposes metrics', () => {
    const input = request(); input.targets = [input.target];
    const first = executeBuild(input); const second = executeBuild(input);
    expect(first.metadata.cache).toMatchObject({ status: 'miss', entries: 1, hits: 0, misses: 1 });
    expect(second.metadata.cache).toMatchObject({ status: 'hit', entries: 1, hits: 1, misses: 1 });
    expect(Array.from(second.artifact.bytes)).toEqual(Array.from(first.artifact.bytes));
    expect(second.artifact.provenance).toEqual(first.artifact.provenance);
    expect(second.metadata.cache.key).toBe(first.metadata.cache.key);
  });

  it('invalidates on every resolved input but not an unrelated project file', () => {
    const helper: ProjectFile = { ...file, id: 'helper', name: 'helper.inc', content: '.helper\nRTS' };
    const unrelated: ProjectFile = { ...file, id: 'notes', name: 'notes.asm', content: '; notes' };
    const main = { ...file, content: 'ORG &2000\nINCLUDE "helper.inc"\nRTS' };
    const input = request([main, helper, unrelated]); input.target = { ...input.target, entryFileId: 'main', sourceFileIds: ['main'] }; input.targets = [input.target];
    const baseline = buildCacheKey(input);
    expect(buildCacheKey({ ...input, files: [main, { ...helper, content: '.helper\nNOP\nRTS' }, unrelated] })).not.toBe(baseline);
    expect(buildCacheKey({ ...input, files: [main, helper, { ...unrelated, content: '; changed notes' }] })).toBe(baseline);
  });

  it('invalidates when a live INCLUDEASSET document changes', () => {
    const sprite = createPixelAssetDocument('sprite', 8, 8);
    const main = { ...file, content: 'ORG &2000\nINCLUDEASSET "hero.asset.json"' };
    const asset: ProjectFile = { ...file, id: 'hero', name: 'hero.asset.json', language: 'text', content: serializePixelAssetDocument(sprite) };
    const input = request([main, asset]); input.targets = [input.target]; const baseline = executeBuild(input);
    sprite.pixels[0] = 3; const changed = executeBuild({ ...input, files: [main, { ...asset, content: serializePixelAssetDocument(sprite) }] });
    expect(baseline.metadata.cache.status).toBe('miss'); expect(changed.metadata.cache.status).toBe('miss');
    expect(changed.metadata.cache.key).not.toBe(baseline.metadata.cache.key); expect(changed.artifact.provenance?.inputs.map((item) => item.name).sort()).toEqual(['hero.asset.json', 'main.asm']);
    expect(changed.artifact.bytes[0]).toBe(0xc0);
  });

  it('supports explicit bypass without publishing or consuming an entry', () => {
    const input = { ...request(), cacheMode: 'bypass' as const }; input.targets = [input.target];
    const result = executeBuild(input);
    expect(result.metadata.cache.status).toBe('bypassed');
    expect(buildCacheStats()).toMatchObject({ entries: 0, hits: 0, misses: 0 });
  });

  it('rejects corrupted bytes and rebuilds from declared inputs', () => {
    const input = request(); input.targets = [input.target];
    const first = executeBuild(input); const key = first.metadata.cache.key!;
    expect(corruptBuildCacheEntry(key)).toBe(true);
    const recovered = executeBuild(input);
    expect(recovered.metadata.cache).toMatchObject({ status: 'miss', corruptions: 1, misses: 2 });
    expect(recovered.artifact.bytes).toEqual(Uint8Array.of(0x60));
  });

  it('evicts least-recently-used entries at the hard session bound', () => {
    for (let index = 0; index < 30; index += 1) {
      const varied = { ...file, content: `ORG &2000\nEQUB ${index}` };
      const input = request([varied]); input.target = { ...input.target, id: `target-${index}`, outputName: `${index}.bin` }; input.targets = [input.target];
      executeBuild(input);
    }
    expect(buildCacheStats()).toMatchObject({ entries: 24, misses: 30, evictions: 6 });
  });
});
