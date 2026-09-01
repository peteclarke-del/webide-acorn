import { apiPath, type ApiOperationId } from '../api/contracts';
import type { ProjectFile } from '../project/project';
import type { BuildDiagnostic, RetainedArtifactDocument, SourceLocation } from './assembler6502';
import type { ArmArtifact, MachineCodeArtifact } from './artifactTypes';
import { createBuildProvenance, parseBuildAddress, parsedBuildDefines, toolchainFor } from './buildTarget';
import { BuildExecutionError, type BuildRequest, type BuildResponse, type BuildResultMetadata } from './buildService';
import { sourceInputsForTarget } from './buildGraph';

export interface NativeToolchainStatus {
  id: 'cc65.ca65-ld65' | 'stardot.beebasm' | 'cc65.c-bbc' | 'gnu.arm-none-eabi-binutils';
  ready: boolean;
  label: string;
  adapterVersion: string;
  packageVersion?: string;
  digest: string;
  ca65?: { version: string; sha256: string };
  ld65?: { version: string; sha256: string };
  upstream?: { version: string; commit: string };
  binary?: { sha256: string };
  compiler?: { version: string; sha256: string };
  runtime?: { id: string; version: string; files: Record<string, string> };
  tools?: Record<string, { version: string; sha256: string }>;
  output?: { format: string; elfMetadataRetained: boolean; riscOsApplication: boolean; filetype: null };
}

interface Native6502Artifact {
  kind: '6502-binary'; bytesBase64: string; origin: number; entryPoint: number; processor: '6502' | '65c02';
  symbols: Record<string, number>; sourceLocations: Record<string, SourceLocation>; sourceMap: Record<string, number>;
  entryFileId: string; dependencies: string[]; listing: string[]; diagnostics: BuildDiagnostic[];
}
interface NativeArmArtifact extends Omit<ArmArtifact, 'bytes' | 'sourceFiles' | 'retainedDocuments' | 'provenance' | 'sourceLocations' | 'sourceMap'> {
  bytesBase64: string; sourceLocations: Record<string, SourceLocation>; sourceMap: Record<string, number>;
}

interface NativeResponse {
  schema: '8bit-net.native-build-response'; version: 1; result: BuildResultMetadata; artifact: Native6502Artifact | NativeArmArtifact | null;
  documents: RetainedArtifactDocument[];
}

/*
 * Which operation answers for which toolchain.
 *
 * The paths come from the generated contracts rather than from a template, so a
 * route renamed in the description fails to compile here instead of 404ing at
 * somebody. The identifiers on the left are this build's toolchain ids and the
 * ones on the right are the description's operations; the mapping between them
 * is the only thing left to state.
 */
const MANIFEST_OPERATIONS: Record<string, ApiOperationId> = {
  'stardot.beebasm': 'toolchainBeebAsm',
  'cc65.c-bbc': 'toolchainCc65C',
  'gnu.arm-none-eabi-binutils': 'toolchainArmBinutils',
  'cc65.ca65-ld65': 'toolchainCa65',
};

const BUILD_OPERATIONS: Record<string, ApiOperationId> = {
  'stardot.beebasm': 'buildBeebAsm',
  'cc65.c-bbc': 'buildCc65C',
  'gnu.arm-none-eabi-binutils': 'buildArmBinutils',
  'cc65.ca65-ld65': 'buildCa65',
};

export async function detectNativeToolchain(id: NativeToolchainStatus['id'] = 'cc65.ca65-ld65', signal?: AbortSignal): Promise<NativeToolchainStatus | null> {
  try {
    const response = await fetch(apiPath(MANIFEST_OPERATIONS[id] ?? 'toolchainCa65'), { signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) return null;
    const value = await response.json() as NativeToolchainStatus;
    return value.ready && value.id === id && value.adapterVersion === '2026.08.1' ? value : null;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return null;
  }
}

export async function detectNativeToolchains(signal?: AbortSignal): Promise<NativeToolchainStatus[]> {
  const statuses = await Promise.all([detectNativeToolchain('cc65.ca65-ld65', signal), detectNativeToolchain('stardot.beebasm', signal), detectNativeToolchain('cc65.c-bbc', signal), detectNativeToolchain('gnu.arm-none-eabi-binutils', signal)]);
  return statuses.filter((status): status is NativeToolchainStatus => status !== null);
}

export async function invokeNativeToolchain(request: BuildRequest, signal?: AbortSignal): Promise<BuildResponse> {
  const selectedIds = new Set(sourceInputsForTarget(request.target, request.files).concat(request.preparedDependencyInputIds ?? []));
  const files = request.files.filter((file) => selectedIds.has(file.id));
  const correlationId = crypto.randomUUID();
  const payload = {
    schema: '8bit-net.native-build-request', version: 1, requestId: correlationId,
    target: {
      id: request.target.id, machineId: request.machine.id, profile: request.target.profile,
      profileGoal: request.target.profileOptions.customGoal, debugMetadata: request.target.profileOptions.debugMetadata,
      processor: request.target.toolchainId === 'gnu.arm-none-eabi-binutils' ? 'arm2' : request.machine.cpu.includes('65C12') ? '65c02' : '6502', outputName: request.target.outputName,
      origin: parseBuildAddress(request.target.memoryLayout.defaultOrigin), maximumAddress: parseBuildAddress(request.target.memoryLayout.maximumAddress),
      entry: request.target.entryPoint,
    },
    files: files.map(({ id, name, content }) => ({ id, name, content })), sourceUnitIds: request.target.sourceFileIds,
    defines: parsedBuildDefines(request.target.defines),
    /* Rebuild means rebuild on the server too. The builder keeps results
     * between requests, so a person who suspects a stored one is wrong needs
     * the same way past it that the browser-session cache already gives them. */
    cache: { bypass: request.cacheMode === 'bypass' },
  };
  let response: Response;
  try {
    response = await fetch(apiPath(BUILD_OPERATIONS[request.target.toolchainId] ?? 'buildCa65'), { method: 'POST', signal, cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-8bit-Net-Request': 'native-build', 'X-Correlation-ID': correlationId }, body: JSON.stringify(payload) });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error(`Native builder could not be reached: ${error instanceof Error ? error.message : String(error)}`);
  }
  const body = await response.json().catch(() => null) as NativeResponse | { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(body && 'error' in body ? body.error?.message ?? `Native builder returned HTTP ${response.status}` : `Native builder returned HTTP ${response.status}`);
  if (!body || !('schema' in body) || body.schema !== '8bit-net.native-build-response') throw new Error('Native builder returned an unsupported response');
  const native = body as NativeResponse;
  native.result.invocation.dependencyTargetIds = [...request.target.dependencyTargetIds];
  if (!native.artifact) throw new BuildExecutionError(native.result.diagnostics[0]?.message ?? 'Native build produced no artifact', native.result);
  const bytes = decodeBase64(native.artifact.bytesBase64);
  const sourceFiles = Object.fromEntries(files.map((file: ProjectFile) => [file.id, { name: file.name, content: file.content }]));
  const artifact: MachineCodeArtifact = {
    ...native.artifact, bytes, sourceLocations: Object.fromEntries(Object.entries(native.artifact.sourceLocations).map(([address, location]) => [Number(address), location])),
    sourceMap: Object.fromEntries(Object.entries(native.artifact.sourceMap).map(([address, line]) => [Number(address), line])),
    sourceFiles, retainedDocuments: native.documents,
  };
  const manifest = toolchainFor(request.target.toolchainId);
  if (!manifest) throw new Error(`Unknown native toolchain ${request.target.toolchainId}`);
  artifact.provenance = createBuildProvenance(request.target, request.machineTarget, files, artifact);
  native.result.artifacts = [{ name: request.target.outputName, kind: artifact.kind, bytes: bytes.length, fingerprint: artifact.provenance.output.fingerprint, sha256: artifact.provenance.output.sha256 }];
  return { artifact, errors: native.result.exit.errors, metadata: native.result };
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
