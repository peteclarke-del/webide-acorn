import { describe, expect, it } from 'vitest';
import { analyseBuildGraph, impactedBuildTargets, sourceInputsForTarget } from './buildGraph';
import { createBuildTarget } from './buildTarget';
import type { ProjectFile } from '../project/project';

const file = (id: string): ProjectFile => ({ id, name: `${id}.asm`, language: '6502', content: 'RTS', modified: false });
const target = (id: string, dependencies: string[] = []) => ({ ...createBuildTarget(file(id)), id, name: id, dependencyTargetIds: dependencies });

describe('build dependency graph', () => {
  it('creates a stable dependency-first order and propagates source impact downstream', () => {
    const graph = analyseBuildGraph([target('app', ['library']), target('tools'), target('library')]);
    expect(graph.order).toEqual(['library', 'app', 'tools']);
    expect(graph.nodes.find((node) => node.target.id === 'library')?.dependants).toEqual(['app']);
    expect(impactedBuildTargets(graph, ['library'])).toEqual(['library', 'app']);
  });

  it('reports missing edges and exact cycle paths without recursing forever', () => {
    const graph = analyseBuildGraph([target('a', ['b']), target('b', ['a', 'missing'])]);
    expect(graph.missing).toEqual([{ targetId: 'b', dependencyId: 'missing' }]);
    expect(graph.cycles).toEqual([['a', 'b', 'a']]);
  });

  it('includes the bounded transitive INCLUDE closure in incremental impact', () => {
    const app = target('app'); const downstream = target('pack', ['app']);
    const files = [file('app'), { ...file('shared'), name: 'shared.inc' }, { ...file('nested'), name: 'nested.inc' }];
    files[0]!.content = 'INCLUDE "shared.inc"\nRTS'; files[1]!.content = 'INCLUDE "nested.inc"';
    const inputs = sourceInputsForTarget(app, files);
    expect(inputs).toEqual(['app', 'shared', 'nested']);
    expect(impactedBuildTargets(analyseBuildGraph([app, downstream]), ['nested'], new Map([['app', inputs]]))).toEqual(['app', 'pack']);
  });

  it('treats INCLUDEASSET documents as fingerprinted build inputs', () => {
    const app = target('app'); const asset = { ...file('hero'), name: 'hero.asset.json', language: 'text' as const };
    const files = [file('app'), asset]; files[0]!.content = 'INCLUDEASSET "hero.asset.json"\nRTS';
    const inputs = sourceInputsForTarget(app, files);
    expect(inputs).toEqual(['app', 'hero']);
    expect(impactedBuildTargets(analyseBuildGraph([app]), ['hero'], new Map([['app', inputs]]))).toEqual(['app']);
  });
});
