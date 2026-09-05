import type { BuildTarget } from './buildTarget';
import { tileMapAssetReferences } from '../assets/tileMapDocument';
import type { ProjectFile } from '../project/project';
import { resolveIncluded } from '../project/includeResolution';

export interface BuildGraphNode {
  target: BuildTarget;
  dependencies: string[];
  dependants: string[];
  depth: number;
}

export interface BuildGraph {
  nodes: BuildGraphNode[];
  order: string[];
  cycles: string[][];
  missing: Array<{ targetId: string; dependencyId: string }>;
}

/** Analyse target edges without executing a toolchain. Ordering is stable by
 * manifest position, so diagnostics and build-all scheduling are reproducible. */
export function analyseBuildGraph(targets: BuildTarget[]): BuildGraph {
  const index = new Map(targets.map((target, position) => [target.id, position]));
  const byId = new Map(targets.map((target) => [target.id, target]));
  const dependants = new Map(targets.map((target) => [target.id, [] as string[]]));
  const missing: BuildGraph['missing'] = [];
  for (const target of targets) for (const dependencyId of target.dependencyTargetIds) {
    if (!byId.has(dependencyId)) missing.push({ targetId: target.id, dependencyId });
    else dependants.get(dependencyId)!.push(target.id);
  }
  dependants.forEach((ids) => ids.sort((a, b) => index.get(a)! - index.get(b)!));

  const order: string[] = [];
  const cycles: string[][] = [];
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      const start = stack.indexOf(id);
      const cycle = [...stack.slice(start), id];
      if (!cycles.some((item) => item.join('\0') === cycle.join('\0'))) cycles.push(cycle);
      return;
    }
    state.set(id, 1); stack.push(id);
    const target = byId.get(id)!;
    target.dependencyTargetIds.filter((dependencyId) => byId.has(dependencyId)).sort((a, b) => index.get(a)! - index.get(b)!).forEach(visit);
    stack.pop(); state.set(id, 2); order.push(id);
  };
  targets.forEach((target) => visit(target.id));

  const depths = new Map<string, number>();
  const depth = (id: string, path = new Set<string>()): number => {
    if (path.has(id)) return 0;
    const cached = depths.get(id); if (cached !== undefined) return cached;
    const target = byId.get(id)!; const next = new Set(path).add(id);
    const result = target.dependencyTargetIds.filter((dependencyId) => byId.has(dependencyId)).reduce((maximum, dependencyId) => Math.max(maximum, depth(dependencyId, next) + 1), 0);
    depths.set(id, result); return result;
  };
  return { nodes: targets.map((target) => ({ target, dependencies: target.dependencyTargetIds.filter((id) => byId.has(id)), dependants: dependants.get(target.id)!, depth: depth(target.id) })), order, cycles, missing };
}

export function sourceInputsForTarget(target: BuildTarget, files: Pick<ProjectFile, 'id' | 'name' | 'content'>[]): string[] {
  const byId = new Map(files.map((file) => [file.id, file]));
  const byName = new Map(files.map((file) => [file.name.toLowerCase(), file]));
  const inputs = new Set<string>();
  const visit = (id: string) => {
    if (inputs.has(id)) return; const file = byId.get(id); if (!file) return; inputs.add(id);
    if (/\.map\.json$/i.test(file.name)) {
      for (const assetFile of tileMapAssetReferences(file.content)) {
        const asset = resolveIncluded(byName, assetFile, file.name);
        if (asset) visit(asset.id);
      }
      return;
    }
    for (const line of file.content.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')) {
      const cInclude = /^\s*#\s*include\s+"([^"]+)"\s*(?:\/\/.*)?$/i.exec(line);
      const include = /^\s*\.?INCLUDE\s+(?:"([^"]+)"|'([^']+)'|([^\s;]+))\s*(?:;.*)?$/i.exec(line);
      const assetInclude = /^\s*INCLUDE(?:ASSET|MAP|PALETTE|FONT|SCREEN|SONG)\s+(?:"([^"]+)"|'([^']+)'|([^\s;]+))\s*(?:;.*)?$/i.exec(line);
      const requested = (cInclude?.[1] ?? include?.[1] ?? include?.[2] ?? include?.[3] ?? assetInclude?.[1] ?? assetInclude?.[2] ?? assetInclude?.[3] ?? '').trim();
      const dependency = include || cInclude || assetInclude ? resolveIncluded(byName, requested, file.name) : undefined;
      if (dependency) visit(dependency.id);
    }
  };
  target.sourceFileIds.forEach(visit);
  return [...inputs];
}

export function impactedBuildTargets(graph: BuildGraph, changedFileIds: Iterable<string>, inputIdsByTarget?: ReadonlyMap<string, readonly string[]>): string[] {
  const changed = new Set(changedFileIds);
  const impacted = new Set(graph.nodes.filter((node) => (inputIdsByTarget?.get(node.target.id) ?? node.target.sourceFileIds).some((id) => changed.has(id))).map((node) => node.target.id));
  const queue = [...impacted];
  while (queue.length) {
    const id = queue.shift()!;
    for (const dependant of graph.nodes.find((node) => node.target.id === id)?.dependants ?? []) if (!impacted.has(dependant)) { impacted.add(dependant); queue.push(dependant); }
  }
  return graph.order.filter((id) => impacted.has(id));
}
