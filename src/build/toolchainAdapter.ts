import type { Processor } from '../analysis/types';
import type { ProjectFile } from '../project/project';
import type { AssemblyArtifact } from './assembler6502';
import type { ArmArtifact } from './artifactTypes';
import { prepareAtomBasic, tokenizeBasic, type BasicArtifact } from './basicTokeniser';
import { BUILD_PROFILES, buildProfileDefines, buildProfileKeepsDebugMetadata, parseBuildAddress, parsedBuildDefines, resolveAssemblyEntryPoint, TOOLCHAINS, type BuildTarget, type ToolchainId, type ToolchainManifest } from './buildTarget';
import { assembleProject6502 } from './projectAssembler6502';

export type AdapterArtifact = AssemblyArtifact | ArmArtifact | BasicArtifact;

export interface ToolchainInvocation {
  target: BuildTarget;
  entry: ProjectFile;
  files: ProjectFile[];
}

export interface BrowserToolchainAdapter {
  manifest: ToolchainManifest;
  profileIds: ReadonlyArray<(typeof BUILD_PROFILES)[number]['id']>;
  invoke(invocation: ToolchainInvocation): AdapterArtifact;
}

const basicAdapter = (manifest: ToolchainManifest): BrowserToolchainAdapter => ({
  manifest,
  profileIds: ['debug'],
  invoke: ({ entry }) => {
    const built = manifest.id === '8bit-net.basic.atom' ? prepareAtomBasic(entry.content) : tokenizeBasic(entry.content);
    return { ...built, diagnostics: built.diagnostics.map((item) => ({ ...item, fileId: entry.id, fileName: entry.name })) };
  },
});

/** Both CPU modes intentionally share expansion, diagnostics and artifact
 * normalization. Only the manifest-selected opcode table differs. */
const assemblyAdapter = (manifest: ToolchainManifest): BrowserToolchainAdapter => ({
  manifest,
  profileIds: BUILD_PROFILES.map((profile) => profile.id),
  invoke: ({ target, entry, files }) => {
    const processor: Processor = manifest.processor === '65c02' ? '65c02' : '6502';
    const built = assembleProject6502(entry.id, files, processor, {
      defaultOrigin: parseBuildAddress(target.memoryLayout.defaultOrigin) ?? 0x1900,
      maximumAddress: parseBuildAddress(target.memoryLayout.maximumAddress) ?? 0xffff,
      defines: { ...parsedBuildDefines(target.defines), ...buildProfileDefines(target) },
      sourceFileIds: target.sourceFileIds,
    });
    const resolvedEntry = built.diagnostics.some((item) => item.severity === 'error')
      ? { entryPoint: built.entryPoint }
      : resolveAssemblyEntryPoint(target, built);
    const normalized = resolvedEntry.error
      ? { ...built, diagnostics: [...built.diagnostics, { line: 1, column: 1, severity: 'error' as const, message: resolvedEntry.error, fileId: entry.id, fileName: entry.name }] }
      : { ...built, entryPoint: resolvedEntry.entryPoint ?? built.entryPoint };
    return buildProfileKeepsDebugMetadata(target) ? normalized : { ...normalized, sourceMap: {}, sourceLocations: {}, listing: [] };
  },
});

export const BROWSER_TOOLCHAIN_ADAPTERS: readonly BrowserToolchainAdapter[] = TOOLCHAINS.filter((manifest) => manifest.execution === 'browser-local').map((manifest) => manifest.language === '6502' ? assemblyAdapter(manifest) : basicAdapter(manifest));

export function browserToolchainAdapter(id: ToolchainId): BrowserToolchainAdapter | undefined {
  return BROWSER_TOOLCHAIN_ADAPTERS.find((adapter) => adapter.manifest.id === id);
}

export function invokeBrowserToolchain(invocation: ToolchainInvocation): AdapterArtifact {
  const adapter = browserToolchainAdapter(invocation.target.toolchainId);
  if (!adapter) throw new Error(`No browser toolchain adapter is registered for ${invocation.target.toolchainId}`);
  if (!adapter.profileIds.includes(invocation.target.profile)) throw new Error(`${adapter.manifest.label} does not support the ${invocation.target.profile} build profile`);
  return adapter.invoke(invocation);
}
