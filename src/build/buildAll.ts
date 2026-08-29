import { analyseBuildGraph } from './buildGraph';
import { BuildExecutionError, type BuildResponse, type BuildResultMetadata } from './buildService';
import type { BuildTarget } from './buildTarget';

export type BuildAllStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';

export interface BuildAllRecord {
  targetId: string;
  targetName: string;
  status: BuildAllStatus;
  startedAt?: number;
  finishedAt?: number;
  message: string;
  response?: BuildResponse;
  failure?: BuildResultMetadata;
}

export interface BuildAllOptions {
  concurrency?: number;
  signal?: AbortSignal;
  onUpdate?: (records: BuildAllRecord[]) => void;
}

export async function executeBuildAll(
  targets: BuildTarget[],
  execute: (target: BuildTarget, dependencyResponses: BuildResponse[], signal?: AbortSignal) => Promise<BuildResponse>,
  options: BuildAllOptions = {},
): Promise<BuildAllRecord[]> {
  const concurrency = Math.max(1, Math.min(4, Math.trunc(options.concurrency ?? 2)));
  const graph = analyseBuildGraph(targets);
  if (graph.missing.length) throw new Error(`Build graph contains ${graph.missing.length} missing dependency edge${graph.missing.length === 1 ? '' : 's'}`);
  if (graph.cycles.length) throw new Error(`Build graph contains ${graph.cycles.length} dependency cycle${graph.cycles.length === 1 ? '' : 's'}`);
  const records = new Map<string, BuildAllRecord>(targets.map((target) => [target.id, { targetId: target.id, targetName: target.name, status: 'queued', message: 'Waiting for dependencies' }]));
  const ordered = () => graph.order.map((id) => ({ ...records.get(id)! }));
  const publish = () => options.onUpdate?.(ordered());
  const running = new Map<string, Promise<void>>();
  const pending = new Set(graph.order);
  publish();

  const launch = (target: BuildTarget) => {
    const startedAt = Date.now();
    records.set(target.id, { targetId: target.id, targetName: target.name, status: 'running', startedAt, message: 'Running in build worker' });
    publish();
    const dependencies = target.dependencyTargetIds.map((id) => records.get(id)?.response).filter((response): response is BuildResponse => !!response);
    const task = execute(target, dependencies, options.signal).then((response) => {
      const errors = response.errors;
      records.set(target.id, { targetId: target.id, targetName: target.name, status: errors ? 'failed' : 'succeeded', startedAt, finishedAt: Date.now(), message: errors ? `${errors} build error${errors === 1 ? '' : 's'}` : `${response.artifact.bytes.length} bytes`, response });
    }).catch((error) => {
      const cancelled = options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError');
      records.set(target.id, { targetId: target.id, targetName: target.name, status: cancelled ? 'cancelled' : 'failed', startedAt, finishedAt: Date.now(), message: cancelled ? 'Cancelled' : error instanceof Error ? error.message : String(error), ...(error instanceof BuildExecutionError ? { failure: error.result } : {}) });
    }).finally(() => { running.delete(target.id); publish(); });
    running.set(target.id, task);
  };

  while (pending.size || running.size) {
    if (options.signal?.aborted) {
      for (const id of pending) { const target = records.get(id)!; records.set(id, { ...target, status: 'cancelled', finishedAt: Date.now(), message: 'Cancelled before start' }); }
      pending.clear(); publish();
    }
    let progressed = false;
    for (const id of graph.order) {
      if (!pending.has(id) || running.size >= concurrency) continue;
      const target = targets.find((candidate) => candidate.id === id)!;
      const dependencyRecords = target.dependencyTargetIds.map((dependencyId) => records.get(dependencyId)!);
      if (dependencyRecords.some((record) => ['failed', 'skipped', 'cancelled'].includes(record.status))) {
        pending.delete(id); records.set(id, { ...records.get(id)!, status: 'skipped', finishedAt: Date.now(), message: 'Skipped because a dependency did not succeed' }); publish(); progressed = true; continue;
      }
      if (!dependencyRecords.every((record) => record.status === 'succeeded')) continue;
      pending.delete(id); launch(target); progressed = true;
    }
    if (running.size) await Promise.race(running.values());
    else if (pending.size && !progressed) throw new Error('Build graph scheduler reached an impossible state');
  }
  return ordered();
}
