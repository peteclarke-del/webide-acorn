import type { BuildRequest, BuildResponse } from './buildService';
import { tileMapAssetReferences } from '../assets/tileMapDocument';
import { sha256Hex } from './digest';
import { toolchainManifestDigest } from './buildTarget';
import { resolveIncluded } from '../project/includeResolution';

const MAX_ENTRIES = 24;
const MAX_BYTES = 8 * 1024 * 1024;
interface CacheRecord { response: BuildResponse; bytes: number; used: number }
const records = new Map<string, CacheRecord>();
let clock = 0; let hits = 0; let misses = 0; let corruptions = 0; let evictions = 0;

export interface BuildCacheStats { entries: number; bytes: number; hits: number; misses: number; corruptions: number; evictions: number }

export function buildCacheKey(request: BuildRequest): string {
  const declared = {
    target: request.target,
    targets: request.targets ?? [request.target],
    machine: request.machine,
    machineTarget: request.machineTarget,
    preparedDependencyInputIds: request.preparedDependencyInputIds ?? [],
    files: declaredInputFiles(request).map(({ id, name, language, content }) => ({ id, name, language, content })).sort((left, right) => left.id.localeCompare(right.id)),
  };
  return sha256Hex(new TextEncoder().encode(stableJson(declared)));
}

export function readBuildCache(key: string): BuildResponse | undefined {
  const record = records.get(key);
  if (!record) { misses += 1; return undefined; }
  const artifact = record.response.metadata.artifacts[0];
  const provenance = record.response.artifact.provenance;
  const sourcesValid = record.response.artifact.kind !== '6502-binary' || provenance?.inputs.every((input) => {
    const source = record.response.artifact.kind === '6502-binary' ? record.response.artifact.sourceFiles[input.id] : undefined;
    return !source || sha256Hex(new TextEncoder().encode(source.content)) === input.sha256;
  });
  if (!artifact || !provenance || artifact.sha256 !== sha256Hex(record.response.artifact.bytes) || provenance.output.sha256 !== artifact.sha256 || provenance.toolchainDigest !== toolchainManifestDigest(provenance.toolchain) || !sourcesValid) {
    records.delete(key); corruptions += 1; misses += 1; return undefined;
  }
  record.used = ++clock; hits += 1;
  return structuredClone(record.response);
}

export function writeBuildCache(key: string, response: BuildResponse): void {
  if (response.errors || !response.metadata.artifacts.length) return;
  const bytes = response.artifact.bytes.length + response.metadata.inputs.reduce((total, input) => total + input.bytes, 0);
  if (bytes > MAX_BYTES) return;
  records.set(key, { response: structuredClone(response), bytes, used: ++clock });
  while (records.size > MAX_ENTRIES || cacheBytes() > MAX_BYTES) {
    const oldest = [...records.entries()].sort((left, right) => left[1].used - right[1].used)[0];
    if (!oldest) break;
    records.delete(oldest[0]); evictions += 1;
  }
}

export function buildCacheStats(): BuildCacheStats { return { entries: records.size, bytes: cacheBytes(), hits, misses, corruptions, evictions }; }

export function clearBuildCache(): void { records.clear(); hits = 0; misses = 0; corruptions = 0; evictions = 0; clock = 0; }

/** Test-only fault injection still traverses normal digest verification. */
export function corruptBuildCacheEntry(key: string): boolean {
  const record = records.get(key); if (!record) return false;
  if (record.response.artifact.bytes.length) record.response.artifact.bytes[0] = record.response.artifact.bytes[0]! ^ 0xff;
  else record.response.metadata.artifacts[0]!.sha256 = 'corrupt';
  return true;
}

function cacheBytes() { return [...records.values()].reduce((total, record) => total + record.bytes, 0); }
function declaredInputFiles(request: BuildRequest) {
  const byId = new Map(request.files.map((file) => [file.id, file]));
  const byName = new Map(request.files.map((file) => [file.name.toLowerCase(), file]));
  const targets = new Map((request.targets ?? [request.target]).map((target) => [target.id, target]));
  const ids = new Set(request.preparedDependencyInputIds ?? []);
  const targetSeen = new Set<string>();
  const addFile = (id: string) => {
    if (ids.has(id)) return;
    ids.add(id); const file = byId.get(id);
    if (!file) return;
    if (/\.map\.json$/i.test(file.name)) {
      for (const assetFile of tileMapAssetReferences(file.content)) {
        const asset = resolveIncluded(byName, assetFile, file.name);
        if (asset) addFile(asset.id);
      }
      return;
    }
    if (file.language !== '6502') return;
    for (const line of file.content.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')) {
      const include = /^\s*INCLUDE\s+(?:"([^"]+)"|'([^']+)'|([^\s;]+))\s*(?:;.*)?$/i.exec(line);
      const assetInclude = /^\s*INCLUDE(?:ASSET|MAP|PALETTE|FONT|SCREEN|SONG)\s+(?:"([^"]+)"|'([^']+)'|([^\s;]+))\s*(?:;.*)?$/i.exec(line);
      const matched = include ?? assetInclude;
      const included = matched && resolveIncluded(byName, (matched[1] ?? matched[2] ?? matched[3])!, file.name);
      if (included) addFile(included.id);
    }
  };
  const addTarget = (id: string) => {
    if (targetSeen.has(id)) return;
    targetSeen.add(id); const target = targets.get(id); if (!target) return;
    target.sourceFileIds.forEach(addFile); target.dependencyTargetIds.forEach(addTarget);
  };
  addTarget(request.target.id);
  return [...ids].map((id) => byId.get(id)).filter((file): file is BuildRequest['files'][number] => !!file);
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
