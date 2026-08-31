import type { ProjectFile, ProjectTarget } from '../project/project';
import type { BuildDiagnostic } from './assembler6502';
import { createBuildProvenance, fingerprint, toolchainFor, toolchainManifestDigest, validateBuildTarget, type BuildTarget } from './buildTarget';
import { sha256Hex } from './digest';
import { invokeBrowserToolchain, type AdapterArtifact } from './toolchainAdapter';
import { buildCacheKey, buildCacheStats, readBuildCache, writeBuildCache } from './buildCache';

export type BuildArtifact = AdapterArtifact;

export interface BuildRequest {
  target: BuildTarget;
  targets?: BuildTarget[];
  files: ProjectFile[];
  machine: { id: string; cpu: string };
  machineTarget: ProjectTarget;
  /** Set only by the dependency-aware build-all coordinator after prerequisite
   * workers succeeded. Their exact inputs still enter this artifact's provenance. */
  preparedDependencyInputIds?: string[];
  cacheMode?: 'use' | 'bypass';
}

export interface BuildResponse {
  artifact: BuildArtifact;
  errors: number;
  metadata: BuildResultMetadata;
}

export interface BuildResultMetadata {
  schema: '8bit-net.build-result';
  version: 1;
  invocation: { adapterId: string; adapterVersion: string; toolchainDigest: string; engine: 'browser-local' | 'server-native'; profile: BuildTarget['profile']; machineId: string; dependencyTargetIds: string[] };
  exit: { reason: 'succeeded' | 'diagnostics' | 'invalid-configuration' | 'dependency-failure' | 'adapter-failure' | 'timeout' | 'output-limit'; errors: number; warnings: number };
  timing: { durationMs: number };
  /* `bytes` is only reported by the server-side cache, which is on a disk
   * somebody has to keep; the browser-session cache is bounded by entry count
   * and its own byte budget and reports neither as a total. */
  cache: { status: 'hit' | 'miss' | 'bypassed'; reason: string; key?: string; entries: number; bytes?: number; hits: number; misses: number; corruptions: number; evictions: number };
  inputs: Array<{ id: string; name: string; bytes: number; fingerprint: string; sha256: string }>;
  artifacts: Array<{ name: string; kind: BuildArtifact['kind']; bytes: number; fingerprint: string; sha256: string }>;
  size: { outputBytes: number; mappedBytes: number; unmappedBytes: number; origin?: number; end?: number; symbols: number; sourceFiles: number };
  diagnostics: BuildDiagnostic[];
  logs: string[];
}

export class BuildExecutionError extends Error {
  readonly result: BuildResultMetadata;
  constructor(message: string, result: BuildResultMetadata) { super(message); this.name = 'BuildExecutionError'; this.result = result; }
}

/** One deterministic build implementation shared by the foreground commands
 * and the cancellable background worker. It has no UI/runtime side effects. */
export function executeBuild(request: BuildRequest): BuildResponse {
  const started = performance.now();
  if (request.cacheMode !== 'bypass') {
    const key = buildCacheKey(request);
    const cached = readBuildCache(key);
    if (cached) {
      cached.metadata.timing.durationMs = Math.max(0, performance.now() - started);
      cached.metadata.cache = { status: 'hit', reason: 'Integrity-verified browser-session content cache hit', key, ...buildCacheStats() };
      cached.metadata.logs = [...cached.metadata.logs, `Cache hit ${key}`];
      return cached;
    }
    const response = executeUncached(request, started);
    response.metadata.cache = { status: 'miss', reason: 'No integrity-verified entry matched every declared input', key, ...buildCacheStats() };
    response.metadata.logs = [...response.metadata.logs, `Cache miss ${key}`];
    writeBuildCache(key, response);
    Object.assign(response.metadata.cache, buildCacheStats());
    return response;
  }
  const response = executeUncached(request, started);
  response.metadata.cache = { status: 'bypassed', reason: 'Cache bypass requested for this invocation', ...buildCacheStats() };
  response.metadata.logs = [...response.metadata.logs, 'Cache bypass requested'];
  return response;
}

function executeUncached(request: BuildRequest, started: number): BuildResponse {
  if (request.preparedDependencyInputIds) return executeSingleBuild(request, new Set(request.preparedDependencyInputIds), started);
  const targets = request.targets ?? [request.target];
  const visiting = new Set<string>();
  const completed = new Map<string, BuildResponse>();
  const build = (target: BuildTarget): BuildResponse => {
    if (visiting.has(target.id)) throw buildExecutionError(request, 'dependency-failure', `Cyclic build-target dependency at ${target.name}`, started);
    const previous = completed.get(target.id);
    if (previous) return previous;
    visiting.add(target.id);
    const dependencyInputIds = new Set<string>();
    for (const dependencyId of target.dependencyTargetIds) {
      const dependency = targets.find((candidate) => candidate.id === dependencyId);
      if (!dependency) throw buildExecutionError(request, 'dependency-failure', `Build dependency ${dependencyId} is missing`, started);
      const dependencyResponse = build(dependency);
      if (dependencyResponse.errors) throw buildExecutionError(request, 'dependency-failure', `Build dependency ${dependency.name} produced ${dependencyResponse.errors} error${dependencyResponse.errors === 1 ? '' : 's'}`, started);
      dependencyResponse.artifact.provenance?.inputs.forEach((input) => dependencyInputIds.add(input.id));
    }
    visiting.delete(target.id);
    const response = executeSingleBuild({ ...request, target }, dependencyInputIds, started);
    completed.set(target.id, response);
    return response;
  };
  return build(request.target);
}

function executeSingleBuild(request: BuildRequest, dependencyInputIds = new Set<string>(), started = performance.now()): BuildResponse {
  const { target, files, machine, machineTarget } = request;
  const validation = validateBuildTarget(target, files, machine, request.targets);
  if (validation.length) throw buildExecutionError(request, 'invalid-configuration', validation[0]!, started);
  const file = files.find((candidate) => candidate.id === target.entryFileId);
  if (!file) throw buildExecutionError(request, 'invalid-configuration', 'The selected build target has no entry file', started);

  let built: AdapterArtifact;
  try { built = invokeBrowserToolchain({ target, entry: file, files }); }
  catch (error) {
    if (error instanceof BuildExecutionError) throw error;
    throw buildExecutionError(request, 'adapter-failure', error instanceof Error ? error.message : String(error), started);
  }
  const sourceIds = built.kind === '6502-binary' ? Object.keys(built.sourceFiles) : [file.id];
  const inputs = sourceIds.map((id) => files.find((candidate) => candidate.id === id)).filter((candidate): candidate is ProjectFile => !!candidate);
  files.filter((candidate) => dependencyInputIds.has(candidate.id) && !inputs.some((input) => input.id === candidate.id)).forEach((candidate) => inputs.push(candidate));
  const provenance = createBuildProvenance(target, machineTarget, inputs, built);
  const artifact: BuildArtifact = { ...built, provenance };
  const errors = artifact.diagnostics.filter((item) => item.severity === 'error').length;
  const warnings = artifact.diagnostics.filter((item) => item.severity === 'warning').length;
  const mappedBytes = artifact.kind === '6502-binary' ? Object.keys(artifact.sourceLocations).length : artifact.bytes.length;
  const origin = artifact.kind === '6502-binary' ? artifact.origin : undefined;
  const fingerprint = provenance.output.fingerprint;
  const metadata: BuildResultMetadata = {
    schema: '8bit-net.build-result', version: 1,
    invocation: { adapterId: provenance.toolchain.id, adapterVersion: provenance.toolchain.version, toolchainDigest: provenance.toolchainDigest, engine: 'browser-local', profile: target.profile, machineId: machine.id, dependencyTargetIds: [...target.dependencyTargetIds] },
    exit: { reason: errors ? 'diagnostics' : 'succeeded', errors, warnings },
    timing: { durationMs: Math.max(0, performance.now() - started) },
    cache: { status: 'bypassed', reason: 'Cache disposition is assigned by the build lifecycle', ...buildCacheStats() },
    inputs: provenance.inputs.map(({ id, name, bytes, fingerprint: inputFingerprint, sha256 }) => ({ id, name, bytes, fingerprint: inputFingerprint, sha256 })),
    artifacts: [{ name: target.outputName, kind: artifact.kind, bytes: artifact.bytes.length, fingerprint, sha256: provenance.output.sha256 }],
    size: { outputBytes: artifact.bytes.length, mappedBytes, unmappedBytes: Math.max(0, artifact.bytes.length - mappedBytes), ...(origin === undefined ? {} : { origin, end: artifact.bytes.length ? origin + artifact.bytes.length - 1 : origin }), symbols: artifact.kind === '6502-binary' ? Object.keys(artifact.symbols).length : 0, sourceFiles: inputs.length },
    diagnostics: artifact.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    logs: [`Adapter ${provenance.toolchain.id}@${provenance.toolchain.version} (${target.profile})`, `Read ${inputs.length} declared input${inputs.length === 1 ? '' : 's'}`, `${errors ? 'Rejected' : 'Produced'} ${target.outputName} · ${artifact.bytes.length} bytes · ${fingerprint}`],
  };
  return { artifact, errors, metadata };
}

export function buildExecutionError(request: BuildRequest, reason: Extract<BuildResultMetadata['exit']['reason'], 'invalid-configuration' | 'dependency-failure' | 'adapter-failure'>, message: string, started = performance.now()): BuildExecutionError {
  const manifest = toolchainFor(request.target.toolchainId);
  const declaredIds = new Set(request.target.sourceFileIds.concat(request.preparedDependencyInputIds ?? []));
  const inputs = request.files.filter((file) => declaredIds.has(file.id)).map((file) => {
    const bytes = new TextEncoder().encode(file.content);
    return { id: file.id, name: file.name, bytes: bytes.length, fingerprint: fingerprint(bytes), sha256: sha256Hex(bytes) };
  }).sort((left, right) => left.id.localeCompare(right.id));
  const entry = request.files.find((file) => file.id === request.target.entryFileId);
  const diagnostic: BuildDiagnostic = { severity: 'error', message, line: 1, column: 1, ...(entry ? { fileId: entry.id, fileName: entry.name } : {}) };
  const result: BuildResultMetadata = {
    schema: '8bit-net.build-result', version: 1,
    invocation: { adapterId: manifest?.id ?? request.target.toolchainId, adapterVersion: manifest?.version ?? request.target.toolchainVersion, toolchainDigest: manifest ? toolchainManifestDigest(manifest) : sha256Hex(new TextEncoder().encode(`${request.target.toolchainId}@${request.target.toolchainVersion}`)), engine: 'browser-local', profile: request.target.profile, machineId: request.machine.id, dependencyTargetIds: [...request.target.dependencyTargetIds] },
    exit: { reason, errors: 1, warnings: 0 },
    timing: { durationMs: Math.max(0, performance.now() - started) },
    cache: { status: 'bypassed', reason: 'Build failed before a cacheable artifact was produced', ...buildCacheStats() },
    inputs, artifacts: [],
    size: { outputBytes: 0, mappedBytes: 0, unmappedBytes: 0, symbols: 0, sourceFiles: inputs.length },
    diagnostics: [diagnostic],
    logs: [`Adapter ${manifest?.id ?? request.target.toolchainId}@${manifest?.version ?? request.target.toolchainVersion} (${request.target.profile})`, `Read ${inputs.length} declared input${inputs.length === 1 ? '' : 's'}`, `Stopped before artifact collection · ${reason} · ${message}`],
  };
  return new BuildExecutionError(message, result);
}
