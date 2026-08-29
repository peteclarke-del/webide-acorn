import type { ProjectFile, ProjectTarget, SourceLanguage } from '../project/project';
import { sha256Hex } from './digest';

export const BUILD_TARGET_SCHEMA = 5 as const;
export const TOOLCHAIN_REGISTRY_VERSION = '2026.08.2';

export type BuildProfileId = 'debug' | 'size' | 'speed' | 'custom';
export interface BuildProfileOptions {
  customGoal: 'balanced' | 'size' | 'speed';
  debugMetadata: 'full' | 'none';
}

export interface BuildProfileManifest {
  id: BuildProfileId;
  label: string;
  goal: string;
  sourceFidelity: string;
  runtimeImpact: string;
  sizeImpact: string;
  compatibility: string;
}

export const BUILD_PROFILES: readonly BuildProfileManifest[] = [
  { id: 'debug', label: 'Debug', goal: 'Exact source debugging', sourceFidelity: 'Full byte-level source map, listing and symbols', runtimeImpact: 'No instrumentation or runtime overhead', sizeImpact: 'No automatic byte rewriting', compatibility: 'Binary instruction compatibility is unchanged' },
  { id: 'size', label: 'Size', goal: 'Author-directed smallest output', sourceFidelity: 'Full source map retained for hand-authored code', runtimeImpact: 'Depends on code selected with the profile symbol', sizeImpact: 'No unsafe automatic optimizer; measured output size is reported', compatibility: 'Binary instruction compatibility is unchanged' },
  { id: 'speed', label: 'Speed', goal: 'Author-directed fastest path', sourceFidelity: 'Full source map retained for hand-authored code', runtimeImpact: 'Depends on code selected with the profile symbol', sizeImpact: 'May grow only when authored source uses the profile symbol', compatibility: 'Binary instruction compatibility is unchanged' },
  { id: 'custom', label: 'Custom', goal: 'Explicit project-selected trade-offs', sourceFidelity: 'Full or deliberately omitted debug metadata', runtimeImpact: 'Balanced, size or speed intent is exposed as a build symbol', sizeImpact: 'No hidden code transformation', compatibility: 'Metadata omission affects IDE debugging, not machine execution' },
] as const;

export type ToolchainId = '8bit-net.basic.bbc2' | '8bit-net.basic.atom' | '8bit-net.asm.6502' | '8bit-net.asm.65c12' | 'cc65.ca65-ld65' | 'stardot.beebasm' | 'cc65.c-bbc' | 'gnu.arm-none-eabi-binutils';

export interface BuildTarget {
  schemaVersion: typeof BUILD_TARGET_SCHEMA;
  id: string;
  name: string;
  entryFileId: string;
  toolchainId: ToolchainId;
  outputName: string;
  buildPolicy: 'manual' | 'on-save' | 'live';
  entryPoint: { mode: 'source' | 'symbol' | 'address'; value: string };
  machineProfile: 'project';
  language: Extract<SourceLanguage, 'bbc-basic' | '6502' | 'arm' | 'c'>;
  toolchainVersion: string;
  roots: string[];
  defines: string[];
  includePaths: string[];
  sourceFileIds: string[];
  libraryIds: string[];
  generatedAssetIds: string[];
  memoryLayout: { defaultOrigin: string; maximumAddress: string };
  outputType: ToolchainManifest['artifactKind'];
  loadAddress: 'toolchain';
  profile: BuildProfileId;
  profileOptions: BuildProfileOptions;
  dependencyTargetIds: string[];
  postProcessorIds: string[];
}

export interface ToolchainManifest {
  id: ToolchainId;
  label: string;
  version: string;
  language: Extract<SourceLanguage, 'bbc-basic' | '6502' | 'arm' | 'c'>;
  processor?: '6502' | '65c02' | 'arm2';
  artifactKind: 'bbc-basic-program' | 'atom-basic-text' | '6502-binary' | 'arm-binary';
  execution: 'browser-local' | 'server-native';
  deterministic: true;
}

export interface BuildProvenance {
  schema: '8bit-net.build-provenance';
  version: 2;
  fingerprintAlgorithm: 'fnv1a32';
  digestAlgorithm: 'sha256';
  fingerprint: string;
  target: BuildTarget;
  toolchain: ToolchainManifest;
  toolchainDigest: string;
  machineTarget: ProjectTarget;
  inputs: Array<{ id: string; name: string; language: SourceLanguage; bytes: number; fingerprint: string; sha256: string }>;
  output: { kind: ToolchainManifest['artifactKind']; bytes: number; fingerprint: string; sha256: string };
}

export const TOOLCHAINS: readonly ToolchainManifest[] = [
  { id: '8bit-net.basic.bbc2', label: 'BBC BASIC II tokenizer', version: TOOLCHAIN_REGISTRY_VERSION, language: 'bbc-basic', artifactKind: 'bbc-basic-program', execution: 'browser-local', deterministic: true },
  { id: '8bit-net.basic.atom', label: 'Atom BASIC text packer', version: TOOLCHAIN_REGISTRY_VERSION, language: 'bbc-basic', artifactKind: 'atom-basic-text', execution: 'browser-local', deterministic: true },
  { id: '8bit-net.asm.6502', label: '8bit-net NMOS 6502 assembler', version: TOOLCHAIN_REGISTRY_VERSION, language: '6502', processor: '6502', artifactKind: '6502-binary', execution: 'browser-local', deterministic: true },
  { id: '8bit-net.asm.65c12', label: '8bit-net Acorn 65C12 assembler', version: TOOLCHAIN_REGISTRY_VERSION, language: '6502', processor: '65c02', artifactKind: '6502-binary', execution: 'browser-local', deterministic: true },
  { id: 'cc65.ca65-ld65', label: 'ca65 + ld65 (isolated native)', version: '2026.08.1', language: '6502', artifactKind: '6502-binary', execution: 'server-native', deterministic: true },
  { id: 'stardot.beebasm', label: 'BeebAsm 1.11 · BBC-style (isolated native)', version: '2026.08.1', language: '6502', artifactKind: '6502-binary', execution: 'server-native', deterministic: true },
  { id: 'cc65.c-bbc', label: 'cc65 C + WebIDE BBC runtime (isolated native)', version: '2026.08.1', language: 'c', processor: '6502', artifactKind: '6502-binary', execution: 'server-native', deterministic: true },
  { id: 'gnu.arm-none-eabi-binutils', label: 'GNU ARM binutils · ARM2 raw binary (isolated native)', version: '2026.08.1', language: 'arm', processor: 'arm2', artifactKind: 'arm-binary', execution: 'server-native', deterministic: true },
] as const;

export function toolchainFor(id: string): ToolchainManifest | undefined {
  return TOOLCHAINS.find((item) => item.id === id);
}

export function compatibleToolchains(language: SourceLanguage, nativeReady: boolean | ReadonlySet<string> = false): readonly ToolchainManifest[] {
  return TOOLCHAINS.filter((item) => item.language === language && (item.execution === 'browser-local' || nativeReady === true || (nativeReady instanceof Set && nativeReady.has(item.id))));
}

export function defaultToolchainId(language: SourceLanguage): ToolchainId {
  return language === 'bbc-basic' ? '8bit-net.basic.bbc2' : language === 'c' ? 'cc65.c-bbc' : language === 'arm' ? 'gnu.arm-none-eabi-binutils' : '8bit-net.asm.6502';
}

export function createBuildTarget(file: Pick<ProjectFile, 'id' | 'name' | 'language'>): BuildTarget {
  const base = file.name.replace(/\.[^.]+$/, '') || 'program';
  const toolchainId = defaultToolchainId(file.language);
  const toolchain = toolchainFor(toolchainId)!;
  return {
    schemaVersion: BUILD_TARGET_SCHEMA,
    id: crypto.randomUUID(),
    name: `${base} build`,
    entryFileId: file.id,
    toolchainId,
    outputName: `${base}${file.language === 'bbc-basic' ? '.bbc' : '.bin'}`,
    buildPolicy: 'manual',
    entryPoint: { mode: 'source', value: '' },
    ...buildTargetDeclarations(toolchain, file.id),
  };
}

export function validateBuildTarget(target: BuildTarget, files: ProjectFile[], machine: { cpu: string; id?: string }, targets: BuildTarget[] = [target], nativeReady = true): string[] {
  const errors: string[] = [];
  const entry = files.find((file) => file.id === target.entryFileId);
  const toolchain = toolchainFor(target.toolchainId);
  if (target.schemaVersion !== BUILD_TARGET_SCHEMA) errors.push(`Unsupported build target schema ${target.schemaVersion}`);
  if (!target.name.trim()) errors.push('Build target name is required');
  if (!entry) errors.push('The entry file is missing from this project');
  if (!toolchain) errors.push(`Unknown toolchain ${target.toolchainId}`);
  if (toolchain?.execution === 'server-native' && !nativeReady) errors.push(`${toolchain.label} is unavailable because the isolated native builder is not ready`);
  if (target.toolchainId === 'stardot.beebasm' && target.sourceFileIds.length !== 1) errors.push('BeebAsm requires one root source unit; use INCLUDE for subordinate files');
  if (target.toolchainId === 'cc65.c-bbc' && target.sourceFileIds.some((id) => !/\.c$/i.test(files.find((file) => file.id === id)?.name ?? ''))) errors.push('cc65 translation units must be .c files; headers are discovered through #include');
  if (target.toolchainId === 'cc65.c-bbc' && machine.id && !['bbc-b', 'bbc-b-plus', 'master'].includes(machine.id)) errors.push('The current cc65 runtime is validated for BBC B, B+ and Master targets only');
  if (target.toolchainId === 'gnu.arm-none-eabi-binutils' && machine.id && !['archimedes-a300', 'archimedes-a400', 'a3000'].includes(machine.id)) errors.push('The first ARM2 raw-binary adapter is scoped to the A300, A400/1 and A3000 Archimedes profiles');
  if (entry && toolchain && entry.language !== toolchain.language) errors.push(`${toolchain.label} cannot compile ${entry.language} source`);
  if (toolchain && target.language !== toolchain.language) errors.push('The declared target language does not match its toolchain');
  if (toolchain && target.toolchainVersion !== toolchain.version) errors.push(`Toolchain version ${target.toolchainVersion || '(missing)'} is unavailable; select ${toolchain.version}`);
  if (toolchain && target.outputType !== toolchain.artifactKind) errors.push('The declared output type does not match its toolchain');
  if (target.machineProfile !== 'project') errors.push('Machine profile must currently bind to the project profile');
  if (target.roots.length !== 1 || target.roots[0] !== '.') errors.push('This project format currently supports the project root only');
  if (target.includePaths.some((path) => path !== '.')) errors.push('This flat project format currently supports the project include path only');
  if (!target.sourceFileIds.includes(target.entryFileId)) errors.push('Declared source units must include the entry file');
  if (new Set(target.sourceFileIds).size !== target.sourceFileIds.length) errors.push('Declared source units must be unique');
  if (target.sourceFileIds.some((id) => !files.some((file) => file.id === id))) errors.push('A declared source unit is missing from the project');
  if (entry && target.sourceFileIds.some((id) => files.find((file) => file.id === id)?.language !== entry.language)) errors.push('All declared source units must use the entry language');
  const defineNames = new Set<string>();
  for (const define of target.defines) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/.exec(define);
    if (!match || parseBuildAddress(match[2] ?? '') === null) { errors.push(`Invalid define “${define}”; use NAME=&FFFF`); continue; }
    const name = match[1]!.toUpperCase();
    if (defineNames.has(name)) errors.push(`Duplicate define ${match[1]}`);
    if (name.startsWith('BUILD_PROFILE_')) errors.push(`${match[1]} is reserved for the selected build profile`);
    defineNames.add(name);
  }
  if (target.libraryIds.length) errors.push('No link-library registry is available for this toolchain');
  if (target.generatedAssetIds.length) errors.push('No generated-asset registry is available for this toolchain');
  if (target.postProcessorIds.length) errors.push('No post-processors are registered for this toolchain');
  if (!BUILD_PROFILES.some((profile) => profile.id === target.profile)) errors.push('Build profile must be debug, size, speed or custom');
  if (!['balanced', 'size', 'speed'].includes(target.profileOptions.customGoal)) errors.push('Custom profile goal is invalid');
  if (!['full', 'none'].includes(target.profileOptions.debugMetadata)) errors.push('Custom debug metadata mode is invalid');
  if (entry?.language === 'bbc-basic' && target.profile !== 'debug') errors.push('The BASIC packers support the debug/no-transform profile only');
  if (target.loadAddress !== 'toolchain') errors.push('Load address must be derived by the selected non-relocatable toolchain');
  if (target.dependencyTargetIds.includes(target.id)) errors.push('A build target cannot depend on itself');
  if (new Set(target.dependencyTargetIds).size !== target.dependencyTargetIds.length) errors.push('Build target dependencies must be unique');
  if (target.dependencyTargetIds.some((id) => !targets.some((candidate) => candidate.id === id))) errors.push('A declared build-target dependency is missing');
  const visit = (candidate: BuildTarget, path: Set<string>): boolean => {
    if (path.has(candidate.id)) return true;
    const next = new Set(path).add(candidate.id);
    return candidate.dependencyTargetIds.some((id) => {
      const dependency = targets.find((item) => item.id === id);
      return !!dependency && visit(dependency, next);
    });
  };
  if (visit(target, new Set())) errors.push('Build-target dependencies contain a cycle');
  const origin = parseBuildAddress(target.memoryLayout.defaultOrigin);
  const maximum = parseBuildAddress(target.memoryLayout.maximumAddress);
  if ((entry?.language === '6502' || entry?.language === 'c' || entry?.language === 'arm') && origin === null) errors.push(`Default origin must be a ${entry.language === 'arm' ? '26-bit' : '16-bit'} decimal, &hex or 0xhex value`);
  if ((entry?.language === '6502' || entry?.language === 'c' || entry?.language === 'arm') && maximum === null) errors.push(`Maximum output address must be a ${entry.language === 'arm' ? '26-bit' : '16-bit'} decimal, &hex or 0xhex value`);
  if ((entry?.language === '6502' || entry?.language === 'c' || entry?.language === 'arm') && origin !== null && maximum !== null && maximum < origin) errors.push('Maximum output address must not precede the default origin');
  if ((entry?.language === '6502' || entry?.language === 'c') && ((origin ?? 0) > 0xffff || (maximum ?? 0) > 0xffff)) errors.push('6502 load and maximum addresses must remain within 16 bits');
  if (entry?.language === 'arm' && origin !== null && maximum !== null && (origin < 0x8000 || maximum > 0x03ffffff || (origin & 3) !== 0 || ((maximum + 1) & 3) !== 0)) errors.push('ARM2 output must use a word-aligned range from &00008000 through &03FFFFFF');
  if (entry?.language === 'c' && origin !== null && origin < 0x0e00) errors.push('BBC C code must load at or above &0E00');
  if (entry?.language === 'c' && maximum !== null && maximum >= 0x7200) errors.push('BBC C code/data must finish below the runtime stack at &7200');
  if (!target.outputName.trim() || /[\\/\x00-\x1f]/.test(target.outputName) || target.outputName.length > 128) errors.push('Output name must be 1–128 characters without paths or control characters');
  if (!['manual', 'on-save', 'live'].includes(target.buildPolicy)) errors.push('Build policy must be manual, on-save or live');
  if (!['source', 'symbol', 'address'].includes(target.entryPoint.mode)) errors.push('Entry-point mode is invalid');
  if (entry?.language === 'bbc-basic' && target.entryPoint.mode !== 'source') errors.push('BASIC execution starts through its interpreter and cannot override the entry point');
  if (entry?.language === 'c' && target.entryPoint.mode !== 'source') errors.push('C execution must enter through the generated runtime startup');
  if (target.entryPoint.mode === 'symbol' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(target.entryPoint.value.trim())) errors.push('Entry symbol must be a declared assembly identifier');
  if (target.entryPoint.mode === 'address' && parseBuildAddress(target.entryPoint.value) === null) errors.push('Entry address must be a bounded decimal, &hex or 0xhex value');
  if (target.entryPoint.mode === 'address' && entry?.language !== 'arm' && (parseBuildAddress(target.entryPoint.value) ?? 0) > 0xffff) errors.push('6502 entry addresses must remain within 16 bits');
  if (toolchain?.processor === '65c02' && !machine.cpu.includes('65C12')) errors.push('The selected machine does not provide the 65C12 instruction set required by this target');
  if (machine.id === 'atom' && target.toolchainId === '8bit-net.basic.bbc2') errors.push('Select the Atom BASIC text packer for an Acorn Atom target');
  if (machine.id && machine.id !== 'atom' && target.toolchainId === '8bit-net.basic.atom') errors.push('The Atom BASIC text packer requires an Acorn Atom target');
  return errors;
}

export function resolveAssemblyEntryPoint(target: BuildTarget, artifact: { origin: number; entryPoint: number; bytes: Uint8Array; symbols: Record<string, number> }): { entryPoint?: number; error?: string } {
  if (target.entryPoint.mode === 'source') return { entryPoint: artifact.entryPoint };
  let entryPoint: number | undefined;
  if (target.entryPoint.mode === 'address') entryPoint = parseBuildAddress(target.entryPoint.value) ?? undefined;
  else {
    const requested = target.entryPoint.value.trim().toUpperCase();
    const symbol = Object.entries(artifact.symbols).find(([name]) => name.toUpperCase() === requested);
    if (!symbol) return { error: `Entry symbol ${target.entryPoint.value.trim()} was not produced by this build` };
    entryPoint = symbol[1];
  }
  if (entryPoint === undefined || entryPoint < artifact.origin || entryPoint >= artifact.origin + artifact.bytes.length) return { error: `Entry point ${entryPoint === undefined ? target.entryPoint.value : `&${entryPoint.toString(16).toUpperCase().padStart(4, '0')}`} is outside the output range` };
  return { entryPoint };
}

export function shouldScheduleBackgroundBuild(target: BuildTarget, trigger: 'save' | 'change', savedFileId: string | '*' = '*', artifactPinned = false, resolvedInputIds: readonly string[] = target.sourceFileIds) {
  if (artifactPinned) return false;
  if (trigger === 'change') return target.buildPolicy === 'live';
  return target.buildPolicy === 'on-save' && (savedFileId === '*' || resolvedInputIds.includes(savedFileId));
}

export function buildEntryUpdate(target: BuildTarget, previous: Pick<ProjectFile, 'name'> | undefined, next: Pick<ProjectFile, 'id' | 'name' | 'language'>, toolchainId: ToolchainId): Partial<BuildTarget> {
  const previousBase = previous?.name.replace(/\.[^.]+$/, '') || '';
  const nextBase = next.name.replace(/\.[^.]+$/, '') || 'program';
  const automaticName = !!previousBase && target.name === `${previousBase} build`;
  const automaticOutput = !!previousBase && [`${previousBase}.bbc`, `${previousBase}.atom.txt`, `${previousBase}.bin`].some((name) => target.outputName.toLowerCase() === name.toLowerCase());
  return {
    entryFileId: next.id,
    toolchainId,
    ...(automaticName ? { name: `${nextBase} build` } : {}),
    ...(automaticOutput ? { outputName: `${nextBase}${next.language === 'bbc-basic' ? toolchainId === '8bit-net.basic.atom' ? '.atom.txt' : '.bbc' : '.bin'}` } : {}),
    ...(next.language === 'bbc-basic' ? { entryPoint: { mode: 'source', value: '' } as BuildTarget['entryPoint'] } : {}),
    ...buildTargetDeclarations(toolchainFor(toolchainId)!, next.id),
  };
}

export function buildToolchainUpdate(toolchainId: ToolchainId): Partial<BuildTarget> {
  const toolchain = toolchainFor(toolchainId)!;
  return { toolchainId, language: toolchain.language, toolchainVersion: toolchain.version, outputType: toolchain.artifactKind };
}

export function migrateBuildTarget(candidate: Partial<BuildTarget>, fallback: Pick<BuildTarget, 'id' | 'name' | 'entryFileId' | 'toolchainId' | 'outputName'>): BuildTarget {
  const policy = candidate.buildPolicy;
  const entry = candidate.entryPoint;
  const toolchain = toolchainFor(fallback.toolchainId)!;
  const defaults = buildTargetDeclarations(toolchain, fallback.entryFileId);
  const strings = (value: unknown, fallbackValue: string[]) => Array.isArray(value) && value.every((item) => typeof item === 'string') ? value.slice(0, 128) : fallbackValue;
  return {
    schemaVersion: BUILD_TARGET_SCHEMA,
    ...fallback,
    buildPolicy: policy === 'on-save' || policy === 'live' ? policy : 'manual',
    entryPoint: entry && (entry.mode === 'source' || entry.mode === 'symbol' || entry.mode === 'address') && typeof entry.value === 'string' ? { mode: entry.mode, value: entry.value.slice(0, 128) } : { mode: 'source', value: '' },
    machineProfile: 'project',
    language: toolchain.language,
    toolchainVersion: toolchain.version,
    roots: ['.'],
    defines: strings(candidate.defines, defaults.defines),
    includePaths: strings(candidate.includePaths, defaults.includePaths),
    sourceFileIds: Array.from(new Set(strings(candidate.sourceFileIds, defaults.sourceFileIds).concat(fallback.entryFileId))),
    libraryIds: strings(candidate.libraryIds, defaults.libraryIds),
    generatedAssetIds: strings(candidate.generatedAssetIds, defaults.generatedAssetIds),
    memoryLayout: candidate.memoryLayout && typeof candidate.memoryLayout.defaultOrigin === 'string' && typeof candidate.memoryLayout.maximumAddress === 'string' ? { defaultOrigin: candidate.memoryLayout.defaultOrigin.slice(0, 16), maximumAddress: candidate.memoryLayout.maximumAddress.slice(0, 16) } : defaults.memoryLayout,
    outputType: toolchain.artifactKind,
    loadAddress: 'toolchain',
    profile: BUILD_PROFILES.some((profile) => profile.id === candidate.profile) ? candidate.profile as BuildProfileId : 'debug',
    profileOptions: candidate.profileOptions && ['balanced', 'size', 'speed'].includes(candidate.profileOptions.customGoal) && ['full', 'none'].includes(candidate.profileOptions.debugMetadata)
      ? { customGoal: candidate.profileOptions.customGoal, debugMetadata: candidate.profileOptions.debugMetadata }
      : defaults.profileOptions,
    dependencyTargetIds: strings(candidate.dependencyTargetIds, defaults.dependencyTargetIds).filter((id) => id !== fallback.id),
    postProcessorIds: strings(candidate.postProcessorIds, defaults.postProcessorIds),
  };
}

export function parseBuildAddress(value: string): number | null {
  const source = value.trim();
  const radix = /^&/.test(source) || /^0x/i.test(source) ? 16 : 10;
  const digits = source.replace(/^&/, '').replace(/^0x/i, '');
  if (!(radix === 16 ? /^[0-9a-f]{1,8}$/i.test(digits) : /^\d{1,10}$/.test(digits))) return null;
  const parsed = Number.parseInt(digits, radix);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 0xffffffff ? parsed : null;
}

export function parsedBuildDefines(defines: string[]): Record<string, number> {
  return Object.fromEntries(defines.flatMap((define) => {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/.exec(define);
    const value = parseBuildAddress(match?.[2] ?? '');
    return match && value !== null ? [[match[1]!.toUpperCase(), value] as const] : [];
  }));
}

function buildTargetDeclarations(toolchain: ToolchainManifest, entryFileId: string) {
  return {
    machineProfile: 'project' as const,
    language: toolchain.language,
    toolchainVersion: toolchain.version,
    roots: ['.'],
    defines: [] as string[],
    includePaths: ['.'],
    sourceFileIds: [entryFileId],
    libraryIds: [] as string[],
    generatedAssetIds: [] as string[],
    memoryLayout: toolchain.language === 'c' ? { defaultOrigin: '&1900', maximumAddress: '&69FF' } : toolchain.language === 'arm' ? { defaultOrigin: '&00008000', maximumAddress: '&000FFFFF' } : { defaultOrigin: '&1900', maximumAddress: '&FFFF' },
    outputType: toolchain.artifactKind,
    loadAddress: 'toolchain' as const,
    profile: 'debug' as const,
    profileOptions: { customGoal: 'balanced' as const, debugMetadata: 'full' as const },
    dependencyTargetIds: [] as string[],
    postProcessorIds: [] as string[],
  };
}

export function buildProfileManifest(profile: BuildProfileId): BuildProfileManifest {
  return BUILD_PROFILES.find((candidate) => candidate.id === profile) ?? BUILD_PROFILES[0]!;
}

/** Profile intent is an explicit compile input. Hand-authored assembler can use
 * these constants without the IDE pretending to perform unsafe optimization. */
export function buildProfileDefines(target: Pick<BuildTarget, 'profile' | 'profileOptions'>): Record<string, number> {
  const selected = target.profile === 'custom' ? target.profileOptions.customGoal : target.profile;
  return {
    BUILD_PROFILE_DEBUG: selected === 'debug' ? 1 : 0,
    BUILD_PROFILE_SIZE: selected === 'size' ? 1 : 0,
    BUILD_PROFILE_SPEED: selected === 'speed' ? 1 : 0,
    BUILD_PROFILE_CUSTOM: target.profile === 'custom' ? 1 : 0,
  };
}

export function buildProfileKeepsDebugMetadata(target: Pick<BuildTarget, 'profile' | 'profileOptions'>): boolean {
  return target.profile !== 'custom' || target.profileOptions.debugMetadata === 'full';
}

export function createBuildProvenance(
  target: BuildTarget,
  machineTarget: ProjectTarget,
  inputFiles: ProjectFile[],
  output: { kind: ToolchainManifest['artifactKind']; bytes: Uint8Array },
): BuildProvenance {
  const toolchain = toolchainFor(target.toolchainId);
  if (!toolchain) throw new Error(`Unknown toolchain ${target.toolchainId}`);
  const inputs = inputFiles.map((file) => {
    const encoded = new TextEncoder().encode(file.content);
    return { id: file.id, name: file.name, language: file.language, bytes: encoded.length, fingerprint: fingerprint(encoded), sha256: sha256Hex(encoded) };
  }).sort((left, right) => left.id.localeCompare(right.id));
  const outputRecord = { kind: output.kind, bytes: output.bytes.length, fingerprint: fingerprint(output.bytes), sha256: sha256Hex(output.bytes) };
  const toolchainDigest = toolchainManifestDigest(toolchain);
  const identity = canonicalJson({ target, toolchain, toolchainDigest, machineTarget, inputs, output: outputRecord });
  return { schema: '8bit-net.build-provenance', version: 2, fingerprintAlgorithm: 'fnv1a32', digestAlgorithm: 'sha256', fingerprint: fingerprint(new TextEncoder().encode(identity)), target: { ...target }, toolchain: { ...toolchain }, toolchainDigest, machineTarget: { ...machineTarget, enabledCapabilities: [...machineTarget.enabledCapabilities] }, inputs, output: outputRecord };
}

export function toolchainManifestDigest(toolchain: ToolchainManifest): string {
  return sha256Hex(new TextEncoder().encode(canonicalJson(toolchain)));
}

export function provenanceMatches(provenance: BuildProvenance, target: BuildTarget, machineTarget: ProjectTarget, files: ProjectFile[]): boolean {
  if (canonicalJson(provenance.target) !== canonicalJson(target) || canonicalJson(provenance.machineTarget) !== canonicalJson(machineTarget)) return false;
  return provenance.inputs.every((input) => {
    const file = files.find((candidate) => candidate.id === input.id);
    return !!file && file.name === input.name && file.language === input.language && fingerprint(new TextEncoder().encode(file.content)) === input.fingerprint;
  });
}

export function fingerprint(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) { hash ^= byte; hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash.toString(16).padStart(8, '0');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
