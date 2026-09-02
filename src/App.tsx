import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type SetStateAction } from 'react';
import { createAnalysisDocument } from './analysis/analysisExport';
import { createVerified6502AssemblySource } from './analysis/disassemblyAssemblyExport';
import { createArmAssemblySource, verifyArmAssemblySource, type ArmAssemblyVerification } from './analysis/disassemblyArmAssemblyExport';
import { correlateRuntimeCoverage, rowCoverageLabel, type RuntimeCoverage } from './analysis/runtimeCoverage';
import { DiskSetWorkspace, type DiskSetSourceArtifact } from './components/DiskSetWorkspace';
import { SettingsLayersPanel } from './components/SettingsLayersPanel';
import { LimitsPanel } from './components/LimitsPanel';
import { SystemStatusPanel } from './components/SystemStatusPanel';
import { ReferenceLibraryPanel } from './components/ReferenceLibraryPanel';
import { ReferencePanel } from './components/ReferencePanel';
import { TargetModePreview } from './components/TargetModePreview';
import { ConformancePanel } from './components/ConformancePanel';
import { loadPackLibrary, savePackLibrary } from './research/packStorage';
import type { PackLibrary } from './research/packLibrary';
import { ProfileComparisonPanel } from './components/ProfileComparisonPanel';
import { SidewaysSlotPanel } from './components/SidewaysSlotPanel';
import type { SidewaysAssignment } from './rom/sidewaysSlots';
import { readSetting, writeSetting } from './settings/settings';
import { startAnalysisTask, type AnalysisTask } from './analysis/analysisWorkerClient';
import {
  annotationSummary, emptyAnalysisAnnotations, isEmptyAnnotations, labelLookup, regionAt,
  withComment, withEntryPoint, withIndirectTarget, withLabel, withRegion, withoutEntryPoint,
  withoutIndirectTarget, withoutRegionAt,
  type AnalysisAnnotations, type AnalysisRegionKind,
} from './analysis/analysisAnnotations';
import {
  annotationHistorySummary, canRedoAnnotations, canUndoAnnotations, createAnnotationHistory,
  currentAnnotations, recordAnnotationEdit, redoAnnotations, redoDescription, undoAnnotations,
  undoDescription, type AnnotationHistory,
} from './analysis/annotationHistory';
import {
  logicalAnalysisAddress,
  metadataForHostFile,
  parseHexAddress,
} from './analysis/fileAnalysis';
import type { AcornFileMetadata, AnalysisProcessor, DisassemblyRow, LoadedFile } from './analysis/types';
import { artifactWindowStart, compareArtifacts, crc32Hex, searchArtifact, type ArtifactSearchMode } from './analysis/artifactInspector';
import type { AssemblyArtifact } from './build/assembler6502';
import { isMachineCodeArtifact, type ArmArtifact } from './build/artifactTypes';
import type { BasicArtifact } from './build/basicTokeniser';
import { decodeArmWord, disassembleArm } from './analysis/disassemblerArm';
import { artifactListingRows, artifactSymbolReferences, generatedArtifactDocuments } from './build/artifactDocuments';
import { executeBuildAll, type BuildAllRecord } from './build/buildAll';
import { analyseBuildGraph, impactedBuildTargets, sourceInputsForTarget } from './build/buildGraph';
import { BUILD_PROFILES, buildEntryUpdate, buildProfileDefines, buildProfileKeepsDebugMetadata, buildProfileManifest, buildToolchainUpdate, compatibleToolchains, createBuildTarget, provenanceMatches, shouldScheduleBackgroundBuild, toolchainFor, validateBuildTarget, type BuildTarget } from './build/buildTarget';
import { BuildExecutionError, buildExecutionError, executeBuild, type BuildArtifact, type BuildRequest, type BuildResponse, type BuildResultMetadata } from './build/buildService';
import { sha256Hex } from './build/digest';
import { detectNativeToolchains, invokeNativeToolchain, type NativeToolchainStatus } from './build/nativeToolchainAdapter';
import type { BuildWorkerMessage } from './build/build.worker';
import { BrandMark } from './components/BrandMark';
import { Icon, type IconName } from './components/Icon';
import { ProjectTree } from './components/ProjectTree';
import { SourceWorkspace } from './components/SourceWorkspace';
import { ProjectSearchWorkspace } from './components/ProjectSearchWorkspace';
import { CommandPalette } from './components/CommandPalette';
import { GoToSourceDialog } from './components/GoToSourceDialog';
import { RomManagerWorkspace } from './components/RomManagerWorkspace';
import { HelpWorkspace } from './components/HelpWorkspace';
import { KeyboardShortcutsPanel } from './components/KeyboardShortcutsPanel';
import { SdkDocumentView } from './components/SdkDocumentView';
import { ProjectExportDialog } from './components/ProjectExportDialog';
import { StartProjectDialog } from './components/StartProjectDialog';
import { writeDirectory, type FileSystemDirectoryHandleLike } from './project/directoryAccess';
import { ProjectStorePanel } from './components/ProjectStorePanel';
import { SampleWorkspace } from './components/SampleWorkspace';
import { TileMapWorkspace } from './components/TileMapWorkspace';
import { PaletteWorkspace } from './components/PaletteWorkspace';
import { FontWorkspace } from './components/FontWorkspace';
import { ScreenWorkspace } from './components/ScreenWorkspace';
import { SongWorkspace } from './components/SongWorkspace';
import { physicalColour, resolveProjectPalette, type ProjectPalette } from './assets/paletteDocument';
import { readableInk } from './theme/readableInk';
import { loadSdkDocument, type SdkDocument } from './language/sdkDocumentClient';
import { ROM_SETS, requiredRomRequirements, romSetFor, romStorageKey, runtimeSidewaysRomPaths } from './rom/romProfiles';
import { ELECTRON_ADAPTER_SUMMARY, ELECTRON_CAPABILITIES, ELECTRON_UNAVAILABLE, electronCommandRefusal } from './emulator/electronAdapter';
import { ELKULATOR_ADAPTER_SUMMARY, ELKULATOR_CAPABILITIES, ELKULATOR_UNAVAILABLE, elkulatorCommandRefusal } from './emulator/elkulatorAdapter';
import { electronRuntimeRoute, isElectronEngine } from './emulator/electronRuntimeRouting';
import { machineHoldsArtifact } from './emulator/breakpointArming';
import { listRoms, type StoredRom } from './rom/romStore';
import { archimedesCmosKey, archimedesCombinedRomKey, archimedesRuntimeConfiguration, type ArchimedesRuntimeConfiguration } from './rom/archimedesRom';
import {
  defaultCapabilities,
  machinesForPlatform,
  platformClasses,
} from './data/machines';
import { compareConfigurations, configurationSummary, resolveConfiguration } from './profiles/profileRegistry';
import type { PlatformClassId } from './types';
import { Cpu6502Runtime, type CpuSnapshot } from './runtime/cpu6502';
import { addPixelSpriteFrame, createPixelAssetDocument, generatePixelAssetOutput, movePixelSpriteFrame, parsePixelAssetDocument, pixelAssetFrames, removePixelSpriteFrame, resizePixelAssetDocument, serializePixelAssetDocument, updatePixelSpriteFrame, type PixelAssetDocument, type PixelAssetKind } from './assets/pixelAssetDocument';
import { copyPixelSelection, fillPixelSelection, parsePixelClipboard, pastePixelSelection, selectionBounds, selectionContains, transformPixelSelection, type PixelClipboard, type PixelPoint, type PixelSelection } from './assets/pixelSelection';
import { MAX_TAPE_IMAGE_BYTES, validateTapeImage } from './media/tapeFormat';
import { describeUef, readUef } from './media/uefChunks';
import { createDfsImageFromFiles, openDfsImageProject, type CreatedDfsImage, type DfsImageProject } from './media/dfsImage';
import { parseDfsCatalogue, type DfsCatalogue } from './media/dfsCatalogue';
import { createDfsDsdImage, openDfsDsdProject, splitDfsDsdImage, type CreatedDfsDsdImage, type DfsDsdProject } from './media/dfsDsdImage';
import { createAtomAtm, parseAtomAtm, type AtomAtmFile } from './media/atomAtm';
import { createTapeImage, createAtomTapeImage, encodeTapeFile, encodeAtomTapeFile, MAX_NAME_LENGTH, MAX_ATOM_NAME_LENGTH, type TapeFile } from './media/acornTape';
import { extractAdfsFile, parseAdfsCatalogue, type AdfsCatalogue, type AdfsFileEntry } from './media/adfsCatalogue';
import { createAdfsEImage, type CreatedAdfsEImage } from './media/adfsImage';
import { AdfsEntryEditor } from './components/AdfsEntryEditor';
import { AdfsDiscBuilder } from './components/AdfsDiscBuilder';
import { RiscOsResourcePanel } from './components/RiscOsResourcePanel';
import { createRiscOsAbsoluteApplication, validateRiscOsApplication, type RiscOsApplicationPackage } from './media/riscOsApplication';
import { parseTestPlan, resolveTestValue, type MachineAssertion } from './testing/testPlan';
import { MAX_SCREEN_GOLDENS, base64ToBytes, bytesToBase64, validateScreenGolden, type ScreenGolden } from './testing/screenAssertion';
import { createJUnitTestReport, createNativeTestReport, renderAssertionValue, type ReportTestResult } from './testing/testReport';
import { referenceItems, type LanguageItem } from './language/languageService';
import type { LanguageTargetContext } from './language/languageTarget';
import {
  createProjectFile,
  languageForFilename,
  newProject,
  parseProject,
  reorderProjectFiles,
  projectFileIsModified,
  revertedProjectFile,
  savedProjectFile,
  serializableProject,
  namedForProject,
  uniqueFilename,
  type ArmBreakpointGroup,
  type Breakpoint6502Group,
  type LocalProject,
  type Persisted6502BreakpointIntent,
  type PersistedArmBreakpointIntent,
  type ProjectFile,
  type ProjectTarget,
  type SourceBookmark,
  type TargetTestPlan,
} from './project/project';
import { clearQuarantinedSnapshot, loadProjectSnapshot, quarantinedSnapshot, saveProjectSnapshot, saveStateSummary, type SaveOutcome } from './project/autosave';
import { MAX_TRASH_ENTRIES, purgeTrash, restoreFromTrash, trashEntrySummary, trashFile } from './project/projectTrash';
import { bundleSummary, createProjectBundle, openProjectBundle, PROJECT_BUNDLE_SCHEMA, type ProjectBundle } from './project/projectBundle';
import { replaceProjectMatches, type ProjectSearchOptions } from './project/projectSearch';
import { closeAllDocuments, closeDocument, closeOtherDocuments, initialDocuments, openDocument, removeDocument, reopenClosedDocument, selectDocument } from './editor/documentLifecycle';
import { createSourceBookmark, trackSourceBookmarks } from './editor/sourceBookmarks';
import { decodeSourceText, encodeSourceText, MAX_PROJECT_SOURCE_BYTES, MAX_SOURCE_FILE_BYTES, sourceUtf8ByteLength, type SourceEncoding, type SourceLineEnding } from './editor/sourceTextFormat';
import type { WorkbenchCommand } from './commands/commandModel';
import { CHORD_SEQUENCE_TIMEOUT_MS, chordCandidates, chordPrefixes, formatChord, keyBindingLookup, matchKeyBinding, readKeyBindingOverrides, resolveKeyBindings, writeKeyBindingOverrides, type KeyBindingOverrides } from './commands/keyBindings';
import {
  changedMemoryAddresses,
  formatMemoryRows,
  parseMemorySearch,
  readLittleEndianPointer,
  resolveMemoryExpression,
  searchMemory,
  type MemoryRadix,
  type MemoryTextMode,
} from './emulator/memoryInspectorModel';
import { estimate6502Cycles, formatCycleEstimate } from './emulator/liveDisassemblyModel';
import { parseDebugExpression, renderDebugMemoryValue, type DebugExpressionPlan } from './emulator/debugExpressionModel';
import { parseArmDebugExpression, renderArmDebugMemoryValue, verifiedArmLinkFrame, type ArmDebugExpressionPlan } from './emulator/armDebugExpressionModel';
import type { MemoryMapState, MemorySpaceId } from './emulator/memoryMapModel';
import { formatHardwareValue, type HardwareInspection } from './emulator/hardwareInspectorModel';
import { armPipelineStageName, decodeArm26Status, decodeIocInterrupts } from './emulator/armStateModel';
import {
  ARM26_MAX_ADDRESS,
  armMemoryPageAddress,
  formatArmMemoryText,
  readArmLittleEndianWord,
  resolveArmMemoryExpression,
  resolveArmValueExpression,
  validateArmMemoryRead,
} from './emulator/armMemoryModel';
import { armLinkReturnTarget, armStepOverTarget, validateArmExecutionAddress } from './emulator/armExecutionModel';
import { armBreakpointWireSpec, renderArmLogpointMessage, type ArmBreakpointAction, type ArmBreakpointCondition, type ArmBreakpointOperator, type ArmBreakpointSpec } from './emulator/armBreakpointModel';
import { recordArmBreakpointResolutions, resolveArmBreakpointIntents } from './emulator/armBreakpointPersistenceModel';
import { record6502BreakpointResolutions, resolve6502BreakpointIntents } from './emulator/breakpointPersistence6502Model';
import { acceptDebugEvent, type DebugProtocolSnapshot } from './emulator/debugProtocol';
import { ACORN_KEY_ROWS, JSBEEB_KEYBOARD_LAYOUTS, MACHINE_TEXT_LIMIT, isJsBeebKeyboardLayout, validateMachineTapCode, type JsBeebKeyboardLayout } from './emulator/keyboardInputModel';
import { EMULATOR_SCALE_MODES, scaledFramebufferViewport, type EmulatorScaleMode } from './emulator/emulatorScaleModel';
import { RUNTIME_SPEEDS, isRuntimeSpeed, type RuntimeSpeed } from './emulator/runtimeSpeedModel';
import { createRuntimeSessionManifest, type RuntimeSessionManifest } from './emulator/runtimeSessionManifest';
import { isEmulatorDisplayFilter, type EmulatorDisplayFilter } from './emulator/audioDisplayControlModel';
import { bindProgramLoadManifest, type ProgramLoadDraft, type ProgramLoadManifest } from './emulator/programLoadManifest';
import { createRuntimeRunRecord } from './emulator/runtimeRunRecord';
import { EMULATOR_DISPLAY_EFFECTS, isEmulatorDisplayEffect, type EmulatorDisplayEffect } from './emulator/displayEffectModel';
import { HOST_REMAP_KEYS, validateMachineKeyRemaps, type MachineKeyRemap } from './emulator/keyRemapModel';
import { GAMEPAD_ACTIONS, activeGamepadActions, atomMmcJoystickState, bbcAnalogueJoystickState, validateGamepadInputConfig, type GamepadAction, type GamepadInputConfig } from './emulator/gamepadInputModel';
import { EMULATOR_ADAPTER_API_VERSION, productionAdapterDescriptors } from './emulator/adapterContract';
import { createDebugSession, lifecycleForSnapshot, transitionDebugSession, type DebugLifecycleState, type DebugSessionRecord } from './emulator/debugSessionModel';
import { validateArmRegisterEdit } from './emulator/armRegisterEditModel';
import { parseArmMemoryEditBytes, validateArmMemoryEdit } from './emulator/armMemoryEditModel';
import { compressArmMemoryMap, type ArmMappedPage, type ArmMappedRegion } from './emulator/armMemoryMapModel';
import { describeProgress } from './analysis/analysisProgress';
import { appendRecorded, gamepadTransitions, pointerSample, shouldSamplePointer } from './testing/inputRecording';
import { adfsGeometryFor, adfsMountRefusal } from './media/adfsGeometry';
import { capturedMemoryMetadata, capturedMemoryName, type CapturedMemoryContext } from './analysis/capturedMemoryContext';

/* The context a capture carries into analysis, taken from the read that
 * produced it rather than from the controls, which a person may have changed
 * since. */
function capturedMemoryFrom(memory: MachineMemory, space: { banked?: boolean }, machineLabel: string): CapturedMemoryContext {
  return {
    machineLabel,
    spaceId: memory.addressSpace,
    spaceLabel: memory.addressSpaceLabel,
    banked: Boolean(space.banked),
    ...(memory.bank === undefined ? {} : { bank: memory.bank }),
    address: memory.address,
    byteLength: memory.bytes.length,
    capturedAtCycles: memory.capturedAtCycles,
  };
}

/* The dead zone the live joystick path uses, so a recording and a live
 * session agree about when a stick is held. */
const GAMEPAD_RECORD_DEAD_ZONE = 0.35;
/* What each recorder captures, in the words shown on its own control. */
const RECORDER_LABELS = { keys: 'host keys', gamepad: 'gamepad', pointer: 'pointer' } as const;
const workspaceTabs = ['Code', 'Search', 'Analyse', 'Build targets', 'Media', 'Debugger', 'Tests', 'Research', 'Settings', 'Help'];
const workspaceHelpTopics: Record<string, string> = {
  Code: 'editor', Search: 'projects', Analyse: 'analysis', 'Build targets': 'build-targets', Media: 'media', Tests: 'tests', Research: 'research', Settings: 'rom-import', Help: 'using-help', Characters: 'assets', Sprites: 'assets', Tiles: 'assets', Maps: 'assets', Sound: 'assets', Samples: 'assets',
};
const assetTabs = ['Characters', 'Sprites', 'Tiles', 'Fonts', 'Screens', 'Maps', 'Palettes', 'Sound', 'Samples'];
const EMPTY_ARM_BREAKPOINTS: PersistedArmBreakpointIntent[] = [];
const EMPTY_ARM_BREAKPOINT_GROUPS: ArmBreakpointGroup[] = [];
const EMPTY_6502_BREAKPOINTS: Persisted6502BreakpointIntent[] = [];
const EMPTY_6502_BREAKPOINT_GROUPS: Breakpoint6502Group[] = [];

interface ToolbarButtonProps {
  label: string;
  icon: IconName;
  tone?: 'neutral' | 'green' | 'amber' | 'blue';
  onClick: () => void;
  disabled?: boolean;
}

type SourcePaneId = 'primary' | 'secondary';
interface SourceLocation { paneId: SourcePaneId; splitFileId?: string; fileId: string; line: number; column: number; length: number; scrollTop: number; }
type BuildTrigger = 'manual' | 'run' | 'debug' | 'test' | 'on-save' | 'live';
type BuildActivityStatus = 'idle' | 'queued' | 'building' | 'succeeded' | 'failed' | 'cancelled';
interface BuildActivity { requestId: number; status: BuildActivityStatus; trigger: BuildTrigger; targetName: string; message: string; startedAt?: number; finishedAt?: number; }
interface BuildLogRecord extends BuildActivity { diagnostics: number; fingerprint?: string; }
interface RetainedBuildArtifact { targetId: string; targetName: string; artifact: BuildArtifact; metadata: BuildResultMetadata; builtAt: number }
interface MachineCommand { id: number; message: Record<string, unknown>; }
interface MachineMemory { address: number; bytes: number[]; requestId: string; addressSpace: MemorySpaceId; addressSpaceLabel: string; bank?: number; capturedAtCycles: number; }
interface ArchimedesMemory { address: number; bytes: number[]; requestId: string; emulationMs: number; running: boolean; addressSpace: string; }
interface MachineDisassemblyRow { address: number; addressSpace: string; bank: string; bytes: number[]; instruction: string; mnemonic: string; addressingMode: string; branchTarget?: number; effectiveAddress?: number; source?: { fileName: string; line: number }; symbol?: string; }
interface MachineDisassembly { address: number; requestId: string; addressSpace: string; bank: string; capturedAtCycles: number; rows: MachineDisassemblyRow[]; }
interface ResearchRequest { sequence: number; language: 'bbc-basic' | '6502' | 'arm' | 'c'; query: string }
type MachineMedia =
  | { kind: 'disc'; name: string; size: number; drive: number; dirty?: boolean; revision?: number }
  | { kind: 'tape'; name: string; size: number; format: string };
interface MachineAudioState { available: boolean; enabled: boolean; desired?: boolean; recording?: boolean; contextState: string; requiresGesture: boolean; buffers: number; peak: number; volume?: number; queuedBytes?: number; latencyMs?: number; underruns?: number; lastBufferGapMs?: number; backgroundSuspended?: boolean; }
const machineAudioStateFromMessage = (message: Record<string, unknown>): MachineAudioState => ({ available: Boolean(message.available), enabled: Boolean(message.enabled), ...(message.desired === undefined ? {} : { desired: Boolean(message.desired) }), recording: Boolean(message.recording), contextState: String(message.contextState), requiresGesture: Boolean(message.requiresGesture), buffers: Number(message.buffers), peak: Number(message.peak), ...(message.volume === undefined ? {} : { volume: Number(message.volume) }), ...(message.queuedBytes === undefined ? {} : { queuedBytes: Number(message.queuedBytes) }), ...(message.latencyMs === undefined ? {} : { latencyMs: Number(message.latencyMs) }), ...(message.underruns === undefined ? {} : { underruns: Number(message.underruns) }), ...(message.lastBufferGapMs === undefined ? {} : { lastBufferGapMs: Number(message.lastBufferGapMs) }), ...(message.backgroundSuspended === undefined ? {} : { backgroundSuspended: Boolean(message.backgroundSuspended) }) });
const buildProgramLoadDraft = (artifact: AssemblyArtifact | ArmArtifact, mode: 'run' | 'debug' | 'test'): ProgramLoadDraft => {
  if (!artifact.provenance) throw new Error('Program loads require immutable build provenance');
  return { source: 'build', mode, processor: artifact.processor, name: artifact.provenance.target.outputName, expectedSha256: artifact.provenance.output.sha256, build: { targetId: artifact.provenance.target.id, targetName: artifact.provenance.target.name, fingerprint: artifact.provenance.fingerprint, toolchainId: artifact.provenance.toolchain.id, toolchainVersion: artifact.provenance.toolchain.version } };
};
const buildBasicProgramLoadDraft = (artifact: BasicArtifact, mode: 'run' | 'debug'): ProgramLoadDraft => {
  if (!artifact.provenance) throw new Error('BASIC program loads require immutable build provenance');
  return { source: 'build', mode, processor: '6502', name: artifact.provenance.target.outputName, expectedSha256: artifact.provenance.output.sha256, format: artifact.kind, placement: artifact.kind === 'bbc-basic-program' ? 'interpreter-page' : 'keyboard-queue', build: { targetId: artifact.provenance.target.id, targetName: artifact.provenance.target.name, fingerprint: artifact.provenance.fingerprint, toolchainId: artifact.provenance.toolchain.id, toolchainVersion: artifact.provenance.toolchain.version } };
};
interface MachineTestResult {
  requestId?: string;
  planId?: string;
  suite?: string;
  buildFingerprint?: string;
  programFingerprint?: string;
  name: string;
  status: 'running' | 'passed' | 'failed' | 'timeout' | 'error';
  reason: string;
  cycles: number;
  stopAddress?: number;
  assertionCount?: number;
  cycleBudget?: number;
  assertions: Array<MachineAssertion & { actual: number | number[] | string; passed: boolean; expectedRgbaBase64?: string; actualRgbaBase64?: string; expectedDigest?: string; actualDigest?: string; differingPixels?: number; allowedDifferingPixels?: number; maximumChannelDelta?: number; allowedChannelDelta?: number }>;
  captures?: Array<{ id: string; kind: 'registers'; registers: Record<string, number> } | { id: string; kind: 'memory'; address: number; bytes: number[] }>;
  teardown?: 'pause' | 'reset';
  appliedInputs?: number;
}
interface TestAllRecord { planId: string; targetId: string; name: string; status: 'queued' | 'running' | 'passed' | 'failed' | 'timeout' | 'error' | 'skipped' | 'cancelled'; message: string; result?: MachineTestResult }
/* The retained summary of one run. It now keeps each assertion's rendered
 * expected and actual sides, because a history that says a test failed and not
 * what it saw sends somebody back to run it again by hand. */
interface TestHistoryAssertion { source: string; passed: boolean; expected: string; actual: string }
interface TestHistoryResult { name: string; status: Exclude<MachineTestResult['status'], 'running'>; reason: string; cycles: number; suite?: string; buildFingerprint?: string; assertions?: TestHistoryAssertion[] }
interface TestHistoryRecord { sequence: number; recordedAt: string; result: TestHistoryResult }

async function importScreenGolden(file: File, existing: readonly ScreenGolden[]): Promise<ScreenGolden> {
  if (file.type !== 'image/png') throw new Error('Screen goldens must be PNG files');
  if (file.size > 2 * 1024 * 1024) throw new Error('Screen golden PNG files are limited to 2 MiB');
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 65_536) throw new Error('Screen goldens are limited to 65,536 pixels');
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('This browser cannot read PNG pixels for a screen golden');
    context.drawImage(bitmap, 0, 0);
    const stem = file.name.replace(/\.png$/i, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'screen';
    let id = stem; let suffix = 2; while (existing.some((item) => item.id.toLowerCase() === id.toLowerCase())) id = `${stem.slice(0, 35)}-${suffix++}`;
    const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const golden = { id, name: file.name.slice(0, 80), width: bitmap.width, height: bitmap.height, rgbaBase64: bytesToBase64(new Uint8Array(imageData.buffer, imageData.byteOffset, imageData.byteLength)) };
    const error = validateScreenGolden(golden); if (error) throw new Error(error);
    return golden;
  } finally { bitmap.close(); }
}

const TEST_HISTORY_KEY = '8bit-net-dev:test-history-v1';
function loadTestHistory(): TestHistoryRecord[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(TEST_HISTORY_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const statuses = new Set(['passed', 'failed', 'timeout', 'error']);
    return parsed.slice(0, 100).flatMap((candidate): TestHistoryRecord[] => {
      if (!candidate || typeof candidate !== 'object') return [];
      const item = candidate as { sequence?: unknown; recordedAt?: unknown; result?: Record<string, unknown> };
      const result = item.result;
      if (!Number.isSafeInteger(item.sequence) || typeof item.recordedAt !== 'string' || !Number.isFinite(Date.parse(item.recordedAt)) || !result || typeof result.name !== 'string' || !result.name.trim() || result.name.length > 80 || typeof result.status !== 'string' || !statuses.has(result.status) || typeof result.reason !== 'string' || result.reason.length > 500 || !Number.isFinite(result.cycles) || Number(result.cycles) < 0) return [];
      return [{ sequence: Number(item.sequence), recordedAt: item.recordedAt, result: { name: result.name, status: result.status as TestHistoryResult['status'], reason: result.reason, cycles: Number(result.cycles), ...(typeof result.suite === 'string' && result.suite.length <= 80 ? { suite: result.suite } : {}), ...(typeof result.buildFingerprint === 'string' && /^[a-f0-9]{64}$/i.test(result.buildFingerprint) ? { buildFingerprint: result.buildFingerprint.toLowerCase() } : {}), ...(Array.isArray(result.assertions) ? { assertions: result.assertions.slice(0, 64).filter((entry: unknown): entry is TestHistoryAssertion => !!entry && typeof entry === 'object' && typeof (entry as TestHistoryAssertion).source === 'string' && typeof (entry as TestHistoryAssertion).passed === 'boolean').map((entry) => ({ source: entry.source.slice(0, 200), passed: entry.passed, expected: String(entry.expected ?? '').slice(0, 200), actual: String(entry.actual ?? '').slice(0, 200) })) } : {}) } }];
    });
  } catch { return []; }
}

function retargetBasicToolchains(project: LocalProject, machineId: string): LocalProject {
  const atom = machineId === 'atom';
  return {
    ...project,
    buildTargets: project.buildTargets.map((target) => {
      const entry = project.files.find((file) => file.id === target.entryFileId);
      if (entry?.language !== 'bbc-basic') return target;
      const outputName = /\.(?:bbc|atom\.txt)$/i.test(target.outputName)
        ? target.outputName.replace(/\.(?:bbc|atom\.txt)$/i, atom ? '.atom.txt' : '.bbc')
        : target.outputName;
      const toolchainId = atom ? '8bit-net.basic.atom' : '8bit-net.basic.bbc2';
      return { ...target, ...buildToolchainUpdate(toolchainId), outputName };
    }),
  };
}

function ToolbarButton({ label, icon, tone = 'neutral', onClick, disabled = false }: ToolbarButtonProps) {
  return (
    <button className={`icon-button tone-${tone}`} type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      <Icon name={icon} />
    </button>
  );
}

function analysisProcessorForMachine(cpu: string): AnalysisProcessor {
  if (/\bARM2\b/i.test(cpu)) return 'arm2';
  if (/\bARM/i.test(cpu)) return 'arm3';
  return cpu.includes('65C12') ? '65c02' : '6502';
}

function App() {
  /* Loading reports what happened rather than silently starting over: a stored
   * project that cannot be read is kept aside, not replaced. */
  const [restored] = useState(() => loadProjectSnapshot());
  const [project, setProject] = useState<LocalProject>(restored.project);
  const [saveState, setSaveState] = useState<SaveOutcome | null>(null);
  /* Bytes kept from a snapshot that would not parse. Offered for download, and
   * discarded only when the person says so. */
  const [unreadableSnapshot, setUnreadableSnapshot] = useState<string | null>(() => quarantinedSnapshot());
  const [documents, setDocuments] = useState(() => initialDocuments(project.files.map((file) => file.id)));
  const activeFileId = documents.activeId ?? '';
  const [platformClass, setPlatformClass] = useState<PlatformClassId>(project.target.platformClass);
  const [machineId, setMachineId] = useState(project.target.machineId);
  const availableMachines = useMemo(() => machinesForPlatform(platformClass), [platformClass]);
  const machine = availableMachines.find((item) => item.id === machineId) ?? availableMachines[0]!;
  const [variant, setVariant] = useState(project.target.variant);
  const [romId, setRomId] = useState(project.target.romId);
  const [enabledCapabilities, setEnabledCapabilities] = useState<string[]>(project.target.enabledCapabilities);
  const [workspaceTab, setWorkspaceTab] = useState('Code');
  const [projectExportOpen, setProjectExportOpen] = useState(false);
  const [startProjectOpen, setStartProjectOpen] = useState(false);
  const [caretLine, setCaretLine] = useState(1);
  const [caretColumn, setCaretColumn] = useState(1);
  const [caretSelectionLength, setCaretSelectionLength] = useState(0);
  const [sourceScrollTop, setSourceScrollTop] = useState(0);
  const [configOpen, setConfigOpen] = useState(true);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [notice, setNotice] = useState('Local project ready · edits recover in this browser');
  const [analysisFile, setAnalysisFile] = useState<LoadedFile | null>(null);
  /* One annotation history per analysed binary, keyed by the digest of its
   * bytes. The document in effect is mirrored into the project so it survives a
   * reload; the history itself is a session concern and is not persisted. */
  const [analysisHistories, setAnalysisHistories] = useState<Record<string, AnnotationHistory>>({});
  const analysisDigest = useMemo(() => analysisFile ? sha256Hex(analysisFile.bytes) : null, [analysisFile]);
  const analysisHistory = analysisDigest ? analysisHistories[analysisDigest] ?? null : null;
  const analysisAnnotations = analysisHistory ? currentAnnotations(analysisHistory) : null;
  const [analysisOrigin, setAnalysisOrigin] = useState('&1900');
  const [analysisEntry, setAnalysisEntry] = useState('&1900');
  const [analysisProcessor, setAnalysisProcessor] = useState<AnalysisProcessor>(() => analysisProcessorForMachine(machine.cpu));
  const [analysisActivity, setAnalysisActivity] = useState<{ status: 'idle' | 'running' | 'failed'; message: string }>({ status: 'idle', message: '' });
  const analysisTaskRef = useRef<AnalysisTask | undefined>(undefined);
  const [buildArtifact, setBuildArtifact] = useState<BuildArtifact | null>(null);
  const [buildResultMetadata, setBuildResultMetadata] = useState<BuildResultMetadata | null>(null);
  const [buildFailureMetadata, setBuildFailureMetadata] = useState<BuildResultMetadata | null>(null);
  const [artifactPinned, setArtifactPinned] = useState(false);
  const [policyBuildRequest, setPolicyBuildRequest] = useState<{ sequence: number; fileId: string | '*' }>();
  const [buildActivity, setBuildActivity] = useState<BuildActivity>({ requestId: 0, status: 'idle', trigger: 'manual', targetName: '', message: 'No build has run in this session.' });
  const [buildHistory, setBuildHistory] = useState<BuildLogRecord[]>([]);
  const [retainedArtifacts, setRetainedArtifacts] = useState<RetainedBuildArtifact[]>([]);
  /* Only machine-code artifacts can go on a disc as loadable files, and only
   * retained ones exist as bytes right now. A target that has not been built in
   * this session is simply absent, which is what the disk-set surface reports. */
  const diskSetArtifacts = useMemo<DiskSetSourceArtifact[]>(() => retainedArtifacts.flatMap((retained) => {
    if (!isMachineCodeArtifact(retained.artifact)) return [];
    return [{
      targetId: retained.targetId,
      targetName: retained.targetName,
      outputName: retained.artifact.provenance?.target.outputName ?? retained.targetName,
      bytes: retained.artifact.bytes,
      loadAddress: retained.artifact.origin,
      executionAddress: retained.artifact.entryPoint,
      fingerprint: retained.artifact.provenance?.fingerprint ?? '',
    }];
  }), [retainedArtifacts]);
  const [artifactDocumentId, setArtifactDocumentId] = useState<string>();
  const [artifactSymbolSelection, setArtifactSymbolSelection] = useState<string>();
  const [buildAllRecords, setBuildAllRecords] = useState<BuildAllRecord[]>([]);
  const [nativeToolchains, setNativeToolchains] = useState<NativeToolchainStatus[]>([]);
  const nativeToolchainIds = useMemo<Set<string>>(() => new Set(nativeToolchains.map((toolchain) => toolchain.id)), [nativeToolchains]);
  const [runtimeState, setRuntimeState] = useState<CpuSnapshot | null>(null);
  const [romReady, setRomReady] = useState(false);
  const [resolvedRomRecords, setResolvedRomRecords] = useState<StoredRom[]>([]);
  const [romInventoryRevision, setRomInventoryRevision] = useState(0);
  const [machineCommand, setMachineCommand] = useState<MachineCommand>();
  const [hardwareState, setHardwareState] = useState<MachineBridgeSnapshot | null>(null);
  /* Static reachability and observed execution are separate kinds of evidence.
   * They are only shown together when the running program can be proved to be
   * the analysed bytes at the analysed address. */
  const analysisCoverage = useMemo<RuntimeCoverage | null>(() => {
    if (!analysisFile || !analysisDigest || analysisFile.analysis.kind !== 'machine-code') return null;
    const manifest = hardwareState?.programManifest ?? null;
    return correlateRuntimeCoverage({
      analysis: analysisFile.analysis,
      analysedSha256: analysisDigest,
      programManifest: manifest ? { outputSha256: manifest.outputSha256, origin: manifest.origin, bytes: manifest.bytes, name: manifest.name } : null,
      profiler: hardwareState ? { ...hardwareState.profiler } : null,
    });
  }, [analysisFile, analysisDigest, hardwareState]);
  const [archimedesState, setArchimedesState] = useState<ArchimedesBridgeSnapshot | null>(null);
  const [debugSession, setDebugSession] = useState<DebugSessionRecord | null>(null);
  const [archimedesMemory, setArchimedesMemory] = useState<ArchimedesMemory | null>(null);
  const [hardwareMemory, setHardwareMemory] = useState<MachineMemory | null>(null);
  const [hardwareDisassembly, setHardwareDisassembly] = useState<MachineDisassembly | null>(null);
  const [hardwareInspection, setHardwareInspection] = useState<HardwareInspection | null>(null);
  const [researchRequest, setResearchRequest] = useState<ResearchRequest>();
  /* Read once, and re-parsed on the way in rather than trusted: storage is
   * editable by hand and a partial write leaves a partial record. */
  const [packLibrary, setPackLibrary] = useState<PackLibrary>(() => loadPackLibrary().library);
  const [sdkDocument, setSdkDocument] = useState<{ path: string; token?: string; status: 'loading' | 'ready' | 'error'; document?: SdkDocument; error?: string }>();
  const sdkDocumentAbortRef = useRef<AbortController | undefined>(undefined);
  const [hardwareMedia, setHardwareMedia] = useState<MachineMedia[]>([]);
  const [hardwareTest, setHardwareTest] = useState<MachineTestResult | null>(null);
  const [testAllRecords, setTestAllRecords] = useState<TestAllRecord[]>([]);
  const [testHistory, setTestHistory] = useState<TestHistoryRecord[]>(loadTestHistory);
  const testHistorySequenceRef = useRef(testHistory.reduce((maximum, item) => Math.max(maximum, item.sequence), 0));
  const testAllAbortRef = useRef<AbortController | undefined>(undefined);
  const testResultWaiterRef = useRef<{ requestId: string; resolve: (result: MachineTestResult) => void; reject: (error: Error) => void } | undefined>(undefined);
  const [sourceBreakpoints, setSourceBreakpoints] = useState<Record<string, number[]>>(project.breakpoints);
  const [sourceJumps, setSourceJumps] = useState<Partial<Record<SourcePaneId, { fileId: string; line: number; column?: number; length?: number; scrollTop?: number; sequence: number; paneId: SourcePaneId }>>>({});
  const [sourceSplitFileId, setSourceSplitFileId] = useState<string>();
  const [activeSourcePane, setActiveSourcePane] = useState<SourcePaneId>('primary');
  const [secondarySourceLocation, setSecondarySourceLocation] = useState<Omit<SourceLocation, 'paneId'>>({ fileId: activeFileId, line: 1, column: 1, length: 0, scrollTop: 0 });
  const [sourceNavigation, setSourceNavigation] = useState<{ back: SourceLocation[]; forward: SourceLocation[] }>({ back: [], forward: [] });
  const [sourceCommand, setSourceCommand] = useState<{ type: 'find'; sequence: number }>();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [goToSourceOpen, setGoToSourceOpen] = useState(false);
  const [keyBindingOverrides, setKeyBindingOverrides] = useState<KeyBindingOverrides>(readKeyBindingOverrides);
  const resolvedKeyBindings = useMemo(() => resolveKeyBindings(keyBindingOverrides), [keyBindingOverrides]);
  /* Editors preview with the project's own palette where it has one, so what is
   * shown is the machine's colours rather than the interface theme's. */
  const projectPalette = useMemo(() => resolveProjectPalette(project.files.map((file) => ({ name: file.name, content: file.content })), 4), [project.files]);
  const workbenchKeyLookup = useMemo(() => keyBindingLookup(resolvedKeyBindings, 'workbench'), [resolvedKeyBindings]);
  const workbenchChordPrefixes = useMemo(() => chordPrefixes(resolvedKeyBindings, 'workbench'), [resolvedKeyBindings]);
  /* The first stroke of a two-stroke sequence, and when it was pressed. Held
   * in a ref rather than state because it must not re-render anything: it is
   * consumed by the very next key press. */
  const pendingChord = useRef<{ chord: string; at: number } | null>(null);
  /* Palette labels read the effective chord so a remapped shortcut is never
   * advertised with its replaced default. */
  const commandShortcuts = useMemo(() => {
    const shortcuts = new Map<string, string>();
    for (const binding of resolvedKeyBindings) {
      if (binding.scope !== 'workbench' || !binding.chord || shortcuts.has(binding.commandId)) continue;
      shortcuts.set(binding.commandId, formatChord(binding.chord));
    }
    return shortcuts;
  }, [resolvedKeyBindings]);
  useEffect(() => { writeKeyBindingOverrides(keyBindingOverrides); }, [keyBindingOverrides]);
  const runtimeRef = useRef(new Cpu6502Runtime());
  const buildRequestSequenceRef = useRef(0);
  const buildTimerRef = useRef<{ timer: number; requestId: number; trigger: Extract<BuildTrigger, 'on-save' | 'live'>; targetName: string } | undefined>(undefined);
  const buildWorkerRef = useRef<{ worker: Worker; requestId: number; trigger: BuildTrigger; targetName: string; startedAt: number; contextIdentity: string } | undefined>(undefined);
  const buildAllAbortRef = useRef<AbortController | undefined>(undefined);
  const buildAllWorkersRef = useRef(new Set<Worker>());
  const nativeBuildAbortRef = useRef<AbortController | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void detectNativeToolchains(controller.signal).then(setNativeToolchains).catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => { localStorage.setItem(TEST_HISTORY_KEY, JSON.stringify(testHistory)); }, [testHistory]);

  const openSourceEditor = (id: string) => {
    if (!project.files.some((file) => file.id === id)) return;
    setDocuments((current) => openDocument(current, id)); setWorkspaceTab('Code');
  };
  const selectSourceEditor = (id: string) => setDocuments((current) => selectDocument(current, id));
  const closeSourceEditor = (id: string) => {
    const file = project.files.find((candidate) => candidate.id === id);
    if (!file) return;
    setDocuments((current) => closeDocument(current, id));
    setNotice(`${file.name} editor closed${file.modified ? ' · unsaved content remains recovered in the project' : ' · file remains in the project'}`);
  };
  const closeOtherSourceEditors = (id: string) => { setDocuments((current) => closeOtherDocuments(current, id)); setNotice('Other source editors closed · project files were not deleted'); };
  const closeAllSourceEditors = () => { setDocuments((current) => closeAllDocuments(current)); setNotice('All source editors closed · project files and unsaved content were retained'); };
  const reopenClosedSourceEditor = () => {
    const available = project.files.map((file) => file.id);
    const id = [...documents.recentlyClosed].reverse().find((candidate) => available.includes(candidate));
    if (!id) { setNotice('No recently closed source editor is available'); return; }
    setDocuments((current) => reopenClosedDocument(current, available)); setWorkspaceTab('Code');
    setNotice(`${project.files.find((file) => file.id === id)?.name ?? 'Source'} reopened`);
  };

  /* Resolution reports every departure from what was asked for rather than
   * substituting in silence, so opening a project written for another machine
   * says what changed instead of quietly becoming a different computer. */
  const resolution = useMemo(
    () => resolveConfiguration({ platformClass, machineId: machine.id, variant, romId, enabledCapabilities }),
    [platformClass, machine.id, variant, romId, enabledCapabilities.join(',')],
  );
  const resolved = resolution.target;
  const machineRomSet = romSetFor(machine.id, resolved.rom.id);
  /* A firmware this build cannot run says why. Without this the run path
   * reports it as firmware the person has not supplied, which sends them
   * looking for a file that would not help. */
  const romUnavailableReason = !machineRomSet ? machine.roms.find((entry) => entry.id === resolved.rom.id)?.unavailableReason : undefined;
  const archimedesRuntime = useMemo(() => archimedesRuntimeConfiguration(machine.id, resolved.variant, resolved.rom.id), [machine.id, resolved.variant, resolved.rom.id]);
  const languageBuildTarget = project.buildTargets.find((target) => target.id === project.activeBuildTargetId);
  const languageToolchainId = languageBuildTarget?.toolchainId;
  const languageArtifactCurrent = !!languageBuildTarget && !!buildArtifact?.provenance && provenanceMatches(buildArtifact.provenance, languageBuildTarget, { platformClass, machineId: machine.id, variant: resolved.variant, romId: resolved.rom.id, enabledCapabilities }, project.files);
  const languageGeneratedSymbols = useMemo(() => languageArtifactCurrent && buildArtifact && isMachineCodeArtifact(buildArtifact) ? Object.entries(buildArtifact.symbols).map(([name, value]) => ({ name, value })) : [], [buildArtifact, languageArtifactCurrent]);
  const languageTarget = useMemo<LanguageTargetContext>(() => ({
    processor: machine.cpu.includes('65C12') ? '65c02' : '6502',
    machineId: machine.id,
    machineLabel: machine.label,
    romId: resolved.rom.id,
    romLabel: resolved.rom.label,
    romReady,
    enabledCapabilities: [...enabledCapabilities],
    toolchainId: languageToolchainId,
    buildDefines: [...(languageBuildTarget?.defines ?? [])],
    includePaths: [...(languageBuildTarget?.includePaths ?? [])],
    generatedSymbols: languageGeneratedSymbols,
  }), [enabledCapabilities, languageBuildTarget?.defines, languageBuildTarget?.includePaths, languageGeneratedSymbols, languageToolchainId, machine.cpu, machine.id, machine.label, resolved.rom.id, resolved.rom.label, romReady]);

  useEffect(() => {
    setProject((current) => {
      const aligned = retargetBasicToolchains(current, machine.id);
      const target = { platformClass, machineId: machine.id, variant: resolved.variant, romId: resolved.rom.id, enabledCapabilities: [...enabledCapabilities] };
      const unchanged = JSON.stringify(aligned.target) === JSON.stringify(target)
        && aligned.buildTargets.every((item, index) => item === current.buildTargets[index]);
      return unchanged ? current : { ...aligned, target };
    });
  }, [enabledCapabilities, machine.id, platformClass, resolved.rom.id, resolved.variant]);

  /* Autosave, with its outcome recorded. A write that fails is shown in the
   * status line instead of leaving the session looking saved when it is not. */
  useEffect(() => {
    const outcome = saveProjectSnapshot(project);
    setSaveState(outcome);
    if (!outcome.ok) setNotice(outcome.reason);
  }, [project]);

  /* Said once, at startup, because it describes what the session began from. */
  useEffect(() => {
    if (restored.status === 'restored' || restored.status === 'empty') return;
    setNotice(restored.reason ?? 'The saved project could not be restored.');
  }, [restored]);

  useEffect(() => {
    setProject((current) => {
      const target = { platformClass, machineId: machine.id, variant: resolved.variant, romId: resolved.rom.id, enabledCapabilities };
      return JSON.stringify(current.target) === JSON.stringify(target) ? current : { ...current, target };
    });
  }, [platformClass, machine.id, resolved.variant, resolved.rom.id, enabledCapabilities]);

  useEffect(() => {
    setProject((current) => JSON.stringify(current.breakpoints) === JSON.stringify(sourceBreakpoints) ? current : { ...current, breakpoints: sourceBreakpoints });
  }, [sourceBreakpoints]);

  useEffect(() => {
    let current = true;
    const prefix = machineRomSet ? `${machineRomSet.id}/` : archimedesRuntime ? `archimedes/${archimedesRuntime.profile.id}/` : undefined;
    if (!prefix) { setRomReady(false); setResolvedRomRecords([]); return () => { current = false; }; }
    void listRoms(prefix).then((records) => {
      if (!current) return;
      const supplied = new Set(records.map((record) => record.key));
      const selectedKeys = machineRomSet
        ? new Set(requiredRomRequirements(machineRomSet, enabledCapabilities).map((item) => romStorageKey(machineRomSet.id, item)))
        : archimedesRuntime
          ? new Set([archimedesCombinedRomKey(archimedesRuntime.profile), archimedesCmosKey(archimedesRuntime.profile)])
          : new Set<string>();
      setResolvedRomRecords(records.filter((record) => selectedKeys.has(record.key)).sort((left, right) => left.key.localeCompare(right.key)));
      setRomReady(machineRomSet
        ? requiredRomRequirements(machineRomSet, enabledCapabilities).every((item) => supplied.has(romStorageKey(machineRomSet.id, item)))
        : !!archimedesRuntime && supplied.has(archimedesCombinedRomKey(archimedesRuntime.profile)) && supplied.has(archimedesCmosKey(archimedesRuntime.profile)));
    }).catch(() => { if (current) { setRomReady(false); setResolvedRomRecords([]); } });
    return () => { current = false; };
  }, [enabledCapabilities, machineRomSet, archimedesRuntime, romInventoryRevision]);

  const changePlatform = (next: PlatformClassId) => {
    const nextMachine = machinesForPlatform(next)[0]!;
    setProject((current) => retargetBasicToolchains(current, nextMachine.id));
    setPlatformClass(next);
    setMachineId(nextMachine.id);
    setVariant(nextMachine.variants[0]!);
    setRomId(nextMachine.roms[0]!.id);
    setEnabledCapabilities(defaultCapabilities(nextMachine));
    const processor = analysisProcessorForMachine(nextMachine.cpu);
    setAnalysisProcessor(processor);
    if (processor === 'arm2' || processor === 'arm3') { setAnalysisOrigin('&00008000'); setAnalysisEntry('&00008000'); }
  };

  const changeMachine = (id: string) => {
    const nextMachine = availableMachines.find((item) => item.id === id)!;
    setProject((current) => retargetBasicToolchains(current, nextMachine.id));
    setMachineId(id);
    setVariant(nextMachine.variants[0]!);
    setRomId(nextMachine.roms[0]!.id);
    setEnabledCapabilities(defaultCapabilities(nextMachine));
    const processor = analysisProcessorForMachine(nextMachine.cpu);
    setAnalysisProcessor(processor);
    if (processor === 'arm2' || processor === 'arm3') { setAnalysisOrigin('&00008000'); setAnalysisEntry('&00008000'); }
  };

  const openAnalysisFile = () => fileInputRef.current?.click();

  const newLocalProject = () => {
    if (project.files.some((file) => file.modified) && !window.confirm('Create a new project and discard the current unsaved edits?')) return;
    const next = newProject();
    setProject(next);
    setDocuments(initialDocuments(next.files.map((file) => file.id)));
    setPlatformClass(next.target.platformClass); setMachineId(next.target.machineId); setVariant(next.target.variant); setRomId(next.target.romId); setEnabledCapabilities(next.target.enabledCapabilities); setSourceBreakpoints(next.breakpoints);
    setNotice('New local project created');
  };

  /* Sample projects and imported codebases enter through exactly the same path
   * as a new project, so nothing about them is a special case afterwards. */
  /* The folder a project was imported from, when the browser handed back a
   * handle that can be written to. Held for the session only: a handle cannot
   * be persisted, so a reload legitimately loses the connection and the
   * write-back command goes back to being unavailable. */
  const [connectedFolder, setConnectedFolder] = useState<FileSystemDirectoryHandleLike | null>(null);

  /* Which sideways ROM occupies which bank. Held for the session: an image is
   * the person's own firmware and is never written into the project. */
  const [sidewaysLayout, setSidewaysLayout] = useState<SidewaysAssignment[]>([]);

  /* Write the project's source files back into the folder they came from. Only
   * the sources are written: build output belongs to the build directory and
   * putting it here would overwrite work the person did not ask us to touch. */
  const writeProjectToFolder = async () => {
    if (!connectedFolder) { setNotice('This project is not connected to a folder on disk. Import one through Start a project to connect it.'); return; }
    try {
      const result = await writeDirectory(connectedFolder, project.files.filter((file) => file.kind !== 'generated').map((file) => ({ path: file.name, content: file.content })));
      const failures = result.failed.length ? ` ${result.failed.length} could not be written: ${result.failed.map((entry) => `${entry.path} (${entry.reason})`).join('; ')}` : '';
      setNotice(`Wrote ${result.written.length} file${result.written.length === 1 ? '' : 's'} to ${connectedFolder.name}.${failures}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const adoptProject = (next: LocalProject, description: string, folder?: FileSystemDirectoryHandleLike | null) => {
    if (project.files.some((file) => file.modified) && !window.confirm('Replace the current project and discard its unsaved edits?')) return;
    setProject(next);
    setDocuments(initialDocuments(next.files.map((file) => file.id)));
    setPlatformClass(next.target.platformClass); setMachineId(next.target.machineId); setVariant(next.target.variant); setRomId(next.target.romId); setEnabledCapabilities(next.target.enabledCapabilities); setSourceBreakpoints(next.breakpoints);
    setStartProjectOpen(false);
    setConnectedFolder(folder ?? null);
    setWorkspaceTab('Code');
    /* A project written for one configuration and opened against another is the
     * moment portability matters. Say what will not survive the move before any
     * of it is built or run, rather than after it fails. */
    const incoming = resolveConfiguration(next.target);
    const portability = compareConfigurations(resolved, incoming.target);
    const notes = [
      ...incoming.diagnostics.map((item) => item.reason),
      ...(portability.warnings.length && incoming.exact ? portability.warnings : []),
    ];
    setNotice(notes.length ? `${description} · ${notes.join(' ')}` : description);
  };

  const saveLocalProject = () => {
    const saved = serializableProject(project);
    setProject(saved);
    localStorage.setItem('8bit-net-dev:local-project', JSON.stringify(saved));
    setPolicyBuildRequest((current) => ({ sequence: (current?.sequence ?? 0) + 1, fileId: '*' }));
    setNotice(`${project.name} saved in this browser`);
  };

  const saveSourceFile = (fileId: string) => {
    const file = project.files.find((candidate) => candidate.id === fileId);
    if (!file) { setNotice('No open source editor to save'); return; }
    if (file.access === 'read-only' || file.kind === 'generated') { setNotice(`${file.name} is read-only${file.generator ? ` and generated by ${file.generator}` : ''}; copy or download it instead`); return; }
    setProject((current) => {
      const saved = savedProjectFile(current, file.id);
      localStorage.setItem('8bit-net-dev:local-project', JSON.stringify(saved));
      return saved;
    });
    setPolicyBuildRequest((current) => ({ sequence: (current?.sequence ?? 0) + 1, fileId: file.id }));
    setNotice(`${file.name} saved in this browser${project.files.some((candidate) => candidate.id !== file.id && candidate.modified) ? ' · other modified files remain' : ''}`);
  };
  const saveCurrentSource = () => saveSourceFile(activeFileId);

  const revertSourceFile = (id: string) => {
    const file = project.files.find((candidate) => candidate.id === id);
    if (file?.access === 'read-only' || file?.kind === 'generated') { setNotice(`${file.name} is read-only and cannot be reverted`); return false; }
    if (!file || file.saved === false || file.content === (file.savedContent ?? file.content)) { setNotice(`${file?.name ?? 'Source'} has no saved content changes to revert`); return false; }
    if (!window.confirm(`Revert ${file.name} to its last explicit save? This content change cannot be undone.`)) return false;
    setProject((current) => { const before = current.files.find((candidate) => candidate.id === id)?.content ?? ''; const reverted = revertedProjectFile(current, id); const after = reverted.files.find((candidate) => candidate.id === id)?.content ?? ''; return { ...reverted, bookmarks: trackSourceBookmarks(current.bookmarks, id, before, after) }; });
    setNotice(`${file.name} reverted to its last explicit save`);
    return true;
  };

  const exportLocalProject = (includePrivateBookmarks = false) => {
    const bundle = createProjectBundle(project, { createdAt: new Date().toISOString(), includePrivateBookmarks });
    downloadBlob(new Blob([JSON.stringify(bundle, null, 2), '\n'], { type: 'application/json' }), `${safeFilename(project.name)}.8bitdev.json`);
    setProjectExportOpen(false);
    setNotice(`${project.name} exported as a bundle · ${bundleSummary(bundle)}`);
  };

  /* The bundle that would be written, so the dialog can show what it needs,
   * what it leaves out and anything that looks like a credential, before a file
   * is produced rather than after. */
  const exportPreview = useMemo<ProjectBundle | null>(
    () => projectExportOpen ? createProjectBundle(project, { createdAt: new Date(0).toISOString() }) : null,
    [projectExportOpen, project],
  );

  const openProjectFile = async (file: File) => {
    try {
      /* A bundle is verified against its own manifest before anything is
       * opened; a plain project export from an older build still loads. */
      const text = await file.text();
      const opened = text.includes(PROJECT_BUNDLE_SCHEMA) ? openProjectBundle(text) : null;
      const loaded = opened ? opened.project : parseProject(text);
      setProject(loaded);
      setDocuments(initialDocuments(loaded.files.map((candidate) => candidate.id)));
      setPlatformClass(loaded.target.platformClass); setMachineId(loaded.target.machineId); setVariant(loaded.target.variant); setRomId(loaded.target.romId); setEnabledCapabilities(loaded.target.enabledCapabilities); setSourceBreakpoints(loaded.breakpoints);
      setWorkspaceTab('Code');
      /* Say what arrived: a verified bundle, what it needs, and whether it was
       * written by an older build and migrated forward. */
      const notes: string[] = [];
      if (opened) {
        notes.push(`bundle verified against its manifest · ${bundleSummary(opened.bundle)}`);
        if (opened.migratedFrom) notes.push(`migrated from ${opened.migratedFrom}`);
      }
      setNotice(`${loaded.name} opened${notes.length ? ` · ${notes.join(' · ')}` : ''}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The project could not be opened');
    }
  };

  const addSourceFile = (requested?: string, content = '') => {
    const answer = requested ?? window.prompt('New source filename:', 'untitled.bas');
    if (answer === null || !answer.trim()) return;
    const { name, reason } = namedForProject(answer, project.files);
    const created = createProjectFile(name, content);
    setProject((current) => ({ ...current, files: [...current.files, created] }));
    setDocuments((current) => openDocument(current, created.id));
    setWorkspaceTab('Code');
    /* A name that had to change is said out loud with the reason, so nobody
     * goes looking for the file under the name they typed. */
    setNotice(reason ? `${created.name} added — the name was changed because ${reason}` : `${created.name} added`);
  };

  const addLivePixelAsset = (requestedStem: string, content: string) => {
    const stem = safeFilename(requestedStem); const documentName = uniqueFilename(`${stem}.asset.json`, project.files);
    const documentFile = createProjectFile(documentName, content); const entryName = uniqueFilename(`${stem}.asset.asm`, [...project.files, documentFile]);
    const entryFile = createProjectFile(entryName, `ORG &1900\nINCLUDEASSET "${documentName}"\n`);
    const target = { ...createBuildTarget(entryFile), name: `${stem} asset`, outputName: `${stem}.bin` };
    setProject((current) => ({ ...current, files: [...current.files, documentFile, entryFile], buildTargets: [...current.buildTargets, target], activeBuildTargetId: target.id }));
    setDocuments((current) => openDocument(openDocument(current, documentFile.id), entryFile.id)); setWorkspaceTab('Code'); setNotice(`${documentName} linked to build target ${target.name}`);
  };

  /* A live map becomes a real build target the same way a live asset does: the
   * editable document plus a one-line entry file that includes it, so the map
   * participates in provenance, staleness and incremental impact analysis. */
  const addLiveTileMap = (requestedStem: string, content: string) => addLiveGeneratedDocument(requestedStem, content, 'map', 'INCLUDEMAP');

  const addLiveFont = (requestedStem: string, content: string) => addLiveGeneratedDocument(requestedStem, content, 'font', 'INCLUDEFONT');

  const addLiveScreen = (requestedStem: string, content: string) => addLiveGeneratedDocument(requestedStem, content, 'screen', 'INCLUDESCREEN');

  const addLiveSong = (requestedStem: string, content: string) => addLiveGeneratedDocument(requestedStem, content, 'song', 'INCLUDESONG');

  const addLivePalette = (requestedStem: string, content: string) => addLiveGeneratedDocument(requestedStem, content, 'palette', 'INCLUDEPALETTE');

  /* One path for every generated-document kind, so a live palette, font or map
   * participates in provenance, staleness and impact analysis identically. */
  function addLiveGeneratedDocument(requestedStem: string, content: string, kind: 'palette' | 'font' | 'map' | 'screen' | 'song', directive: string) {
    const stem = safeFilename(requestedStem);
    const documentName = uniqueFilename(`${stem}.${kind}.json`, project.files);
    const documentFile = createProjectFile(documentName, content);
    const entryName = uniqueFilename(`${stem}.${kind}.asm`, [...project.files, documentFile]);
    const entryFile = createProjectFile(entryName, `ORG &1900\n${directive} "${documentName}"\n`);
    const target = { ...createBuildTarget(entryFile), name: `${stem} ${kind}`, outputName: `${stem}.bin` };
    setProject((current) => ({ ...current, files: [...current.files, documentFile, entryFile], buildTargets: [...current.buildTargets, target], activeBuildTargetId: target.id }));
    setDocuments((current) => openDocument(openDocument(current, documentFile.id), entryFile.id));
    setWorkspaceTab('Code');
    setNotice(`${documentName} linked to build target ${target.name}`);
  }

  const importSourceFiles = async (selection: File[]) => {
    let currentFiles = project.files;
    const imported: ProjectFile[] = [];
    for (const file of selection) {
      if (file.size > MAX_SOURCE_FILE_BYTES) {
        setNotice(`${file.name} was skipped because source files are limited to 1 MiB`);
        continue;
      }
      const decoded = decodeSourceText(new Uint8Array(await file.arrayBuffer()));
      if (sourceUtf8ByteLength(decoded.content) > MAX_SOURCE_FILE_BYTES || currentFiles.reduce((total, item) => total + sourceUtf8ByteLength(item.content), 0) + sourceUtf8ByteLength(decoded.content) > MAX_PROJECT_SOURCE_BYTES) { setNotice(`${file.name} was skipped because it would exceed the 1 MiB file or 8 MiB project source limit`); continue; }
      const created = { ...createProjectFile(uniqueFilename(file.name, currentFiles), decoded.content), encoding: decoded.encoding, lineEnding: decoded.lineEnding, savedEncoding: decoded.encoding, savedLineEnding: decoded.lineEnding, kind: 'imported' as const, access: 'editable' as const };
      currentFiles = [...currentFiles, created];
      imported.push(created);
    }
    if (!imported.length) return;
    setProject((current) => ({ ...current, files: currentFiles }));
    setDocuments((current) => openDocument(current, imported[0]!.id));
    setWorkspaceTab('Code');
    setNotice(`${imported.length} source file${imported.length === 1 ? '' : 's'} imported with detected encoding and line endings`);
  };

  const updateSourceFile = (id: string, content: string) => {
    const source = project.files.find((file) => file.id === id);
    if (source?.access === 'read-only' || source?.kind === 'generated') { setNotice(`${source.name} is read-only and cannot be edited`); return; }
    if (sourceUtf8ByteLength(content) > MAX_SOURCE_FILE_BYTES) { setNotice('Edit refused because an editable source file cannot exceed 1 MiB'); return; }
    const total = project.files.reduce((size, file) => size + sourceUtf8ByteLength(file.id === id ? content : file.content), 0);
    if (total > MAX_PROJECT_SOURCE_BYTES) { setNotice('Edit refused because editable project source cannot exceed 8 MiB'); return; }
    setProject((current) => {
      const before = current.files.find((file) => file.id === id)?.content ?? '';
      return { ...current, files: current.files.map((file) => file.id === id ? { ...file, content, modified: projectFileIsModified(file, file.name, content) } : file), bookmarks: trackSourceBookmarks(current.bookmarks, id, before, content) };
    });
  };

  const updateSourceFiles = (changes: Array<{ id: string; content: string }>) => {
    const protectedSource = changes.map((change) => project.files.find((file) => file.id === change.id)).find((file) => file?.access === 'read-only' || file?.kind === 'generated');
    if (protectedSource) { setNotice(`${protectedSource.name} is read-only and was not changed`); return; }
    const changed = new Map(changes.map((change) => [change.id, change.content]));
    if (changes.some((change) => sourceUtf8ByteLength(change.content) > MAX_SOURCE_FILE_BYTES) || project.files.reduce((total, file) => total + sourceUtf8ByteLength(changed.get(file.id) ?? file.content), 0) > MAX_PROJECT_SOURCE_BYTES) { setNotice('Project edit refused because it exceeds the 1 MiB file or 8 MiB project source limit'); return; }
    setProject((current) => {
      let bookmarks = current.bookmarks;
      let files = current.files;
      for (const change of changes) {
        const source = files.find((file) => file.id === change.id);
        if (!source || source.content === change.content) continue;
        bookmarks = trackSourceBookmarks(bookmarks, source.id, source.content, change.content);
        files = files.map((file) => file.id === source.id ? { ...file, content: change.content, modified: projectFileIsModified(file, file.name, change.content) } : file);
      }
      return { ...current, files, bookmarks };
    });
  };
  const updateSourceTextFormat = (id: string, encoding: SourceEncoding, lineEnding: SourceLineEnding) => {
    const file = project.files.find((candidate) => candidate.id === id); if (!file) return;
    if (file.access === 'read-only' || file.kind === 'generated') { setNotice(`${file.name} is read-only and its format cannot be changed`); return; }
    try { encodeSourceText(file.content, encoding, lineEnding); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); return; }
    setProject((current) => ({ ...current, files: current.files.map((candidate) => candidate.id === id ? { ...candidate, encoding, lineEnding, modified: projectFileIsModified(candidate, candidate.name, candidate.content, encoding, lineEnding) } : candidate) }));
    setNotice(`${file.name} will download as ${encoding.toUpperCase()} with ${lineEnding.toUpperCase()} line endings`);
  };

  const addSourceBookmark = (fileId: string, line: number, column: number, name: string) => {
    setProject((current) => { const file = current.files.find((candidate) => candidate.id === fileId); return file ? { ...current, bookmarks: [...current.bookmarks, createSourceBookmark(file, line, column, name)] } : current; });
  };
  const updateSourceBookmark = (id: string, changes: Partial<Pick<SourceBookmark, 'name' | 'description' | 'scope' | 'enabled' | 'line' | 'column' | 'anchor' | 'orphaned'>>) => {
    setProject((current) => ({ ...current, bookmarks: current.bookmarks.map((bookmark) => bookmark.id === id ? { ...bookmark, ...changes, ...(changes.name ? { name: changes.name.trim().slice(0, 120) || bookmark.name } : {}), ...(changes.description !== undefined ? { description: changes.description.trim().slice(0, 1000) } : {}) } : bookmark) }));
  };
  const removeSourceBookmark = (id: string) => setProject((current) => ({ ...current, bookmarks: current.bookmarks.filter((bookmark) => bookmark.id !== id) }));

  const renameSourceFile = (id: string) => {
    const file = project.files.find((candidate) => candidate.id === id);
    if (!file) return;
    if (file.access === 'read-only' || file.kind === 'generated') { setNotice(`${file.name} is read-only and cannot be renamed`); return; }
    const requested = window.prompt('Rename source file:', file.name);
    if (!requested || requested.trim() === file.name) return;
    const { name, reason } = namedForProject(requested, project.files.filter((candidate) => candidate.id !== id));
    setProject((current) => ({ ...current, files: current.files.map((candidate) => candidate.id === id ? { ...candidate, name, language: languageForFilename(name), modified: projectFileIsModified(candidate, name, candidate.content) } : candidate) }));
    setNotice(reason ? `${file.name} renamed to ${name} — the name was changed because ${reason}` : `${file.name} renamed to ${name}`);
  };

  /* Deleting moves the file to the project's trash together with the build
   * targets and bookmarks that went with it, so it can be put back rather than
   * only confirmed away. */
  const deleteSourceFile = (id: string) => {
    const remaining = project.files.filter((candidate) => candidate.id !== id);
    try {
      const result = trashFile(project, id, new Date().toISOString());
      setProject(result.project);
      setDocuments((current) => removeDocument(current, id, remaining.map((file) => file.id)));
      const dropped = result.dropped.length ? ` · ${result.dropped.length} older trash entr${result.dropped.length === 1 ? 'y was' : 'ies were'} dropped at the ${MAX_TRASH_ENTRIES}-entry limit` : '';
      setNotice(`${result.entry.file.name} moved to the project trash · ${trashEntrySummary(result.entry)} · restore it from the explorer${dropped}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  /* Reordering is a real change to the project, so it is saved like any other
   * and announced: a drag that did nothing, or that was refused, should say so
   * rather than leave the row apparently back where it started for no reason. */
  const reorderFiles = (movedId: string, targetId: string, position: 'before' | 'after') => {
    const result = reorderProjectFiles(project.files, movedId, targetId, position);
    if (result.refusal) { setNotice(result.refusal); return; }
    if (result.files.every((file, index) => file.id === project.files[index]?.id)) return;
    setProject((current) => ({ ...current, files: result.files }));
    const at = result.files.findIndex((file) => file.id === movedId);
    setNotice(`${result.moved.name} moved to position ${at + 1} of ${result.files.length}`);
  };

  const restoreTrashedFile = (id: string) => {
    try {
      const result = restoreFromTrash(project, id);
      setProject(result.project);
      const notes = [
        result.renamedTo ? `restored as ${result.renamedTo} because its name was taken` : null,
        ...result.skippedTargets,
      ].filter(Boolean);
      setNotice(`${result.entry.file.name} restored${notes.length ? ` · ${notes.join(' · ')}` : ` · ${trashEntrySummary(result.entry)}`}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const purgeTrashedFile = (id?: string) => {
    const target = id ? project.trash.find((entry) => entry.id === id) : null;
    if (!window.confirm(id ? `Permanently delete ${target?.file.name ?? 'this file'}? This cannot be undone.` : 'Permanently delete everything in the project trash? This cannot be undone.')) return;
    setProject(purgeTrash(project, id));
    setNotice(id ? `${target?.file.name ?? 'The file'} permanently deleted` : 'Project trash emptied');
  };

  const downloadSourceFile = (id: string) => {
    const file = project.files.find((candidate) => candidate.id === id);
    if (!file) return;
    try {
      const encoding = file.encoding ?? 'utf-8'; const lineEnding = file.lineEnding ?? 'lf';
      const bytes = encodeSourceText(file.content, encoding, lineEnding);
      downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }), file.name);
      setNotice(`${file.name} downloaded as ${encoding.toUpperCase()} with ${lineEnding.toUpperCase()} line endings`);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  };

  useEffect(() => () => analysisTaskRef.current?.cancel('Analysis workspace closed'), []);

  const beginAnalysis = (name: string, bytes: Uint8Array, metadata: AcornFileMetadata, processor: AnalysisProcessor, origin: number, entryPoint: number, verb: 'loaded' | 're-analysed', annotationOverride?: AnalysisAnnotations) => {
    analysisTaskRef.current?.cancel('Superseded by a newer analysis request');
    /* Annotations are looked up by digest, so re-opening the same binary from a
     * different route brings back what was recorded about it. */
    const digest = sha256Hex(bytes);
    const recorded = annotationOverride
      ?? (analysisHistories[digest] ? currentAnnotations(analysisHistories[digest]!) : project.analysisAnnotations[digest]);
    const annotations = recorded ?? emptyAnalysisAnnotations(digest);
    if (!analysisHistories[digest]) {
      setAnalysisHistories((current) => current[digest] ? current : { ...current, [digest]: createAnnotationHistory(annotations, 'Analysis opened') });
    }
    const task = startAnalysisTask(
      bytes,
      name,
      { origin, entryPoint, processor, basicDialect: machine.id === 'atom' ? 'atom-basic' : 'bbc-basic-ii', tokenisedBasicDialect: processor === 'arm2' || processor === 'arm3' ? 'bbc-basic-5' : 'bbc-basic-2', ...(isEmptyAnnotations(annotations) ? {} : { annotations }) },
      /* Bytes the parser has settled, in its own words. A stale worker's
       * progress cannot reach here: the client drops anything whose request
       * identity is not the current one. */
      (progress) => { if (analysisTaskRef.current === task) setAnalysisActivity({ status: 'running', message: describeProgress(progress) }); },
    );
    analysisTaskRef.current = task; setAnalysisActivity({ status: 'running', message: `Analysing ${bytes.length.toLocaleString()} bytes in an isolated browser worker…` }); setWorkspaceTab('Analyse');
    void task.promise.then((analysis) => {
      if (analysisTaskRef.current !== task) return;
      analysisTaskRef.current = undefined; setAnalysisActivity({ status: 'idle', message: '' });
      setAnalysisFile({ name, bytes, analysis, metadata });
      setNotice(`${name} ${verb}${metadata.containerFormat ? ` · ${metadata.containerFormat} payload extracted` : ''} · ${analysis.kind === 'machine-code' ? `${analysis.codeByteCount} code bytes identified` : analysis.kind === 'bbc-basic' ? `${analysis.dialect} detected` : 'text detected'}`);
    }).catch((error) => {
      if (analysisTaskRef.current !== task) return;
      analysisTaskRef.current = undefined;
      if (error instanceof DOMException && error.name === 'AbortError') { setAnalysisActivity({ status: 'idle', message: '' }); return; }
      const message = error instanceof Error ? error.message : String(error);
      setAnalysisActivity({ status: 'failed', message }); setNotice(`Analysis failed · ${message}`);
    });
  };

  const openAnalysisPayload = (name: string, bytes: Uint8Array, metadata: AcornFileMetadata, overrides: { processor?: AnalysisProcessor; origin?: number; entryPoint?: number } = {}) => {
    const processor = overrides.processor ?? analysisProcessor;
    const arm = processor === 'arm2' || processor === 'arm3'; const width = arm ? 8 : 4;
    const fallbackOrigin = parseHexAddress(analysisOrigin, width) ?? (arm ? 0x8000 : 0x1900);
    const origin = overrides.origin ?? logicalAnalysisAddress(metadata.load, fallbackOrigin, processor);
    const entryPoint = overrides.entryPoint ?? logicalAnalysisAddress(metadata.execute, parseHexAddress(analysisEntry, width) ?? origin, processor);
    setAnalysisProcessor(processor); setAnalysisOrigin(`&${origin.toString(16).toUpperCase().padStart(width, '0')}`); setAnalysisEntry(`&${entryPoint.toString(16).toUpperCase().padStart(width, '0')}`);
    beginAnalysis(name, bytes, metadata, processor, origin, entryPoint, 'loaded');
  };

  const loadAnalysisFiles = async (selection: File[]) => {
    const dataFiles = selection.filter((file) => !/\.inf$/i.test(file.name));
    const sidecars = selection.filter((file) => /\.inf$/i.test(file.name));
    if (dataFiles.length !== 1) {
      setNotice(dataFiles.length ? 'Choose one data file and, optionally, its matching .inf sidecar' : 'The selection contains metadata but no data file');
      return;
    }
    const file = dataFiles[0]!;
    if (file.size > 4 * 1024 * 1024) {
      setNotice('Analysis refused · files are limited to 4 MiB in this browser workspace');
      return;
    }
    const matchingSidecar = sidecars.find((sidecar) => sidecar.name.replace(/\.inf$/i, '').toLowerCase() === file.name.toLowerCase());
    const containerBytes = new Uint8Array(await file.arrayBuffer());
    let bytes = containerBytes;
    let containerMetadata: AcornFileMetadata | undefined;
    if (/\.atm$/i.test(file.name)) {
      try {
        const atm = parseAtomAtm(containerBytes); bytes = atm.bytes;
        containerMetadata = { source: 'container', catalogueName: atm.name, load: atm.loadAddress, execute: atm.executionAddress, declaredLength: atm.bytes.length, containerFormat: 'Atom ATM', containerByteLength: containerBytes.length, warnings: [] };
      } catch (error) { setNotice(`Analysis refused · ${error instanceof Error ? error.message : String(error)}`); return; }
    }
    const metadata = metadataForHostFile(file.name, matchingSidecar ? { name: matchingSidecar.name, text: await matchingSidecar.text() } : undefined, containerMetadata);
    if (metadata.declaredLength !== undefined && metadata.declaredLength !== bytes.length) {
      metadata.warnings.push(`The selected metadata declares ${metadata.declaredLength.toLocaleString()} bytes but the analysed payload contains ${bytes.length.toLocaleString()}.`);
    }
    openAnalysisPayload(file.name, bytes, metadata);
  };

  const reanalyse = () => {
    if (!analysisFile) return;
    const arm = analysisProcessor === 'arm2' || analysisProcessor === 'arm3';
    const width = arm ? 8 : 4;
    const origin = parseHexAddress(analysisOrigin, width);
    const entryPoint = parseHexAddress(analysisEntry, width);
    if (origin === null || entryPoint === null) {
      setNotice(`Load and entry addresses must be ${arm ? '26-bit ARM' : '16-bit'} hexadecimal values`);
      return;
    }
    beginAnalysis(analysisFile.name, analysisFile.bytes, analysisFile.metadata, analysisProcessor, origin, entryPoint, 're-analysed');
  };

  /* An annotation edit is recorded, mirrored into the project, and immediately
   * re-run: the listing a reader sees is always the one their recorded
   * knowledge produces, never a stale listing with an annotation pending. */
  const applyAnalysisAnnotations = (next: AnalysisAnnotations, description: string) => {
    if (!analysisFile || !analysisDigest) return;
    const history = analysisHistories[analysisDigest] ?? createAnnotationHistory(emptyAnalysisAnnotations(analysisDigest), 'Analysis opened');
    const updated = recordAnnotationEdit(history, next, description);
    if (updated === history) return;
    setAnalysisHistories((current) => ({ ...current, [analysisDigest]: updated }));
    setProject((current) => {
      const annotations = { ...current.analysisAnnotations };
      if (isEmptyAnnotations(next)) delete annotations[analysisDigest];
      else annotations[analysisDigest] = next;
      return { ...current, analysisAnnotations: annotations };
    });
    const arm = analysisProcessor === 'arm2' || analysisProcessor === 'arm3';
    const width = arm ? 8 : 4;
    const origin = parseHexAddress(analysisOrigin, width);
    const entryPoint = parseHexAddress(analysisEntry, width);
    if (origin === null || entryPoint === null) { setNotice('Load and entry addresses must be valid before annotations can be applied'); return; }
    beginAnalysis(analysisFile.name, analysisFile.bytes, analysisFile.metadata, analysisProcessor, origin, entryPoint, 're-analysed', next);
    setNotice(`${description} · ${annotationSummary(next)}`);
  };

  const moveAnalysisHistory = (direction: 'undo' | 'redo') => {
    if (!analysisFile || !analysisDigest) return;
    const history = analysisHistories[analysisDigest];
    if (!history) return;
    const updated = direction === 'undo' ? undoAnnotations(history) : redoAnnotations(history);
    if (updated === history) return;
    const annotations = currentAnnotations(updated);
    setAnalysisHistories((current) => ({ ...current, [analysisDigest]: updated }));
    setProject((current) => {
      const stored = { ...current.analysisAnnotations };
      if (isEmptyAnnotations(annotations)) delete stored[analysisDigest];
      else stored[analysisDigest] = annotations;
      return { ...current, analysisAnnotations: stored };
    });
    const arm = analysisProcessor === 'arm2' || analysisProcessor === 'arm3';
    const width = arm ? 8 : 4;
    const origin = parseHexAddress(analysisOrigin, width);
    const entryPoint = parseHexAddress(analysisEntry, width);
    if (origin === null || entryPoint === null) return;
    beginAnalysis(analysisFile.name, analysisFile.bytes, analysisFile.metadata, analysisProcessor, origin, entryPoint, 're-analysed', annotations);
    setNotice(`${direction === 'undo' ? 'Undid' : 'Redid'} an analysis annotation · ${annotationHistorySummary(updated)}`);
  };

  const analyseBuildArtifact = (artifact: BuildArtifact) => {
    const executable = isMachineCodeArtifact(artifact);
    const name = artifact.provenance?.target.outputName ?? activeBuildTarget.outputName;
    const metadata: AcornFileMetadata = {
      source: 'project-manifest', catalogueName: name, declaredLength: artifact.bytes.length,
      ...(executable ? { load: artifact.origin, execute: artifact.entryPoint } : {}),
      buildTargetId: artifact.provenance?.target.id ?? activeBuildTarget.id,
      buildFingerprint: artifact.provenance?.fingerprint,
      addressSpace: executable ? artifact.kind === 'arm-binary' ? 'ARM 26-bit logical memory' : '6502 16-bit main memory' : 'Interpreter-owned program',
      bank: executable ? 'Unbanked build output' : 'Not applicable', warnings: [],
    };
    openAnalysisPayload(name, artifact.bytes, metadata, executable ? { processor: artifact.processor, origin: artifact.origin, entryPoint: artifact.entryPoint } : {});
  };

  const toggleCapability = (id: string) => {
    setEnabledCapabilities((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const queueMachineCommand = useCallback((message: Record<string, unknown>) => setMachineCommand((current) => ({ id: (current?.id ?? 0) + 1, message })), []);
  const updateDebugLifecycle = useCallback((lifecycle: DebugLifecycleState, reason: string) => setDebugSession((current) => {
    if (!current) return current;
    try { return transitionDebugSession(current, lifecycle, reason); }
    catch { return current; }
  }), []);
  const queueDebugMachineCommand = useCallback((message: Record<string, unknown>) => {
    const type = String(message.type ?? '');
    if (type === 'step' || type === 'step-over' || type === 'step-out' || type === 'source-step') updateDebugLifecycle('stepping', `${type} requested from the attached adapter`);
    else if (type === 'reverse-step' || type === 'reverse-continue') updateDebugLifecycle('rewinding', `${type} requested from retained deterministic history`);
    else if (type === 'run' || type === 'run-to') updateDebugLifecycle('running', `${type} requested from the attached adapter`);
    else if (type === 'pause') updateDebugLifecycle('paused', 'Pause requested from the attached adapter');
    else if (type === 'reset') updateDebugLifecycle('starting', 'Restarting the same immutable debug session binding');
    else if (type === 'stop') updateDebugLifecycle('terminated', 'Operator stopped the debug session; the machine is paused');
    queueMachineCommand(message);
  }, [queueMachineCommand, updateDebugLifecycle]);
  const receiveMachineTest = useCallback((result: MachineTestResult | null) => {
    setHardwareTest(result);
    if (result && result.status !== 'running') {
      const status = result.status as TestHistoryResult['status'];
      setTestHistory((current) => [{ sequence: ++testHistorySequenceRef.current, recordedAt: new Date().toISOString(), result: { name: result.name, status, reason: result.reason.slice(0, 500), cycles: result.cycles, assertions: result.assertions.slice(0, 64).map((assertion) => ({ source: String(assertion.source).slice(0, 200), passed: assertion.passed, expected: renderAssertionValue('expectedDigest' in assertion && assertion.expectedDigest !== undefined ? assertion.expectedDigest : (assertion as { expected?: unknown }).expected), actual: renderAssertionValue(assertion.actual) })), ...(result.suite ? { suite: result.suite } : {}), ...(result.buildFingerprint ? { buildFingerprint: result.buildFingerprint } : {}) } }, ...current].slice(0, 100));
    }
    const waiter = testResultWaiterRef.current;
    if (result && waiter && result.requestId === waiter.requestId && result.status !== 'running') { testResultWaiterRef.current = undefined; waiter.resolve(result); }
  }, []);
  const resolveSourceBreakpointAddresses = (artifact: AssemblyArtifact | ArmArtifact) => Object.entries(sourceBreakpoints).flatMap(([fileId, lines]) => lines.flatMap((line) => {
    const address = Object.entries(artifact.sourceLocations).find(([, location]) => location.fileId === fileId && location.line === line)?.[0];
    return address === undefined ? [] : [Number(address)];
  }));
  const currentSourceLocation = (): SourceLocation => activeSourcePane === 'secondary' && sourceSplitFileId
    ? { paneId: 'secondary', splitFileId: sourceSplitFileId, ...secondarySourceLocation, fileId: sourceSplitFileId }
    : { paneId: 'primary', ...(sourceSplitFileId ? { splitFileId: sourceSplitFileId } : {}), fileId: activeFileId, line: caretLine, column: caretColumn, length: caretSelectionLength, scrollTop: sourceScrollTop };
  const performSourceJump = (location: SourceLocation) => {
    if (!project.files.some((file) => file.id === location.fileId)) return;
    setSourceSplitFileId(location.splitFileId && project.files.some((file) => file.id === location.splitFileId) ? location.splitFileId : undefined);
    if (location.paneId === 'secondary') {
      setSourceSplitFileId(location.fileId); setActiveSourcePane('secondary');
    } else {
      openSourceEditor(location.fileId); setActiveSourcePane('primary');
    }
    setWorkspaceTab('Code');
    setSourceJumps((current) => ({ ...current, [location.paneId]: { ...location, sequence: (current[location.paneId]?.sequence ?? 0) + 1 } }));
  };
  const jumpToSourceLocation = (fileId: string, line: number, column = 1, length = 0) => {
    if (!project.files.some((file) => file.id === fileId)) return;
    const origin = currentSourceLocation();
    const target: SourceLocation = { paneId: activeSourcePane === 'secondary' && sourceSplitFileId ? 'secondary' : 'primary', ...(sourceSplitFileId ? { splitFileId: activeSourcePane === 'secondary' ? fileId : sourceSplitFileId } : {}), fileId, line, column, length, scrollTop: 0 };
    if (origin.paneId !== target.paneId || origin.splitFileId !== target.splitFileId || origin.fileId !== target.fileId || origin.line !== target.line || origin.column !== target.column || origin.length !== target.length) {
      setSourceNavigation((current) => ({ back: [...current.back, origin].slice(-100), forward: [] }));
    }
    performSourceJump(target);
  };
  const navigateSourceBack = () => {
    const target = sourceNavigation.back.at(-1); if (!target) return;
    const origin = currentSourceLocation();
    setSourceNavigation((current) => ({ back: current.back.slice(0, -1), forward: [...current.forward, origin].slice(-100) }));
    performSourceJump(target); setNotice(`Back to ${project.files.find((file) => file.id === target.fileId)?.name ?? 'source'}:${target.line}:${target.column}`);
  };
  const navigateSourceForward = () => {
    const target = sourceNavigation.forward.at(-1); if (!target) return;
    const origin = currentSourceLocation();
    setSourceNavigation((current) => ({ back: [...current.back, origin].slice(-100), forward: current.forward.slice(0, -1) }));
    performSourceJump(target); setNotice(`Forward to ${project.files.find((file) => file.id === target.fileId)?.name ?? 'source'}:${target.line}:${target.column}`);
  };
  const openSourceSplit = (fileId: string) => {
    const origin = currentSourceLocation();
    setSourceSplitFileId(fileId); setActiveSourcePane('secondary');
    setSecondarySourceLocation({ fileId, line: origin.fileId === fileId ? origin.line : 1, column: origin.fileId === fileId ? origin.column : 1, length: origin.fileId === fileId ? origin.length : 0, scrollTop: origin.fileId === fileId ? origin.scrollTop : 0 });
    setSourceJumps((current) => ({ ...current, secondary: { paneId: 'secondary', fileId, line: origin.fileId === fileId ? origin.line : 1, column: origin.fileId === fileId ? origin.column : 1, length: origin.fileId === fileId ? origin.length : 0, scrollTop: origin.fileId === fileId ? origin.scrollTop : 0, sequence: (current.secondary?.sequence ?? 0) + 1 } }));
    setNotice(`Secondary editor opened for ${project.files.find((file) => file.id === fileId)?.name ?? 'source'}`);
  };
  const closeSourceSplit = () => { setSourceSplitFileId(undefined); setActiveSourcePane('primary'); setNotice('Secondary editor closed'); };
  const openSdkDocument = (path: string, token?: string) => {
    sdkDocumentAbortRef.current?.abort();
    const controller = new AbortController(); sdkDocumentAbortRef.current = controller;
    setSdkDocument({ path, token, status: 'loading' }); setWorkspaceTab('Code');
    void loadSdkDocument(path, controller.signal).then((document) => {
      if (sdkDocumentAbortRef.current !== controller) return;
      setSdkDocument({ path, token, status: 'ready', document });
      setNotice(`${document.path} opened read-only from ${document.toolchainId}@${document.toolchainVersion}${token ? ` at ${token}` : ''}`);
    }).catch((error) => {
      if (controller.signal.aborted || sdkDocumentAbortRef.current !== controller) return;
      const message = error instanceof Error ? error.message : String(error);
      setSdkDocument({ path, token, status: 'error', error: message }); setNotice(`SDK document failed: ${message}`);
    });
  };
  const closeSdkDocument = () => {
    sdkDocumentAbortRef.current?.abort(); sdkDocumentAbortRef.current = undefined; setSdkDocument(undefined);
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.source-textarea')?.focus());
  };
  useEffect(() => () => sdkDocumentAbortRef.current?.abort(), []);
  const replaceAllProjectMatches = (query: string, replacement: string, options: ProjectSearchOptions, fileIds: string[]) => {
    try {
      const targetIds = new Set(fileIds);
      const result = replaceProjectMatches(project.files.filter((file) => targetIds.has(file.id)), query, replacement, options);
      if (!result.replacements) return 0;
      const replacements = new Map(result.files.map((file) => [file.id, file]));
      setProject((current) => ({ ...current, files: current.files.map((file) => replacements.get(file.id) ?? file) }));
      setNotice(`Replaced ${result.replacements} occurrence${result.replacements === 1 ? '' : 's'} across ${result.changedFiles} file${result.changedFiles === 1 ? '' : 's'}`);
      return result.replacements;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      return 0;
    }
  };

  const activeBuildTarget = project.buildTargets.find((target) => target.id === project.activeBuildTargetId) ?? project.buildTargets[0]!;
  const backgroundBuildContextIdentity = useMemo(() => JSON.stringify({ target: activeBuildTarget, files: project.files.map(({ id, name, language, content }) => ({ id, name, language, content })), platformClass, machineId: machine.id, variant: resolved.variant, romId: resolved.rom.id, enabledCapabilities }), [activeBuildTarget, enabledCapabilities, machine.id, platformClass, project.files, resolved.rom.id, resolved.variant]);
  const backgroundBuildContextRef = useRef(backgroundBuildContextIdentity);
  backgroundBuildContextRef.current = backgroundBuildContextIdentity;
  const updateBuildTarget = (id: string, update: Partial<BuildTarget>) => setProject((current) => ({ ...current, buildTargets: current.buildTargets.map((target) => target.id === id ? { ...target, ...update } : target) }));
  const retainBuildArtifact = (target: BuildTarget, artifact: BuildArtifact, metadata: BuildResultMetadata) => setRetainedArtifacts((current) => [{ targetId: target.id, targetName: target.name, artifact, metadata, builtAt: Date.now() }, ...current.filter((item) => item.targetId !== target.id)]);
  const selectBuildTarget = (id: string) => {
    setProject((current) => ({ ...current, activeBuildTargetId: id }));
    setBuildFailureMetadata(null);
    const retained = retainedArtifacts.find((record) => record.targetId === id);
    const response = buildAllRecords.find((record) => record.targetId === id)?.response;
    const failure = buildAllRecords.find((record) => record.targetId === id)?.failure;
    if (retained) { setBuildArtifact(retained.artifact); setBuildResultMetadata(retained.metadata); setBuildFailureMetadata(null); }
    else if (response) { setBuildArtifact(response.artifact); setBuildResultMetadata(response.metadata); setBuildFailureMetadata(null); }
    else if (failure) setBuildFailureMetadata(failure);
  };
  const addBuildTarget = () => {
    const file = project.files.find((candidate) => candidate.id === activeFileId && (candidate.language === '6502' || candidate.language === 'bbc-basic' || candidate.language === 'arm' || (candidate.language === 'c' && /\.c$/i.test(candidate.name))));
    if (!file) { setNotice('Select BBC BASIC, 6502/ARM assembly, or a .c translation unit before adding a target'); return; }
    const created = createBuildTarget(file);
    const target = file.language === 'bbc-basic' && machine.id === 'atom' ? { ...created, ...buildToolchainUpdate('8bit-net.basic.atom'), outputName: created.outputName.replace(/\.bbc$/i, '.atom.txt') } : created;
    setProject((current) => ({ ...current, buildTargets: [...current.buildTargets, target], activeBuildTargetId: target.id }));
    setNotice(`Build target ${target.name} added`);
  };
  const deleteBuildTarget = () => {
    if (project.buildTargets.length === 1) { setNotice('A project must retain at least one build target'); return; }
    const remaining = project.buildTargets.filter((target) => target.id !== activeBuildTarget.id);
    setProject((current) => { const { [activeBuildTarget.id]: _removedArmBreakpoints, ...armBreakpoints } = current.armBreakpoints; const { [activeBuildTarget.id]: _removedArmBreakpointGroups, ...armBreakpointGroups } = current.armBreakpointGroups; const { [activeBuildTarget.id]: _removed6502Breakpoints, ...breakpoints6502 } = current.breakpoints6502; const { [activeBuildTarget.id]: _removed6502Groups, ...breakpointGroups6502 } = current.breakpointGroups6502; return { ...current, buildTargets: remaining, activeBuildTargetId: remaining[0]!.id, testPlans: current.testPlans.filter((plan) => plan.targetId !== activeBuildTarget.id), armBreakpoints, armBreakpointGroups, breakpoints6502, breakpointGroups6502 }; });
    setRetainedArtifacts((current) => current.filter((item) => item.targetId !== activeBuildTarget.id));
    setBuildArtifact(null);
    setBuildResultMetadata(null);
    setBuildFailureMetadata(null);
    setNotice(`${activeBuildTarget.name} removed`);
  };
  const addTestPlan = () => {
    const plan: TargetTestPlan = { schemaVersion: 2, id: crypto.randomUUID(), targetId: activeBuildTarget.id, name: `${activeBuildTarget.name} hardware test`, suite: 'Default', setup: { reset: 'hard', media: 'retain' }, inputs: [], stop: 'done', assertions: 'X = 5\nPC = done', screenGoldens: [], cycleBudget: 100_000, captures: [{ id: crypto.randomUUID(), kind: 'registers' }], teardown: { action: 'pause' }, enabled: true };
    setProject((current) => ({ ...current, testPlans: [...current.testPlans, plan] })); setNotice(`Test plan ${plan.name} added`);
  };
  const updateTestPlan = (id: string, update: Partial<TargetTestPlan>) => setProject((current) => ({ ...current, testPlans: current.testPlans.map((plan) => plan.id === id ? { ...plan, ...update } : plan) }));
  const removeTestPlan = (id: string) => setProject((current) => ({ ...current, testPlans: current.testPlans.filter((plan) => plan.id !== id) }));

  const appendBuildLog = (activity: BuildActivity, diagnostics = 0, fingerprint?: string) => {
    setBuildHistory((current) => [{ ...activity, diagnostics, fingerprint }, ...current].slice(0, 50));
  };
  const cancelBackgroundBuild = (message = 'Build cancelled by user') => {
    const active = buildWorkerRef.current;
    const queued = buildTimerRef.current;
    const native = nativeBuildAbortRef.current;
    if (!active && !queued && !native) return false;
    if (native) { native.abort(); nativeBuildAbortRef.current = undefined; }
    if (active) { active.worker.terminate(); buildWorkerRef.current = undefined; }
    if (queued) { window.clearTimeout(queued.timer); buildTimerRef.current = undefined; }
    const finishedAt = Date.now();
    const activity: BuildActivity = { requestId: active?.requestId ?? queued?.requestId ?? buildRequestSequenceRef.current, status: 'cancelled', trigger: active?.trigger ?? queued?.trigger ?? 'manual', targetName: active?.targetName ?? queued?.targetName ?? activeBuildTarget.name, message, startedAt: active?.startedAt, finishedAt };
    setBuildActivity(activity); appendBuildLog(activity); setNotice(message);
    return true;
  };
  const selectedMachineTarget = (): ProjectTarget => ({ platformClass, machineId: machine.id, variant: resolved.variant, romId: resolved.rom.id, enabledCapabilities: [...enabledCapabilities] });
  const requestFor = (target: BuildTarget): BuildRequest => ({ target: structuredClone(target), targets: structuredClone(project.buildTargets), files: structuredClone(project.files), machine: { id: machine.id, cpu: machine.cpu }, machineTarget: selectedMachineTarget() });

  const cancelBuildAll = () => {
    if (!buildAllAbortRef.current) return;
    buildAllAbortRef.current.abort();
    buildAllWorkersRef.current.forEach((worker) => worker.terminate()); buildAllWorkersRef.current.clear();
    buildAllAbortRef.current = undefined; setNotice('Build-all cancelled');
  };
  const runBuildAll = async () => {
    cancelBackgroundBuild('Automatic build superseded by build all'); cancelBuildAll();
    const controller = new AbortController(); buildAllAbortRef.current = controller; setWorkspaceTab('Build targets');
    setNotice(`Build all started · ${project.buildTargets.length} targets · maximum 2 workers`);
    const workerExecute = (target: BuildTarget, dependencies: BuildResponse[], signal?: AbortSignal) => {
      const dependencyInputIds = Array.from(new Set(dependencies.flatMap((response) => response.artifact.provenance?.inputs.map((input) => input.id) ?? [])));
      if (toolchainFor(target.toolchainId)?.execution === 'server-native') return invokeNativeToolchain({ ...requestFor(target), preparedDependencyInputIds: dependencyInputIds }, signal);
      return new Promise<BuildResponse>((resolve, reject) => {
      const worker = new Worker(new URL('./build/build.worker.ts', import.meta.url), { type: 'module', name: `build-all-${target.id}` });
      buildAllWorkersRef.current.add(worker);
      const finish = () => { worker.terminate(); buildAllWorkersRef.current.delete(worker); };
      const abort = () => { finish(); reject(new DOMException('Build all cancelled', 'AbortError')); };
      signal?.addEventListener('abort', abort, { once: true });
      worker.onerror = (event) => { signal?.removeEventListener('abort', abort); finish(); reject(new Error(event.message || 'Build worker failed')); };
      worker.onmessage = (event: MessageEvent<BuildWorkerMessage>) => { signal?.removeEventListener('abort', abort); finish(); event.data.ok ? resolve(event.data.response) : reject(event.data.result ? new BuildExecutionError(event.data.error, event.data.result) : new Error(event.data.error)); };
      worker.postMessage({ requestId: ++buildRequestSequenceRef.current, request: { ...requestFor(target), preparedDependencyInputIds: dependencyInputIds } });
      });
    };
    try {
      const records = await executeBuildAll(project.buildTargets, workerExecute, { concurrency: 2, signal: controller.signal, onUpdate: setBuildAllRecords });
      if (buildAllAbortRef.current !== controller) return;
      const succeeded = records.filter((record) => record.status === 'succeeded').length; const failed = records.filter((record) => record.status === 'failed').length; const skipped = records.filter((record) => record.status === 'skipped').length;
      const activeRecord = records.find((record) => record.targetId === project.activeBuildTargetId); const active = activeRecord?.response;
      if (active) { setBuildArtifact(active.artifact); setBuildResultMetadata(active.metadata); setBuildFailureMetadata(null); }
      else if (activeRecord?.failure) setBuildFailureMetadata(activeRecord.failure);
      setRetainedArtifacts((current) => [...records.flatMap((record) => record.response ? [{ targetId: record.targetId, targetName: record.targetName, artifact: record.response.artifact, metadata: record.response.metadata, builtAt: record.finishedAt ?? Date.now() }] : []), ...current.filter((item) => !records.some((record) => record.targetId === item.targetId))]);
      records.filter((record) => record.finishedAt).forEach((record) => appendBuildLog({ requestId: ++buildRequestSequenceRef.current, status: record.status === 'skipped' ? 'failed' : record.status === 'running' ? 'building' : record.status, trigger: 'manual', targetName: record.targetName, message: record.message, startedAt: record.startedAt, finishedAt: record.finishedAt }, record.response?.artifact.diagnostics.length ?? 0, record.response?.artifact.provenance?.fingerprint));
      setNotice(`Build all finished · ${succeeded} succeeded · ${failed} failed · ${skipped} skipped`);
      return records;
    } catch (error) { setNotice(`Build all not started · ${error instanceof Error ? error.message : String(error)}`); return [] as BuildAllRecord[]; }
    finally { if (buildAllAbortRef.current === controller) buildAllAbortRef.current = undefined; buildAllWorkersRef.current.clear(); }
  };

  const startBackgroundBuild = async (trigger: Extract<BuildTrigger, 'on-save' | 'live'>, requestId: number) => {
    if (artifactPinned) return;
    if (buildTimerRef.current?.requestId === requestId) buildTimerRef.current = undefined;
    const target = project.buildTargets.find((candidate) => candidate.id === project.activeBuildTargetId) ?? project.buildTargets[0]!;
    const file = project.files.find((candidate) => candidate.id === target.entryFileId);
    const targetErrors = validateBuildTarget(target, project.files, machine, project.buildTargets, nativeToolchainIds.has(target.toolchainId));
    if (!file || targetErrors.length) {
      const finishedAt = Date.now(); const message = targetErrors[0] ?? 'The selected build target has no entry file';
      const activity: BuildActivity = { requestId, status: 'failed', trigger, targetName: target.name, message, startedAt: finishedAt, finishedAt };
      setBuildFailureMetadata(buildExecutionError(requestFor(target), 'invalid-configuration', message).result);
      setBuildActivity(activity); appendBuildLog(activity); setNotice(`${trigger === 'live' ? 'Live' : 'On-save'} build not started · ${message}`);
      return;
    }
    cancelBackgroundBuild('Earlier automatic build superseded');
    const startedAt = Date.now();
    if (toolchainFor(target.toolchainId)?.execution === 'server-native') {
      const controller = new AbortController(); nativeBuildAbortRef.current = controller;
      setBuildActivity({ requestId, status: 'building', trigger, targetName: target.name, message: 'Running isolated native build', startedAt });
      try {
        const { artifact, errors, metadata } = await invokeNativeToolchain(requestFor(target), controller.signal);
        if (nativeBuildAbortRef.current !== controller) return;
        nativeBuildAbortRef.current = undefined; const finishedAt = Date.now();
        setBuildArtifact(artifact); setBuildResultMetadata(metadata); setBuildFailureMetadata(null); retainBuildArtifact(target, artifact, metadata); setRuntimeState(null);
        const message = errors ? `${errors} errors` : `${artifact.bytes.length} bytes · ${artifact.provenance?.fingerprint ?? 'no fingerprint'}`;
        const activity: BuildActivity = { requestId, status: errors ? 'failed' : 'succeeded', trigger, targetName: target.name, message, startedAt, finishedAt };
        setBuildActivity(activity); appendBuildLog(activity, artifact.diagnostics.length, artifact.provenance?.fingerprint); setNotice(`Native background build ${errors ? 'failed' : 'completed'} · ${message}`);
      } catch (error) {
        if (controller.signal.aborted) return;
        nativeBuildAbortRef.current = undefined; const finishedAt = Date.now(); const message = error instanceof Error ? error.message : String(error);
        const activity: BuildActivity = { requestId, status: 'failed', trigger, targetName: target.name, message, startedAt, finishedAt };
        if (error instanceof BuildExecutionError) setBuildFailureMetadata(error.result);
        setBuildActivity(activity); appendBuildLog(activity); setNotice(`Native background build failed · ${message}`);
      }
      return;
    }
    const worker = new Worker(new URL('./build/build.worker.ts', import.meta.url), { type: 'module', name: `build-${target.id}` });
    const contextIdentity = backgroundBuildContextIdentity;
    buildWorkerRef.current = { worker, requestId, trigger, targetName: target.name, startedAt, contextIdentity };
    setBuildActivity({ requestId, status: 'building', trigger, targetName: target.name, message: `Running ${trigger === 'live' ? 'live' : 'on-save'} build in an isolated worker`, startedAt });
    const fail = (message: string, result?: BuildResultMetadata) => {
      if (buildWorkerRef.current?.requestId !== requestId) return;
      worker.terminate(); buildWorkerRef.current = undefined;
      const finishedAt = Date.now(); const activity: BuildActivity = { requestId, status: 'failed', trigger, targetName: target.name, message, startedAt, finishedAt };
      if (result) setBuildFailureMetadata(result);
      setBuildActivity(activity); appendBuildLog(activity); setNotice(`Background build failed · ${message}`);
    };
    worker.onerror = (event) => fail(event.message || 'Build worker failed');
    worker.onmessage = (event: MessageEvent<BuildWorkerMessage>) => {
      if (event.data.requestId !== requestId || buildWorkerRef.current?.requestId !== requestId) return;
      if (backgroundBuildContextRef.current !== contextIdentity) { cancelBackgroundBuild('Completed build discarded because its source or target state was superseded'); return; }
      if (!event.data.ok) { fail(event.data.error, event.data.result); return; }
      worker.terminate(); buildWorkerRef.current = undefined;
      const { artifact, errors, metadata } = event.data.response; const finishedAt = Date.now();
      setBuildArtifact(artifact); setBuildResultMetadata(metadata); setBuildFailureMetadata(null); retainBuildArtifact(target, artifact, metadata); setRuntimeState(null);
      const message = errors ? `${errors} error${errors === 1 ? '' : 's'} · artifact is not runnable` : `${artifact.bytes.length} bytes · ${artifact.provenance?.fingerprint ?? 'no fingerprint'}`;
      const activity: BuildActivity = { requestId, status: errors ? 'failed' : 'succeeded', trigger, targetName: target.name, message, startedAt, finishedAt };
      setBuildActivity(activity); appendBuildLog(activity, artifact.diagnostics.length, artifact.provenance?.fingerprint);
      setNotice(`${trigger === 'live' ? 'Live' : 'On-save'} build ${errors ? 'failed' : 'completed'} · ${message}`);
    };
    worker.postMessage({ requestId, request: requestFor(target) });
  };

  const buildActiveSource = async (destination: 'Build targets' | 'Debugger' | 'Tests' | 'run' = 'Build targets', cacheMode: BuildRequest['cacheMode'] = 'use') => {
    cancelBackgroundBuild('Automatic build superseded by explicit command');
    const target = project.buildTargets.find((candidate) => candidate.id === project.activeBuildTargetId) ?? project.buildTargets[0]!;
    const file = project.files.find((candidate) => candidate.id === target.entryFileId);
    const targetErrors = validateBuildTarget(target, project.files, machine, project.buildTargets, nativeToolchainIds.has(target.toolchainId));
    const requestId = ++buildRequestSequenceRef.current;
    const trigger: BuildTrigger = destination === 'run' ? 'run' : destination === 'Debugger' ? 'debug' : destination === 'Tests' ? 'test' : 'manual';
    if (!file || targetErrors.length) {
      const finishedAt = Date.now(); const message = targetErrors[0] ?? 'The selected build target has no entry file';
      const activity: BuildActivity = { requestId, status: 'failed', trigger, targetName: target.name, message, startedAt: finishedAt, finishedAt };
      setBuildArtifact(null); setBuildResultMetadata(null); setBuildFailureMetadata(buildExecutionError(requestFor(target), 'invalid-configuration', message).result); setWorkspaceTab('Build targets'); setBuildActivity(activity); appendBuildLog(activity); setNotice(message);
      return null;
    }
    const startedAt = Date.now();
    setBuildActivity({ requestId, status: 'building', trigger, targetName: target.name, message: 'Running foreground build', startedAt });
    let response;
    try {
      if (toolchainFor(target.toolchainId)?.execution === 'server-native') {
        const controller = new AbortController(); nativeBuildAbortRef.current = controller;
        response = await invokeNativeToolchain({ ...requestFor(target), cacheMode }, controller.signal);
        if (nativeBuildAbortRef.current !== controller) return null;
        nativeBuildAbortRef.current = undefined;
      } else response = executeBuild({ ...requestFor(target), cacheMode });
    }
    catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return null;
      const finishedAt = Date.now(); const message = error instanceof Error ? error.message : String(error);
      const activity: BuildActivity = { requestId, status: 'failed', trigger, targetName: target.name, message, startedAt, finishedAt };
      if (error instanceof BuildExecutionError) setBuildFailureMetadata(error.result);
      setBuildActivity(activity); appendBuildLog(activity); setNotice(`Build failed · ${message}`); setWorkspaceTab('Build targets'); return null;
    }
    const { artifact, errors, metadata } = response;
    setBuildArtifact(artifact); setBuildResultMetadata(metadata); setBuildFailureMetadata(null); retainBuildArtifact(target, artifact, metadata);
    if (artifact.kind !== '6502-binary') setRuntimeState(null);
    const finishedAt = Date.now(); const message = errors ? `${errors} error${errors === 1 ? '' : 's'}` : `${artifact.bytes.length} bytes · ${artifact.provenance?.fingerprint ?? 'no fingerprint'}`;
    const activity: BuildActivity = { requestId, status: errors ? 'failed' : 'succeeded', trigger, targetName: target.name, message, startedAt, finishedAt };
    setBuildActivity(activity); appendBuildLog(activity, artifact.diagnostics.length, artifact.provenance?.fingerprint);
    if (errors) {
      setWorkspaceTab('Build targets'); setNotice(`Build failed · ${artifact.diagnostics.length} diagnostic${artifact.diagnostics.length === 1 ? '' : 's'}`);
      return null;
    }
    if (artifact.kind === '6502-binary') {
      runtimeRef.current.load(artifact);
      resolveSourceBreakpointAddresses(artifact).forEach((address) => runtimeRef.current.setBreakpoint(address));
      const snapshot = runtimeRef.current.snapshot();
      setRuntimeState(snapshot);
    }
    if (destination !== 'run' && artifact.kind === '6502-binary') setWorkspaceTab(destination);
    else if (destination === 'Build targets') setWorkspaceTab('Build targets');
    if (artifact.kind === 'arm-binary' && (destination === 'run' || destination === 'Debugger') && (!romReady || !archimedesRuntime)) {
      setWorkspaceTab('Build targets');
      setNotice('Supply the qualified A310 firmware in Settings before loading this raw ARM2 debug image');
      return artifact;
    }
    if (!isMachineCodeArtifact(artifact) && (destination === 'run' || destination === 'Debugger')) {
      if (romUnavailableReason) { setNotice(romUnavailableReason); return null; }
      if (!romReady || !machineRomSet) { setNotice(`Supply the selected ROM set in Settings before running ${artifact.dialect}`); return null; }
      queueMachineCommand({ type: 'load-basic', format: artifact.kind, bytes: Array.from(artifact.bytes), autorun: true, programLoadDraft: buildBasicProgramLoadDraft(artifact, destination === 'Debugger' ? 'debug' : 'run') });
      if (destination === 'Debugger') setWorkspaceTab('Debugger');
      setNotice(`Loaded ${file.name} into ${machine.label} · ${destination === 'Debugger' ? 'hardware debugger attached' : 'RUN queued'}`);
    } else if (artifact.kind === '6502-binary') setNotice(`Built ${target.name} · ${artifact.bytes.length} bytes at ${formatAddress(artifact.origin)} · ${artifact.provenance!.fingerprint}`);
    else if (artifact.kind === 'arm-binary') setNotice(`Built ${target.name} · ${artifact.bytes.length} ARM2 bytes at ${formatAddress(artifact.origin, 8)} · raw machine code, not yet a RISC OS application`);
    else setNotice(`Built ${file.name} · ${artifact.lineCount} lines · ${artifact.bytes.length} ${artifact.kind === 'atom-basic-text' ? 'ASCII source' : 'tokenized'} bytes`);
    return artifact;
  };

  useEffect(() => {
    if (!policyBuildRequest || !shouldScheduleBackgroundBuild(activeBuildTarget, 'save', policyBuildRequest.fileId, artifactPinned, sourceInputsForTarget(activeBuildTarget, project.files))) return;
    const requestId = ++buildRequestSequenceRef.current;
    setBuildActivity({ requestId, status: 'queued', trigger: 'on-save', targetName: activeBuildTarget.name, message: 'Waiting for the explicit-save build worker' });
    const timer = window.setTimeout(() => { startBackgroundBuild('on-save', requestId); }, 0);
    buildTimerRef.current = { timer, requestId, trigger: 'on-save', targetName: activeBuildTarget.name };
    return () => { window.clearTimeout(timer); if (buildTimerRef.current?.requestId === requestId) buildTimerRef.current = undefined; if (buildWorkerRef.current?.requestId === requestId) cancelBackgroundBuild('On-save build superseded'); };
  }, [policyBuildRequest?.sequence]);

  useEffect(() => {
    if (!shouldScheduleBackgroundBuild(activeBuildTarget, 'change', '*', artifactPinned)) return;
    const requestId = ++buildRequestSequenceRef.current;
    setBuildActivity({ requestId, status: 'queued', trigger: 'live', targetName: activeBuildTarget.name, message: 'Waiting for the 650 ms live-build debounce' });
    const timer = window.setTimeout(() => { startBackgroundBuild('live', requestId); }, 650);
    buildTimerRef.current = { timer, requestId, trigger: 'live', targetName: activeBuildTarget.name };
    return () => { window.clearTimeout(timer); if (buildTimerRef.current?.requestId === requestId) buildTimerRef.current = undefined; if (buildWorkerRef.current?.requestId === requestId) cancelBackgroundBuild('Live build superseded by newer source or target state'); };
  }, [activeBuildTarget, project.files, platformClass, machine.id, resolved.variant, resolved.rom.id, enabledCapabilities, artifactPinned]);

  useEffect(() => () => { if (buildTimerRef.current) window.clearTimeout(buildTimerRef.current.timer); buildWorkerRef.current?.worker.terminate(); buildTimerRef.current = undefined; buildWorkerRef.current = undefined; }, []);

  const runProgram = async () => {
    const artifact = await buildActiveSource('run');
    if (!artifact) return;
    if (artifact.kind !== '6502-binary') return;
    if (romReady && machineRomSet) {
      const breakpoints = resolveSourceBreakpointAddresses(artifact);
      queueMachineCommand({ type: 'load-machine-code', bytes: Array.from(artifact.bytes), origin: artifact.origin, entryPoint: artifact.entryPoint, autorun: true, breakpoints, sourceLocations: artifact.sourceLocations, symbols: artifact.symbols, programLoadDraft: buildProgramLoadDraft(artifact, 'run') });
      setNotice(`Loading ${artifact.bytes.length} assembled bytes into ${machine.label} at ${formatAddress(artifact.origin)}`);
      return;
    }
    const state = runtimeRef.current.run();
    setRuntimeState(state);
    setNotice(`${state.status} · ${state.reason}`);
  };

  const startDebugger = async (retainedArtifact?: BuildArtifact) => {
    const artifact = retainedArtifact ?? await buildActiveSource('Debugger');
    if (!artifact) return;
    if (!artifact.provenance || !isMachineCodeArtifact(artifact)) return;
    setWorkspaceTab('Debugger');
    const createdAt = new Date().toISOString();
    const selectedRomKeys = machineRomSet
      ? new Set(requiredRomRequirements(machineRomSet, enabledCapabilities).map((requirement) => romStorageKey(machineRomSet.id, requirement)))
      : archimedesRuntime
        ? new Set([archimedesCombinedRomKey(archimedesRuntime.profile), archimedesCmosKey(archimedesRuntime.profile)])
        : new Set<string>();
    const romPrefix = machineRomSet ? `${machineRomSet.id}/` : archimedesRuntime ? `archimedes/${archimedesRuntime.profile.id}/` : '';
    const roms = romPrefix ? (await listRoms(romPrefix)).filter((rom) => selectedRomKeys.has(rom.key)).sort((left, right) => left.key.localeCompare(right.key)) : [];
    const adapter = archimedesRuntime
      ? { id: 'arculator-wasm' as const, version: '579ac437b9a4ebe83b9b5f9b8e50b0c9c530509e' }
      : machineRomSet
        ? { id: 'jsbeeb' as const, version: machineRomSet.engine.version }
        : { id: 'romless-6502' as const, version: '1' };
    setDebugSession(createDebugSession({
      id: crypto.randomUUID(), createdAt,
      build: { targetId: activeBuildTarget.id, targetName: activeBuildTarget.name, fingerprint: artifact.provenance.fingerprint, outputSha256: artifact.provenance.output.sha256, outputBytes: artifact.provenance.output.bytes, toolchainId: artifact.provenance.toolchain.id, toolchainVersion: artifact.provenance.toolchain.version },
      machineTarget: artifact.provenance.machineTarget,
      adapter,
      roms: roms.map(({ key, filename, size, sha256 }) => ({ key, filename, size, sha256 })),
      runProfile: { mode: 'debug', processor: artifact.processor, origin: artifact.origin, entryPoint: artifact.entryPoint, romSetId: machineRomSet?.id ?? archimedesRuntime?.profile.id ?? null, capabilities: [...artifact.provenance.machineTarget.enabledCapabilities] },
    }));
    if (artifact.kind === 'arm-binary' && romReady && archimedesRuntime) {
      const breakpoints = resolveSourceBreakpointAddresses(artifact);
      queueMachineCommand({ type: 'load-arm-program', bytes: Array.from(artifact.bytes), origin: artifact.origin, entryPoint: artifact.entryPoint, autorun: false, breakpoints, sourceLocations: artifact.sourceLocations, programLoadDraft: buildProgramLoadDraft(artifact, 'debug') });
      setWorkspaceTab('Debugger');
      setNotice(`Live ARM2 debug image loading at ${formatAddress(artifact.entryPoint, 8)} · ${breakpoints.length} source breakpoint${breakpoints.length === 1 ? '' : 's'} resolved`);
      return;
    }
    if (artifact.kind === '6502-binary' && romReady && machineRomSet) {
      const breakpoints = resolveSourceBreakpointAddresses(artifact);
      queueMachineCommand({ type: 'load-machine-code', bytes: Array.from(artifact.bytes), origin: artifact.origin, entryPoint: artifact.entryPoint, autorun: false, breakpoints, sourceLocations: artifact.sourceLocations, symbols: artifact.symbols, programLoadDraft: buildProgramLoadDraft(artifact, 'debug') });
      setNotice(`Hardware debug session loading at ${formatAddress(artifact.entryPoint)} · ${breakpoints.length} source breakpoint${breakpoints.length === 1 ? '' : 's'} resolved`);
    } else if (artifact.kind === '6502-binary') setNotice('ROM-less debug session ready at the program entry point');
  };

  const stepProgram = () => { const state = runtimeRef.current.step(); setRuntimeState(state); setNotice(`${state.status} · ${state.reason}`); };
  const resetProgram = () => { const state = runtimeRef.current.reset(); setRuntimeState(state); setNotice(state.reason); };
  const continueProgram = () => { const state = runtimeRef.current.run(); setRuntimeState(state); setNotice(`${state.status} · ${state.reason}`); };
  const stopDebugSession = () => {
    if (!debugSession) return;
    if (debugSession.binding.adapter.id === 'romless-6502') updateDebugLifecycle('terminated', 'Operator stopped the ROM-less debug session');
    else queueDebugMachineCommand({ type: 'stop' });
    setNotice('Debug session terminated · the attached machine is paused and the immutable session record is retained');
  };

  useEffect(() => {
    if (!debugSession || ['terminated', 'crashed', 'disconnected'].includes(debugSession.lifecycle)) return;
    const snapshot = debugSession.binding.adapter.id === 'arculator-wasm' ? archimedesState : debugSession.binding.adapter.id === 'jsbeeb' ? hardwareState : null;
    if (!snapshot) return;
    const pc = 'pc' in snapshot ? snapshot.pc : snapshot.registers.pc;
    if (debugSession.lifecycle === 'starting' && (pc < debugSession.binding.runProfile.origin || pc >= debugSession.binding.runProfile.origin + debugSession.binding.build.outputBytes)) return;
    updateDebugLifecycle(lifecycleForSnapshot(snapshot.running), snapshot.reason || (snapshot.running ? 'Adapter reports running' : 'Adapter reports paused'));
  }, [archimedesState, hardwareState, debugSession?.binding.adapter.id, debugSession?.lifecycle, updateDebugLifecycle]);

  useEffect(() => {
    if (!debugSession || ['terminated', 'crashed', 'disconnected'].includes(debugSession.lifecycle)) return;
    const target = debugSession.binding.machineTarget;
    if (target.machineId !== machine.id || target.variant !== resolved.variant || target.romId !== resolved.rom.id || (debugSession.binding.adapter.id !== 'romless-6502' && !romReady)) {
      updateDebugLifecycle('disconnected', 'The selected machine or qualified ROM connection no longer matches this immutable session');
    }
  }, [debugSession?.binding.machineTarget.machineId, debugSession?.binding.machineTarget.variant, debugSession?.binding.machineTarget.romId, debugSession?.binding.adapter.id, debugSession?.lifecycle, machine.id, resolved.rom.id, resolved.variant, romReady, updateDebugLifecycle]);
  const runHardwareTest = async (configuration: { name: string; stop: string; assertions: string; cycleBudget: number }) => {
    const artifact = await buildActiveSource('Tests');
    if (!artifact || artifact.kind !== '6502-binary') { setHardwareTest({ name: configuration.name, status: 'error', reason: 'Hardware tests currently require a successful 6502/65C12 assembly build', cycles: 0, assertions: [] }); return; }
    if (!romReady || !machineRomSet) { setHardwareTest({ name: configuration.name, status: 'error', reason: 'Supply the selected machine ROM set before running a hardware test', cycles: 0, assertions: [] }); return; }
    const targetPlan = 'captures' in configuration ? configuration as TargetTestPlan : undefined;
    const plan = parseTestPlan(configuration.stop, configuration.assertions, artifact.symbols, targetPlan?.screenGoldens ?? []);
    if (plan.errors.length || plan.stopAddress === null) { setHardwareTest({ name: configuration.name, status: 'error', reason: plan.errors.join(' · '), cycles: 0, assertions: [] }); return; }
    if (!Number.isInteger(configuration.cycleBudget) || configuration.cycleBudget < 100 || configuration.cycleBudget > 10_000_000) { setHardwareTest({ name: configuration.name, status: 'error', reason: 'Cycle budget must be between 100 and 10,000,000', cycles: 0, assertions: [] }); return; }
    const captures: Array<{ id: string; kind: 'registers' } | { id: string; kind: 'memory'; address: number; length: number }> = [];
    for (const capture of targetPlan?.captures ?? []) { if (capture.kind === 'registers') captures.push({ id: capture.id, kind: 'registers' }); else { const address = resolveTestValue(capture.address, artifact.symbols); if (address !== null) captures.push({ id: capture.id, kind: 'memory', address, length: capture.length }); } }
    if (captures.length !== (targetPlan?.captures.length ?? 0)) { setHardwareTest({ name: configuration.name, status: 'error', reason: 'A capture address is not a current build symbol or 16-bit address', cycles: 0, assertions: [] }); return; }
    setHardwareTest({ name: configuration.name, status: 'running', reason: `Loading build and running to ${formatAddress(plan.stopAddress)}`, cycles: 0, stopAddress: plan.stopAddress, assertionCount: plan.assertions.length, cycleBudget: configuration.cycleBudget, assertions: [] });
    queueMachineCommand({ type: 'run-test', name: configuration.name, processor: plan.processor, planId: targetPlan?.id, suite: targetPlan?.suite, buildFingerprint: artifact.provenance?.fingerprint, programLoadDraft: buildProgramLoadDraft(artifact, 'test'), requestId: crypto.randomUUID(), bytes: Array.from(artifact.bytes), origin: artifact.origin, entryPoint: artifact.entryPoint, stopAddress: plan.stopAddress, cycleBudget: configuration.cycleBudget, assertions: plan.assertions, setup: targetPlan?.setup ?? { reset: 'hard', media: 'retain' }, inputs: targetPlan?.inputs ?? [], captures, teardown: targetPlan?.teardown.action ?? 'pause' });
    setNotice(`Hardware test ${configuration.name} queued · ${plan.assertions.length} assertion${plan.assertions.length === 1 ? '' : 's'}`);
  };
  const cancelTestAll = () => {
    const controller = testAllAbortRef.current; if (!controller) return;
    controller.abort(); cancelBuildAll(); testAllAbortRef.current = undefined;
    testResultWaiterRef.current?.reject(new DOMException('Test all cancelled', 'AbortError')); testResultWaiterRef.current = undefined;
    queueMachineCommand({ type: 'pause' }); setNotice('Test all cancelled and emulator paused');
  };
  const runTestAll = async () => {
    if (!romReady || !machineRomSet) { setNotice('Supply the selected machine ROM set before running test all'); return; }
    const enabledPlans = project.testPlans.filter((plan) => plan.enabled && project.buildTargets.some((target) => target.id === plan.targetId && project.files.find((file) => file.id === target.entryFileId)?.language === '6502'));
    if (!enabledPlans.length) { setNotice('No enabled 6502/65C12 test plans are available'); return; }
    cancelTestAll(); const controller = new AbortController(); testAllAbortRef.current = controller;
    setTestAllRecords(enabledPlans.map((plan) => ({ planId: plan.id, targetId: plan.targetId, name: plan.name, status: 'queued', message: 'Waiting for build' })));
    const builds = await runBuildAll(); setWorkspaceTab('Tests'); if (!builds || controller.signal.aborted) { setTestAllRecords((current) => current.map((record) => ['queued', 'running'].includes(record.status) ? { ...record, status: 'cancelled', message: 'Cancelled before execution' } : record)); return; }
    const graphOrder = analyseBuildGraph(project.buildTargets).order;
    const orderedPlans = [...enabledPlans].sort((left, right) => graphOrder.indexOf(left.targetId) - graphOrder.indexOf(right.targetId));
    const update = (planId: string, value: Partial<TestAllRecord>) => setTestAllRecords((current) => current.map((record) => record.planId === planId ? { ...record, ...value } : record));
    for (const plan of orderedPlans) {
      if (controller.signal.aborted) { update(plan.id, { status: 'cancelled', message: 'Cancelled before execution' }); continue; }
      const build = builds.find((record) => record.targetId === plan.targetId);
      const artifact = build?.response?.artifact;
      if (build?.status !== 'succeeded' || artifact?.kind !== '6502-binary') { update(plan.id, { status: 'skipped', message: build ? `Build ${build.status}` : 'No build result' }); continue; }
      const parsed = parseTestPlan(plan.stop, plan.assertions, artifact.symbols);
      if (parsed.errors.length || parsed.stopAddress === null || !Number.isInteger(plan.cycleBudget) || plan.cycleBudget < 100 || plan.cycleBudget > 10_000_000) { update(plan.id, { status: 'error', message: parsed.errors.join(' · ') || 'Cycle budget must be between 100 and 10,000,000' }); continue; }
      const requestId = crypto.randomUUID(); update(plan.id, { status: 'running', message: `Executing to ${formatAddress(parsed.stopAddress)}` });
      try {
        const result = await new Promise<MachineTestResult>((resolve, reject) => {
          const timer = window.setTimeout(() => { if (testResultWaiterRef.current?.requestId === requestId) testResultWaiterRef.current = undefined; reject(new Error('Emulator result channel timed out')); }, 120_000);
          testResultWaiterRef.current = { requestId, resolve: (value) => { window.clearTimeout(timer); resolve(value); }, reject: (error) => { window.clearTimeout(timer); reject(error); } };
          const captures: Array<{ id: string; kind: 'registers' } | { id: string; kind: 'memory'; address: number; length: number }> = [];
          for (const capture of plan.captures) { if (capture.kind === 'registers') captures.push({ id: capture.id, kind: 'registers' }); else { const address = resolveTestValue(capture.address, artifact.symbols); if (address !== null) captures.push({ id: capture.id, kind: 'memory', address, length: capture.length }); } }
          if (captures.length !== plan.captures.length) { window.clearTimeout(timer); testResultWaiterRef.current = undefined; reject(new Error('A capture address is not a current build symbol or 16-bit address')); return; }
          queueMachineCommand({ type: 'run-test', name: plan.name, processor: parsed.processor, planId: plan.id, suite: plan.suite, buildFingerprint: artifact.provenance?.fingerprint, programLoadDraft: buildProgramLoadDraft(artifact, 'test'), requestId, bytes: Array.from(artifact.bytes), origin: artifact.origin, entryPoint: artifact.entryPoint, stopAddress: parsed.stopAddress, cycleBudget: plan.cycleBudget, assertions: parsed.assertions, setup: plan.setup, inputs: plan.inputs, captures, teardown: plan.teardown.action });
        });
        update(plan.id, { status: result.status, message: result.reason, result });
      } catch (error) { update(plan.id, { status: controller.signal.aborted ? 'cancelled' : 'error', message: error instanceof Error ? error.message : String(error) }); }
    }
    if (!controller.signal.aborted) { const results = await new Promise<TestAllRecord[]>((resolve) => setTestAllRecords((current) => { resolve(current); return current; })); const passed = results.filter((item) => item.status === 'passed').length; setNotice(`Test all finished · ${passed}/${results.length} passed`); }
    if (testAllAbortRef.current === controller) testAllAbortRef.current = undefined;
  };
  const toggleSourceBreakpoint = (fileId: string, line: number) => {
    setSourceBreakpoints((current) => {
      const existing = current[fileId] ?? [];
      return { ...current, [fileId]: existing.includes(line) ? existing.filter((item) => item !== line) : [...existing, line].sort((a, b) => a - b) };
    });
    setNotice(`Source breakpoint toggled at line ${line} · rebuild to resolve its address`);
  };

  const toggleConfigPanel = () => {
    const compact = window.matchMedia('(max-width: 900px)').matches;
    if (compact && !configOpen) {
      setExplorerOpen(false);
      setConfigOpen(true);
      return;
    }
    setConfigOpen(!configOpen);
  };

  const toggleExplorerPanel = () => {
    const compact = window.matchMedia('(max-width: 900px)').matches;
    if (compact && configOpen) {
      setConfigOpen(false);
      setExplorerOpen(true);
      return;
    }
    setExplorerOpen(!explorerOpen);
  };
  const openProjectSearch = () => {
    setWorkspaceTab('Search');
    if (window.matchMedia('(max-width: 900px)').matches) { setConfigOpen(false); setExplorerOpen(false); }
  };

  const activeSource = project.files.find((file) => file.id === activeFileId);
  const activePaneSource = activeSourcePane === 'secondary' && sourceSplitFileId ? project.files.find((file) => file.id === sourceSplitFileId) ?? activeSource : activeSource;
  const activeSourceLanguage = activeSource?.language === 'bbc-basic' && machine.id === 'atom' ? 'atom-basic' : activeSource?.language;
  const openSourceFiles = documents.openIds.flatMap((id) => { const file = project.files.find((candidate) => candidate.id === id); return file ? [file] : []; });
  const canReopenClosed = documents.recentlyClosed.some((id) => project.files.some((file) => file.id === id));
  const buildEntry = project.files.find((file) => file.id === activeBuildTarget.entryFileId);
  const buildTargetErrors = validateBuildTarget(activeBuildTarget, project.files, machine, project.buildTargets, nativeToolchainIds.has(activeBuildTarget.toolchainId));
  const canBuild = buildTargetErrors.length === 0;
  const selectedProjectTarget = { platformClass, machineId: machine.id, variant: resolved.variant, romId: resolved.rom.id, enabledCapabilities };
  const buildArtifactIsCurrent = !!buildArtifact?.provenance && provenanceMatches(buildArtifact.provenance, activeBuildTarget, selectedProjectTarget, project.files);
  const supportsBasicInjection = !!machineRomSet;
  const canRun = ((buildEntry?.language === '6502' || buildEntry?.language === 'c') && canBuild) || (buildEntry?.language === 'bbc-basic' && romReady && supportsBasicInjection && canBuild);
  const canDebug = canRun || (buildEntry?.language === 'arm' && romReady && !!archimedesRuntime && canBuild);
  const assemblyArtifact = buildArtifactIsCurrent && buildArtifact?.kind === '6502-binary' ? buildArtifact : null;
  const problemCount = buildArtifactIsCurrent ? buildArtifact?.diagnostics.length ?? 0 : 0;
  const latestMedia = hardwareMedia.at(-1);
  const findInCurrentFile = () => {
    setWorkspaceTab('Code');
    setSourceCommand((current) => ({ type: 'find', sequence: (current?.sequence ?? 0) + 1 }));
  };
  const openHelp = (topicId = 'first-run') => {
    window.location.hash = `help/${topicId}`;
    setWorkspaceTab('Help');
  };
  const goToLineCommand = () => {
    if (!activeSource) return;
    setWorkspaceTab('Code');
    setCommandPaletteOpen(false);
    setGoToSourceOpen(true);
  };
  const runToAddressCommand = () => {
    const requested = window.prompt('Run hardware CPU to address:', archimedesState ? formatAddress(archimedesState.pc, 8) : hardwareState ? formatAddress(hardwareState.registers.pc) : '&1900');
    if (requested === null) return;
    const maximum = archimedesState ? 0x03fffffc : 0xffff;
    const address = parseHexAddress(requested);
    if (address === null || address > maximum || (archimedesState && (address & 3))) { setNotice(archimedesState ? 'Run-to requires an aligned 26-bit ARM address' : 'Run-to requires a 16-bit hexadecimal address'); return; }
    queueDebugMachineCommand({ type: 'run-to', address }); setWorkspaceTab('Debugger'); setNotice(`Running hardware CPU to ${formatAddress(address, archimedesState ? 8 : 4)}`);
  };
  const debugCoreState = archimedesRuntime ? archimedesState : hardwareState;
  const debugAttached = !!debugSession && !['terminated', 'crashed', 'disconnected'].includes(debugSession.lifecycle) && !!debugCoreState;
  const debugPaused = debugAttached && !debugCoreState!.running;
  const currentMachineArtifact = buildArtifactIsCurrent && buildArtifact && isMachineCodeArtifact(buildArtifact) ? buildArtifact : null;
  const runToCursorCommand = () => {
    if (!currentMachineArtifact || !activeSource) { setNotice('Run to cursor requires a current machine-code artifact and active source file'); return; }
    const address = Object.entries(currentMachineArtifact.sourceLocations).filter(([, location]) => location.fileId === activeSource.id && location.line === caretLine).map(([value]) => Number(value)).sort((left, right) => left - right)[0];
    if (address === undefined) { setNotice(`No executable address is mapped to ${activeSource.name}:${caretLine}`); return; }
    queueDebugMachineCommand({ type: 'run-to', address }); setWorkspaceTab('Debugger'); setNotice(`Running to cursor ${activeSource.name}:${caretLine} at ${formatAddress(address, currentMachineArtifact.kind === 'arm-binary' ? 8 : 4)}`);
  };
  const runToSymbolCommand = () => {
    if (!currentMachineArtifact) return;
    const requested = window.prompt('Run to build symbol:', 'start'); if (requested === null) return;
    const match = Object.entries(currentMachineArtifact.symbols).find(([name]) => name.toLowerCase() === requested.trim().toLowerCase());
    if (!match) { setNotice(`Build symbol ${requested.trim() || '(empty)'} was not found in the immutable artifact`); return; }
    queueDebugMachineCommand({ type: 'run-to', address: match[1] }); setWorkspaceTab('Debugger'); setNotice(`Running to ${match[0]} at ${formatAddress(match[1], currentMachineArtifact.kind === 'arm-binary' ? 8 : 4)}`);
  };
  const debugPauseCommand = () => queueDebugMachineCommand({ type: 'pause' });
  const debugRestartCommand = () => queueDebugMachineCommand({ type: 'reset', ...(archimedesRuntime ? { fastBootMs: 5000 } : {}) });
  const debugInstructionStepCommand = () => queueDebugMachineCommand({ type: 'step' });
  const debugSourceStepCommand = (mode: 'in' | 'over' | 'out') => {
    if (mode === 'out' && archimedesRuntime && archimedesState) { queueDebugMachineCommand({ type: 'run-to', address: archimedesState.registers[14]! & 0x03fffffc }); return; }
    queueDebugMachineCommand({ type: 'source-step', mode, instructionBudget: 100000 });
  };
  const workspaceCommands: WorkbenchCommand[] = [...workspaceTabs, ...assetTabs].map((tab) => ({
    id: `workspace-${tab.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    label: `Open ${tab} workspace`,
    category: 'Workspace',
    keywords: ['view', 'panel', tab],
    enabled: true,
    run: () => tab === 'Search' ? openProjectSearch() : setWorkspaceTab(tab),
  }));
  const commandDefinitions: WorkbenchCommand[] = [
    { id: 'project-new', label: 'Create new project', category: 'Project', keywords: ['clear', 'start'], enabled: true, run: newLocalProject },
    { id: 'project-open', label: 'Open portable project', category: 'Project', keywords: ['import', 'json'], enabled: true, run: () => projectInputRef.current?.click() },
    { id: 'project-start', label: 'Start a project from a sample or an existing codebase', category: 'Project', keywords: ['sample', 'demo', 'example', 'folder', 'import', 'codebase', 'game'], enabled: true, run: () => setStartProjectOpen(true) },
    { id: 'file-save', label: 'Save current source in browser', category: 'File', keywords: ['persist', 'local', 'dirty'], enabled: !!activeSource, disabledReason: 'No source editor is open', run: saveCurrentSource },
    { id: 'project-save-all', label: 'Save all project files in browser', category: 'Project', keywords: ['persist', 'local', 'dirty'], enabled: true, run: saveLocalProject },
    { id: 'project-write-folder', label: 'Write project files back to the connected folder', category: 'Project', keywords: ['folder', 'disk', 'save', 'write'], enabled: !!connectedFolder, run: () => { void writeProjectToFolder(); } },
    { id: 'project-export', label: 'Export portable project', category: 'Project', keywords: ['download', 'bundle', 'private', 'redact'], enabled: true, run: () => setProjectExportOpen(true) },
    { id: 'file-new', label: 'Create new source file', category: 'File', keywords: ['add'], enabled: true, run: () => addSourceFile() },
    { id: 'file-import', label: 'Import source files', category: 'File', keywords: ['open', 'multiple'], enabled: true, run: () => sourceInputRef.current?.click() },
    { id: 'file-analyse', label: 'Analyse local binary or BASIC file', category: 'Analysis', keywords: ['disassemble', 'list', 'inspect'], enabled: true, run: openAnalysisFile },
    { id: 'file-close-editor', label: 'Close current source editor', category: 'File', keywords: ['tab', 'document'], enabled: !!activeSource, disabledReason: 'No source editor is open', run: () => activeSource && closeSourceEditor(activeSource.id) },
    { id: 'file-close-other-editors', label: 'Close other source editors', category: 'File', keywords: ['tabs', 'documents'], enabled: !!activeSource && documents.openIds.length > 1, disabledReason: activeSource ? 'No other source editors are open' : 'No source editor is open', run: () => activeSource && closeOtherSourceEditors(activeSource.id) },
    { id: 'file-close-all-editors', label: 'Close all source editors', category: 'File', keywords: ['tabs', 'documents'], enabled: documents.openIds.length > 0, disabledReason: 'No source editors are open', run: closeAllSourceEditors },
    { id: 'file-reopen-editor', label: 'Reopen recently closed source editor', category: 'File', keywords: ['tab', 'document', 'history'], enabled: canReopenClosed, disabledReason: 'No recently closed project file is available', run: reopenClosedSourceEditor },
    { id: 'file-revert-editor', label: 'Revert current source to last save', category: 'File', keywords: ['discard', 'restore', 'baseline'], enabled: !!activeSource && activeSource.saved !== false && activeSource.content !== (activeSource.savedContent ?? activeSource.content), disabledReason: activeSource?.saved === false ? 'Current source has never been explicitly saved' : activeSource ? 'Current source matches its saved content' : 'No source editor is open', run: () => activeSource && revertSourceFile(activeSource.id) },
    { id: 'editor-find', label: 'Find and replace in current file', category: 'Editor', keywords: ['search'], enabled: !!activeSource, disabledReason: 'No active source file', run: findInCurrentFile },
    { id: 'editor-search-project', label: 'Search and replace project', category: 'Editor', keywords: ['find', 'regex'], enabled: true, run: openProjectSearch },
    { id: 'editor-go-line', label: 'Go to line or project symbol', category: 'Editor', keywords: ['jump', 'navigate', 'label', 'procedure', 'function'], enabled: !!activeSource, disabledReason: 'No active source file', run: goToLineCommand },
    { id: 'build-active', label: 'Build selected target', category: 'Build', keywords: ['compile', 'assemble', 'tokenize'], enabled: canBuild, disabledReason: buildTargetErrors[0] ?? 'Build target is invalid', run: () => { buildActiveSource(); } },
    { id: 'run-active', label: 'Build and run selected target', category: 'Run', keywords: ['execute', 'emulator'], enabled: canRun, disabledReason: buildEntry?.language === 'bbc-basic' ? 'Supply the selected ROM set before running BASIC' : buildTargetErrors[0] ?? 'Select a buildable target', run: runProgram },
    { id: 'debug-active', label: 'Build and debug selected target', category: 'Debug', keywords: ['breakpoint', 'inspect'], enabled: canDebug, disabledReason: buildEntry?.language === 'bbc-basic' ? 'Supply the selected ROM set before debugging BASIC' : buildTargetErrors[0] ?? 'Select a buildable target', run: () => void startDebugger() },
    { id: 'debug-run-to', label: 'Debugger: run to address', category: 'Debug', keywords: ['continue', 'pc'], enabled: debugPaused, disabledReason: debugAttached ? 'Pause the attached core first' : 'Start a ROM-aware debug session first', run: runToAddressCommand },
    { id: 'debug-pause', label: 'Debugger: pause', category: 'Debug', keywords: ['break', 'suspend'], enabled: debugAttached && !!debugCoreState?.running, disabledReason: !debugAttached ? 'Start a debug session first' : 'The attached core is already paused', run: debugPauseCommand },
    { id: 'debug-stop', label: 'Debugger: stop session', category: 'Debug', keywords: ['terminate', 'end'], enabled: debugAttached, disabledReason: 'No active debug session is attached', run: stopDebugSession },
    { id: 'debug-restart', label: 'Debugger: restart bound machine', category: 'Debug', keywords: ['reset', 'reboot'], enabled: debugAttached, disabledReason: 'No active debug session is attached', run: debugRestartCommand },
    { id: 'debug-step-instruction', label: 'Debugger: step one instruction', category: 'Debug', keywords: ['cpu', 'opcode'], enabled: debugPaused, disabledReason: debugAttached ? 'Pause the attached core before stepping' : 'Start a debug session first', run: debugInstructionStepCommand },
    { id: 'debug-step-source-in', label: 'Debugger: source step into', category: 'Debug', keywords: ['line', 'statement'], enabled: debugPaused && !!currentMachineArtifact, disabledReason: !debugPaused ? 'Pause an active debug session first' : 'A current source-mapped artifact is required', run: () => debugSourceStepCommand('in') },
    { id: 'debug-step-source-over', label: 'Debugger: source step over', category: 'Debug', keywords: ['line', 'call'], enabled: debugPaused && !!currentMachineArtifact, disabledReason: !debugPaused ? 'Pause an active debug session first' : 'A current source-mapped artifact is required', run: () => debugSourceStepCommand('over') },
    { id: 'debug-step-source-out', label: 'Debugger: source step out', category: 'Debug', keywords: ['return', 'stack', 'r14'], enabled: debugPaused && !!currentMachineArtifact, disabledReason: !debugPaused ? 'Pause an active debug session first' : 'A current source-mapped artifact is required', run: () => debugSourceStepCommand('out') },
    { id: 'debug-run-cursor', label: 'Debugger: run to cursor', category: 'Debug', keywords: ['line', 'source'], enabled: debugPaused && !!currentMachineArtifact && !!activeSource, disabledReason: !debugPaused ? 'Pause an active debug session first' : 'A current source-mapped artifact and active file are required', run: runToCursorCommand },
    { id: 'debug-run-symbol', label: 'Debugger: run to symbol', category: 'Debug', keywords: ['label', 'function'], enabled: debugPaused && !!currentMachineArtifact, disabledReason: !debugPaused ? 'Pause an active debug session first' : 'A current artifact symbol table is required', run: runToSymbolCommand },
    { id: 'runtime-continue', label: 'Runtime: continue execution', category: 'Run', keywords: ['resume', 'play'], enabled: !!hardwareState ? !hardwareState.running : !!runtimeState, disabledReason: hardwareState?.running ? 'Hardware CPU is already running' : 'No runtime is attached', run: () => hardwareState ? queueMachineCommand({ type: 'run' }) : continueProgram() },
    { id: 'runtime-step', label: 'Runtime: step one instruction', category: 'Debug', keywords: ['cpu', 'instruction'], enabled: !!hardwareState ? !hardwareState.running : !!runtimeState, disabledReason: hardwareState?.running ? 'Pause the hardware CPU first' : 'No runtime is attached', run: () => hardwareState ? queueMachineCommand({ type: 'step' }) : stepProgram() },
    { id: 'runtime-reset', label: 'Runtime: reset machine or program', category: 'Run', keywords: ['restart'], enabled: !!hardwareState || !!runtimeState, disabledReason: 'No runtime is attached', run: () => hardwareState ? queueMachineCommand({ type: 'reset' }) : resetProgram() },
    { id: 'view-target', label: `${configOpen ? 'Hide' : 'Show'} target configuration`, category: 'View', keywords: ['machine', 'profile'], enabled: true, run: toggleConfigPanel },
    { id: 'view-explorer', label: `${explorerOpen ? 'Hide' : 'Show'} project explorer`, category: 'View', keywords: ['files', 'tree'], enabled: true, run: toggleExplorerPanel },
    { id: 'view-inspector', label: `${inspectorOpen ? 'Hide' : 'Show'} inspector`, category: 'View', keywords: ['problems', 'registers'], enabled: true, run: () => setInspectorOpen((current) => !current) },
    ...workspaceCommands,
  ];
  /* The dispatched binding table is the only source of advertised chords. */
  const commands: WorkbenchCommand[] = commandDefinitions.map((command) => {
    const shortcut = commandShortcuts.get(command.id);
    return shortcut ? { ...command, shortcut } : command;
  });

  /* Every workbench shortcut is dispatched from the resolved binding table, so
   * the palette labels, the Settings keyboard panel and the actual key handler
   * cannot drift apart. Chords the user unbinds simply stop resolving. */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const candidates = chordCandidates(event);
      if (!candidates.length) return;
      /* A prefix that outlived its welcome is abandoned rather than completed
       * by a key press minutes later. */
      const held = pendingChord.current;
      const pending = held && Date.now() - held.at <= CHORD_SEQUENCE_TIMEOUT_MS ? held.chord : null;
      pendingChord.current = null;
      const match = matchKeyBinding(workbenchKeyLookup, workbenchChordPrefixes, candidates, pending);
      if (match.kind === 'pending') {
        pendingChord.current = { chord: match.chord, at: Date.now() };
        event.preventDefault();
        setNotice(`${formatChord(match.chord)} pressed. Waiting for the second stroke.`);
        return;
      }
      if (match.kind !== 'command') return;
      const commandId = match.commandId;
      if (commandId === 'palette-open') { event.preventDefault(); setCommandPaletteOpen(true); return; }
      if (commandPaletteOpen || goToSourceOpen) return;
      const target = event.target as HTMLElement | null;
      const editing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      /* Build, run and debug chords stay available to the host field while text
       * is being entered; the debugger transport chords do not. */
      if (editing && (commandId === 'build-active' || commandId === 'run-active' || commandId === 'debug-active' || commandId === 'debug-restart')) return;
      /* Chords whose command needs an open editor are left to the host when no
       * editor is open, so Ctrl+W still closes the browser tab. */
      if ((commandId === 'file-close-editor' || commandId === 'file-revert-editor') && !activeSource) return;
      event.preventDefault();
      switch (commandId) {
        case 'file-save': saveCurrentSource(); return;
        case 'project-save-all': saveLocalProject(); return;
        case 'file-close-editor': closeSourceEditor(activeSource!.id); return;
        case 'file-reopen-editor': reopenClosedSourceEditor(); return;
        case 'file-revert-editor': revertSourceFile(activeSource!.id); return;
        case 'editor-search-project': openProjectSearch(); return;
        case 'editor-go-line': goToLineCommand(); return;
        case 'build-active': if (canBuild) buildActiveSource(); return;
        case 'run-active': if (canRun) runProgram(); return;
        case 'debug-active': if (canDebug) void startDebugger(); return;
        case 'debug-restart': if (debugAttached) debugRestartCommand(); return;
        case 'debug-pause': if (debugAttached && debugCoreState?.running) debugPauseCommand(); return;
        case 'debug-stop': if (debugAttached) stopDebugSession(); return;
        case 'debug-step-instruction': if (debugPaused) debugInstructionStepCommand(); return;
        case 'debug-step-source-in': if (debugPaused && currentMachineArtifact) debugSourceStepCommand('in'); return;
        case 'debug-step-source-over': if (debugPaused && currentMachineArtifact) debugSourceStepCommand('over'); return;
        case 'debug-step-source-out': if (debugPaused && currentMachineArtifact) debugSourceStepCommand('out'); return;
        case 'debug-run-cursor': if (debugPaused && currentMachineArtifact && activeSource) runToCursorCommand(); return;
        default: return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [workbenchKeyLookup, commandPaletteOpen, goToSourceOpen, canBuild, canRun, canDebug, activeFileId, caretLine, hardwareState, archimedesState, runtimeState, debugSession, buildArtifact, documents, project]);

  return (
    <div className="app-shell" style={{ '--machine-accent': machine.accent } as React.CSSProperties}>
      <input
        ref={sourceInputRef}
        className="visually-hidden"
        type="file"
        multiple
        aria-label="Import source files"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length) void importSourceFiles(files);
          event.target.value = '';
        }}
      />
      <input
        ref={projectInputRef}
        className="visually-hidden"
        type="file"
        accept=".json,.8bitdev.json,application/json"
        aria-label="Open portable 8bit-net Dev project"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void openProjectFile(file);
          event.target.value = '';
        }}
      />
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        multiple
        aria-label="Choose an Acorn file and optional INF sidecar to analyse"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length) void loadAnalysisFiles(files);
          event.target.value = '';
        }}
      />
      <CommandPalette open={commandPaletteOpen} commands={commands} onClose={() => setCommandPaletteOpen(false)} />
      {startProjectOpen && <StartProjectDialog onOpenProject={adoptProject} onClose={() => setStartProjectOpen(false)} onNotice={setNotice} machineId={resolved.machine.id} />}
      <ProjectExportDialog open={projectExportOpen} projectName={project.name} projectBookmarkCount={project.bookmarks.filter((bookmark) => bookmark.scope === 'project').length} privateBookmarkCount={project.bookmarks.filter((bookmark) => bookmark.scope === 'private').length} preview={exportPreview} onClose={() => setProjectExportOpen(false)} onExport={exportLocalProject} />
      <GoToSourceDialog open={goToSourceOpen} files={project.files} activeFileId={activeFileId} currentLine={caretLine} sourceLocations={currentMachineArtifact?.sourceLocations} onClose={() => setGoToSourceOpen(false)} onNavigate={(fileId, line, column, length) => {
        jumpToSourceLocation(fileId, line, column, length);
        const destination = project.files.find((candidate) => candidate.id === fileId);
        setNotice(`Moved to ${destination?.name ?? fileId}:${line}${column ? `:${column}` : ''}`);
      }} />
      <a className="skip-link" href="#main-workspace">Skip to editor</a>
      <header className="topbar">
        <div className="brand-lockup">
          <BrandMark />
          <div>
            <h1 className="brand-name">8BIT-NET <strong>DEV</strong></h1>
            <div className="brand-subtitle">Acorn Workbench</div>
          </div>
          <span className="prototype-badge">LOCAL ALPHA</span>
        </div>

        <div className="project-crumb" aria-label="Current project">
          <span className="project-crumb-muted">Projects</span>
          <Icon name="chevron" size={13} />
          <strong>{project.name}</strong>
          {project.files.some((file) => file.modified) && <span className="dirty-dot" title="Unsaved changes">●</span>}
        </div>

        <div className="global-actions" aria-label="Project actions">
          <div className="action-cluster">
            <ToolbarButton label="New project" icon="new" onClick={newLocalProject} />
            <ToolbarButton label="Open project" icon="open" onClick={() => projectInputRef.current?.click()} />
            <ToolbarButton label="Start from a sample or existing codebase" icon="layers" onClick={() => setStartProjectOpen(true)} />
            <ToolbarButton label="Save all project files in browser" icon="save" onClick={saveLocalProject} />
            <ToolbarButton label="Export portable project" icon="download" onClick={() => setProjectExportOpen(true)} />
            <ToolbarButton label="Analyse local file" icon="terminal" tone="blue" onClick={openAnalysisFile} />
          </div>
          <div className="action-cluster">
            <ToolbarButton label="Open command palette" icon="terminal" onClick={() => setCommandPaletteOpen(true)} />
            <ToolbarButton label="Open technical help" icon="book" onClick={() => openHelp('using-help')} />
            <ToolbarButton label={canBuild ? `Build target ${activeBuildTarget.name}` : buildTargetErrors[0] ?? 'Build target is invalid'} icon="build" tone="amber" onClick={() => buildActiveSource()} disabled={!canBuild} />
            <ToolbarButton label={canRun ? `Build and run target ${activeBuildTarget.name}` : buildEntry?.language === 'arm' ? 'ARM2 Run requires RISC OS application packaging; use Debug for the raw image' : buildEntry?.language === 'bbc-basic' ? 'BASIC execution requires the selected ROM set' : buildTargetErrors[0] ?? 'Run requires a buildable target'} icon="play" tone="green" onClick={runProgram} disabled={!canRun} />
            <ToolbarButton label={canDebug ? `Build and debug target ${activeBuildTarget.name}` : buildEntry?.language === 'arm' ? 'ARM2 Debug requires qualified A310 firmware' : buildEntry?.language === 'bbc-basic' ? 'BASIC debugging requires the selected ROM set' : buildTargetErrors[0] ?? 'Debug requires a buildable target'} icon="debug" tone="blue" onClick={() => void startDebugger()} disabled={!canDebug} />
          </div>
          <ToolbarButton label="Cloud projects unavailable · local workspace only" icon="cloud" onClick={() => undefined} disabled />
        </div>
      </header>

      <nav className="modebar" aria-label="IDE sections">
        <div className="tab-group-label"><span />WORKSPACE</div>
        <div className="tab-scroll">
          {workspaceTabs.map((tab) => (
            <button
              className={workspaceTab === tab ? 'mode-tab active' : 'mode-tab'}
              key={tab}
              type="button"
              aria-current={workspaceTab === tab ? 'page' : undefined}
              onClick={() => tab === 'Search' ? openProjectSearch() : setWorkspaceTab(tab)}
            >
              {tab}
            </button>
          ))}
          <div className="tab-group-label assets-label"><span />ASSETS</div>
          {assetTabs.map((tab) => (
            <button
              className={workspaceTab === tab ? 'mode-tab active' : 'mode-tab'}
              key={tab}
              type="button"
              onClick={() => setWorkspaceTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
        <button className="panel-menu-button" type="button" aria-label={`Open help for ${workspaceTab}`} title={`Open technical help for ${workspaceTab}`} onClick={() => openHelp(workspaceTab === 'Debugger' ? (buildEntry?.language === 'arm' ? 'debugger-arm' : 'debugger-6502') : workspaceHelpTopics[workspaceTab] ?? 'first-run')}>
          <Icon name="book" />
        </button>
      </nav>

      <div className={`workbench ${configOpen ? 'config-open' : 'config-closed'} ${explorerOpen ? 'explorer-open' : 'explorer-closed'} ${inspectorOpen ? 'inspector-open' : 'inspector-closed'}`}>
        <aside className="activity-rail" aria-label="Workbench panels">
          <button className={configOpen ? 'rail-button active' : 'rail-button'} type="button" aria-label="Target configuration" onClick={toggleConfigPanel}>
            <Icon name="chip" />
          </button>
          <button className={explorerOpen ? 'rail-button active' : 'rail-button'} type="button" aria-label="Project explorer" onClick={toggleExplorerPanel}>
            <Icon name="folder" />
          </button>
          <button className={workspaceTab === 'Search' ? 'rail-button active' : 'rail-button'} type="button" aria-label="Search project" onClick={openProjectSearch}><Icon name="search" /></button>
          <button className={assetTabs.includes(workspaceTab) ? 'rail-button active' : 'rail-button'} type="button" aria-label="Assets" onClick={() => setWorkspaceTab('Sprites')}><Icon name="image" /></button>
          <button className={workspaceTab === 'Research' ? 'rail-button active' : 'rail-button'} type="button" aria-label="Research" onClick={() => setWorkspaceTab('Research')}><Icon name="book" /></button>
          <div className="rail-spacer" />
          <button className={workspaceTab === 'Settings' ? 'rail-button active' : 'rail-button'} type="button" aria-label="Settings" onClick={() => setWorkspaceTab('Settings')}><Icon name="settings" /></button>
        </aside>

        {configOpen && (
          <aside className="config-panel panel-surface" aria-label="Target configuration">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">TARGET PROFILE</span>
                <h2>Machine setup</h2>
              </div>
              <button className="plain-icon" type="button" aria-label="Close target configuration" onClick={() => setConfigOpen(false)}><Icon name="close" size={16} /></button>
            </div>

            <div className="profile-identity">
              <span className="machine-monogram">{machine.shortLabel.slice(0, 2).toUpperCase()}</span>
              <div>
                <strong>{machine.label}</strong>
                <small>{machine.generation}</small>
              </div>
            </div>

            <div className="config-fields">
              <label>
                <span>Platform class</span>
                <select aria-label="Platform class" value={platformClass} onChange={(event) => changePlatform(event.target.value as PlatformClassId)}>
                  {platformClasses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
              <label>
                <span>Acorn system</span>
                <select aria-label="Acorn system" value={machine.id} onChange={(event) => changeMachine(event.target.value)}>
                  {availableMachines.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
              <label>
                <span>Model / memory</span>
                <select aria-label="Model and memory" value={resolved.variant} onChange={(event) => setVariant(event.target.value)}>
                  {machine.variants.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label>
                <span>ROM / operating system</span>
                <select aria-label="ROM and operating system" value={resolved.rom.id} onChange={(event) => setRomId(event.target.value)}>
                  {machine.roms.map((item) => <option key={item.id} value={item.id}>{item.label}{item.unavailableReason ? ' · not runnable here' : ''}</option>)}
                </select>
              </label>
            </div>
            {romUnavailableReason && <p className="honest-note" role="status">{romUnavailableReason}</p>}

            <div className="hardware-summary" aria-label="Hardware summary">
              <div><span>CPU</span><strong>{machine.cpu}</strong></div>
              <div><span>Memory</span><strong>{machine.memory}</strong></div>
              <div><span>ROM note</span><strong>{resolved.rom.detail}</strong></div>
              <div><span>Firmware files</span><strong>{romReady ? 'Local set ready' : 'Open Settings to supply'}</strong></div>
            </div>

            {!resolution.exact && (
              <section className="configuration-diagnostics" role="status" aria-label="Configuration differences">
                <strong>This is not exactly the configuration that was asked for</strong>
                <small>{configurationSummary(resolution)}</small>
                <ul>
                  {resolution.diagnostics.map((item) => (
                    <li key={`${item.kind}-${item.requested}`} className={item.applied ? 'substituted' : 'dropped'}>
                      <code>{item.requested}</code>
                      <span>{item.reason}</span>
                      {item.applied && <em>Using {item.applied}</em>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <fieldset className="capability-list">
              <legend>
                <span>Capabilities</span>
                <small>{enabledCapabilities.length} enabled</small>
              </legend>
              {machine.capabilities.map((item) => (
                <label className={`capability-item state-${item.state}`} key={item.id}>
                  <input
                    type="checkbox"
                    checked={enabledCapabilities.includes(item.id)}
                    disabled={item.state === 'planned' || (!!item.requiresVariant && item.requiresVariant !== resolved.variant)}
                    onChange={() => toggleCapability(item.id)}
                  />
                  <span className="custom-check" aria-hidden="true" />
                  <span className="capability-copy">
                    <span className="capability-title-row">
                      <strong>{item.label}</strong>
                      <small className={`state-pill ${item.state}`}>{item.state}</small>
                    </span>
                    <small>{item.description}</small>
                    {item.requirement && <small className="requirement-note">Requires {item.requirement}</small>}
                    {item.requiresVariant && <small className="requirement-note">Fitted to the {item.requiresVariant} variant{item.requiresVariant === resolved.variant ? '' : ', which is not selected'}</small>}
                  </span>
                </label>
              ))}
            </fieldset>

            <SidewaysSlotPanel
              available={machine.capabilities.some((item) => item.id === 'sideways' && item.state !== 'planned')}
              unavailableReason={machine.capabilities.some((item) => item.id === 'sideways')
                ? `${machine.label} has sideways RAM in this product's model, but this build does not drive it, so there are no banks to fill.`
                : `${machine.label} has no sideways ROM, so there are no banks to fill.`}
              layout={sidewaysLayout}
              onChange={setSidewaysLayout}
              onNotice={setNotice}
            />

            <button className="target-details-button" type="button" onClick={() => setWorkspaceTab('Build targets')}>
              Open build manifest <Icon name="chevron" size={14} />
            </button>
          </aside>
        )}

        {explorerOpen && (
          <aside className="explorer-panel panel-surface" aria-label="Project explorer">
            <div className="panel-heading compact">
              <div><span className="eyebrow">LOCAL PROJECT</span><h2>{project.name}</h2></div>
              <button className="plain-icon" type="button" aria-label="Export portable project" onClick={() => setProjectExportOpen(true)}><Icon name="download" size={17} /></button>
            </div>
            <div className="explorer-actions">
              <button type="button" onClick={() => addSourceFile()}><Icon name="new" size={14} /> New</button>
              <button type="button" onClick={() => sourceInputRef.current?.click()}><Icon name="open" size={14} /> Import</button>
            </div>
            <ProjectTree
              files={project.files}
              buildTargets={project.buildTargets.map((target) => ({ id: target.id, name: target.name }))}
              activeFileId={activeFileId}
              activeBuildTargetId={project.activeBuildTargetId}
              trash={project.trash}
              onOpenFile={openSourceEditor}
              onSelectBuildTarget={(id) => { selectBuildTarget(id); setWorkspaceTab('Build targets'); }}
              onRestore={restoreTrashedFile}
              onPurge={purgeTrashedFile}
              onReorder={reorderFiles}
              artifacts={retainedArtifacts.length ? retainedArtifacts.map((record) => { const target = project.buildTargets.find((item) => item.id === record.targetId); const current = !!target && !!record.artifact.provenance && provenanceMatches(record.artifact.provenance, target, selectedProjectTarget, project.files); return <div className="artifact-tree-group" key={record.targetId}><button className="tree-item artifact-output" type="button" role="treeitem" tabIndex={-1} onClick={() => { selectBuildTarget(record.targetId); setArtifactDocumentId(undefined); setWorkspaceTab('Build targets'); }}><Icon name="file" size={15} /><span>{record.artifact.provenance?.target.outputName ?? record.targetName}</span><small>{current ? `${record.artifact.bytes.length} B` : 'STALE'}</small></button>{generatedArtifactDocuments(record.artifact, record.metadata).map((document) => <button className="tree-item artifact-document" type="button" role="treeitem" tabIndex={-1} key={document.id} onClick={() => { selectBuildTarget(record.targetId); setArtifactDocumentId(document.id); setWorkspaceTab('Build targets'); }}><Icon name="file" size={13} /><span>{document.filename}</span><small>RO</small></button>)}</div>; }) : <div className="tree-empty"><span>No artifacts yet</span><small>Build a target to retain its generated documents.</small></div>}
            />
          </aside>
        )}

        <main className="main-workspace" id="main-workspace" aria-label="Acorn development workbench">
          <section className="editor-stack" aria-label={`${workspaceTab} workspace`}>
            {workspaceTab === 'Code' && openSourceFiles.length ? (
              <><div className={`source-editor-split${sourceSplitFileId ? ' open' : ''}`}>
              <SourceWorkspace
                keyBindings={resolvedKeyBindings}
                files={openSourceFiles}
                projectFiles={project.files}
                processor={languageTarget.processor}
                languageTarget={languageTarget}
                languageBuildRevision={`${buildActivity.requestId}:${buildActivity.status}:${buildArtifactIsCurrent ? 'current' : 'stale'}:${buildArtifact?.provenance?.fingerprint ?? 'none'}`}
                activeFileId={activeFileId}
                paneId="primary"
                activePane={activeSourcePane === 'primary'}
                splitOpen={!!sourceSplitFileId}
                onActivatePane={() => setActiveSourcePane('primary')}
                onRequestSplit={openSourceSplit}
                onCloseSplit={closeSourceSplit}
                onSelectFile={selectSourceEditor}
                onChange={updateSourceFile}
                onChangeFiles={updateSourceFiles}
                onChangeTextFormat={updateSourceTextFormat}
                onNewFile={() => addSourceFile()}
                onRenameFile={renameSourceFile}
                onDeleteFile={deleteSourceFile}
                onDownloadFile={downloadSourceFile}
                onSave={saveCurrentSource}
                onSaveAll={saveLocalProject}
                onRevert={revertSourceFile}
                onCloseFile={closeSourceEditor}
                onCloseOthers={closeOtherSourceEditors}
                onCloseAll={closeAllSourceEditors}
                onReopenClosed={reopenClosedSourceEditor}
                onNavigateSource={jumpToSourceLocation}
                onResearch={(language, query) => { setResearchRequest({ sequence: Date.now(), language, query }); setWorkspaceTab('Research'); }}
                onOpenGeneratedSymbol={(token) => { setArtifactDocumentId(undefined); setArtifactSymbolSelection(token); setWorkspaceTab('Build targets'); }}
                onOpenSdkDocument={openSdkDocument}
                canNavigateBack={sourceNavigation.back.length > 0}
                canNavigateForward={sourceNavigation.forward.length > 0}
                onNavigateBack={navigateSourceBack}
                onNavigateForward={navigateSourceForward}
                canReopenClosed={canReopenClosed}
                onCaretChange={(line, column, selectionLength = 0, scrollTop = 0) => { setCaretLine(line); setCaretColumn(column); setCaretSelectionLength(selectionLength); setSourceScrollTop(scrollTop); }}
                onNotice={setNotice}
                breakpoints={sourceBreakpoints[activeFileId] ?? []}
                onToggleBreakpoint={(line) => toggleSourceBreakpoint(activeFileId, line)}
                bookmarks={project.bookmarks}
                onAddBookmark={addSourceBookmark}
                onUpdateBookmark={updateSourceBookmark}
                onRemoveBookmark={removeSourceBookmark}
                jump={sourceJumps.primary}
                command={sourceCommand}
                inactive={!!sdkDocument}
              />
              {sourceSplitFileId && project.files.some((file) => file.id === sourceSplitFileId) && <SourceWorkspace
                keyBindings={resolvedKeyBindings}
                files={project.files}
                projectFiles={project.files}
                processor={languageTarget.processor}
                languageTarget={languageTarget}
                languageBuildRevision={`${buildActivity.requestId}:${buildActivity.status}:${buildArtifactIsCurrent ? 'current' : 'stale'}:${buildArtifact?.provenance?.fingerprint ?? 'none'}`}
                activeFileId={sourceSplitFileId}
                paneId="secondary"
                activePane={activeSourcePane === 'secondary'}
                splitOpen
                onActivatePane={() => setActiveSourcePane('secondary')}
                onRequestSplit={openSourceSplit}
                onCloseSplit={closeSourceSplit}
                onSelectFile={(fileId) => { setSourceSplitFileId(fileId); setSecondarySourceLocation({ fileId, line: 1, column: 1, length: 0, scrollTop: 0 }); setActiveSourcePane('secondary'); }}
                onChange={updateSourceFile}
                onChangeFiles={updateSourceFiles}
                onChangeTextFormat={updateSourceTextFormat}
                onNewFile={() => addSourceFile()}
                onRenameFile={renameSourceFile}
                onDeleteFile={deleteSourceFile}
                onDownloadFile={downloadSourceFile}
                onSave={() => saveSourceFile(sourceSplitFileId)}
                onSaveAll={saveLocalProject}
                onRevert={revertSourceFile}
                onCloseFile={closeSourceSplit}
                onNavigateSource={jumpToSourceLocation}
                onResearch={(language, query) => { setResearchRequest({ sequence: Date.now(), language, query }); setWorkspaceTab('Research'); }}
                onOpenGeneratedSymbol={(token) => { setArtifactDocumentId(undefined); setArtifactSymbolSelection(token); setWorkspaceTab('Build targets'); }}
                onOpenSdkDocument={openSdkDocument}
                canNavigateBack={sourceNavigation.back.length > 0}
                canNavigateForward={sourceNavigation.forward.length > 0}
                onNavigateBack={navigateSourceBack}
                onNavigateForward={navigateSourceForward}
                onCaretChange={(line, column, selectionLength = 0, scrollTop = 0) => setSecondarySourceLocation({ fileId: sourceSplitFileId, line, column, length: selectionLength, scrollTop })}
                onNotice={setNotice}
                breakpoints={sourceBreakpoints[sourceSplitFileId] ?? []}
                onToggleBreakpoint={(line) => toggleSourceBreakpoint(sourceSplitFileId, line)}
                bookmarks={project.bookmarks}
                onAddBookmark={addSourceBookmark}
                onUpdateBookmark={updateSourceBookmark}
                onRemoveBookmark={removeSourceBookmark}
                jump={sourceJumps.secondary}
                command={sourceCommand}
                inactive={!!sdkDocument}
              />}
              </div>
              {sdkDocument?.status === 'ready' && sdkDocument.document ? <SdkDocumentView document={sdkDocument.document} token={sdkDocument.token} onClose={closeSdkDocument} onNotice={setNotice} /> : sdkDocument ? <div className="sdk-document-workspace sdk-document-state" role="dialog" aria-modal="true" aria-label={`SDK document ${sdkDocument.path}`}><strong>{sdkDocument.status === 'loading' ? `Loading immutable SDK document ${sdkDocument.path}` : `Could not open ${sdkDocument.path}`}</strong>{sdkDocument.error && <p role="alert">{sdkDocument.error}</p>}<div>{sdkDocument.status === 'error' && <button type="button" onClick={() => openSdkDocument(sdkDocument.path, sdkDocument.token)}>Retry</button>}<button type="button" autoFocus onClick={closeSdkDocument}>Back to source</button></div></div> : null}</>
            ) : workspaceTab === 'Code' ? (
              <div className="source-workspace closed-editors"><div className="editor-tabs"><button type="button" aria-label="New source file" onClick={() => addSourceFile()}><Icon name="new" size={14} /> New source</button></div><div className="closed-editors-empty"><Icon name="file" size={28} /><strong>No source editors open</strong><p>Project files and unsaved recovered content remain in the explorer. Open a file there or reopen the most recently closed editor.</p><div><button type="button" disabled={!canReopenClosed} onClick={reopenClosedSourceEditor}>Reopen closed <kbd>Ctrl ⇧ T</kbd></button><button type="button" onClick={() => addSourceFile()}>New source file</button></div></div></div>
            ) : workspaceTab === 'Search' ? (
              <ProjectSearchWorkspace files={project.files} activeFileId={activeFileId} onNavigate={jumpToSourceLocation} onReplaceAll={replaceAllProjectMatches} />
            ) : workspaceTab === 'Analyse' ? (
              <AnalysisWorkspace
                file={analysisFile}
                origin={analysisOrigin}
                entryPoint={analysisEntry}
                processor={analysisProcessor}
                activity={analysisActivity}
                onOriginChange={setAnalysisOrigin}
                onEntryChange={setAnalysisEntry}
                onProcessorChange={setAnalysisProcessor}
                onOpen={openAnalysisFile}
                onReanalyse={reanalyse}
                onCancel={() => analysisTaskRef.current?.cancel()}
                onAddSource={addSourceFile}
                onResearch={(language, query) => { setResearchRequest((current) => ({ sequence: (current?.sequence ?? 0) + 1, language, query })); setWorkspaceTab('Research'); }}
                debugAvailable={romReady && !!machineRomSet}
                onDebugAddress={(address) => { queueMachineCommand({ type: 'breakpoint', address, enabled: true, stop: true }); setWorkspaceTab('Debugger'); setNotice(`Live breakpoint installed at ${formatAddress(address)} · analysed bytes were not loaded or assumed to match machine memory`); }}
                onNotice={setNotice}
                annotations={analysisAnnotations}
                history={analysisHistory}
                onAnnotationsChange={applyAnalysisAnnotations}
                onHistoryMove={moveAnalysisHistory}
                coverage={analysisCoverage}
              />
            ) : workspaceTab === 'Build targets' ? (
              <BuildWorkspace artifact={buildArtifact} metadata={buildResultMetadata} failure={buildFailureMetadata} artifactDocumentId={artifactDocumentId} onArtifactDocumentChange={setArtifactDocumentId} requestedSymbol={artifactSymbolSelection} onRequestedSymbolHandled={() => setArtifactSymbolSelection(undefined)} stale={!!buildArtifact && !buildArtifactIsCurrent} pinned={artifactPinned} activity={buildActivity} history={buildHistory} buildAllRecords={buildAllRecords} files={project.files} activeFileId={activeFileId} targets={project.buildTargets} activeTarget={activeBuildTarget} machineId={machine.id} machineCpu={machine.cpu} nativeToolchains={nativeToolchains} errors={buildTargetErrors} onSelect={selectBuildTarget} onChange={updateBuildTarget} onAdd={addBuildTarget} onDelete={deleteBuildTarget} onBuild={() => { void buildActiveSource(); }} onBuildBypass={() => { void buildActiveSource('Build targets', 'bypass'); }} onBuildAll={() => void runBuildAll()} onCancelAll={cancelBuildAll} onCancel={() => cancelBackgroundBuild()} onTogglePinned={() => setArtifactPinned((current) => !current)} onAnalyse={analyseBuildArtifact} onNavigate={jumpToSourceLocation} />
            ) : workspaceTab === 'Media' ? (
              <div className="media-workspace-stack">
              <DiskSetWorkspace
                sets={project.diskSets}
                buildTargets={project.buildTargets.map((target) => ({ id: target.id, name: target.name }))}
                projectFiles={project.files.map((file) => ({ id: file.id, name: file.name, content: file.content }))}
                artifacts={diskSetArtifacts}
                onChange={(diskSets) => setProject((current) => ({ ...current, diskSets }))}
                onNotice={setNotice}
                onDownload={(filename, bytes) => downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }), safeFilename(filename))}
              />
              <MediaWorkspace machineId={machine.id} buildArtifact={buildArtifactIsCurrent ? buildArtifact : null} artifact={assemblyArtifact} armArtifact={buildArtifactIsCurrent && buildArtifact?.kind === 'arm-binary' ? buildArtifact : null} connected={romReady && !!(machineRomSet || archimedesRuntime)} archimedesConnected={romReady && !!archimedesRuntime && /^riscos3/.test(archimedesRuntime.profile.arculatorRomSet)} archimedesDiscConnected={romReady && !!archimedesRuntime} discSupported={enabledCapabilities.includes('dfs') || enabledCapabilities.includes('adfs')} tapeSupported={enabledCapabilities.includes('cassette')} mounted={hardwareMedia} onCommand={queueMachineCommand} onNotice={setNotice} onAnalyse={openAnalysisPayload} />
              </div>
            ) : workspaceTab === 'Debugger' ? (
              <div className="debugger-session-workspace">
                <DebugSessionPanel session={debugSession} onStop={stopDebugSession} />
                {archimedesRuntime ? <ArchimedesDebuggerWorkspace connected={romReady} state={archimedesState} memory={archimedesMemory} artifact={buildArtifactIsCurrent && buildArtifact?.kind === 'arm-binary' ? buildArtifact : null} sourceBreakpointAddresses={buildArtifactIsCurrent && buildArtifact?.kind === 'arm-binary' ? resolveSourceBreakpointAddresses(buildArtifact) : []} persistedBreakpoints={project.armBreakpoints[activeBuildTarget.id] ?? EMPTY_ARM_BREAKPOINTS} breakpointGroups={project.armBreakpointGroups[activeBuildTarget.id] ?? EMPTY_ARM_BREAKPOINT_GROUPS} onPersistBreakpoints={(intents) => setProject((current) => ({ ...current, armBreakpoints: { ...current.armBreakpoints, [activeBuildTarget.id]: intents } }))} onPersistGroups={(groups) => setProject((current) => ({ ...current, armBreakpointGroups: { ...current.armBreakpointGroups, [activeBuildTarget.id]: groups } }))} onMachineCommand={queueDebugMachineCommand} onNavigateSource={jumpToSourceLocation} /> : <DebuggerWorkspace artifact={assemblyArtifact} currentFiles={project.files} state={runtimeState} runtime={runtimeRef.current} hardwareState={hardwareState} hardwareMemory={hardwareMemory} hardwareDisassembly={hardwareDisassembly} hardwareInspection={hardwareInspection} hardwareConnected={romReady && !!machineRomSet} sourceBreakpointAddresses={assemblyArtifact ? resolveSourceBreakpointAddresses(assemblyArtifact) : []} persistedBreakpoints={project.breakpoints6502[activeBuildTarget.id] ?? EMPTY_6502_BREAKPOINTS} breakpointGroups={project.breakpointGroups6502[activeBuildTarget.id] ?? EMPTY_6502_BREAKPOINT_GROUPS} onPersistBreakpoints={(intents) => setProject((current) => ({ ...current, breakpoints6502: { ...current.breakpoints6502, [activeBuildTarget.id]: intents } }))} onPersistGroups={(groups) => setProject((current) => ({ ...current, breakpointGroups6502: { ...current.breakpointGroups6502, [activeBuildTarget.id]: groups } }))} onMachineCommand={queueDebugMachineCommand} onNavigateSource={jumpToSourceLocation} onStep={() => { updateDebugLifecycle('stepping', 'ROM-less instruction step requested'); stepProgram(); updateDebugLifecycle('paused', 'ROM-less instruction step completed'); }} onContinue={() => { updateDebugLifecycle('running', 'ROM-less continue requested'); continueProgram(); }} onReset={() => { updateDebugLifecycle('starting', 'ROM-less debug session restarting'); resetProgram(); updateDebugLifecycle('paused', 'ROM-less debug session restarted at entry point'); }} onStateChange={setRuntimeState} onAnalyse={openAnalysisPayload} />}
              </div>
            ) : workspaceTab === 'Tests' ? (
              <TestWorkspace machineManifestId={`${machine.id}/${resolved.variant}/${resolved.rom.id}`} targetName={activeBuildTarget.name} entryFileName={buildEntry?.name ?? 'missing entry'} connected={romReady && !!machineRomSet} supported={buildEntry?.language === '6502'} artifact={assemblyArtifact} result={hardwareTest} plans={project.testPlans.filter((plan) => plan.targetId === activeBuildTarget.id)} testAllRecords={testAllRecords} history={testHistory} onAdd={addTestPlan} onChange={updateTestPlan} onRemove={removeTestPlan} onRun={runHardwareTest} onRunAll={() => void runTestAll()} onCancelAll={cancelTestAll} onDebugFailed={(failed) => { const exact = [buildArtifact, ...retainedArtifacts.map((item) => item.artifact)].find((candidate) => candidate?.provenance?.fingerprint === failed.buildFingerprint); if (!exact || !isMachineCodeArtifact(exact)) { setNotice('The exact failed-test artifact is no longer retained. Run the test again before debugging it.'); return; } void startDebugger(exact); }} />
            ) : workspaceTab === 'Research' ? (
              <><ResearchWorkspace target={languageTarget} request={researchRequest} onNotice={setNotice} />
                <ReferencePanel
                  library={packLibrary}
                  target={{ machineId: languageTarget.machineId, processor: languageTarget.processor, dialect: languageTarget.toolchainId }}
                  {...(researchRequest ? { request: { sequence: researchRequest.sequence, query: researchRequest.query } } : {})}
                  onNotice={setNotice}
                /></>
            ) : workspaceTab === 'Settings' ? (
              <div className="settings-workspace">{unreadableSnapshot && (
                <section className="recovered-snapshot" role="alert" aria-label="Unreadable saved project">
                  <strong>A saved project could not be read</strong>
                  <p>{restored.reason}</p>
                  <div>
                    <button type="button" onClick={() => { downloadBlob(new Blob([unreadableSnapshot], { type: 'application/json' }), safeFilename('unreadable-project.json')); setNotice(`${unreadableSnapshot.length.toLocaleString()} preserved bytes downloaded · nothing has been deleted`); }}>Download the preserved bytes</button>
                    <button type="button" onClick={() => { clearQuarantinedSnapshot(); setUnreadableSnapshot(null); setNotice('The preserved copy has been discarded at your request'); }}>Discard it</button>
                  </div>
                </section>
              )}<SettingsLayersPanel projectSettings={project.settings} onProjectSettingsChange={(settings) => setProject((current) => ({ ...current, settings }))} onNotice={setNotice} onDownload={(filename, text) => downloadBlob(new Blob([text], { type: 'application/json' }), safeFilename(filename))} /><StorageQuotaPanel onNotice={setNotice} /><ProjectStorePanel projectName={project.name} files={project.files.map((file) => ({ name: file.name, content: file.content }))} onNotice={setNotice} onOpenFiles={(opened) => { for (const file of opened) addSourceFile(file.name, file.content); }} onDownload={(filename, text) => downloadBlob(new Blob([text], { type: 'application/json' }), safeFilename(filename))} /><ProfileComparisonPanel /><SystemStatusPanel /><ConformancePanel machineId={machine.id} capabilities={enabledCapabilities} romSetId={resolved.rom.id} /><ReferenceLibraryPanel library={packLibrary} target={{ machineId: languageTarget.machineId, processor: languageTarget.processor, dialect: languageTarget.toolchainId }} onNotice={setNotice} onChange={(next) => { setPackLibrary(next); const failure = savePackLibrary(next); if (failure) setNotice(failure); }} /><LimitsPanel /><KeyboardShortcutsPanel bindings={resolvedKeyBindings} overrides={keyBindingOverrides} onChangeOverrides={setKeyBindingOverrides} onNotice={setNotice} /><RomManagerWorkspace machineId={machine.id} romId={resolved.rom.id} enabledCapabilities={enabledCapabilities} onNotice={setNotice} onReadyChange={(ready) => { setRomReady(ready); setRomInventoryRevision((value) => value + 1); }} /></div>
            ) : workspaceTab === 'Help' ? (
              <HelpWorkspace />
            ) : workspaceTab === 'Sound' ? (
              <SongWorkspace onAddSource={addSourceFile} onAddLiveSong={addLiveSong} onNotice={setNotice} />
            ) : workspaceTab === 'Samples' ? (
              <SampleWorkspace machineId={machine.id} machineLabel={machine.label} onAddSource={addSourceFile} onNotice={setNotice} />
            ) : workspaceTab === 'Screens' ? (
              <ScreenWorkspace projectPalette={projectPalette} onAddSource={addSourceFile} onAddLiveScreen={addLiveScreen} onNotice={setNotice} />
            ) : workspaceTab === 'Fonts' ? (
              <FontWorkspace projectPalette={projectPalette} onAddSource={addSourceFile} onAddLiveFont={addLiveFont} onNotice={setNotice} />
            ) : workspaceTab === 'Palettes' ? (
              <PaletteWorkspace
                projectFiles={project.files.map((file) => ({ name: file.name, content: file.content }))}
                onAddSource={addSourceFile}
                onAddLivePalette={addLivePalette}
                onNotice={setNotice}
              />
            ) : workspaceTab === 'Maps' ? (
              <TileMapWorkspace
                projectPalette={projectPalette}
                availableAssets={project.files.filter((file) => /\.asset\.json$/i.test(file.name)).map((file) => ({ name: file.name, content: file.content }))}
                onAddSource={addSourceFile}
                onAddLiveMap={addLiveTileMap}
                onNotice={setNotice}
              />
            ) : ['Characters', 'Sprites', 'Tiles'].includes(workspaceTab) ? (
              <VersionedPixelAssetWorkspace key={workspaceTab} kind={workspaceTab as 'Characters' | 'Sprites' | 'Tiles'} projectPalette={projectPalette} onAddSource={addSourceFile} onAddLiveAsset={addLivePixelAsset} onNotice={setNotice} />
            ) : (
              <WorkspacePlaceholder tab={workspaceTab} machine={machine.label} />
            )}
          </section>
          <EmulatorPanel machine={machine.label} variant={resolved.variant} machineProfile={{ platformClass, machineId: machine.id, romId: resolved.rom.id, enabledCapabilities }} romRecords={resolvedRomRecords} machineModel={machineRomSet?.adapterModel} romSetId={machineRomSet?.id} engineId={machineRomSet?.engine.id} projectSettings={project.settings} archimedesRuntime={archimedesRuntime} romReady={romReady} tube={enabledCapabilities.includes('tube')} extraRoms={machineRomSet ? runtimeSidewaysRomPaths(machineRomSet, enabledCapabilities) : []} command={machineCommand} artifact={assemblyArtifact} state={runtimeState} onMachineState={setHardwareState} onMachineMemory={setHardwareMemory} onArchimedesState={setArchimedesState} onArchimedesMemory={setArchimedesMemory} onMachineDisassembly={setHardwareDisassembly} onHardwareInspection={setHardwareInspection} onMachineMedia={setHardwareMedia} onMachineTest={receiveMachineTest} onMachineError={(message) => { if (debugSession && !['terminated', 'disconnected'].includes(debugSession.lifecycle)) updateDebugLifecycle('crashed', message); }} onNotice={setNotice} onRun={continueProgram} onStep={stepProgram} onReset={resetProgram} />
        </main>

        {inspectorOpen && (
          <aside className="inspector-panel panel-surface" aria-label="Inspector">
            <div className="inspector-tabs" role="tablist" aria-label="Inspector views">
              <button className="active" role="tab" aria-selected="true" type="button">Inspector</button>
              <button role="tab" aria-selected="false" type="button">Problems <span>{problemCount}</span></button>
              <button className="plain-icon inspector-close" type="button" aria-label="Close inspector" onClick={() => setInspectorOpen(false)}><Icon name="close" size={15} /></button>
            </div>
            <div className="inspector-scroll">
              <section className="context-card">
                <div className="context-kind">{workspaceTab === 'Code' ? 'ACTIVE SOURCE FILE' : 'WORKSPACE STATUS'}</div>
                <div className="context-title"><code>{workspaceTab === 'Code' ? activeSource?.name : workspaceTab}</code><span>{workspaceTab === 'Code' ? activeSourceLanguage : workspaceTab === 'Media' && latestMedia ? latestMedia.kind === 'disc' ? `drive ${latestMedia.drive}` : 'cassette' : workspaceTab === 'Debugger' && hardwareState ? `hardware ${hardwareState.running ? 'running' : 'paused'}` : workspaceTab === 'Debugger' && runtimeState ? runtimeState.status : workspaceTab === 'Build targets' && buildArtifact ? (isMachineCodeArtifact(buildArtifact) ? buildArtifact.processor : buildArtifact.kind === 'atom-basic-text' ? 'Atom BASIC' : 'BBC BASIC II') : 'no adapter'}</span></div>
              <p>{workspaceTab === 'Code' ? activeSource?.access === 'read-only' || activeSource?.kind === 'generated' ? `This ${activeSource.kind ?? 'source'} file is read-only${activeSource.generator ? ` and generated by ${activeSource.generator}` : ''}. Inspect, copy, compare or download it; edit its owning input instead.` : `This ${activeSource?.kind ?? 'authored'} file is editable and automatically recovered from browser storage. Use Save to clear its modified state or Export for a portable copy.` : workspaceTab === 'Media' && latestMedia ? `${latestMedia.name} is mounted in the live ${latestMedia.kind === 'disc' ? `drive ${latestMedia.drive}` : 'cassette input'}; the emulator acknowledged ${latestMedia.size.toLocaleString()} bytes.` : workspaceTab === 'Debugger' && hardwareState ? `Live ROM-aware machine state: ${hardwareState.reason} at ${formatAddress(hardwareState.registers.pc)}.` : workspaceTab === 'Debugger' && runtimeState && assemblyArtifact ? `Live ROM-less ${assemblyArtifact.processor.toUpperCase()} debug state from the current build: ${runtimeState.reason}.` : workspaceTab === 'Build targets' && buildArtifact ? (buildArtifact.kind === '6502-binary' ? `Current ${buildArtifact.processor.toUpperCase()} binary, diagnostics, symbols and source map.` : buildArtifact.kind === 'arm-binary' ? 'Current genuine ARM2 raw binary with linked symbols, DWARF source map and ELF evidence. It is not yet a RISC OS application or runnable Archimedes session.' : buildArtifact.kind === 'atom-basic-text' ? 'Current validated Atom BASIC interpreter text, diagnostics and listing.' : 'Current genuine BBC BASIC II tokenized program, diagnostics and listing.') : 'This surface does not have a runtime adapter attached yet. No simulated state is being presented.'}</p>
                <dl>
                  <div><dt>Files</dt><dd>{project.files.length}</dd></div>
                  <div><dt>Modified</dt><dd>{project.files.filter((file) => file.modified).length}</dd></div>
                  <div><dt>Storage</dt><dd>Browser local</dd></div>
                </dl>
                <button type="button" onClick={() => setProjectExportOpen(true)}>Export portable project <Icon name="chevron" size={13} /></button>
              </section>

              <section className="inspector-section">
                <div className="section-title"><span>DEBUG SESSION</span><small>{hardwareState ? (hardwareState.running ? 'running' : 'paused') : runtimeState?.status ?? 'disconnected'}</small></div>
                {hardwareState ? <div className="mini-registers"><code>A {formatByte(hardwareState.registers.a)}</code><code>X {formatByte(hardwareState.registers.x)}</code><code>Y {formatByte(hardwareState.registers.y)}</code><code>SP {formatByte(hardwareState.registers.s)}</code><code>PC {formatAddress(hardwareState.registers.pc)}</code></div> : runtimeState ? <div className="mini-registers"><code>A {formatByte(runtimeState.registers.a)}</code><code>X {formatByte(runtimeState.registers.x)}</code><code>Y {formatByte(runtimeState.registers.y)}</code><code>SP {formatByte(runtimeState.registers.sp)}</code><code>PC {formatAddress(runtimeState.registers.pc)}</code></div> : <p className="honest-empty">No runtime is attached. Build a source or supply the selected ROM set to populate live state.</p>}
              </section>
            </div>
          </aside>
        )}
      </div>

      <footer className="statusbar">
        <div className="status-left" aria-live="polite"><span className="status-led" />{notice}</div>
        <div className="status-items">
          <span className={saveState && !saveState.ok ? 'status-save-failed' : undefined} title={saveStateSummary(saveState)}>{saveState && !saveState.ok ? 'NOT SAVED' : 'Saved'}</span><span>{machine.shortLabel}</span><span>{machine.cpu.split('@')[0]}</span><span>{activeSourceLanguage ?? 'text'}</span><span>Ln {activeSourcePane === 'secondary' ? secondarySourceLocation.line : caretLine}, Col {activeSourcePane === 'secondary' ? secondarySourceLocation.column : caretColumn}</span><span>{(activePaneSource?.encoding ?? 'utf-8').toUpperCase()}</span><span>{(activePaneSource?.lineEnding ?? 'lf').toUpperCase()}</span>
        </div>
      </footer>
    </div>
  );
}

export interface AnalysisWorkspaceProps {
  file: LoadedFile | null;
  origin: string;
  entryPoint: string;
  processor: AnalysisProcessor;
  activity: { status: 'idle' | 'running' | 'failed'; message: string };
  onOriginChange: (value: string) => void;
  onEntryChange: (value: string) => void;
  onProcessorChange: (value: AnalysisProcessor) => void;
  onOpen: () => void;
  onReanalyse: () => void;
  onCancel: () => void;
  onAddSource: (name: string, content: string) => void;
  onResearch: (language: '6502' | 'arm', query: string) => void;
  debugAvailable: boolean;
  onDebugAddress: (address: number) => void;
  onNotice: (message: string) => void;
  /* What the reader has recorded about these bytes, and the history over it. */
  annotations: AnalysisAnnotations | null;
  history: AnnotationHistory | null;
  onAnnotationsChange: (next: AnalysisAnnotations, description: string) => void;
  onHistoryMove: (direction: 'undo' | 'redo') => void;
  /* Observed execution, or the reason it cannot honestly be shown here. */
  coverage: RuntimeCoverage | null;
}

export function AnalysisWorkspace({
  file, origin, entryPoint, processor, activity, onOriginChange, onEntryChange,
  onProcessorChange, onOpen, onReanalyse, onCancel, onAddSource, onResearch, debugAvailable, onDebugAddress, onNotice,
  annotations, history, onAnnotationsChange, onHistoryMove, coverage,
}: AnalysisWorkspaceProps) {
  const [filter, setFilter] = useState('');
  const [selectedAddress, setSelectedAddress] = useState<number | null>(null);
  const [analysisView, setAnalysisView] = useState<'listing' | 'hex'>('listing');
  const [hexWindowStart, setHexWindowStart] = useState(0);
  const [selectedByteOffset, setSelectedByteOffset] = useState<number | null>(null);
  const [labelDraft, setLabelDraft] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [regionEndDraft, setRegionEndDraft] = useState('');
  const [indirectDraft, setIndirectDraft] = useState('');
  const [armVerification, setArmVerification] = useState<ArmAssemblyVerification | null>(null);
  const [armVerifying, setArmVerifying] = useState(false);
  const armVerificationAbort = useRef<AbortController | null>(null);
  const analysisAddress = (value: number) => formatAddress(value, processor === 'arm2' || processor === 'arm3' ? 8 : 4);
  /* Labels shown, exported and reassembled all come from the one recorded set,
   * so what a reader renamed is what the export carries. */
  const customLabels = useMemo<Record<number, string>>(
    () => annotations ? Object.fromEntries(labelLookup(annotations)) : {},
    [annotations],
  );
  const annotationsFor6502 = processor === '6502' || processor === '65c02';
  const coverageBound = coverage?.status === 'bound';
  const rowCoverage = (row: DisassemblyRow) => coverage ? rowCoverageLabel(coverage, row.address, row.bytes.length) : null;

  const disassembly = file?.analysis.kind === 'machine-code' ? file.analysis : null;
  const assemblySource = useMemo(() => disassembly && file
    ? createVerified6502AssemblySource(disassembly, file.bytes, customLabels)
    : null, [disassembly, file, customLabels]);
  const armAssemblySource = useMemo(() => disassembly && (processor === 'arm2' || processor === 'arm3')
    ? createArmAssemblySource(disassembly, customLabels)
    : null, [disassembly, processor, customLabels]);
  useEffect(() => {
    armVerificationAbort.current?.abort(); armVerificationAbort.current = null;
    setArmVerification(null); setArmVerifying(false);
  }, [armAssemblySource?.source]);
  const filteredRows = useMemo(() => {
    if (!disassembly || !filter.trim()) return disassembly?.rows ?? [];
    const needle = filter.trim().toLowerCase();
    return disassembly.rows.filter((row) =>
      [row.label, row.mnemonic, row.operand, row.comment, analysisAddress(row.address)]
        .some((value) => value?.toLowerCase().includes(needle)),
    );
  }, [disassembly, filter]);

  const displayLabel = (address: number) => customLabels[address] ?? disassembly?.labels[address];
  const displayOperand = (row: DisassemblyRow) => {
    if (row.target === undefined || !customLabels[row.target] || !disassembly?.labels[row.target]) return row.operand;
    return row.operand.replace(disassembly.labels[row.target]!, customLabels[row.target]!);
  };

  const selectRow = (row: DisassemblyRow) => {
    setSelectedAddress(row.address);
    setSelectedByteOffset(row.offset);
    setLabelDraft(customLabels[row.address] ?? '');
    setCommentDraft(annotations?.comments.find((entry) => entry.address === row.address)?.text ?? '');
    const region = annotations ? regionAt(annotations, row.address) : undefined;
    setRegionEndDraft(region ? `&${region.end.toString(16).toUpperCase().padStart(4, '0')}` : '');
    setIndirectDraft((annotations?.indirectTargets.find((hint) => hint.from === row.address)?.targets ?? [])
      .map((target) => `&${target.toString(16).toUpperCase().padStart(4, '0')}`).join(' '));
  };

  const jumpTo = (address: number) => {
    const targetRow = disassembly?.rows.find((row) => row.address === address);
    if (analysisView === 'hex' && targetRow) {
      selectRow(targetRow); setHexWindowStart(artifactWindowStart(targetRow.offset, file?.bytes.length ?? 0));
      return;
    }
    const element = document.querySelector<HTMLElement>(`[data-analysis-address="${address}"]`);
    if (!element) {
      onNotice(`${displayLabel(address) ?? analysisAddress(address)} is outside the loaded file`);
      return;
    }
    element.scrollIntoView({ block: 'center' });
    element.focus();
    setSelectedAddress(address);
  };

  /* Arrow-key movement inside the listing grid. Focus follows selection so a
   * screen reader announces the row the inspector is describing, and Home and
   * End reach the ends of a long listing without holding a key down. */
  const focusListingRow = (index: number) => {
    const row = filteredRows[index];
    if (!row) return;
    selectRow(row);
    const element = document.querySelector<HTMLElement>(`[data-analysis-address="${row.address}"]`);
    element?.focus();
    element?.scrollIntoView?.({ block: 'nearest' });
  };

  const moveListingFocus = (event: ReactKeyboardEvent<HTMLDivElement>, index: number) => {
    const page = 12;
    const moves: Record<string, number | undefined> = {
      ArrowDown: index + 1, ArrowUp: index - 1,
      PageDown: Math.min(filteredRows.length - 1, index + page), PageUp: Math.max(0, index - page),
      Home: 0, End: filteredRows.length - 1,
    };
    const next = moves[event.key];
    if (next !== undefined) {
      event.preventDefault();
      focusListingRow(Math.max(0, Math.min(filteredRows.length - 1, next)));
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const row = filteredRows[index];
      if (row) selectRow(row);
    }
  };

  const selectAnalysisByte = (offset: number) => {
    const row = disassembly?.rows.find((candidate) => offset >= candidate.offset && offset < candidate.offset + candidate.bytes.length);
    if (!row) return;
    selectRow(row); setSelectedByteOffset(offset);
  };

  /* Every edit below goes through the same recorded document, so each one is a
   * single undoable step and each one re-runs the analysis it affects. */
  const editAnnotations = (change: (base: AnalysisAnnotations) => AnalysisAnnotations, description: string) => {
    if (!annotations) { onNotice('Load a file into the analyser before recording anything about it'); return; }
    try { onAnnotationsChange(change(annotations), description); }
    catch (error) { onNotice(`Annotation refused · ${error instanceof Error ? error.message : String(error)}`); }
  };

  const renameLabel = () => {
    if (selectedAddress === null) return;
    const next = labelDraft.trim();
    editAnnotations(
      (base) => withLabel(base, selectedAddress, next),
      next ? `Label ${analysisAddress(selectedAddress)} as ${next}` : `Remove the label at ${analysisAddress(selectedAddress)}`,
    );
  };

  const applyComment = () => {
    if (selectedAddress === null) return;
    const next = commentDraft.trim();
    editAnnotations(
      (base) => withComment(base, selectedAddress, next),
      next ? `Comment ${analysisAddress(selectedAddress)}` : `Remove the comment at ${analysisAddress(selectedAddress)}`,
    );
  };

  const markRegion = (kind: AnalysisRegionKind) => {
    if (selectedAddress === null || !disassembly) return;
    const row = disassembly.rows.find((item) => item.address === selectedAddress);
    const parsedEnd = parseHexAddress(regionEndDraft, 4);
    const end = regionEndDraft.trim() ? parsedEnd : selectedAddress + (row ? row.bytes.length - 1 : 0);
    if (end === null) { onNotice('The end of a marked span must be a 16-bit hexadecimal address'); return; }
    if (end < selectedAddress) { onNotice('The end of a marked span cannot come before its start'); return; }
    editAnnotations(
      (base) => withRegion(base, { start: selectedAddress, end, kind }),
      `Mark ${analysisAddress(selectedAddress)}–${analysisAddress(end)} as ${kind}`,
    );
  };

  const clearRegion = () => {
    if (selectedAddress === null) return;
    editAnnotations((base) => withoutRegionAt(base, selectedAddress), `Clear the marking at ${analysisAddress(selectedAddress)}`);
  };

  const toggleEntryPoint = () => {
    if (selectedAddress === null || !annotations) return;
    const present = annotations.entryPoints.includes(selectedAddress);
    editAnnotations(
      (base) => present ? withoutEntryPoint(base, selectedAddress) : withEntryPoint(base, selectedAddress),
      `${present ? 'Remove' : 'Add'} the entry point at ${analysisAddress(selectedAddress)}`,
    );
  };

  const recordIndirectTargets = () => {
    if (selectedAddress === null) return;
    const parts = indirectDraft.split(/[\s,]+/).filter(Boolean);
    if (!parts.length) {
      editAnnotations((base) => withoutIndirectTarget(base, selectedAddress), `Remove the recorded flow from ${analysisAddress(selectedAddress)}`);
      return;
    }
    const targets: number[] = [];
    for (const part of parts) {
      const address = parseHexAddress(part, 4);
      if (address === null) { onNotice(`${part} is not a 16-bit hexadecimal address`); return; }
      targets.push(address);
    }
    editAnnotations(
      (base) => withIndirectTarget(base, { from: selectedAddress, targets }),
      `Record flow from ${analysisAddress(selectedAddress)} to ${targets.map(analysisAddress).join(', ')}`,
    );
  };

  const exportListing = () => {
    if (!file) return;
    let text = '';
    if (file.analysis.kind === 'bbc-basic') {
      text = file.analysis.lines.map((line) => line.label ? `${line.lineNumber}${line.label}${line.source}` : `${line.lineNumber} ${line.source}`).join('\n');
    } else if (file.analysis.kind === 'text') {
      text = file.analysis.text;
    } else {
      text = file.analysis.rows.map((row) => {
        const label = displayLabel(row.address);
        const instruction = `${row.mnemonic}${row.operand ? ` ${displayOperand(row)}` : ''}`;
        return `${label ? `.${label}\n` : ''}${analysisAddress(row.address)}  ${row.bytes.map(formatByte).join(' ').padEnd(23)}  ${instruction.padEnd(30)}${row.comment ? ` ; ${row.comment}` : ''}`;
      }).join('\n');
    }
    downloadBlob(new Blob([text, '\n'], { type: 'text/plain;charset=utf-8' }), `${file.name}.listing.txt`);
    onNotice(`Exported readable listing for ${file.name}`);
  };

  const exportStructuredAnalysis = async () => {
    if (!file) return;
    const document = await createAnalysisDocument(file, processor, customLabels, annotations ?? undefined);
    downloadBlob(
      new Blob([JSON.stringify(document, null, 2), '\n'], { type: 'application/json' }),
      `${file.name}.analysis.json`,
    );
    onNotice(`Exported structured analysis and SHA-256 provenance for ${file.name}`);
  };

  const exportAssemblySource = () => {
    if (!file || !assemblySource?.verified) return;
    downloadBlob(new Blob([assemblySource.source], { type: 'text/plain;charset=utf-8' }), `${file.name}.${assemblySource.filenameExtension}`);
    onNotice(`Exported verified assembly source for ${file.name} · ${assemblySource.verificationMessage}`);
  };

  const verifyOrExportArmSource = async () => {
    if (!file || !disassembly || !armAssemblySource) return;
    if (armVerification?.verified) {
      downloadBlob(new Blob([armAssemblySource.source], { type: 'text/plain;charset=utf-8' }), `${file.name}.${armAssemblySource.filenameExtension}`);
      onNotice(`Exported native-verified ARM source for ${file.name}`);
      return;
    }
    armVerificationAbort.current?.abort();
    const controller = new AbortController(); armVerificationAbort.current = controller;
    setArmVerifying(true); setArmVerification(null);
    try {
      const result = await verifyArmAssemblySource(armAssemblySource, disassembly, file.bytes, controller.signal);
      if (armVerificationAbort.current !== controller) return;
      setArmVerification(result); onNotice(result.verificationMessage);
    } catch (error) {
      if (armVerificationAbort.current !== controller) return;
      const result = { verified: false, diagnostics: [], verificationMessage: `Native ARM verification could not complete: ${error instanceof Error ? error.message : String(error)}` };
      setArmVerification(result); onNotice(result.verificationMessage);
    } finally {
      if (armVerificationAbort.current === controller) { armVerificationAbort.current = null; setArmVerifying(false); }
    }
  };

  if (!file) {
    return (
      <div className="analysis-empty">
        <div className="placeholder-icon"><Icon name="terminal" size={30} /></div>
        <span className="eyebrow">LOCAL · PRIVATE · READ-ONLY</span>
        <h2>{activity.status === 'running' ? 'Analysing file' : 'File analyser'}</h2>
        <p>{activity.status === 'idle' ? 'Load an Atom/BBC BASIC program or 6502/65C02/ARM2/ARM3 binary. Files remain in this browser and are never executed.' : activity.message}</p>
        {activity.status === 'running' ? <button type="button" onClick={onCancel}>Cancel analysis</button> : <button className="primary-action" type="button" onClick={onOpen}><Icon name="open" size={16} /> Choose Acorn file</button>}
        <small>Select one data file plus an optional matching .inf sidecar · 4 MiB input limit</small>
      </div>
    );
  }

  const metadataDescription = file.metadata.source === 'sidecar'
    ? file.metadata.sidecarName ?? '.inf sidecar'
    : file.metadata.source === 'container' ? file.metadata.containerFormat ?? 'embedded container'
    : file.metadata.source === 'project-manifest' ? 'versioned build manifest'
    : file.metadata.source === 'filename' ? 'host filename suffix' : 'manual defaults';

  return (
    <div className="analysis-workspace">
      <div className="analysis-toolbar">
        <div className="analysis-file-identity">
          <span className={`analysis-kind kind-${file.analysis.kind}`}>{file.analysis.kind === 'bbc-basic' ? 'BASIC' : file.analysis.kind === 'machine-code' ? processor.toUpperCase() : 'TEXT'}</span>
          <div><strong>{file.name}</strong><small>{file.bytes.length.toLocaleString()} bytes · local analysis</small></div>
        </div>
        {file.analysis.kind === 'machine-code' && (
          <div className="analysis-options" aria-label="Disassembly options">
            <label><span>CPU</span><select aria-label="Analysis processor" value={processor} onChange={(event) => onProcessorChange(event.target.value as AnalysisProcessor)}><option value="6502">NMOS 6502</option><option value="65c02">65C02 / 65C12</option><option value="arm2">ARM2 · 26-bit</option><option value="arm3">ARM3 · 26-bit</option></select></label>
            <label><span>Load</span><input aria-label="Load address" value={origin} onChange={(event) => onOriginChange(event.target.value)} /></label>
            <label><span>Entry</span><input aria-label="Entry address" value={entryPoint} onChange={(event) => onEntryChange(event.target.value)} /></label>
            <button type="button" disabled={activity.status === 'running'} onClick={onReanalyse}>Re-analyse</button>
          </div>
        )}
        <div className="analysis-actions">
          <button type="button" onClick={onOpen}><Icon name="open" size={14} /> Open</button>
          <button type="button" onClick={exportListing}><Icon name="download" size={14} /> Listing</button>
          {disassembly && (processor === '6502' || processor === '65c02') && <button type="button" disabled={!assemblySource?.verified} title={assemblySource?.verificationMessage} onClick={exportAssemblySource}><Icon name="download" size={14} /> Verified source</button>}
          {disassembly && (processor === '6502' || processor === '65c02') && assemblySource?.verified && <button type="button" onClick={() => file && onAddSource(`${file.name}.${assemblySource.filenameExtension}`, assemblySource.source)}>Add source to project</button>}
          {armAssemblySource && <button type="button" disabled={armVerifying} title={armVerification?.verificationMessage ?? 'Run the isolated native GNU ARM toolchain before download is enabled'} onClick={() => void verifyOrExportArmSource()}>{armVerification?.verified ? <Icon name="download" size={14} /> : null}{armVerifying ? 'Verifying…' : armVerification?.verified ? 'Verified source' : 'Verify ARM source'}</button>}
          {armAssemblySource && armVerification?.verified && <button type="button" onClick={() => file && onAddSource(`${file.name}.${armAssemblySource.filenameExtension}`, armAssemblySource.source)}>Add source to project</button>}
          <button type="button" onClick={() => void exportStructuredAnalysis()}><Icon name="download" size={14} /> Analysis JSON</button>
        </div>
      </div>
      {activity.status !== 'idle' && <div className={activity.status === 'failed' ? 'analysis-warning' : 'analysis-progress'} role={activity.status === 'failed' ? 'alert' : 'status'}><span>{activity.message}</span>{activity.status === 'running' && <button type="button" onClick={onCancel}>Cancel</button>}</div>}

      <div className="metadata-strip" aria-label="Acorn file metadata">
        <div><span>Metadata source</span><strong>{metadataDescription}</strong></div>
        <div><span>Catalogue name</span><strong>{file.metadata.catalogueName ?? 'not supplied'}</strong></div>
        <div><span>Load word</span><strong>{formatMetadataWord(file.metadata.load)}</strong></div>
        <div><span>Execute word</span><strong>{formatMetadataWord(file.metadata.execute)}</strong></div>
        <div><span>Declared length</span><strong>{file.metadata.declaredLength?.toLocaleString() ?? 'not supplied'}</strong></div>
        {file.metadata.containerByteLength !== undefined && <div><span>Container length</span><strong>{file.metadata.containerByteLength.toLocaleString()}</strong></div>}
        {file.metadata.filetype !== undefined && <div><span>RISC OS filetype</span><strong>&amp;{file.metadata.filetype.toString(16).toUpperCase().padStart(3, '0')}</strong></div>}
        {file.metadata.addressSpace && <div><span>Address space</span><strong>{file.metadata.addressSpace}</strong></div>}
        {file.metadata.bank && <div><span>Bank</span><strong>{file.metadata.bank}</strong></div>}
        {file.metadata.buildTargetId && <div><span>Build target</span><strong>{file.metadata.buildTargetId}</strong></div>}
        {file.metadata.buildFingerprint && <div><span>Build fingerprint</span><strong>{file.metadata.buildFingerprint}</strong></div>}
        <div><span>Access</span><strong>{file.metadata.locked === undefined ? 'not supplied' : file.metadata.locked ? 'Locked' : 'Unlocked'}</strong></div>
      </div>
      {file.metadata.warnings.map((warning) => <div className="analysis-warning metadata-warning" key={warning}>{warning}</div>)}

      {file.analysis.kind === 'bbc-basic' ? (
        <div className="basic-analysis">
          <div className="analysis-summary-strip">
            <span><strong>{file.analysis.dialect}</strong> detected</span>
            <span>{file.analysis.lines.length.toLocaleString()} lines</span>
            <span>{file.analysis.programLength.toLocaleString()} program bytes</span>
            {file.analysis.trailingByteCount > 0 && <span className="warning-text">{file.analysis.trailingByteCount.toLocaleString()} trailing bytes preserved</span>}
          </div>
          {file.analysis.warnings.map((warning) => <div className="analysis-warning" key={warning}>{warning}</div>)}
          <ol className="basic-listing" aria-label={`${file.analysis.dialect} listing`}>
            {file.analysis.lines.map((line) => (
              <li key={`${line.lineNumber}-${line.offset}`}><button type="button" title={`Stored offset &${line.offset.toString(16).toUpperCase()} · ${line.byteLength} bytes`}>{line.lineNumber}{line.label ?? ''}</button><code>{line.source}</code>{line.references?.length ? <small title="Control-flow targets">→ {line.references.join(', ')}</small> : null}</li>
            ))}
          </ol>
        </div>
      ) : file.analysis.kind === 'text' ? (
        <div className="text-analysis"><pre>{file.analysis.text}</pre></div>
      ) : (
        <div className="disassembly-layout">
          <div className="disassembly-main">
            <div className="analysis-summary-strip">
              <span><strong>{file.analysis.codeByteCount.toLocaleString()}</strong> reachable code bytes</span>
              <span><strong>{file.analysis.dataByteCount.toLocaleString()}</strong> data bytes</span>
              <span><strong>{Object.keys(file.analysis.labels).length}</strong> generated symbols</span>
              {history && (
                <span className="analysis-history" title={annotationHistorySummary(history)}>
                  <button type="button" disabled={!canUndoAnnotations(history)} title={undoDescription(history) ? `Undo: ${undoDescription(history)}` : 'Nothing to undo'} onClick={() => onHistoryMove('undo')}>Undo</button>
                  <button type="button" disabled={!canRedoAnnotations(history)} title={redoDescription(history) ? `Redo: ${redoDescription(history)}` : 'Nothing to redo'} onClick={() => onHistoryMove('redo')}>Redo</button>
                  <small>{annotations ? annotationSummary(annotations) : 'No annotations recorded'}</small>
                </span>
              )}
              <div className="analysis-view-switch" role="group" aria-label="Analysis byte view"><button type="button" aria-pressed={analysisView === 'listing'} onClick={() => setAnalysisView('listing')}>Listing</button><button type="button" aria-pressed={analysisView === 'hex'} onClick={() => setAnalysisView('hex')}>Hex + ASCII</button></div>
              {analysisView === 'listing' && <label className="analysis-filter"><Icon name="search" size={13} /><span className="visually-hidden">Filter listing</span><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter address, label, instruction…" /></label>}
            </div>
            {file.analysis.warnings.map((warning) => <div className="analysis-warning" key={warning}>{warning}</div>)}
            {coverage && (
              <div className={coverage.status === 'bound' ? 'analysis-coverage bound' : 'analysis-coverage'} role="status">
                <strong>Observed execution</strong>
                <span>{coverage.status === 'bound' ? coverage.summary : coverage.reason}</span>
                {coverage.status === 'bound' && <small>{coverage.reason} Static reachability and observed execution are separate evidence; neither implies the other.</small>}
              </div>
            )}
            {assemblySource && <div className={assemblySource.verified ? 'analysis-verification' : 'analysis-warning'} role="status">{assemblySource.verificationMessage}</div>}
            {armVerification && <div className={armVerification.verified ? 'analysis-verification' : 'analysis-warning'} role="status">{armVerification.verificationMessage}{armVerification.toolchain ? ` · ${armVerification.toolchain}` : ''}</div>}
            {analysisView === 'listing' ? <>
            {/* A real grid rather than a list of buttons: the columns are named
              * for a screen reader, one row at a time is in the tab order, and
              * the arrow keys move between rows instead of Tab visiting every
              * one of them in a listing that can run to thousands. */}
            <div className={coverageBound ? 'disassembly-grid with-coverage' : 'disassembly-grid'} role="grid" aria-label="Disassembly listing" aria-rowcount={filteredRows.length + 1}>
              <div className={coverageBound ? 'disassembly-header with-coverage' : 'disassembly-header'} role="row" aria-rowindex={1}>
                <span role="columnheader">Label / address</span>
                <span role="columnheader">Bytes</span>
                <span role="columnheader">Instruction</span>
                <span role="columnheader">Analysis</span>
                {coverageBound && <span role="columnheader">Observed</span>}
              </div>
              <div className="disassembly-list">
                {filteredRows.map((row, index) => {
                  const label = displayLabel(row.address);
                  const focused = selectedAddress === null ? index === 0 : selectedAddress === row.address;
                  return (
                    <div
                      className={`disassembly-row row-${row.kind}${selectedAddress === row.address ? ' selected' : ''}${coverageBound ? ' with-coverage' : ''}`}
                      role="row"
                      aria-rowindex={index + 2}
                      aria-selected={selectedAddress === row.address}
                      tabIndex={focused ? 0 : -1}
                      key={row.address}
                      data-analysis-address={row.address}
                      onClick={() => selectRow(row)}
                      onKeyDown={(event) => moveListingFocus(event, index)}
                    >
                      <span className="disassembly-location" role="gridcell">{label && <strong>{label}</strong>}<code>{analysisAddress(row.address)}</code></span>
                      <code className="disassembly-bytes" role="gridcell">{row.bytes.map(formatByte).join(' ')}</code>
                      <span className="disassembly-instruction" role="gridcell"><strong>{row.mnemonic}</strong>{row.target !== undefined ? <button type="button" className="target-link" aria-label={`Go to ${analysisAddress(row.target)}`} tabIndex={focused ? 0 : -1} onClick={(event) => { event.stopPropagation(); jumpTo(row.target!); }}>{displayOperand(row)}</button> : <code>{row.operand}</code>}</span>
                      <span className="disassembly-comment" role="gridcell">{row.comment ?? (row.references.length ? `${row.references.length} reference(s)` : '')}</span>
                      {coverageBound && <span role="gridcell" className={rowCoverage(row) === 'not observed executing' ? 'disassembly-coverage quiet' : 'disassembly-coverage'}>{rowCoverage(row)}</span>}
                    </div>
                  );
                })}
              </div>
            </div></> : <AnalysisHexView bytes={file.bytes} origin={file.analysis.origin} addressWidth={processor === 'arm2' || processor === 'arm3' ? 8 : 4} windowStart={hexWindowStart} selectedOffset={selectedByteOffset} onWindowChange={setHexWindowStart} onSelect={selectAnalysisByte} />}
          </div>
          <aside className="analysis-inspector" aria-label="Selected disassembly row">
            <span className="eyebrow">SYMBOL INSPECTOR</span>
            {selectedAddress === null ? <p>Select an address to inspect or rename its generated symbol.</p> : (() => {
              const row = disassembly?.rows.find((item) => item.address === selectedAddress);
              return row ? <>
                <h3>{displayLabel(row.address) ?? analysisAddress(row.address)}</h3>
                <dl><div><dt>Address</dt><dd>{analysisAddress(row.address)}</dd></div><div><dt>File offset</dt><dd>+&{row.offset.toString(16).toUpperCase()}</dd></div><div><dt>Classification</dt><dd>{row.reachable ? 'Reachable code' : row.kind === 'text' ? 'Printable data' : 'Binary data'}</dd></div></dl>
                <label className="label-editor"><span>Label</span><input value={labelDraft} onChange={(event) => setLabelDraft(event.target.value)} placeholder="my_symbol" /></label>
                <button className="primary-action compact" type="button" onClick={renameLabel}>Apply label</button>
                <label className="label-editor"><span>Comment</span><input value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} placeholder="what this does" /></label>
                <button type="button" onClick={applyComment}>Apply comment</button>
                {annotationsFor6502 && (
                  <section className="analysis-annotation-controls">
                    <strong>Recorded knowledge</strong>
                    <p>Reachability cannot find an entry the loader calls from outside the file, or where a jump through a pointer goes. Record what you know and the same analysis runs again with it.</p>
                    <button type="button" onClick={toggleEntryPoint}>
                      {annotations?.entryPoints.includes(row.address) ? 'Remove entry point' : 'Treat as an entry point'}
                    </button>
                    <label className="label-editor"><span>Mark span to</span><input value={regionEndDraft} onChange={(event) => setRegionEndDraft(event.target.value)} placeholder={analysisAddress(row.address + row.bytes.length - 1)} /></label>
                    <div className="analysis-annotation-actions">
                      <button type="button" onClick={() => markRegion('code')}>Mark code</button>
                      <button type="button" onClick={() => markRegion('data')}>Mark data</button>
                      <button type="button" onClick={() => markRegion('text')}>Mark text</button>
                      <button type="button" disabled={!annotations || !regionAt(annotations, row.address)} onClick={clearRegion}>Clear marking</button>
                    </div>
                    <label className="label-editor"><span>Flow goes to</span><input value={indirectDraft} onChange={(event) => setIndirectDraft(event.target.value)} placeholder="&2000 &2010" /></label>
                    <button type="button" onClick={recordIndirectTargets}>Record flow</button>
                  </section>
                )}
                {row.kind === 'instruction' && <button type="button" onClick={() => onResearch(processor === 'arm2' || processor === 'arm3' ? 'arm' : '6502', row.mnemonic)}>Research {row.mnemonic}</button>}
                {row.kind === 'instruction' && (processor === '6502' || processor === '65c02') && <button type="button" disabled={!debugAvailable} title={debugAvailable ? 'Install an execute breakpoint in the connected emulator; this does not load the analysed file' : 'Connect the target ROM-backed emulator first'} onClick={() => onDebugAddress(row.address)}>Set live breakpoint</button>}
                <section><strong>References</strong>{row.references.length ? row.references.map((reference) => <button type="button" key={reference} onClick={() => jumpTo(reference)}>{analysisAddress(reference)}</button>) : <small>No incoming control-flow references</small>}</section>
                {row.comment && <section><strong>Interpretation</strong><p>{row.comment}</p></section>}
                <section>
                  <strong>Observed execution</strong>
                  <p>{coverageBound ? rowCoverage(row) : coverage?.reason ?? 'No machine is attached.'}</p>
                </section>
              </> : <p>The selected address is hidden by the current filter.</p>;
            })()}
          </aside>
        </div>
      )}
    </div>
  );
}

function AnalysisHexView({
  bytes, origin, addressWidth, windowStart, selectedOffset, onWindowChange, onSelect,
}: {
  bytes: Uint8Array;
  origin: number;
  addressWidth: number;
  windowStart: number;
  selectedOffset: number | null;
  onWindowChange: (offset: number) => void;
  onSelect: (offset: number) => void;
}) {
  const windowBytes = 256;
  const start = artifactWindowStart(windowStart, bytes.length, windowBytes);
  const end = Math.min(bytes.length, start + windowBytes);
  const rows = Array.from({ length: Math.ceil((end - start) / 16) }, (_, index) => start + index * 16);
  const selected = selectedOffset === null ? undefined : bytes[selectedOffset];
  return <div className="analysis-hex-view">
    <div className="artifact-inspector-status" role="status">Showing offsets +&amp;{start.toString(16).toUpperCase()}–+&amp;{Math.max(start, end - 1).toString(16).toUpperCase()} of {bytes.length.toLocaleString()} bytes{selected === undefined ? '' : ` · selected ${formatAddress(origin + selectedOffset!, addressWidth)} = ${formatByte(selected)}`}</div>
    <div className="artifact-hex-table" role="table" aria-label="Analysis hexadecimal bytes">
      <div className="artifact-hex-head" role="row"><span>Address</span><span>00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F</span><span>ASCII</span></div>
      {rows.map((offset) => {
        const rowBytes = bytes.slice(offset, Math.min(offset + 16, end));
        return <div role="row" className="artifact-hex-row" key={offset}>
          <button type="button" onClick={() => onSelect(offset)}>{formatAddress(origin + offset, addressWidth)}</button>
          <span>{Array.from(rowBytes).map((byte, index) => <button type="button" aria-label={`Select analysis byte at ${formatAddress(origin + offset + index, addressWidth)}: ${formatByte(byte)}`} aria-pressed={selectedOffset === offset + index} onClick={() => onSelect(offset + index)} key={index}>{formatByte(byte)}</button>)}</span>
          <code>{Array.from(rowBytes, (byte) => byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '·').join('')}</code>
        </div>;
      })}
    </div>
    <div className="artifact-window-nav"><button type="button" disabled={start === 0} onClick={() => onWindowChange(artifactWindowStart(start - windowBytes, bytes.length, windowBytes))}>Previous 256 bytes</button><span>{start.toLocaleString()}–{end.toLocaleString()} / {bytes.length.toLocaleString()}</span><button type="button" disabled={end >= bytes.length} onClick={() => onWindowChange(artifactWindowStart(start + windowBytes, bytes.length, windowBytes))}>Next 256 bytes</button></div>
  </div>;
}

function formatAddress(value: number, width = value > 0xffff ? 8 : 4): string {
  return `&${value.toString(16).toUpperCase().padStart(width, '0')}`;
}

function formatByte(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, '0');
}

function formatMetadataWord(value: number | undefined): string {
  return value === undefined ? 'not supplied' : `&${value.toString(16).toUpperCase().padStart(8, '0')}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function safeFilename(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'acorn-project';
}

function flattenAdfsEntries(entries: AdfsFileEntry[]): AdfsFileEntry[] {
  return entries.flatMap((entry) => [entry, ...flattenAdfsEntries(entry.children ?? [])]);
}

function ResearchWorkspace({ target, request, onNotice }: { target: LanguageTargetContext; request?: ResearchRequest; onNotice: (message: string) => void }) {
  const [language, setLanguage] = useState<ResearchRequest['language']>('bbc-basic');
  const [kind, setKind] = useState<'all' | LanguageItem['kind']>('all');
  const [query, setQuery] = useState('');
  const [selectedToken, setSelectedToken] = useState('');
  const items = useMemo(() => referenceItems(language, target), [language, target]);
  const availableKinds = useMemo(() => Array.from(new Set(items.map((item) => item.kind))).sort(), [items]);
  useEffect(() => {
    if (!request) return;
    setLanguage(request.language); setKind('all'); setQuery(request.query); setSelectedToken(request.query);
  }, [request]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => (kind === 'all' || item.kind === kind)
      && (!needle || [item.token, item.kind, item.detail, item.signature].some((value) => value?.toLowerCase().includes(needle))));
  }, [items, kind, query]);
  const selected = filtered.find((item) => item.token === selectedToken) ?? filtered[0];
  const copySyntax = () => {
    if (!selected) return;
    const value = selected.signature ?? selected.token;
    navigator.clipboard?.writeText(value).then(() => onNotice(`${selected.token} syntax copied`)).catch(() => onNotice('Clipboard permission was denied'));
  };
  return <div className="research-workspace">
    <div className="runtime-heading"><div><span className="eyebrow">OFFLINE LANGUAGE KNOWLEDGE</span><h2>Acorn reference</h2></div>{selected && <div className="runtime-actions"><button type="button" onClick={copySyntax}>Copy syntax</button></div>}</div>
    <div className="research-toolbar"><div className="research-language" role="group" aria-label="Reference language">{([['bbc-basic', target.machineId === 'atom' ? 'Atom BASIC' : 'BBC BASIC'], ['6502', '6502 / 65C12'], ['arm', 'ARM2 / ARM3'], ['c', 'BBC C']] as Array<[ResearchRequest['language'], string]>).map(([id, label]) => <button type="button" className={language === id ? 'active' : ''} aria-pressed={language === id} onClick={() => { setLanguage(id); setKind('all'); setSelectedToken(''); }} key={id}>{label}</button>)}</div><label><span className="visually-hidden">Search reference</span><input type="search" aria-label="Search reference" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search commands, syntax and descriptions" /></label><label><span className="visually-hidden">Reference category</span><select aria-label="Reference category" value={kind} onChange={(event) => setKind(event.target.value as 'all' | LanguageItem['kind'])}><option value="all">All categories</option>{availableKinds.map((value) => <option value={value} key={value}>{value.toUpperCase()}</option>)}</select></label><span className="research-count" aria-live="polite">{filtered.length} entries</span></div>
    <div className="research-layout"><div className="research-results" role="listbox" aria-label="Reference results">{filtered.length ? filtered.map((item) => <button type="button" role="option" aria-selected={selected?.token === item.token} className={selected?.token === item.token ? 'selected' : ''} onClick={() => setSelectedToken(item.token)} key={`${item.kind}-${item.token}`}><code>{item.token}</code><span>{item.kind}</span><small>{item.signature}</small></button>) : <div className="honest-empty">No reference entries match this search.</div>}</div><article className="reference-detail" aria-live="polite">{selected ? <><span className="state-pill supported">{selected.kind}</span><h3>{selected.token}</h3>{selected.signature && <pre>{selected.signature}</pre>}<p>{selected.detail}</p><dl><div><dt>Language</dt><dd>{language === 'bbc-basic' ? target.machineId === 'atom' ? 'Atom BASIC' : 'BBC BASIC' : language === '6502' ? '6502 family assembly' : language === 'arm' ? 'ARM2/ARM3 assembly' : 'cc65 BBC C'}</dd></div><div><dt>Available offline</dt><dd>Yes</dd></div><div><dt>Shared with editor</dt><dd>Completion and hover help</dd></div></dl></> : <div className="honest-empty">Choose a different query or category.</div>}</article></div>
  </div>;
}

function VersionedPixelAssetWorkspace({ kind, projectPalette, onAddSource, onAddLiveAsset, onNotice }: { kind: 'Characters' | 'Sprites' | 'Tiles'; projectPalette: ProjectPalette; onAddSource: (name: string, content: string) => void; onAddLiveAsset: (stem: string, content: string) => void; onNotice: (message: string) => void }) {
  const kindId: PixelAssetKind = kind === 'Characters' ? 'character' : kind === 'Sprites' ? 'sprite' : 'tile';
  const storageKey = `8bit-net-dev:pixel-asset:${kind.toLowerCase()}`;
  const recovered = useMemo(() => {
    try { const saved = localStorage.getItem(storageKey); if (saved) return parsePixelAssetDocument(saved, kindId); }
    catch { /* invalid recovery starts a new validated document */ }
    return createPixelAssetDocument(kindId);
  }, [kindId, storageKey]);
  const [history, setHistory] = useState<{ past: PixelAssetDocument[]; present: PixelAssetDocument; future: PixelAssetDocument[] }>({ past: [], present: recovered, future: [] });
  const [colour, setColour] = useState(1);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selection, setSelection] = useState<PixelSelection>();
  const [selectionAnchor, setSelectionAnchor] = useState<PixelPoint>();
  const [clipboard, setClipboard] = useState<PixelClipboard>();
  const [zoom, setZoom] = useState(1);
  const [editPlane, setEditPlane] = useState<'colour' | 'mask'>('colour');
  const [activeFrameIndex, setActiveFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const storedDocument = history.present;
  const frames = useMemo(() => pixelAssetFrames(storedDocument), [storedDocument]);
  const activeFrame = frames[Math.min(activeFrameIndex, frames.length - 1)]!;
  const document = activeFrameIndex === 0 || !storedDocument.sprite ? storedDocument : { ...storedDocument, pixels: activeFrame.pixels, sprite: { ...storedDocument.sprite, mask: activeFrame.mask!, hotspot: activeFrame.hotspot!, frame: { name: activeFrame.name, durationMs: activeFrame.durationMs } } };
  const output = useMemo(() => generatePixelAssetOutput(storedDocument), [storedDocument]);
  const commit = (next: PixelAssetDocument) => setHistory((current) => ({ past: [...current.past, current.present].slice(-100), present: next, future: [] }));
  const update = (changes: Partial<PixelAssetDocument>) => {
    if (activeFrameIndex > 0 && storedDocument.sprite && (changes.pixels || changes.sprite)) {
      const frameChanges = { ...(changes.pixels ? { pixels: changes.pixels } : {}), ...(changes.sprite ? { mask: changes.sprite.mask, hotspot: changes.sprite.hotspot, name: changes.sprite.frame.name, durationMs: changes.sprite.frame.durationMs } : {}) };
      const frameUpdated = updatePixelSpriteFrame(storedDocument, activeFrameIndex, frameChanges);
      const { pixels: _pixels, sprite: _sprite, ...documentChanges } = changes;
      commit({ ...frameUpdated, ...documentChanges }); return;
    }
    commit({ ...storedDocument, ...changes });
  };
  const undo = () => setHistory((current) => current.past.length ? { past: current.past.slice(0, -1), present: current.past.at(-1)!, future: [current.present, ...current.future].slice(0, 100) } : current);
  const redo = () => setHistory((current) => current.future.length ? { past: [...current.past, current.present].slice(-100), present: current.future[0]!, future: current.future.slice(1) } : current);
  useEffect(() => { localStorage.setItem(storageKey, serializePixelAssetDocument(storedDocument)); }, [storedDocument, storageKey]);
  useEffect(() => { if (editPlane === 'mask') { setSelectionMode(false); setSelectionAnchor(undefined); } }, [editPlane]);
  useEffect(() => { if (activeFrameIndex >= frames.length) setActiveFrameIndex(Math.max(0, frames.length - 1)); }, [activeFrameIndex, frames.length]);
  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const timer = window.setTimeout(() => setActiveFrameIndex((current) => {
      const next = current + 1;
      if (next < frames.length) return next;
      if (storedDocument.sprite?.animation?.playback === 'once') { setPlaying(false); return current; }
      return 0;
    }), activeFrame.durationMs);
    return () => window.clearTimeout(timer);
  }, [activeFrame.durationMs, activeFrameIndex, frames.length, playing, storedDocument.sprite?.animation?.playback]);

  const resize = (nextWidth: number, nextHeight: number) => {
    setSelection(undefined); setSelectionAnchor(undefined); commit(resizePixelAssetDocument(storedDocument, nextWidth, nextHeight));
  };
  const paint = (index: number, value = colour) => update({ pixels: document.pixels.map((pixel, candidate) => candidate === index ? value : pixel) });
  const shift = (dx: number, dy: number) => update({ pixels: Array.from({ length: document.pixels.length }, (_, index) => {
    const x = index % document.width; const y = Math.floor(index / document.width);
    return document.pixels[((y - dy + document.height) % document.height) * document.width + ((x - dx + document.width) % document.width)]!;
  }) });
  const stem = safeFilename(document.name);
  const importDocument = async (file?: File) => {
    if (!file) return;
    try {
      const imported = parsePixelAssetDocument(await file.text(), kindId);
      if (imported.kind !== kindId) throw new Error(`This ${kind} workspace cannot open a ${imported.kind} document`);
      setActiveFrameIndex(0); setPlaying(false); commit(imported); onNotice(`${imported.name} opened as a versioned pixel asset`);
    } catch (error) { onNotice(`Asset import refused · ${error instanceof Error ? error.message : String(error)}`); }
  };
  const downloadBinary = () => { downloadBlob(new Blob([output.bytes], { type: 'application/octet-stream' }), `${stem}.bin`); onNotice(`${storedDocument.name} exported · ${output.bytes.length} packed 2bpp bytes across ${frames.length} frame${frames.length === 1 ? '' : 's'}`); };
  const toggleMask = (index: number) => { if (document.sprite) update({ sprite: { ...document.sprite, mask: document.sprite.mask.map((bit, candidate) => candidate === index ? 1 - bit : bit) } }); };
  const chooseSelectionPoint = (point: PixelPoint) => {
    if (!selectionAnchor) { setSelectionAnchor(point); setSelection({ start: point, end: point }); return; }
    setSelection({ start: selectionAnchor, end: point }); setSelectionAnchor(undefined);
  };
  const copySelection = (cut = false) => {
    if (!selection) return;
    const copied = copyPixelSelection(document.pixels, document.width, document.height, selection); setClipboard(copied);
    navigator.clipboard?.writeText(JSON.stringify(copied)).catch(() => undefined);
    if (cut) update({ pixels: fillPixelSelection(document.pixels, document.width, selection, 0) });
    onNotice(`${copied.width}×${copied.height} pixel selection ${cut ? 'cut' : 'copied'}`);
  };
  const pasteSelection = async () => {
    let copied = clipboard;
    if (!copied) try { const external = await navigator.clipboard?.readText(); if (external) copied = parsePixelClipboard(external); } catch { /* a missing browser permission is reported by the normal empty-clipboard path */ }
    if (!copied) { onNotice('Copy a pixel selection before pasting'); return; }
    const destination = selection ? { x: selectionBounds(selection).left, y: selectionBounds(selection).top } : { x: 0, y: 0 };
    update({ pixels: pastePixelSelection(document.pixels, document.width, document.height, copied, destination) });
    setSelection({ start: destination, end: { x: Math.min(document.width - 1, destination.x + copied.width - 1), y: Math.min(document.height - 1, destination.y + copied.height - 1) } });
    onNotice(`${copied.width}×${copied.height} pixel selection pasted`);
  };

  return <div className="pixel-workspace">
    <div className="runtime-heading">
      <div><span className="eyebrow">VERSIONED ACORN 2BPP ASSET · SCHEMA 1</span><h2>{kind} editor</h2></div>
      <div className="runtime-actions"><button type="button" disabled={!history.past.length} onClick={undo}>Undo</button><button type="button" disabled={!history.future.length} onClick={redo}>Redo</button><button type="button" onClick={() => downloadBlob(new Blob([serializePixelAssetDocument(storedDocument)], { type: 'application/json' }), `${stem}.asset.json`)}><Icon name="download" size={14} /> Document</button><button type="button" onClick={() => onAddSource(`${stem}.asset.json`, serializePixelAssetDocument(storedDocument))}>Add document</button><button type="button" onClick={() => onAddSource(`${stem}.asm`, `${output.assembly}\n`)}>Add EQUB source</button><button type="button" onClick={downloadBinary}><Icon name="download" size={14} /> Binary</button></div>
    </div>
    <div className="pixel-encoding-toolbar"><label><span>Generated byte encoding</span><select aria-label="Pixel asset byte encoding" value={document.target.packing} onChange={(event) => update({ target: { ...document.target, packing: event.target.value as PixelAssetDocument['target']['packing'] } })}><option value="logical-2bpp-msb-groups">Logical 2bpp interchange (not screen memory)</option><option value="bbc-mode-5-hardware-interleaved-2bpp">BBC Micro MODE 5 screen bytes</option></select></label><span>{document.target.packing === 'bbc-mode-5-hardware-interleaved-2bpp' ? 'Hardware bit-plane order · four pixels per byte' : 'Portable logical groups · choose a hardware codec before writing screen memory'}</span></div>
    {document.sprite && <div className="sprite-metadata-toolbar"><div role="radiogroup" aria-label="Sprite editing plane"><button type="button" role="radio" aria-checked={editPlane === 'colour'} onClick={() => setEditPlane('colour')}>Edit colour</button><button type="button" role="radio" aria-checked={editPlane === 'mask'} onClick={() => setEditPlane('mask')}>Edit opacity mask</button></div><label><span>Hotspot X</span><select aria-label="Sprite hotspot X" value={document.sprite.hotspot.x} onChange={(event) => update({ sprite: { ...document.sprite!, hotspot: { ...document.sprite!.hotspot, x: Number(event.target.value) } } })}>{Array.from({ length: document.width }, (_, value) => <option value={value} key={value}>{value}</option>)}</select></label><label><span>Y</span><select aria-label="Sprite hotspot Y" value={document.sprite.hotspot.y} onChange={(event) => update({ sprite: { ...document.sprite!, hotspot: { ...document.sprite!.hotspot, y: Number(event.target.value) } } })}>{Array.from({ length: document.height }, (_, value) => <option value={value} key={value}>{value}</option>)}</select></label><button type="button" onClick={() => update({ sprite: { ...document.sprite!, mask: Array(document.pixels.length).fill(1) } })}>All opaque</button><button type="button" onClick={() => update({ sprite: { ...document.sprite!, mask: Array(document.pixels.length).fill(0) } })}>All transparent</button><button type="button" disabled={!output.maskBytes} onClick={() => output.maskBytes && downloadBlob(new Blob([output.maskBytes], { type: 'application/octet-stream' }), `${stem}.mask.bin`)}><Icon name="download" size={14} /> Mask</button></div>}
    {document.sprite && <div className="sprite-animation-toolbar"><div><strong>Animation frames</strong><span>{frames.length} frame{frames.length === 1 ? '' : 's'} · build output is ordered exactly as shown</span></div><div className="sprite-frame-tabs" role="tablist" aria-label="Sprite animation frames">{frames.map((frame, index) => <button type="button" role="tab" aria-selected={index === activeFrameIndex} className={index === activeFrameIndex ? 'selected' : ''} onClick={() => { setPlaying(false); setActiveFrameIndex(index); setSelection(undefined); }} key={frame.id}><strong>{index + 1}</strong><span>{frame.name}</span><small>{frame.durationMs} ms</small></button>)}</div><label><span>Frame name</span><input aria-label="Sprite frame name" maxLength={40} value={activeFrame.name} onChange={(event) => commit(updatePixelSpriteFrame(storedDocument, activeFrameIndex, { name: event.target.value || `Frame ${activeFrameIndex + 1}` }))} /></label><label><span>Duration ms</span><input aria-label="Sprite frame duration" type="number" min={20} max={60000} value={activeFrame.durationMs} onChange={(event) => { const durationMs = Math.max(20, Math.min(60000, Number(event.target.value) || 20)); commit(updatePixelSpriteFrame(storedDocument, activeFrameIndex, { durationMs })); }} /></label><label className="sprite-playback"><span>Playback</span><select aria-label="Sprite animation playback" value={storedDocument.sprite?.animation?.playback ?? 'loop'} onChange={(event) => { const next = structuredClone(storedDocument); next.sprite!.animation ??= { playback: 'loop', frames: [] }; next.sprite!.animation.playback = event.target.value as 'loop' | 'once'; commit(next); }}><option value="loop">Loop</option><option value="once">Once</option></select></label><button type="button" disabled={frames.length < 2} aria-pressed={playing} onClick={() => { if (playing) setPlaying(false); else { setActiveFrameIndex(0); setPlaying(true); } }}>{playing ? 'Stop preview' : 'Play preview'}</button><button type="button" onClick={() => { const next = addPixelSpriteFrame(storedDocument, activeFrameIndex); commit(next); setActiveFrameIndex(pixelAssetFrames(next).length - 1); }}>Duplicate frame</button><button type="button" disabled={frames.length <= 1} onClick={() => { const next = removePixelSpriteFrame(storedDocument, activeFrameIndex); commit(next); setActiveFrameIndex(Math.min(activeFrameIndex, pixelAssetFrames(next).length - 1)); }}>Delete frame</button><button type="button" disabled={activeFrameIndex === 0} aria-label="Move sprite frame left" onClick={() => { commit(movePixelSpriteFrame(storedDocument, activeFrameIndex, -1)); setActiveFrameIndex(activeFrameIndex - 1); }}>←</button><button type="button" disabled={activeFrameIndex >= frames.length - 1} aria-label="Move sprite frame right" onClick={() => { commit(movePixelSpriteFrame(storedDocument, activeFrameIndex, 1)); setActiveFrameIndex(activeFrameIndex + 1); }}>→</button></div>}
    {selection && <div className="pixel-selection-toolbar" aria-label="Selected pixel transform"><span>Selected rectangle</span><button type="button" onClick={() => update({ pixels: transformPixelSelection(document.pixels, document.width, selection, 'flip-horizontal') })}>Flip horizontally</button><button type="button" onClick={() => update({ pixels: transformPixelSelection(document.pixels, document.width, selection, 'flip-vertical') })}>Flip vertically</button><button type="button" onClick={() => { setSelection(undefined); setSelectionAnchor(undefined); }}>Deselect</button></div>}
    <div className="pixel-editor-layout">
      <section className="pixel-controls"><h3>Document</h3><label><span>Name</span><input aria-label="Pixel asset name" maxLength={80} value={document.name} onChange={(event) => update({ name: event.target.value || `untitled-${kindId}` })} /></label><label><span>Open document</span><input aria-label="Open pixel asset document" type="file" accept=".json,.asset.json,application/json" onChange={(event) => void importDocument(event.target.files?.[0])} /></label><label><span>Width</span><select aria-label="Pixel asset width" value={document.width} onChange={(event) => resize(Number(event.target.value), document.height)}>{[8, 16, 24, 32].map((value) => <option key={value}>{value}</option>)}</select></label><label><span>Height</span><select aria-label="Pixel asset height" value={document.height} onChange={(event) => resize(document.width, Number(event.target.value))}>{[8, 16, 24, 32].map((value) => <option key={value}>{value}</option>)}</select></label><label><span>Zoom</span><select aria-label="Pixel asset zoom" value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>{[1, 2, 3, 4].map((value) => <option value={value} key={value}>{value}×</option>)}</select></label><h3>Palette index</h3><div className="pixel-palette" role="radiogroup" aria-label="Pixel colour">{[0, 1, 2, 3].map((value) => <button type="button" role="radio" aria-checked={colour === value} aria-label={`Colour ${value}, ${physicalColour(projectPalette.document?.entries[value] ?? value).name}`} className={`pixel-colour ${colour === value ? 'selected' : ''}`} style={{ background: projectPalette.colours[value] ?? projectPalette.colours[0], color: readableInk(projectPalette.colours[value] ?? projectPalette.colours[0] ?? '#000000').ink, textShadow: 'none' }} onClick={() => setColour(value)} key={value}>{value}</button>)}</div><h3>Selection</h3><button className="pixel-clear" type="button" aria-pressed={selectionMode} onClick={() => { setSelectionMode((active) => !active); setSelectionAnchor(undefined); }}>{selectionMode ? 'Painting mode' : 'Select rectangle'}</button><div className="pixel-selection-actions"><button type="button" disabled={!selection} onClick={() => copySelection()}>Copy</button><button type="button" disabled={!selection} onClick={() => copySelection(true)}>Cut</button><button type="button" disabled={!clipboard} onClick={() => void pasteSelection()}>Paste</button><button type="button" disabled={!selection} onClick={() => selection && update({ pixels: fillPixelSelection(document.pixels, document.width, selection, colour) })}>Fill</button></div><h3>Transform</h3><div className="pixel-transform"><button type="button" aria-label="Shift left" onClick={() => shift(-1, 0)}>←</button><button type="button" aria-label="Shift right" onClick={() => shift(1, 0)}>→</button><button type="button" aria-label="Shift up" onClick={() => shift(0, -1)}>↑</button><button type="button" aria-label="Shift down" onClick={() => shift(0, 1)}>↓</button></div><button className="pixel-clear" type="button" onClick={() => update({ pixels: Array(document.width * document.height).fill(0) })}>Clear asset</button></section>
      <section className="pixel-stage"><div className="pixel-pan"><div className={`pixel-grid ${selectionMode ? 'selecting' : ''} ${editPlane === 'mask' ? 'editing-mask' : ''}`} role="grid" data-essential-target-size="A cell in this grid is one pixel of the artwork. Enlarging it past the artwork would change what the editor edits, so WCAG 2.2 AA 2.5.8 is met by its essential exception. The surrounding tools are full-size targets." aria-label={`${kind} pixel grid`} style={{ gridTemplateColumns: `repeat(${document.width}, 1fr)`, width: `${document.width * 16 * zoom}px`, height: `${document.height * 16 * zoom}px` }}>{document.pixels.map((pixel, index) => { const point = { x: index % document.width, y: Math.floor(index / document.width) }; const selected = selection ? selectionContains(selection, point.x, point.y) : false; const opaque = document.sprite?.mask[index] !== 0; const hotspot = document.sprite?.hotspot.x === point.x && document.sprite?.hotspot.y === point.y; return <button type="button" role="gridcell" aria-selected={selected} aria-label={`Pixel ${point.x + 1},${point.y + 1}, colour ${pixel}${document.sprite ? opaque ? ', opaque' : ', transparent' : ''}${hotspot ? ', hotspot' : ''}${selected ? ', selected' : ''}`} className={`pixel-cell ${selected ? 'selected' : ''} ${!opaque ? 'mask-transparent' : ''} ${hotspot ? 'sprite-hotspot' : ''}`} style={{ background: projectPalette.colours[pixel] ?? projectPalette.colours[0] }} key={index} onClick={() => selectionMode ? chooseSelectionPoint(point) : editPlane === 'mask' && document.sprite ? toggleMask(index) : paint(index)} onContextMenu={(event) => { event.preventDefault(); if (!selectionMode && editPlane === 'colour') paint(index, 0); }} />; })}</div></div><p>{selectionMode ? selectionAnchor ? 'Choose the opposite corner of the rectangle.' : 'Choose the first corner of a rectangular selection.' : editPlane === 'mask' && document.sprite ? 'Click toggles independent opaque/transparent mask pixels.' : 'Left click paints; right click erases.'} Up to 100 changes are undoable; zoomed canvases pan with standard scrolling. {projectPalette.fileName ? `Previewed with ${projectPalette.fileName}.` : 'Previewed with the MODE 5 power-up palette; add a palette document to change it.'}{projectPalette.flashing.length ? ` Colours ${projectPalette.flashing.join(', ')} flash on the machine and only their first phase is shown.` : ''}</p></section>
      <TargetModePreview pixels={document.pixels} width={document.width} height={document.height} palette={projectPalette} {...(document.sprite ? { mask: document.sprite.mask } : {})} />
      <section className="pixel-output"><h3>Generated output</h3><div className="asset-summary"><span>{document.width} × {document.height}</span>{frames.length > 1 && <span>{frames.length} ordered frames</span>}<span>{output.bytes.length} colour bytes</span>{output.maskBytes && <span>{output.maskBytes.length} mask bytes</span>}<span>SHA-256 {output.manifest.sha256.slice(0, 12)}…</span>{output.manifest.maskSha256 && <span>Mask {output.manifest.maskSha256.slice(0, 12)}…</span>}</div><pre>{output.assembly}</pre></section>
    </div>
    <div className="asset-build-toolbar"><div><strong>Live project dependency</strong><span>Creates an editable document and a 6502 target using INCLUDEASSET; document and frame edits invalidate the build fingerprint.</span></div><button type="button" onClick={() => onAddLiveAsset(stem, serializePixelAssetDocument(storedDocument))}>Add live build target</button></div>
  </div>;
}

/* What a mounted UEF turned out to contain, as read rather than as assumed. */
interface TapeReport {
  chunks: Array<{ id: string; bytes: number; count: number }>;
  warnings: string[];
}

/* Reading the chunk list must never stop a tape being mounted: the emulator's
 * own cassette device is what plays it, and this is a description alongside.
 * So a file this reader cannot make sense of produces no report and no error. */
function readUefReport(bytes: Uint8Array): TapeReport | null {
  try {
    const image = readUef(bytes);
    return { chunks: describeUef(image), warnings: image.warnings };
  } catch {
    return null;
  }
}

function MediaWorkspace({ machineId, buildArtifact, artifact, armArtifact, connected, archimedesConnected, archimedesDiscConnected, discSupported, tapeSupported, mounted, onCommand, onNotice, onAnalyse }: { machineId: string; buildArtifact: BuildArtifact | null; artifact: AssemblyArtifact | null; armArtifact: ArmArtifact | null; connected: boolean; archimedesConnected: boolean; archimedesDiscConnected: boolean; discSupported: boolean; tapeSupported: boolean; mounted: MachineMedia[]; onCommand: (message: Record<string, unknown>) => void; onNotice: (message: string) => void; onAnalyse: (name: string, bytes: Uint8Array, metadata: AcornFileMetadata, overrides?: { processor?: AnalysisProcessor; origin?: number; entryPoint?: number }) => void }) {
  const archimedesTarget = machineId.startsWith('archimedes-') || machineId === 'a3000' || machineId === 'a5000';
  const [discFile, setDiscFile] = useState<File>();
  const [tapeFile, setTapeFile] = useState<File>();
  const [tapeDraft, setTapeDraft] = useState<TapeFile>();
  const [createdTape, setCreatedTape] = useState<Uint8Array>();
  const [createdTapeBlocks, setCreatedTapeBlocks] = useState(0);
  const [tapeCreatorStatus, setTapeCreatorStatus] = useState('Build a target, then write it to a cassette the machine can load.');
  const [tapeReport, setTapeReport] = useState<TapeReport | null>(null);
  const [dfsCatalogue, setDfsCatalogue] = useState<DfsCatalogue>();
  const [adfsCatalogue, setAdfsCatalogue] = useState<AdfsCatalogue>();
  const [adfsImage, setAdfsImage] = useState<Uint8Array>();
  const [adfsEditing, setAdfsEditing] = useState<string>();
  const [catalogueStatus, setCatalogueStatus] = useState('Choose an SSD image to inspect its catalogue before mounting.');
  const [drive, setDrive] = useState(0);
  const [dfsTitle, setDfsTitle] = useState('8BIT DEV');
  const [dfsName, setDfsName] = useState('PROGRAM');
  const [createdDfs, setCreatedDfs] = useState<CreatedDfsImage>();
  const [dfsProject, setDfsProject] = useState<DfsImageProject>();
  const [createdDsd, setCreatedDsd] = useState<CreatedDfsDsdImage>();
  const [dfsDsdProject, setDfsDsdProject] = useState<DfsDsdProject>();
  const [dfsFormat, setDfsFormat] = useState<'ssd' | 'dsd'>('ssd');
  const [dfsSide, setDfsSide] = useState<0 | 1>(0);
  const [dfsHostFile, setDfsHostFile] = useState<File>();
  const [atomAtmDraft, setAtomAtmDraft] = useState<AtomAtmFile>();
  const [createdAtm, setCreatedAtm] = useState<Uint8Array>();
  const [atomAtmStatus, setAtomAtmStatus] = useState('Open an ATM container or package the current Atom build.');
  const [riscOsName, setRiscOsName] = useState('WebIDE');
  const [riscOsPackage, setRiscOsPackage] = useState<RiscOsApplicationPackage>();
  const [createdAdfs, setCreatedAdfs] = useState<CreatedAdfsEImage>();
  useEffect(() => {
    const output = artifact?.provenance?.target.outputName.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '').toUpperCase().slice(0, 7);
    if (output) setDfsName(output);
    setCreatedDfs(undefined);
    setCreatedDsd(undefined);
    setDiscFile(undefined);
    setDfsCatalogue(undefined);
    setAdfsCatalogue(undefined);
    setAdfsImage(undefined);
    setAdfsEditing(undefined);
    setCatalogueStatus('Build changed; create a new DFS image or choose an image to inspect.');
  }, [artifact?.provenance?.fingerprint]);
  useEffect(() => {
    setCreatedAtm(undefined);
    if (machineId === 'atom') setAtomAtmStatus('Build changed; rebuild an ATM container before downloading or loading it.');
  }, [buildArtifact?.provenance?.fingerprint, machineId]);
  useEffect(() => {
    const output = armArtifact?.provenance?.target.outputName.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 9);
    if (output && /^[A-Za-z]/.test(output)) setRiscOsName(output);
    setRiscOsPackage(undefined);
    setCreatedAdfs(undefined);
  }, [armArtifact?.provenance?.fingerprint]);
  /* Bytes this adapter does not model are carried through an edit. Where a
   * larger catalogue has to claim some of them, that is said rather than left
   * for the user to discover by comparing images. */
  const preservationNote = (overwritten: number) => overwritten
    ? ` ${overwritten} preserved catalogue byte${overwritten === 1 ? '' : 's'} were claimed by the larger catalogue.`
    : ' Catalogue bytes this adapter does not model were preserved exactly.';
  const rebuildDfsProject = (project = dfsProject) => {
    if (!project) return;
    try {
      if (dfsFormat === 'dsd') {
        const otherSide: DfsImageProject = { title: `SIDE ${dfsSide === 0 ? 'TWO' : 'ONE'}`, cycle: 0, bootOption: 0, files: [] };
        const sides: [DfsImageProject, DfsImageProject] = dfsDsdProject ? [...dfsDsdProject.sides] : dfsSide === 0 ? [project, otherSide] : [otherSide, project];
        sides[dfsSide] = { ...project, title: dfsTitle };
        const created = createDfsDsdImage({ sides });
        const reopened = openDfsDsdProject(created.image);
        const filename = `${safeFilename(reopened.sides[0].title).toLowerCase() || 'disk'}.dsd`;
        setCreatedDsd(created); setCreatedDfs(undefined); setDfsDsdProject(reopened); setDfsProject(reopened.sides[dfsSide]);
        setDiscFile(new File([created.image], filename, { type: 'application/octet-stream' })); setDfsCatalogue(created.sides[dfsSide].catalogue);
        const totalFiles = created.sides[0].catalogue.files.length + created.sides[1].catalogue.files.length;
        const overwritten = (created.sides[0].preservedBytesOverwritten ?? 0) + (created.sides[1].preservedBytesOverwritten ?? 0);
        setCatalogueStatus(`Rebuilt and independently validated ${filename} with ${totalFiles} logical files across two DFS sides.${preservationNote(overwritten)}`); onNotice(`DFS DSD rebuilt · ${totalFiles} files · ${created.image.length.toLocaleString()} bytes${preservationNote(overwritten)}`);
        return;
      }
      const created = createDfsImageFromFiles({ ...project, title: dfsTitle }); const filename = `${safeFilename(dfsTitle).toLowerCase() || 'disk'}.ssd`;
      setCreatedDfs(created); setCreatedDsd(undefined); setDfsProject(openDfsImageProject(created.image)); setDiscFile(new File([created.image], filename, { type: 'application/octet-stream' })); setDfsCatalogue(created.catalogue);
      setCatalogueStatus(`Rebuilt and independently validated ${filename} with ${created.catalogue.files.length} logical files.${preservationNote(created.preservedBytesOverwritten ?? 0)}`); onNotice(`DFS image rebuilt · ${created.catalogue.files.length} files · ${created.image.length.toLocaleString()} bytes${preservationNote(created.preservedBytesOverwritten ?? 0)}`);
    } catch (error) { onNotice(error instanceof Error ? error.message : String(error)); }
  };
  const createDisc = () => {
    if (!artifact) return;
    const project: DfsImageProject = { title: dfsTitle, cycle: 0, bootOption: 0, files: [{ name: dfsName, directory: '$', loadAddress: artifact.origin, executionAddress: artifact.entryPoint, bytes: artifact.bytes }] };
    setDfsProject(project); rebuildDfsProject(project);
  };
  const updateSelectedDfsProject = (project: DfsImageProject) => {
    setDfsProject(project);
    if (dfsFormat === 'dsd') setDfsDsdProject((current) => {
      const other: DfsImageProject = { title: `SIDE ${dfsSide === 0 ? 'TWO' : 'ONE'}`, cycle: 0, bootOption: 0, files: [] };
      const sides: [DfsImageProject, DfsImageProject] = current ? [...current.sides] : dfsSide === 0 ? [project, other] : [other, project];
      sides[dfsSide] = project;
      return { sides };
    });
  };
  const addBuildToDfsProject = () => {
    if (!artifact) return;
    const base = dfsProject ?? { title: dfsTitle, cycle: 0, bootOption: 0, files: [] };
    const identity = `$.${dfsName}`.toUpperCase(); if (base.files.some((file) => `${file.directory ?? '$'}.${file.name}`.toUpperCase() === identity)) { onNotice(`DFS project already contains $.${dfsName}; rename or remove it first`); return; }
    const project: DfsImageProject = { ...base, files: [...base.files, { name: dfsName, directory: '$', loadAddress: artifact.origin, executionAddress: artifact.entryPoint, bytes: artifact.bytes }] };
    updateSelectedDfsProject(project); rebuildDfsProject(project);
  };
  const addHostFileToDfsProject = async () => {
    if (!dfsHostFile) return;
    if (!dfsHostFile.size || dfsHostFile.size > 798 * 256) { onNotice('A DFS host file must contain 1–204,288 bytes'); return; }
    const name = dfsHostFile.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_!]/g, '').toUpperCase().slice(0, 7) || 'FILE';
    const base = dfsProject ?? { title: dfsTitle, cycle: 0, bootOption: 0, files: [] };
    const identity = `$.${name}`.toUpperCase(); if (base.files.some((file) => `${file.directory ?? '$'}.${file.name}`.toUpperCase() === identity)) { onNotice(`DFS project already contains $.${name}; rename or remove it first`); return; }
    const project: DfsImageProject = { ...base, files: [...base.files, { name, directory: '$', loadAddress: 0, executionAddress: 0, bytes: new Uint8Array(await dfsHostFile.arrayBuffer()) }] };
    updateSelectedDfsProject(project); rebuildDfsProject(project); setDfsHostFile(undefined);
  };
  const invalidateDfsOutput = () => {
    setCreatedDfs(undefined);
    setCreatedDsd(undefined);
    setDiscFile(undefined);
    setDfsCatalogue(undefined);
    setCatalogueStatus('DFS logical draft changed; rebuild and validate before downloading or mounting it.');
  };
  const updateDfsFile = (index: number, patch: Partial<DfsImageProject['files'][number]>) => {
    invalidateDfsOutput();
    if (!dfsProject) return;
    updateSelectedDfsProject({ ...dfsProject, files: dfsProject.files.map((file, position) => position === index ? { ...file, ...patch } : file) });
  };
  const loadDisc = async () => {
    if (!discFile || !connected || !discSupported) return;
    if (discFile.size > 2 * 1024 * 1024) { onNotice('Disk images are limited to 2 MiB'); return; }
    if (archimedesDiscConnected) {
      /* Mounting and listing are different capabilities, held to different
       * standards. The core reads the sectors of every geometry its own loader
       * table declares, so all of them mount; whether this build can then list
       * the catalogue is said separately rather than used as a reason to
       * withhold a disc the machine could have read. */
      const refusal = adfsMountRefusal(discFile.name, discFile.size);
      if (refusal) { onNotice(refusal); return; }
      const geometry = adfsGeometryFor(discFile.name, discFile.size);
      if (geometry && !geometry.catalogue.readable) onNotice(`Mounting ${geometry.label}. ${geometry.catalogue.reason}`);
    }
    if (!/\.(ssd|dsd|adl|adf|adm|ads)$/i.test(discFile.name)) { onNotice('Choose a DFS or ADFS disk image (.ssd, .dsd, .adl, .adf, .adm or .ads)'); return; }
    const bytes = new Uint8Array(await discFile.arrayBuffer());
    if (archimedesDiscConnected) {
      try { parseAdfsCatalogue(bytes); }
      catch (error) { onNotice(error instanceof Error ? error.message : String(error)); return; }
    }
    onCommand({ type: 'load-disc', name: discFile.name, bytes: Array.from(bytes), drive });
    onNotice(`Loading ${discFile.name} into drive ${drive}`);
  };
  const loadTape = async () => {
    if (!tapeFile || !connected || !tapeSupported) return;
    if (tapeFile.size > MAX_TAPE_IMAGE_BYTES) { onNotice('Cassette images are limited to 8 MiB'); return; }
    if (!/\.(uef|tap)$/i.test(tapeFile.name)) { onNotice('Choose a UEF or tapefile cassette image (.uef or .tap)'); return; }
    const bytes = new Uint8Array(await tapeFile.arrayBuffer());
    try {
      const format = validateTapeImage(bytes);
      /* A UEF's chunk list is read before it is mounted, so what the file
       * actually contains is stated rather than inferred from its name, and a
       * truncated one is reported here rather than discovered halfway through a
       * load. Nothing is interpreted beyond the structure: the identifiers and
       * sizes are what this build knows, and claiming more would be inventing
       * detail about someone's tape. */
      setTapeReport(format === 'UEF' ? readUefReport(bytes) : null);
      onCommand({ type: 'load-tape', name: tapeFile.name, bytes: Array.from(bytes) });
      onNotice(`Loading ${format} cassette ${tapeFile.name}`);
    } catch (error) {
      setTapeReport(null);
      onNotice(error instanceof Error ? error.message : String(error));
    }
  };
  const inspectDisc = async (selected: File | undefined) => {
    setCreatedDfs(undefined);
    setCreatedDsd(undefined);
    setCreatedAdfs(undefined);
    setDiscFile(selected);
    setDfsCatalogue(undefined);
    setAdfsCatalogue(undefined);
    setAdfsImage(undefined);
    setAdfsEditing(undefined);
    setDfsProject(undefined);
    setDfsDsdProject(undefined);
    if (!selected) { setCatalogueStatus(archimedesTarget ? 'Choose an exact 800 KiB ADFS .adf image to inspect.' : 'Choose an SSD image to inspect its catalogue before mounting.'); return; }
    if (archimedesTarget) {
      if (!/\.adf$/i.test(selected.name) || selected.size !== 800 * 1024) { setCatalogueStatus('The qualified A310 adapter currently requires an exact 800 KiB ADFS .adf image.'); return; }
      try {
        const image = new Uint8Array(await selected.arrayBuffer());
        const catalogue = parseAdfsCatalogue(image);
        setAdfsCatalogue(catalogue);
        setAdfsImage(image);
        setAdfsEditing(undefined);
        const objectCount = flattenAdfsEntries(catalogue.entries).length;
        setCatalogueStatus(`${objectCount} object${objectCount === 1 ? '' : 's'} decoded recursively from the ${catalogue.format} directory tree; files can be extracted before mounting.`);
      } catch (error) {
        setCatalogueStatus(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    if (/\.dsd$/i.test(selected.name)) {
      try {
        const image = new Uint8Array(await selected.arrayBuffer());
        const project = openDfsDsdProject(image);
        const split = splitDfsDsdImage(image); const catalogue = parseDfsCatalogue(split[0]);
        setDfsFormat('dsd'); setDfsSide(0); setDfsDsdProject(project); setDfsProject(project.sides[0]); setDfsTitle(project.sides[0].title); setDfsCatalogue(catalogue);
        setCatalogueStatus(`${project.sides[0].files.length + project.sides[1].files.length} logical files decoded from two independently validated, track-interleaved DFS sides.`);
      } catch (error) { setDiscFile(undefined); setCatalogueStatus(error instanceof Error ? error.message : String(error)); }
      return;
    }
    if (!/\.ssd$/i.test(selected.name)) { setCatalogueStatus('The logical editor accepts exact 200 KiB DFS SSD or 400 KiB track-interleaved DSD images; other supported formats remain available for direct mounting.'); return; }
    if (selected.size > 2 * 1024 * 1024) { setCatalogueStatus('Disk images are limited to 2 MiB.'); return; }
    try {
      const image = new Uint8Array(await selected.arrayBuffer());
      const catalogue = parseDfsCatalogue(image);
      setDfsCatalogue(catalogue);
      if (!catalogue.warnings.length) { const project = openDfsImageProject(image); setDfsFormat('ssd'); setDfsSide(0); setDfsProject(project); setDfsTitle(project.title); }
      setCatalogueStatus(`${catalogue.files.length} file${catalogue.files.length === 1 ? '' : 's'} decoded from the on-disk DFS catalogue.`);
    } catch (error) {
      setCatalogueStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const rebuildAtomAtm = (draft = atomAtmDraft) => {
    if (!draft) return;
    try {
      const image = createAtomAtm(draft); const verified = parseAtomAtm(image);
      setAtomAtmDraft(verified); setCreatedAtm(image);
      setAtomAtmStatus(`Validated ${verified.name} · load ${formatAddress(verified.loadAddress)} · execute ${formatAddress(verified.executionAddress)} · ${verified.bytes.length.toLocaleString()} exact bytes.`);
      onNotice(`Atom ATM rebuilt · ${image.length.toLocaleString()} bytes including documented 22-byte header`);
    } catch (error) { setCreatedAtm(undefined); onNotice(error instanceof Error ? error.message : String(error)); }
  };
  const inspectAtomAtm = async (selected: File | undefined) => {
    setCreatedAtm(undefined);
    if (!selected) { setAtomAtmDraft(undefined); setAtomAtmStatus('Open an ATM container or package the current Atom build.'); return; }
    if (selected.size > 65_557) { setAtomAtmDraft(undefined); setAtomAtmStatus('ATM containers are limited to the 22-byte header plus 65,535 payload bytes.'); return; }
    try {
      const parsed = parseAtomAtm(new Uint8Array(await selected.arrayBuffer()));
      setAtomAtmDraft(parsed); setAtomAtmStatus(`Imported ${parsed.name}; rebuild before download or live RAM handoff.`);
    } catch (error) { setAtomAtmDraft(undefined); setAtomAtmStatus(error instanceof Error ? error.message : String(error)); }
  };
  const packageCurrentAtomBuild = () => {
    if (!buildArtifact || (buildArtifact.kind !== '6502-binary' && buildArtifact.kind !== 'atom-basic-text')) { onNotice('Build an Atom BASIC or 6502 target before creating an ATM container'); return; }
    const outputName = buildArtifact.provenance?.target.outputName.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_!-]/g, '').toUpperCase().slice(0, 12) || 'PROGRAM';
    const draft: AtomAtmFile = buildArtifact.kind === '6502-binary'
      ? { name: outputName, loadAddress: buildArtifact.origin, executionAddress: buildArtifact.entryPoint, bytes: buildArtifact.bytes }
      : { name: outputName, loadAddress: 0, executionAddress: 0, bytes: buildArtifact.bytes };
    setAtomAtmDraft(draft); rebuildAtomAtm(draft);
  };
  const runAtomAtm = () => {
    if (!createdAtm || !connected) return;
    const file = parseAtomAtm(createdAtm);
    if (!file.executionAddress) { onNotice('Text ATM payloads use AtoMMC *EXEC; run the current Atom BASIC build through the IDE Run command instead'); return; }
    if (file.loadAddress + file.bytes.length > 0x8000) { onNotice('The live RAM handoff is limited to a contiguous range below &8000'); return; }
    onCommand({ type: 'load-machine-code', bytes: Array.from(file.bytes), origin: file.loadAddress, entryPoint: file.executionAddress, autorun: true, breakpoints: [], sourceLocations: {}, symbols: {}, programLoadDraft: { source: 'host-file', mode: 'load', processor: '6502', name: file.name, expectedSha256: sha256Hex(file.bytes), host: { filename: file.name, container: 'Atom ATM' } } satisfies ProgramLoadDraft });
    onNotice(`Loading validated ATM payload ${file.name} into the live Atom at ${formatAddress(file.loadAddress)}`);
  };
  const createApplication = () => {
    if (!armArtifact) return;
    try {
      const packaged = createRiscOsAbsoluteApplication(armArtifact, riscOsName);
      validateRiscOsApplication(packaged);
      setRiscOsPackage(packaged);
      onNotice(`Created validated RISC OS application directory ${packaged.rootDirectory} · Obey !Run + Absolute RunImage`);
    } catch (error) { setRiscOsPackage(undefined); onNotice(error instanceof Error ? error.message : String(error)); }
  };
  const createAdfsApplication = () => {
    if (!armArtifact) return;
    if (armArtifact.origin !== 0x8000 || armArtifact.entryPoint !== 0x8000) { onNotice('ADFS Absolute launch requires an ARM2 image linked and entered at &00008000'); return; }
    try {
      const created = createAdfsEImage({ title: 'WEBIDE', name: riscOsName, filetype: 0xff8, executionAddress: 0x8000, bytes: armArtifact.bytes });
      const filename = `${safeFilename(riscOsName)}.adf`;
      setCreatedAdfs(created); setDiscFile(new File([created.image], filename, { type: 'application/octet-stream' })); setDfsCatalogue(undefined); setAdfsCatalogue(created.catalogue); setAdfsImage(created.image); setAdfsEditing(undefined);
      setCatalogueStatus(`Generated and independently validated ADFS E image with $.${riscOsName}; choose drive 0 and mount before running.`);
      onNotice(`Created validated ADFS E image · ${created.image.length.toLocaleString()} bytes`);
    } catch (error) { setCreatedAdfs(undefined); onNotice(error instanceof Error ? error.message : String(error)); }
  };
  const stageApplication = () => {
    if (!riscOsPackage || !archimedesConnected) return;
    onCommand({ type: 'stage-riscos-application', application: { ...riscOsPackage, files: riscOsPackage.files.map((file) => ({ ...file, bytes: Array.from(file.bytes) })) } });
    onNotice(`Staging ${riscOsPackage.rootDirectory} in the live A310 HostFS transfer directory`);
  };
  const launchApplication = () => {
    if (!riscOsPackage || !archimedesConnected) return;
    onCommand({ type: 'stage-and-launch-riscos-application', application: { ...riscOsPackage, files: riscOsPackage.files.map((file) => ({ ...file, bytes: Array.from(file.bytes) })) } });
    onNotice(`Staging ${riscOsPackage.rootDirectory}, then entering its FileSwitch launch command through the emulated A310 keyboard`);
  };
  const launchAdfsApplication = () => {
    if (!createdAdfs || !discFile || drive !== 0 || !mounted.some((item) => item.kind === 'disc' && item.drive === 0 && item.name === discFile.name)) return;
    onCommand({ type: 'launch-adfs-file', name: riscOsName, drive: 0 });
    onNotice(`Entering Run ADFS::0.$.${riscOsName} through the emulated A310 keyboard`);
  };
  const extractAdfsEntry = (entry: AdfsFileEntry) => {
    if (!adfsImage) return;
    try {
      const bytes = extractAdfsFile(adfsImage, entry);
      const filename = `${safeFilename(entry.name)}${entry.filetype === undefined ? '' : `,${entry.filetype.toString(16).padStart(3, '0')}`}`;
      downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }), filename);
      onNotice(`Extracted ${entry.path} · ${bytes.length.toLocaleString()} bytes`);
    } catch (error) { onNotice(error instanceof Error ? error.message : String(error)); }
  };
  const analyseAdfsEntry = (entry: AdfsFileEntry) => {
    if (!adfsImage || entry.directory) return;
    try {
      const bytes = extractAdfsFile(adfsImage, entry); const typedLoadWord = (entry.loadAddress >>> 20) === 0xfff;
      const warnings = typedLoadWord ? ['The ADFS load word encodes RISC OS filetype/timestamp metadata; analysis origin uses the execution address and remains editable.'] : [];
      onAnalyse(entry.path, bytes, { source: 'container', catalogueName: entry.name, load: entry.loadAddress, execute: entry.executionAddress, declaredLength: entry.length, locked: entry.locked, filetype: entry.filetype, containerFormat: adfsCatalogue?.format, containerByteLength: adfsImage.length, warnings }, archimedesConnected ? { processor: 'arm2', ...(typedLoadWord ? { origin: entry.executionAddress, entryPoint: entry.executionAddress } : {}) } : typedLoadWord ? { origin: entry.executionAddress, entryPoint: entry.executionAddress } : {});
    } catch (error) { onNotice(error instanceof Error ? error.message : String(error)); }
  };
  const adfsEntries = adfsCatalogue ? flattenAdfsEntries(adfsCatalogue.entries) : [];
  const adfsEditingEntry = adfsEntries.find((item) => item.path === adfsEditing);
  const adfsPreview = adfsCatalogue && <><div className="dfs-facts"><span>Format <strong>{adfsCatalogue.format}</strong></span><span>Title <strong>{adfsCatalogue.title || '(untitled)'}</strong></span><span>Root <strong>{adfsCatalogue.name || '$'}</strong></span><span>Objects <strong>{adfsEntries.length}</strong></span></div>{adfsCatalogue.warnings.map((warning) => <div className="dfs-warning" key={warning}>{warning}</div>)}<div className="dfs-table adfs-table" role="table" aria-label="ADFS recursive catalogue"><div className="dfs-table-head" role="row"><span>Path</span><span>Load</span><span>Exec</span><span>Length</span><span>Type / action</span></div>{adfsEntries.map((item) => <div role="row" key={item.path}><strong>{item.directory ? 'D ' : ''}{item.locked ? 'L ' : ''}{item.path}</strong><code>{formatAddress(item.loadAddress, 8)}</code><code>{formatAddress(item.executionAddress, 8)}</code><code>{item.length}</code>{item.directory ? <span className="media-entry-actions"><code>Directory · {formatAddress(item.discAddress, 6)}</code><button type="button" onClick={() => setAdfsEditing(adfsEditing === item.path ? undefined : item.path)} aria-label={`Edit the catalogue entry for ${item.path}`}>Edit</button></span> : <span className="media-entry-actions"><button type="button" onClick={() => extractAdfsEntry(item)} aria-label={`Extract ${item.path}`}>{item.filetype === undefined ? formatAddress(item.discAddress, 6) : `&${item.filetype.toString(16).toUpperCase().padStart(3, '0')}`} · Extract</button><button type="button" onClick={() => analyseAdfsEntry(item)} aria-label={`Analyse ${item.path}`}>Analyse</button><button type="button" onClick={() => setAdfsEditing(adfsEditing === item.path ? undefined : item.path)} aria-label={`Edit the catalogue entry for ${item.path}`}>Edit</button></span>}</div>)}</div>{adfsEditingEntry && adfsImage && <AdfsEntryEditor image={adfsImage} entry={adfsEditingEntry} onNotice={onNotice} onClose={() => setAdfsEditing(undefined)} onApplied={(nextImage, nextCatalogue) => { setAdfsImage(nextImage); setAdfsCatalogue(nextCatalogue); setDiscFile(new File([nextImage], discFile?.name ?? 'edited.adf', { type: 'application/octet-stream' })); }} />}</>;
  const startBlankDfsProject = () => {
    invalidateDfsOutput();
    const project: DfsImageProject = { title: dfsTitle, cycle: 0, bootOption: 0, files: [] };
    if (dfsFormat === 'dsd') {
      const second: DfsImageProject = { title: 'SIDE TWO', cycle: 0, bootOption: 0, files: [] };
      setDfsDsdProject({ sides: [project, second] }); setDfsSide(0);
    } else setDfsDsdProject(undefined);
    setDfsProject(project); setCatalogueStatus(`New blank ${dfsFormat.toUpperCase()} logical draft; rebuild to validate and export it.`);
  };
  const changeDfsProject = (patch: Partial<DfsImageProject>) => {
    invalidateDfsOutput();
    const project = { ...(dfsProject ?? { title: dfsTitle, cycle: 0, bootOption: 0, files: [] }), ...patch };
    updateSelectedDfsProject(project);
  };
  const selectDfsSide = (side: 0 | 1) => {
    if (!dfsDsdProject) return;
    const project = dfsDsdProject.sides[side]; setDfsSide(side); setDfsProject(project); setDfsTitle(project.title);
    setDfsCatalogue(createdDsd?.sides[side].catalogue); setCatalogueStatus(`Editing DSD side ${side}; changes remain a logical draft until the complete image is rebuilt.`);
  };
  /*
   * Writing a tape the machine will load.
   *
   * The two formats here are not interchangeable and neither is a preference:
   * the Atom's ROM and the BBC's MOS read different headers, so the machine the
   * project targets decides which one is written. Both were verified by making
   * real machines load them; see src/media/acornTapeMeasurements.ts.
   */
  const atomTapeTarget = machineId === 'atom';
  const rebuildTape = (draft = tapeDraft) => {
    if (!draft) return;
    try {
      const image = atomTapeTarget ? createAtomTapeImage([draft]) : createTapeImage([draft]);
      const blocks = atomTapeTarget ? encodeAtomTapeFile(draft) : encodeTapeFile(draft);
      setCreatedTape(image); setCreatedTapeBlocks(blocks.length);
      setTapeCreatorStatus(`${atomTapeTarget ? 'Atom' : 'BBC/Electron'} cassette · ${draft.name} · load ${formatAddress(draft.loadAddress)} · execute ${formatAddress(draft.executionAddress)} · ${draft.bytes.length.toLocaleString()} bytes in ${blocks.length} block${blocks.length === 1 ? '' : 's'} · ${image.length.toLocaleString()} bytes of UEF.`);
    } catch (error) {
      setCreatedTape(undefined); setCreatedTapeBlocks(0);
      setTapeCreatorStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const packageCurrentBuildToTape = () => {
    if (!buildArtifact || buildArtifact.kind !== '6502-binary') { onNotice('Build a 6502 target before writing a cassette'); return; }
    const limit = atomTapeTarget ? MAX_ATOM_NAME_LENGTH : MAX_NAME_LENGTH;
    const outputName = buildArtifact.provenance?.target.outputName.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_!-]/g, '').toUpperCase().slice(0, limit) || 'GAME';
    const draft: TapeFile = { name: outputName, loadAddress: buildArtifact.origin, executionAddress: buildArtifact.entryPoint, bytes: buildArtifact.bytes };
    setTapeDraft(draft); rebuildTape(draft);
  };
  const updateTapeDraft = (patch: Partial<TapeFile>) => {
    setCreatedTape(undefined); setTapeDraft((current) => current ? { ...current, ...patch } : current);
    setTapeCreatorStatus('Cassette metadata changed; write the tape again before downloading or mounting it.');
  };
  const mountCreatedTape = () => {
    if (!createdTape || !tapeDraft || !connected || !tapeSupported) return;
    onCommand({ type: 'load-tape', name: `${safeFilename(tapeDraft.name) || 'game'}.uef`, bytes: Array.from(createdTape) });
    onNotice(atomTapeTarget
      ? `Cassette mounted · type *LOAD"${tapeDraft.name}" then press RETURN when the machine asks you to play the tape`
      : `Cassette mounted · type *TAPE then *RUN "${tapeDraft.name}" or CHAIN"${tapeDraft.name}"`);
  };
  const tapeCreator = tapeSupported && <section className="media-subsection dfs-creator" aria-label="Write a cassette image from the current build">
    <h3>Write cassette</h3>
    <p>Writes a UEF carrying {atomTapeTarget ? "the Atom's own block format: a shorter header, addresses written high byte first, each block naming its own load address, and a summed check byte covering the synchronising asterisks." : 'the block format the MOS reads: name, load and execution addresses, block number and length, each half checked by its own CRC.'} Nothing validates these blocks on the way in, so the encoder is held to bytes real machines accepted.</p>
    <div className="media-fields">
      <button type="button" disabled={!buildArtifact || buildArtifact.kind !== '6502-binary'} onClick={packageCurrentBuildToTape}>Package current build</button>
      <label><span>Name</span><input aria-label="Cassette file name" maxLength={atomTapeTarget ? MAX_ATOM_NAME_LENGTH : MAX_NAME_LENGTH} value={tapeDraft?.name ?? ''} onChange={(event) => updateTapeDraft({ name: event.target.value.toUpperCase() })} /></label>
      <label><span>Load</span><input aria-label="Cassette load address" type="number" min={0} max={atomTapeTarget ? 0xffff : 0xffffffff} value={tapeDraft?.loadAddress ?? 0} onChange={(event) => updateTapeDraft({ loadAddress: Number(event.target.value) })} /></label>
      <label><span>Execute</span><input aria-label="Cassette execution address" type="number" min={0} max={atomTapeTarget ? 0xffff : 0xffffffff} value={tapeDraft?.executionAddress ?? 0} onChange={(event) => updateTapeDraft({ executionAddress: Number(event.target.value) })} /></label>
      <button type="button" disabled={!tapeDraft} onClick={() => rebuildTape()}>Write tape</button>
      <button type="button" disabled={!createdTape} onClick={() => createdTape && tapeDraft && downloadBlob(new Blob([createdTape], { type: 'application/octet-stream' }), `${safeFilename(tapeDraft.name) || 'game'}.uef`)}><Icon name="download" size={14} /> Download UEF</button>
      <button type="button" disabled={!createdTape || !connected} onClick={mountCreatedTape}><Icon name="open" size={14} /> Mount cassette</button>
    </div>
    <div className="dfs-preview-status" role="status" aria-live="polite">{tapeCreatorStatus}</div>
    {createdTape && tapeDraft && <div className="dfs-facts"><span>Format <strong>{atomTapeTarget ? 'Acorn Atom' : 'BBC / Electron'}</strong></span><span>Blocks <strong>{createdTapeBlocks}</strong></span><span>Image <strong>{createdTape.length.toLocaleString()} bytes</strong></span></div>}
  </section>;
  const updateAtomAtmDraft = (patch: Partial<AtomAtmFile>) => {
    setCreatedAtm(undefined); setAtomAtmDraft((current) => current ? { ...current, ...patch } : current);
    setAtomAtmStatus('ATM metadata changed; rebuild and validate before download or live RAM handoff.');
  };
  const atomAtmEditor = machineId === 'atom' && <section className="media-subsection dfs-creator" aria-label="Acorn Atom ATM container editor">
    <h3>Acorn Atom ATM file</h3>
    <p>The AtoMMC/Atomulator container carries a 16-byte zero-padded name field, little-endian load/execute addresses and payload length in a documented 22-byte header. Machine-code payloads can also be handed to the live Atom RAM adapter; text payloads remain <code>*EXEC</code> files.</p>
    <div className="media-fields">
      <label><span>Open ATM</span><input aria-label="Open Atom ATM container" type="file" accept=".atm,.tap,application/octet-stream" onChange={(event) => void inspectAtomAtm(event.target.files?.[0])} /></label>
      <button type="button" disabled={!buildArtifact || (buildArtifact.kind !== '6502-binary' && buildArtifact.kind !== 'atom-basic-text')} onClick={packageCurrentAtomBuild}>Package current build</button>
      <label><span>Name</span><input aria-label="Atom ATM name" maxLength={12} value={atomAtmDraft?.name ?? ''} onChange={(event) => updateAtomAtmDraft({ name: event.target.value })} /></label>
      <label><span>Load</span><input aria-label="Atom ATM load address" type="number" min={0} max={0xffff} value={atomAtmDraft?.loadAddress ?? 0} onChange={(event) => updateAtomAtmDraft({ loadAddress: Number(event.target.value) })} /></label>
      <label><span>Execute</span><input aria-label="Atom ATM execution address" type="number" min={0} max={0xffff} value={atomAtmDraft?.executionAddress ?? 0} onChange={(event) => updateAtomAtmDraft({ executionAddress: Number(event.target.value) })} /></label>
      <button type="button" disabled={!atomAtmDraft} onClick={() => rebuildAtomAtm()}>Rebuild ATM</button>
      <button type="button" disabled={!createdAtm} onClick={() => createdAtm && atomAtmDraft && downloadBlob(new Blob([createdAtm], { type: 'application/octet-stream' }), `${safeFilename(atomAtmDraft.name) || 'PROGRAM'}.atm`)}><Icon name="download" size={14} /> Download ATM</button>
      <button type="button" disabled={!createdAtm || !connected || !atomAtmDraft?.executionAddress} onClick={runAtomAtm}><Icon name="play" size={14} /> Load &amp; run payload</button>
    </div>
    <div className="dfs-preview-status" role="status" aria-live="polite">{atomAtmStatus}</div>
    {atomAtmDraft && <div className="dfs-facts"><span>Payload <strong>{atomAtmDraft.bytes.length.toLocaleString()} bytes</strong></span><span>Container after rebuild <strong>{(atomAtmDraft.bytes.length + 22).toLocaleString()} bytes</strong></span><span>Usage <strong>{atomAtmDraft.executionAddress ? '*RUN / live RAM' : '*EXEC text'}</strong></span></div>}
  </section>;
  const dfsEditor = <section className="media-subsection dfs-creator" aria-label="Edit DFS SSD image">
    <h3>DFS SSD/DSD logical-file editor</h3><p>Open a valid image or start a blank one. DSD sides are deinterleaved into independent DFS catalogues and reinterleaved only after both validate. Changes remain a logical draft until Rebuild validates every field and byte extent.</p>
    <div className="media-fields">
      <label><span>Open image</span><input aria-label="Open DFS image for editing" type="file" accept=".ssd,.dsd,application/octet-stream" onChange={(event) => void inspectDisc(event.target.files?.[0])} /></label>
      <label><span>Format</span><select aria-label="DFS image format" value={dfsFormat} onChange={(event) => { setDfsFormat(event.target.value as 'ssd' | 'dsd'); setDfsProject(undefined); setDfsDsdProject(undefined); invalidateDfsOutput(); }}><option value="ssd">SSD · one side</option><option value="dsd">DSD · two sides</option></select></label>
      {dfsFormat === 'dsd' && <label><span>Side</span><select aria-label="DFS DSD side" value={dfsSide} onChange={(event) => selectDfsSide(Number(event.target.value) as 0 | 1)} disabled={!dfsDsdProject}><option value={0}>Side 0</option><option value={1}>Side 1</option></select></label>}
      <button type="button" onClick={startBlankDfsProject}>New blank image</button>
      <label><span>Disk title</span><input aria-label="Generated DFS title" maxLength={12} value={dfsTitle} onChange={(event) => { setDfsTitle(event.target.value); changeDfsProject({ title: event.target.value }); }} /></label>
      <label><span>New file</span><input aria-label="DFS filename" maxLength={7} value={dfsName} onChange={(event) => setDfsName(event.target.value)} /></label>
      <label><span>Host file</span><input aria-label="Host file for DFS image" type="file" onChange={(event) => setDfsHostFile(event.target.files?.[0])} /></label>
      <label><span>Cycle</span><input aria-label="DFS cycle" type="number" min={0} max={255} value={dfsProject?.cycle ?? 0} onChange={(event) => changeDfsProject({ cycle: Number(event.target.value) })} /></label>
      <label><span>Boot</span><select aria-label="DFS boot option" value={dfsProject?.bootOption ?? 0} onChange={(event) => changeDfsProject({ bootOption: Number(event.target.value) })}><option value={0}>0 · none</option><option value={1}>1 · LOAD</option><option value={2}>2 · RUN</option><option value={3}>3 · EXEC</option></select></label>
      <button type="button" disabled={!artifact} onClick={dfsProject ? addBuildToDfsProject : createDisc}>Add current build</button>
      <button type="button" disabled={!dfsHostFile} onClick={() => void addHostFileToDfsProject()}>Add host file</button>
      <button type="button" disabled={!dfsProject} onClick={() => rebuildDfsProject()}>Rebuild / validate</button>
      <button type="button" disabled={dfsFormat === 'dsd' ? !createdDsd : !createdDfs} onClick={() => { const output = dfsFormat === 'dsd' ? createdDsd?.image : createdDfs?.image; if (output) downloadBlob(new Blob([output], { type: 'application/octet-stream' }), `${safeFilename(dfsFormat === 'dsd' ? dfsDsdProject?.sides[0].title ?? dfsTitle : dfsTitle).toLowerCase() || 'disk'}.${dfsFormat}`); }}><Icon name="download" size={14} /> Download {dfsFormat.toUpperCase()}</button>
    </div>
    <div className="dfs-preview-status" role="status" aria-live="polite">{catalogueStatus}</div>
    {dfsProject?.files.length ? <div className="dfs-project-files" aria-label="Editable DFS logical files">{dfsProject.files.map((file, index) => <div key={`${index}-${file.directory}.${file.name}`}><input aria-label={`Directory for DFS file ${index + 1}`} maxLength={1} value={file.directory ?? '$'} onChange={(event) => updateDfsFile(index, { directory: event.target.value })} /><input aria-label={`Name for DFS file ${index + 1}`} maxLength={7} value={file.name} onChange={(event) => updateDfsFile(index, { name: event.target.value })} /><input aria-label={`Load address for DFS file ${index + 1}`} type="number" min={0} max={0x3ffff} value={file.loadAddress} onChange={(event) => updateDfsFile(index, { loadAddress: Number(event.target.value) })} /><input aria-label={`Execution address for DFS file ${index + 1}`} type="number" min={0} max={0x3ffff} value={file.executionAddress} onChange={(event) => updateDfsFile(index, { executionAddress: Number(event.target.value) })} /><label><input aria-label={`Lock DFS file ${index + 1}`} type="checkbox" checked={!!file.locked} onChange={(event) => updateDfsFile(index, { locked: event.target.checked })} /> Locked</label><span>{file.bytes.length.toLocaleString()} bytes</span><button type="button" aria-label={`Analyse DFS file ${index + 1}`} onClick={() => onAnalyse(`${file.directory ?? '$'}.${file.name}`, file.bytes, { source: 'container', catalogueName: file.name, load: file.loadAddress, execute: file.executionAddress, declaredLength: file.bytes.length, locked: !!file.locked, containerFormat: dfsFormat === 'dsd' ? 'DFS DSD' : 'DFS SSD', containerByteLength: discFile?.size, warnings: [] })}>Analyse</button><button type="button" aria-label={`Remove DFS file ${index + 1}`} onClick={() => { if (!dfsProject) return; invalidateDfsOutput(); updateSelectedDfsProject({ ...dfsProject, files: dfsProject.files.filter((_, position) => position !== index) }); }}>Remove</button></div>)}</div> : <p className="honest-note">This side has no files. Add a current build or host file, or rebuild it as a valid blank catalogue.</p>}
  </section>;
  return <div className="media-workspace">
    <div className="runtime-heading"><div><span className="eyebrow">LIVE MACHINE MEDIA ADAPTER</span><h2>Packaging and machine media</h2></div></div>
    {atomAtmEditor}
    {tapeCreator}
    {riscOsPackage && <RiscOsResourcePanel application={riscOsPackage} onChange={setRiscOsPackage} onNotice={onNotice} onDownload={(bytes, filename) => downloadBlob(new Blob([bytes], { type: 'application/zip' }), filename)} onDisc={(created, filename) => { setCreatedAdfs(created); setDiscFile(new File([created.image], filename, { type: 'application/octet-stream' })); setDfsCatalogue(undefined); setAdfsCatalogue(created.catalogue); setAdfsImage(created.image); setAdfsEditing(undefined); }} />}
    {(discSupported || archimedesConnected) && <AdfsDiscBuilder artifact={armArtifact ? { name: riscOsName, bytes: armArtifact.bytes, entryPoint: armArtifact.entryPoint } : null} onNotice={onNotice} onCreated={(created, filename) => { setCreatedAdfs(created); setDiscFile(new File([created.image], filename, { type: 'application/octet-stream' })); setDfsCatalogue(undefined); setAdfsCatalogue(created.catalogue); setAdfsImage(created.image); setAdfsEditing(undefined); }} />}
    {(armArtifact || archimedesConnected) && <section className="media-subsection dfs-creator" aria-label="Create RISC OS application from ARM build"><h3>RISC OS application and ADFS E disk</h3><p>Wrap a current raw ARM2 image only when it satisfies FileSwitch's Absolute contract: little-endian code linked and entered at &amp;00008000. HostFS creates a typed <code>!Run</code>/<code>RunImage</code> directory; the disk path creates an independently reparsed one-file 800 KiB ADFS E image.</p><div className="media-fields"><label><span>Application</span><input aria-label="RISC OS application name" maxLength={10} value={riscOsName} onChange={(event) => { setRiscOsName(event.target.value); setRiscOsPackage(undefined); setCreatedAdfs(undefined); }} /></label><button type="button" disabled={!armArtifact} onClick={createApplication}>Create HostFS app</button><button type="button" disabled={!riscOsPackage || !archimedesConnected} onClick={stageApplication}>Stage in HostFS</button><button type="button" disabled={!riscOsPackage || !archimedesConnected} onClick={launchApplication}><Icon name="play" size={14} /> Run HostFS app</button><button type="button" disabled={!armArtifact} onClick={createAdfsApplication}>Create ADFS E</button><button type="button" disabled={!createdAdfs} onClick={() => createdAdfs && downloadBlob(new Blob([createdAdfs.image], { type: 'application/octet-stream' }), `${safeFilename(riscOsName)}.adf`)}><Icon name="download" size={14} /> Download ADF</button><button type="button" disabled={!createdAdfs || drive !== 0 || !discFile || !mounted.some((item) => item.kind === 'disc' && item.drive === 0 && item.name === discFile.name)} onClick={launchAdfsApplication}><Icon name="play" size={14} /> Run mounted ADF</button></div>{armArtifact ? <p className="media-limit">Artifact {armArtifact.bytes.length.toLocaleString()} bytes · origin {formatAddress(armArtifact.origin, 8)} · entry {formatAddress(armArtifact.entryPoint, 8)} · automatic ADFS launch is qualified on drive 0</p> : <p className="honest-note">Build a current ARM2 target to enable application packaging.</p>}{riscOsPackage && <div className="dfs-preview-status" role="status">Validated {riscOsPackage.rootDirectory} · !Run &amp;FEB · RunImage &amp;FF8 · FileSwitch launch path {riscOsPackage.launchPath}</div>}{createdAdfs && <div className="dfs-preview-status" role="status">Validated ADFS E · $.{riscOsName} &amp;FF8 · {armArtifact?.bytes.length.toLocaleString()} exact bytes · mount in drive 0 to run</div>}</section>}
    {archimedesTarget && <section className="media-subsection" aria-label="Browse ADFS image"><h3>ADFS image browser</h3><p>Inspect and extract exact D/E catalogue entries without booting the emulator. Files can be sent directly to the analyser with their FileCore metadata.</p><div className="media-fields"><label><span>Open ADF</span><input aria-label="Open ADFS image for browsing" type="file" accept=".adf,application/octet-stream" onChange={(event) => void inspectDisc(event.target.files?.[0])} /></label></div><div className="dfs-preview" aria-live="polite"><div className="dfs-preview-status">{catalogueStatus}</div>{adfsPreview}</div></section>}
    {!archimedesConnected && dfsEditor}
    {!connected ? <div className="honest-empty runtime-empty">Supply the selected machine ROM set before mounting media.</div> : !discSupported && !tapeSupported ? !archimedesConnected && <div className="honest-empty runtime-empty">Enable a supported disk or cassette capability for this machine profile to mount media.</div> : <div className="media-loader">
      <section className="media-mounts">
        <div className="media-subsection"><h3>Mount disk image</h3>{discSupported ? <><p>{archimedesDiscConnected ? 'The qualified A310 adapter validates, browses, extracts and mounts exact 800 KiB ADFS D/E images through the live floppy controller. Images remain in browser memory.' : 'Images stay in browser memory and are sent only to the active machine FDC. Generated SSDs and imported images use this same mount path.'}</p><div className="media-fields"><label><span>Image</span><input aria-label="Disk image file" type="file" accept={archimedesDiscConnected ? '.adf,application/octet-stream' : '.ssd,.dsd,.adl,.adf,.adm,application/octet-stream'} onChange={(event) => void inspectDisc(event.target.files?.[0])} /></label><label><span>Drive</span><select aria-label="Disk drive" value={drive} onChange={(event) => setDrive(Number(event.target.value))}><option value={0}>Drive 0</option><option value={1}>Drive 1</option></select></label><button type="button" disabled={!discFile || (archimedesDiscConnected && !adfsCatalogue)} onClick={() => void loadDisc()}><Icon name="open" size={14} /> Mount disk</button></div><div className="dfs-preview" aria-live="polite"><div className="dfs-preview-status">{catalogueStatus}</div>{adfsPreview}{dfsCatalogue && <><div className="dfs-facts"><span>Title <strong>{dfsCatalogue.title || '(untitled)'}</strong></span><span>Boot <strong>{dfsCatalogue.bootOption}</strong></span><span>Cycle <strong>{dfsCatalogue.cycle}</strong></span><span>Geometry <strong>{dfsCatalogue.declaredSectors || '?'} / {dfsCatalogue.imageSectors} sectors</strong></span></div>{dfsCatalogue.warnings.map((warning) => <div className="dfs-warning" key={warning}>{warning}</div>)}<div className="dfs-table" role="table" aria-label="DFS catalogue"><div className="dfs-table-head" role="row"><span>Name</span><span>Load</span><span>Exec</span><span>Length</span><span>Sector</span></div>{dfsCatalogue.files.map((item, index) => <div role="row" key={`${item.directory}.${item.name}-${index}`}><strong>{item.locked ? 'L ' : ''}{item.directory}.{item.name}</strong><code>{formatAddress(item.loadAddress)}</code><code>{formatAddress(item.executionAddress)}</code><code>{item.length}</code><code>{item.startSector}</code></div>)}</div></>}</div></> : <p className="honest-note">Enable DFS or ADFS in the target profile to attach disk media.</p>}</div>
        <div className="media-subsection"><h3>Mount cassette image</h3>{tapeSupported ? <><p>UEF timing chunks and tapefile data are parsed by the live cassette device. Use the machine's normal <code>*TAPE</code>, <code>CHAIN</code> or <code>LOAD</code> commands after mounting.</p><div className="media-fields tape-fields"><label><span>Cassette</span><input aria-label="Cassette image file" type="file" accept=".uef,.tap,application/octet-stream" onChange={(event) => setTapeFile(event.target.files?.[0])} /></label><button type="button" disabled={!tapeFile} onClick={() => void loadTape()}><Icon name="open" size={14} /> Mount cassette</button></div><p className="media-limit">8 MiB maximum · cassette stream position is not yet preserved in machine-state downloads.</p>{tapeReport && <div className="tape-report"><h4>What this UEF contains</h4>{tapeReport.warnings.map((warning) => <p className="honest-note" key={warning} role="status">{warning}</p>)}{tapeReport.chunks.length > 0 && <><table className="tape-chunk-table"><caption>Chunks as the file records them. This build carries every one of them through an edit and interprets none of them.</caption><thead><tr><th scope="col">Chunk</th><th scope="col">Count</th><th scope="col">Bytes</th></tr></thead><tbody>{tapeReport.chunks.map((entry) => <tr key={entry.id}><th scope="row">{entry.id}</th><td>{entry.count}</td><td>{entry.bytes.toLocaleString()}</td></tr>)}</tbody></table></>}</div>}</> : <p className="honest-note">Enable Cassette interface in the target profile to attach tape media.</p>}</div>
      </section>
      <section><h3>Machine acknowledgements</h3><div className="mounted-media-list">{mounted.length ? mounted.map((item) => <div className="mounted-media" key={item.kind === 'disc' ? `disc-${item.drive}` : 'tape'}><Icon name="check" size={20} /><div><strong>{item.name}{item.kind === 'disc' && item.dirty ? ' · GUEST MODIFIED' : ''}</strong><span>{item.kind === 'disc' ? `Drive ${item.drive}${item.revision ? ` · write revision ${item.revision}` : ''}` : `${item.format} cassette input`} · {item.size.toLocaleString()} bytes</span><small>Accepted by the live {item.kind === 'disc' ? 'FDC' : 'cassette'} adapter</small></div>{item.kind === 'disc' && <button type="button" disabled={archimedesConnected} title={archimedesConnected ? 'A310 disk export is unavailable until its pinned core exposes current guest media bytes' : `Download the current live bytes from drive ${item.drive}`} onClick={() => onCommand({ type: 'export-disc', drive: item.drive })}>Export current</button>}<button type="button" disabled={archimedesConnected} title={archimedesConnected ? 'A310 eject is unavailable until the pinned core exposes a qualified media unload operation' : `Eject ${item.kind === 'disc' ? `drive ${item.drive}` : 'cassette'} from the live adapter`} onClick={() => onCommand(item.kind === 'disc' ? { type: 'eject-disc', drive: item.drive } : { type: 'eject-tape' })}>Eject</button></div>) : <div className="honest-empty">No media is mounted in this session.</div>}</div></section>
    </div>}
  </div>;
}

function BuildWorkspace({ artifact, metadata, failure, artifactDocumentId, onArtifactDocumentChange, requestedSymbol, onRequestedSymbolHandled, stale, pinned, activity, history, buildAllRecords, files, activeFileId, targets, activeTarget, machineId, machineCpu, nativeToolchains, errors, onSelect, onChange, onAdd, onDelete, onBuild, onBuildBypass, onBuildAll, onCancelAll, onCancel, onTogglePinned, onAnalyse, onNavigate }: {
  artifact: BuildArtifact | null;
  metadata: BuildResultMetadata | null;
  failure: BuildResultMetadata | null;
  artifactDocumentId?: string;
  onArtifactDocumentChange: (id: string | undefined) => void;
  requestedSymbol?: string;
  onRequestedSymbolHandled: () => void;
  stale: boolean;
  pinned: boolean;
  activity: BuildActivity;
  history: BuildLogRecord[];
  buildAllRecords: BuildAllRecord[];
  files: ProjectFile[];
  activeFileId: string;
  targets: BuildTarget[];
  activeTarget: BuildTarget;
  machineId: string;
  machineCpu: string;
  nativeToolchains: NativeToolchainStatus[];
  errors: string[];
  onSelect: (id: string) => void;
  onChange: (id: string, update: Partial<BuildTarget>) => void;
  onAdd: () => void;
  onDelete: () => void;
  onBuild: () => void;
  onBuildBypass: () => void;
  onBuildAll: () => void;
  onCancelAll: () => void;
  onCancel: () => void;
  onTogglePinned: () => void;
  onAnalyse: (artifact: BuildArtifact) => void;
  onNavigate: (fileId: string, line: number, column?: number, length?: number) => void;
}) {
  const entry = files.find((file) => file.id === activeTarget.entryFileId);
  const manifest = toolchainFor(activeTarget.toolchainId);
  const graph = useMemo(() => analyseBuildGraph(targets), [targets]);
  const inputIdsByTarget = useMemo(() => new Map(targets.map((target) => [target.id, sourceInputsForTarget(target, files)])), [files, targets]);
  const activeImpact = impactedBuildTargets(graph, [activeFileId], inputIdsByTarget);
  const documents = useMemo(() => artifact ? generatedArtifactDocuments(artifact, metadata ?? undefined) : [], [artifact, metadata]);
  const selectedDocument = documents.find((document) => document.id === artifactDocumentId);
  const inspectorSelected = artifactDocumentId === '@byte-inspector';
  const listingRows = useMemo(() => artifact ? artifactListingRows(artifact) : [], [artifact]);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const symbolReferences = useMemo(() => artifact && isMachineCodeArtifact(artifact) && selectedSymbol ? artifactSymbolReferences(artifact, selectedSymbol) : [], [artifact, selectedSymbol]);
  useEffect(() => { if (!artifact || !isMachineCodeArtifact(artifact) || artifact.symbols[selectedSymbol] === undefined) setSelectedSymbol(''); }, [artifact, selectedSymbol]);
  useEffect(() => {
    if (!artifact || !isMachineCodeArtifact(artifact) || !requestedSymbol) return;
    const exact = Object.keys(artifact.symbols).find((name) => name.toLowerCase() === requestedSymbol.toLowerCase());
    if (exact) setSelectedSymbol(exact);
    onRequestedSymbolHandled();
  }, [artifact, requestedSymbol, onRequestedSymbolHandled]);
  const nativeIds = useMemo(() => new Set(nativeToolchains.map((toolchain) => toolchain.id)), [nativeToolchains]);
  const availableToolchains = entry ? compatibleToolchains(entry.language, nativeIds).filter((toolchain) => entry.language !== 'bbc-basic' || (machineId === 'atom' ? toolchain.id === '8bit-net.basic.atom' : toolchain.id === '8bit-net.basic.bbc2')) : [];
  const activeProfile = buildProfileManifest(activeTarget.profile);
  const artifactProfile = artifact?.provenance ? buildProfileManifest(artifact.provenance.target.profile) : undefined;
  const mappedArtifactBytes = artifact && isMachineCodeArtifact(artifact) ? Object.keys(artifact.sourceLocations).length : artifact?.bytes.length ?? 0;
  const downloadArtifact = () => {
    if (!artifact || stale || artifact.diagnostics.some((item) => item.severity === 'error')) return;
    downloadBlob(new Blob([artifact.bytes], { type: 'application/octet-stream' }), artifact.provenance?.target.outputName ?? activeTarget.outputName);
  };
  const downloadFailure = () => failure && downloadBlob(new Blob([JSON.stringify(failure, null, 2), '\n'], { type: 'application/json' }), `${activeTarget.outputName}.failed-result.json`);
  return (
    <div className={`build-workspace${inspectorSelected ? ' artifact-inspector-mode' : ''}`}>
      <div className="runtime-heading"><div><span className="eyebrow">VERSIONED BUILD TARGET · {machineCpu}</span><h2>{activeTarget.name}</h2></div><div className="runtime-actions"><button type="button" onClick={onAdd}>New target</button><button type="button" disabled={targets.length === 1} onClick={onDelete}>Remove</button><button type="button" disabled={errors.length > 0} onClick={onBuild}><Icon name="build" size={14} /> Build</button><button type="button" disabled={errors.length > 0} title="Ignore the browser-session build cache once" onClick={onBuildBypass}>Rebuild</button><button type="button" disabled={buildAllRecords.some((record) => record.status === 'running' || record.status === 'queued')} onClick={onBuildAll}>Build all</button><button type="button" disabled={!buildAllRecords.some((record) => record.status === 'running' || record.status === 'queued')} onClick={onCancelAll}>Cancel all</button><button type="button" disabled={!['queued', 'building'].includes(activity.status)} onClick={onCancel}>Cancel</button><button type="button" disabled={!artifact} aria-pressed={pinned} onClick={onTogglePinned}>{pinned ? 'Retained' : 'Retain artifact'}</button><button type="button" disabled={!artifact || stale || artifact.diagnostics.some((item) => item.severity === 'error')} onClick={() => artifact && onAnalyse(artifact)}>Analyse artifact</button><button type="button" disabled={!artifact || stale || artifact.diagnostics.some((item) => item.severity === 'error')} onClick={downloadArtifact}><Icon name="download" size={14} /> {artifact?.kind === 'atom-basic-text' ? 'Source artifact' : 'Binary'}</button></div></div>
      <section className="build-target-editor" aria-label="Build target editor">
        <label><span>Target</span><select aria-label="Build target" value={activeTarget.id} onChange={(event) => onSelect(event.target.value)}>{targets.map((target) => <option value={target.id} key={target.id}>{target.name}</option>)}</select></label>
        <label><span>Name</span><input aria-label="Build target name" maxLength={80} value={activeTarget.name} onChange={(event) => onChange(activeTarget.id, { name: event.target.value })} /></label>
        <label><span>Entry file</span><select aria-label="Build entry file" value={activeTarget.entryFileId} onChange={(event) => {
          const next = files.find((file) => file.id === event.target.value)!;
          const toolchainId = compatibleToolchains(next.language, nativeIds).find((toolchain) => next.language !== 'bbc-basic' || (machineId === 'atom' ? toolchain.id === '8bit-net.basic.atom' : toolchain.id === '8bit-net.basic.bbc2'))?.id;
          if (toolchainId) onChange(activeTarget.id, buildEntryUpdate(activeTarget, entry, next, toolchainId));
        }}>{files.filter((file) => compatibleToolchains(file.language, nativeIds).length > 0).map((file) => <option value={file.id} key={file.id}>{file.name}</option>)}</select></label>
        <label><span>Toolchain</span><select aria-label="Build toolchain" value={activeTarget.toolchainId} onChange={(event) => onChange(activeTarget.id, buildToolchainUpdate(event.target.value as BuildTarget['toolchainId']))}>{availableToolchains.map((toolchain) => <option value={toolchain.id} key={toolchain.id}>{toolchain.label}</option>)}</select></label>
        <label><span>Output</span><input aria-label="Build output name" maxLength={128} value={activeTarget.outputName} onChange={(event) => onChange(activeTarget.id, { outputName: event.target.value })} /></label>
        <label><span>Policy</span><select aria-label="Build policy" value={activeTarget.buildPolicy} onChange={(event) => onChange(activeTarget.id, { buildPolicy: event.target.value as BuildTarget['buildPolicy'] })}><option value="manual">Manual</option><option value="on-save">On explicit save</option><option value="live">Live · 650 ms debounce</option></select></label>
        <label><span>Profile</span><select aria-label="Build profile" value={activeTarget.profile} onChange={(event) => onChange(activeTarget.id, { profile: event.target.value as BuildTarget['profile'] })}>{BUILD_PROFILES.map((profile) => <option value={profile.id} disabled={entry?.language === 'bbc-basic' && profile.id !== 'debug'} key={profile.id}>{profile.label}{entry?.language === 'bbc-basic' && profile.id !== 'debug' ? ' · assembler only' : ''}</option>)}</select></label>
        <label><span>Entry source</span><select aria-label="Build entry-point mode" value={activeTarget.entryPoint.mode} disabled={entry?.language !== '6502' && entry?.language !== 'arm'} onChange={(event) => onChange(activeTarget.id, { entryPoint: { mode: event.target.value as BuildTarget['entryPoint']['mode'], value: '' } })}><option value="source">{entry?.language === 'c' ? 'Generated C startup' : entry?.language === 'arm' ? '_start symbol' : 'Assembler source'}</option><option value="symbol">Symbol</option><option value="address">Address</option></select></label>
        <label><span>Entry value</span><input aria-label="Build entry-point value" maxLength={128} disabled={!['6502', 'arm'].includes(entry?.language ?? '') || activeTarget.entryPoint.mode === 'source'} value={activeTarget.entryPoint.value} placeholder={activeTarget.entryPoint.mode === 'symbol' ? entry?.language === 'arm' ? '_start' : 'start' : activeTarget.entryPoint.mode === 'address' ? entry?.language === 'arm' ? '&00008000' : '&1900' : 'Derived from source'} onChange={(event) => onChange(activeTarget.id, { entryPoint: { ...activeTarget.entryPoint, value: event.target.value } })} /></label>
      </section>
      <div className="build-policy-state native-toolchain-state" role="status"><span>Native toolchains: <strong>{nativeToolchains.length ? `${nativeToolchains.length} READY` : 'UNAVAILABLE'}</strong></span><strong>{nativeToolchains.length ? nativeToolchains.map((toolchain) => `${toolchain.label} · ${toolchain.packageVersion ?? toolchain.upstream?.commit.slice(0, 8) ?? toolchain.adapterVersion}`).join(' | ') : 'Browser-local assemblers remain available.'} · isolated, network disabled</strong></div>
      <section className="build-profile-panel" aria-label="Build profile trade-offs">
        <header><div><span>ACTIVE BUILD PROFILE</span><strong>{activeProfile.label} · {activeProfile.goal}</strong></div><code>{Object.entries(buildProfileDefines(activeTarget)).filter(([, value]) => value).map(([name]) => `${name}=1`).join(' · ')}</code></header>
        <div className="build-profile-facts"><span><small>Source fidelity</small>{activeTarget.profile === 'custom' && activeTarget.profileOptions.debugMetadata === 'none' ? 'No source/listing map' : activeProfile.sourceFidelity}</span><span><small>Size</small>{activeProfile.sizeImpact}</span><span><small>Runtime</small>{activeProfile.runtimeImpact}</span><span><small>Compatibility</small>{activeProfile.compatibility}</span></div>
        {activeTarget.profile === 'custom' && <div className="build-profile-custom"><label><span>Optimization intent</span><select aria-label="Custom profile goal" value={activeTarget.profileOptions.customGoal} onChange={(event) => onChange(activeTarget.id, { profileOptions: { ...activeTarget.profileOptions, customGoal: event.target.value as BuildTarget['profileOptions']['customGoal'] } })}><option value="balanced">Balanced</option><option value="size">Size</option><option value="speed">Speed</option></select></label><label><span>Debug metadata</span><select aria-label="Custom debug metadata" value={activeTarget.profileOptions.debugMetadata} onChange={(event) => onChange(activeTarget.id, { profileOptions: { ...activeTarget.profileOptions, debugMetadata: event.target.value as BuildTarget['profileOptions']['debugMetadata'] } })}><option value="full">Full source map</option><option value="none">Omit source/listing map</option></select></label></div>}
        <p>{entry?.language === 'bbc-basic' ? 'The current BASIC packer is deliberately no-transform: size, speed and custom profiles are unavailable until a compatible optimizer can preserve interpreter semantics.' : entry?.language === 'c' ? 'Debug keeps cc65 output unoptimized; Size uses -O; Speed uses -Oi; Custom applies its selected balanced/size/speed goal. Custom may deliberately omit compiler/assembler/linker debug data. Every profile also receives the displayed defines.' : 'No hidden optimizer is applied to hand-authored assembler. Size and speed are explicit compile intents; source must use the injected profile symbol for bytes or runtime to differ. Measure runtime in the execution profiler.'}</p>
        {artifact && artifactProfile && <div className="build-profile-measurement"><strong>Retained {artifactProfile.label} artifact</strong><span>{artifact.bytes.length} output bytes</span><span>{mappedArtifactBytes} mapped bytes</span><span>{isMachineCodeArtifact(artifact) && !buildProfileKeepsDebugMetadata(artifact.provenance!.target) ? 'Address-only inspection; source fidelity intentionally unavailable' : 'Source-level mapping retained'}</span>{stale && <b>STALE · rebuild before comparing</b>}</div>}
      </section>
      <details className="build-advanced">
        <summary>Complete target declaration <small>BLD-005 · persisted schema {activeTarget.schemaVersion}</small></summary>
        <div className="build-declaration-grid">
          <section><h3>Platform &amp; toolchain</h3><dl><div><dt>Machine profile</dt><dd>Current project · {machineId}</dd></div><div><dt>Root</dt><dd>{activeTarget.roots.join(', ')}</dd></div><div><dt>Language</dt><dd>{activeTarget.language}</dd></div><div><dt>Dialect / version</dt><dd>{manifest?.label ?? activeTarget.toolchainId} · {activeTarget.toolchainVersion}</dd></div><div><dt>Output type</dt><dd>{activeTarget.outputType}</dd></div><div><dt>Load address</dt><dd>Derived by toolchain</dd></div><div><dt>Profile</dt><dd>{activeProfile.label} · {activeTarget.profile === 'custom' ? activeTarget.profileOptions.debugMetadata : 'full'} metadata</dd></div></dl></section>
          <section><h3>Source units</h3><div className="build-check-list">{files.filter((file) => file.language === entry?.language).map((file) => { const required = file.id === activeTarget.entryFileId; const selected = activeTarget.sourceFileIds.includes(file.id); const cHeader = entry?.language === 'c' && !/\.c$/i.test(file.name); return <label key={file.id}><input type="checkbox" checked={selected} disabled={required || cHeader || !['6502', 'c', 'arm'].includes(entry?.language ?? '')} onChange={(event) => onChange(activeTarget.id, { sourceFileIds: event.target.checked ? [...activeTarget.sourceFileIds, file.id] : activeTarget.sourceFileIds.filter((id) => id !== file.id) })} /><span>{file.name}</span><small>{required ? 'entry' : cHeader ? 'header · discovered by #include' : selected ? entry?.language === 'c' ? 'compiled unit' : 'linked unit' : 'not built'}</small></label>; })}</div><p>{manifest?.id === 'stardot.beebasm' ? <>BeebAsm uses exactly one root unit; subordinate project files are discovered through literal <code>INCLUDE</code> directives, and the root graph must contain one filename-free <code>SAVE</code>.</> : manifest?.id === 'cc65.c-bbc' ? <>Every selected <code>.c</code> unit is compiled by cc65, assembled by ca65, then linked with the versioned WebIDE BBC startup/runtime. Literal quoted project headers and immutable SDK headers are dependency-tracked; dynamic, absolute, and traversal includes are rejected.</> : manifest?.id === 'gnu.arm-none-eabi-binutils' ? <>Every selected <code>.arm</code> or <code>.sarm</code> unit is assembled for ARM2 and linked at the configured 26-bit address. The raw little-endian output is inspectable but is not labelled as a RISC OS application until filetype/AIF packaging is implemented.</> : manifest?.execution === 'server-native' ? <>Every selected <code>.s</code>, <code>.asm</code> or <code>.a65</code> unit is assembled and then linked; literal project-local includes remain sandboxed.</> : <>Assembly units are expanded after the entry unit unless already reached by <code>INCLUDE</code>. BASIC remains a single interpreter program.</>}</p></section>
          <section><h3>Defines &amp; include paths</h3><label><span>{entry?.language === 'c' ? 'C preprocessor defines' : 'Assembler defines'} · one NAME=VALUE per line</span><textarea aria-label="Build defines" disabled={entry?.language !== '6502' && entry?.language !== 'c'} spellCheck={false} value={activeTarget.defines.join('\n')} placeholder={'DEBUG=&1\nSCREEN=&3000'} onChange={(event) => onChange(activeTarget.id, { defines: event.target.value.split('\n').filter((line) => line.trim()).slice(0, 128) })} /></label><dl><div><dt>Include paths</dt><dd>{activeTarget.includePaths.join(', ')}</dd></div></dl><p>{entry?.language === 'c' ? 'Numeric defines enter the real cc65 preprocessor. Project headers resolve from the declared project root; cc65 and Acorn SDK headers are immutable.' : 'Defines are injected into the real assembler symbol table. Includes resolve against the current flat project root.'}</p></section>
          <section><h3>Memory &amp; execution</h3><label><span>Default origin</span><input aria-label="Build default origin" disabled={!['6502', 'c', 'arm'].includes(entry?.language ?? '')} value={activeTarget.memoryLayout.defaultOrigin} onChange={(event) => onChange(activeTarget.id, { memoryLayout: { ...activeTarget.memoryLayout, defaultOrigin: event.target.value } })} /></label><label><span>Maximum output address</span><input aria-label="Build maximum address" disabled={!['6502', 'c', 'arm'].includes(entry?.language ?? '')} value={activeTarget.memoryLayout.maximumAddress} onChange={(event) => onChange(activeTarget.id, { memoryLayout: { ...activeTarget.memoryLayout, maximumAddress: event.target.value } })} /></label><p>{entry?.language === 'c' ? <>The generated runtime enters at the origin, preserves BBC zero page and the hardware stack, and places the cc65 software stack at <code>&amp;7200</code>; code/data must finish below it.</> : entry?.language === 'arm' ? <>The generated linker script places the first ARM2 section at the word-aligned origin. Origin and inclusive maximum must remain inside the ARM2 26-bit address range; an overflow fails the build.</> : <>An explicit <code>ORG</code> wins over the default. Builds crossing the maximum address fail with a source diagnostic.</>}</p></section>
          <section><h3>Target dependencies</h3><div className="build-check-list">{targets.filter((target) => target.id !== activeTarget.id).length ? targets.filter((target) => target.id !== activeTarget.id).map((target) => <label key={target.id}><input type="checkbox" checked={activeTarget.dependencyTargetIds.includes(target.id)} onChange={(event) => onChange(activeTarget.id, { dependencyTargetIds: event.target.checked ? [...activeTarget.dependencyTargetIds, target.id] : activeTarget.dependencyTargetIds.filter((id) => id !== target.id) })} /><span>{target.name}</span><small>{activeTarget.dependencyTargetIds.includes(target.id) ? 'build first' : 'independent'}</small></label>) : <p>No other targets in this project.</p>}</div><p>Dependencies build first; missing targets, failures and cycles stop the selected build.</p></section>
          <section><h3>Extension registries</h3><dl><div><dt>Libraries</dt><dd>{activeTarget.libraryIds.length ? activeTarget.libraryIds.join(', ') : 'None registered'}</dd></div><div><dt>Generated assets</dt><dd>{activeTarget.generatedAssetIds.length ? activeTarget.generatedAssetIds.join(', ') : 'None registered'}</dd></div><div><dt>Post-processors</dt><dd>{activeTarget.postProcessorIds.length ? activeTarget.postProcessorIds.join(', ') : 'None registered'}</dd></div></dl><p>These declarations are persisted and validated. Controls become available only when a compatible provider is registered.</p></section>
        </div>
      </details>
      <section className="build-graph" aria-label="Build dependency graph">
        <div><h3>Dependency graph</h3><small>dependency-first order · active-file impact flows →</small></div>
        <ol>{graph.order.map((id) => { const node = graph.nodes.find((item) => item.target.id === id)!; const result = buildAllRecords.find((record) => record.targetId === id); return <li className={`${id === activeTarget.id ? 'active' : ''} ${activeImpact.includes(id) ? 'impacted' : ''} ${result ? `status-${result.status}` : ''}`} style={{ '--graph-depth': node.depth } as React.CSSProperties} key={id}><button type="button" onClick={() => onSelect(id)}><strong>{node.target.name}</strong><span>{node.dependencies.length ? `after ${node.dependencies.map((dependencyId) => targets.find((target) => target.id === dependencyId)?.name ?? dependencyId).join(', ')}` : 'root target'}</span><small>{result ? `${result.status} · ${result.message}` : `${node.dependants.length} downstream · ${activeImpact.includes(id) ? 'impacted by active file' : 'unaffected'}`}</small></button></li>; })}</ol>
        {(graph.cycles.length > 0 || graph.missing.length > 0) && <div className="build-graph-errors" role="alert">{graph.cycles.map((cycle) => <span key={cycle.join('-')}>Cycle: {cycle.map((id) => targets.find((target) => target.id === id)?.name ?? id).join(' → ')}</span>)}{graph.missing.map((edge) => <span key={`${edge.targetId}-${edge.dependencyId}`}>Missing dependency {edge.dependencyId}</span>)}</div>}
      </section>
      <div className="build-policy-state" role="status"><span>{activeTarget.buildPolicy === 'manual' ? 'Build only when requested.' : activeTarget.buildPolicy === 'on-save' ? 'Build after an explicit save of the entry file or project.' : 'Build 650 ms after the latest target, source or machine change.'}</span><strong>{pinned ? 'Current artifact retained; background builds are blocked.' : 'Background builds may replace the current artifact.'}</strong></div>
      <div className={`build-activity status-${activity.status}`} role="status" aria-label="Build activity"><strong>{activity.status.toUpperCase()}</strong><span>{activity.targetName || activeTarget.name} · {activity.trigger}</span><small>{activity.message}</small>{activity.startedAt && <code>{activity.finishedAt ? `${Math.max(0, activity.finishedAt - activity.startedAt)} ms` : 'running…'}</code>}</div>
      {errors.length > 0 && <div className="build-target-errors" role="alert">{errors.map((error) => <span key={error}>{error}</span>)}</div>}
      {failure && <section className="build-failure-result" aria-label="Normalized failed build result"><header><div><strong>{failure.exit.reason.replaceAll('-', ' ').toUpperCase()}</strong><span>No artifact was produced or implied.</span></div><button type="button" onClick={downloadFailure}><Icon name="download" size={14} /> Export failed result</button></header><div>{failure.diagnostics.map((diagnostic, index) => <button type="button" disabled={!diagnostic.fileId} onClick={() => diagnostic.fileId && onNavigate(diagnostic.fileId, diagnostic.line)} key={`${diagnostic.fileId}-${diagnostic.line}-${index}`}><strong>ERROR</strong><code>{diagnostic.fileName ? `${diagnostic.fileName}:${diagnostic.line}:${diagnostic.column}` : 'configuration'}</code><span>{diagnostic.message}</span></button>)}</div><footer><code>{failure.invocation.adapterId}@{failure.invocation.adapterVersion}</code><span>{failure.inputs.length} declared input{failure.inputs.length === 1 ? '' : 's'}</span><span>{failure.timing.durationMs.toFixed(2)} ms</span><span>cache {failure.cache.status}</span></footer></section>}
      {stale && <div className="build-stale" role="status">The displayed result is stale because its target, machine profile, or declared source inputs changed. Rebuild before download, run, debug, or test.</div>}
      <section className="build-output-log" aria-label="Build output log"><div><h3>Build output</h3><small>{history.length} retained event{history.length === 1 ? '' : 's'} · newest first · maximum 50</small></div>{history.length ? <ol>{history.map((item) => <li className={`status-${item.status}`} key={`${item.requestId}-${item.finishedAt}`}><time dateTime={new Date(item.finishedAt ?? item.startedAt ?? 0).toISOString()}>{new Date(item.finishedAt ?? item.startedAt ?? 0).toLocaleTimeString()}</time><strong>{item.status}</strong><span>{item.targetName}</span><code>{item.trigger}</code><small>{item.message}{item.diagnostics ? ` · ${item.diagnostics} diagnostic${item.diagnostics === 1 ? '' : 's'}` : ''}{item.fingerprint ? ` · ${item.fingerprint}` : ''}</small></li>)}</ol> : <p>No completed, failed or cancelled build events yet.</p>}</section>
      {artifact && <nav className="artifact-document-tabs" aria-label="Generated artifact documents"><button type="button" aria-current={!selectedDocument && !inspectorSelected ? 'page' : undefined} onClick={() => onArtifactDocumentChange(undefined)}>Overview</button><button type="button" aria-current={inspectorSelected ? 'page' : undefined} onClick={() => onArtifactDocumentChange('@byte-inspector')}>Byte inspector</button>{documents.map((document) => <button type="button" aria-current={selectedDocument?.id === document.id ? 'page' : undefined} onClick={() => onArtifactDocumentChange(document.id)} key={document.id}>{document.label} <small>RO</small></button>)}</nav>}
      {!artifact ? <div className="honest-empty runtime-empty">Configure a valid target and build it. Diagnostics, listing, symbols and a reproducible artifact identity will appear here.</div> : inspectorSelected ? <ArtifactInspector artifact={artifact} onNavigate={onNavigate} /> : selectedDocument ? <GeneratedArtifactDocumentView artifact={artifact} document={selectedDocument} onNavigate={onNavigate} /> : <>
        <div className="build-summary"><span><strong>{artifact.bytes.length}</strong> bytes</span>{isMachineCodeArtifact(artifact) ? <><span>Origin <strong>{formatAddress(artifact.origin, artifact.kind === 'arm-binary' ? 8 : 4)}</strong></span><span>Entry <strong>{formatAddress(artifact.entryPoint, artifact.kind === 'arm-binary' ? 8 : 4)}</strong></span><span><strong>{Object.keys(artifact.symbols).length}</strong> symbols</span><span><strong>{artifact.dependencies.length}</strong> inputs</span>{artifact.kind === 'arm-binary' && <span>Format <strong>ARM2 raw · not RISC OS</strong></span>}</> : <><span><strong>{artifact.lineCount}</strong> lines</span><span>Dialect <strong>{artifact.dialect}</strong></span></>}<span><strong>{artifact.diagnostics.length}</strong> diagnostics</span></div>
        {artifact.provenance && <div className="build-provenance" aria-label="Build provenance"><span>Build <code>{artifact.provenance.fingerprint}</code></span><span>Output SHA-256 <code>{artifact.provenance.output.sha256.slice(0, 12)}…</code></span><span>{artifact.provenance.toolchain.label} <code>{artifact.provenance.toolchain.version}</code></span><span>{artifact.provenance.inputs.length} declared input{artifact.provenance.inputs.length === 1 ? '' : 's'}</span>{metadata && <span className={`cache-${metadata.cache.status}`}>Cache <strong>{metadata.cache.status.toUpperCase()}</strong> · {metadata.cache.hits} hit / {metadata.cache.misses} miss · {metadata.cache.entries} entr{metadata.cache.entries === 1 ? 'y' : 'ies'}{metadata.cache.corruptions ? ` · ${metadata.cache.corruptions} rejected` : ''}</span>}</div>}
        {artifact.diagnostics.length > 0 && <div className="build-diagnostics" aria-label="Build diagnostics">{artifact.diagnostics.map((item, index) => <button type="button" disabled={!item.fileId} onClick={() => item.fileId && onNavigate(item.fileId, item.line)} className={`diagnostic-${item.severity}`} key={`${item.fileId}-${item.line}-${index}`}><strong>{item.severity.toUpperCase()}</strong><code>{item.fileName ? `${item.fileName}:` : 'line '}{item.line}:{item.column}</code><span>{item.message}</span></button>)}</div>}
        <div className="build-result-grid"><section><h3>Listing · activate a mapped row to open source</h3><div className="artifact-listing-rows" role="list" aria-label="Navigable build listing">{listingRows.map((row, index) => <button type="button" role="listitem" disabled={!row.source} onClick={() => row.source && onNavigate(row.source.fileId, row.source.line)} key={`${row.address}-${index}`}><code>{row.text}</code>{row.source && <small>{row.source.fileName}:{row.source.line}</small>}</button>)}</div></section>{isMachineCodeArtifact(artifact) ? <section><h3>Symbols &amp; immutable references</h3>{artifact.dependencies.length > 0 && <div className="build-dependencies"><span>Declared files</span>{artifact.dependencies.map((name) => <code key={name}>{name}</code>)}</div>}<div className="symbol-list">{Object.entries(artifact.symbols).sort((a, b) => a[1] - b[1]).map(([name, address]) => <button type="button" aria-pressed={selectedSymbol === name} onClick={() => setSelectedSymbol(name)} key={name}><code>{name}</code><strong>{formatAddress(address, artifact.kind === 'arm-binary' ? 8 : 4)}</strong></button>)}</div>{selectedSymbol && <div className="artifact-symbol-references"><h4>{selectedSymbol} · {symbolReferences.length} source occurrence{symbolReferences.length === 1 ? '' : 's'}</h4>{symbolReferences.length ? symbolReferences.map((reference) => <button type="button" onClick={() => onNavigate(reference.fileId, reference.line, reference.column, selectedSymbol.length)} key={`${reference.fileId}-${reference.line}-${reference.column}`}><strong>{reference.definition ? 'DEF' : 'REF'}</strong><span>{reference.fileName}:{reference.line}:{reference.column}</span></button>) : <p>Predefined/toolchain symbol; no project source occurrence.</p>}</div>}</section> : artifact.kind === 'atom-basic-text' ? <section><h3>Interpreter source artifact</h3><p className="honest-note">Atom BASIC stores program text rather than BBC-style keyword tokens. This bounded ASCII artifact can be downloaded or entered automatically through the real Atom keyboard/interpreter adapter.</p><pre className="build-listing">{new TextDecoder().decode(artifact.bytes)}</pre></section> : <section><h3>Tokenized program</h3><p className="honest-note">BBC BASIC II keywords and protected line references are encoded in the downloadable program. Execution will attach to the ROM-aware machine adapter.</p><pre className="build-listing">{Array.from(artifact.bytes.slice(0, 128)).map(formatByte).join(' ')}</pre></section>}</div>
      </>}
    </div>
  );
}

function GeneratedArtifactDocumentView({ artifact, document, onNavigate }: { artifact: BuildArtifact; document: ReturnType<typeof generatedArtifactDocuments>[number]; onNavigate: (fileId: string, line: number) => void }) {
  const download = () => downloadBlob(new Blob([document.content, '\n'], { type: document.id === 'provenance' || document.id === 'build-result' ? 'application/json' : 'text/plain;charset=utf-8' }), document.filename);
  const sourceRows = isMachineCodeArtifact(artifact) ? Object.entries(artifact.sourceLocations).sort(([left], [right]) => Number(left) - Number(right)) : [];
  return <section className="generated-artifact-document" aria-label={`${document.label} generated read-only document`}>
    <header><div><span>GENERATED · READ ONLY</span><h3>{document.filename}</h3></div><button type="button" onClick={download}><Icon name="download" size={14} /> Export document</button></header>
    {document.id === 'source-map' && isMachineCodeArtifact(artifact) ? <div className="source-map-document" role="list" aria-label="Navigable source address map">{sourceRows.map(([address, location]) => <button type="button" role="listitem" onClick={() => onNavigate(location.fileId, location.line)} key={address}><code>{formatAddress(Number(address), artifact.kind === 'arm-binary' ? 8 : 4)}</code><span>{location.fileName}:{location.line}</span></button>)}</div> : document.id === 'listing' ? <div className="artifact-listing-rows generated-listing" role="list" aria-label="Generated navigable listing">{artifactListingRows(artifact).map((row, index) => <button type="button" role="listitem" disabled={!row.source} onClick={() => row.source && onNavigate(row.source.fileId, row.source.line)} key={`${row.address}-${index}`}><code>{row.text}</code>{row.source && <small>{row.source.fileName}:{row.source.line}</small>}</button>)}</div> : <pre tabIndex={0}>{document.content}</pre>}
  </section>;
}

function ArtifactInspector({ artifact, onNavigate }: { artifact: BuildArtifact; onNavigate: (fileId: string, line: number) => void }) {
  const [view, setView] = useState<'hex' | 'text'>('hex');
  const [windowStart, setWindowStart] = useState(0);
  const [selectedOffset, setSelectedOffset] = useState(0);
  const [addressQuery, setAddressQuery] = useState('');
  const [searchMode, setSearchMode] = useState<ArtifactSearchMode>('hex');
  const [searchQuery, setSearchQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [comparison, setComparison] = useState<{ name: string; bytes: Uint8Array }>();
  const [comparisonError, setComparisonError] = useState('');
  const origin = isMachineCodeArtifact(artifact) ? artifact.origin : 0;
  const identity = artifact.provenance?.fingerprint ?? `${artifact.kind}:${artifact.bytes.length}:${crc32Hex(artifact.bytes)}`;
  useEffect(() => { setWindowStart(0); setSelectedOffset(0); setSearchQuery(''); setComparison(undefined); setComparisonError(''); }, [identity]);
  const search = useMemo(() => {
    try { return { result: searchArtifact(artifact.bytes, searchQuery, searchMode), error: '' }; }
    catch (error) { return { result: undefined, error: error instanceof Error ? error.message : String(error) }; }
  }, [artifact.bytes, searchMode, searchQuery]);
  useEffect(() => setMatchIndex(0), [searchMode, searchQuery, identity]);
  const diff = useMemo(() => comparison ? compareArtifacts(artifact.bytes, comparison.bytes) : undefined, [artifact.bytes, comparison]);
  const sha256 = useMemo(() => sha256Hex(artifact.bytes), [artifact.bytes]);
  const visibleEnd = Math.min(artifact.bytes.length, windowStart + 256);
  const rows = Array.from({ length: Math.ceil((visibleEnd - windowStart) / 16) }, (_, index) => windowStart + index * 16);
  const selectedAddress = origin + Math.min(selectedOffset, Math.max(0, artifact.bytes.length - 1));
  const source = isMachineCodeArtifact(artifact) ? artifact.sourceLocations[selectedAddress] : undefined;
  const selectOffset = (offset: number) => { const bounded = Math.max(0, Math.min(offset, artifact.bytes.length - 1)); setSelectedOffset(bounded); setWindowStart(artifactWindowStart(bounded, artifact.bytes.length)); };
  const moveMatch = (direction: number) => {
    const matches = search.result?.offsets ?? [];
    if (!matches.length) return;
    const next = (matchIndex + direction + matches.length) % matches.length;
    setMatchIndex(next); selectOffset(matches[next]!);
  };
  const goToAddress = () => {
    const trimmed = addressQuery.trim();
    const parsed = /^(?:&|\$)[0-9a-f]+$/i.test(trimmed) ? Number.parseInt(trimmed.slice(1), 16) : /^0x[0-9a-f]+$/i.test(trimmed) ? Number.parseInt(trimmed.slice(2), 16) : /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
    if (!Number.isFinite(parsed)) return;
    selectOffset(origin && parsed >= origin ? parsed - origin : parsed);
  };
  const importComparison = async (file: File | undefined) => {
    setComparison(undefined); setComparisonError('');
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setComparisonError('Comparison files are limited to 2 MiB.'); return; }
    setComparison({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  };
  const exportWindow = () => downloadBlob(new Blob([artifact.bytes.slice(windowStart, visibleEnd)], { type: 'application/octet-stream' }), `${safeFilename(artifact.provenance?.target.outputName ?? 'artifact')}.offset-${windowStart.toString(16).padStart(4, '0')}.bin`);
  return <section className="artifact-inspector" aria-label="Build artifact byte inspector">
    <header><div><span>IMMUTABLE BUILD OUTPUT</span><h3>Hex, text and binary inspector</h3></div><div className="artifact-checksums"><span>SHA-256 <code>{sha256}</code></span><span>CRC-32 <code>{crc32Hex(artifact.bytes)}</code></span></div></header>
    <div className="artifact-inspector-controls">
      <label><span>View</span><select aria-label="Artifact viewer mode" value={view} onChange={(event) => setView(event.target.value as 'hex' | 'text')}><option value="hex">Hex + ASCII</option><option value="text">Printable text</option></select></label>
      <label><span>{origin ? 'Address / offset' : 'Offset'}</span><input aria-label="Artifact address or offset" value={addressQuery} onChange={(event) => setAddressQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') goToAddress(); }} placeholder={origin ? formatAddress(origin) : '0'} /></label><button type="button" onClick={goToAddress}>Go</button>
      <label><span>Search as</span><select aria-label="Artifact search mode" value={searchMode} onChange={(event) => setSearchMode(event.target.value as ArtifactSearchMode)}><option value="hex">Hex bytes</option><option value="text">Text</option></select></label>
      <label className="artifact-search-query"><span>Find bytes</span><input aria-label="Search artifact bytes" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={searchMode === 'hex' ? 'A9 41 or &A9,&41' : 'Text'} /></label>
      <button type="button" disabled={!search.result?.offsets.length} onClick={() => moveMatch(-1)}>Previous</button><button type="button" disabled={!search.result?.offsets.length} onClick={() => moveMatch(1)}>Next</button>
      <button type="button" onClick={exportWindow}><Icon name="download" size={13} /> Export window</button>
    </div>
    <div className="artifact-inspector-status" role="status">{search.error || (searchQuery ? `${search.result?.total ?? 0} match${search.result?.total === 1 ? '' : 'es'}${search.result?.truncated ? ' · first 10,000 retained' : ''}` : `${artifact.bytes.length.toLocaleString()} bytes · showing offsets ${windowStart}–${Math.max(windowStart, visibleEnd - 1)}`)}</div>
    <div className="artifact-inspector-body">
      <div className="artifact-byte-view">
        {view === 'hex' ? <div className="artifact-hex-table" role="table" aria-label="Artifact hexadecimal bytes"><div className="artifact-hex-head" role="row"><span>Address</span><span>00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F</span><span>ASCII</span></div>{rows.map((offset) => <div role="row" className="artifact-hex-row" key={offset}><button type="button" disabled={!isMachineCodeArtifact(artifact) || !artifact.sourceLocations[origin + offset]} onClick={() => { const location = isMachineCodeArtifact(artifact) ? artifact.sourceLocations[origin + offset] : undefined; if (location) onNavigate(location.fileId, location.line); }}>{origin ? formatAddress(origin + offset) : `+&${offset.toString(16).toUpperCase().padStart(4, '0')}`}</button><span>{Array.from(artifact.bytes.slice(offset, Math.min(offset + 16, visibleEnd))).map((byte, index) => <button type="button" aria-label={`Select byte at ${origin ? formatAddress(origin + offset + index) : `offset ${offset + index}`}: ${formatByte(byte)}`} aria-pressed={selectedOffset === offset + index} className={search.result?.offsets.some((match) => offset + index >= match && offset + index < match + (search.result?.pattern.length ?? 0)) ? 'match' : ''} onClick={() => setSelectedOffset(offset + index)} key={index}>{formatByte(byte)}</button>)}</span><code>{Array.from(artifact.bytes.slice(offset, Math.min(offset + 16, visibleEnd)), (byte) => byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '·').join('')}</code></div>)}</div> : <pre className="artifact-text-view" tabIndex={0}>{Array.from(artifact.bytes.slice(windowStart, visibleEnd), (byte) => byte === 10 || byte === 13 || byte === 9 ? String.fromCharCode(byte) : byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '·').join('')}</pre>}
        <div className="artifact-window-nav"><button type="button" disabled={!windowStart} onClick={() => setWindowStart(artifactWindowStart(windowStart - 256, artifact.bytes.length))}>Previous 256</button><span>{windowStart.toLocaleString()} / {artifact.bytes.length.toLocaleString()}</span><button type="button" disabled={visibleEnd >= artifact.bytes.length} onClick={() => setWindowStart(artifactWindowStart(windowStart + 256, artifact.bytes.length))}>Next 256</button></div>
      </div>
      <aside className="artifact-byte-detail" aria-label="Selected artifact byte"><span>SELECTED BYTE</span><strong>{origin ? formatAddress(selectedAddress) : `offset ${selectedOffset}`}</strong><code>{formatByte(artifact.bytes[selectedOffset] ?? 0)} · {(artifact.bytes[selectedOffset] ?? 0).toString(2).padStart(8, '0')} · {artifact.bytes[selectedOffset] ?? 0}</code>{source ? <button type="button" onClick={() => onNavigate(source.fileId, source.line)}>Open {source.fileName}:{source.line}</button> : <small>No authoritative source mapping for this byte.</small>}</aside>
    </div>
    <section className="artifact-compare" aria-label="Compare build artifact"><header><div><span>BYTE COMPARISON</span><h4>Compare with local binary</h4></div><label><span className="visually-hidden">Comparison binary</span><input aria-label="Comparison binary file" type="file" accept="application/octet-stream" onChange={(event) => void importComparison(event.target.files?.[0])} /></label></header>{comparisonError ? <div role="alert">{comparisonError}</div> : !comparison ? <p>Choose a bounded local file. It remains in browser memory and is not uploaded.</p> : diff && <><div className={`artifact-diff-summary ${diff.equal ? 'equal' : 'different'}`} role="status"><strong>{diff.equal ? 'BYTE-IDENTICAL' : 'DIFFERENT'}</strong><span>{comparison.name} · {comparison.bytes.length.toLocaleString()} bytes</span><span>{diff.changed} changed · {diff.added} added · {diff.removed} removed</span></div>{!diff.equal && <div className="artifact-diff-list" role="list" aria-label="Artifact byte differences">{diff.differences.map((difference) => <button type="button" role="listitem" onClick={() => selectOffset(difference.offset)} key={difference.offset}><code>+&{difference.offset.toString(16).toUpperCase().padStart(4, '0')}</code><span>{difference.left === undefined ? '--' : formatByte(difference.left)} → {difference.right === undefined ? '--' : formatByte(difference.right)}</span></button>)}{diff.truncated && <small>Showing the first 512 differing offsets.</small>}</div>}</>}</section>
  </section>;
}

function ScreenGoldenCanvas({ rgbaBase64, width, height, label, differenceFrom, channelTolerance = 0 }: { rgbaBase64: string; width: number; height: number; label: string; differenceFrom?: string; channelTolerance?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const context = canvas.getContext('2d'); if (!context) return;
    const bytes = base64ToBytes(rgbaBase64); const output = new Uint8ClampedArray(bytes);
    if (differenceFrom) {
      const expected = base64ToBytes(differenceFrom);
      for (let offset = 0; offset < output.length; offset += 4) {
        let delta = 0; for (let channel = 0; channel < 4; channel += 1) delta = Math.max(delta, Math.abs(bytes[offset + channel]! - expected[offset + channel]!));
        output[offset] = delta > channelTolerance ? 255 : 0; output[offset + 1] = 0; output[offset + 2] = 0; output[offset + 3] = delta > channelTolerance ? 255 : 32;
      }
    }
    canvas.width = width; canvas.height = height; context.putImageData(new ImageData(output, width, height), 0, 0);
  }, [channelTolerance, differenceFrom, height, rgbaBase64, width]);
  return <figure className="screen-golden-view"><canvas ref={ref} aria-label={label} /><figcaption>{label} · {width}×{height}</figcaption></figure>;
}

function ScreenDifferencePanel({ assertion }: { assertion: MachineTestResult['assertions'][number] }) {
  if (assertion.kind !== 'screen-golden' || !assertion.expectedRgbaBase64 || !assertion.actualRgbaBase64) return null;
  return <div className="screen-difference-panel" aria-label={`Screen difference for ${assertion.goldenId}`}><ScreenGoldenCanvas rgbaBase64={assertion.expectedRgbaBase64} width={assertion.width} height={assertion.height} label="Expected golden" /><ScreenGoldenCanvas rgbaBase64={assertion.actualRgbaBase64} width={assertion.width} height={assertion.height} label="Actual framebuffer" /><ScreenGoldenCanvas rgbaBase64={assertion.actualRgbaBase64} differenceFrom={assertion.expectedRgbaBase64} channelTolerance={assertion.allowedChannelDelta} width={assertion.width} height={assertion.height} label="Difference mask" /></div>;
}

function TestResultPanel({ result, testAllRecords }: { result: MachineTestResult | null; testAllRecords: TestAllRecord[] }) {
  const outcome = (assertion: MachineTestResult['assertions'][number]) => {
    if (assertion.kind === 'register') return `expected ${assertion.register.toUpperCase()}=${assertion.register === 'pc' ? formatAddress(assertion.expected) : `&${formatByte(assertion.expected)}`} · actual ${assertion.register === 'pc' ? formatAddress(assertion.actual as number) : `&${formatByte(assertion.actual as number)}`}`;
    if (assertion.kind === 'memory') return `expected ${assertion.expected.map(formatByte).join(' ')} · actual ${(assertion.actual as number[]).map(formatByte).join(' ')}`;
    if (assertion.kind === 'output') return `expected ${JSON.stringify(assertion.expected)} · actual ${JSON.stringify(assertion.actual as string)}`;
    if (assertion.kind === 'audio') return `expected FNV32:${assertion.expected} · actual FNV32:${assertion.actual as string} · ${(assertion as typeof assertion & { writes?: number }).writes ?? 0} sound-chip writes`;
    if (assertion.kind === 'screen') return `expected FNV32:${assertion.expected} · actual FNV32:${assertion.actual as string} · region ${assertion.x},${assertion.y} ${assertion.width}×${assertion.height}`;
    if (assertion.kind === 'screen-golden') return `golden ${assertion.goldenId} · expected FNV32:${assertion.expectedDigest} · actual FNV32:${assertion.actualDigest} · ${assertion.differingPixels?.toLocaleString()} differing pixels allowed ${assertion.allowedDifferingPixels.toLocaleString()} · maximum channel delta ${assertion.maximumChannelDelta} allowed ${assertion.allowedChannelDelta}`;
    if (assertion.kind === 'event') return `expected ${assertion.event.toUpperCase()} calls=${assertion.expected.toLocaleString()} · actual ${(assertion.actual as number).toLocaleString()}`;
    if (assertion.kind === 'event-address') return `expected entries to ${formatAddress(assertion.address)}=${assertion.expected.toLocaleString()} · actual ${(assertion.actual as number).toLocaleString()}`;
    if (assertion.kind === 'audio-speaker') return `expected speaker transitions=${assertion.expected.toLocaleString()} · actual ${(assertion.actual as number).toLocaleString()}`;
    if (assertion.operator === 'range') return `expected cycles between ${assertion.expected.toLocaleString()} and ${(assertion as typeof assertion & { expectedMaximum: number }).expectedMaximum.toLocaleString()} · actual ${(assertion.actual as number).toLocaleString()}`;
    return `expected cycles ${assertion.operator === 'eq' ? '=' : assertion.operator === 'lte' ? '≤' : '≥'} ${assertion.expected.toLocaleString()} · actual ${(assertion.actual as number).toLocaleString()}`;
  };
  return <section className="test-result"><h3>{testAllRecords.length ? 'Test-all results' : 'Latest result'}</h3>{testAllRecords.length ? <div className="test-all-results" role="list" aria-label="Test all results">{testAllRecords.map((item) => <div role="listitem" className={`status-${item.status}`} key={item.planId}><strong>{item.status.toUpperCase()}</strong><span>{item.name}</span><small>{item.message}</small>{item.result && <code>{item.result.cycles.toLocaleString()} cycles</code>}</div>)}</div> : !result ? <div className="honest-empty">No hardware test has run in this session.</div> : <><div className={`test-status status-${result.status}`}><strong>{result.status.toUpperCase()}</strong><span>{result.name}</span><small>{result.reason}</small><div><code>{result.cycles.toLocaleString()} cycles</code>{result.stopAddress !== undefined && <code>stop {formatAddress(result.stopAddress)}</code>}{result.cycleBudget !== undefined && <code>budget {result.cycleBudget.toLocaleString()}</code>}{result.teardown && <code>teardown {result.teardown}</code>}</div></div>{result.assertions.length > 0 && <div className="test-assertion-results" role="list" aria-label="Hardware test assertion results">{result.assertions.map((assertion, index) => <div role="listitem" className={assertion.passed ? 'passed' : 'failed'} key={`${assertion.source}-${index}`}><Icon name={assertion.passed ? 'check' : 'close'} size={15} /><strong>{assertion.source}</strong><span>{outcome(assertion)}</span><ScreenDifferencePanel assertion={assertion} /></div>)}</div>}{result.captures?.length ? <div className="test-capture-results" aria-label="Hardware test artifact captures">{result.captures.map((capture) => <div key={capture.id}><strong>{capture.kind}</strong>{capture.kind === 'registers' ? <code>{Object.entries(capture.registers).map(([name, value]) => `${name.toUpperCase()}=${name === 'pc' ? formatAddress(value) : `&${formatByte(value)}`}`).join(' ')}</code> : <code>{formatAddress(capture.address)} · {capture.bytes.map(formatByte).join(' ')}</code>}</div>)}</div> : null}</>}</section>;
}

function TestInputEditor({
  plan,
  onChange,
}: {
  plan: TargetTestPlan;
  onChange: (id: string, update: Partial<TargetTestPlan>) => void;
}) {
  /* What the recorder is capturing. Keys were the first slice; a gamepad and
   * the pointer are recorded the same way, because a test that can only be
   * given a joystick position by typing it in is a test nobody writes. */
  const [recording, setRecording] = useState<'off' | 'keys' | 'gamepad' | 'pointer'>('off');
  const [delayCycles, setDelayCycles] = useState("1000");
  const [gamepadAction, setGamepadAction] = useState<GamepadAction>("fire1");
  const [gamepadCode, setGamepadCode] = useState(90);
  const [analogueChannels, setAnalogueChannels] = useState<
    [number, number, number, number]
  >([0x8000, 0x8000, 0x8000, 0x8000]);
  const [analogueButtons, setAnalogueButtons] = useState<[boolean, boolean]>([
    false,
    false,
  ]);
  const [mousePosition, setMousePosition] = useState<[number, number]>([
    0x8000,
    0x8000,
  ]);
  const [mouseButtons, setMouseButtons] = useState<[boolean, boolean]>([
    false,
    false,
  ]);
  const [atomMmcControls, setAtomMmcControls] = useState({
    up: false,
    down: false,
    left: false,
    right: false,
    fire: false,
  });
  const [mediaAction, setMediaAction] = useState<
    | "eject-disc-0"
    | "eject-disc-1"
    | "eject-tape"
    | "mount-initial-disc-0"
    | "mount-initial-disc-1"
    | "mount-initial-tape"
  >("eject-disc-0");
  useEffect(() => {
    if (recording !== 'keys') return;
    const capture = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        !/^[A-Za-z0-9]{1,24}$/.test(event.code) ||
        plan.inputs.length >= 256
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      onChange(plan.id, {
        inputs: [
          ...plan.inputs,
          { kind: "key", code: event.code, pressed: event.type === "keydown" },
        ],
      });
    };
    window.addEventListener("keydown", capture, true);
    window.addEventListener("keyup", capture, true);
    return () => {
      window.removeEventListener("keydown", capture, true);
      window.removeEventListener("keyup", capture, true);
    };
  }, [onChange, plan.id, plan.inputs, recording]);

  /*
   * Recording a real controller.
   *
   * A gamepad has no events — the browser only reports its state when asked —
   * so it is polled, and only a change is written down. Recording the state on
   * every frame would fill the two-hundred-and-fifty-six input budget in four
   * seconds with entries that say nothing happened.
   */
  useEffect(() => {
    if (recording !== 'gamepad') return;
    let recorded: string | null = null;
    let frame = 0;
    const poll = () => {
      frame = requestAnimationFrame(poll);
      const pad = navigator.getGamepads?.().find((candidate) => candidate) ?? null;
      if (!pad) return;
      /* The same reader the live joystick path uses, with the same dead zone,
       * so a recording and a live session agree about what is held. */
      const down = activeGamepadActions(pad, GAMEPAD_RECORD_DEAD_ZONE);
      const pressed = GAMEPAD_ACTIONS.filter((action) => down.has(action.id)).map((action) => action.id);
      const signature = pressed.join(',');
      if (signature === recorded) return;
      const previous: GamepadAction[] = recorded === null ? [] : recorded.split(',').filter(Boolean) as GamepadAction[];
      recorded = signature;
      const entries = gamepadTransitions(previous, pressed, validateMachineTapCode(gamepadCode));
      if (!entries.length) return;
      onChange(plan.id, { inputs: appendRecorded(plan.inputs, entries) });
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, [gamepadCode, onChange, plan.id, plan.inputs, recording]);

  /*
   * Recording the pointer as the analogue joystick it is mapped to.
   *
   * The position is taken relative to the element it moved over and scaled to
   * the sixteen-bit range the machine reads, inverted the way the real
   * converter is. Movement is sampled rather than taken from every event: a
   * pointer produces hundreds of events a second and a test wants the few that
   * matter.
   */
  useEffect(() => {
    if (recording !== 'pointer') return;
    let last = 0;
    const capture = (event: PointerEvent) => {
      const now = event.timeStamp;
      if (!shouldSamplePointer(last, now)) return;
      last = now;
      const target = event.currentTarget as HTMLElement | null;
      const box = target?.getBoundingClientRect();
      if (!box) return;
      const sample = pointerSample(box, { clientX: event.clientX, clientY: event.clientY, buttons: event.buttons });
      if (!sample) return;
      onChange(plan.id, { inputs: appendRecorded(plan.inputs, [sample]) });
    };
    const surface = window.document.querySelector('.test-input-surface');
    surface?.addEventListener('pointermove', capture as EventListener);
    surface?.addEventListener('pointerdown', capture as EventListener);
    return () => {
      surface?.removeEventListener('pointermove', capture as EventListener);
      surface?.removeEventListener('pointerdown', capture as EventListener);
    };
  }, [onChange, plan.id, plan.inputs, recording]);

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= plan.inputs.length) return;
    const inputs = [...plan.inputs];
    [inputs[index], inputs[target]] = [inputs[target]!, inputs[index]!];
    onChange(plan.id, { inputs });
  };
  const addDelay = () => {
    const cycles = Number(delayCycles);
    if (
      !Number.isInteger(cycles) ||
      cycles < 1 ||
      cycles > 10_000_000 ||
      plan.inputs.length >= 256
    )
      return;
    onChange(plan.id, { inputs: [...plan.inputs, { kind: "delay", cycles }] });
  };
  const addGamepadPair = () => {
    if (plan.inputs.length > 254) return;
    const code = validateMachineTapCode(gamepadCode);
    onChange(plan.id, {
      inputs: [
        ...plan.inputs,
        { kind: "gamepad", action: gamepadAction, code, pressed: true },
        { kind: "gamepad", action: gamepadAction, code, pressed: false },
      ],
    });
  };
  const addAnalogueState = () => {
    if (
      plan.inputs.length >= 256 ||
      analogueChannels.some(
        (value) => !Number.isInteger(value) || value < 0 || value > 0xffff,
      )
    )
      return;
    onChange(plan.id, {
      inputs: [
        ...plan.inputs,
        {
          kind: "bbc-analogue",
          channels: [...analogueChannels] as [number, number, number, number],
          buttons: [...analogueButtons] as [boolean, boolean],
        },
      ],
    });
  };
  const addMouseState = () => {
    if (
      plan.inputs.length >= 256 ||
      mousePosition.some(
        (value) => !Number.isInteger(value) || value < 0 || value > 0xffff,
      )
    )
      return;
    onChange(plan.id, {
      inputs: [
        ...plan.inputs,
        {
          kind: "bbc-mouse",
          x: mousePosition[0],
          y: mousePosition[1],
          buttons: [...mouseButtons] as [boolean, boolean],
        },
      ],
    });
  };
  return (
    <details className="test-input-editor">
      <summary>
        <strong>Deterministic input script</strong>
        <span>
          {plan.inputs.length}/256 actions ·{" "}
          {recording === "off" ? "ready" : `recording ${RECORDER_LABELS[recording]}`}
        </span>
      </summary>
      <div className="test-input-actions test-input-surface">
        {/* One recorder per device rather than one switch, because what is
            being captured decides what a stray movement means: a pointer moved
            across the panel while keys are being recorded is not input. */}
        {(["keys", "gamepad", "pointer"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={recording === mode}
            onClick={() => setRecording((value) => (value === mode ? "off" : mode))}
          >
            {recording === mode ? `Stop recording ${RECORDER_LABELS[mode]}` : `Record ${RECORDER_LABELS[mode]}`}
          </button>
        ))}
        <label>
          <span>Delay cycles</span>
          <input
            aria-label="Test input delay cycles"
            type="number"
            min={1}
            max={10_000_000}
            value={delayCycles}
            onChange={(event) => setDelayCycles(event.target.value)}
          />
        </label>
        <button type="button" onClick={addDelay}>
          Add delay
        </button>
        <label>
          <span>Gamepad action</span>
          <select
            aria-label="Test gamepad action"
            value={gamepadAction}
            onChange={(event) =>
              setGamepadAction(event.target.value as GamepadAction)
            }
          >
            {GAMEPAD_ACTIONS.map((action) => (
              <option value={action.id} key={action.id}>
                {action.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Acorn target</span>
          <select
            aria-label="Test gamepad Acorn key"
            value={gamepadCode}
            onChange={(event) => setGamepadCode(Number(event.target.value))}
          >
            {ACORN_KEY_ROWS.flat().map((key) => (
              <option value={key.code} key={`${key.label}-${key.code}`}>
                {key.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={plan.inputs.length > 254}
          onClick={addGamepadPair}
        >
          Add gamepad press and release
        </button>
        {analogueChannels.map((value, channel) => (
          <label key={channel}>
            <span>ADC {channel}</span>
            <input
              aria-label={`Test BBC analogue channel ${channel}`}
              type="number"
              min={0}
              max={65535}
              value={value}
              onChange={(event) =>
                setAnalogueChannels(
                  (current) =>
                    current.map((candidate, index) =>
                      index === channel
                        ? Number(event.target.value)
                        : candidate,
                    ) as [number, number, number, number],
                )
              }
            />
          </label>
        ))}
        {analogueButtons.map((pressed, button) => (
          <label key={`fire-${button}`}>
            <input
              aria-label={`Test BBC analogue fire ${button + 1}`}
              type="checkbox"
              checked={pressed}
              onChange={(event) =>
                setAnalogueButtons(
                  (current) =>
                    current.map((candidate, index) =>
                      index === button ? event.target.checked : candidate,
                    ) as [boolean, boolean],
                )
              }
            />{" "}
            Fire {button + 1}
          </label>
        ))}
        <button
          type="button"
          disabled={plan.inputs.length >= 256}
          onClick={addAnalogueState}
        >
          Add BBC analogue state
        </button>
        {mousePosition.map((value, axis) => (
          <label key={`mouse-${axis}`}>
            <span>{axis === 0 ? "Pointer X" : "Pointer Y"}</span>
            <input
              aria-label={`Test BBC mouse pointer ${axis === 0 ? "X" : "Y"}`}
              type="number"
              min={0}
              max={65535}
              value={value}
              onChange={(event) =>
                setMousePosition(
                  (current) =>
                    current.map((candidate, index) =>
                      index === axis ? Number(event.target.value) : candidate,
                    ) as [number, number],
                )
              }
            />
          </label>
        ))}
        {mouseButtons.map((pressed, button) => (
          <label key={`mouse-button-${button}`}>
            <input
              aria-label={`Test BBC mouse ${button === 0 ? "left" : "right"} button`}
              type="checkbox"
              checked={pressed}
              onChange={(event) =>
                setMouseButtons(
                  (current) =>
                    current.map((candidate, index) =>
                      index === button ? event.target.checked : candidate,
                    ) as [boolean, boolean],
                )
              }
            />{" "}
            {button === 0 ? "Left" : "Right"} mouse button
          </label>
        ))}
        <button
          type="button"
          disabled={plan.inputs.length >= 256}
          onClick={addMouseState}
        >
          Add BBC mouse state
        </button>
        {(["up", "down", "left", "right", "fire"] as const).map((control) => (
          <label key={`atom-atommc-${control}`}>
            <input
              aria-label={`Test Atom AtoMMC ${control}`}
              type="checkbox"
              checked={atomMmcControls[control]}
              onChange={(event) =>
                setAtomMmcControls((current) => ({
                  ...current,
                  [control]: event.target.checked,
                }))
              }
            />{" "}
            AtoMMC {control}
          </label>
        ))}
        <button
          type="button"
          disabled={plan.inputs.length >= 256}
          onClick={() =>
            onChange(plan.id, {
              inputs: [
                ...plan.inputs,
                { kind: "atom-atommc", ...atomMmcControls },
              ],
            })
          }
        >
          Add Atom AtoMMC state
        </button>
        <label>
          <span>Media action</span>
          <select
            aria-label="Test media action"
            value={mediaAction}
            onChange={(event) =>
              setMediaAction(event.target.value as typeof mediaAction)
            }
          >
            <option value="eject-disc-0">Eject drive 0</option>
            <option value="eject-disc-1">Eject drive 1</option>
            <option value="eject-tape">Eject cassette</option>
            <option value="mount-initial-disc-0">Mount initial drive 0 disk</option>
            <option value="mount-initial-disc-1">Mount initial drive 1 disk</option>
            <option value="mount-initial-tape">Mount initial cassette</option>
          </select>
        </label>
        <button
          type="button"
          disabled={plan.inputs.length >= 256}
          onClick={() =>
            onChange(plan.id, {
              inputs: [...plan.inputs, { kind: "media", action: mediaAction }],
            })
          }
        >
          Add media action
        </button>
        <button
          type="button"
          disabled={plan.inputs.length >= 256}
          onClick={() =>
            onChange(plan.id, {
              inputs: [
                ...plan.inputs,
                { kind: "emulator-event", event: "next-video-frame" },
              ],
            })
          }
        >
          Wait for next video frame
        </button>
        <button
          type="button"
          disabled={plan.inputs.length >= 256}
          onClick={() =>
            onChange(plan.id, {
              inputs: [...plan.inputs, { kind: "reset", reset: "hard" }],
            })
          }
        >
          Add hard reset
        </button>
        <button
          type="button"
          disabled={!plan.inputs.length}
          onClick={() => onChange(plan.id, { inputs: [] })}
        >
          Clear script
        </button>
      </div>
      <div
        className="test-input-list"
        role="list"
        aria-label="Test input actions"
      >
        {plan.inputs.map((input, index) => (
          <div role="listitem" key={`${index}-${input.kind}`}>
            <code>#{index + 1}</code>
            <strong>{input.kind}</strong>
            <span>
              {input.kind === "key"
                ? `${input.pressed ? "down" : "up"} ${input.code}`
                : input.kind === "gamepad"
                  ? `${input.pressed ? "down" : "up"} ${GAMEPAD_ACTIONS.find((action) => action.id === input.action)?.label} → ${ACORN_KEY_ROWS.flat().find((key) => key.code === input.code)?.label}`
                  : input.kind === "bbc-analogue"
                    ? `ADC ${input.channels.join("/")} · fire ${input.buttons.map((pressed) => (pressed ? "1" : "0")).join("/")}`
                    : input.kind === "bbc-mouse"
                      ? `pointer ${input.x}/${input.y} · buttons ${input.buttons.map((pressed) => (pressed ? "1" : "0")).join("/")}`
                    : input.kind === "atom-atommc"
                      ? `U${Number(input.up)} D${Number(input.down)} L${Number(input.left)} R${Number(input.right)} F${Number(input.fire)}`
                    : input.kind === "media"
                      ? input.action.replaceAll("-", " ")
                    : input.kind === "emulator-event"
                      ? "wait for live video frame counter to advance"
                    : input.kind === "delay"
                      ? `${input.cycles.toLocaleString()} cycles`
                      : `${input.reset} reset`}
            </span>
            <button
              type="button"
              disabled={!index}
              aria-label={`Move input action ${index + 1} up`}
              onClick={() => move(index, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              disabled={index === plan.inputs.length - 1}
              aria-label={`Move input action ${index + 1} down`}
              onClick={() => move(index, 1)}
            >
              ↓
            </button>
            <button
              type="button"
              aria-label={`Remove input action ${index + 1}`}
              onClick={() =>
                onChange(plan.id, {
                  inputs: plan.inputs.filter(
                    (_, candidate) => candidate !== index,
                  ),
                })
              }
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <p>
        Key events use browser <code>KeyboardEvent.code</code>. Key-mapped
        gamepad actions use the real held-key path. BBC analogue states feed the
        four real ADC sources and System VIA fire inputs, with hardware readback
        checked before execution continues. Media actions eject a live drive or
        cassette through the real controller path. Delays use emulated CPU
        cycles. Replay occurs after setup and artifact loading, and completion
        clears held keys.
      </p>
    </details>
  );
}

function TestWorkspace({
  machineManifestId,
  targetName,
  entryFileName,
  connected,
  supported,
  artifact,
  result,
  plans,
  testAllRecords,
  history,
  onAdd,
  onChange,
  onRemove,
  onRun,
  onRunAll,
  onCancelAll,
  onDebugFailed,
}: {
  machineManifestId: string;
  targetName: string;
  entryFileName: string;
  connected: boolean;
  supported: boolean;
  artifact: AssemblyArtifact | null;
  result: MachineTestResult | null;
  plans: TargetTestPlan[];
  testAllRecords: TestAllRecord[];
  history: TestHistoryRecord[];
  onAdd: () => void;
  onChange: (id: string, update: Partial<TargetTestPlan>) => void;
  onRemove: (id: string) => void;
  onRun: (configuration: TargetTestPlan) => void;
  onRunAll: () => void;
  onCancelAll: () => void;
  onDebugFailed: (result: TestHistoryResult) => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState("");
  const [suiteFilter, setSuiteFilter] = useState("");
  const [goldenError, setGoldenError] = useState("");
  const suites = Array.from(new Set(plans.map((item) => item.suite))).sort(
    (a, b) => a.localeCompare(b),
  );
  const visiblePlans = plans.filter(
    (item) =>
      (!suiteFilter || item.suite === suiteFilter) &&
      (!filter.trim() ||
        `${item.suite} ${item.name}`
          .toLowerCase()
          .includes(filter.trim().toLowerCase())),
  );
  const visibleHistory = history.filter(
    (item) => !suiteFilter || item.result.suite === suiteFilter,
  );
  const plan =
    visiblePlans.find((item) => item.id === selectedId) ?? visiblePlans[0];
  const reportRows: ReportTestResult[] = visibleHistory.map((item) => ({
    name: item.result.name,
    suite: item.result.suite ?? "Default",
    status: item.result.status,
    reason: item.result.reason,
    cycles: item.result.cycles,
    buildFingerprint: item.result.buildFingerprint,
    recordedAt: item.recordedAt,
    /* Every assertion, with what it asked for and what the machine gave back.
     * The runtime has always computed both and the report dropped them, so a
     * failing run named the test and never said what it saw. */
    ...(item.result.assertions ? { assertions: item.result.assertions } : {}),
  }));
  const exportNative = () =>
    downloadBlob(
      new Blob(
        [
          `${JSON.stringify(createNativeTestReport(reportRows, machineManifestId), null, 2)}\n`,
        ],
        { type: "application/json" },
      ),
      "acorn-test-report.json",
    );
  const exportJUnit = () =>
    downloadBlob(
      new Blob([createJUnitTestReport(reportRows, machineManifestId)], {
        type: "application/xml",
      }),
      "acorn-test-report.junit.xml",
    );
  useEffect(() => {
    if (plan && plan.id !== selectedId) setSelectedId(plan.id);
    else if (!plan && selectedId) setSelectedId("");
  }, [plan?.id, selectedId]);
  return (
    <div className="test-workspace">
      <div className="runtime-heading">
        <div>
          <span className="eyebrow">PERSISTED REAL-MACHINE TEST PLANS</span>
          <h2>Build · execute · assert</h2>
        </div>
        <div className="runtime-actions">
          <button type="button" onClick={onAdd}>
            New plan
          </button>
          <button
            type="button"
            disabled={!plan}
            onClick={() => plan && onRemove(plan.id)}
          >
            Remove plan
          </button>
          <button
            type="button"
            disabled={
              !connected ||
              testAllRecords.some(
                (item) => item.status === "queued" || item.status === "running",
              )
            }
            onClick={onRunAll}
          >
            Test all
          </button>
          <button
            type="button"
            disabled={
              !testAllRecords.some(
                (item) => item.status === "queued" || item.status === "running",
              )
            }
            onClick={onCancelAll}
          >
            Cancel all
          </button>
          <button
            type="button"
            disabled={
              !connected || !supported || !plan || result?.status === "running"
            }
            onClick={() => plan && onRun(plan)}
          >
            <Icon name="play" size={14} /> Build &amp; run test
          </button>
        </div>
      </div>
      <div
        className="test-explorer-controls"
        aria-label="Test explorer filters"
      >
        <label>
          <span>Find test</span>
          <input
            aria-label="Filter test plans"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="suite or plan name"
          />
        </label>
        <label>
          <span>Suite</span>
          <select
            aria-label="Filter test suite"
            value={suiteFilter}
            onChange={(event) => setSuiteFilter(event.target.value)}
          >
            <option value="">All suites</option>
            {suites.map((suite) => (
              <option value={suite} key={suite}>
                {suite}
              </option>
            ))}
          </select>
        </label>
        <span>
          {visiblePlans.length}/{plans.length} plans · {visibleHistory.length}{" "}
          retained results
        </span>
      </div>
      <nav
        className="test-plan-tree"
        aria-label="Tests grouped by target, file and suite"
      >
        <strong>{targetName}</strong>
        <span>{entryFileName}</span>
        {suites.map((suite) => (
          <div key={suite}>
            <b>{suite}</b>
            {visiblePlans
              .filter((item) => item.suite === suite)
              .map((item) => (
                <button
                  type="button"
                  aria-pressed={item.id === plan?.id}
                  onClick={() => setSelectedId(item.id)}
                  key={item.id}
                >
                  {item.name}
                </button>
              ))}
          </div>
        ))}
      </nav>
      <div className="test-report-actions">
        <span>
          Reports use the same machine manifest and test-target schema shown in
          the interactive run.
        </span>
        <button
          type="button"
          disabled={!reportRows.length}
          onClick={exportNative}
        >
          Export native JSON
        </button>
        <button
          type="button"
          disabled={!reportRows.length}
          onClick={exportJUnit}
        >
          Export JUnit XML
        </button>
      </div>
      {plan && <TestInputEditor plan={plan} onChange={onChange} />}
      {!supported ? (
        <div className="honest-empty runtime-empty">
          Select a 6502 or 65C12 assembly target to create a hardware test.
          BASIC and ARM assertion adapters remain tracked separately.
        </div>
      ) : !plan ? (
        <div className="honest-empty runtime-empty">
          <button type="button" onClick={onAdd}>
            Create the first persisted test plan for this target
          </button>
        </div>
      ) : (
        <div className="test-layout">
          <section className="test-plan">
            <h3>Test plan · schema 2</h3>
            <p>
              Plans are stored in the portable project and bound to this build
              target. Execution rebuilds and loads the exact current artifact
              into the ROM-aware emulator.
            </p>
            <label>
              <span>Plan</span>
              <select
                aria-label="Hardware test plan"
                value={plan.id}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                {plans.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.suite} / {item.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="test-fields">
              <label>
                <span>Name</span>
                <input
                  aria-label="Hardware test name"
                  value={plan.name}
                  maxLength={80}
                  onChange={(event) =>
                    onChange(plan.id, { name: event.target.value })
                  }
                />
              </label>
              <label>
                <span>Suite</span>
                <input
                  aria-label="Hardware test suite"
                  value={plan.suite}
                  maxLength={80}
                  onChange={(event) =>
                    onChange(plan.id, { suite: event.target.value })
                  }
                />
              </label>
              <label>
                <span>Stop address or symbol</span>
                <input
                  aria-label="Test stop address or symbol"
                  value={plan.stop}
                  onChange={(event) =>
                    onChange(plan.id, { stop: event.target.value })
                  }
                  placeholder="done or &1910"
                />
              </label>
              <label>
                <span>Cycle timeout</span>
                <input
                  aria-label="Test cycle budget"
                  type="number"
                  min={100}
                  max={10_000_000}
                  value={plan.cycleBudget}
                  onChange={(event) =>
                    onChange(plan.id, {
                      cycleBudget: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                <span>Setup reset</span>
                <select
                  aria-label="Test setup reset"
                  value={plan.setup.reset}
                  onChange={(event) =>
                    onChange(plan.id, {
                      setup: {
                        ...plan.setup,
                        reset: event.target
                          .value as TargetTestPlan["setup"]["reset"],
                      },
                    })
                  }
                >
                  <option value="hard">Hard reset</option>
                  <option value="soft">Soft reset</option>
                  <option value="none">No reset</option>
                </select>
              </label>
              <label>
                <span>Setup media</span>
                <select
                  aria-label="Test setup media policy"
                  value={plan.setup.media}
                  onChange={(event) =>
                    onChange(plan.id, {
                      setup: {
                        ...plan.setup,
                        media: event.target
                          .value as TargetTestPlan["setup"]["media"],
                      },
                    })
                  }
                >
                  <option value="retain">Retain mounted media</option>
                  <option value="eject">Eject media</option>
                </select>
              </label>
              <label>
                <span>Teardown</span>
                <select
                  aria-label="Test teardown action"
                  value={plan.teardown.action}
                  onChange={(event) =>
                    onChange(plan.id, {
                      teardown: {
                        action: event.target
                          .value as TargetTestPlan["teardown"]["action"],
                      },
                    })
                  }
                >
                  <option value="pause">Leave paused</option>
                  <option value="reset">Hard reset after capture</option>
                </select>
              </label>
            </div>
            <label className="test-assertions">
              <span>Assertions</span>
              <textarea
                aria-label="Hardware test assertions"
                value={plan.assertions}
                onChange={(event) =>
                  onChange(plan.id, { assertions: event.target.value })
                }
                spellCheck={false}
              />
            </label>
            <div className="test-screen-goldens">
              <strong>Tolerant screen goldens</strong>
              <p>Import a bounded PNG region, then position it in the 1024 by 625 live framebuffer with <code>SCREEN_IMAGE[id,x,y] TOLERANCE[channel,pixels]</code>.</p>
              <label className="button-like-file">
                <span>Import PNG golden</span>
                <input
                  aria-label="Import screen golden PNG"
                  type="file"
                  accept="image/png,.png"
                  disabled={plan.screenGoldens.length >= MAX_SCREEN_GOLDENS}
                  onChange={async (event) => {
                    const input = event.currentTarget; const file = input.files?.[0]; if (!file) return;
                    try {
                      const golden = await importScreenGolden(file, plan.screenGoldens);
                      const assertion = `SCREEN_IMAGE[${golden.id},0,0] TOLERANCE[0,0]`;
                      onChange(plan.id, { screenGoldens: [...plan.screenGoldens, golden], assertions: `${plan.assertions.trimEnd()}${plan.assertions.trim() ? "\n" : ""}${assertion}` });
                      setGoldenError("");
                    } catch (error) { setGoldenError(error instanceof Error ? error.message : String(error)); }
                    finally { input.value = ""; }
                  }}
                />
              </label>
              {goldenError && <div className="inline-error" role="alert">{goldenError}</div>}
              {plan.screenGoldens.map((golden) => <div className="test-screen-golden" key={golden.id}><ScreenGoldenCanvas rgbaBase64={golden.rgbaBase64} width={golden.width} height={golden.height} label={golden.name} /><div><code>{golden.id}</code><span>{golden.width}×{golden.height} · {(base64ToBytes(golden.rgbaBase64).length / 1024).toFixed(1)} KiB RGBA</span></div><button type="button" aria-label={`Remove screen golden ${golden.name}`} onClick={() => onChange(plan.id, { screenGoldens: plan.screenGoldens.filter((item) => item.id !== golden.id), assertions: plan.assertions.split(/\r?\n/).filter((line) => !new RegExp(`^\\s*SCREEN_IMAGE\\[\\s*${golden.id}\\s*,`, 'i').test(line)).join('\n') })}>Remove</button></div>)}
            </div>
            <div className="test-capture-editor">
              <strong>Artifact captures</strong>
              <button
                type="button"
                disabled={
                  plan.captures.length >= 16 ||
                  plan.captures.some((capture) => capture.kind === "registers")
                }
                onClick={() =>
                  onChange(plan.id, {
                    captures: [
                      ...plan.captures,
                      { id: crypto.randomUUID(), kind: "registers" },
                    ],
                  })
                }
              >
                Capture registers
              </button>
              <button
                type="button"
                disabled={plan.captures.length >= 16}
                onClick={() =>
                  onChange(plan.id, {
                    captures: [
                      ...plan.captures,
                      {
                        id: crypto.randomUUID(),
                        kind: "memory",
                        address: "buffer",
                        length: 16,
                      },
                    ],
                  })
                }
              >
                Capture memory
              </button>
              {plan.captures.map((capture) => (
                <div key={capture.id}>
                  <code>{capture.kind}</code>
                  {capture.kind === "memory" && (
                    <>
                      <input
                        aria-label="Capture memory address"
                        value={capture.address}
                        onChange={(event) =>
                          onChange(plan.id, {
                            captures: plan.captures.map((item) =>
                              item.id === capture.id && item.kind === "memory"
                                ? { ...item, address: event.target.value }
                                : item,
                            ),
                          })
                        }
                      />
                      <input
                        aria-label="Capture memory length"
                        type="number"
                        min={1}
                        max={4096}
                        value={capture.length}
                        onChange={(event) =>
                          onChange(plan.id, {
                            captures: plan.captures.map((item) =>
                              item.id === capture.id && item.kind === "memory"
                                ? {
                                    ...item,
                                    length: Number(event.target.value),
                                  }
                                : item,
                            ),
                          })
                        }
                      />
                    </>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${capture.kind} capture`}
                    onClick={() =>
                      onChange(plan.id, {
                        captures: plan.captures.filter(
                          (item) => item.id !== capture.id,
                        ),
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <label className="test-plan-enabled">
              <input
                type="checkbox"
                checked={plan.enabled}
                onChange={(event) =>
                  onChange(plan.id, { enabled: event.target.checked })
                }
              />{" "}
              Include in test all
            </label>
            <div className="test-syntax">
              <code>A = &amp;41</code>
              <code>X = 5</code>
              <code>PC = done</code>
              <code>MEM[buffer] = A9 41 00</code>
              <code>OUTPUT = &quot;HI&quot;</code>
              <code>SCREEN[0,0,32,32] = FNV32:12345678</code>
              <code>SCREEN_IMAGE[title,0,0] TOLERANCE[8,4]</code>
              <code>CYCLES &lt;= 1000</code>
            </div>
            <p className="honest-note">
              A failed screen assertion reports the actual FNV-1a digest to copy
              after inspecting the declared framebuffer region. Cycle assertions
              measure elapsed core cycles from artifact load to the declared
              stop. The cycle timeout is a separate safety ceiling. Maximum 64
              assertions, 1,024 expected memory bytes, four portable screen
              goldens, 65,536 pixels per screen region, 16 captures, 4,096 captured memory bytes and 10,000,000
              cycles. The versioned input list currently contains{" "}
              {plan.inputs.length} action{plan.inputs.length === 1 ? "" : "s"};
              recording and replay controls are delivered under TST-503.
            </p>
          </section>
          <aside
            className="honest-note"
            aria-label="Supported event and audio assertions"
          >
            <strong>Event, sound and timing assertions</strong>
            <p>
              Use <code>EVENT[OSBYTE] = 1</code>. Named entry points are OSRDCH,
              OSASCI, OSNEWL, OSWRCR, OSWRCH, OSWORD, OSBYTE and OSCLI. Counts
              are taken when the CPU executes the documented MOS entry address.
            </p>
            <p>
              <code>EVENT[&amp;2000] = 3</code> or{" "}
              <code>EVENT[my_symbol] = 3</code> counts entries at any address
              you name, so a dispatcher, a service entry or a protocol that is
              not the BBC MOS can be asserted without this build claiming to
              know what lives there.
            </p>
            <p>
              <code>AUDIO[WRITES] = FNV32:12345678</code> checks the exact
              SN76489 command-byte sequence without depending on speakers or
              browser audio. On a machine with a one-bit speaker instead of a
              sound chip, <code>AUDIO[SPEAKER] = 4</code> counts the transitions
              the core observed. The count is of changes of level, so a program
              should drive the line to a known level before counting.
            </p>
            <p>
              <code>CYCLES IN 100..250</code> asserts an elapsed range, where{" "}
              <code>CYCLES =</code>, <code>&lt;=</code> and <code>&gt;=</code>{" "}
              assert a single bound.
            </p>
          </aside>
          <TestResultPanel result={result} testAllRecords={testAllRecords} />
          <section className="test-build-facts">
            <h3>Bound build</h3>
            {artifact ? (
              <div>
                <span>
                  Processor <strong>{artifact.processor.toUpperCase()}</strong>
                </span>
                <span>
                  Origin <strong>{formatAddress(artifact.origin)}</strong>
                </span>
                <span>
                  Entry <strong>{formatAddress(artifact.entryPoint)}</strong>
                </span>
                <span>
                  Bytes <strong>{artifact.bytes.length}</strong>
                </span>
                <span>
                  Symbols{" "}
                  <strong>{Object.keys(artifact.symbols).length}</strong>
                </span>
              </div>
            ) : (
              <div className="honest-empty">
                The next run will create and bind a fresh build result.
              </div>
            )}
            <p>
              Each run uses the exact bytes and symbols produced immediately
              before execution. A newer editor state requires a new test run.
            </p>
            <h3>Result history</h3>
            <div
              className="test-history"
              role="list"
              aria-label="Retained test result history"
            >
              {visibleHistory.map((item) => (
                <div
                  role="listitem"
                  className={`status-${item.result.status}`}
                  key={item.sequence}
                >
                  <strong>{item.result.status.toUpperCase()}</strong>
                  <span>
                    {item.result.suite ?? "Default"} / {item.result.name}
                  </span>
                  <small>
                    {new Date(item.recordedAt).toLocaleTimeString()} ·{" "}
                    {item.result.cycles.toLocaleString()} cycles
                  </small>
                  {item.result.buildFingerprint && (
                    <code title={item.result.buildFingerprint}>
                      {item.result.buildFingerprint.slice(0, 10)}
                    </code>
                  )}
                  {["failed", "timeout", "error"].includes(
                    item.result.status,
                  ) && (
                    <button
                      type="button"
                      onClick={() => onDebugFailed(item.result)}
                    >
                      Debug exact failed build
                    </button>
                  )}
                </div>
              ))}
              {!visibleHistory.length && (
                <div className="honest-empty">
                  No result retained for this suite in the current browser
                  session.
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

interface DebuggerWorkspaceProps {
  artifact: AssemblyArtifact | null;
  currentFiles: ProjectFile[];
  state: CpuSnapshot | null;
  runtime: Cpu6502Runtime;
  hardwareState: MachineBridgeSnapshot | null;
  hardwareMemory: MachineMemory | null;
  hardwareDisassembly: MachineDisassembly | null;
  hardwareInspection: HardwareInspection | null;
  hardwareConnected: boolean;
  sourceBreakpointAddresses: number[];
  persistedBreakpoints: Persisted6502BreakpointIntent[];
  breakpointGroups: Breakpoint6502Group[];
  onPersistBreakpoints: (intents: Persisted6502BreakpointIntent[]) => void;
  onPersistGroups: (groups: Breakpoint6502Group[]) => void;
  onMachineCommand: (message: Record<string, unknown>) => void;
  onNavigateSource: (fileId: string, line: number) => void;
  onStep: () => void;
  onContinue: () => void;
  onReset: () => void;
  onStateChange: (state: CpuSnapshot) => void;
  /* Optional, because a debugger with no analyser attached is still a
   * debugger; the button is simply absent rather than present and inert. */
  onAnalyse?: (name: string, bytes: Uint8Array, metadata: AcornFileMetadata, overrides?: { processor?: AnalysisProcessor; origin?: number; entryPoint?: number }) => void;
}

function ReplayHistoryPanel({ state, onMachineCommand }: { state: MachineBridgeSnapshot; onMachineCommand: (message: Record<string, unknown>) => void }) {
  const history = state.replay;
  const [interval, setInterval] = useState('64');
  const [capacity, setCapacity] = useState('16');
  const [error, setError] = useState('');
  const toggle = () => {
    if (history.enabled) { onMachineCommand({ type: 'replay-config', enabled: false }); return; }
    const parsedInterval = Number(interval); const parsedCapacity = Number(capacity);
    if (!Number.isInteger(parsedInterval) || parsedInterval < 1 || parsedInterval > 4096) { setError('Checkpoint interval must be 1–4,096 instructions'); return; }
    if (!Number.isInteger(parsedCapacity) || parsedCapacity < 2 || parsedCapacity > 64 || parsedInterval * parsedCapacity > 65536) { setError('Capacity must be 2–64 and retain no more than 65,536 instructions'); return; }
    setError(''); onMachineCommand({ type: 'replay-config', enabled: true, checkpointInterval: parsedInterval, checkpointCapacity: parsedCapacity });
  };
  return <section className={`replay-history ${history.enabled ? 'active' : ''}`} aria-label="Deterministic replay history"><div className="replay-controls"><label><span>Checkpoint every</span><select aria-label="Replay checkpoint interval" value={interval} disabled={history.enabled} onChange={(event) => setInterval(event.target.value)}>{[1, 4, 16, 64, 256, 1024, 4096].map((value) => <option value={value} key={value}>{value} instruction{value === 1 ? '' : 's'}</option>)}</select></label><label><span>Checkpoints</span><select aria-label="Replay checkpoint capacity" value={capacity} disabled={history.enabled} onChange={(event) => setCapacity(event.target.value)}>{[2, 4, 8, 16, 32, 64].map((value) => <option value={value} key={value}>{value}</option>)}</select></label><button type="button" disabled={state.running && !history.enabled} onClick={toggle}>{history.enabled ? 'Stop history' : 'Start history'}</button><button type="button" disabled={!history.canReverseStep} onClick={() => onMachineCommand({ type: 'reverse-step' })}>Step back</button><button type="button" disabled={!history.canReverseContinue} onClick={() => onMachineCommand({ type: 'reverse-continue' })}>Previous checkpoint</button>{error && <span role="alert">{error}</span>}</div><div className="replay-facts"><strong>{history.enabled ? 'Deterministic history active' : 'Reverse execution inactive'}</strong><span>{history.overhead}</span><small>Segment {history.segment} · instruction {history.currentInstruction.toLocaleString()} · {history.retainedInstructions.toLocaleString()} reversible · {history.checkpointCount}/{history.config.checkpointCapacity} checkpoints · {(history.checkpointBytes / 1048576).toFixed(1)} MiB measured state</small><p><b>Boundary:</b> {history.boundaryReason}</p><p><b>Verification:</b> {history.lastVerification}</p></div><div className="replay-checkpoints" aria-label="Retained replay checkpoints">{history.checkpoints.slice().reverse().map((checkpoint) => <div key={checkpoint.index}><strong>#{checkpoint.index.toLocaleString()}</strong><code>{formatAddress(checkpoint.pc)}</code><span>{checkpoint.symbol ?? (checkpoint.source ? `${checkpoint.source.fileName}:${checkpoint.source.line}` : `cycle ${checkpoint.cycle.toLocaleString()}`)}</span><small>{(checkpoint.bytes / 1048576).toFixed(2)} MiB</small></div>)}</div></section>;
}

function DebugSessionPanel({ session, onStop }: { session: DebugSessionRecord | null; onStop: () => void }) {
  if (!session) return <section className="debug-session-binding empty" aria-label="Debug session"><div><span className="debug-lifecycle stopped">STOPPED</span><strong>No debug session</strong><small>Build and debug a target to create an immutable session binding.</small></div></section>;
  const { binding } = session;
  const addressWidth = binding.runProfile.processor.startsWith('arm') ? 8 : 4;
  return <section className="debug-session-binding" aria-label="Immutable debug session binding">
    <header><div><span className={`debug-lifecycle ${session.lifecycle}`}>{session.lifecycle.toUpperCase()}</span><strong>{binding.build.targetName}</strong><small>{session.reason}</small></div><button type="button" disabled={['terminated', 'disconnected'].includes(session.lifecycle)} title={session.lifecycle === 'terminated' ? 'This debug session is already terminated' : 'Pause the machine and terminate this debug session'} onClick={onStop}>Stop session</button></header>
    <div className="debug-session-summary"><span>Build <code>{binding.build.fingerprint}</code></span><span>SHA-256 <code title={binding.build.outputSha256}>{binding.build.outputSha256.slice(0, 12)}…</code></span><span>{binding.adapter.id} <code>{binding.adapter.version.slice(0, 12)}</code></span><span>{binding.machineTarget.machineId} · {binding.machineTarget.variant}</span><span>Entry <code>{formatAddress(binding.runProfile.entryPoint, addressWidth)}</code></span><span>{binding.roms.length} bound ROM{binding.roms.length === 1 ? '' : 's'}</span></div>
    <details><summary>Exact immutable binding and availability reasons</summary><dl><div><dt>Session</dt><dd><code>{binding.id}</code> · created <time dateTime={binding.createdAt}>{new Date(binding.createdAt).toLocaleString()}</time></dd></div><div><dt>Build output</dt><dd>{binding.build.outputBytes.toLocaleString()} bytes · <code>{binding.build.outputSha256}</code></dd></div><div><dt>Toolchain</dt><dd><code>{binding.build.toolchainId}@{binding.build.toolchainVersion}</code></dd></div><div><dt>Machine manifest</dt><dd><code>{binding.machineTarget.platformClass}/{binding.machineTarget.machineId}/{binding.machineTarget.romId}</code> · {binding.runProfile.capabilities.join(', ') || 'no optional capabilities'}</dd></div><div><dt>Run profile</dt><dd>{binding.runProfile.processor} · origin {formatAddress(binding.runProfile.origin, addressWidth)} · entry {formatAddress(binding.runProfile.entryPoint, addressWidth)} · debug</dd></div><div><dt>Skip instruction</dt><dd>Unavailable. Skipping an arbitrary instruction can violate processor, stack, interrupt and device state, so this adapter does not expose an unsafe PC-only operation.</dd></div></dl><div className="debug-session-roms">{binding.roms.length ? binding.roms.map((rom) => <div key={rom.key}><strong>{rom.filename}</strong><span>{rom.key} · {rom.size.toLocaleString()} bytes</span><code>{rom.sha256}</code></div>) : <p>This session uses the bounded ROM-less diagnostic adapter and has no firmware binding.</p>}</div></details>
  </section>;
}

function DebugProtocolPanel({ protocol }: { protocol: DebugProtocolSnapshot }) {
  const adapter = protocol.adapter === 'jsbeeb' ? productionAdapterDescriptors.jsbeeb : productionAdapterDescriptors.arculator;
  return <details className="debug-protocol-panel"><summary><strong>Debug session</strong><span>{protocol.adapter} · protocol {protocol.version} · {protocol.sessionBound ? 'owned and session-bound' : 'isolated harness mode'} · command {protocol.lastCommandId}</span></summary><div className="debug-protocol-facts"><div><span>Owner</span><strong>{protocol.owner}</strong></div><div><span>Accepted</span><strong>{protocol.acceptedCommands}</strong></div><div><span>Audit</span><strong>{protocol.audit.length}/{protocol.auditCapacity}</strong></div><div><span>Capabilities</span><strong>{protocol.capabilities.length}</strong></div></div><div className="debug-capability-list" aria-label="Negotiated debug capabilities">{protocol.capabilities.map((capability) => <code key={capability}>{capability}</code>)}</div><section className="adapter-contract-disclosure" aria-label="Common emulator adapter contract"><h4>Emulator adapter API {EMULATOR_ADAPTER_API_VERSION}</h4><p><code>{adapter.id}@{adapter.version}</code> declares every EMU-001 operation. Unavailable operations remain visible and cannot be invoked through the shared contract.</p><div className="debug-capability-list">{Object.entries(adapter.operations).map(([operation, available]) => <code className={available ? '' : 'unavailable'} key={operation}>{available ? 'yes' : 'no'} · {operation}</code>)}</div>{adapter.limitations.map((limitation) => <p className="honest-note" key={limitation}>{limitation}</p>)}</section><div className="debug-command-audit" aria-label="Accepted debug command audit">{protocol.audit.slice().reverse().map((entry) => <div key={entry.sequence}><code>#{entry.commandId}</code><strong>{entry.type}</strong><span>t+{entry.acceptedAtMs.toFixed(1)} ms</span></div>)}</div></details>;
}

function Breakpoint6502PersistencePanel({ intents, groups, resolved, selectedGroupId, groupName, message, onSelectedGroup, onGroupName, onGroups, onIntents }: { intents: Persisted6502BreakpointIntent[]; groups: Breakpoint6502Group[]; resolved: ReturnType<typeof resolve6502BreakpointIntents>; selectedGroupId: string; groupName: string; message: string; onSelectedGroup: (id: string) => void; onGroupName: (name: string) => void; onGroups: (groups: Breakpoint6502Group[]) => void; onIntents: (intents: Persisted6502BreakpointIntent[]) => void }) {
  const addGroup = () => {
    const name = groupName.trim();
    if (!name || groups.length >= 32 || groups.some((group) => group.name.toLowerCase() === name.toLowerCase())) return;
    onGroups([...groups, { id: crypto.randomUUID(), name: name.slice(0, 64), enabled: true }]); onGroupName('');
  };
  const removeGroup = (id: string) => { onGroups(groups.filter((group) => group.id !== id)); onIntents(intents.map((intent) => intent.groupId === id ? { ...intent, groupId: undefined } : intent)); if (selectedGroupId === id) onSelectedGroup(''); };
  return <section className="arm-persisted-breakpoints breakpoint-6502-persistence" aria-label="Persisted 6502 breakpoint intents">
    <div className="panel-heading"><strong>Project breakpoint intents</strong><small>{resolved.filter((item) => item.wireSpec).length}/{resolved.length} resolved, plus source gutter stops</small></div>
    <div className="breakpoint-group-editor"><div className="breakpoint-entry"><input aria-label="New 6502 breakpoint group name" value={groupName} maxLength={64} onChange={(event) => onGroupName(event.target.value)} placeholder="Gameplay" /><button type="button" onClick={addGroup}>Create group</button></div><label><span>Group for next breakpoint</span><select aria-label="New 6502 breakpoint group" value={selectedGroupId} onChange={(event) => onSelectedGroup(event.target.value)}><option value="">Ungrouped</option>{groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label>{groups.map((group) => <div className="breakpoint-group-row" key={group.id}><label><input type="checkbox" checked={group.enabled} onChange={(event) => onGroups(groups.map((candidate) => candidate.id === group.id ? { ...candidate, enabled: event.target.checked } : candidate))} /> {group.name}</label><button type="button" aria-label={`Remove 6502 breakpoint group ${group.name}`} onClick={() => removeGroup(group.id)}>Remove</button></div>)}</div>
    {message && <p role="status" className="honest-note">{message}</p>}
    {resolved.length ? resolved.map((item) => <div className={item.error && item.error !== 'disabled' && !item.error.includes('is disabled') ? 'unresolved' : ''} key={item.intent.id}><label><input type="checkbox" aria-label={`Enable persisted 6502 breakpoint ${item.intent.expression}`} checked={item.intent.enabled} onChange={(event) => onIntents(intents.map((intent) => intent.id === item.intent.id ? { ...intent, enabled: event.target.checked } : intent))} /><code>{item.intent.expression}</code></label><select aria-label={`Group persisted 6502 breakpoint ${item.intent.expression}`} value={item.intent.groupId ?? ''} onChange={(event) => onIntents(intents.map((intent) => intent.id === item.intent.id ? { ...intent, groupId: event.target.value || undefined } : intent))}><option value="">Ungrouped</option>{groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select><span>requested {item.intent.expression} → {item.wireSpec ? `resolved ${formatAddress(item.address!)} · verified build ${item.buildFingerprint?.slice(0, 10) ?? 'address-only'}` : `not installed · ${item.error}`}</span>{item.intent.resolutionHistory?.length ? <details className="arm-resolution-history"><summary>Resolution history · {item.intent.resolutionHistory.length}</summary>{item.intent.resolutionHistory.slice().reverse().map((record, index) => <div key={`${record.buildFingerprint}-${index}`}><strong>{record.verification}</strong><code>{record.requestedExpression} → {record.address === null ? 'no address' : formatAddress(record.address)}</code><span>build {record.buildFingerprint.slice(0, 10)} · {record.reason}</span></div>)}</details> : null}<button type="button" aria-label={`Delete persisted 6502 breakpoint ${item.intent.expression}`} onClick={() => onIntents(intents.filter((intent) => intent.id !== item.intent.id))}>Delete</button></div>) : <div className="honest-empty">No project address or symbol breakpoint intents saved for this build target.</div>}
  </section>;
}

function TubeProcessorPanel({ state, memory, onMachineCommand }: { state: MachineBridgeSnapshot; memory: MachineMemory | null; onMachineCommand: (message: Record<string, unknown>) => void }) {
  const [focus, setFocus] = useState<'host' | 'parasite'>('host');
  const tube = state.tube!;
  const registerRows = [{ id: 'host', label: `Host ${state.cpuCore}`, values: state.registers }, { id: 'parasite', label: tube.model, values: tube.registers }] as const;
  const renderBytes = (bytes: Array<number | null>) => bytes.map((value, index) => <span title={`${formatAddress(tube.memory.start + index)}${value === null ? ' is Tube ULA I/O and was not read' : ''}`} key={index}>{value === null ? '--' : formatByte(value)}</span>);
  return <section className="tube-debug-panel" aria-label="Tube host and parasite state">
    <header><div><span className="eyebrow">LIVE JSBEEB TUBE STATE</span><strong>Host and parasite</strong><small>{tube.scheduling}</small></div><div role="group" aria-label="Tube debugger focus"><button type="button" aria-pressed={focus === 'host'} onClick={() => setFocus('host')}>Focus host</button><button type="button" aria-pressed={focus === 'parasite'} onClick={() => setFocus('parasite')}>Focus parasite</button></div></header>
    <div className="tube-cpu-grid">{registerRows.map((processor) => <section className={focus === processor.id ? 'focused' : ''} aria-label={`${processor.label} registers`} key={processor.id}><h3>{processor.label}</h3><div>{Object.entries(processor.values).map(([name, value]) => <span key={name}><small>{name.toUpperCase()}</small><strong>{name === 'pc' ? formatAddress(value) : formatByte(value)}</strong></span>)}</div>{processor.id === 'parasite' && <p>{tube.romPaged ? 'Boot ROM paged' : 'Parasite RAM visible'} · IRQ {tube.irqPending ? 'pending' : 'clear'} · NMI {tube.nmiLevel ? 'high' : 'low'}{tube.nmiEdge ? ' / edge' : ''} · cycle debt {tube.cycles.toFixed(2)}</p>}</section>)}</div>
    <div className="tube-ula-state"><strong>Tube ULA channels</strong><code>control &amp;{formatByte(tube.ula.internalStatus)}</code>{tube.ula.hostStatus.map((value, index) => <span key={`h-${index}`}>H{index + 1} &amp;{formatByte(value)}</span>)}{tube.ula.parasiteStatus.map((value, index) => <span key={`p-${index}`}>P{index + 1} &amp;{formatByte(value)}</span>)}<small>P→H R1 {tube.ula.parasiteToHostFifo1} · P→H R3 {tube.ula.parasiteToHostFifo3} · H→P R3 {tube.ula.hostToParasiteFifo3}</small></div>
    <TubeAddressMap state={state} />
    <div className="tube-memory-spaces"><strong>Parasite address space at {formatAddress(tube.memory.start)}</strong><div><span>Logical CPU view</span><code>{renderBytes(tube.memory.logical)}</code></div><div><span>Physical RAM backing</span><code>{renderBytes(tube.memory.physical)}</code></div><small>{tube.memory.source}</small></div>
    <TubeMemoryInspector state={state} memory={memory} onMachineCommand={onMachineCommand} />
    <div className="tube-transfer-log" role="log" aria-label="Tube cross-processor transfer events"><div><strong>Cross-processor ULA transfers</strong><span>{tube.transfers.retained}/{tube.transfers.capacity} retained · {tube.transfers.dropped} overwritten</span></div>{tube.transfers.events.length ? tube.transfers.events.slice(-24).reverse().map((event) => <div className={`tube-transfer ${event.side}`} key={event.sequence}><code>#{event.sequence}</code><strong>{event.side} {event.access}</strong><span>R{Math.floor(event.register / 2) + 1} {event.register % 2 ? 'data' : 'status'} = &amp;{formatByte(event.value)}</span><small>host {formatAddress(event.hostPc)} @ {event.hostCycle.toLocaleString()} · parasite {formatAddress(event.parasitePc)} @ {event.parasiteCycle.toFixed(2)} · t+{event.timeMs.toFixed(1)} ms</small></div>) : <div className="honest-empty">No real Tube ULA access has crossed the wrapped core boundary yet.</div>}<small>{tube.transfers.source}</small></div>
    <footer><button type="button" disabled title="jsbeeb schedules the parasite from host cycles; an independent pause would not preserve the coupled machine contract">Pause focused CPU</button><button type="button" disabled title="The selected jsbeeb Tube adapter does not expose a one-parasite-instruction boundary">Step focused CPU</button><span>Global Continue, Pause and Restart control both processors safely.</span></footer>
  </section>;
}

function TubeAddressMap({ state }: { state: MachineBridgeSnapshot }) {
  const tube = state.tube!;
  const parasite = tube.romPaged ? [
    { start: 0, end: 0xefff, label: 'Parasite RAM', kind: 'ram' },
    { start: 0xf000, end: 0xfef7, label: 'Boot ROM overlay', kind: 'rom' },
    { start: 0xfef8, end: 0xfeff, label: 'Tube ULA I/O', kind: 'io' },
    { start: 0xff00, end: 0xffff, label: 'Boot ROM overlay', kind: 'rom' },
  ] : [
    { start: 0, end: 0xfef7, label: 'Parasite RAM', kind: 'ram' },
    { start: 0xfef8, end: 0xfeff, label: 'Tube ULA I/O', kind: 'io' },
    { start: 0xff00, end: 0xffff, label: 'Parasite RAM', kind: 'ram' },
  ];
  const map = (label: string, pc: number, regions: Array<{ start: number; end: number; label: string; kind: string }>) => <section aria-label={`${label} 16-bit address map`}><div><strong>{label}</strong><code>PC {formatAddress(pc)}</code></div><div className="tube-map-bar">{regions.map((region, index) => <span className={`kind-${region.kind}`} style={{ flexGrow: region.end - region.start + 1 }} title={`${region.label} ${formatAddress(region.start)}–${formatAddress(region.end)}`} aria-label={`${region.label}, ${formatAddress(region.start)} to ${formatAddress(region.end)}`} key={`${region.start}-${index}`} />)}<i style={{ left: `${pc / 0xffff * 100}%` }} title={`PC ${formatAddress(pc)}`} /></div><div className="tube-map-legend">{regions.map((region, index) => <span key={`${region.label}-${index}`}><i className={`kind-${region.kind}`} />{region.label} {formatAddress(region.start)}–{formatAddress(region.end)}</span>)}</div></section>;
  return <div className="tube-address-map" aria-label="Tube dual address map">{map('Host mapped CPU view', state.registers.pc, state.memoryMap.regions)}{map('Parasite logical CPU view', tube.registers.pc, parasite)}</div>;
}

function TubeMemoryInspector({ state, memory, onMachineCommand }: { state: MachineBridgeSnapshot; memory: MachineMemory | null; onMachineCommand: (message: Record<string, unknown>) => void }) {
  const tubeMemory = memory?.addressSpace.startsWith('tube-') ? memory : null;
  const [space, setSpace] = useState<'tube-logical' | 'tube-ram' | 'tube-rom'>('tube-logical');
  const [addressText, setAddressText] = useState(formatAddress(state.tube!.registers.pc));
  const [lengthText, setLengthText] = useState('128');
  const [columns, setColumns] = useState<8 | 16 | 32>(16);
  const [radix, setRadix] = useState<MemoryRadix>('hex');
  const [searchText, setSearchText] = useState('');
  const [searchMode, setSearchMode] = useState<'bytes' | 'text'>('bytes');
  const [matches, setMatches] = useState<number[]>([]);
  const [snapshot, setSnapshot] = useState<{ space: MemorySpaceId; address: number; bytes: number[]; cycles: number }>();
  const [message, setMessage] = useState('Read up to 4,096 side-effect-free parasite bytes.');
  const rows = useMemo(() => tubeMemory ? formatMemoryRows(tubeMemory.address, tubeMemory.bytes, columns, radix) : [], [tubeMemory, columns, radix]);
  const changed = useMemo(() => tubeMemory && snapshot && tubeMemory.addressSpace === snapshot.space ? changedMemoryAddresses(tubeMemory.address, tubeMemory.bytes, snapshot.address, snapshot.bytes) : new Set<number>(), [tubeMemory, snapshot]);
  useEffect(() => { if (tubeMemory) setMessage(`${tubeMemory.bytes.length.toLocaleString()} bytes from ${tubeMemory.addressSpaceLabel} at cycle ${tubeMemory.capturedAtCycles.toLocaleString()}.`); }, [tubeMemory?.requestId]);
  const bounds = (selected: typeof space) => selected === 'tube-rom' ? { start: 0xf000, end: 0xffff } : { start: 0, end: 0xffff };
  const request = (override?: number) => {
    const address = override ?? parseHexAddress(addressText); const length = Number(lengthText); const range = bounds(space);
    if (address === null || !Number.isInteger(length) || length < 1 || length > 4096 || address < range.start || address + length - 1 > range.end) { setMessage(`Enter 1–4,096 bytes wholly inside ${formatAddress(range.start)}–${formatAddress(range.end)}.`); return; }
    if (space === 'tube-logical' && address <= 0xfeff && address + length - 1 >= 0xfef8) { setMessage('Logical reads cannot include Tube ULA I/O at &FEF8–&FEFF. Choose a range on one side of it.'); return; }
    setAddressText(formatAddress(address)); setMatches([]); setMessage(`Reading ${length.toLocaleString()} bytes from ${formatAddress(address)}.`);
    onMachineCommand({ type: 'read-tube-memory', address, length, addressSpace: space, requestId: `tube-memory-${crypto.randomUUID()}` });
  };
  const page = (direction: -1 | 1) => { if (!tubeMemory) return; const length = Number(lengthText); const range = bounds(space); request(Math.max(range.start, Math.min(range.end - length + 1, tubeMemory.address + direction * length))); };
  const find = () => {
    if (!tubeMemory) { setMessage('Read a parasite memory window before searching.'); return; }
    try { const found = searchMemory(tubeMemory.address, tubeMemory.bytes, parseMemorySearch(searchText, searchMode)); setMatches(found); setMessage(`${found.length} match${found.length === 1 ? '' : 'es'} in the current parasite window.`); }
    catch (error) { setMatches([]); setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const textDump = () => rows.map((row) => `${formatAddress(row.address)}  ${row.values.join(' ')}  ${row.ascii}`).join('\n');
  const copy = async () => { if (!tubeMemory) return; try { await navigator.clipboard.writeText(textDump()); setMessage(`${tubeMemory.bytes.length} parasite bytes copied as text.`); } catch { setMessage('Clipboard permission was denied. Use Text export instead.'); } };
  const exportData = (binary: boolean) => { if (!tubeMemory) return; downloadBlob(binary ? new Blob([new Uint8Array(tubeMemory.bytes)], { type: 'application/octet-stream' }) : new Blob([`${textDump()}\n`], { type: 'text/plain;charset=utf-8' }), `tube-${tubeMemory.addressSpace}-${tubeMemory.address.toString(16).padStart(4, '0')}.${binary ? 'bin' : 'txt'}`); };
  return <section className="tube-memory-inspector" aria-label="Tube parasite memory inspector"><div className="panel-heading"><strong>Parasite memory inspector</strong><small>{tubeMemory?.addressSpaceLabel ?? 'no sampled window'}</small></div><div className="tube-memory-controls"><label><span>Address space</span><select aria-label="Tube memory address space" value={space} onChange={(event) => { const next = event.target.value as typeof space; setSpace(next); if (next === 'tube-rom') setAddressText('&F000'); }}><option value="tube-logical">Logical CPU view</option><option value="tube-ram">Physical RAM backing</option><option value="tube-rom">Physical boot ROM</option></select></label><label><span>Address</span><input aria-label="Tube memory address" value={addressText} onChange={(event) => setAddressText(event.target.value)} /></label><label><span>Length</span><input aria-label="Tube memory length" type="number" min="1" max="4096" value={lengthText} onChange={(event) => setLengthText(event.target.value)} /></label><label><span>Columns</span><select aria-label="Tube memory columns" value={columns} onChange={(event) => setColumns(Number(event.target.value) as 8 | 16 | 32)}><option>8</option><option>16</option><option>32</option></select></label><label><span>Numbers</span><select aria-label="Tube memory radix" value={radix} onChange={(event) => setRadix(event.target.value as MemoryRadix)}><option value="hex">Hex</option><option value="decimal">Decimal</option></select></label><button type="button" onClick={() => request()}>Read</button><button type="button" disabled={!tubeMemory} onClick={() => page(-1)}>Previous</button><button type="button" disabled={!tubeMemory} onClick={() => page(1)}>Next</button></div><div className="tube-memory-tools"><label><span>Search</span><input aria-label="Search Tube memory" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder={searchMode === 'bytes' ? 'A9 ?? 00' : 'Acorn'} /></label><select aria-label="Tube memory search mode" value={searchMode} onChange={(event) => setSearchMode(event.target.value as typeof searchMode)}><option value="bytes">Bytes / wildcard</option><option value="text">ASCII text</option></select><button type="button" onClick={find}>Find</button><button type="button" disabled={!tubeMemory} onClick={() => tubeMemory && setSnapshot({ space: tubeMemory.addressSpace, address: tubeMemory.address, bytes: [...tubeMemory.bytes], cycles: tubeMemory.capturedAtCycles })}>Snapshot</button><button type="button" disabled={!snapshot} onClick={() => setSnapshot(undefined)}>Clear snapshot</button><button type="button" disabled={!tubeMemory} onClick={() => void copy()}>Copy</button><button type="button" disabled={!tubeMemory} onClick={() => exportData(false)}>Text</button><button type="button" disabled={!tubeMemory} onClick={() => exportData(true)}>Binary</button><small>{snapshot ? `${changed.size} changed since cycle ${snapshot.cycles.toLocaleString()}` : 'No snapshot'}</small></div>{tubeMemory ? <div className="tube-memory-table" role="table" aria-label="Tube parasite memory bytes">{rows.map((row) => <div role="row" key={row.address}><strong role="cell">{formatAddress(row.address)}</strong><code role="cell">{row.values.map((value, index) => { const address = row.address + index; return <span className={`${changed.has(address) ? 'changed ' : ''}${matches.includes(address) ? 'match' : ''}`.trim()} key={address}>{value}</span>; })}</code><span role="cell">{row.ascii}</span></div>)}</div> : <div className="honest-empty">Choose an address space and read a bounded window.</div>}<p aria-live="polite">{message}</p></section>;
}

interface DebugWatchRow { id: string; expression: string; status: 'pending' | 'ready' | 'error'; value?: number; source?: string; message?: string }

function DebugVariablesPanel({ artifact, state, memory, onMachineCommand }: { artifact: AssemblyArtifact | null; state: MachineBridgeSnapshot; memory: MachineMemory | null; onMachineCommand: (message: Record<string, unknown>) => void }) {
  const [expression, setExpression] = useState('');
  const [manualResult, setManualResult] = useState<DebugWatchRow>();
  const [watches, setWatches] = useState<DebugWatchRow[]>([]);
  const [symbolFilter, setSymbolFilter] = useState('');
  const pending = useRef(new Map<string, { id: string; plan: Extract<DebugExpressionPlan, { kind: 'memory' }>; manual: boolean }>());
  const symbols = artifact?.symbols ?? {};
  const visibleSymbols = useMemo(() => Object.entries(symbols).filter(([name]) => name.toLowerCase().includes(symbolFilter.trim().toLowerCase())).sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0])).slice(0, 256), [symbols, symbolFilter]);
  const evaluate = useCallback((id: string, text: string, manual = false) => {
    try {
      const plan = parseDebugExpression(text, symbols, state.registers);
      if (plan.kind === 'value') {
        const result: DebugWatchRow = { id, expression: text, status: 'ready', value: plan.value, source: plan.source };
        if (manual) setManualResult(result); else setWatches((current) => current.map((row) => row.id === id ? result : row));
        return;
      }
      if (plan.address + plan.width > 0x10000) throw new Error('The memory read would cross the end of the 16-bit address space');
      const requestId = `debug-expression-${crypto.randomUUID()}`;
      pending.current.set(requestId, { id, plan, manual });
      const waiting: DebugWatchRow = { id, expression: text, status: 'pending', source: plan.source, message: `Reading ${plan.width} byte${plan.width === 1 ? '' : 's'} at ${formatAddress(plan.address)}` };
      if (manual) setManualResult(waiting); else setWatches((current) => current.map((row) => row.id === id ? waiting : row));
      onMachineCommand({ type: 'read-memory', address: plan.address, length: plan.width, addressSpace: 'mapped', requestId });
    } catch (error) {
      const result: DebugWatchRow = { id, expression: text, status: 'error', message: error instanceof Error ? error.message : String(error) };
      if (manual) setManualResult(result); else setWatches((current) => current.map((row) => row.id === id ? result : row));
    }
  }, [onMachineCommand, state.registers, symbols]);
  useEffect(() => {
    if (!memory) return;
    const request = pending.current.get(memory.requestId);
    if (!request) return;
    pending.current.delete(memory.requestId);
    try {
      const result: DebugWatchRow = { id: request.id, expression: request.manual ? expression : watches.find((row) => row.id === request.id)?.expression ?? '', status: 'ready', value: renderDebugMemoryValue(memory.bytes, request.plan.width), source: `${request.plan.source}; live mapped memory at cycle ${memory.capturedAtCycles.toLocaleString()}` };
      if (request.manual) setManualResult(result); else setWatches((current) => current.map((row) => row.id === request.id ? { ...result, expression: row.expression } : row));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (request.manual) setManualResult({ id: request.id, expression, status: 'error', message }); else setWatches((current) => current.map((row) => row.id === request.id ? { ...row, status: 'error', message } : row));
    }
  }, [memory?.requestId]);
  const addWatch = () => {
    const text = expression.trim();
    if (!text || watches.length >= 64) return;
    const row = { id: crypto.randomUUID(), expression: text, status: 'pending' as const };
    setWatches((current) => [...current, row]); setExpression('');
    queueMicrotask(() => evaluate(row.id, text));
  };
  const refresh = () => watches.forEach((row) => evaluate(row.id, row.expression));
  return <section className="debug-variables-panel" aria-label="Call stack variables and watches">
    <div className="panel-heading"><strong>Stack, symbols and expressions</strong><small>bounded and side-effect-free inspection</small></div>
    <div className="decoded-call-stack"><h4>Decoded call stack</h4>{state.callStack.map((frame, index) => <div key={`${frame.kind}-${frame.pc}-${index}`}><code>{index}</code><strong>{frame.symbol ?? formatAddress(frame.pc)}</strong><span>{frame.kind === 'current' ? `current PC ${formatAddress(frame.pc)}` : `return ${formatAddress(frame.pc)} from JSR ${formatAddress(frame.callSite!)} to ${formatAddress(frame.target!)}`}</span><small>{frame.source ? `${frame.source.fileName}:${frame.source.line}` : frame.confidence}</small></div>)}<p>Return frames are included only when adjacent live hardware-stack bytes resolve to an address immediately after a genuine JSR opcode. Unmatched pushed data is not guessed as a frame.</p></div>
    <div className="debug-scope-grid"><section><h4>Globals and build symbols</h4><label><span>Filter symbols</span><input aria-label="Filter debug symbols" value={symbolFilter} onChange={(event) => setSymbolFilter(event.target.value)} /></label><div>{visibleSymbols.map(([name, address]) => <button type="button" key={name} onClick={() => { setExpression(name); evaluate(`symbol-${name}`, name, true); }}><strong>{name}</strong><code>{formatAddress(address)}</code></button>)}{!visibleSymbols.length && <div className="honest-empty">No current build symbol matches.</div>}</div><p>Assembler and linker output identifies names and addresses, but does not classify storage. These entries are not falsely labelled as mutable globals.</p></section><section><h4>Locals and parameters</h4><div className="honest-empty">Unavailable for this artifact. The selected toolchain supplied address symbols and source locations, but no lexical scope, local variable, parameter, type, location-list or unwind metadata.</div></section></div>
    <div className="debug-expression-editor"><label><span>Safe expression</span><input aria-label="Debug expression" value={expression} onChange={(event) => setExpression(event.target.value)} placeholder="A, buffer+2, byte(buffer), word(&2000)" /></label><button type="button" disabled={!expression.trim()} onClick={() => evaluate('manual', expression.trim(), true)}>Evaluate</button><button type="button" disabled={!expression.trim() || watches.length >= 64} onClick={addWatch}>Add watch</button><button type="button" disabled={!watches.length} onClick={refresh}>Refresh all</button><small>Grammar: live 6502 register, current build symbol or 16-bit number, one optional numeric offset, and optional byte(...) or little-endian word(...). No scripts or arbitrary operators execute.</small></div>
    {manualResult && <div className={`debug-expression-result ${manualResult.status}`} role="status"><strong>{manualResult.expression}</strong>{manualResult.value === undefined ? <span>{manualResult.message}</span> : <code>&amp;{manualResult.value.toString(16).toUpperCase().padStart(manualResult.value > 0xff ? 4 : 2, '0')} · {manualResult.value}</code>}<small>{manualResult.source}</small></div>}
    <div className="debug-watch-list" aria-label="Debug watches">{watches.map((row) => <div className={row.status} key={row.id}><strong>{row.expression}</strong>{row.value === undefined ? <span>{row.message ?? row.status}</span> : <code>&amp;{row.value.toString(16).toUpperCase().padStart(row.value > 0xff ? 4 : 2, '0')} · {row.value}</code>}<small>{row.source}</small><button type="button" aria-label={`Refresh watch ${row.expression}`} onClick={() => evaluate(row.id, row.expression)}>Refresh</button><button type="button" aria-label={`Remove watch ${row.expression}`} onClick={() => setWatches((current) => current.filter((item) => item.id !== row.id))}>Remove</button></div>)}</div>
  </section>;
}

function DebuggerWorkspace({ artifact, currentFiles, state, runtime, hardwareState, hardwareMemory, hardwareDisassembly, hardwareInspection, hardwareConnected, sourceBreakpointAddresses, persistedBreakpoints, breakpointGroups, onPersistBreakpoints, onPersistGroups, onMachineCommand, onNavigateSource, onStep, onContinue, onReset, onStateChange, onAnalyse }: DebuggerWorkspaceProps) {
  const [breakpointAddress, setBreakpointAddress] = useState('');
  const [breakpointRegister, setBreakpointRegister] = useState('');
  const [breakpointOperator, setBreakpointOperator] = useState('eq');
  const [breakpointValue, setBreakpointValue] = useState('');
  const [breakpointHitTarget, setBreakpointHitTarget] = useState('');
  const [breakpointMode, setBreakpointMode] = useState<'break' | 'log'>('break');
  const [breakpointLogMessage, setBreakpointLogMessage] = useState('');
  const [breakpointGroupId, setBreakpointGroupId] = useState('');
  const [breakpointGroupName, setBreakpointGroupName] = useState('');
  const [breakpointMessage, setBreakpointMessage] = useState('');
  const resolvedPersistedBreakpoints = useMemo(() => resolve6502BreakpointIntents(persistedBreakpoints, artifact, breakpointGroups), [artifact, breakpointGroups, persistedBreakpoints]);
  const sourceBreakpointKey = [...new Set(sourceBreakpointAddresses)].sort((a, b) => a - b).join(',');
  /* Whether the machine is holding the program these breakpoints are about.
   * The reasoning, and the case this used to get wrong, are in the module. */
  const hardwareArtifactLoaded = machineHoldsArtifact(
    artifact ? { origin: artifact.origin, byteLength: artifact.bytes.length } : null,
    hardwareState?.programManifest ?? null,
    hardwareState?.registers.pc ?? null,
  );
  useEffect(() => {
    if (!hardwareConnected || !hardwareArtifactLoaded) return;
    const combined = new Map<number, object>();
    sourceBreakpointKey.split(',').filter(Boolean).forEach((address) => combined.set(Number(address), { address: Number(address), enabled: true, stop: true }));
    resolvedPersistedBreakpoints.forEach((item) => { if (item.wireSpec) combined.set(item.wireSpec.address, item.wireSpec); });
    onMachineCommand({ type: 'set-breakpoints', breakpoints: Array.from(combined.values()) });
  }, [artifact, breakpointGroups, hardwareArtifactLoaded, hardwareConnected, persistedBreakpoints, sourceBreakpointKey]);
  useEffect(() => {
    const recorded = record6502BreakpointResolutions(persistedBreakpoints, resolvedPersistedBreakpoints);
    if (recorded !== persistedBreakpoints) onPersistBreakpoints(recorded);
  }, [resolvedPersistedBreakpoints]);
  if (hardwareConnected) {
    const addHardwareBreakpoint = () => {
      const hitTarget = breakpointHitTarget.trim() ? Number(breakpointHitTarget) : undefined;
      const created: Persisted6502BreakpointIntent = { id: crypto.randomUUID(), expression: breakpointAddress.trim(), enabled: true, action: breakpointMode === 'break' ? 'pause' : 'log', ...(breakpointRegister ? { condition: { register: breakpointRegister as 'a' | 'x' | 'y' | 's' | 'p' | 'pc', operator: breakpointOperator as 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte', expression: breakpointValue.trim() } } : {}), ...(hitTarget === undefined ? {} : { hitTarget }), ...(breakpointLogMessage.trim() ? { logMessage: breakpointLogMessage.trim() } : {}), ...(breakpointGroupId ? { groupId: breakpointGroupId } : {}) };
      const resolution = resolve6502BreakpointIntents([created], artifact, breakpointGroups)[0];
      if (!created.expression || !resolution?.wireSpec) { setBreakpointMessage(resolution?.error ?? 'Enter an address or build symbol'); return; }
      onPersistBreakpoints([...persistedBreakpoints, created]);
      setBreakpointMessage(`Saved ${created.expression} and resolved it to ${formatAddress(resolution.address!)}`);
      setBreakpointAddress('');
    };
    const runToAddress = () => {
      const address = parseHexAddress(breakpointAddress);
      if (address !== null) onMachineCommand({ type: 'run-to', address });
    };
    return <div className="debug-workspace">
      <div className="runtime-heading"><div><span className="eyebrow">LIVE JSBEEB HARDWARE DEBUG ADAPTER</span><h2>{hardwareState ? `${hardwareState.running ? 'running' : 'paused'} · ${hardwareState.reason}` : 'Connecting to machine'}</h2></div><div className="runtime-actions"><button type="button" disabled={hardwareState?.running} title={hardwareState?.running ? 'The CPU is already running' : 'Continue live execution'} onClick={() => onMachineCommand({ type: 'run' })}><Icon name="play" size={14} /> Continue</button><button type="button" disabled={!hardwareState?.running} title={hardwareState?.running ? 'Pause at the next instruction boundary' : 'The CPU is already paused'} onClick={() => onMachineCommand({ type: 'pause' })}>Pause</button><button type="button" disabled={hardwareState?.running} title={hardwareState?.running ? 'Pause before instruction stepping' : 'Execute one 6502 instruction'} onClick={() => onMachineCommand({ type: 'step' })}>Instruction in</button><button type="button" disabled={hardwareState?.running} title={hardwareState?.running ? 'Pause before stepping over' : 'Run through JSR or execute one non-call instruction'} onClick={() => onMachineCommand({ type: 'step-over' })}>Instruction over</button><button type="button" disabled={hardwareState?.running || !artifact?.sourceLocations[hardwareState?.registers.pc ?? -1]} title={hardwareState?.running ? 'Pause before source stepping' : !artifact?.sourceLocations[hardwareState?.registers.pc ?? -1] ? 'The current address has no retained source mapping' : 'Run to a different mapped source line'} onClick={() => onMachineCommand({ type: 'source-step', mode: 'in', instructionBudget: 100000 })}>Source in</button><button type="button" disabled={hardwareState?.running || !artifact?.sourceLocations[hardwareState?.registers.pc ?? -1]} title={hardwareState?.running ? 'Pause before source stepping' : !artifact?.sourceLocations[hardwareState?.registers.pc ?? -1] ? 'The current address has no retained source mapping' : 'Step over the current mapped source statement'} onClick={() => onMachineCommand({ type: 'source-step', mode: 'over', instructionBudget: 100000 })}>Source over</button><button type="button" disabled={hardwareState?.running} title={hardwareState?.running ? 'Pause before stepping out' : 'Run to the return address on the live hardware stack'} onClick={() => onMachineCommand({ type: 'step-out' })}>Source out</button><button type="button" title="Reset the same bound machine" onClick={() => onMachineCommand({ type: 'reset' })}><Icon name="reset" size={14} /> Restart</button></div></div>
      {hardwareState && <DebugProtocolPanel protocol={hardwareState.protocol} />}
      {hardwareState?.tube && <TubeProcessorPanel state={hardwareState} memory={hardwareMemory} onMachineCommand={onMachineCommand} />}
      {hardwareState && <DebugVariablesPanel artifact={artifact} state={hardwareState} memory={hardwareMemory} onMachineCommand={onMachineCommand} />}
      {hardwareState && <ReplayHistoryPanel state={hardwareState} onMachineCommand={onMachineCommand} />}
      {hardwareState && <RuntimePerformancePanel state={hardwareState.performance} />}
      {/*
        * A machine can be running perfectly and holding somebody else's
        * program — the operating system, or a build from before. Breakpoints
        * set against this build are then armed against nothing, and the only
        * clue was that pressing the machine's own Run resumed the ROM. Saying
        * which control puts this build on the machine is the difference
        * between a debugger and a puzzle.
        */}
      {hardwareState && artifact && !hardwareArtifactLoaded && <p className="honest-note" role="status">
        The machine is running, and it is not holding this build. Breakpoints set here are kept and
        armed as soon as it is. Use <strong>Build and debug</strong> in the toolbar to put
        {' '}{artifact.provenance?.target.name ?? 'this build'} on the machine and stop at its
        entry point.
      </p>}
      {!hardwareState ? <div className="honest-empty runtime-empty">The ROM-aware hardware emulator is booting. Register, breakpoint and instruction state will attach as soon as the bridge reports its first snapshot.</div> : <div className="debug-grid">
        <section><h3>Hardware registers</h3><div className="register-grid">{Object.entries(hardwareState.registers).map(([name, value]) => <div key={name}><span>{name.toUpperCase()}</span><strong>{name === 'pc' ? formatAddress(value) : formatByte(value)}</strong></div>)}</div><h3>Processor flags</h3><div className="flag-row">{['N','V','U','B','D','I','Z','C'].map((flag, index) => <span className={hardwareState.registers.p & (0x80 >> index) ? 'set' : ''} key={flag}>{flag}</span>)}</div><h3>Current instruction</h3><div className="current-instruction"><code>{formatAddress(hardwareState.currentInstruction.address)}</code><span>{hardwareState.currentInstruction.bytes.map(formatByte).join(' ')}</span><strong>{hardwareState.currentInstruction.instruction}</strong><small>{artifact?.sourceMap[hardwareState.currentInstruction.address] ? `source line ${artifact.sourceMap[hardwareState.currentInstruction.address]}` : 'live machine memory'}</small></div><InstructionEffects state={hardwareState} /><h3>Execute breakpoints / run to</h3><div className="breakpoint-editor"><div className="breakpoint-entry"><input aria-label="Hardware breakpoint address" value={breakpointAddress} onChange={(event) => setBreakpointAddress(event.target.value)} placeholder="&E581" /><button type="button" onClick={addHardwareBreakpoint}>Add</button><button type="button" disabled={hardwareState.running} onClick={runToAddress}>Run to</button></div><div className="breakpoint-options"><label><span>Condition</span><select aria-label="Breakpoint condition register" value={breakpointRegister} onChange={(event) => setBreakpointRegister(event.target.value)}><option value="">Always</option>{['a','x','y','s','p','pc'].map((register) => <option value={register} key={register}>{register.toUpperCase()}</option>)}</select></label><label><span>Compare</span><select aria-label="Breakpoint condition operator" value={breakpointOperator} disabled={!breakpointRegister} onChange={(event) => setBreakpointOperator(event.target.value)}><option value="eq">equals</option><option value="ne">not equal</option><option value="lt">less than</option><option value="lte">at most</option><option value="gt">greater than</option><option value="gte">at least</option></select></label><label><span>Value</span><input aria-label="Breakpoint condition value" disabled={!breakpointRegister} value={breakpointValue} onChange={(event) => setBreakpointValue(event.target.value)} placeholder="&03" /></label><label><span>Hit ≥</span><input aria-label="Breakpoint hit target" inputMode="numeric" value={breakpointHitTarget} onChange={(event) => setBreakpointHitTarget(event.target.value)} placeholder="1" /></label><label><span>Action</span><select aria-label="Breakpoint action" value={breakpointMode} onChange={(event) => setBreakpointMode(event.target.value as 'break' | 'log')}><option value="break">Pause</option><option value="log">Log only</option></select></label><label className="breakpoint-log-input"><span>Log message · placeholders: {'{pc} {a} {x} {y} {s} {p} {hits}'}</span><input aria-label="Breakpoint log message" value={breakpointLogMessage} onChange={(event) => setBreakpointLogMessage(event.target.value)} placeholder={breakpointMode === 'log' ? 'X={x} hit {hits}' : 'Optional'} /></label></div></div><div className="breakpoint-list hardware-breakpoint-list" aria-label="Hardware breakpoints">{hardwareState.breakpoints.map((breakpoint) => <button type="button" aria-label={`Remove breakpoint ${formatAddress(breakpoint.address)}`} key={breakpoint.address} onClick={() => onMachineCommand({ type: 'breakpoint', address: breakpoint.address, enabled: false, stop: true })}><strong>{formatAddress(breakpoint.address)}</strong><span>{breakpoint.stop ? 'pause' : 'log'} · {breakpoint.hits} hit{breakpoint.hits === 1 ? '' : 's'}{breakpoint.condition ? ` · ${breakpoint.condition.register.toUpperCase()} ${breakpoint.condition.operator} &${breakpoint.condition.value.toString(16).toUpperCase()}` : ''}{breakpoint.hitTarget ? ` · ≥${breakpoint.hitTarget}` : ''}</span><small>Remove ×</small></button>)}</div><h3>Raw hardware stack</h3><div className="raw-stack">{hardwareState.stack.length ? hardwareState.stack.map((item) => <code key={item.address}>{formatAddress(item.address)}:{formatByte(item.value)}</code>) : <span>No bytes above SP</span>}</div></section>
        <section><h3>Machine state</h3><div className="machine-debug-facts"><div><span>Execution</span><strong>{hardwareState.running ? 'running' : 'paused'}</strong></div><div><span>CPU core</span><strong>{hardwareState.cpuCore}</strong></div><div><span>Reason</span><strong>{hardwareState.reason}</strong></div><div><span>Emulated cycles</span><strong>{hardwareState.cycles.toLocaleString()}</strong></div></div><h3>Interrupt state</h3><div className="interrupt-grid" aria-label="Live CPU interrupt state"><div><span>IRQ line</span><strong className={hardwareState.interrupts.irqLine ? 'asserted' : ''}>{hardwareState.interrupts.irqLine ? 'asserted' : 'clear'}</strong></div><div><span>IRQ accepted</span><strong>{hardwareState.interrupts.irqAccepted ? 'pending' : 'no'}</strong></div><div><span>I mask</span><strong>{hardwareState.interrupts.interruptDisable ? 'set' : 'clear'}</strong></div><div><span>IRQ source mask</span><strong>&amp;{hardwareState.interrupts.irqSourceMask.toString(16).toUpperCase().padStart(8, '0')}</strong></div><div><span>NMI line / edge</span><strong>{hardwareState.interrupts.nmiLevel ? 'high' : 'low'} / {hardwareState.interrupts.nmiEdge ? 'latched' : 'clear'}</strong></div></div><p className="honest-note">IRQ source mask, acceptance and NMI state are read directly from the selected jsbeeb CPU core; named sources below come only from peripheral IFR/IER or status/control snapshots.</p><InterruptHistoryPanel state={hardwareState} onMachineCommand={onMachineCommand} /><HardwareMemoryInspector artifact={artifact} state={hardwareState} memory={hardwareMemory} onMachineCommand={onMachineCommand} onAnalyse={onAnalyse} /></section>
        <section className="trace-section"><HardwareDisassemblyPanel artifact={artifact} currentFiles={currentFiles} state={hardwareState} disassembly={hardwareDisassembly} onMachineCommand={onMachineCommand} onNavigateSource={onNavigateSource} /><HardwareTracePanel state={hardwareState} onMachineCommand={onMachineCommand} /><h3>Breakpoint event log <small>{hardwareState.breakpointLogs.length} retained</small></h3><div className="breakpoint-event-log" role="log" aria-label="Breakpoint event log">{hardwareState.breakpointLogs.length ? hardwareState.breakpointLogs.slice().reverse().map((entry) => <div key={entry.sequence}><code>#{entry.sequence}</code><strong>{formatAddress(entry.address)}</strong><span>{entry.message}</span><small>hit {entry.hits}</small></div>) : <div className="honest-empty">No breakpoint log events in this debug session.</div>}</div></section>
      </div>}
      {hardwareState && <Breakpoint6502PersistencePanel intents={persistedBreakpoints} groups={breakpointGroups} resolved={resolvedPersistedBreakpoints} selectedGroupId={breakpointGroupId} groupName={breakpointGroupName} message={breakpointMessage} onSelectedGroup={setBreakpointGroupId} onGroupName={setBreakpointGroupName} onGroups={onPersistGroups} onIntents={onPersistBreakpoints} />}
      {hardwareState && <HardwareWatchpointPanel state={hardwareState} inspection={hardwareInspection} onMachineCommand={onMachineCommand} />}
    </div>;
  }
  if (!artifact || !state) return <div className="honest-empty runtime-empty">Build an assembly source with Debug to start a real 6502 debug session.</div>;
  const addBreakpoint = () => {
    const address = parseHexAddress(breakpointAddress);
    if (address === null) return;
    runtime.setBreakpoint(address);
    onStateChange(runtime.snapshot());
    setBreakpointAddress('');
  };
  const memoryStart = state.registers.pc & 0xfff0;
  const memory = Array.from(runtime.memory.slice(memoryStart, memoryStart + 64));
  return (
    <div className="debug-workspace">
      <div className="runtime-heading"><div><span className="eyebrow">LIVE 6502 DEBUG ADAPTER</span><h2>{state.status} · {state.reason}</h2></div><div className="runtime-actions"><button type="button" onClick={onContinue}><Icon name="play" size={14} /> Continue</button><button type="button" onClick={onStep}>Step</button><button type="button" onClick={onReset}><Icon name="reset" size={14} /> Reset</button></div></div>
      <div className="debug-grid">
        <section><h3>Registers</h3><div className="register-grid">{Object.entries(state.registers).map(([name, value]) => <div key={name}><span>{name.toUpperCase()}</span><strong>{name === 'pc' ? formatAddress(value) : formatByte(value)}</strong></div>)}</div><h3>Processor flags</h3><div className="flag-row">{['N','V','U','B','D','I','Z','C'].map((flag, index) => <span className={state.registers.p & (0x80 >> index) ? 'set' : ''} key={flag}>{flag}</span>)}</div><h3>Breakpoints</h3><div className="breakpoint-entry"><input aria-label="Breakpoint address" value={breakpointAddress} onChange={(event) => setBreakpointAddress(event.target.value)} placeholder="&1900" /><button type="button" onClick={addBreakpoint}>Add</button></div><div className="breakpoint-list">{Array.from(runtime.breakpoints).sort((a,b) => a-b).map((address) => <button type="button" key={address} onClick={() => { runtime.setBreakpoint(address, false); onStateChange(runtime.snapshot()); }}>{formatAddress(address)} ×</button>)}</div></section>
        <section><h3>Memory around PC</h3><div className="memory-grid">{Array.from({length: 4}, (_, row) => <div key={row}><strong>{formatAddress(memoryStart + row * 16)}</strong>{memory.slice(row * 16, row * 16 + 16).map((byte, index) => <code className={memoryStart + row * 16 + index === state.registers.pc ? 'pc-byte' : ''} key={index}>{formatByte(byte)}</code>)}</div>)}</div><h3>Program output</h3><pre className="program-output">{state.output || 'No MOS character output yet.'}</pre></section>
        <section className="trace-section"><h3>Instruction spy <small>{state.instructions.toLocaleString()} executed</small></h3><div className="trace-list" role="log" aria-label="Instruction trace">{state.trace.slice().reverse().map((entry, index) => <div className={index === 0 ? 'current' : ''} key={`${entry.address}-${state.instructions-index}`}><code>{formatAddress(entry.address)}</code><span>{entry.bytes.map(formatByte).join(' ')}</span><strong>{entry.instruction}</strong><small>{entry.sourceLine ? `source line ${entry.sourceLine}` : 'no source map'}</small></div>)}</div></section>
      </div>
    </div>
  );
}

function RuntimePerformancePanel({ state }: { state: MachineBridgeSnapshot['performance'] }) {
  const frames = state.frames;
  const underrunLabel = state.audio.underrunsAvailable ? `${state.audio.underruns.toLocaleString()} audio underruns` : 'underrun counter unavailable';
  return <details className="runtime-performance-panel"><summary><strong>Runtime performance</strong><span>{frames.droppedFrames.toLocaleString()} estimated drops · {underrunLabel} · {state.crashes.retained} crashes</span></summary><div className="runtime-performance-grid"><div><span>Frame interval</span><strong>{frames.lastIntervalMs.toFixed(1)} ms</strong><small>average {frames.averageIntervalMs.toFixed(1)} · maximum {frames.maximumIntervalMs.toFixed(1)}</small></div><div><span>Presentation</span><strong>{frames.renderedFrames.toLocaleString()} frames</strong><small>{frames.lateFrames.toLocaleString()} late · {frames.droppedFrames.toLocaleString()} estimated dropped</small></div><div><span>Audio path</span><strong>{state.audio.latencyMs.toFixed(1)} ms latency</strong><small>{state.audio.underrunsAvailable ? `${state.audio.underruns.toLocaleString()} gap underruns · last gap ${state.audio.lastBufferGapMs.toFixed(1)} ms` : 'callback underrun counter is not exposed by this adapter'}</small></div><div><span>Background</span><strong>{state.background.suspended ? 'suspended' : 'active'}</strong><small>{state.background.policy}</small></div></div><dl className="runtime-budget-list"><div><dt>Frame</dt><dd>{state.budgets.frameBudgetMs} ms</dd></div><div><dt>Snapshots</dt><dd>{state.budgets.snapshotIntervalMs} ms</dd></div><div><dt>Trace</dt><dd>{state.budgets.traceCapacity.toLocaleString()} records</dd></div><div><dt>Media</dt><dd>{(state.budgets.mediaBytesPerDrive / 1048576).toFixed(0)} MiB / drive</dd></div><div><dt>Sessions</dt><dd>{state.budgets.activeSessions}</dd></div></dl><p>{frames.source}. {state.audio.source}. {state.isolation}.</p><div className="runtime-crash-list" aria-label="Bounded runtime crash diagnostics">{state.crashes.records.length ? state.crashes.records.slice().reverse().map((record) => <div key={record.sequence}><code>#{record.sequence}</code><strong>{record.kind}</strong><span>{record.message}</span><small>{record.timeMs.toFixed(1)} ms monotonic</small></div>) : <div className="honest-empty">No runtime crash has been observed in this machine session.</div>}</div></details>;
}

function HardwareMemoryInspector({ artifact, state, memory, onMachineCommand, onAnalyse }: { artifact: AssemblyArtifact | null; state: MachineBridgeSnapshot; memory: MachineMemory | null; onMachineCommand: (message: Record<string, unknown>) => void; onAnalyse?: (name: string, bytes: Uint8Array, metadata: AcornFileMetadata, overrides?: { processor?: AnalysisProcessor; origin?: number; entryPoint?: number }) => void }) {
  const [query, setQuery] = useState('&0000');
  const [length, setLength] = useState('128');
  const [width, setWidth] = useState<8 | 16 | 32>(16);
  const [radix, setRadix] = useState<MemoryRadix>('hex');
  const [textMode, setTextMode] = useState<MemoryTextMode>('acorn');
  const [addressSpace, setAddressSpace] = useState<MemorySpaceId>('mapped');
  const [bank, setBank] = useState(state.memoryMap.selectedBank ?? 0);
  const [selectedAddress, setSelectedAddress] = useState<number>();
  const [editBytes, setEditBytes] = useState('');
  const [searchMode, setSearchMode] = useState<'bytes' | 'text'>('bytes');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [snapshot, setSnapshot] = useState<{ address: number; bytes: number[]; cycles: number; addressSpace: MemorySpaceId; bank?: number }>();
  const [message, setMessage] = useState('Enter an address, build symbol, or symbol ± offset.');
  const symbols = useMemo(() => Object.fromEntries(Object.entries(artifact?.symbols ?? {}).map(([name, address]) => [name.toUpperCase(), address])), [artifact]);
  const rows = useMemo(() => memory ? formatMemoryRows(memory.address, memory.bytes, width, radix) : [], [memory, width, radix]);
  const changed = useMemo(() => memory && snapshot && memory.addressSpace === snapshot.addressSpace && memory.bank === snapshot.bank ? changedMemoryAddresses(memory.address, memory.bytes, snapshot.address, snapshot.bytes) : new Set<number>(), [memory, snapshot]);
  const selectedSpace = state.memoryMap.spaces.find((space) => space.id === addressSpace) ?? state.memoryMap.spaces[0]!;
  useEffect(() => { if (state.memoryMap.selectedBank !== undefined) setBank(state.memoryMap.selectedBank); }, [state.memoryMap.selectedBank]);
  useEffect(() => {
    if (memory) setMessage(`${memory.bytes.length} bytes read from ${memory.addressSpaceLabel}${memory.bank === undefined ? '' : ` bank ${memory.bank}`} at ${formatAddress(memory.address)} · cycle ${memory.capturedAtCycles.toLocaleString()}.`);
  }, [memory?.requestId]);

  const requestedLength = () => {
    const value = Number(length);
    return Number.isInteger(value) && value >= 1 && value <= 4096 ? value : null;
  };
  const request = (addressOverride?: number, spaceOverride: MemorySpaceId = addressSpace, bankOverride: number = bank) => {
    const address = addressOverride ?? resolveMemoryExpression(query, symbols);
    const count = requestedLength();
    const targetSpace = state.memoryMap.spaces.find((space) => space.id === spaceOverride);
    if (address === null || address === undefined) { setMessage('Address must be &hex, $hex, decimal, or a build symbol with one optional offset.'); return; }
    if (count === null) { setMessage('Length must be an integer from 1 to 4096 bytes.'); return; }
    if (!targetSpace || address < targetSpace.start || address + count - 1 > targetSpace.end) { setMessage(`${targetSpace?.label ?? spaceOverride} reads must stay inside ${targetSpace ? `${formatAddress(targetSpace.start)}–${formatAddress(targetSpace.end)}` : 'its supported range'}.`); return; }
    if (addressOverride !== undefined) setQuery(formatAddress(addressOverride));
    setSelectedAddress(undefined);
    setSearchResults([]);
    setMessage(`Reading ${count} bytes from ${formatAddress(address)}…`);
    onMachineCommand({ type: 'read-memory', address, length: count, addressSpace: spaceOverride, ...(targetSpace.banked ? { bank: bankOverride } : {}), requestId: `inspector-${spaceOverride}-${bankOverride}-${address}-${count}-${Date.now()}` });
  };
  const movePage = (direction: -1 | 1) => {
    if (!memory) return;
    const count = requestedLength() ?? memory.bytes.length;
    const space = state.memoryMap.spaces.find((candidate) => candidate.id === memory.addressSpace) ?? selectedSpace;
    request(Math.max(space.start, Math.min(space.end - count + 1, memory.address + direction * count)), memory.addressSpace, memory.bank ?? bank);
  };
  const find = () => {
    if (!memory) { setMessage('Inspect a memory range before searching it.'); return; }
    try {
      const results = searchMemory(memory.address, memory.bytes, parseMemorySearch(searchQuery, searchMode));
      setSearchResults(results);
      setMessage(`${results.length} match${results.length === 1 ? '' : 'es'} in the loaded range${results.length === 256 ? ' (limit reached)' : ''}.`);
    } catch (error) { setSearchResults([]); setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const followPointer = () => {
    if (!memory || selectedAddress === undefined) { setMessage('Select the low byte of a two-byte pointer first.'); return; }
    const target = readLittleEndianPointer(memory.address, memory.bytes, selectedAddress);
    if (target === null) { setMessage('Both pointer bytes must be inside the loaded range.'); return; }
    setAddressSpace('mapped');
    request(target, 'mapped');
  };
  const write = () => {
    const address = selectedAddress ?? memory?.address;
    if (address === undefined || memory?.addressSpace !== 'mapped') { setMessage('Safe editing currently requires the mapped CPU view; physical-bank views are read-only.'); return; }
    try {
      const parsed = parseMemorySearch(editBytes, 'bytes');
      if (parsed.some((byte) => byte === null)) throw new Error('RAM edits cannot contain wildcard bytes');
      const bytes = parsed as number[];
      if (address >= 0x8000 || address + bytes.length > 0x8000) throw new Error('RAM edits cannot cross into mapped I/O or ROM at &8000');
      setMessage(`Writing ${bytes.length} byte${bytes.length === 1 ? '' : 's'} at ${formatAddress(address)}…`);
      onMachineCommand({ type: 'write-memory', address, bytes });
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const dumpText = () => memory ? rows.map((row) => `${formatAddress(row.address)}  ${row.values.join(' ')}  |${textMode === 'acorn' ? row.acorn : row.ascii}|`).join('\n') : '';
  const copyDump = async () => {
    if (!memory) return;
    try { await navigator.clipboard.writeText(dumpText()); setMessage(`${memory.bytes.length} displayed bytes copied as text.`); }
    catch { setMessage('Clipboard access was unavailable; use Export text instead.'); }
  };
  const exportDump = (binary: boolean) => {
    if (!memory) return;
    downloadBlob(binary ? new Blob([new Uint8Array(memory.bytes)], { type: 'application/octet-stream' }) : new Blob([dumpText(), '\n'], { type: 'text/plain;charset=utf-8' }), `memory-${memory.address.toString(16).padStart(4, '0')}.${binary ? 'bin' : 'txt'}`);
    setMessage(`${memory.bytes.length} displayed bytes exported as ${binary ? 'binary' : 'text'}.`);
  };

  return <div className="memory-inspector">
    <h3>Live memory inspector <small>{memory ? `${memory.bytes.length} bytes · ${memory.addressSpaceLabel}${memory.bank === undefined ? '' : ` · bank ${memory.bank}`} · cycle ${memory.capturedAtCycles.toLocaleString()}` : 'no range loaded'}</small></h3>
    <div className="live-memory-map" aria-label={`${state.memoryMap.profile} live memory map`}>
      <div className="memory-map-registers"><strong>{state.memoryMap.profile.toUpperCase()}</strong>{state.memoryMap.romsel === undefined ? <span>No BBC ROMSEL register</span> : <span>ROMSEL &amp;{formatByte(state.memoryMap.romsel)} · bank {state.memoryMap.selectedBank} · {state.memoryMap.selectedBankWritable ? 'sideways RAM' : 'sideways ROM'}</span>}{state.memoryMap.acccon !== undefined && <span>ACCCON &amp;{formatByte(state.memoryMap.acccon)}</span>}</div>
      <div className="memory-map-regions" role="list" aria-label="Mapped CPU regions">{state.memoryMap.regions.map((region) => <div role="listitem" className={`map-${region.kind}${region.active ? ' active' : ''}`} style={{ flexGrow: region.end - region.start + 1 }} title={`${formatAddress(region.start)}–${formatAddress(region.end)} · ${region.label}${region.detail ? ` · ${region.detail}` : ''}`} key={`${region.start}-${region.end}`}><strong>{region.label}</strong><small>{formatAddress(region.start)}–{formatAddress(region.end)}</small></div>)}</div>
      {state.memoryMap.accconFlags.length > 0 && <div className="memory-map-flags" aria-label="Master ACCCON flags">{state.memoryMap.accconFlags.map((flag) => <span className={flag.set ? 'set' : ''} title={flag.meaning} key={flag.bit}>{flag.bit}</span>)}</div>}
      {state.memoryMap.banks.length > 0 && <div className="sideways-bank-grid" aria-label="Sideways ROM and RAM banks">{state.memoryMap.banks.map((item) => <button type="button" className={`${item.selected ? 'hardware-selected ' : ''}${addressSpace === 'sideways' && bank === item.bank ? 'inspector-selected' : ''}`} aria-label={`Inspect sideways bank ${item.bank} ${item.writable ? 'RAM' : 'ROM'}${item.selected ? ', hardware selected' : ''}`} title={`Bank ${item.bank} · ${item.writable ? 'sideways RAM' : 'ROM'}${item.selected ? ' · current ROMSEL' : ''}`} onClick={() => { setAddressSpace('sideways'); setBank(item.bank); setQuery('&8000'); request(0x8000, 'sideways', item.bank); }} key={item.bank}><strong>{item.bank.toString(16).toUpperCase()}</strong><small>{item.writable ? 'RAM' : 'ROM'}</small></button>)}</div>}
    </div>
    <div className="memory-inspector-nav">
      <label><span>Address / symbol</span><input aria-label="Memory address or symbol" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') request(); }} /></label>
      <label><span>Length</span><input aria-label="Memory read length" type="number" min="1" max="4096" value={length} onChange={(event) => setLength(event.target.value)} /></label>
      <button type="button" onClick={() => request()}>Inspect</button><button type="button" disabled={!memory} onClick={() => movePage(-1)} aria-label="Previous memory page">←</button><button type="button" disabled={!memory} onClick={() => movePage(1)} aria-label="Next memory page">→</button><button type="button" onClick={() => { setAddressSpace('mapped'); request(state.registers.pc, 'mapped'); }}>PC</button>
    </div>
    <div className="memory-inspector-options">
      <label><span>Address space</span><select aria-label="Memory address space" value={addressSpace} onChange={(event) => { const next = event.target.value as MemorySpaceId; const space = state.memoryMap.spaces.find((item) => item.id === next)!; setAddressSpace(next); setQuery(formatAddress(space.start)); setSelectedAddress(undefined); }}>{state.memoryMap.spaces.map((space) => <option value={space.id} key={space.id}>{space.label}{space.banked ? ` · bank ${bank}` : ''}</option>)}</select></label>
      <label><span>Columns</span><select aria-label="Memory columns" value={width} onChange={(event) => setWidth(Number(event.target.value) as 8 | 16 | 32)}><option value="8">8</option><option value="16">16</option><option value="32">32</option></select></label>
      <label><span>Numbers</span><select aria-label="Memory number format" value={radix} onChange={(event) => setRadix(event.target.value as MemoryRadix)}><option value="hex">Hex</option><option value="decimal">Decimal</option></select></label>
      <label><span>Text</span><select aria-label="Memory text format" value={textMode} onChange={(event) => setTextMode(event.target.value as MemoryTextMode)}><option value="acorn">Acorn (£ at &amp;60)</option><option value="ascii">ASCII</option></select></label>
      <button type="button" disabled={!memory || selectedAddress === undefined} onClick={followPointer}>Follow pointer</button>
    </div>
    <div className="memory-inspector-search">
      <select aria-label="Memory search mode" value={searchMode} onChange={(event) => setSearchMode(event.target.value as 'bytes' | 'text')}><option value="bytes">Bytes / ?? wildcard</option><option value="text">ASCII text</option></select>
      <input aria-label="Memory search query" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') find(); }} placeholder={searchMode === 'bytes' ? 'A9 ?? 20' : 'HELLO'} />
      <button type="button" disabled={!memory || !searchQuery} onClick={find}>Find in range</button>
      <div className="memory-search-results" aria-label="Memory search results">{searchResults.map((address) => <button type="button" key={address} onClick={() => setSelectedAddress(address)}>{formatAddress(address)}</button>)}</div>
    </div>
    <div className="memory-inspector-tools">
      <button type="button" disabled={!memory} onClick={() => memory && setSnapshot({ address: memory.address, bytes: [...memory.bytes], cycles: memory.capturedAtCycles, addressSpace: memory.addressSpace, ...(memory.bank === undefined ? {} : { bank: memory.bank }) })}>Take snapshot</button>
      <button type="button" disabled={!snapshot} onClick={() => setSnapshot(undefined)}>Clear snapshot</button>
      <button type="button" disabled={!memory} onClick={() => void copyDump()}>Copy</button><button type="button" disabled={!memory} onClick={() => exportDump(false)}>Export text</button><button type="button" disabled={!memory} onClick={() => exportDump(true)}>Export binary</button>
      <button type="button" disabled={!memory || !onAnalyse} onClick={() => { if (!memory || !onAnalyse) return; const context = capturedMemoryFrom(memory, selectedSpace, state.sessionManifest.machine.label); onAnalyse(capturedMemoryName(context), Uint8Array.from(memory.bytes), capturedMemoryMetadata(context), { origin: memory.address, entryPoint: memory.address }); }}>Analyse window</button>
      <span>{snapshot ? `${changed.size} changed · snapshot cycle ${snapshot.cycles.toLocaleString()}` : 'No comparison snapshot'}</span>
    </div>
    {memory ? <div className="memory-inspector-table" role="table" aria-label="Live machine memory">
      {rows.map((row) => <div role="row" className="memory-inspector-row" style={{ gridTemplateColumns: `50px repeat(${width}, ${radix === 'hex' ? 23 : 28}px) minmax(${width * 7}px, 1fr)` }} key={row.address}><strong role="rowheader">{formatAddress(row.address)}</strong>{row.values.map((value, index) => { const address = row.address + index; return <button type="button" role="cell" aria-label={`${formatAddress(address)} value ${value}`} aria-selected={selectedAddress === address} className={`${selectedAddress === address ? 'selected' : ''} ${changed.has(address) ? 'changed' : ''}`} onClick={() => setSelectedAddress(address)} key={address}>{value}</button>; })}<code>{textMode === 'acorn' ? row.acorn : row.ascii}</code></div>)}
    </div> : <div className="honest-empty">No memory has been requested from the live emulator.</div>}
    <div className="memory-inspector-edit"><label><span>Paused mapped-RAM bytes at {selectedAddress === undefined ? '(select address)' : formatAddress(selectedAddress)}</span><input aria-label="Memory edit bytes" value={editBytes} onChange={(event) => setEditBytes(event.target.value)} placeholder="34 12 41 60" /></label><button type="button" disabled={state.running || addressSpace !== 'mapped' || selectedAddress === undefined || !editBytes.trim()} onClick={write}>Write &amp; verify</button></div>
    <p className="memory-inspector-message" aria-live="polite">{message}</p><p className="honest-note">Mapped reads use jsbeeb's side-effect-free CPU view. Physical RAM, ROM, Master private/shadow memory and all 16 sideways banks read directly from the emulator's backing store without changing ROMSEL or ACCCON. Physical views are deliberately read-only; mapped writes remain limited to paused RAM below &amp;8000. Tube and ARM spaces remain unavailable until their adapters expose equivalent authoritative mappings.</p>
  </div>;
}

function HardwareDisassemblyPanel({ artifact, currentFiles, state, disassembly, onMachineCommand, onNavigateSource }: { artifact: AssemblyArtifact | null; currentFiles: ProjectFile[]; state: MachineBridgeSnapshot; disassembly: MachineDisassembly | null; onMachineCommand: (message: Record<string, unknown>) => void; onNavigateSource: (fileId: string, line: number) => void }) {
  const [addressText, setAddressText] = useState(() => artifact ? formatAddress(artifact.entryPoint) : formatAddress(state.registers.pc));
  const [instructionCount, setInstructionCount] = useState('32');
  const [mixed, setMixed] = useState(true);
  const [message, setMessage] = useState('Live bytes have not been decoded yet.');
  const symbols = useMemo(() => Object.fromEntries(Object.entries(artifact?.symbols ?? {}).map(([name, address]) => [name.toUpperCase(), address])), [artifact]);
  const staleFiles = useMemo(() => Object.entries(artifact?.sourceFiles ?? {}).filter(([id, pinned]) => { const current = currentFiles.find((file) => file.id === id); return !current || current.name !== pinned.name || current.content !== pinned.content; }).map(([, pinned]) => pinned.name), [artifact, currentFiles]);
  const capturedStats = useMemo(() => {
    const stats = new Map<number, { count: number; cycles: number }>();
    state.hardwareTrace.records.forEach((record) => { const current = stats.get(record.pc) ?? { count: 0, cycles: 0 }; current.count += 1; current.cycles += record.cycles; stats.set(record.pc, current); });
    return stats;
  }, [state.hardwareTrace.records]);
  const request = (override?: number) => {
    const address = override ?? resolveMemoryExpression(addressText, symbols);
    const count = Number(instructionCount);
    if (address === null || address === undefined) { setMessage('Use a 16-bit address, build symbol, or symbol with one bounded offset.'); return; }
    if (!Number.isInteger(count) || count < 1 || count > 256) { setMessage('Instruction count must be an integer from 1 to 256.'); return; }
    if (override !== undefined) setAddressText(formatAddress(override));
    setMessage(`Decoding ${count} live instructions from ${formatAddress(address)}…`);
    onMachineCommand({ type: 'read-disassembly', address, instructionCount: count, requestId: `disassembly-${address}-${count}-${Date.now()}` });
  };
  useEffect(() => { if (artifact) request(artifact.entryPoint); }, [artifact?.entryPoint]);
  useEffect(() => { if (disassembly) setMessage(`${disassembly.rows.length} live instructions decoded at cycle ${disassembly.capturedAtCycles.toLocaleString()}.`); }, [disassembly?.requestId]);
  const pinnedSource = (address: number) => {
    const location = artifact?.sourceLocations[address];
    const file = location ? artifact?.sourceFiles[location.fileId] : undefined;
    return location && file ? { ...location, text: file.content.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')[location.line - 1] ?? '' } : undefined;
  };
  const toggleBreakpoint = (address: number) => {
    const installed = state.breakpoints.some((breakpoint) => breakpoint.address === address);
    onMachineCommand({ type: 'breakpoint', address, enabled: !installed, stop: true });
  };

  return <div className="hardware-disassembly">
    <h3>Live mixed disassembly <small>{disassembly ? `${disassembly.addressSpace} · ${disassembly.bank}` : 'current mapping'}</small></h3>
    {staleFiles.length > 0 && <div className="debug-build-stale" role="status"><strong>Editor newer than debugged build</strong><span>Showing pinned build source for {staleFiles.join(', ')}. Rebuild before trusting current editor content or line positions.</span></div>}
    <div className="disassembly-controls"><label><span>Address / symbol</span><input aria-label="Live disassembly address or symbol" value={addressText} onChange={(event) => setAddressText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') request(); }} /></label><label><span>Instructions</span><input aria-label="Live disassembly instruction count" type="number" min="1" max="256" value={instructionCount} onChange={(event) => setInstructionCount(event.target.value)} /></label><button type="button" onClick={() => request()}>Decode live</button><button type="button" onClick={() => request(state.registers.pc)}>Follow PC</button><label className="disassembly-mixed-toggle"><input type="checkbox" checked={mixed} onChange={(event) => setMixed(event.target.checked)} /><span>Mixed source</span></label></div>
    <div className="live-disassembly-header" aria-hidden="true"><span>Mark</span><span>Address / symbol</span><span>Bytes</span><span>Instruction</span><span>Cycles</span><span>Captured</span></div>
    <div className="live-disassembly-list" role="table" aria-label="Live machine disassembly">{disassembly?.rows.map((row) => {
      const source = pinnedSource(row.address);
      const breakpoint = state.breakpoints.find((item) => item.address === row.address);
      const stats = capturedStats.get(row.address);
      const cycleEstimate = formatCycleEstimate(estimate6502Cycles(row.mnemonic, row.addressingMode));
      return <div className={`${row.address === state.registers.pc ? 'current ' : ''}${breakpoint ? 'breakpoint' : ''}`.trim()} role="rowgroup" key={row.address} data-live-address={row.address}>
        <div role="row" className="live-disassembly-row"><button type="button" aria-label={`${breakpoint ? 'Remove' : 'Add'} breakpoint ${formatAddress(row.address)}`} className="disassembly-breakpoint" onClick={() => toggleBreakpoint(row.address)}>{breakpoint ? '●' : '○'}</button><span role="cell" className="live-disassembly-location">{row.symbol && <strong>{row.symbol}</strong>}<code>{formatAddress(row.address)}</code></span><code role="cell">{row.bytes.map(formatByte).join(' ')}</code><span role="cell" className="live-disassembly-instruction"><strong>{row.mnemonic}</strong><code>{row.instruction.slice(row.mnemonic.length).trim()}</code>{row.branchTarget !== undefined && <button type="button" aria-label={`Follow branch target ${formatAddress(row.branchTarget)}`} onClick={() => request(row.branchTarget)}>→ {formatAddress(row.branchTarget)}</button>}</span><span role="cell" title="Documented static range; page crossing and branch outcome determine the exact value">est. {cycleEstimate}</span><span role="cell">{stats ? `${stats.count} × · ${stats.cycles} cyc` : 'not captured'}</span></div>
        {mixed && source && <button type="button" className="mixed-source-row" onClick={() => onNavigateSource(source.fileId, source.line)}><span>{source.fileName}:{source.line}</span><code>{source.text || ' '}</code><small>{staleFiles.includes(source.fileName) ? 'pinned · editor differs' : 'pinned build source'}</small></button>}
      </div>;
    }) ?? <div className="honest-empty">Decode a live range to inspect actual mapped machine bytes.</div>}</div>
    <p className="disassembly-status" aria-live="polite">{message}</p><p className="honest-note">Bytes and decode come from the live jsbeeb CPU mapping. Source is pinned to the loaded artifact. “Captured” counts only records retained by the opt-in hardware trace; it is not presented as lifetime profiling.</p>
  </div>;
}

function TraceAccessibleTable({ records, bookmarks, onBookmark, onDisassemble }: { records: MachineBridgeSnapshot['hardwareTrace']['records']; bookmarks: Set<number>; onBookmark: (sequence: number) => void; onDisassemble: (address: number) => void }) {
  return <div className="trace-table-scroll"><table className="trace-accessible-table"><caption>Recorded hardware instructions, newest first</caption><thead><tr><th scope="col">Mark</th><th scope="col">Sequence</th><th scope="col">PC</th><th scope="col">Instruction</th><th scope="col">Cycles</th><th scope="col">Source</th><th scope="col">Bus / changes</th></tr></thead><tbody>{records.map((record) => <tr key={record.sequence}><td><button type="button" aria-label={`${bookmarks.has(record.sequence) ? 'Remove bookmark from' : 'Bookmark'} trace record ${record.sequence}`} onClick={() => onBookmark(record.sequence)}>{bookmarks.has(record.sequence) ? '★' : '☆'}</button></td><td><code>#{record.sequence}</code></td><td><button type="button" onClick={() => onDisassemble(record.pc)}>{formatAddress(record.pc)}</button></td><td><code>{record.instruction.bytes.map(formatByte).join(' ')}</code> <strong>{record.instruction.opcodeSpec}</strong></td><td>{record.cycles}</td><td>{record.source ? `${record.source.fileName}:${record.source.line}` : record.symbol ?? 'runtime'}</td><td>{record.accesses.length} bus · {record.changed.join(' ').toUpperCase() || 'no register'} Δ{record.droppedAccesses ? ` · ${record.droppedAccesses} dropped` : ''}</td></tr>)}</tbody></table></div>;
}

function HardwareTracePanel({ state, onMachineCommand }: { state: MachineBridgeSnapshot; onMachineCommand: (message: Record<string, unknown>) => void }) {
  const trace = state.hardwareTrace;
  const [capacity, setCapacity] = useState('256');
  const [sampleEvery, setSampleEvery] = useState('1');
  const [captureBus, setCaptureBus] = useState(true);
  const [eventKinds, setEventKinds] = useState<Array<'instruction' | 'memory-read' | 'memory-write' | 'interrupt'>>(['instruction']);
  const [addressStart, setAddressStart] = useState('');
  const [addressEnd, setAddressEnd] = useState('');
  const [opcode, setOpcode] = useState('');
  const [pauseOnMatch, setPauseOnMatch] = useState(false);
  const [triggerKind, setTriggerKind] = useState<'' | 'address' | 'opcode' | 'memory-read' | 'memory-write' | 'interrupt'>('');
  const [triggerValue, setTriggerValue] = useState('&2000');
  const [preTriggerRecords, setPreTriggerRecords] = useState('16');
  const [postTriggerRecords, setPostTriggerRecords] = useState('16');
  const [pauseOnTrigger, setPauseOnTrigger] = useState(true);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [bookmarks, setBookmarks] = useState<Set<number>>(() => new Set());
  const [displayMode, setDisplayMode] = useState<'details' | 'table'>('details');
  const [contentMode, setContentMode] = useState<'instructions' | 'events'>('instructions');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const records = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return trace.records.filter((record) => !needle || [record.sequence, formatAddress(record.pc), record.instruction.mnemonic, record.instruction.opcodeSpec, record.symbol, record.source?.fileName, record.source?.line, record.trigger, record.accesses.map((access) => `${access.type} ${formatAddress(access.address)} ${formatByte(access.value)}`).join(' ')].join(' ').toLowerCase().includes(needle));
  }, [query, trace.records]);
  const summary = useMemo(() => {
    const mnemonics = new Map<string, number>(); let cycles = 0; let accesses = 0;
    trace.records.forEach((record) => { mnemonics.set(record.instruction.mnemonic, (mnemonics.get(record.instruction.mnemonic) ?? 0) + 1); cycles += record.cycles; accesses += record.accesses.length; });
    const hottest = Array.from(mnemonics).sort((a, b) => b[1] - a[1])[0];
    return { cycles, accesses, hottest: hottest ? `${hottest[0]} × ${hottest[1]}` : 'none' };
  }, [trace.records]);
  const timelineEvents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return trace.events.filter((event) => !needle || [event.sequence, event.kind, formatAddress(event.pc), event.detail, event.symbol, event.source?.fileName, event.source?.line, event.pcMapping.region, event.pcMapping.bank, event.address === undefined ? '' : formatAddress(event.address), event.addressMapping?.region, event.addressMapping?.bank].join(' ').toLowerCase().includes(needle));
  }, [query, trace.events]);
  const start = () => {
    const parsedCapacity = Number(capacity);
    const parsedSampleEvery = Number(sampleEvery);
    const startAddress = addressStart.trim() ? parseHexAddress(addressStart) : undefined;
    const endAddress = addressEnd.trim() ? parseHexAddress(addressEnd) : undefined;
    const opcodeValue = opcode.trim() ? parseHexAddress(opcode) : undefined;
    const parsedTriggerValue = triggerKind && triggerKind !== 'interrupt' ? parseHexAddress(triggerValue) : undefined;
    const parsedPre = Number(preTriggerRecords); const parsedPost = Number(postTriggerRecords);
    if (!Number.isInteger(parsedCapacity) || parsedCapacity < 64 || parsedCapacity > 4096) { setError('Capacity must be 64–4,096 records'); return; }
    if (!Number.isInteger(parsedSampleEvery) || parsedSampleEvery < 1 || parsedSampleEvery > 1024) { setError('Sampling interval must be 1–1,024 instructions'); return; }
    if (triggerKind && parsedSampleEvery !== 1) { setError('Independent triggers require every instruction to be sampled'); return; }
    if ((triggerKind === 'memory-read' || triggerKind === 'memory-write') && !captureBus) { setError('Memory triggers require data-bus capture'); return; }
    if (!eventKinds.length) { setError('Select at least one unified event kind'); return; }
    if (eventKinds.some((kind) => kind === 'memory-read' || kind === 'memory-write') && !captureBus) { setError('Memory event filters require data-bus capture'); return; }
    if ((startAddress === undefined) !== (endAddress === undefined) || startAddress === null || endAddress === null) { setError('Address filtering requires valid start and end values'); return; }
    if (startAddress !== undefined && endAddress !== undefined && startAddress > endAddress) { setError('Address start must not exceed end'); return; }
    if (opcodeValue === null || (opcodeValue !== undefined && opcodeValue > 0xff)) { setError('Opcode must be one byte from &00 to &FF'); return; }
    if (triggerKind && triggerKind !== 'interrupt' && (parsedTriggerValue === null || parsedTriggerValue === undefined || parsedTriggerValue > (triggerKind === 'opcode' ? 0xff : 0xffff))) { setError(`${triggerKind === 'opcode' ? 'Opcode' : 'Address'} trigger value is invalid`); return; }
    if (!Number.isInteger(parsedPre) || !Number.isInteger(parsedPost) || parsedPre < 0 || parsedPost < 0 || (triggerKind && parsedPre + parsedPost + 1 > parsedCapacity)) { setError('Pre + trigger + post records must fit inside the ring capacity'); return; }
    setError('');
    onMachineCommand({ type: 'trace-config', enabled: true, capacity: parsedCapacity, sampleEvery: parsedSampleEvery, captureBus, eventKinds, ...(startAddress === undefined ? {} : { addressStart: startAddress, addressEnd: endAddress }), ...(opcodeValue === undefined ? {} : { opcode: opcodeValue }), pauseOnMatch, ...(triggerKind ? { triggerKind, ...(triggerKind === 'interrupt' ? {} : { triggerValue: parsedTriggerValue }), preTriggerRecords: parsedPre, postTriggerRecords: parsedPost, pauseOnTrigger } : {}) });
  };
  const exportTrace = (format: 'json' | 'text') => {
    const marked = trace.records.map((record) => ({ ...record, bookmarked: bookmarks.has(record.sequence) }));
    const content = format === 'json' ? JSON.stringify({ schema: '8bit-net.hardware-trace', version: 2, exportedAt: new Date().toISOString(), cpu: state.cpuCore, config: trace.config, droppedRecords: trace.droppedRecords, droppedEvents: trace.eventDropped, records: marked, events: trace.events }, null, 2) : [...marked.map((record) => `I#${record.sequence} C${record.cycle}+${record.cycles} ${record.cpu} ${formatAddress(record.pc)} [${record.bank}] ${record.instruction.bytes.map(formatByte).join(' ')} ${record.instruction.opcodeSpec}${record.instruction.effectiveAddress === undefined ? '' : ` EA=${formatAddress(record.instruction.effectiveAddress)}`}${record.changed.length ? ` Δ=${record.changed.map((name) => `${name.toUpperCase()}:${name === 'pc' ? formatAddress(record.before[name]) : formatByte(record.before[name])}->${name === 'pc' ? formatAddress(record.after[name]) : formatByte(record.after[name])}`).join(',')}` : ''}${record.source ? ` ${record.source.fileName}:${record.source.line}` : ''}${bookmarks.has(record.sequence) ? ' ★' : ''}`), '', ...trace.events.map((event) => `E#${event.sequence} C${event.cycle} ${event.cpu} ${event.kind} PC=${formatAddress(event.pc)} [${event.pcMapping.region}${event.pcMapping.bank === undefined ? '' : ` bank ${event.pcMapping.bank}`}] ${event.detail}`)].join('\n');
    downloadBlob(new Blob([content], { type: format === 'json' ? 'application/json' : 'text/plain' }), safeFilename(`hardware-trace.${format === 'json' ? 'json' : 'txt'}`));
  };
  const orderedRecords = records.slice().reverse();
  const pageCount = Math.max(1, Math.ceil(orderedRecords.length / pageSize));
  const visiblePage = Math.min(page, pageCount);
  const shown = displayMode === 'details' ? orderedRecords.slice(0, 200) : orderedRecords.slice((visiblePage - 1) * pageSize, visiblePage * pageSize);
  return <>
    <h3>Hardware instruction trace <small>{trace.enabled ? 'recording · high overhead' : `${trace.retained} retained`}</small></h3>
    <div className="trace-controls" aria-label="Hardware trace controls">
      <label><span>Ring records</span><select aria-label="Trace ring capacity" value={capacity} disabled={trace.enabled} onChange={(event) => setCapacity(event.target.value)}>{[64, 128, 256, 512, 1024, 2048, 4096].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label><span>Sample every</span><select aria-label="Trace sampling interval" value={sampleEvery} disabled={trace.enabled} onChange={(event) => setSampleEvery(event.target.value)}>{[1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024].map((value) => <option value={value} key={value}>{value === 1 ? 'Every instruction' : `${value} instructions`}</option>)}</select></label>
      <label><span>Address start</span><input aria-label="Trace address start" value={addressStart} disabled={trace.enabled} onChange={(event) => setAddressStart(event.target.value)} placeholder="all" /></label>
      <label><span>Address end</span><input aria-label="Trace address end" value={addressEnd} disabled={trace.enabled} onChange={(event) => setAddressEnd(event.target.value)} placeholder="all" /></label>
      <label><span>Opcode</span><input aria-label="Trace opcode filter" value={opcode} disabled={trace.enabled} onChange={(event) => setOpcode(event.target.value)} placeholder="all" /></label>
      <label className="trace-check"><input type="checkbox" checked={pauseOnMatch} disabled={trace.enabled} onChange={(event) => setPauseOnMatch(event.target.checked)} /><span>Pause after match</span></label>
      <label className="trace-check"><input type="checkbox" checked={captureBus} disabled={trace.enabled} onChange={(event) => setCaptureBus(event.target.checked)} /><span>Capture data-bus events</span></label>
      <button type="button" onClick={trace.enabled ? () => onMachineCommand({ type: 'trace-config', enabled: false, capacity: trace.config.capacity }) : start}>{trace.enabled ? 'Stop capture' : 'Start capture'}</button>
      <button type="button" disabled={trace.enabled || !trace.retained} onClick={() => { onMachineCommand({ type: 'trace-clear' }); setBookmarks(new Set()); }}>Clear</button>
    </div>
    <fieldset className="trace-event-filters" disabled={trace.enabled}><legend>Unified timeline events</legend>{(['instruction', 'memory-read', 'memory-write', 'interrupt'] as const).map((kind) => <label key={kind}><input type="checkbox" checked={eventKinds.includes(kind)} onChange={(event) => setEventKinds((current) => event.target.checked ? [...current, kind] : current.filter((item) => item !== kind))} /><span>{kind.replace('-', ' ')}</span></label>)}<small>Memory events require data-bus capture. Filters affect the bounded unified timeline; instruction records remain available for decoding and triggers.</small></fieldset>
    <div className="trace-trigger-controls" aria-label="Hardware trace trigger controls"><label><span>Independent trigger</span><select aria-label="Trace trigger kind" value={triggerKind} disabled={trace.enabled} onChange={(event) => setTriggerKind(event.target.value as typeof triggerKind)}><option value="">None</option><option value="address">Instruction address</option><option value="opcode">Opcode</option><option value="memory-read">Memory read</option><option value="memory-write">Memory write</option><option value="interrupt">IRQ/NMI transition</option></select></label><label><span>Trigger value</span><input aria-label="Trace trigger value" value={triggerValue} disabled={trace.enabled || !triggerKind || triggerKind === 'interrupt'} onChange={(event) => setTriggerValue(event.target.value)} /></label><label><span>Pre records</span><input aria-label="Trace pre-trigger records" type="number" min="0" value={preTriggerRecords} disabled={trace.enabled || !triggerKind} onChange={(event) => setPreTriggerRecords(event.target.value)} /></label><label><span>Post records</span><input aria-label="Trace post-trigger records" type="number" min="0" value={postTriggerRecords} disabled={trace.enabled || !triggerKind} onChange={(event) => setPostTriggerRecords(event.target.value)} /></label><label className="trace-check"><input type="checkbox" checked={pauseOnTrigger} disabled={trace.enabled || !triggerKind} onChange={(event) => setPauseOnTrigger(event.target.checked)} /><span>Pause at window boundary</span></label></div>
    {error && <div className="trace-error" role="alert">{error}</div>}
    <div className={`trace-overhead ${trace.enabled ? 'active' : ''}`}><strong>{trace.enabled ? 'Timing-affecting trace active' : 'Fast path active'}</strong><span>{trace.overhead}</span><small>{trace.droppedRecords.toLocaleString()} overwritten · {trace.skippedBySampling.toLocaleString()} deliberately skipped by 1:{trace.config.sampleEvery} sampling · {trace.discardedByTrigger.toLocaleString()} trimmed outside trigger window{trace.triggeredSequence === undefined ? '' : ` · trigger #${trace.triggeredSequence}${trace.triggerComplete ? ' complete' : ` · ${trace.postRemaining ?? 0} post remaining`}`} · running snapshots expose latest 256</small></div>
    <div className="trace-tools"><input type="search" aria-label="Search hardware trace" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search PC, opcode, symbol, source, mapping or event" /><span>{contentMode === 'instructions' ? `${records.length.toLocaleString()} instruction matches · ${summary.cycles.toLocaleString()} retained cycles · ${summary.accesses.toLocaleString()} retained bus events · hot ${summary.hottest}` : `${timelineEvents.length.toLocaleString()} unified events · ${trace.eventDropped.toLocaleString()} overwritten`}</span><button type="button" aria-pressed={contentMode === 'events'} onClick={() => setContentMode(contentMode === 'instructions' ? 'events' : 'instructions')}>{contentMode === 'instructions' ? 'Unified events' : 'Instructions'}</button><button type="button" disabled={contentMode === 'events'} aria-pressed={displayMode === 'table'} onClick={() => { setDisplayMode(displayMode === 'details' ? 'table' : 'details'); setPage(1); }}>{displayMode === 'details' ? 'Paged table' : 'Detail list'}</button><button type="button" disabled={trace.enabled || !trace.records.length} onClick={() => exportTrace('json')}>Export JSON</button><button type="button" disabled={trace.enabled || !trace.records.length} onClick={() => exportTrace('text')}>Export text</button></div>
    {contentMode === 'events' && <div className="trace-event-table" role="table" aria-label="Unified hardware trace events"><div className="trace-event-head" role="row"><span>Event</span><span>Cycle</span><span>PC / mapping</span><span>Detail</span><span>Source / instruction</span></div>{timelineEvents.slice().reverse().map((event) => <div className={`trace-event trace-event-${event.kind}`} role="row" key={event.sequence}><strong role="cell">{event.kind}</strong><code role="cell">{event.cycle.toLocaleString()}</code><span role="cell"><button type="button" onClick={() => onMachineCommand({ type: 'read-disassembly', address: event.pc, instructionCount: 24, requestId: `trace-event-${event.sequence}-${Date.now()}` })}>{formatAddress(event.pc)}</button><small>{event.pcMapping.region}{event.pcMapping.bank === undefined ? '' : ` · bank ${event.pcMapping.bank}`} · {event.pcMapping.source}</small></span><span role="cell">{event.detail}{event.addressMapping && <small>{event.addressMapping.region}{event.addressMapping.bank === undefined ? '' : ` · bank ${event.addressMapping.bank}`} · {event.addressMapping.writable ? 'writable' : 'read-only'}</small>}</span><span role="cell">{event.source ? `${event.source.fileName}:${event.source.line}` : event.symbol ?? 'runtime'} · instruction #{event.instructionSequence}</span></div>)}{!timelineEvents.length && <div className="honest-empty">No selected unified events are retained. Choose event filters before starting capture.</div>}</div>}
    <div hidden={contentMode === 'events'} className="hardware-trace-list" role={displayMode === 'details' ? 'log' : undefined} aria-label="Recorded hardware instruction trace">{displayMode === 'table' ? <TraceAccessibleTable records={shown} bookmarks={bookmarks} onBookmark={(sequence) => setBookmarks((current) => { const next = new Set(current); if (next.has(sequence)) next.delete(sequence); else next.add(sequence); return next; })} onDisassemble={(address) => onMachineCommand({ type: 'read-disassembly', address, instructionCount: 24, requestId: `trace-table-${address}-${Date.now()}` })} /> : shown.length ? shown.map((record) => <details key={record.sequence} className={`${bookmarks.has(record.sequence) ? 'bookmarked ' : ''}${record.trigger ? 'trigger-record' : ''}`.trim()}><summary><button type="button" aria-label={`${bookmarks.has(record.sequence) ? 'Remove bookmark from' : 'Bookmark'} trace record ${record.sequence}`} onClick={(event) => { event.preventDefault(); setBookmarks((current) => { const next = new Set(current); if (next.has(record.sequence)) next.delete(record.sequence); else next.add(record.sequence); return next; }); }}>{bookmarks.has(record.sequence) ? '★' : '☆'}</button><code>#{record.sequence}</code><strong>{formatAddress(record.pc)}</strong><span>{record.instruction.bytes.map(formatByte).join(' ')}</span><b>{record.instruction.opcodeSpec}</b><small>{record.trigger ? `TRIGGER · ${record.trigger}` : `${record.cycles} cyc${record.source ? ` · ${record.source.fileName}:${record.source.line}` : record.symbol ? ` · ${record.symbol}` : ''}`}</small></summary><div><span>Cycle {record.cycle.toLocaleString()} · {record.cpu} · {record.bank} · {record.mapping.source}</span><span>EA {record.instruction.effectiveAddress === undefined ? 'n/a' : formatAddress(record.instruction.effectiveAddress)} · flags Δ {record.flagsChanged.join(' ') || 'none'} · registers Δ {record.changed.join(' ').toUpperCase() || 'none'}</span><span>{record.accesses.length ? record.accesses.map((access) => `${access.type.toUpperCase()} ${formatAddress(access.address)}=&${formatByte(access.value)} [${access.mapping.region}${access.mapping.bank === undefined ? '' : ` bank ${access.mapping.bank}`}]${access.previousValue === undefined ? '' : ` (was &${formatByte(access.previousValue)})`}`).join(' · ') : 'No data-bus access captured'}{record.droppedAccesses ? ` · ${record.droppedAccesses} access events dropped` : ''}</span><span>IRQ {record.interruptBefore.irqAccepted ? 'pending' : 'clear'}→{record.interruptAfter.irqAccepted ? 'pending' : 'clear'} · NMI {record.interruptBefore.nmiEdge ? 'latched' : 'clear'}→{record.interruptAfter.nmiEdge ? 'latched' : 'clear'}</span></div></details>) : <div className="honest-empty">{trace.enabled ? 'Recording; matching completed instructions will appear here.' : 'Start capture to record real hardware instructions. Normal emulation has no trace-hook overhead while stopped.'}</div>}{displayMode === 'details' && records.length > shown.length && <div className="trace-display-limit">Showing latest {shown.length} of {records.length.toLocaleString()} matches; export contains the complete stopped buffer.</div>}</div>
    {contentMode === 'instructions' && displayMode === 'table' && <nav className="trace-pagination" aria-label="Trace result pages"><label>Rows <select aria-label="Trace rows per page" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option>25</option><option>50</option><option>100</option></select></label><button type="button" disabled={visiblePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous page</button><span aria-live="polite">Page {visiblePage} of {pageCount} · {records.length.toLocaleString()} records</span><button type="button" disabled={visiblePage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next page</button></nav>}
  </>;
}

function InterruptHistoryPanel({ state, onMachineCommand }: { state: MachineBridgeSnapshot; onMachineCommand: (message: Record<string, unknown>) => void }) {
  const monitor = state.interruptMonitor;
  const [capacity, setCapacity] = useState('128');
  const activeSources = state.interruptSources.filter((source) => source.pending || source.enabled);
  return <div className="interrupt-history-panel">
    <div className="interrupt-monitor-controls"><label><span>History events</span><select aria-label="Interrupt history capacity" value={capacity} disabled={monitor.enabled} onChange={(event) => setCapacity(event.target.value)}>{[32, 64, 128, 256, 512, 1024].map((value) => <option key={value}>{value}</option>)}</select></label><button type="button" onClick={() => onMachineCommand({ type: 'interrupt-monitor', enabled: !monitor.enabled, capacity: Number(capacity) })}>{monitor.enabled ? 'Stop IRQ monitor' : 'Start IRQ monitor'}</button><button type="button" disabled={!monitor.retained} onClick={() => onMachineCommand({ type: 'interrupt-history-clear' })}>Clear</button></div>
    <div className={`interrupt-monitor-overhead ${monitor.enabled ? 'active' : ''}`}><strong>{monitor.enabled ? 'Instruction-boundary monitor active' : 'Fast path active'}</strong><span>{monitor.overhead}</span><small>{monitor.retained} / {monitor.capacity} events · handler depth {monitor.handlerDepth}</small></div>
    <div className="interrupt-source-list" aria-label="Authoritative interrupt sources">{activeSources.length ? activeSources.map((source) => <div className={source.pending ? 'pending' : ''} key={source.id}><strong>{source.label}</strong><span>{source.pending ? 'pending' : 'clear'} · {source.enabled ? 'enabled' : 'masked'}</span><small>{source.source}</small></div>) : <div className="honest-empty">No named peripheral source is enabled or pending in this snapshot.</div>}</div>
    <div className="interrupt-event-list" role="log" aria-label="Interrupt event history">{monitor.events.length ? monitor.events.slice().reverse().map((event) => <div className={`interrupt-event event-${event.kind}`} key={event.sequence}><code>#{event.sequence}</code><strong>{event.kind.replace('-', ' ')}</strong><span>{event.detail}</span><div><button type="button" onClick={() => onMachineCommand({ type: 'read-disassembly', address: event.pc, instructionCount: 24, requestId: `interrupt-disassembly-${event.pc}-${Date.now()}` })}>Disasm {formatAddress(event.pc)}</button><button type="button" onClick={() => onMachineCommand({ type: 'read-memory', address: event.pc, length: Math.min(128, 0x10000 - event.pc), addressSpace: 'mapped', requestId: `interrupt-memory-${event.pc}-${Date.now()}` })}>Memory</button></div><small>cycle {event.cycle.toLocaleString()} · t+{event.timeMs.toFixed(1)} ms{event.traceSequence === undefined ? '' : ` · trace #${event.traceSequence}`} · {event.sources.filter((source) => source.pending).map((source) => source.label).join(', ') || 'no named pending source'}</small></div>) : <div className="honest-empty">Start the monitor to retain genuine IRQ/NMI line, acceptance, handler-entry and RTI events. No history is fabricated while it is off.</div>}</div>
  </div>;
}

function InstructionEffects({ state }: { state: MachineBridgeSnapshot }) {
  const detail = state.instructionDetails;
  const step = state.lastStep;
  const registerValue = (name: keyof MachineBridgeSnapshot['registers'], value: number) => name === 'pc' ? formatAddress(value) : `&${formatByte(value)}`;
  return <>
    <h3>Decoded operand <small>{state.cpuCore}</small></h3>
    <div className="instruction-effects" aria-label="Current decoded instruction effects">
      <div><span>Opcode</span><strong>&amp;{formatByte(detail.opcode)} · {detail.mnemonic}</strong></div>
      <div><span>Addressing</span><strong>{detail.addressingMode}</strong></div>
      <div><span>Effective address</span><strong>{detail.effectiveAddress === undefined ? 'not applicable' : formatAddress(detail.effectiveAddress)}</strong></div>
      <div><span>Operand value</span><strong>{detail.operandValue === undefined ? 'not available' : `&${formatByte(detail.operandValue)}`}</strong></div>
      <div><span>Pointer / branch</span><strong>{detail.pointerAddress === undefined ? '—' : `ptr ${formatAddress(detail.pointerAddress)}`}{detail.pointerAddress !== undefined && detail.branchTarget !== undefined ? ' · ' : ''}{detail.branchTarget === undefined ? '' : `target ${formatAddress(detail.branchTarget)}`}</strong></div>
      <div><span>Page crossing</span><strong>{detail.pageCrossed ? 'yes' : 'no'}</strong></div>
    </div>
    <h3>Last exact step <small>step-in only</small></h3>
    {step ? <div className="last-step-effects" aria-label="Last hardware step effects"><div><span>Instruction</span><strong>{step.instruction.mnemonic} at {formatAddress(step.before.pc)}</strong></div><div><span>Actual cycles</span><strong>{step.cycles.toLocaleString()}</strong></div><div><span>Register changes</span><strong>{step.changed.length ? step.changed.map((name) => `${name.toUpperCase()} ${registerValue(name, step.before[name])}→${registerValue(name, step.after[name])}`).join(' · ') : 'none'}</strong></div><div><span>Flag changes</span><strong>{step.flagsChanged.length ? step.flagsChanged.join(' ') : 'none'}</strong></div><div><span>IRQ/NMI transition</span><strong>IRQ {step.interruptBefore.irqAccepted ? 'pending' : 'clear'}→{step.interruptAfter.irqAccepted ? 'pending' : 'clear'} · NMI {step.interruptBefore.nmiEdge ? 'latched' : 'clear'}→{step.interruptAfter.nmiEdge ? 'latched' : 'clear'}</strong></div></div> : <div className="honest-empty instruction-effects-empty">No exact step-in has completed in this loaded session.</div>}
  </>;
}

function HardwareWatchpointPanel({ state, inspection, onMachineCommand }: { state: MachineBridgeSnapshot; inspection: HardwareInspection | null; onMachineCommand: (message: Record<string, unknown>) => void }) {
  const [view, setView] = useState<'watchpoints' | 'registers' | 'inspectors' | 'raster' | 'profiler'>('watchpoints');
  const [addressText, setAddressText] = useState('&2000');
  const [access, setAccess] = useState<'read' | 'write' | 'change'>('change');
  const [operator, setOperator] = useState<'' | 'eq' | 'ne'>('');
  const [valueText, setValueText] = useState('&41');
  const [error, setError] = useState('');
  const add = () => {
    const address = parseHexAddress(addressText);
    const value = operator ? parseHexAddress(valueText) : null;
    if (address === null || address >= 0x8000) { setError('Address must be mapped main RAM from &0000 to &7FFF'); return; }
    if (operator && (value === null || value > 0xff)) { setError('Condition value must be one byte from &00 to &FF'); return; }
    setError('');
    onMachineCommand({ type: 'watchpoint', address, access, enabled: true, ...(operator ? { condition: { operator, value } } : {}) });
  };
  return <section className={`watchpoint-panel ${view === 'raster' ? 'raster-open' : view === 'profiler' ? 'profiler-open' : ''}`} aria-label="Hardware state editor">
    <div className="watchpoint-heading"><div className="hardware-state-tabs" role="tablist" aria-label="Hardware state tools"><button type="button" role="tab" aria-selected={view === 'watchpoints'} onClick={() => setView('watchpoints')}>Data watchpoints</button><button type="button" role="tab" aria-selected={view === 'registers'} onClick={() => setView('registers')}>Register editor</button><button type="button" role="tab" aria-selected={view === 'inspectors'} onClick={() => { setView('inspectors'); if (!inspection) onMachineCommand({ type: 'inspect-hardware' }); }}>Hardware inspectors</button><button type="button" role="tab" aria-selected={view === 'raster'} onClick={() => setView('raster')}>Raster timeline</button><button type="button" role="tab" aria-selected={view === 'profiler'} onClick={() => setView('profiler')}>Profiler</button></div><small>{view === 'watchpoints' ? 'Exact jsbeeb bus hooks · mapped 6502 main RAM · width 1 byte' : view === 'registers' ? 'Paused-only jsbeeb CPU transaction · emulator read-back' : view === 'inspectors' ? 'Explicit side-effect-free peripheral snapshots · values are not inferred' : view === 'raster' ? state.rasterMonitor.source : state.profiler.source}</small><strong>{view === 'watchpoints' ? `${state.watchpoints.length} / 16` : view === 'registers' ? `${state.registerEdits.length} edits` : view === 'inspectors' ? inspection ? `${inspection.groups.length} devices` : 'not sampled' : view === 'raster' ? `${state.rasterMonitor.retained} events` : `${state.profiler.instructions.toLocaleString()} instructions`}</strong></div>
    {view === 'watchpoints' ? <div className="watchpoint-body">
      <div className="watchpoint-editor"><label><span>Address</span><input aria-label="Watchpoint address" value={addressText} onChange={(event) => setAddressText(event.target.value)} /></label><label><span>Access</span><select aria-label="Watchpoint access type" value={access} onChange={(event) => setAccess(event.target.value as 'read' | 'write' | 'change')}><option value="change">Value changes</option><option value="write">Any write</option><option value="read">Any read</option></select></label><label><span>Condition</span><select aria-label="Watchpoint condition" value={operator} onChange={(event) => setOperator(event.target.value as '' | 'eq' | 'ne')}><option value="">Always</option><option value="eq">Byte equals</option><option value="ne">Byte differs</option></select></label><label><span>Byte</span><input aria-label="Watchpoint condition value" disabled={!operator} value={valueText} onChange={(event) => setValueText(event.target.value)} /></label><button type="button" disabled={state.running || state.watchpoints.length >= 16} onClick={add}>Add watchpoint</button>{error && <div className="watchpoint-error" role="alert">{error}</div>}</div>
      <div className="watchpoint-list" aria-label="Installed data watchpoints">{state.watchpoints.length ? state.watchpoints.map((item) => <button type="button" aria-label={`Remove ${item.access} watchpoint ${formatAddress(item.address)}`} key={`${item.access}-${item.address}`} onClick={() => onMachineCommand({ type: 'watchpoint', address: item.address, access: item.access, enabled: false })}><strong>{formatAddress(item.address)}</strong><span>{item.access} · width {item.width}{item.condition ? ` · byte ${item.condition.operator === 'eq' ? '=' : '≠'} &${formatByte(item.condition.value)}` : ''}</span><small>{item.hits} access{item.hits === 1 ? '' : 'es'}{item.lastValue === undefined ? '' : ` · last &${formatByte(item.lastValue)}`} · remove ×</small></button>) : <div className="honest-empty">No data watchpoints installed.</div>}</div>
      <div className="watchpoint-events" role="log" aria-label="Watchpoint event log">{state.watchpointEvents.length ? state.watchpointEvents.slice().reverse().map((event) => <div key={event.sequence}><code>#{event.sequence}</code><strong>{formatAddress(event.address)}</strong><span>{event.access} at PC {formatAddress(event.pc)}</span><small>{event.previousValue === undefined ? `read &${formatByte(event.value)}` : `&${formatByte(event.previousValue)} → &${formatByte(event.value)}`}</small></div>) : <div className="honest-empty">No watched memory access has paused this session.</div>}</div>
    </div> : view === 'registers' ? <HardwareRegisterEditor state={state} onMachineCommand={onMachineCommand} /> : view === 'inspectors' ? <HardwareInspectorPanel inspection={inspection} onRefresh={() => onMachineCommand({ type: 'inspect-hardware' })} /> : view === 'raster' ? <RasterTimelinePanel state={state} onMachineCommand={onMachineCommand} /> : <PerformanceProfilerPanel state={state} onMachineCommand={onMachineCommand} />}
  </section>;
}

function HardwareInspectorPanel({ inspection, onRefresh }: { inspection: HardwareInspection | null; onRefresh: () => void }) {
  const [selectedGroup, setSelectedGroup] = useState('video-timing');
  useEffect(() => { if (inspection && !inspection.groups.some((group) => group.id === selectedGroup)) setSelectedGroup(inspection.groups[0]?.id ?? ''); }, [inspection, selectedGroup]);
  const group = inspection?.groups.find((item) => item.id === selectedGroup) ?? inspection?.groups[0];
  return <div className="hardware-inspector-body">
    <div className="hardware-inspector-nav"><button type="button" className="hardware-refresh" onClick={onRefresh}>Refresh live state</button>{inspection?.groups.map((item) => <button type="button" className={item.id === group?.id ? 'selected' : ''} aria-pressed={item.id === group?.id} key={item.id} onClick={() => setSelectedGroup(item.id)}><strong>{item.label}</strong><small>{item.registers.filter((register) => register.changed).length} changed</small></button>)}</div>
    {!inspection || !group ? <div className="honest-empty hardware-inspector-empty">Choose Refresh live state to capture authoritative peripheral latches and counters. Mapped I/O is never read.</div> : <><div className="hardware-inspector-table" role="table" aria-label={`${group.label} hardware registers`}><div className="hardware-inspector-head" role="row"><span>Name</span><span>Address</span><span>Current</span><span>Previous</span><span>Access</span><span>Bitfields</span></div>{group.registers.map((register) => <div className={register.changed ? 'hardware-register changed' : 'hardware-register'} role="row" key={register.id}><strong role="cell">{register.name}</strong><code role="cell">{register.address}</code><code role="cell">{formatHardwareValue(register.value, register.width)}</code><code role="cell">{register.previousValue === undefined ? '—' : formatHardwareValue(register.previousValue, register.width)}</code><span role="cell">{register.access}</span><span role="cell" className="hardware-bitfields">{register.bitfields.length ? register.bitfields.map((bit) => <small className={bit.active ? 'active' : ''} key={bit.label}>{bit.label}={bit.value}</small>) : '—'}</span></div>)}</div><aside className="hardware-inspector-source"><strong>{group.label}</strong><span>{group.source}</span><small>sample #{inspection.sequence} · {inspection.profile} profile · cycle {inspection.cycles.toLocaleString()}</small><p>Previous means the preceding explicit inspector sample. Highlighting does not poll the machine or alter interrupt, timer, data, palette, or selected-register state.</p></aside></>}
  </div>;
}

function RasterTimelinePanel({ state, onMachineCommand }: { state: MachineBridgeSnapshot; onMachineCommand: (message: Record<string, unknown>) => void }) {
  const monitor = state.rasterMonitor;
  const [capacity, setCapacity] = useState('256');
  const [recordHSync, setRecordHSync] = useState(false);
  const [sampleEvery, setSampleEvery] = useState('16');
  const [breakEvent, setBreakEvent] = useState('');
  const [breakX, setBreakX] = useState('');
  const [breakY, setBreakY] = useState('');
  const [error, setError] = useState('');
  const start = () => {
    const parsedCapacity = Number(capacity); const parsedSample = Number(sampleEvery);
    const x = breakX.trim() ? Number(breakX) : undefined; const y = breakY.trim() ? Number(breakY) : undefined;
    if (!Number.isInteger(parsedCapacity) || parsedCapacity < 64 || parsedCapacity > 4096) { setError('Capacity must be 64–4,096 events'); return; }
    if (!Number.isInteger(parsedSample) || parsedSample < 0 || parsedSample > 625) { setError('Scanline interval must be 0–625'); return; }
    if (y !== undefined && (!Number.isInteger(y) || y < -1 || y > 624)) { setError('Break Y must be -1–624'); return; }
    if (x !== undefined && (!Number.isInteger(x) || x < -8 || x > 1023 || x % 8 !== 0 || y === undefined)) { setError('Break X must be -8–1,023 in 8-pixel steps and requires Y'); return; }
    setError(''); onMachineCommand({ type: 'raster-monitor', enabled: true, capacity: parsedCapacity, recordHSync, sampleEveryScanlines: parsedSample, ...(breakEvent ? { breakEvent } : {}), ...(x === undefined ? {} : { breakX: x }), ...(y === undefined ? {} : { breakY: y }) });
  };
  const exportTimeline = (format: 'json' | 'text') => {
    const content = format === 'json' ? JSON.stringify({ schema: '8bit-net.raster-timeline', version: 1, exportedAt: new Date().toISOString(), source: monitor.source, config: monitor.config, droppedEvents: monitor.droppedEvents, events: monitor.events }, null, 2) : monitor.events.map((event) => `#${event.sequence} C${event.cycle} F${event.frame} ${event.x},${event.y} ${event.event} PC=${formatAddress(event.pc)} ${event.detail}`).join('\n');
    downloadBlob(new Blob([content], { type: format === 'json' ? 'application/json' : 'text/plain' }), `raster-timeline.${format === 'json' ? 'json' : 'txt'}`);
  };
  return <div className="raster-timeline-body">
    <div className="raster-controls"><label><span>Ring events</span><select aria-label="Raster event capacity" value={capacity} disabled={monitor.enabled} onChange={(event) => setCapacity(event.target.value)}>{[64, 128, 256, 512, 1024, 2048, 4096].map((value) => <option key={value}>{value}</option>)}</select></label><label><span>Sample every Y rows</span><input aria-label="Raster scanline sample interval" type="number" min="0" max="625" value={sampleEvery} disabled={monitor.enabled} onChange={(event) => setSampleEvery(event.target.value)} /></label><label><span>Break event</span><select aria-label="Raster break event" value={breakEvent} disabled={monitor.enabled} onChange={(event) => setBreakEvent(event.target.value)}><option value="">None</option><option value="frame">Frame start</option><option value="vsync-start">VSync start</option><option value="vsync-end">VSync end</option><option value="hsync-start">HSync start</option><option value="hsync-end">HSync end</option><option value="mode">Mode/control change</option><option value="palette">Palette change</option></select></label><label><span>Break X</span><input aria-label="Raster break X" value={breakX} disabled={monitor.enabled} placeholder="optional · step 8" onChange={(event) => setBreakX(event.target.value)} /></label><label><span>Break Y</span><input aria-label="Raster break Y" value={breakY} disabled={monitor.enabled} placeholder="optional" onChange={(event) => setBreakY(event.target.value)} /></label><label className="raster-check"><input type="checkbox" checked={recordHSync} disabled={monitor.enabled} onChange={(event) => setRecordHSync(event.target.checked)} /><span>Record HSync edges</span></label><button type="button" onClick={monitor.enabled ? () => onMachineCommand({ type: 'raster-monitor', enabled: false }) : start}>{monitor.enabled ? 'Stop raster capture' : 'Start raster capture'}</button><button type="button" disabled={!monitor.retained} onClick={() => onMachineCommand({ type: 'raster-timeline-clear' })}>Clear</button>{error && <div className="raster-error" role="alert">{error}</div>}</div>
    <aside className={`raster-status ${monitor.enabled ? 'active' : ''}`}><strong>{monitor.enabled ? 'Timing-affecting raster capture' : 'Fast path active'}</strong><span>{monitor.overhead}</span><small>{monitor.retained} / {monitor.config.capacity} retained · {monitor.droppedEvents} overwritten</small><p>{monitor.source}. Beam values are instruction-boundary observations; software objects are not inferred.</p><div><button type="button" disabled={monitor.enabled || !monitor.retained} onClick={() => exportTimeline('json')}>Export JSON</button><button type="button" disabled={monitor.enabled || !monitor.retained} onClick={() => exportTimeline('text')}>Export text</button></div></aside>
    <div className="raster-event-table" role="table" aria-label="Raster video timeline"><div className="raster-event-head" role="row"><span>Event</span><span>Frame</span><span>Beam</span><span>CRTC</span><span>Mode</span><span>PC / cycle</span><span>Position</span></div>{monitor.events.slice().reverse().map((event) => <div className={`raster-event raster-${event.event}`} role="row" key={event.sequence}><strong role="cell">{event.event}</strong><code role="cell">{event.frame}</code><code role="cell">{event.x},{event.y}</code><span role="cell">VC {event.verticalCounter} · HC {event.horizontalCounter} · RA {event.scanline} · MA {formatAddress(event.displayAddress)}</span><span role="cell">{event.mode} · &amp;{formatByte(event.ulaControl)}</span><span role="cell"><button type="button" onClick={() => onMachineCommand({ type: 'read-disassembly', address: event.pc, instructionCount: 24, requestId: `raster-${event.pc}-${Date.now()}` })}>{formatAddress(event.pc)}</button> · {event.cycle.toLocaleString()}</span><span role="cell" className="raster-position"><i style={{ left: `${Math.max(0, Math.min(100, event.x / 10.24))}%`, top: `${Math.max(0, Math.min(100, event.y / 6.25))}%` }} /></span></div>)}{!monitor.events.length && <div className="honest-empty">Start capture to record frame/VSync/mode/palette events and optional scanline/HSync samples from the live video core.</div>}</div>
  </div>;
}

function PerformanceProfilerPanel({ state, onMachineCommand }: { state: MachineBridgeSnapshot; onMachineCommand: (message: Record<string, unknown>) => void }) {
  const profile = state.profiler;
  const [maxAddresses, setMaxAddresses] = useState('4096');
  const [frameCapacity, setFrameCapacity] = useState('256');
  const [captureBus, setCaptureBus] = useState(false);
  const [filter, setFilter] = useState('');
  const [baseline, setBaseline] = useState<MachineBridgeSnapshot['profiler'] | null>(null);
  const [error, setError] = useState('');
  const baselineRows = new Map((baseline?.addresses ?? []).map((row) => [row.address, row]));
  const visibleRows = profile.addresses.filter((row) => !filter.trim() || `${formatAddress(row.address)} ${row.symbol ?? ''} ${row.source?.fileName ?? ''}`.toLowerCase().includes(filter.toLowerCase())).slice(0, 500);
  const start = () => {
    const addresses = Number(maxAddresses); const frames = Number(frameCapacity);
    if (!Number.isInteger(addresses) || addresses < 256 || addresses > 16384) { setError('Address capacity must be 256–16,384'); return; }
    if (!Number.isInteger(frames) || frames < 16 || frames > 1024) { setError('Frame capacity must be 16–1,024'); return; }
    setError(''); onMachineCommand({ type: 'profiler-config', enabled: true, maxAddresses: addresses, frameCapacity: frames, captureBus });
  };
  const exportProfile = (format: 'json' | 'text') => {
    const comparison = profile.addresses.map((row) => ({ ...row, cycleDelta: row.cycles - (baselineRows.get(row.address)?.cycles ?? 0), instructionDelta: row.instructions - (baselineRows.get(row.address)?.instructions ?? 0) }));
    const document = { schema: '8bit-net.performance-profile', version: 1, exportedAt: new Date().toISOString(), current: profile, baseline, comparison };
    const content = format === 'json' ? JSON.stringify(document, null, 2) : [`BUILD ${profile.buildFingerprint}`, `TOTAL ${profile.instructions} instructions · ${profile.cycles} cycles`, ...(baseline ? [`BASELINE ${baseline.buildFingerprint} · Δ ${profile.cycles - baseline.cycles} cycles`] : []), '', ...comparison.map((row) => `${formatAddress(row.address)} ${row.symbol ?? ''} ${row.instructions} calls ${row.cycles} cycles Δ${row.cycleDelta >= 0 ? '+' : ''}${row.cycleDelta}`)].join('\n');
    downloadBlob(new Blob([content], { type: format === 'json' ? 'application/json' : 'text/plain' }), `performance-profile.${format === 'json' ? 'json' : 'txt'}`);
  };
  const maximumFrameCycles = Math.max(1, ...profile.frames.map((frame) => frame.cycles));
  return <div className="profiler-body">
    <div className="profiler-controls"><label><span>Address capacity</span><select aria-label="Profiler address capacity" value={maxAddresses} disabled={profile.enabled} onChange={(event) => setMaxAddresses(event.target.value)}>{[256, 512, 1024, 2048, 4096, 8192, 16384].map((value) => <option key={value}>{value}</option>)}</select></label><label><span>Frame history</span><select aria-label="Profiler frame capacity" value={frameCapacity} disabled={profile.enabled} onChange={(event) => setFrameCapacity(event.target.value)}>{[16, 32, 64, 128, 256, 512, 1024].map((value) => <option key={value}>{value}</option>)}</select></label><label className="profiler-check"><input type="checkbox" checked={captureBus} disabled={profile.enabled} onChange={(event) => setCaptureBus(event.target.checked)} /><span>Capture all bus traffic</span></label><button type="button" onClick={profile.enabled ? () => onMachineCommand({ type: 'profiler-config', enabled: false }) : start}>{profile.enabled ? 'Stop profiler' : 'Start profiler'}</button><button type="button" disabled={profile.enabled || !profile.instructions} onClick={() => onMachineCommand({ type: 'profiler-clear' })}>Clear</button>{error && <div role="alert" className="profiler-error">{error}</div>}</div>
    <aside className={`profiler-status ${profile.enabled ? 'active' : ''}`}><strong>{profile.enabled ? 'Profiling live execution' : 'Fast path active'}</strong><span>{profile.overhead}</span><p>{profile.source}.</p><dl><div><dt>Instructions</dt><dd>{profile.instructions.toLocaleString()}</dd></div><div><dt>Exact cycles</dt><dd>{profile.cycles.toLocaleString()}</dd></div><div><dt>Average CPI</dt><dd>{profile.instructions ? (profile.cycles / profile.instructions).toFixed(2) : '—'}</dd></div><div><dt>Addresses</dt><dd>{profile.uniqueAddresses.toLocaleString()} / {profile.config.maxAddresses.toLocaleString()}</dd></div><div><dt>Untracked</dt><dd>{profile.untrackedInstructions.toLocaleString()}</dd></div></dl><small>Build {profile.buildFingerprint}</small><div><button type="button" disabled={profile.enabled || !profile.instructions} onClick={() => setBaseline(structuredClone(profile))}>Set baseline</button><button type="button" disabled={!baseline} onClick={() => setBaseline(null)}>Clear baseline</button></div>{baseline && <small className="profiler-baseline">Compared with {baseline.buildFingerprint} · cycle Δ {(profile.cycles - baseline.cycles).toLocaleString()}</small>}<div><button type="button" disabled={profile.enabled || !profile.instructions} onClick={() => exportProfile('json')}>Export JSON</button><button type="button" disabled={profile.enabled || !profile.instructions} onClick={() => exportProfile('text')}>Export text</button></div></aside>
    <div className="profiler-results"><div className="profiler-filter"><label><span>Hotspot filter</span><input aria-label="Profiler hotspot filter" value={filter} placeholder="address, symbol, or source" onChange={(event) => setFilter(event.target.value)} /></label><span>Cycles rank · {visibleRows.length} shown</span></div><div className="profiler-table" role="table" aria-label="Instruction cycle hot spots"><div className="profiler-head" role="row"><span>PC / symbol</span><span>Source</span><span>Instructions</span><span>Cycles / share</span><span>Avg · range</span><span>Δ cycles</span></div>{visibleRows.map((row) => { const base = baselineRows.get(row.address); const delta = row.cycles - (base?.cycles ?? 0); return <div className="profiler-row" role="row" key={row.address}><strong role="cell"><button type="button" onClick={() => onMachineCommand({ type: 'read-disassembly', address: row.address, instructionCount: 24, requestId: `profile-${row.address}-${Date.now()}` })}>{formatAddress(row.address)}</button>{row.symbol && <small>{row.symbol}</small>}</strong><span role="cell">{row.source ? `${row.source.fileName}:${row.source.line}` : 'runtime / ROM'}</span><code role="cell">{row.instructions.toLocaleString()}</code><span role="cell"><b>{row.cycles.toLocaleString()}</b><i style={{ width: `${profile.cycles ? Math.max(1, row.cycles / profile.cycles * 100) : 0}%` }} />{profile.cycles ? (row.cycles / profile.cycles * 100).toFixed(1) : '0.0'}%</span><code role="cell">{(row.cycles / row.instructions).toFixed(2)} · {row.minCycles}–{row.maxCycles}</code><code role="cell" className={delta > 0 ? 'worse' : delta < 0 ? 'better' : ''}>{baseline ? `${delta >= 0 ? '+' : ''}${delta.toLocaleString()}` : '—'}</code></div>})}{!visibleRows.length && <div className="honest-empty">Start profiling, run real code, then pause and stop capture to inspect complete hot spots.</div>}</div></div>
    <div className="profiler-detail"><section><h4>Opcode-proven JSR calls</h4>{profile.calls.length ? profile.calls.slice(0, 80).map((call) => <button type="button" key={call.target} onClick={() => onMachineCommand({ type: 'read-disassembly', address: call.target, instructionCount: 24, requestId: `profile-call-${call.target}-${Date.now()}` })}><strong>{call.symbol ?? formatAddress(call.target)}</strong><span>{call.count.toLocaleString()} calls</span></button>) : <div className="honest-empty">No executed JSR call sites.</div>}</section><section><h4>Frame-time timeline</h4>{profile.frames.length ? profile.frames.slice(-80).map((frame) => <div className="profiler-frame" key={frame.frame}><code>F{frame.frame}</code><i style={{ width: `${frame.cycles / maximumFrameCycles * 100}%` }} /><span>{frame.cycles.toLocaleString()}c · {frame.instructions.toLocaleString()}i</span></div>) : <div className="honest-empty">No completed video frame captured.</div>}</section><section><h4>Mapped bus events</h4><p>Reads include instruction and operand fetches.</p>{profile.bus.length ? profile.bus.map((entry) => <div className="profiler-bus" key={entry.region}><strong>{entry.region}</strong><span>{entry.reads.toLocaleString()} R · {entry.writes.toLocaleString()} W</span></div>) : <div className="honest-empty">Enable bus capture for genuine mapped read/write events.</div>}<small>Total {profile.busReads.toLocaleString()} reads · {profile.busWrites.toLocaleString()} writes</small></section></div>
  </div>;
}

const editableRegisters = ['a', 'x', 'y', 's', 'p', 'pc'] as const;

function HardwareRegisterEditor({ state, onMachineCommand }: { state: MachineBridgeSnapshot; onMachineCommand: (message: Record<string, unknown>) => void }) {
  const valuesFromState = () => Object.fromEntries(editableRegisters.map((name) => [name, name === 'pc' ? formatAddress(state.registers[name]) : `&${formatByte(state.registers[name])}`])) as Record<(typeof editableRegisters)[number], string>;
  const [values, setValues] = useState(valuesFromState);
  const [error, setError] = useState('');
  useEffect(() => { setValues(valuesFromState()); setError(''); }, [state.registers.a, state.registers.x, state.registers.y, state.registers.s, state.registers.p, state.registers.pc]);
  const apply = () => {
    const registers: Record<string, number> = {};
    for (const name of editableRegisters) {
      const value = parseHexAddress(values[name]);
      const maximum = name === 'pc' ? 0xffff : 0xff;
      if (value === null || value > maximum) { setError(`${name.toUpperCase()} must be ${name === 'pc' ? '&0000–&FFFF' : '&00–&FF'}`); return; }
      registers[name] = value;
    }
    setError('');
    onMachineCommand({ type: 'write-registers', registers });
  };
  return <div className="register-editor-body">
    <form className="register-editor" onSubmit={(event) => { event.preventDefault(); apply(); }}>
      {editableRegisters.map((name) => <label key={name}><span>{name.toUpperCase()}</span><input aria-label={`Register ${name.toUpperCase()} value`} value={values[name]} onChange={(event) => { setValues((current) => ({ ...current, [name]: event.target.value })); setError(''); }} /></label>)}
      <button type="submit" disabled={state.running}>Apply to paused CPU</button>
      <button type="button" onClick={() => { setValues(valuesFromState()); setError(''); }}>Revert fields</button>
      {error && <div className="register-editor-error" role="alert">{error}</div>}
    </form>
    <div className="register-editor-help"><strong>Live 6502 / 65C12 state</strong><p>All six values are validated and written as one sequenced transaction. P is read back from the core after its reserved flag bits are normalised; changing P also refreshes interrupt eligibility. Changing PC clears hook-resume state before the next instruction.</p><span className={state.running ? 'running' : 'paused'}>{state.running ? 'Pause to edit' : 'Ready for paused edit'}</span></div>
    <div className="register-edit-log" role="log" aria-label="Register edit history">{state.registerEdits.length ? state.registerEdits.slice().reverse().map((entry) => <div key={entry.sequence}><code>#{entry.sequence}</code><strong>{entry.changed.length ? entry.changed.map((name) => name.toUpperCase()).join(' ') : 'NO CHANGE'}</strong><span>{entry.changed.length ? entry.changed.map((name) => `${name.toUpperCase()} ${name === 'pc' ? formatAddress(entry.before[name]) : `&${formatByte(entry.before[name])}`}→${name === 'pc' ? formatAddress(entry.after[name]) : `&${formatByte(entry.after[name])}`}`).join(' · ') : 'Values already matched live CPU state'}</span></div>) : <div className="honest-empty">No register edits in this loaded debug session.</div>}</div>
  </div>;
}

function StorageQuotaPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const [quota, setQuota] = useState<{ usage: number; quota: number; persisted: boolean; details: Array<{ name: string; bytes: number }> }>();
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      if (!navigator.storage?.estimate) throw new Error('This browser does not expose the StorageManager estimate API');
      const estimate = await navigator.storage.estimate();
      const usage = Number(estimate.usage ?? 0); const maximum = Number(estimate.quota ?? 0);
      const rawDetails = (estimate as StorageEstimate & { usageDetails?: Record<string, number> }).usageDetails ?? {};
      const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      setQuota({ usage, quota: maximum, persisted, details: Object.entries(rawDetails).map(([name, bytes]) => ({ name, bytes: Number(bytes) })).sort((left, right) => right.bytes - left.bytes) }); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const requestPersistence = async () => {
    if (!navigator.storage?.persist) { setError('This browser does not expose persistent-storage requests'); return; }
    const accepted = await navigator.storage.persist(); await refresh();
    onNotice(accepted ? 'Persistent browser storage granted for this origin' : 'Browser retained its best-effort storage policy · export projects and state files regularly');
  };
  const percentage = quota?.quota ? quota.usage / quota.quota * 100 : 0;
  return <section className={`storage-quota-panel ${percentage >= 80 ? 'warning' : ''}`} aria-label="Browser storage quota"><header><div><strong>Browser storage</strong><span>Projects, preferences and private ROMs use this origin. Downloaded state files do not consume this quota.</span></div><button type="button" onClick={() => void refresh()}>Refresh</button></header>{quota ? <><div className="storage-quota-meter"><div><i style={{ width: `${Math.min(100, percentage)}%` }} /></div><strong>{(quota.usage / 1048576).toFixed(1)} MiB used of {(quota.quota / 1048576).toFixed(1)} MiB</strong><span>{percentage.toFixed(1)}% · {quota.persisted ? 'persistent retention granted' : 'best-effort retention'}</span></div><div className="storage-quota-actions"><button type="button" disabled={quota.persisted || !navigator.storage?.persist} onClick={() => void requestPersistence()}>{quota.persisted ? 'Persistent storage granted' : 'Request persistent storage'}</button><p>{percentage >= 80 ? 'Usage exceeds the 80% warning threshold. Export projects and remove unneeded private ROM sets before importing more data.' : 'The browser controls the quota and can evict best-effort data under storage pressure. Portable exports and state downloads remain the recovery path.'}</p></div>{quota.details.length ? <details><summary>Browser-reported usage categories</summary>{quota.details.map((detail) => <p key={detail.name}><strong>{detail.name}</strong><span>{(detail.bytes / 1048576).toFixed(2)} MiB</span></p>)}</details> : <p className="honest-note">This browser reports total origin usage but does not provide a per-storage-category breakdown.</p>}</> : error ? <p role="alert" className="honest-note">Storage quota unavailable: {error}</p> : <p>Measuring origin storage usage and retention policy.</p>}</section>;
}

function WorkspacePlaceholder({ tab, machine }: { tab: string; machine: string }) {
  const icon: IconName = tab === 'Research' ? 'book' : tab === 'Sound' ? 'music' : tab === 'Debugger' ? 'debug' : tab === 'Media' ? 'screen' : tab === 'Settings' ? 'settings' : 'layers';
  return (
    <div className="placeholder-workspace">
      <div className="placeholder-icon"><Icon name={icon} size={30} /></div>
      <span className="eyebrow">{machine.toUpperCase()}</span>
      <h2>{tab}</h2>
      <p>No {tab.toLowerCase()} adapter is installed. This area will activate when its real domain implementation is available.</p>
      <div className="placeholder-grid">
        <span /><span /><span />
      </div>
    </div>
  );
}

interface ArchimedesDebuggerWorkspaceProps {
  connected: boolean;
  state: ArchimedesBridgeSnapshot | null;
  memory: ArchimedesMemory | null;
  artifact: ArmArtifact | null;
  sourceBreakpointAddresses: number[];
  persistedBreakpoints: PersistedArmBreakpointIntent[];
  breakpointGroups: ArmBreakpointGroup[];
  onPersistBreakpoints: (intents: PersistedArmBreakpointIntent[]) => void;
  onPersistGroups: (groups: ArmBreakpointGroup[]) => void;
  onMachineCommand: (message: Record<string, unknown>) => void;
  onNavigateSource: (fileId: string, line: number, column?: number, length?: number) => void;
}

function ArmVariablesPanel({ artifact, state, memory, onMachineCommand }: { artifact: ArmArtifact | null; state: ArchimedesBridgeSnapshot; memory: ArchimedesMemory | null; onMachineCommand: (message: Record<string, unknown>) => void }) {
  const [expression, setExpression] = useState('');
  const [watches, setWatches] = useState<DebugWatchRow[]>([]);
  const [manualResult, setManualResult] = useState<DebugWatchRow>();
  const [symbolFilter, setSymbolFilter] = useState('');
  const pending = useRef(new Map<string, { id: string; expression: string; plan: Extract<ArmDebugExpressionPlan, { kind: 'memory' }>; manual: boolean }>());
  const symbols = artifact?.symbols ?? {};
  const linkFrame = useMemo(() => verifiedArmLinkFrame(artifact, state.registers[14] ?? 0), [artifact, state.registers[14]]);
  const visibleSymbols = useMemo(() => Object.entries(symbols).filter(([name]) => name.toLowerCase().includes(symbolFilter.toLowerCase())).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).slice(0, 256), [symbols, symbolFilter]);
  const evaluate = useCallback((id: string, text: string, manual = false) => {
    try {
      const plan = parseArmDebugExpression(text, symbols, state.registers, state.pc);
      if (plan.kind === 'value') {
        const row: DebugWatchRow = { id, expression: text, status: 'ready', value: plan.value, source: plan.source };
        if (manual) setManualResult(row); else setWatches((current) => current.map((item) => item.id === id ? row : item));
        return;
      }
      const requestId = `arm-debug-expression-${crypto.randomUUID()}`;
      pending.current.set(requestId, { id, expression: text, plan, manual });
      const row: DebugWatchRow = { id, expression: text, status: 'pending', source: plan.source, message: `Reading ${plan.width} byte${plan.width === 1 ? '' : 's'} at ${formatAddress(plan.address, 8)}` };
      if (manual) setManualResult(row); else setWatches((current) => current.map((item) => item.id === id ? row : item));
      onMachineCommand({ type: 'read-memory', requestId, address: plan.address, length: plan.width });
    } catch (error) {
      const row: DebugWatchRow = { id, expression: text, status: 'error', message: error instanceof Error ? error.message : String(error) };
      if (manual) setManualResult(row); else setWatches((current) => current.map((item) => item.id === id ? row : item));
    }
  }, [onMachineCommand, state.pc, state.registers, symbols]);
  useEffect(() => {
    if (!memory) return;
    const request = pending.current.get(memory.requestId); if (!request) return;
    pending.current.delete(memory.requestId);
    try {
      const row: DebugWatchRow = { id: request.id, expression: request.expression, status: 'ready', value: renderArmDebugMemoryValue(memory.bytes, request.plan.width), source: `${request.plan.source}; live ARM logical memory at ${memory.emulationMs.toLocaleString()} ms` };
      if (request.manual) setManualResult(row); else setWatches((current) => current.map((item) => item.id === request.id ? row : item));
    } catch (error) {
      const row: DebugWatchRow = { id: request.id, expression: request.expression, status: 'error', message: error instanceof Error ? error.message : String(error) };
      if (request.manual) setManualResult(row); else setWatches((current) => current.map((item) => item.id === request.id ? row : item));
    }
  }, [memory?.requestId]);
  const addWatch = () => { const text = expression.trim(); if (!text || watches.length >= 64) return; const row = { id: crypto.randomUUID(), expression: text, status: 'pending' as const }; setWatches((current) => [...current, row]); setExpression(''); queueMicrotask(() => evaluate(row.id, text)); };
  return <section className="debug-variables-panel arm-variables-panel" aria-label="ARM call stack variables and watches">
    <div className="panel-heading"><strong>ARM stack, symbols and expressions</strong><small>live state plus exact build metadata</small></div>
    <div className="decoded-call-stack"><h4>Decoded call stack</h4><div><code>0</code><strong>{Object.entries(symbols).find(([, address]) => address === state.pc)?.[0] ?? formatAddress(state.pc, 8)}</strong><span>current execute PC {formatAddress(state.pc, 8)}</span><small>live ARM core execute address</small></div>{linkFrame && <div><code>1</code><strong>{linkFrame.symbol ?? formatAddress(linkFrame.target, 8)}</strong><span>return {formatAddress(linkFrame.returnAddress, 8)} from BL {formatAddress(linkFrame.callSite, 8)} to {formatAddress(linkFrame.target, 8)}</span><small>{linkFrame.source ? `${linkFrame.source.fileName}:${linkFrame.source.line}` : linkFrame.confidence}</small></div>}<p>{linkFrame ? linkFrame.confidence : 'R14 is not presented as a caller because its preceding word is not a BL instruction in the exact current artifact.'} Deeper frames require unwind or frame-layout metadata that this artifact does not provide.</p></div>
    <div className="debug-scope-grid"><section><h4>Globals and build symbols</h4><label><span>Filter symbols</span><input aria-label="Filter ARM debug symbols" value={symbolFilter} onChange={(event) => setSymbolFilter(event.target.value)} /></label><div>{visibleSymbols.map(([name, address]) => <button type="button" key={name} onClick={() => setExpression(name)}><strong>{name}</strong><code>{formatAddress(address, 8)}</code></button>)}</div><p>Names and addresses come from the exact linker result. Storage class and type are unavailable, so symbols are not relabelled as variables.</p></section><section><h4>Locals and parameters</h4><div className="honest-empty">Unavailable. The native ARM build currently retains symbols and source lines, but not DWARF lexical scopes, parameter locations, variable locations, types or unwind tables.</div></section></div>
    <div className="debug-expression-editor"><label><span>Safe ARM expression</span><input aria-label="ARM debug expression" value={expression} onChange={(event) => setExpression(event.target.value)} placeholder="R0, buffer+4, u8(ptr), u16(ptr), u32(&8000)" /></label><button type="button" disabled={!expression.trim()} onClick={() => evaluate('manual-arm', expression.trim(), true)}>Evaluate</button><button type="button" disabled={!expression.trim() || watches.length >= 64} onClick={addWatch}>Add watch</button><button type="button" disabled={!watches.length} onClick={() => watches.forEach((row) => evaluate(row.id, row.expression))}>Refresh all</button><small>Grammar: R0 to R15, PC, current build symbol or 26-bit number, one optional numeric offset, and optional u8(...), u16(...) or little-endian u32(...). Nothing is executed in the guest or browser.</small></div>
    {manualResult && <div className={`debug-expression-result ${manualResult.status}`} role="status"><strong>{manualResult.expression}</strong>{manualResult.value === undefined ? <span>{manualResult.message}</span> : <code>&amp;{manualResult.value.toString(16).toUpperCase().padStart(8, '0')} · {manualResult.value >>> 0}</code>}<small>{manualResult.source}</small></div>}
    <div className="debug-watch-list" aria-label="ARM debug watches">{watches.map((row) => <div className={row.status} key={row.id}><strong>{row.expression}</strong>{row.value === undefined ? <span>{row.message ?? row.status}</span> : <code>&amp;{row.value.toString(16).toUpperCase().padStart(8, '0')} · {row.value >>> 0}</code>}<small>{row.source}</small><button type="button" onClick={() => evaluate(row.id, row.expression)}>Refresh</button><button type="button" onClick={() => setWatches((current) => current.filter((item) => item.id !== row.id))}>Remove</button></div>)}</div>
  </section>;
}

function ArchimedesDebuggerWorkspace({ connected, state, memory, artifact, sourceBreakpointAddresses, persistedBreakpoints, breakpointGroups, onPersistBreakpoints, onPersistGroups, onMachineCommand, onNavigateSource }: ArchimedesDebuggerWorkspaceProps) {
  const [breakpointText, setBreakpointText] = useState('');
  const [armBreakpointConditions, setArmBreakpointConditions] = useState<Array<{ register: string; operator: ArmBreakpointOperator; value: string }>>([{ register: '', operator: 'eq', value: '' }]);
  const [armBreakpointHitTarget, setArmBreakpointHitTarget] = useState('');
  const [activeGroupId, setActiveGroupId] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [message, setMessage] = useState('Pause the machine to inspect a stable ARM state.');
  const lastAutomaticRead = useRef<number | undefined>(undefined);
  const symbols = useMemo(() => Object.fromEntries(Object.entries(artifact?.symbols ?? {}).map(([name, address]) => [name.toUpperCase(), address])), [artifact]);
  const resolvedPersistedBreakpoints = useMemo(() => resolveArmBreakpointIntents(persistedBreakpoints, artifact, breakpointGroups), [artifact, breakpointGroups, persistedBreakpoints]);
  const armArtifactLoaded = !!artifact && !!state && state.pc >= artifact.origin && state.pc < artifact.origin + artifact.bytes.length;
  const requestMemory = (address: number, length = 256) => onMachineCommand({ type: 'read-memory', requestId: `arm-auto-${crypto.randomUUID()}`, address, length });

  useEffect(() => {
    if (!connected || !state || state.running || lastAutomaticRead.current === state.pc) return;
    lastAutomaticRead.current = state.pc;
    const address = Math.max(0, (state.pc & 0x03fffffc) - 32);
    requestMemory(address);
  }, [connected, state?.pc, state?.running]);

  useEffect(() => {
    if (!connected || !armArtifactLoaded) return;
    onMachineCommand({ type: 'set-breakpoints', breakpoints: resolvedPersistedBreakpoints.flatMap((item) => item.wireSpec ? [item.wireSpec] : []) });
  }, [armArtifactLoaded, artifact, breakpointGroups, connected, persistedBreakpoints]);
  useEffect(() => {
    const recorded = recordArmBreakpointResolutions(persistedBreakpoints, resolvedPersistedBreakpoints);
    if (recorded !== persistedBreakpoints) onPersistBreakpoints(recorded);
  }, [resolvedPersistedBreakpoints]);

  const disassembly = useMemo(() => memory ? disassembleArm(new Uint8Array(memory.bytes), memory.address, state?.pc ?? memory.address, 'arm2') : null, [memory, state?.pc]);
  const status = state ? decodeArm26Status(state.status) : null;
  const flags = status ? status.flags.map((flag) => `${flag.name}${flag.set ? 1 : 0}`).join(' ') : '—';
  const installBreakpointSpecs = (specs: Array<Record<string, unknown>>) => {
    onMachineCommand({ type: 'set-breakpoints', breakpoints: specs });
    setMessage(`${specs.length} ARM breakpoint${specs.length === 1 ? '' : 's'} installed in the live core.`);
  };
  const applyBreakpoints = (addresses: number[]) => {
    const unique = [...new Set(addresses.map(validateArmExecutionAddress))].slice(0, 64);
    installBreakpointSpecs(unique.map((address) => ({ address })));
  };
  const applyManualBreakpoints = () => {
    const expressions = breakpointText.split(/\s*,\s*/).map((token) => token.trim()).filter(Boolean);
    const parsed = expressions.map((token) => resolveArmMemoryExpression(token, symbols));
    if (parsed.some((address) => address === null || (address! & 3))) { setMessage('Breakpoints must be comma-separated aligned 26-bit addresses, symbols, or symbol ± offsets.'); return; }
    const hitTarget = armBreakpointHitTarget.trim() ? Number(armBreakpointHitTarget) : undefined;
    const conditions: ArmBreakpointCondition[] = [];
    const persistedConditions: PersistedArmBreakpointIntent['conditions'] = [];
    for (const draft of armBreakpointConditions) {
      if (!draft.register && !draft.value.trim()) continue;
      const conditionValue = draft.register ? resolveArmValueExpression(draft.value, symbols) : null;
      if (!draft.register || conditionValue === null) { setMessage('Each ARM condition requires a register and an unsigned 32-bit value, build symbol, or symbol ± offset.'); return; }
      conditions.push({ register: Number(draft.register), operator: draft.operator, value: conditionValue });
      persistedConditions.push({ register: Number(draft.register), operator: draft.operator, expression: draft.value.trim() });
    }
    try {
      const specs = (parsed as number[]).map((address): ArmBreakpointSpec => ({ address, ...(hitTarget === undefined ? {} : { hitTarget }), ...(conditions.length ? { conditions } : {}) }));
      installBreakpointSpecs(specs.map(armBreakpointWireSpec));
      onPersistBreakpoints(expressions.map((expression) => ({ id: crypto.randomUUID(), expression, enabled: true, conditions: structuredClone(persistedConditions), action: 'pause', ...(hitTarget === undefined ? {} : { hitTarget }), ...(activeGroupId ? { groupId: activeGroupId } : {}) })));
      setMessage(`${specs.length} permanent ARM breakpoint intent${specs.length === 1 ? '' : 's'} saved and resolved against the active build.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const runTo = (address: number, description: string) => {
    try { validateArmExecutionAddress(address); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); return; }
    onMachineCommand({ type: 'run-to', address });
    setMessage(`Running the live ARM2 core to ${description} at ${formatAddress(address, 8)}.`);
  };
  const runToExpression = () => {
    const address = resolveArmMemoryExpression(breakpointText, symbols);
    if (address === null) { setMessage('Run to one aligned 26-bit address, build symbol, or symbol ± offset.'); return; }
    runTo(address, breakpointText.trim() || 'address');
  };
  const stepOver = () => {
    try {
      const target = armStepOverTarget(state?.pc ?? 0, state?.pipeline[0]?.word ?? 0);
      if (target === null) { onMachineCommand({ type: 'step' }); setMessage('The current instruction is not BL; stepped one ARM instruction.'); }
      else runTo(target, 'the instruction after BL');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const runToLinkRegister = () => {
    try { runTo(armLinkReturnTarget(state?.registers[14] ?? 0), 'R14 return address'); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const removeBreakpoint = (address: number) => {
    const persistedIds = new Set(resolvedPersistedBreakpoints.filter((item) => item.address === address).map((item) => item.intent.id));
    if (persistedIds.size) onPersistBreakpoints(persistedBreakpoints.filter((item) => !persistedIds.has(item.id)));
    installBreakpointSpecs((state?.breakpoints ?? []).filter((item) => !item.temporary && item.address !== address).map(({ address: retainedAddress, hitTarget, conditions, action, logMessage }) => ({ address: retainedAddress, action, ...(hitTarget === undefined ? {} : { hitTarget }), ...(conditions?.length ? { conditions } : {}), ...(logMessage === undefined ? {} : { logMessage }) })));
  };
  const updatePersistedBreakpoint = (id: string, changes: Partial<PersistedArmBreakpointIntent>) => onPersistBreakpoints(persistedBreakpoints.map((item) => item.id === id ? { ...item, ...changes } : item));
  const currentSource = state && artifact ? artifact.sourceLocations[state.pc] : undefined;
  const sourceStep = (mode: 'in' | 'over') => {
    if (!currentSource) { setMessage('The current ARM instruction has no source location in the active build.'); return; }
    onMachineCommand({ type: 'source-step', mode, instructionBudget: 100000 });
    setMessage(`${mode === 'over' ? 'Stepping over' : 'Stepping into'} from ${currentSource.fileName}:${currentSource.line} using real ARM instructions.`);
  };
  const updateCondition = (index: number, change: Partial<(typeof armBreakpointConditions)[number]>) => setArmBreakpointConditions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...change } : item));
  const addBreakpointGroup = () => {
    const name = newGroupName.trim();
    if (!name) { setMessage('Enter a breakpoint group name.'); return; }
    if (breakpointGroups.length >= 32) { setMessage('A build target supports at most 32 breakpoint groups.'); return; }
    if (breakpointGroups.some((group) => group.name.toLowerCase() === name.toLowerCase())) { setMessage('Breakpoint group names must be unique in this build target.'); return; }
    const group = { id: crypto.randomUUID(), name: name.slice(0, 64), enabled: true };
    onPersistGroups([...breakpointGroups, group]); setActiveGroupId(group.id); setNewGroupName(''); setMessage(`Breakpoint group ${group.name} created and selected.`);
  };
  const removeBreakpointGroup = (group: ArmBreakpointGroup) => {
    onPersistGroups(breakpointGroups.filter((item) => item.id !== group.id));
    onPersistBreakpoints(persistedBreakpoints.map((intent) => intent.groupId === group.id ? { ...intent, groupId: undefined } : intent));
    if (activeGroupId === group.id) setActiveGroupId('');
    setMessage(`Breakpoint group ${group.name} removed; its breakpoints are now ungrouped.`);
  };
  const conditionLabel = (condition: { register: number; operator: number; value: number }) => `${condition.register === 15 ? 'PC' : `R${condition.register}`} ${['?', '=', '≠', '<', '≤', '>', '≥'][condition.operator] ?? '?'} ${formatAddress(condition.value, 8)}`;

  return <div className="archimedes-debugger">
    <div className="runtime-heading"><div><span className="eyebrow">LIVE ARM2 CORE · 26-BIT ADDRESS SPACE</span><h2>Archimedes debugger</h2></div><span className={`rom-readiness ${connected && state ? 'ready' : ''}`}>{!connected ? 'FIRMWARE REQUIRED' : state?.running ? 'RUNNING' : state ? 'PAUSED' : 'CONNECTING'}</span></div>
    {state && <DebugProtocolPanel protocol={state.protocol} />}
    {state && <ArmVariablesPanel artifact={artifact} state={state} memory={memory} onMachineCommand={onMachineCommand} />}
    {state && <RuntimePerformancePanel state={state.performance} />}
    <div className="arch-debug-toolbar"><button type="button" disabled={!state} onClick={() => onMachineCommand({ type: 'run' })}><Icon name="play" size={14} /> Continue</button><button type="button" disabled={!state || !state.running} title={!state ? 'The ARM adapter is not connected' : !state.running ? 'The ARM core is already paused' : 'Pause at the next instruction boundary'} onClick={() => onMachineCommand({ type: 'pause' })}><Icon name="pause" size={14} /> Pause</button><button type="button" disabled={!state || state.running} title={state?.running ? 'Pause before stepping one instruction' : 'Execute one genuine ARM instruction'} onClick={() => onMachineCommand({ type: 'step' })}><Icon name="debug" size={14} /> Step ARM instruction</button><button type="button" disabled={!state || state.running} title={state?.running ? 'Pause before stepping over a call' : 'Run through a BL call, or step one non-call instruction'} onClick={stepOver}>Step over ARM call</button><button type="button" disabled={!state || state.running || !currentSource} title={!currentSource ? 'The current address has no retained source mapping' : 'Run to a different mapped source line'} onClick={() => sourceStep('in')}>Step source into</button><button type="button" disabled={!state || state.running || !currentSource} title={!currentSource ? 'The current address has no retained source mapping' : 'Step over the current mapped source statement'} onClick={() => sourceStep('over')}>Step source over</button><button type="button" disabled={!state || state.running} title={state?.running ? 'Pause before stepping out' : 'Run to the aligned 26-bit return address held in R14'} onClick={runToLinkRegister}>Step source out to R14</button><button type="button" disabled={!state} title="Reset the same bound A310 and accelerate 5,000 ms of genuine emulation" onClick={() => onMachineCommand({ type: 'reset', fastBootMs: 5000 })}><Icon name="reset" size={14} /> Restart + fast boot</button>{currentSource && <button type="button" onClick={() => onNavigateSource(currentSource.fileId, currentSource.line)}><Icon name="code" size={14} /> {currentSource.fileName}:{currentSource.line}</button>}</div>
    {!state ? <div className="honest-empty runtime-empty">{connected ? 'The isolated A310 core is starting. Live registers will appear after its first instruction snapshot.' : 'Import the selected physical ROM lanes and CMOS in Settings to attach the real ARM2 core.'}</div> : <div className="arch-debug-grid">
      <section className="arch-registers"><div className="panel-heading"><strong>Registers</strong><small>{flags} · {status?.modeName ?? 'unknown'} mode</small></div><div className="arch-register-scroll"><div className="arch-register-grid">{state.registers.map((value, index) => <div key={index} className={index === 15 ? 'program-counter' : ''}><span>{index === 13 ? 'SP/R13' : index === 14 ? 'LR/R14' : index === 15 ? 'R15 execute address' : `R${index}`}</span><strong>{formatAddress(index === 15 ? state.pc : value, 8)}</strong></div>)}</div>{status && <section className="arm26-status" aria-label="ARM2 26-bit program status"><div className="arm-state-heading"><strong>26-bit R15 / PSR</strong><code>{formatAddress(status.raw, 8)}</code><span>{status.modeName} mode · address {formatAddress(status.pc, 8)}</span></div><div className="arm-flag-grid">{status.flags.map((flag) => <div className={flag.set ? 'set' : ''} key={flag.name}><strong>{flag.name}</strong><span>{flag.set ? '1' : '0'}</span><small>{flag.detail}</small></div>)}</div></section>}<section className="arm-pipeline" aria-label="ARM2 instruction pipeline"><div className="arm-state-heading"><strong>Pipeline</strong><span>Core latches are distinct from the next-fetch preview</span></div>{state.pipeline.map((stage, index) => { const decoded = decodeArmWord(stage.word, stage.address, 'arm2'); return <div className={index === 0 ? 'execute' : ''} key={`${stage.address}-${index}`}><strong>{armPipelineStageName(index)}</strong><code>{formatAddress(stage.address, 8)}</code><code>{formatAddress(stage.word, 8)}</code><span>{decoded.mnemonic} {decoded.operand}</span><small>{stage.source}</small></div>; })}</section><section className="arm-banked-registers" aria-label="ARM2 banked registers"><div className="arm-state-heading"><strong>Banked registers</strong><span>Read directly from Arculator's selected register banks</span></div><div role="table" aria-label="ARM2 banked register values"><div role="row" className="arm-bank-head"><span>Mode</span>{Array.from({ length: 7 }, (_, offset) => <span key={offset}>R{offset + 8}</span>)}</div>{state.bankedRegisters.map((bank) => <div role="row" className={bank.mode === state.mode ? 'current' : ''} key={bank.mode}><strong role="cell">{bank.name}</strong>{bank.registers.map((value, offset) => <code role="cell" title={`${bank.name} R${offset + 8} ${formatAddress(value, 8)}`} key={offset}>{formatAddress(value, 8)}</code>)}</div>)}</div></section><dl className="arch-runtime-facts"><div><dt>Core RAM</dt><dd>{state.memoryKiB.toLocaleString()} KiB</dd></div><div><dt>Emulated time</dt><dd>{state.emulationMs.toLocaleString()} ms</dd></div><div><dt>ARM hooks</dt><dd>{state.hookCount.toLocaleString()}</dd></div><div><dt>Breakpoint hit</dt><dd>{state.breakAddress === null ? 'none' : formatAddress(state.breakAddress, 8)}</dd></div></dl></div></section>
      <section className="arch-disassembly"><div className="panel-heading"><strong>Instruction spy</strong><small>{memory ? `${formatAddress(memory.address, 8)} · ${memory.bytes.length} live bytes` : 'no memory sample'}</small></div>{disassembly ? <div className="arch-disassembly-rows">{disassembly.rows.filter((row) => row.kind === 'instruction').map((row) => { const source = artifact?.sourceLocations[row.address]; return <button type="button" key={row.address} className={row.address === state.pc ? 'current' : ''} onDoubleClick={() => applyBreakpoints([row.address])} onClick={() => source && onNavigateSource(source.fileId, source.line)}><span>{formatAddress(row.address, 8)}</span><code>{row.bytes.map(formatByte).join(' ')}</code><strong>{row.mnemonic} {row.operand}</strong><small>{source ? `${source.fileName}:${source.line}` : row.comment ?? ''}</small></button>; })}</div> : <div className="honest-empty">Pause the machine or request memory to populate the live ARM disassembly.</div>}</section>
      <aside className="arch-debug-tools">
        <ArchCoprocessorPanel state={state} />
        <ArchimedesHardwareInspector state={state} />
        <ArchimedesMemoryInspector memory={memory} state={state} artifact={artifact} persistedBreakpoints={persistedBreakpoints} onPersistBreakpoints={onPersistBreakpoints} onMachineCommand={onMachineCommand} />
        <section className="arm-breakpoint-panel">
          <strong>Breakpoints and run to</strong>
          <section className="arm-breakpoint-groups" aria-label="ARM breakpoint groups"><div className="panel-heading"><strong>Groups</strong><small>{breakpointGroups.filter((group) => group.enabled).length}/{breakpointGroups.length} enabled</small></div><div className="arm-breakpoint-group-create"><input aria-label="New ARM breakpoint group name" maxLength={64} value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} placeholder="Rendering, input, interrupts" /><button type="button" onClick={addBreakpointGroup}>Create group</button></div>{breakpointGroups.map((group) => <div className={group.enabled ? '' : 'disabled'} key={group.id}><label><input type="checkbox" aria-label={`Enable ARM breakpoint group ${group.name}`} checked={group.enabled} onChange={(event) => onPersistGroups(breakpointGroups.map((item) => item.id === group.id ? { ...item, enabled: event.target.checked } : item))} /><strong>{group.name}</strong></label><span>{persistedBreakpoints.filter((intent) => intent.groupId === group.id).length} breakpoint{persistedBreakpoints.filter((intent) => intent.groupId === group.id).length === 1 ? '' : 's'}</span><button type="button" aria-pressed={activeGroupId === group.id} onClick={() => setActiveGroupId(activeGroupId === group.id ? '' : group.id)}>{activeGroupId === group.id ? 'Selected' : 'Use for new'}</button><button type="button" aria-label={`Remove ARM breakpoint group ${group.name}`} onClick={() => removeBreakpointGroup(group)}>Remove</button></div>)}</section>
          <label><span>Comma-separated addresses / symbols</span><input aria-label="ARM breakpoint addresses" value={breakpointText} onChange={(event) => setBreakpointText(event.target.value)} placeholder="start, &00008020" /></label>
          <label><span>Group for new breakpoints</span><select aria-label="ARM breakpoint group for new breakpoints" value={activeGroupId} onChange={(event) => setActiveGroupId(event.target.value)}><option value="">Ungrouped</option>{breakpointGroups.map((group) => <option value={group.id} key={group.id}>{group.name}{group.enabled ? '' : ' (disabled)'}</option>)}</select></label>
          <fieldset className="arm-compound-conditions"><legend>Conditions · all must match</legend>{armBreakpointConditions.map((condition, index) => <div className="arm-breakpoint-condition" key={index}>
            <label><span>Register {index + 1}</span><select aria-label={`ARM breakpoint condition ${index + 1} register`} value={condition.register} onChange={(event) => updateCondition(index, { register: event.target.value })}><option value="">Unused</option>{Array.from({ length: 15 }, (_, register) => <option value={register} key={register}>R{register}</option>)}<option value="15">PC</option></select></label>
            <label><span>Compare</span><select aria-label={`ARM breakpoint condition ${index + 1} operator`} value={condition.operator} disabled={!condition.register} onChange={(event) => updateCondition(index, { operator: event.target.value as ArmBreakpointOperator })}><option value="eq">equals</option><option value="ne">not equal</option><option value="lt">less than</option><option value="lte">at most</option><option value="gt">greater than</option><option value="gte">at least</option></select></label>
            <label><span>Value / symbol</span><input aria-label={`ARM breakpoint condition ${index + 1} value`} disabled={!condition.register} value={condition.value} onChange={(event) => updateCondition(index, { value: event.target.value })} placeholder="limit+4 or &00000000" /></label>
            {armBreakpointConditions.length > 1 && <button type="button" aria-label={`Remove ARM breakpoint condition ${index + 1}`} onClick={() => setArmBreakpointConditions((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>}
          </div>)}<button type="button" disabled={armBreakpointConditions.length >= 4} onClick={() => setArmBreakpointConditions((current) => [...current, { register: '', operator: 'eq', value: '' }])}>Add AND condition</button></fieldset>
          <label><span>Hit ≥</span><input aria-label="ARM breakpoint hit target" inputMode="numeric" value={armBreakpointHitTarget} onChange={(event) => setArmBreakpointHitTarget(event.target.value)} placeholder="1" /></label>
          <div className="arm-breakpoint-actions"><button type="button" disabled={!state} onClick={applyManualBreakpoints}>Apply permanent</button><button type="button" disabled={!state || breakpointText.includes(',') || !breakpointText.trim()} onClick={runToExpression}>Run to</button><button type="button" disabled={!state || !sourceBreakpointAddresses.length} onClick={() => applyBreakpoints(sourceBreakpointAddresses)}>Apply {sourceBreakpointAddresses.length} source</button><button type="button" disabled={!state} onClick={() => { setBreakpointText(''); onPersistBreakpoints([]); applyBreakpoints([]); }}>Clear all</button></div>
          <div className="arm-persisted-breakpoints" aria-label="Persisted ARM breakpoint intents"><div className="panel-heading"><strong>Project breakpoint intents</strong><small>{resolvedPersistedBreakpoints.filter((item) => item.wireSpec).length}/{resolvedPersistedBreakpoints.length} resolved</small></div>{resolvedPersistedBreakpoints.length ? resolvedPersistedBreakpoints.map((resolved) => <div className={resolved.error && resolved.error !== 'disabled' ? 'unresolved' : ''} key={resolved.intent.id}><label><input type="checkbox" aria-label={`Enable persisted ARM breakpoint ${resolved.intent.expression}`} checked={resolved.intent.enabled} onChange={(event) => updatePersistedBreakpoint(resolved.intent.id, { enabled: event.target.checked })} /><code>{resolved.intent.expression}</code></label><select aria-label={`Group persisted ARM breakpoint ${resolved.intent.expression}`} value={resolved.intent.groupId ?? ''} onChange={(event) => updatePersistedBreakpoint(resolved.intent.id, { groupId: event.target.value || undefined })}><option value="">Ungrouped</option>{breakpointGroups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select><span>requested {resolved.intent.expression} → {resolved.wireSpec ? `resolved ${formatAddress(resolved.address!, 8)}${resolved.intent.conditions.length ? ` · ${resolved.intent.conditions.map((condition) => `${condition.register === 15 ? 'PC' : `R${condition.register}`} ${condition.operator} ${condition.expression}`).join(' AND ')}` : ''} · ARM 26-bit logical · verified build ${resolved.buildFingerprint?.slice(0, 10) ?? 'address-only'}` : `not installed · ${resolved.error}`}</span>{resolved.intent.resolutionHistory?.length ? <details className="arm-resolution-history"><summary>Resolution history · {resolved.intent.resolutionHistory.length}</summary>{resolved.intent.resolutionHistory.slice().reverse().map((record, index) => <div key={`${record.buildFingerprint}-${index}`}><strong>{record.verification}</strong><code>{record.requestedExpression} → {record.address === null ? 'no address' : formatAddress(record.address, 8)}</code><span>build {record.buildFingerprint.slice(0, 10)} · {record.reason}</span></div>)}</details> : null}<button type="button" aria-label={`Delete persisted ARM breakpoint ${resolved.intent.expression}`} onClick={() => onPersistBreakpoints(persistedBreakpoints.filter((item) => item.id !== resolved.intent.id))}>Delete</button></div>) : <div className="honest-empty">No project breakpoint intents saved for this build target.</div>}</div>
          <div className="arm-breakpoint-list" aria-label="ARM live breakpoints">{(state.breakpoints ?? []).map((breakpoint) => <button type="button" className={breakpoint.temporary ? 'temporary' : ''} aria-label={`${breakpoint.temporary ? 'Cancel run to' : 'Remove breakpoint'} ${formatAddress(breakpoint.address, 8)}`} onClick={() => removeBreakpoint(breakpoint.address)} key={`${breakpoint.address}-${breakpoint.temporary}`}><code>{formatAddress(breakpoint.address, 8)}</code><span>{breakpoint.temporary ? 'run-to' : `${breakpoint.hits} hit${breakpoint.hits === 1 ? '' : 's'}${breakpoint.hitTarget ? ` / ≥${breakpoint.hitTarget}` : ''}${breakpoint.conditions?.length ? ` · ${breakpoint.conditions.map(conditionLabel).join(' AND ')}` : ''}`} ×</span></button>)}</div>
          <p>Up to four conditions use AND semantics inside Arculator's instruction hook. Step-over uses a temporary stop after BL; Run to R14 uses the live link register.</p>
        </section>
      </aside>
    </div>}
    <p className="memory-inspector-message" aria-live="polite">{message}</p>
  </div>;
}

function ArchimedesMemoryInspector({ memory, state, artifact, persistedBreakpoints, onPersistBreakpoints, onMachineCommand }: { memory: ArchimedesMemory | null; state: ArchimedesBridgeSnapshot; artifact: ArmArtifact | null; persistedBreakpoints: PersistedArmBreakpointIntent[]; onPersistBreakpoints: (intents: PersistedArmBreakpointIntent[]) => void; onMachineCommand: (message: Record<string, unknown>) => void }) {
  const [addressText, setAddressText] = useState('&00008000');
  const [lengthText, setLengthText] = useState('256');
  const [columns, setColumns] = useState<8 | 16 | 32>(16);
  const [radix, setRadix] = useState<MemoryRadix>('hex');
  const [selectedAddress, setSelectedAddress] = useState<number>();
  const [searchMode, setSearchMode] = useState<'bytes' | 'text'>('bytes');
  const [searchText, setSearchText] = useState('');
  const [matches, setMatches] = useState<number[]>([]);
  const [snapshot, setSnapshot] = useState<{ address: number; bytes: number[]; emulationMs: number }>();
  const [message, setMessage] = useState('Enter a 26-bit address, build symbol, or symbol ± offset. Reads are side-effect-free.');
  const symbols = useMemo(() => Object.fromEntries(Object.entries(artifact?.symbols ?? {}).map(([name, address]) => [name.toUpperCase(), address])), [artifact]);
  const rows = useMemo(() => memory ? formatMemoryRows(memory.address, memory.bytes, columns, radix) : [], [memory, columns, radix]);
  const changed = useMemo(() => memory && snapshot ? changedMemoryAddresses(memory.address, memory.bytes, snapshot.address, snapshot.bytes) : new Set<number>(), [memory, snapshot]);
  const selectedWord = useMemo(() => memory && selectedAddress !== undefined ? readArmLittleEndianWord(memory.address, memory.bytes, selectedAddress) : null, [memory, selectedAddress]);

  useEffect(() => {
    if (!memory) return;
    setAddressText(formatAddress(memory.address, 8));
    setMessage(`${memory.bytes.length.toLocaleString()} bytes captured from ${memory.addressSpace} at ${memory.emulationMs.toLocaleString()} ms while ${memory.running ? 'running' : 'paused'}.`);
  }, [memory?.requestId]);

  const readLength = () => {
    const length = Number(lengthText);
    return Number.isInteger(length) ? length : Number.NaN;
  };
  const request = (addressOverride?: number) => {
    const address = addressOverride ?? resolveArmMemoryExpression(addressText, symbols);
    const length = readLength();
    if (address === null || address === undefined) { setMessage('Address must be &hex, $hex, 0xhex, decimal, or a build symbol with one optional offset.'); return; }
    try { validateArmMemoryRead(address, length); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); return; }
    if (addressOverride !== undefined) setAddressText(formatAddress(address, 8));
    setSelectedAddress(undefined);
    setMatches([]);
    setMessage(`Reading ${length.toLocaleString()} logical bytes from ${formatAddress(address, 8)}…`);
    onMachineCommand({ type: 'read-memory', requestId: `arm-memory-${crypto.randomUUID()}`, address, length });
  };
  const movePage = (direction: -1 | 1) => {
    if (!memory) return;
    try { request(armMemoryPageAddress(memory.address, readLength(), direction)); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const find = () => {
    if (!memory) { setMessage('Inspect a logical-memory range before searching it.'); return; }
    try {
      const results = searchMemory(memory.address, memory.bytes, parseMemorySearch(searchText, searchMode));
      setMatches(results);
      setMessage(`${results.length} match${results.length === 1 ? '' : 'es'} in the captured range${results.length === 256 ? ' (limit reached)' : ''}.`);
    } catch (error) { setMatches([]); setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const followWord = () => {
    if (selectedWord === null) { setMessage('Select the low byte of a four-byte little-endian word fully inside this range.'); return; }
    const target = selectedWord & ARM26_MAX_ADDRESS;
    setMessage(`Following 26-bit address ${formatAddress(target, 8)} from raw word ${formatAddress(selectedWord, 8)}.`);
    request(target);
  };
  const copyText = async () => {
    if (!memory) return;
    try { await navigator.clipboard.writeText(formatArmMemoryText(memory.address, memory.bytes, columns)); setMessage(`${memory.bytes.length.toLocaleString()} bytes copied as deterministic text.`); }
    catch { setMessage('Clipboard access was unavailable; use Export text instead.'); }
  };
  const exportMemory = (binary: boolean) => {
    if (!memory) return;
    const stem = `arm-memory-${memory.address.toString(16).toUpperCase().padStart(8, '0')}`;
    downloadBlob(binary ? new Blob([new Uint8Array(memory.bytes)], { type: 'application/octet-stream' }) : new Blob([`${formatArmMemoryText(memory.address, memory.bytes, columns)}\n`], { type: 'text/plain;charset=utf-8' }), `${stem}.${binary ? 'bin' : 'txt'}`);
    setMessage(`${memory.bytes.length.toLocaleString()} captured bytes exported as ${binary ? 'binary' : 'text'}.`);
  };

  return <section className="arm-memory-inspector" aria-label="ARM logical memory inspector">
    <div className="arm-memory-heading"><strong>ARM logical memory</strong><small>{memory ? `${memory.bytes.length.toLocaleString()} bytes · ${memory.running ? 'running' : 'paused'} @ ${memory.emulationMs.toLocaleString()} ms` : 'no captured range'}</small></div>
    <div className="arm-memory-nav"><label><span>Address / symbol</span><input aria-label="ARM memory address or symbol" value={addressText} onChange={(event) => setAddressText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') request(); }} /></label><label><span>Length</span><input aria-label="ARM memory read length" type="number" min="1" max="4096" value={lengthText} onChange={(event) => setLengthText(event.target.value)} /></label><button type="button" onClick={() => request()}>Inspect</button><button type="button" disabled={!memory} aria-label="Previous ARM memory page" onClick={() => movePage(-1)}>←</button><button type="button" disabled={!memory} aria-label="Next ARM memory page" onClick={() => movePage(1)}>→</button><button type="button" onClick={() => request(state.pc)}>PC</button></div>
    <div className="arm-memory-options"><label><span>Columns</span><select aria-label="ARM memory columns" value={columns} onChange={(event) => setColumns(Number(event.target.value) as 8 | 16 | 32)}><option value="8">8</option><option value="16">16</option><option value="32">32</option></select></label><label><span>Numbers</span><select aria-label="ARM memory number format" value={radix} onChange={(event) => setRadix(event.target.value as MemoryRadix)}><option value="hex">Hex</option><option value="decimal">Decimal</option></select></label><button type="button" disabled={selectedWord === null} onClick={followWord}>Follow 32-bit word</button>{selectedWord !== null && <code title="Raw 32-bit little-endian word">{formatAddress(selectedWord, 8)} → {formatAddress(selectedWord & ARM26_MAX_ADDRESS, 8)}</code>}</div>
    <div className="arm-memory-search"><select aria-label="ARM memory search mode" value={searchMode} onChange={(event) => setSearchMode(event.target.value as 'bytes' | 'text')}><option value="bytes">Bytes / ??</option><option value="text">ASCII text</option></select><input aria-label="ARM memory search query" value={searchText} onChange={(event) => setSearchText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') find(); }} placeholder={searchMode === 'bytes' ? '00 A0 E3 ??' : 'RISC OS'} /><button type="button" disabled={!memory || !searchText.trim()} onClick={find}>Find</button><div className="arm-memory-matches" aria-label="ARM memory search results">{matches.map((address) => <button type="button" key={address} onClick={() => setSelectedAddress(address)}>{formatAddress(address, 8)}</button>)}</div></div>
    <div className="arm-memory-tools"><button type="button" disabled={!memory} onClick={() => memory && setSnapshot({ address: memory.address, bytes: [...memory.bytes], emulationMs: memory.emulationMs })}>Snapshot</button><button type="button" disabled={!snapshot} onClick={() => setSnapshot(undefined)}>Clear</button><button type="button" disabled={!memory} onClick={() => void copyText()}>Copy</button><button type="button" disabled={!memory} onClick={() => exportMemory(false)}>Text</button><button type="button" disabled={!memory} onClick={() => exportMemory(true)}>Binary</button><span>{snapshot ? `${changed.size} changed since ${snapshot.emulationMs.toLocaleString()} ms` : 'No snapshot'}</span></div>
    {memory ? <div className="arm-memory-table" role="table" aria-label="Captured ARM logical memory">{rows.map((row) => <div role="row" className="arm-memory-row" style={{ gridTemplateColumns: `72px repeat(${columns}, ${radix === 'hex' ? 24 : 29}px) minmax(${columns * 7}px, 1fr)` }} key={row.address}><strong role="rowheader">{formatAddress(row.address, 8)}</strong>{row.values.map((value, index) => { const address = row.address + index; return <button type="button" role="cell" aria-label={`${formatAddress(address, 8)} value ${value}`} aria-selected={selectedAddress === address} className={`${selectedAddress === address ? 'selected' : ''} ${changed.has(address) ? 'changed' : ''}`} onClick={() => setSelectedAddress(address)} key={address}>{value}</button>; })}<code>{row.ascii}</code></div>)}</div> : <div className="honest-empty">Pause or inspect an address to capture live logical memory.</div>}
    <p className="arm-memory-message" aria-live="polite">{message}</p><ArmMemoryMapPanel onMachineCommand={onMachineCommand} /><ArchimedesMemoryEditor state={state} artifact={artifact} onMachineCommand={onMachineCommand} /><ArchimedesRegisterEditor state={state} onMachineCommand={onMachineCommand} /><ArmLogpointPanel state={state} artifact={artifact} persistedBreakpoints={persistedBreakpoints} onPersistBreakpoints={onPersistBreakpoints} onMachineCommand={onMachineCommand} /><p className="honest-note">Current-mapping reads are side-effect-free and never wrap. Paused writes are limited to mappings backed by physical main RAM and are accepted only after exact core read-back; mapped ROM and devices are rejected. Search and diff operate only on the captured range.</p>
  </section>;
}

function ArmMemoryMapPanel({ onMachineCommand }: { onMachineCommand: (message: Record<string, unknown>) => void }) {
  const [regions, setRegions] = useState<ArmMappedRegion[]>([]);
  const [provenance, setProvenance] = useState('Not sampled');
  const [kindFilter, setKindFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const requestId = useRef('');
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.channel !== '8bit-net-archimedes' || event.data?.type !== 'memory-map' || event.data.requestId !== requestId.current) return;
      try { setRegions(compressArmMemoryMap(event.data.pages as ArmMappedPage[])); setProvenance(`${String(event.data.source)} · ${event.data.running ? 'running' : 'paused'} @ ${Number(event.data.emulationMs).toLocaleString()} ms`); }
      catch (error) { setProvenance(error instanceof Error ? error.message : String(error)); }
    };
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
  }, []);
  const refresh = () => { requestId.current = `arm-map-${crypto.randomUUID()}`; onMachineCommand({ type: 'read-memory-map', requestId: requestId.current }); setProvenance('Sampling the live MEMC page table…'); };
  const mapped = regions.filter((region) => region.kind !== 'unmapped');
  const filtered = mapped.filter((region) => (kindFilter === 'all' || region.kind === kindFilter) && (!query.trim() || `${formatAddress(region.logicalStart, 8)} ${formatAddress(region.logicalEnd, 8)} ${region.physicalStart === null ? '' : formatAddress(region.physicalStart, 8)}`.includes(query.trim().toUpperCase())));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 100)); const visiblePage = Math.min(page, pageCount); const shown = filtered.slice((visiblePage - 1) * 100, visiblePage * 100);
  return <section className="arm-memory-map" aria-label="ARM logical to physical memory map"><div><strong>Live MEMC map</strong><span>{mapped.length} mapped region{mapped.length === 1 ? '' : 's'}</span><button type="button" onClick={refresh}>Refresh map</button></div><p aria-live="polite">{provenance}</p>{regions.length ? <><div className="arm-memory-map-strip" aria-hidden="true">{regions.map((region) => <i className={`map-${region.kind}`} style={{ width: `${region.pages / 16384 * 100}%` }} key={region.logicalStart} />)}</div><div className="arm-memory-map-filters"><label><span>Backing</span><select aria-label="ARM memory map backing filter" value={kindFilter} onChange={(event) => { setKindFilter(event.target.value); setPage(1); }}><option value="all">All mapped</option><option value="ram">RAM</option><option value="rom">Main ROM</option><option value="support-rom">Support ROM</option><option value="extension-rom">Extension ROM</option><option value="other">Other</option></select></label><label><span>Address contains</span><input type="search" aria-label="Search ARM memory map" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="&00008000" /></label><span>{filtered.length.toLocaleString()} matches</span></div><div className="arm-memory-map-table" role="table" aria-label="Live ARM MEMC mapped regions">{shown.map((region) => <div role="row" key={region.logicalStart}><strong role="cell">{region.kind}</strong><code role="cell">{formatAddress(region.logicalStart, 8)}–{formatAddress(region.logicalEnd, 8)}</code><span role="cell">{region.physicalStart === null ? 'backing not classified' : `physical ${formatAddress(region.physicalStart, 8)}`}</span><small role="cell">{region.pages.toLocaleString()} × 4 KiB</small></div>)}</div><nav className="arm-memory-map-pages" aria-label="ARM memory map pages"><button type="button" disabled={visiblePage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><span>Page {visiblePage} of {pageCount} · showing {shown.length}</span><button type="button" disabled={visiblePage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next</button></nav></> : <div className="honest-empty">Refresh to classify all 16,384 live logical pages from Arculator's current mapping pointers.</div>}</section>;
}

function ArchimedesMemoryEditor({ state, artifact, onMachineCommand }: { state: ArchimedesBridgeSnapshot; artifact: ArmArtifact | null; onMachineCommand: (message: Record<string, unknown>) => void }) {
  const [addressText, setAddressText] = useState('&00008000');
  const [bytesText, setBytesText] = useState('00');
  const [message, setMessage] = useState('Paused writes are transactional and restricted to physical-main-RAM mappings.');
  const symbols = useMemo(() => Object.fromEntries(Object.entries(artifact?.symbols ?? {}).map(([name, address]) => [name.toUpperCase(), address])), [artifact]);
  const apply = () => {
    const address = resolveArmMemoryExpression(addressText, symbols);
    if (address === null) { setMessage('Enter a 26-bit address, build symbol, or symbol ± offset.'); return; }
    try {
      const edit = validateArmMemoryEdit({ address, bytes: parseArmMemoryEditBytes(bytesText) });
      onMachineCommand({ type: 'write-memory', ...edit, requestId: `arm-edit-${crypto.randomUUID()}` });
      setMessage(`${edit.bytes.length} byte${edit.bytes.length === 1 ? '' : 's'} submitted for core write and exact read-back.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  return <section className="arm-memory-editor" aria-label="ARM memory editor"><strong>Paused memory edit</strong><div><label><span>Address / symbol</span><input aria-label="ARM memory edit address" value={addressText} onChange={(event) => setAddressText(event.target.value)} /></label><label><span>Hex bytes</span><input aria-label="ARM memory edit bytes" value={bytesText} onChange={(event) => setBytesText(event.target.value)} placeholder="02 00 A0 E3" /></label><button type="button" disabled={state.running} onClick={apply}>Write &amp; verify</button></div><p aria-live="polite">{message}</p><div className="arm-memory-edit-history" role="log" aria-label="ARM memory edit history">{state.memoryEdits.length ? state.memoryEdits.slice().reverse().map((edit) => <div key={edit.sequence}><code>#{edit.sequence}</code><strong>{formatAddress(edit.address, 8)}</strong><span>{edit.before.map(formatByte).join(' ')} → {edit.after.map(formatByte).join(' ')}</span><small>{edit.after.length} byte{edit.after.length === 1 ? '' : 's'} · {edit.emulationMs.toLocaleString()} ms</small></div>) : <div className="honest-empty">No verified ARM memory edits in this loaded debug session.</div>}</div></section>;
}

function ArchimedesRegisterEditor({ state, onMachineCommand }: { state: ArchimedesBridgeSnapshot; onMachineCommand: (message: Record<string, unknown>) => void }) {
  const [registerText, setRegisterText] = useState('0');
  const [valueText, setValueText] = useState(formatAddress(state.registers[0] ?? 0, 8));
  const [message, setMessage] = useState('Paused writes are verified immediately by the ARM core.');
  const [pending, setPending] = useState<{ register: number; value: number }>();
  const register = Number(registerText);
  const liveValue = register === 15 ? state.pc : state.registers[register] ?? 0;
  const apply = () => {
    const value = parseHexAddress(valueText, 8);
    if (value === null) { setMessage('Enter an unsigned eight-digit hexadecimal value.'); return; }
    try {
      const edit = validateArmRegisterEdit(register, value);
      onMachineCommand({ type: 'set-register', ...edit });
      setPending(edit);
      setMessage(`${register === 15 ? 'Execute PC' : `R${register}`} write requested; the next snapshot must read it back exactly.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  useEffect(() => {
    if (!pending) return;
    const observed = pending.register === 15 ? state.pc : state.registers[pending.register];
    if (observed === pending.value) {
      if (pending.register === register) setValueText(formatAddress(observed, 8));
      setMessage(`${pending.register === 15 ? 'Execute PC' : `R${pending.register}`} verified as ${formatAddress(observed, 8)} by the live core.`);
      setPending(undefined);
    }
  }, [state.emulationMs, state.pc, state.registers, pending, register]);
  return <div className="arm-register-editor" aria-label="ARM register editor"><strong>Paused register edit</strong><div><label><span>Register</span><select aria-label="ARM register to edit" value={registerText} onChange={(event) => { const next = Number(event.target.value); setRegisterText(event.target.value); setValueText(formatAddress(next === 15 ? state.pc : state.registers[next] ?? 0, 8)); }}>{Array.from({ length: 16 }, (_, index) => <option value={index} key={index}>{index === 15 ? 'PC / R15 execute address' : index === 14 ? 'R14 / LR' : index === 13 ? 'R13 / SP' : `R${index}`}</option>)}</select></label><label><span>Unsigned value</span><input aria-label="ARM register edit value" value={valueText} onChange={(event) => setValueText(event.target.value)} /></label><button type="button" disabled={state.running} onClick={apply}>Write &amp; verify</button><button type="button" onClick={() => setValueText(formatAddress(liveValue, 8))}>Use live</button></div><p aria-live="polite">{message}</p><small>R0–R14 accept 32-bit values. PC accepts an aligned 26-bit execute address and preserves flags, interrupt masks and mode while refilling the pipeline.</small></div>;
}

function ArmLogpointPanel({ state, artifact, persistedBreakpoints, onPersistBreakpoints, onMachineCommand }: { state: ArchimedesBridgeSnapshot; artifact: ArmArtifact | null; persistedBreakpoints: PersistedArmBreakpointIntent[]; onPersistBreakpoints: (intents: PersistedArmBreakpointIntent[]) => void; onMachineCommand: (message: Record<string, unknown>) => void }) {
  const [addressText, setAddressText] = useState('&00008004');
  const [action, setAction] = useState<Extract<ArmBreakpointAction, 'log' | 'pause-log'>>('log');
  const [registerText, setRegisterText] = useState('');
  const [operator, setOperator] = useState<ArmBreakpointOperator>('eq');
  const [valueText, setValueText] = useState('&00000000');
  const [hitTargetText, setHitTargetText] = useState('1');
  const [template, setTemplate] = useState('ARM hit {hits} at {pc} · R0={r0} R1={r1}');
  const [message, setMessage] = useState('Logpoint values are captured inside Arculator at the matching instruction boundary.');
  const symbols = useMemo(() => Object.fromEntries(Object.entries(artifact?.symbols ?? {}).map(([name, address]) => [name.toUpperCase(), address])), [artifact]);
  const install = () => {
    const address = resolveArmMemoryExpression(addressText, symbols);
    const hitTarget = Number(hitTargetText);
    const conditionValue = registerText ? resolveArmValueExpression(valueText, symbols) : null;
    if (address === null) { setMessage('Enter one aligned 26-bit address, build symbol, or symbol ± offset.'); return; }
    if (registerText && conditionValue === null) { setMessage('Enter an unsigned 32-bit value, build symbol, or symbol ± offset.'); return; }
    try {
      const spec = armBreakpointWireSpec({ address, action, logMessage: template, hitTarget, ...(registerText ? { condition: { register: Number(registerText), operator, value: conditionValue! } } : {}) });
      const retained = state.breakpoints.filter((item) => !item.temporary && item.address !== address).map(({ address: retainedAddress, action: retainedAction, logMessage, hitTarget: retainedTarget, conditions }) => ({ address: retainedAddress, action: retainedAction ?? 0, ...(logMessage === undefined ? {} : { logMessage }), ...(retainedTarget === undefined ? {} : { hitTarget: retainedTarget }), ...(conditions?.length ? { conditions } : {}) }));
      if (retained.length >= 64) throw new Error('The ARM core already has its maximum 64 permanent breakpoints');
      onMachineCommand({ type: 'set-breakpoints', breakpoints: [...retained, spec] });
      const retainedIntents = persistedBreakpoints.filter((item) => resolveArmMemoryExpression(item.expression, symbols) !== address);
      onPersistBreakpoints([...retainedIntents, { id: crypto.randomUUID(), expression: addressText.trim(), enabled: true, action, logMessage: template, hitTarget, conditions: registerText ? [{ register: Number(registerText), operator, expression: valueText.trim() }] : [] }]);
      setMessage(`${action === 'log' ? 'Non-stopping' : 'Pause-and-log'} ARM logpoint installed at ${formatAddress(address, 8)}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  return <section className="arm-logpoint-panel" aria-label="ARM logpoint editor">
    <div className="arm-logpoint-heading"><strong>ARM logpoints</strong><span>{state.logEvents.length} / 64 retained · {state.logEventsDropped} overwritten</span><button type="button" disabled={!state.logEvents.length} onClick={() => onMachineCommand({ type: 'clear-log-events' })}>Clear events</button></div>
    <div className="arm-logpoint-controls"><label><span>Address / symbol</span><input aria-label="ARM logpoint address" value={addressText} onChange={(event) => setAddressText(event.target.value)} /></label><label><span>Action</span><select aria-label="ARM logpoint action" value={action} onChange={(event) => setAction(event.target.value as typeof action)}><option value="log">Log only</option><option value="pause-log">Pause and log</option></select></label><label><span>Register</span><select aria-label="ARM logpoint condition register" value={registerText} onChange={(event) => setRegisterText(event.target.value)}><option value="">Always</option>{Array.from({ length: 15 }, (_, register) => <option value={register} key={register}>R{register}</option>)}<option value="15">PC</option></select></label><label><span>Compare</span><select aria-label="ARM logpoint condition operator" disabled={!registerText} value={operator} onChange={(event) => setOperator(event.target.value as ArmBreakpointOperator)}><option value="eq">equals</option><option value="ne">not equal</option><option value="lt">less than</option><option value="lte">at most</option><option value="gt">greater than</option><option value="gte">at least</option></select></label><label><span>Value</span><input aria-label="ARM logpoint condition value" disabled={!registerText} value={valueText} onChange={(event) => setValueText(event.target.value)} /></label><label><span>Hit ≥</span><input aria-label="ARM logpoint hit target" type="number" min="1" max="1000000" value={hitTargetText} onChange={(event) => setHitTargetText(event.target.value)} /></label><label className="arm-logpoint-template"><span>Message · {'{pc} {r0}…{r14} {hits}'}</span><input aria-label="ARM logpoint message" maxLength={160} value={template} onChange={(event) => setTemplate(event.target.value)} /></label><button type="button" onClick={install}>Install logpoint</button></div>
    <p aria-live="polite">{message}</p>
    <div className="arm-logpoint-events" role="log" aria-label="ARM logpoint event history">{state.logEvents.length ? state.logEvents.slice().reverse().map((event) => <div key={event.sequence}><code>#{event.sequence}</code><strong>{formatAddress(event.address, 8)}</strong><span>{renderArmLogpointMessage(event.logMessage, event)}</span><small>match {event.hits.toLocaleString()} · captured R0–R14 and execute-PC</small></div>) : <div className="honest-empty">No ARM logpoint has matched in this loaded debug session.</div>}</div>
  </section>;
}

function ArchCoprocessorPanel({ state }: { state: ArchimedesBridgeSnapshot }) {
  const coprocessor = state.coprocessor;
  return <section className="arch-coprocessor-panel" aria-label="ARM coprocessor state"><div className="panel-heading"><strong>ARM coprocessor</strong><small>{coprocessor.fpaPresent ? 'FPA installed' : 'No FPA installed'}</small></div><dl><div><dt>FPA hardware</dt><dd>{coprocessor.fpaPresent ? 'present' : 'absent'}</dd></div><div><dt>FPA registers</dt><dd>{coprocessor.fpaRegistersAvailable ? 'core state available' : 'not applicable to this machine'}</dd></div><div><dt>Profile values</dt><dd><code>fpa={coprocessor.configuredFpa} fpu_type={coprocessor.configuredFpuType}</code></dd></div></dl><p>{coprocessor.source}. Coprocessor values are never synthesized from the main ARM register file.</p></section>;
}

function ArchimedesHardwareInspector({ state }: { state: ArchimedesBridgeSnapshot }) {
  const { vidc, memc, ioc, storage, audio, swi, modules } = state.hardware;
  const previousRef = useRef<ArchimedesBridgeSnapshot['hardware'] | undefined>(undefined);
  const previous = previousRef.current;
  useEffect(() => { previousRef.current = state.hardware; }, [state.hardware.sampleSequence]);
  const changed = (current: unknown, before: unknown) => previous !== undefined && current !== before ? 'changed' : '';
  const timingRows: Array<[string, number, number | undefined]> = [
    ['Raster line', vidc.timing.line, previous?.vidc.timing.line], ['Horizontal total', vidc.timing.horizontalTotal, previous?.vidc.timing.horizontalTotal], ['H sync end', vidc.timing.horizontalSync, previous?.vidc.timing.horizontalSync], ['H border start', vidc.timing.horizontalBorderStart, previous?.vidc.timing.horizontalBorderStart], ['H display start', vidc.timing.horizontalDisplayStart, previous?.vidc.timing.horizontalDisplayStart], ['H display end', vidc.timing.horizontalDisplayEnd, previous?.vidc.timing.horizontalDisplayEnd], ['H border end', vidc.timing.horizontalBorderEnd, previous?.vidc.timing.horizontalBorderEnd], ['Vertical total', vidc.timing.verticalTotal, previous?.vidc.timing.verticalTotal], ['V sync end', vidc.timing.verticalSync, previous?.vidc.timing.verticalSync], ['V border start', vidc.timing.verticalBorderStart, previous?.vidc.timing.verticalBorderStart], ['V display start', vidc.timing.verticalDisplayStart, previous?.vidc.timing.verticalDisplayStart], ['V display end', vidc.timing.verticalDisplayEnd, previous?.vidc.timing.verticalDisplayEnd], ['V border end', vidc.timing.verticalBorderEnd, previous?.vidc.timing.verticalBorderEnd],
  ];
  const control = vidc.timing.control;
  const decodedSwi = swi.active ? decodeArmWord(swi.word, swi.address, 'arm2') : null;
  const interrupts = ([['IRQ A', 'A', ioc.irqA, ioc.maskA], ['IRQ B', 'B', ioc.irqB, ioc.maskB], ['FIQ', 'F', ioc.fiq, ioc.maskF]] as const).map(([name, group, status, mask]) => ({ name, status, mask, sources: decodeIocInterrupts(group, status, mask) }));
  return <section className="arch-hardware-inspector" aria-label="A310 hardware inspector"><div className="arch-hardware-title"><strong>A310 hardware</strong><small>sample #{state.hardware.sampleSequence.toLocaleString()} at {state.hardware.sampledAtEmulationMs.toLocaleString()} ms</small></div><small>{state.hardware.source}</small>
    <div className="arch-hardware-group"><h4>VIDC live display, timing and control</h4><dl><div><dt>Display</dt><dd>{vidc.displayEnabled ? 'enabled' : 'disabled'} · {vidc.width}×{vidc.height}</dd></div><div className={changed(vidc.frameCount, previous?.vidc.frameCount)}><dt>Frame</dt><dd>{vidc.frameCount.toLocaleString()}</dd></div><div className={changed(vidc.videoAddress, previous?.vidc.videoAddress)}><dt>Video address</dt><dd>{formatAddress(vidc.videoAddress, 8)}</dd></div><div><dt>Cursor</dt><dd>{vidc.cursorVisible ? 'visible' : 'hidden'} · {formatAddress(vidc.cursorAddress, 8)}</dd></div><div><dt>Control &amp;{formatByte(control)}</dt><dd>{[8, 12, 16, 24][control & 3]} MHz · {1 << ((control >> 2) & 3)} bpp · DMA {(control >> 4) & 3}</dd></div><div><dt>Mode flags</dt><dd>{vidc.timing.interlace ? 'interlace' : 'progressive'} · {(control & 0x80) ? 'composite sync' : 'separate sync'}</dd></div></dl><div className="arch-vidc-timing" role="table" aria-label="VIDC timing registers">{timingRows.map(([label, value, before]) => <div className={changed(value, before)} role="row" key={label}><span role="cell">{label}</span><code role="cell">{value}</code><small role="cell">{before === undefined || before === value ? '' : `was ${before}`}</small></div>)}</div><div className="arch-vidc-palette" aria-label="VIDC palette registers">{vidc.palette.map((entry, index) => { const value = entry & 0x1fff; const red = value & 15; const green = (value >> 4) & 15; const blue = (value >> 8) & 15; return <div className={changed(entry, previous?.vidc.palette[index])} key={index} title={`VIDC palette ${index}: raw &${value.toString(16).toUpperCase().padStart(4, '0')}, RGB ${red},${green},${blue}`}><i style={{ background: `rgb(${red * 17}, ${green * 17}, ${blue * 17})` }} /><strong>{index}</strong><code>&amp;{value.toString(16).toUpperCase().padStart(4, '0')}</code></div>; })}</div><details><summary>Raw VIDC register file, 64 words</summary><div className="arch-raw-registers">{vidc.rawRegisters.map((value, index) => <code className={changed(value, previous?.vidc.rawRegisters[index])} key={index}>R{index.toString().padStart(2, '0')} {formatAddress(value, 8)}</code>)}</div></details></div>
    <div className="arch-hardware-group"><h4>MEMC video and sound DMA</h4><dl><div><dt>Revision</dt><dd>{memc.memc1 ? 'MEMC1' : `type ${memc.type}`}</dd></div><div><dt>Refresh</dt><dd>{memc.refreshEnabled ? 'enabled' : 'disabled'}</dd></div><div><dt>Video DMA</dt><dd>{memc.videoDmaEnabled ? 'enabled' : 'disabled'} · req {memc.videoDmaRequest}</dd></div><div><dt>Cursor DMA</dt><dd>req {memc.cursorDmaRequest}</dd></div><div><dt>Sound DMA</dt><dd>{memc.soundDmaEnabled ? 'enabled' : 'disabled'} · req {memc.soundDmaRequest}</dd></div><div><dt>Sound window</dt><dd>{formatAddress(memc.soundStart, 8)} to {formatAddress(memc.soundEnd, 8)}</dd></div><div className={changed(memc.soundPointer, previous?.memc.soundPointer)}><dt>Sound pointer</dt><dd>{formatAddress(memc.soundPointer, 8)} · pos {memc.soundPosition}</dd></div><div><dt>VIDC sound</dt><dd>period {vidc.timing.soundPeriod} · {vidc.timing.soundHz.toLocaleString()} Hz</dd></div><div><dt>SDL queue</dt><dd>{audio.available ? `${audio.queuedBytes.toLocaleString()} bytes` : 'device unavailable'} · {audio.enabled ? 'enabled' : 'disabled'}</dd></div></dl><small>{audio.source}</small></div>
    <div className="arch-hardware-group"><h4>IOC interrupts and timers</h4>{interrupts.map((group) => <div className="arch-ioc-group" key={group.name}><div><strong>{group.name}</strong><code>status &amp;{formatByte(group.status)} · mask &amp;{formatByte(group.mask)}</code></div><div>{group.sources.filter((source) => source.asserted || source.enabled).map((source) => <span className={source.pending ? 'pending' : source.asserted ? 'asserted' : 'enabled'} title={`bit ${source.bit} · ${source.asserted ? 'asserted' : 'clear'} · ${source.enabled ? 'enabled' : 'masked'}`} key={source.bit}>{source.label}</span>)}</div></div>)}<div className="arch-ioc-timers">{ioc.timerCounters.map((counter, index) => <span className={changed(counter, previous?.ioc.timerCounters[index])} key={index}>T{index} {counter >>> 0} / {(ioc.timerLatches[index] ?? 0) >>> 0}</span>)}</div></div>
    <div className="arch-hardware-group"><h4>Floppy storage</h4><dl><div><dt>Controller</dt><dd>{storage.fdcReady ? 'ready' : 'not ready'} · {storage.overridden ? 'overridden' : 'native'}</dd></div><div><dt>Selection</dt><dd>current {storage.currentDrive} · mask &amp;{formatByte(storage.driveSelect)} · motor {storage.motorOn ? 'on' : 'off'}</dd></div></dl><div className="arch-drive-grid">{storage.drives.map((drive) => <div className={drive.drive === storage.currentDrive ? 'current' : ''} key={drive.drive}><strong>Drive {drive.drive}</strong><span>{drive.loaded ? 'media loaded' : 'empty'}</span><code>track {drive.track}</code><small>{drive.writeProtected ? 'write protected' : 'writable'}</small></div>)}</div><small>{storage.source}</small></div>
    <div className="arch-hardware-group"><h4>RISC OS execution context</h4><dl><div className={swi.active ? 'active' : ''}><dt>Execute-stage SWI</dt><dd>{swi.active ? `&${swi.number!.toString(16).toUpperCase().padStart(6, '0')} · ${decodedSwi?.mnemonic} ${decodedSwi?.operand}` : `none · word ${formatAddress(swi.word, 8)}`}</dd></div><div><dt>Module registry</dt><dd>{modules.available ? 'available' : 'not exposed by adapter'}</dd></div></dl><small>{swi.source}. {modules.source}.</small></div>
  </section>;
}

interface TraceMapping { addressSpace: 'mapped 6502'; region: string; kind: 'ram' | 'rom' | 'io' | 'banked' | 'overlay'; bank?: number; writable: boolean; source: string }

interface TubeBridgeState {
  model: string; scheduling: string;
  registers: { pc: number; a: number; x: number; y: number; s: number; p: number };
  cycles: number; romPaged: boolean; nmiLevel: boolean; nmiEdge: boolean; irqPending: boolean; resetHeldLow: boolean;
  ula: { internalStatus: number; hostStatus: number[]; parasiteStatus: number[]; parasiteToHostFifo1: number; parasiteToHostFifo3: number; hostToParasiteFifo3: number };
  memory: { start: number; logical: Array<number | null>; physical: number[]; source: string };
  transfers: { retained: number; dropped: number; capacity: number; source: string; events: Array<{ sequence: number; timeMs: number; hostCycle: number; parasiteCycle: number; side: 'host' | 'parasite'; access: 'read' | 'write'; address: number; register: number; value: number; hostPc: number; parasitePc: number }> };
}

/* What the ElkJS Electron adapter actually reports. It is deliberately not the
 * jsbeeb snapshot shape: that core publishes video, VIA, Tube, profiler and
 * trace state this one has no way to observe, and filling those fields in would
 * be inventing runtime state rather than reading it. */
interface ElectronBridgeState {
  reason: string;
  running: boolean;
  registers: { a: number; x: number; y: number; s: number; p: number; pc: number; source: string } | null;
  capabilities: string[];
  unavailable: Record<string, string>;
  program: { origin: number; entryPoint: number; bytes: number; programManifest: ProgramLoadManifest | null } | null;
  audioEnabled: boolean;
  displayFilter: string;
  acceptedCommands: number;
}

interface MachineBridgeSnapshot {
  protocol: DebugProtocolSnapshot;
  reason: string;
  running: boolean;
  speed: RuntimeSpeed;
  sessionManifest: RuntimeSessionManifest;
  programManifest: ProgramLoadManifest | null;
  cycles: number;
  performance: {
    isolation: string;
    budgets: { activeSessions: number; frameBudgetMs: number; snapshotIntervalMs: number; audioSampleIntervalMs: number; crashCapacity: number; traceCapacity: number; mediaBytesPerDrive: number };
    background: { policy: string; hidden: boolean; suspended: boolean; resumePending: boolean };
    frames: { samples: number; renderedFrames: number; lateFrames: number; droppedFrames: number; lastIntervalMs: number; averageIntervalMs: number; maximumIntervalMs: number; source: string };
    audio: { latencyMs: number; underrunsAvailable: boolean; underruns: number; lastBufferGapMs: number; backgroundSuspended: boolean; source: string };
    crashes: { retained: number; capacity: number; records: Array<{ sequence: number; timeMs: number; kind: string; message: string }> };
  };
  cpuCore: string;
  callStack: Array<{ kind: 'current' | 'jsr-return-candidate'; pc: number; callSite?: number; target?: number; stackAddress?: number; symbol?: string; source?: { fileName: string; line: number }; confidence: string }>;
  tube?: null | TubeBridgeState;
  memoryMap: MemoryMapState;
  profiler: {
    enabled: boolean;
    config: { maxAddresses: number; frameCapacity: number; captureBus: boolean };
    buildFingerprint: string;
    instructions: number;
    cycles: number;
    uniqueAddresses: number;
    untrackedInstructions: number;
    overhead: string;
    source: string;
    addresses: Array<{ address: number; instructions: number; cycles: number; minCycles: number; maxCycles: number; symbol?: string; source?: { fileName: string; line: number } }>;
    calls: Array<{ target: number; count: number; symbol?: string; source?: { fileName: string; line: number } }>;
    frames: Array<{ frame: number; cycles: number; instructions: number }>;
    bus: Array<{ region: string; reads: number; writes: number }>;
    busReads: number;
    busWrites: number;
  };
  replay: {
    enabled: boolean;
    config: { checkpointInterval: number; checkpointCapacity: number };
    segment: number;
    currentInstruction: number;
    oldestInstruction: number;
    retainedInstructions: number;
    checkpointCount: number;
    checkpointBytes: number;
    canReverseStep: boolean;
    canReverseContinue: boolean;
    boundaryReason: string;
    lastVerification: string;
    overhead: string;
    checkpoints: Array<{ index: number; pc: number; cycle: number; bytes: number; source?: { fileName: string; line: number }; symbol?: string }>;
  };
  interrupts: { irqSourceMask: number; irqLine: boolean; irqAccepted: boolean; nmiLevel: boolean; nmiEdge: boolean; interruptDisable: boolean };
  interruptSources: Array<{ id: string; label: string; pending: boolean; enabled: boolean; source: string }>;
  interruptMonitor: { enabled: boolean; capacity: number; retained: number; overhead: string; handlerDepth: number; events: Array<{ sequence: number; timeMs: number; cycle: number; pc: number; kind: 'irq-line' | 'irq-accepted' | 'nmi-line' | 'nmi-edge' | 'handler-enter' | 'handler-exit'; detail: string; traceSequence?: number; sources: MachineBridgeSnapshot['interruptSources'] }> };
  rasterMonitor: { enabled: boolean; config: { capacity: number; recordHSync: boolean; sampleEveryScanlines: number; breakEvent?: 'frame' | 'hsync-start' | 'hsync-end' | 'vsync-start' | 'vsync-end' | 'mode' | 'palette' | 'scanline'; breakX?: number; breakY?: number }; retained: number; droppedEvents: number; overhead: string; source: string; events: Array<{ sequence: number; timeMs: number; cycle: number; pc: number; event: 'frame' | 'hsync-start' | 'hsync-end' | 'vsync-start' | 'vsync-end' | 'mode' | 'palette' | 'scanline'; detail: string; frame: number; x: number; y: number; hSync: boolean; vSync: boolean; scanline: number; horizontalCounter: number; verticalCounter: number; displayAddress: number; mode: number; ulaControl: number; palette: number[] }> };
  instructionDetails: { opcode: number; opcodeSpec: string; mnemonic: string; addressingMode: string; length: number; bytes: number[]; effectiveAddress?: number; operandValue?: number; pointerAddress?: number; branchTarget?: number; pageCrossed: boolean };
  lastStep: null | { instruction: MachineBridgeSnapshot['instructionDetails']; before: MachineBridgeSnapshot['registers']; after: MachineBridgeSnapshot['registers']; cycles: number; changed: Array<'a' | 'x' | 'y' | 's' | 'p' | 'pc'>; flagsChanged: string[]; interruptBefore: MachineBridgeSnapshot['interrupts']; interruptAfter: MachineBridgeSnapshot['interrupts'] };
  hardwareTrace: {
    enabled: boolean;
    config: { capacity: number; sampleEvery: number; captureBus: boolean; eventKinds: Array<'instruction' | 'memory-read' | 'memory-write' | 'interrupt'>; addressStart?: number; addressEnd?: number; opcode?: number; pauseOnMatch: boolean; trigger?: { kind: 'address' | 'opcode' | 'memory-read' | 'memory-write' | 'interrupt'; value?: number }; preTriggerRecords: number; postTriggerRecords: number; pauseOnTrigger: boolean };
    retained: number;
    droppedRecords: number;
    skippedBySampling: number;
    candidateInstructions: number;
    triggeredSequence?: number;
    postRemaining?: number;
    triggerComplete: boolean;
    discardedByTrigger: number;
    eventRetained: number;
    eventDropped: number;
    overhead: string;
    events: Array<{ sequence: number; timeMs: number; cycle: number; cpu: string; kind: 'instruction' | 'memory-read' | 'memory-write' | 'interrupt'; pc: number; pcMapping: TraceMapping; detail: string; instructionSequence: number; source?: { fileName: string; line: number }; symbol?: string; address?: number; addressMapping?: TraceMapping; value?: number; previousValue?: number }>;
    records: Array<{ sequence: number; timeMs: number; cycle: number; cycles: number; cpu: string; pc: number; addressSpace: 'mapped 6502'; bank: string; mapping: TraceMapping; instruction: MachineBridgeSnapshot['instructionDetails']; before: MachineBridgeSnapshot['registers']; after: MachineBridgeSnapshot['registers']; changed: Array<'a' | 'x' | 'y' | 's' | 'p' | 'pc'>; flagsChanged: string[]; accesses: Array<{ type: 'read' | 'write'; address: number; value: number; previousValue?: number; addressSpace: 'mapped 6502'; mapping: TraceMapping; cycle: number; timeMs: number }>; droppedAccesses: number; interruptBefore: MachineBridgeSnapshot['interrupts']; interruptAfter: MachineBridgeSnapshot['interrupts']; source?: { fileName: string; line: number }; symbol?: string; trigger?: string }>;
  };
  registers: { pc: number; a: number; x: number; y: number; s: number; p: number };
  registerEdits: Array<{ sequence: number; before: { pc: number; a: number; x: number; y: number; s: number; p: number }; after: { pc: number; a: number; x: number; y: number; s: number; p: number }; changed: Array<'a' | 'x' | 'y' | 's' | 'p' | 'pc'> }>;
  currentInstruction: { address: number; instruction: string; bytes: number[] };
  breakpoints: Array<{ address: number; enabled: boolean; stop: boolean; hits: number; condition?: { register: string; operator: string; value: number }; hitTarget?: number; logMessage?: string }>;
  breakpointLogs: Array<{ sequence: number; address: number; hits: number; message: string }>;
  watchpoints: Array<{ address: number; access: 'read' | 'write' | 'change'; enabled: boolean; hits: number; width: 1; addressSpace: string; implementation: string; condition?: { operator: 'eq' | 'ne'; value: number }; previousValue?: number; lastValue?: number; pc?: number }>;
  watchpointEvents: Array<{ sequence: number; address: number; pc: number; access: 'read' | 'write' | 'change'; hits: number; previousValue?: number; value: number }>;
  stack: Array<{ address: number; value: number }>;
  trace: Array<{ address: number; instruction: string; bytes: number[] }>;
}

interface EmulatorPanelProps {
  machine: string;
  variant: string;
  machineProfile: { platformClass: string; machineId: string; romId: string; enabledCapabilities: string[] };
  romRecords: StoredRom[];
  machineModel?: string;
  romSetId?: string;
  /** Which pinned core would run this ROM set; the panel routes on it. */
  /* Widened for the Elkulator port. Nothing routes to it: the panel matches
   * on the engines it can start, and an unrecognised one falls through to the
   * refusal rather than to a blank frame. */
  engineId?: 'jsbeeb' | 'elkjs' | 'elkulator';
  /* Settings the open project carries. They take precedence over this
   * browser's own for as long as that project is open, so a preference a piece
   * of work needs travels with it. */
  projectSettings: Readonly<Record<string, unknown>>;
  archimedesRuntime?: ArchimedesRuntimeConfiguration;
  romReady: boolean;
  tube: boolean;
  extraRoms: string[];
  command?: MachineCommand;
  artifact: AssemblyArtifact | null;
  state: CpuSnapshot | null;
  onRun: () => void;
  onStep: () => void;
  onReset: () => void;
  onMachineState: (state: MachineBridgeSnapshot | null) => void;
  onMachineMemory: (memory: MachineMemory | null) => void;
  onArchimedesState: (state: ArchimedesBridgeSnapshot | null) => void;
  onArchimedesMemory: (memory: ArchimedesMemory | null) => void;
  onMachineDisassembly: (disassembly: MachineDisassembly | null) => void;
  onHardwareInspection: (inspection: HardwareInspection | null) => void;
  onMachineMedia: Dispatch<SetStateAction<MachineMedia[]>>;
  onMachineTest: (result: MachineTestResult | null) => void;
  onMachineError: (message: string) => void;
  onNotice: (message: string) => void;
}

interface ArchimedesBridgeSnapshot {
  protocol: DebugProtocolSnapshot;
  sessionManifest: RuntimeSessionManifest;
  programManifest: ProgramLoadManifest | null;
  reason: string;
  running: boolean;
  registers: number[];
  pc: number;
  status: number;
  mode: number;
  pipeline: Array<{ address: number; word: number; source: string }>;
  bankedRegisters: Array<{ name: string; mode: number; registers: number[] }>;
  coprocessor: { fpaPresent: boolean; fpaRegistersAvailable: boolean; configuredFpa: number; configuredFpuType: number; source: string };
  performance: MachineBridgeSnapshot['performance'];
  hardware: {
    sampleSequence: number;
    sampledAtEmulationMs: number;
    source: string;
    vidc: { displayEnabled: boolean; frameCount: number; dmaLength: number; clock: number; videoAddress: number; cursorAddress: number; cursorVisible: boolean; width: number; height: number; dimensionsSource: string; rawRegisters: number[]; palette: number[]; timing: { line: number; horizontalTotal: number; horizontalSync: number; horizontalBorderStart: number; horizontalDisplayStart: number; horizontalDisplayEnd: number; horizontalBorderEnd: number; verticalTotal: number; verticalSync: number; verticalBorderStart: number; verticalDisplayStart: number; verticalDisplayEnd: number; verticalBorderEnd: number; cursorX: number; cursorYStart: number; cursorYEnd: number; interlace: boolean; control: number; soundPeriod: number; soundHz: number } };
    memc: { videoDmaEnabled: boolean; refreshEnabled: boolean; memc1: boolean; type: number; soundStart: number; soundEnd: number; soundPointer: number; soundPosition: number; soundEndNext: number; soundStartNext: number; soundDmaEnabled: boolean; soundDmaRequest: number; videoDmaRequest: number; cursorDmaRequest: number };
    ioc: { irqA: number; irqB: number; fiq: number; maskA: number; maskB: number; maskF: number; control: number; timerCounters: number[]; timerLatches: number[] };
    storage: { currentDrive: number; driveSelect: number; motorOn: boolean; fdcReady: boolean; overridden: boolean; drives: Array<{ drive: number; loaded: boolean; track: number; writeProtected: boolean }>; source: string };
    audio: { available: boolean; enabled: boolean; queuedBytes: number; source: string };
    swi: { active: boolean; address: number; word: number; number: number | null; source: string };
    modules: { available: boolean; source: string };
  };
  breakAddress: number | null;
  breakpoints: Array<{ address: number; temporary: boolean; hits: number; action?: number; logMessage?: string; hitTarget?: number; conditions?: Array<{ register: number; operator: number; value: number }> }>;
  logEvents: Array<{ sequence: number; address: number; hits: number; registers: number[]; logMessage: string }>;
  logEventsDropped: number;
  memoryEdits: Array<{ sequence: number; address: number; before: number[]; after: number[]; emulationMs: number }>;
  hookCount: number;
  emulationMs: number;
  fastBootActive: boolean;
  fastBootPercent: number;
  memoryKiB: number;
}

function EmulatorPanel({ machine, variant, machineProfile, romRecords, machineModel, romSetId, engineId, projectSettings, archimedesRuntime, romReady, tube, extraRoms, command, artifact, state, onRun, onStep, onReset, onMachineState, onMachineMemory, onArchimedesState, onArchimedesMemory, onMachineDisassembly, onHardwareInspection, onMachineMedia, onMachineTest, onMachineError, onNotice }: EmulatorPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [machineState, setMachineState] = useState<MachineBridgeSnapshot | null>(null);
  const [electronState, setElectronState] = useState<ElectronBridgeState | null>(null);
  const [machineError, setMachineError] = useState<string>();
  const [machineProgram, setMachineProgram] = useState<string>();
  const [programManifest, setProgramManifest] = useState<ProgramLoadManifest | null>(null);
  const [machineAudio, setMachineAudio] = useState<MachineAudioState | null>(null);
  const [audioRecording, setAudioRecording] = useState(false);
  const [inputControlsOpen, setInputControlsOpen] = useState(false);
  const [inputCaptured, setInputCaptured] = useState(false);
  const [machineText, setMachineText] = useState('');
  /* Every preference below is resolved through the settings layers, so a value
   * a project carries wins over this browser's, and a stored value that no
   * longer validates falls through to the built-in default instead of being
   * coerced into something the machine would refuse. */
  const settingLayers = { project: projectSettings };
  const [emulatorScale, setEmulatorScale] = useState<EmulatorScaleMode>(() => readSetting<EmulatorScaleMode>('emulator.scale', settingLayers));
  const [keyboardLayout, setKeyboardLayout] = useState<JsBeebKeyboardLayout>(() => readSetting<JsBeebKeyboardLayout>('machine.keyboardLayout', settingLayers));
  const [keyRemaps, setKeyRemaps] = useState<MachineKeyRemap[]>(() => readSetting<MachineKeyRemap[]>('machine.keyRemaps', settingLayers));
  const [remapHostCode, setRemapHostCode] = useState(65);
  const [remapTargetCode, setRemapTargetCode] = useState(32);
  const [gamepadConfig, setGamepadConfig] = useState<GamepadInputConfig>(() => readSetting<GamepadInputConfig>('machine.gamepad', settingLayers));
  const [gamepadStatus, setGamepadStatus] = useState('Disabled');
  const [gamepadActive, setGamepadActive] = useState<GamepadAction[]>([]);
  const [bbcMouseJoystick, setBbcMouseJoystick] = useState(() => readSetting<boolean>('machine.bbcMouseJoystick', settingLayers));
  const [bbcMouseJoystickStatus, setBbcMouseJoystickStatus] = useState('Disabled');
  const [archimedesMouseStatus, setArchimedesMouseStatus] = useState('Move over the live display to attach the A310 mouse');
  const gamepadEdgesRef = useRef<Set<GamepadAction>>(new Set());
  const analogueGamepadRef = useRef('');
  const [archimedesState, setArchimedesState] = useState<ArchimedesBridgeSnapshot | null>(null);
  const [archimedesInitialisation, setArchimedesInitialisation] = useState('Loading emulator core');
  const [archimedesListenerReady, setArchimedesListenerReady] = useState(false);
  const [electronListenerReady, setElectronListenerReady] = useState(false);
  const [frameGeneration, setFrameGeneration] = useState(0);
  const [machinePowered, setMachinePowered] = useState(true);
  const [runtimeSpeed, setRuntimeSpeed] = useState<RuntimeSpeed>(() => readSetting<RuntimeSpeed>('machine.runtimeSpeed', settingLayers));
  const [machineVolume, setMachineVolume] = useState(() => readSetting<number>('machine.volume', settingLayers));
  const [displayFilter, setDisplayFilter] = useState<EmulatorDisplayFilter>(() => readSetting<EmulatorDisplayFilter>('emulator.displayFilter', settingLayers));
  const [displayEffect, setDisplayEffect] = useState<EmulatorDisplayEffect>(() => readSetting<EmulatorDisplayEffect>('emulator.displayEffect', settingLayers));
  const [fastArchimedesBoot, setFastArchimedesBoot] = useState(() => readSetting<string>('archimedes.boot', settingLayers) === 'fast');
  const frameRef = useRef<HTMLIFrameElement>(null);
  const machineFrameRef = useRef<HTMLDivElement>(null);
  const stateInputRef = useRef<HTMLInputElement>(null);
  const sentCommandRef = useRef(0);
  const transportCommandRef = useRef(0);
  const receivedEventRef = useRef(0);
  const transportPendingRef = useRef<number | null>(null);
  const transportQueueRef = useRef<Array<Record<string, unknown>>>([]);
  const initialiseSentRef = useRef('');
  const archimedesFastBootMs = fastArchimedesBoot ? 5000 : 0;
  const profileIdentity = `${machineProfile.platformClass}:${machineProfile.machineId}:${variant}:${machineProfile.romId}:${machineProfile.enabledCapabilities.slice().sort().join(',')}:${machineModel ?? archimedesRuntime?.profile.id ?? ''}:${romRecords.map((rom) => `${rom.key}:${rom.sha256}`).join(',')}:${tube}:${extraRoms.join(',')}:${fastArchimedesBoot}`;
  const debugSessionId = useMemo(() => crypto.randomUUID(), [profileIdentity, frameGeneration]);
  const sessionManifest = useMemo(() => {
    if (!romReady || !romRecords.length || (!machineModel && !archimedesRuntime)) return null;
    try {
      return createRuntimeSessionManifest({
        id: debugSessionId, createdAt: new Date().toISOString(),
        adapter: archimedesRuntime ? { id: 'arculator-wasm', version: '579ac437b9a4ebe83b9b5f9b8e50b0c9c530509e' } : engineId === 'elkulator' ? { id: 'elkulator', version: 'allegro5-6785521' } : engineId === 'elkjs' ? { id: 'elkjs', version: 'ff123355' } : { id: 'jsbeeb', version: '1.19.1' },
        machine: { ...machineProfile, label: machine, variant, model: machineModel ?? archimedesRuntime!.profile.label, romSetId: romSetId ?? archimedesRuntime!.profile.id },
        roms: romRecords.map(({ key, filename, size, sha256 }) => ({ key, filename, size, sha256 })),
        boot: { tube, extraRoms, keyboardLayout, runtimeSpeed, fastBootMs: archimedesFastBootMs },
        substitutions: [],
        limitations: archimedesRuntime
          ? ['Runtime speed, deterministic save state and guest media current-byte export are unavailable for the pinned A310 adapter']
          : engineId === 'elkulator'
            ? [ELKULATOR_ADAPTER_SUMMARY]
            : engineId === 'elkjs'
              ? [ELECTRON_ADAPTER_SUMMARY]
            : ['Guest-modified current-byte export is qualified for SSD and DSD only; the pinned ADF loader exposes no write callback'],
      });
    } catch { return null; }
  }, [debugSessionId, profileIdentity, romReady]);
  /* The Electron ROM sets are served by their own cores, not by jsbeeb, so they
   * must not fall through the 6502 path: jsbeeb has no Electron model and would
   * refuse the machine after the session had already been declared live.
   *
   * There are two of those cores and the ROM set chooses. Both speak the same
   * envelope and report the same state, so everything below treats them
   * together; where they differ — the page, the channel and what each can be
   * asked to do — is decided by this one flag. */
  const electronRoute = electronRuntimeRoute(engineId);
  const electronMachine = isElectronEngine(engineId);
  const elkulatorMachine = engineId === 'elkulator';
  const fullElectronMachine = romReady && electronMachine && !!machineModel && !!romSetId && !!sessionManifest;
  const full6502Machine = romReady && !electronMachine && !!machineModel && !!romSetId && !!sessionManifest;
  const bbcAnalogueSupported = full6502Machine && ['bbc-a', 'bbc-b', 'bbc-bplus', 'master'].includes(machineProfile.machineId);
  const atomMmcJoystickSupported = full6502Machine && machineProfile.machineId === 'atom' && machineProfile.enabledCapabilities.includes('atommc');
  const fullArchimedesMachine = romReady && !!archimedesRuntime && !!sessionManifest;
  const fullMachine = full6502Machine || fullArchimedesMachine || fullElectronMachine;
  const poweredMachine = fullMachine && machinePowered;
  useEffect(() => {
    const frame = machineFrameRef.current;
    if (!frame) return;
    EMULATOR_DISPLAY_EFFECTS.forEach((effect) => frame.classList.remove(`effect-${effect.id}`));
    frame.classList.add(`effect-${displayEffect}`);
  }, [displayEffect, poweredMachine]);
  /* The Electron core takes its firmware from the caller rather than fetching
   * fixed filenames, so the panel hands it the vault URLs of exactly the images
   * the manifest resolved. */
  const electronRomUrls = useMemo(() => {
    const definition = ROM_SETS.find((entry) => entry.id === romSetId);
    if (!definition) return {} as Record<string, string>;
    const supplied = new Set(romRecords.map((record) => record.key));
    const urls: Record<string, string> = {};
    for (const requirement of definition.requirements) {
      const key = romStorageKey(definition.id, requirement);
      if (supplied.has(key)) urls[requirement.id] = `/user-roms/${key.split('/').map(encodeURIComponent).join('/')}`;
    }
    return urls;
  }, [romSetId, romRecords]);
  const runtimeIdentity = sessionManifest?.fingerprint ?? profileIdentity;
  /* What this build says the attached core offers, until the core itself says.
   * Two cores, two declarations: showing ElkJS's list beside a running
   * Elkulator would tell somebody stepping is unavailable while they were
   * stepping. */
  const declaredCapabilities: readonly string[] = elkulatorMachine ? ELKULATOR_CAPABILITIES : ELECTRON_CAPABILITIES;
  const declaredUnavailable = elkulatorMachine ? ELKULATOR_UNAVAILABLE : ELECTRON_UNAVAILABLE;
  const electronPage = electronRoute?.page ?? '/electron.html';
  const electronChannel = electronRoute?.channel ?? '8bit-net-electron';
  const frameSource = fullArchimedesMachine ? `/archimedes.html?boot=${fastArchimedesBoot ? 'fast' : 'authentic'}&session=${encodeURIComponent(debugSessionId)}` : fullElectronMachine ? `${electronPage}?session=${encodeURIComponent(debugSessionId)}` : `/emulator.html?session=${encodeURIComponent(debugSessionId)}`;
  const framebufferWidth = fullArchimedesMachine ? archimedesState?.hardware.vidc.width : fullElectronMachine ? 640 : 1024;
  const framebufferHeight = fullArchimedesMachine ? archimedesState?.hardware.vidc.height : fullElectronMachine ? 512 : 625;
  const scaledViewport = scaledFramebufferViewport(emulatorScale, framebufferWidth, framebufferHeight);
  const postTransportCommand = (envelope: Record<string, unknown>) => { transportPendingRef.current = Number(envelope.commandId); frameRef.current?.contentWindow?.postMessage(envelope, window.location.origin); };
  /* The reason this adapter cannot honour a command, or null when it can. Only
   * the Electron slice restricts anything today, and it refuses in the
   * workbench with the core's own recorded reason rather than sending a command
   * that would be dropped and leave the interface looking live. */
  const adapterBlock = (type: string) => fullElectronMachine ? (elkulatorMachine ? elkulatorCommandRefusal(type) : electronCommandRefusal(type)) : null;
  const sendMachine = (message: Record<string, unknown>) => {
    const refusal = adapterBlock(String(message.type));
    if (refusal) { onNotice(`${machine} adapter · ${refusal}`); return; }
    const envelope = { ...(fullArchimedesMachine ? { channel: '8bit-net-archimedes' } : fullElectronMachine ? { channel: electronChannel } : {}), ...message, sessionId: debugSessionId, commandId: ++transportCommandRef.current };
    if (transportPendingRef.current === null) { postTransportCommand(envelope); return; }
    if (transportQueueRef.current.length >= 64) { onNotice('Debug command queue is full · wait for the attached core to acknowledge pending work'); return; }
    transportQueueRef.current.push(envelope);
  };

  useEffect(() => {
    const nativeAnalogue = gamepadConfig.interfaceMode === 'bbc-analogue';
    const nativeAtomMmc = gamepadConfig.interfaceMode === 'atom-atommc';
    if (!poweredMachine || !full6502Machine || !gamepadConfig.enabled || (nativeAnalogue && !bbcAnalogueSupported) || (nativeAtomMmc && !atomMmcJoystickSupported)) { gamepadEdgesRef.current = new Set(); analogueGamepadRef.current = ''; setGamepadActive([]); setGamepadStatus(gamepadConfig.enabled ? nativeAnalogue ? 'BBC analogue input requires a live BBC or Master target' : nativeAtomMmc ? 'AtoMMC joystick input requires a live Atom target with AtoMMC enabled' : 'Waiting for a live jsbeeb machine' : 'Disabled'); return; }
    let frame = 0; let stopped = false;
    const poll = () => {
      if (stopped) return;
      const gamepad = navigator.getGamepads?.()[gamepadConfig.gamepadIndex] ?? null;
      if (nativeAnalogue) {
        const state = gamepad?.connected ? bbcAnalogueJoystickState(gamepad, gamepadConfig.deadZone) : { channels: [0x8000, 0x8000, 0x8000, 0x8000] as [number, number, number, number], buttons: [false, false] as [boolean, boolean] };
        const identity = JSON.stringify(state);
        if (identity !== analogueGamepadRef.current) { sendMachine({ type: 'bbc-analogue-joystick', ...state }); analogueGamepadRef.current = identity; }
        gamepadEdgesRef.current = new Set(); setGamepadActive([]);
        const status = gamepad?.connected ? `${gamepad.id || 'Standard gamepad'} · BBC ADC ${state.channels.join('/')} · fire ${state.buttons.map((pressed) => pressed ? '1' : '0').join('/')}` : `Waiting for gamepad ${gamepadConfig.gamepadIndex + 1} · BBC ADC centred`;
        setGamepadStatus((current) => current === status ? current : status); frame = requestAnimationFrame(poll); return;
      }
      if (nativeAtomMmc) {
        const state = gamepad?.connected ? atomMmcJoystickState(gamepad, gamepadConfig.deadZone) : { up: false, down: false, left: false, right: false, fire: false, port: 0xff };
        const identity = JSON.stringify(state);
        if (identity !== analogueGamepadRef.current) { sendMachine({ type: 'atom-atommc-joystick', up: state.up, down: state.down, left: state.left, right: state.right, fire: state.fire }); analogueGamepadRef.current = identity; }
        gamepadEdgesRef.current = new Set();
        const active: GamepadAction[] = [];
        if (state.up) active.push('up'); if (state.down) active.push('down'); if (state.left) active.push('left'); if (state.right) active.push('right'); if (state.fire) active.push('fire1');
        setGamepadActive((current) => current.join(',') === active.join(',') ? current : active);
        const status = gamepad?.connected ? `${gamepad.id || 'Standard gamepad'} · AtoMMC port &${state.port.toString(16).toUpperCase().padStart(2, '0')}` : `Waiting for gamepad ${gamepadConfig.gamepadIndex + 1} · AtoMMC port &FF`;
        setGamepadStatus((current) => current === status ? current : status); frame = requestAnimationFrame(poll); return;
      }
      const next = gamepad?.connected ? activeGamepadActions(gamepad, gamepadConfig.deadZone) : new Set<GamepadAction>();
      const previous = gamepadEdgesRef.current;
      GAMEPAD_ACTIONS.forEach(({ id }) => { if (next.has(id) !== previous.has(id)) sendMachine({ type: 'gamepad-key-edge', action: id, code: gamepadConfig.mapping[id], pressed: next.has(id) }); });
      gamepadEdgesRef.current = next;
      const active = GAMEPAD_ACTIONS.map(({ id }) => id).filter((id) => next.has(id));
      setGamepadActive((current) => current.join(',') === active.join(',') ? current : active);
      const status = gamepad?.connected ? `${gamepad.id || 'Standard gamepad'} · ${gamepad.mapping || 'unmapped'} · ${gamepad.buttons.length} buttons` : `Waiting for gamepad ${gamepadConfig.gamepadIndex + 1}`;
      setGamepadStatus((current) => current === status ? current : status);
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => { stopped = true; cancelAnimationFrame(frame); const previous = gamepadEdgesRef.current; GAMEPAD_ACTIONS.forEach(({ id }) => { if (previous.has(id)) sendMachine({ type: 'gamepad-key-edge', action: id, code: gamepadConfig.mapping[id], pressed: false }); }); if (nativeAnalogue && analogueGamepadRef.current) sendMachine({ type: 'bbc-analogue-joystick', channels: [0x8000, 0x8000, 0x8000, 0x8000], buttons: [false, false] }); if (nativeAtomMmc && analogueGamepadRef.current) sendMachine({ type: 'atom-atommc-joystick', up: false, down: false, left: false, right: false, fire: false }); gamepadEdgesRef.current = new Set(); analogueGamepadRef.current = ''; };
  }, [gamepadConfig, poweredMachine, full6502Machine, bbcAnalogueSupported, atomMmcJoystickSupported, runtimeIdentity]);

  const powerOffMachine = () => {
    if (!fullMachine || !machinePowered) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    setMachinePowered(false); setFrameLoaded(false); setMachineState(null); setArchimedesState(null); setArchimedesListenerReady(false); setInputControlsOpen(false); setInputCaptured(false); setMachineAudio(null); setAudioRecording(false); setMachineError(undefined); setMachineProgram(undefined); setProgramManifest(null);
    transportPendingRef.current = null; transportQueueRef.current = []; initialiseSentRef.current = '';
    onMachineState(null); onMachineMemory(null); onArchimedesState(null); onArchimedesMemory(null); onMachineDisassembly(null); onHardwareInspection(null); onMachineMedia([]); onMachineTest(null);
    onNotice(`${machine} powered off · emulator process and volatile machine state released`);
  };

  const powerOnMachine = () => {
    if (!fullMachine || machinePowered) return;
    setFrameGeneration((value) => value + 1); setMachinePowered(true);
    onNotice(`${machine} powering on in a new isolated emulator session`);
  };

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return;
      if (event.data?.channel !== (fullArchimedesMachine ? '8bit-net-archimedes' : fullElectronMachine ? electronChannel : '8bit-net-machine')) return;
      const acceptedSequence = acceptDebugEvent(event.data, debugSessionId, receivedEventRef.current);
      if (acceptedSequence === null) return;
      receivedEventRef.current = acceptedSequence;
      if (event.data.type === 'command-accepted' && Number(event.data.commandId) === transportPendingRef.current) {
        transportPendingRef.current = null;
        const next = transportQueueRef.current.shift();
        if (next) postTransportCommand(next);
      }
      if (fullElectronMachine) {
        if (event.data.type === 'ready') { setMachineError(undefined); setElectronListenerReady(true); }
        if (event.data.type === 'input-focus') setInputCaptured(Boolean(event.data.captured));
        if (event.data.type === 'state') {
          const manifest = event.data.manifest as RuntimeSessionManifest | null;
          if (manifest && manifest.fingerprint !== sessionManifest?.fingerprint) { const message = 'Electron state refused because its runtime session manifest does not match the parent binding'; setMachineError(message); onMachineError(message); return; }
          setElectronState({
            reason: String(event.data.reason ?? ''),
            running: Boolean(event.data.running),
            registers: (event.data.registers ?? null) as ElectronBridgeState['registers'],
            capabilities: (event.data.capabilities ?? []) as string[],
            unavailable: (event.data.unavailable ?? {}) as Record<string, string>,
            program: (event.data.program ?? null) as ElectronBridgeState['program'],
            audioEnabled: Boolean(event.data.audioEnabled),
            displayFilter: String(event.data.displayFilter ?? 'nearest'),
            acceptedCommands: Number(event.data.acceptedCommands ?? 0),
          });
          setMachineError(undefined);
        }
        if (event.data.type === 'memory') onMachineMemory({ address: Number(event.data.address), bytes: event.data.bytes as number[], requestId: String(event.data.requestId), addressSpace: 'mapped', addressSpaceLabel: 'Electron mapped CPU view', capturedAtCycles: 0 });
        if (event.data.type === 'program-loaded') { setMachineProgram(`${String(event.data.format)} · ${Number(event.data.size).toLocaleString()} bytes at ${formatAddress(Number(event.data.address))}`); if (event.data.programManifest) setProgramManifest(event.data.programManifest as ProgramLoadManifest); onNotice(`Program loaded into live Electron RAM at ${formatAddress(Number(event.data.address))} · ElkJS acknowledged`); }
        if (event.data.type === 'audio-state') { const enabled = Boolean(event.data.enabled); setElectronState((current) => current ? { ...current, audioEnabled: enabled } : current); onNotice(`Electron sound ${enabled ? 'enabled' : 'muted'} · ${String(event.data.source)}`); }
        if (event.data.type === 'display-filter' && isEmulatorDisplayFilter(event.data.filter)) { setDisplayFilter(event.data.filter); writeSetting('emulator.displayFilter', event.data.filter); onNotice(`${event.data.filter === 'nearest' ? 'Nearest-neighbour' : 'Linear'} framebuffer filter applied by the live Electron canvas`); }
        if (event.data.type === 'screen-captured' && event.data.blob instanceof Blob) {
          downloadBlob(event.data.blob, safeFilename(String(event.data.filename ?? 'acorn-electron-screen.png')));
          onNotice(`Framebuffer captured · ${Number(event.data.width)} × ${Number(event.data.height)} PNG · ${Number(event.data.size).toLocaleString()} bytes`);
        }
        if (event.data.type === 'error') { const message = String(event.data.message); setMachineError(message); onMachineError(message); }
        return;
      }
      if (fullArchimedesMachine) {
        if (event.data.type === 'input-focus') setInputCaptured(Boolean(event.data.captured));
        if (event.data.type === 'mouse-input') setArchimedesMouseStatus(`Live ${Number(event.data.x)}, ${Number(event.data.y)} of ${Number(event.data.width)} × ${Number(event.data.height)} · buttons ${Number(event.data.buttons) || 'none'}`);
        if (event.data.type === 'mouse-input-released') setArchimedesMouseStatus(`Released · ${String(event.data.reason)}`);
        if (event.data.type === 'text-queued') { setMachineText(''); onNotice(`${Number(event.data.characters).toLocaleString()} character${Number(event.data.characters) === 1 ? '' : 's'} queued through the live A310 keyboard`); }
        if (event.data.type === 'listener-ready') setArchimedesListenerReady(true);
        if (event.data.type === 'ready') { setMachineError(undefined); sendMachine({ type: 'set-display-filter', filter: displayFilter }); }
        if (event.data.type === 'initialisation-progress') setArchimedesInitialisation(String(event.data.label));
        if (event.data.type === 'snapshot') {
          if (event.data.sessionManifest?.fingerprint !== sessionManifest?.fingerprint) { const message = 'A310 snapshot refused because its runtime session manifest does not match the parent binding'; setMachineError(message); onMachineError(message); return; }
          if (event.data.programManifest && event.data.programManifest.sessionFingerprint !== sessionManifest?.fingerprint) { const message = 'A310 snapshot refused because its loaded program is bound to another runtime session'; setMachineError(message); onMachineError(message); return; }
          const snapshot = event.data as ArchimedesBridgeSnapshot; setArchimedesState(snapshot); onArchimedesState(snapshot); setMachineError(undefined);
        }
        if (event.data.type === 'memory') onArchimedesMemory({ address: Number(event.data.address), bytes: event.data.bytes as number[], requestId: String(event.data.requestId), emulationMs: Number(event.data.emulationMs), running: Boolean(event.data.running), addressSpace: String(event.data.addressSpace) });
        if (event.data.type === 'program-loaded') { setMachineProgram(`${String(event.data.format)} · ${Number(event.data.size).toLocaleString()} bytes at ${formatAddress(Number(event.data.address), 8)}`); if (event.data.programManifest) setProgramManifest(event.data.programManifest as ProgramLoadManifest); onNotice(`ARM image loaded into live A310 RAM at ${formatAddress(Number(event.data.address), 8)} · emulator acknowledged`); }
        if (event.data.type === 'source-step-started') onNotice(`ARM source step-over running to ${formatAddress(Number(event.data.target), 8)} through the real instruction hook`);
        if (event.data.type === 'source-step-complete') onNotice(`ARM source step-${String(event.data.mode)} completed at ${String(event.data.source?.fileName)}:${Number(event.data.source?.line)} after ${Number(event.data.instructions).toLocaleString()} instruction${Number(event.data.instructions) === 1 ? '' : 's'}`);
        if (event.data.type === 'source-step-budget') onNotice(`ARM source step stopped after its ${Number(event.data.instructionBudget).toLocaleString()}-instruction safety budget without finding a different mapped source line`);
        if (event.data.type === 'application-staged') { setMachineProgram(`${String(event.data.rootDirectory)} · ${Number(event.data.totalBytes).toLocaleString()} bytes · HostFS staged`); onNotice(`${String(event.data.rootDirectory)} staged with typed metadata · launch path ${String(event.data.launchPath)}`); }
        if (event.data.type === 'application-launch-started') onNotice(`Entering Run ${String(event.data.launchPath)} through the emulated A310 keyboard`);
        if (event.data.type === 'application-launch-command-entered') onNotice(`RISC OS launch command entered · awaiting execution at ${formatAddress(Number(event.data.entryPoint), 8)}`);
        if (event.data.type === 'application-launched') { setMachineProgram(`${String(event.data.rootDirectory)} · running at ${formatAddress(Number(event.data.entryPoint), 8)}`); onNotice(`${String(event.data.rootDirectory)} entered by RISC OS at ${formatAddress(Number(event.data.entryPoint), 8)} · live core verified`); }
        if (event.data.type === 'application-launch-timeout') onNotice(String(event.data.message));
        if (event.data.type === 'media-loaded') {
          const media: MachineMedia = { kind: 'disc', name: String(event.data.name), size: Number(event.data.size), drive: Number(event.data.drive) };
          onMachineMedia((current) => [...current.filter((item) => !(item.kind === 'disc' && item.drive === media.drive)), media]);
          onNotice(`${media.name} mounted in A310 drive ${media.drive} · live floppy controller acknowledged`);
        }
        if (event.data.type === 'screen-captured' && event.data.blob instanceof Blob) {
          downloadBlob(event.data.blob, safeFilename(String(event.data.filename ?? 'archimedes-screen.png')));
          onNotice(`Framebuffer captured · ${Number(event.data.width)} × ${Number(event.data.height)} PNG · ${Number(event.data.size).toLocaleString()} bytes`);
        }
        if (event.data.type === 'audio-state') setMachineAudio(machineAudioStateFromMessage(event.data));
        if (event.data.type === 'audio-capture-state') { const channels = Number(event.data.channels ?? 2); setAudioRecording(Boolean(event.data.recording)); onNotice(event.data.recording ? `Recording up to ${Number(event.data.seconds)} seconds of raw ${channels === 2 ? 'stereo' : 'mono'} A310 PCM at ${Number(event.data.sampleRate).toLocaleString()} Hz` : 'A310 audio capture stopped'); }
        if (event.data.type === 'audio-captured' && event.data.blob instanceof Blob) { const channels = Number(event.data.channels ?? 2); downloadBlob(event.data.blob, safeFilename(String(event.data.filename ?? 'A310-audio.wav'))); setAudioRecording(false); onNotice(`A310 WAV captured · ${Number(event.data.durationSeconds).toFixed(2)} seconds · ${channels === 2 ? 'stereo · ' : ''}${Number(event.data.sampleRate).toLocaleString()} Hz · ${Number(event.data.size).toLocaleString()} bytes`); }
        if (event.data.type === 'display-filter' && isEmulatorDisplayFilter(event.data.filter)) { setDisplayFilter(event.data.filter); writeSetting('emulator.displayFilter', event.data.filter); onNotice(`${event.data.filter === 'nearest' ? 'Nearest-neighbour' : 'Linear'} framebuffer filter applied by the live A310 canvas`); }
        if (event.data.type === 'control-rejected') onNotice(String(event.data.message));
        if (event.data.type === 'error') { const message = String(event.data.message); setMachineError(message); onMachineError(message); }
        return;
      }
      if (event.data?.channel !== '8bit-net-machine') return;
      if (event.data.type === 'input-focus') setInputCaptured(Boolean(event.data.captured));
      if (event.data.type === 'keyboard-layout' && isJsBeebKeyboardLayout(event.data.layout)) setKeyboardLayout(event.data.layout);
      if (event.data.type === 'key-remaps') onNotice(`${Array.isArray(event.data.remaps) ? event.data.remaps.length : 0} custom host key mapping${Array.isArray(event.data.remaps) && event.data.remaps.length === 1 ? '' : 's'} applied by jsbeeb`);
      if (event.data.type === 'bbc-mouse-joystick-state') setBbcMouseJoystickStatus(event.data.enabled ? 'Enabled · move over the live display' : 'Disabled · ADC centred and fire released');
      if (event.data.type === 'bbc-mouse-joystick-input') setBbcMouseJoystickStatus(`BBC ADC ${Number(event.data.x).toLocaleString()}/${Number(event.data.y).toLocaleString()} · fire ${(event.data.buttons as boolean[]).map((pressed) => pressed ? '1' : '0').join('/')}`);
      if (event.data.type === 'text-queued') { setMachineText(''); onNotice(`${Number(event.data.characters).toLocaleString()} character${Number(event.data.characters) === 1 ? '' : 's'} queued through the live machine keyboard`); }
      if (event.data.type === 'tube-state') setMachineState((current) => {
        if (!current) return current;
        const next = { ...current, tube: event.data.tube as MachineBridgeSnapshot['tube'] };
        onMachineState(next); return next;
      });
      if (event.data.type === 'snapshot') {
        if (event.data.sessionManifest?.fingerprint !== sessionManifest?.fingerprint) { const message = 'jsbeeb snapshot refused because its runtime session manifest does not match the parent binding'; setMachineError(message); onMachineError(message); return; }
        if (event.data.programManifest && event.data.programManifest.sessionFingerprint !== sessionManifest?.fingerprint) { const message = 'jsbeeb snapshot refused because its loaded program is bound to another runtime session'; setMachineError(message); onMachineError(message); return; }
        const snapshot = event.data as MachineBridgeSnapshot; setMachineState(snapshot); if (isRuntimeSpeed(snapshot.speed)) setRuntimeSpeed(snapshot.speed); onMachineState(snapshot); setMachineError(undefined);
      }
      if (event.data.type === 'ready') { setMachineError(undefined); sendMachine({ type: 'set-volume', volume: machineVolume }); sendMachine({ type: 'set-display-filter', filter: displayFilter }); if (runtimeSpeed !== 1) sendMachine({ type: 'set-speed', speed: runtimeSpeed }); if (bbcAnalogueSupported && bbcMouseJoystick) sendMachine({ type: 'set-bbc-mouse-joystick', enabled: true }); }
      if (event.data.type === 'speed-state' && isRuntimeSpeed(event.data.speed)) { const speed = event.data.speed; setRuntimeSpeed(speed); writeSetting('machine.runtimeSpeed', speed); onNotice(`Live jsbeeb runtime speed changed to ${speed}x`); }
      if (event.data.type === 'speed-rejected' || event.data.type === 'audio-rejected') onNotice(String(event.data.message));
      if (event.data.type === 'volume-state' && Number.isInteger(event.data.volume)) { const volume = Number(event.data.volume); setMachineVolume(volume); writeSetting('machine.volume', volume); onNotice(`Live machine volume changed to ${volume}%`); }
      if (event.data.type === 'display-filter' && isEmulatorDisplayFilter(event.data.filter)) { setDisplayFilter(event.data.filter); writeSetting('emulator.displayFilter', event.data.filter); onNotice(`${event.data.filter === 'nearest' ? 'Nearest-neighbour' : 'Linear'} framebuffer filter applied by the live jsbeeb canvas`); }
      if (event.data.type === 'control-rejected') onNotice(String(event.data.message));
      if (event.data.type === 'error') { const message = String(event.data.message); setMachineError(message); onMachineError(message); }
      if (event.data.type === 'program-loaded') { setMachineProgram(`${event.data.format} · ${Number(event.data.size).toLocaleString()} bytes at ${formatAddress(Number(event.data.address))}`); if (event.data.programManifest) setProgramManifest(event.data.programManifest as ProgramLoadManifest); }
      if (event.data.type === 'memory') onMachineMemory({ address: Number(event.data.address), bytes: event.data.bytes as number[], requestId: String(event.data.requestId), addressSpace: String(event.data.addressSpace ?? 'mapped') as MemorySpaceId, addressSpaceLabel: String(event.data.addressSpaceLabel ?? 'Mapped CPU view'), ...(event.data.bank === undefined ? {} : { bank: Number(event.data.bank) }), capturedAtCycles: Number(event.data.capturedAtCycles ?? 0) });
      if (event.data.type === 'disassembly') onMachineDisassembly({ address: Number(event.data.address), requestId: String(event.data.requestId), addressSpace: String(event.data.addressSpace), bank: String(event.data.bank), capturedAtCycles: Number(event.data.capturedAtCycles), rows: event.data.rows as MachineDisassemblyRow[] });
      if (event.data.type === 'hardware-inspection') onHardwareInspection(event.data.inspection as HardwareInspection);
      if (event.data.type === 'memory-written') onNotice(`${Number(event.data.bytes?.length ?? 0)} RAM byte${Number(event.data.bytes?.length ?? 0) === 1 ? '' : 's'} written at ${formatAddress(Number(event.data.address))} · emulator acknowledged`);
      if (event.data.type === 'registers-written') onNotice(`${Array.isArray(event.data.changed) && event.data.changed.length ? event.data.changed.map((name: unknown) => String(name).toUpperCase()).join('/') : 'No'} register change${Array.isArray(event.data.changed) && event.data.changed.length === 1 ? '' : 's'} · emulator acknowledged and read back`);
      if (event.data.type === 'source-step-started') onNotice(`6502 source step-${String(event.data.mode)} started at ${String(event.data.source?.fileName)}:${Number(event.data.source?.line)} with a ${Number(event.data.instructionBudget).toLocaleString()} instruction bound`);
      if (event.data.type === 'source-step-complete') onNotice(`6502 source step-${String(event.data.mode)} completed at ${String(event.data.source?.fileName)}:${Number(event.data.source?.line)} after ${Number(event.data.instructions).toLocaleString()} instruction${Number(event.data.instructions) === 1 ? '' : 's'}`);
      if (event.data.type === 'source-step-budget') onNotice(`6502 source step stopped after its ${Number(event.data.instructionBudget).toLocaleString()} instruction safety bound without reaching a different mapped source line`);
      if (event.data.type === 'test-started') onMachineTest({ name: String(event.data.name), requestId: typeof event.data.requestId === 'string' ? event.data.requestId : undefined, status: 'running', reason: `Executing to ${formatAddress(Number(event.data.stopAddress))}`, cycles: 0, stopAddress: Number(event.data.stopAddress), assertionCount: Number(event.data.assertionCount), cycleBudget: Number(event.data.cycleBudget), assertions: [] });
      if (event.data.type === 'test-result') {
        const result = event.data as MachineTestResult;
        onMachineTest(result);
        onNotice(`${result.name} · ${result.status}${Number.isFinite(result.cycles) ? ` · ${Number(result.cycles).toLocaleString()} cycles` : ''}`);
      }
      if (event.data.type === 'media-loaded') {
        const media: MachineMedia = event.data.kind === 'tape'
          ? { kind: 'tape', name: String(event.data.name), size: Number(event.data.size), format: String(event.data.format) }
          : { kind: 'disc', name: String(event.data.name), size: Number(event.data.size), drive: Number(event.data.drive), dirty: false, revision: 0 };
        onMachineMedia((current) => [...current.filter((item) => media.kind === 'disc' ? !(item.kind === 'disc' && item.drive === media.drive) : item.kind !== 'tape'), media]);
      }
      if (event.data.type === 'media-changed' && event.data.kind === 'disc') {
        const drive = Number(event.data.drive);
        onMachineMedia((current) => current.map((item) => item.kind === 'disc' && item.drive === drive ? { ...item, size: Number(event.data.size), dirty: true, revision: Number(event.data.revision) } : item));
        onNotice(`Drive ${drive} changed by guest · write revision ${Number(event.data.revision)} · export current bytes before ejecting`);
      }
      if (event.data.type === 'media-exported' && event.data.kind === 'disc' && event.data.blob instanceof Blob) {
        downloadBlob(event.data.blob, safeFilename(String(event.data.name ?? `drive-${Number(event.data.drive)}.ssd`)));
        onNotice(`Drive ${Number(event.data.drive)} exported · ${Number(event.data.size).toLocaleString()} current bytes · ${event.data.dirty ? `guest write revision ${Number(event.data.revision)}` : 'unchanged since mount'}`);
      }
      if (event.data.type === 'media-ejected') {
        if (event.data.kind === 'disc') {
          const drive = Number(event.data.drive);
          onMachineMedia((current) => current.filter((item) => !(item.kind === 'disc' && item.drive === drive)));
          onNotice(`Drive ${drive} ejected · live FDC acknowledged`);
        } else {
          onMachineMedia((current) => current.filter((item) => item.kind !== 'tape'));
          onNotice('Cassette ejected · live input adapter acknowledged');
        }
      }
      if (event.data.type === 'state-saved' && typeof event.data.json === 'string') {
        downloadBlob(new Blob([event.data.json], { type: 'application/json' }), safeFilename(String(event.data.filename ?? 'machine-state.8bitstate.json')));
        onNotice(`Machine state v${Number(event.data.version)} saved · ${Number(event.data.size).toLocaleString()} bytes · ${Number(event.data.romCount)} ROM digest${Number(event.data.romCount) === 1 ? '' : 's'}`);
      }
      if (event.data.type === 'state-loaded') onNotice(`${String(event.data.model)} state v${Number(event.data.version)} restored · machine paused · ${Number(event.data.romCount)} ROM digest${Number(event.data.romCount) === 1 ? '' : 's'} verified · ${Number(event.data.mediaCount)} media image${Number(event.data.mediaCount) === 1 ? '' : 's'}`);
      if (event.data.type === 'screen-captured' && event.data.blob instanceof Blob) {
        downloadBlob(event.data.blob, safeFilename(String(event.data.filename ?? 'acorn-screen.png')));
        onNotice(`Framebuffer captured · ${Number(event.data.width)} × ${Number(event.data.height)} PNG · ${Number(event.data.size).toLocaleString()} bytes`);
      }
      if (event.data.type === 'audio-state') setMachineAudio(machineAudioStateFromMessage(event.data));
      if (event.data.type === 'audio-capture-state') { const channels = Number(event.data.channels ?? 1); setAudioRecording(Boolean(event.data.recording)); onNotice(event.data.recording ? `Recording up to ${Number(event.data.seconds)} seconds of raw ${channels === 2 ? 'stereo' : 'mono'} machine PCM at ${Number(event.data.sampleRate).toLocaleString()} Hz` : 'Machine audio capture stopped'); }
      if (event.data.type === 'audio-captured' && event.data.blob instanceof Blob) { const channels = Number(event.data.channels ?? 1); downloadBlob(event.data.blob, safeFilename(String(event.data.filename ?? 'machine-audio.wav'))); setAudioRecording(false); onNotice(`Machine WAV captured · ${Number(event.data.durationSeconds).toFixed(2)} seconds · ${channels === 2 ? 'stereo · ' : ''}${Number(event.data.sampleRate).toLocaleString()} Hz · ${Number(event.data.size).toLocaleString()} bytes`); }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [debugSessionId, displayFilter, fullArchimedesMachine, fullElectronMachine, machineVolume, onArchimedesMemory, onArchimedesState, onHardwareInspection, onMachineDisassembly, onMachineError, onMachineMedia, onMachineMemory, onMachineState, onMachineTest, onNotice, runtimeSpeed, sessionManifest?.fingerprint]);

  const openStateFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) { onNotice('Machine state files are limited to 12 MiB'); return; }
    try {
      sendMachine({ type: 'load-state', json: await file.text() });
      onNotice(`Loading machine state from ${file.name}`);
    } catch (error) {
      onNotice(`Unable to read machine state · ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const exportRuntimeRunRecord = () => {
    if (!sessionManifest || !programManifest) return;
    try {
      const record = createRuntimeRunRecord(sessionManifest, programManifest);
      downloadBlob(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }), safeFilename(`${programManifest.name.replace(/\.[^.]+$/, '') || 'program'}-${record.fingerprint.slice(0, 12)}.8bitrun.json`));
      onNotice(`Run record exported · ${record.fingerprint} · session, ROM and program digests bound`);
    } catch (error) { onNotice(`Run-record export refused · ${error instanceof Error ? error.message : String(error)}`); }
  };
  const applyKeyRemaps = (next: MachineKeyRemap[]) => {
    try {
      const validated = validateMachineKeyRemaps(next);
      setKeyRemaps(validated); writeSetting('machine.keyRemaps', validated); sendMachine({ type: 'set-key-remaps', remaps: validated });
    } catch (error) { onNotice(`Key mapping refused · ${error instanceof Error ? error.message : String(error)}`); }
  };
  const applyGamepadConfig = (next: GamepadInputConfig) => {
    try { const validated = validateGamepadInputConfig(next); setGamepadConfig(validated); writeSetting('machine.gamepad', validated); }
    catch (error) { onNotice(`Gamepad configuration refused · ${error instanceof Error ? error.message : String(error)}`); }
  };
  const applyBbcMouseJoystick = (enabled: boolean) => {
    if (enabled) applyGamepadConfig({ ...gamepadConfig, enabled: false });
    setBbcMouseJoystick(enabled); writeSetting('machine.bbcMouseJoystick', enabled);
    sendMachine({ type: 'set-bbc-mouse-joystick', enabled });
  };

  const toggleFullScreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await machineFrameRef.current?.requestFullscreen();
    } catch (error) {
      onNotice(`Full-screen mode was unavailable · ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  useEffect(() => {
    setFrameLoaded(false); setMachineState(null); setElectronState(null); setElectronListenerReady(false); setArchimedesState(null); setArchimedesInitialisation('Loading emulator core'); setArchimedesListenerReady(false); setInputCaptured(false); onMachineState(null); onMachineMemory(null); onArchimedesState(null); onArchimedesMemory(null); onMachineDisassembly(null); onHardwareInspection(null); onMachineMedia([]); onMachineTest(null); setMachineError(undefined); setMachineProgram(undefined); setProgramManifest(null); setMachineAudio(null); setAudioRecording(false);
    sentCommandRef.current = 0; transportCommandRef.current = 0; receivedEventRef.current = 0; transportPendingRef.current = null; transportQueueRef.current = []; initialiseSentRef.current = '';
  }, [runtimeIdentity, onArchimedesMemory, onArchimedesState, onHardwareInspection, onMachineDisassembly, onMachineMedia, onMachineMemory, onMachineState, onMachineTest]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const reconnect = () => {
      transportCommandRef.current = 0; receivedEventRef.current = 0; transportPendingRef.current = null; transportQueueRef.current = []; sentCommandRef.current = 0; initialiseSentRef.current = '';
      setMachineState(null); setElectronState(null); setElectronListenerReady(false); onMachineState(null); setFrameLoaded(true);
    };
    frame.addEventListener('load', reconnect);
    return () => frame.removeEventListener('load', reconnect);
  }, [frameSource, onMachineState]);

  useEffect(() => {
    if (!poweredMachine || initialiseSentRef.current === runtimeIdentity) return;
    if (fullArchimedesMachine) {
      if (!archimedesListenerReady || !archimedesRuntime) return;
      initialiseSentRef.current = runtimeIdentity;
      sendMachine({ type: 'initialise', profileId: archimedesRuntime.profile.id, romSet: archimedesRuntime.profile.arculatorRomSet, memoryKiB: archimedesRuntime.memoryKiB, romSize: archimedesRuntime.profile.laneSize * 4, cmosFilename: archimedesRuntime.profile.cmosFilename, cmosRuntimeName: archimedesRuntime.cmosRuntimeName, fastBootMs: archimedesFastBootMs, sessionManifest });
      return;
    }
    if (fullElectronMachine) {
      /* The runtime announces itself on load; the frame's own load event is the
       * fallback for the case where that announcement raced the listener. */
      if (!electronListenerReady && !frameLoaded) return;
      initialiseSentRef.current = runtimeIdentity;
      sendMachine({ type: 'initialise', roms: electronRomUrls, sessionManifest });
      return;
    }
    if (!frameLoaded) return;
    initialiseSentRef.current = runtimeIdentity;
    sendMachine({ type: 'initialise', model: machineModel, romSetId, tube, extraRoms, keyboardLayout, keyRemaps, sessionManifest });
  }, [archimedesFastBootMs, archimedesListenerReady, archimedesRuntime, electronListenerReady, electronRomUrls, frameLoaded, fullArchimedesMachine, fullElectronMachine, poweredMachine, machineModel, romSetId, runtimeIdentity, tube, keyboardLayout, keyRemaps, extraRoms.join('\n')]);

  useEffect(() => {
    if (!poweredMachine || (!machineState && !archimedesState && !electronState) || !command || command.id === sentCommandRef.current) return;
    sentCommandRef.current = command.id;
    const draft = command.message.programLoadDraft as ProgramLoadDraft | undefined;
    if (draft && (command.message.type === 'load-machine-code' || command.message.type === 'load-arm-program' || command.message.type === 'run-test' || command.message.type === 'load-basic') && sessionManifest) {
      try {
        const { programLoadDraft: _draft, ...message } = command.message;
        const bytes = Uint8Array.from(message.bytes as number[]);
        const dynamicBasic = message.type === 'load-basic';
        sendMachine({ ...message, programManifest: bindProgramLoadManifest(draft, sessionManifest.fingerprint, bytes, dynamicBasic ? 0 : Number(message.origin), dynamicBasic ? 0 : Number(message.entryPoint)), commandId: command.id });
      } catch (error) { onNotice(`Program load refused · ${error instanceof Error ? error.message : String(error)}`); }
      return;
    }
    sendMachine({ ...command.message, commandId: command.id });
  }, [archimedesState, command, electronState, poweredMachine, machineState, sessionManifest?.fingerprint]);

  return (
    <section
      className={collapsed ? "emulator-panel collapsed" : "emulator-panel"}
      aria-label="Emulator preview"
    >
      <input
        ref={stateInputRef}
        className="visually-hidden"
        type="file"
        accept=".8bitstate.json,.json,application/json"
        aria-label="Choose machine state file"
        onChange={(event) => {
          void openStateFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <div className="emulator-toolbar">
        <div className="emulator-title">
          <span className={`emulator-led ${poweredMachine ? "live" : ""}`} />
          <strong>{machine}</strong>
          <small>
            {fullArchimedesMachine
              ? `${variant} · ${archimedesRuntime.profile.label}`
              : fullMachine
                ? `${machineModel}${tube ? " · Tube" : ""}`
                : variant}
          </small>
          {fullMachine && (
            <span
              className={`emulator-audio ${machineAudio?.enabled && !machineAudio.requiresGesture ? "active" : ""}`}
            >
              {!machinePowered
                ? "powered off"
                : !machineAudio
                  ? "audio starting"
                  : !machineAudio.available
                    ? "audio unavailable"
                    : machineAudio.requiresGesture
                      ? "click screen to enable audio"
                      : machineAudio.enabled
                        ? `audio on${full6502Machine && machineAudio.peak > 0.0001 ? " · signal" : ""}`
                        : "audio muted"}
            </span>
          )}
        </div>
        <div className="emulator-controls">
          {fullArchimedesMachine && (
            <button
              className="emulator-boot-mode"
              type="button"
              aria-label="Toggle Archimedes boot speed"
              disabled={!machinePowered}
              title="Choose accelerated or cycle-paced boot; changing this restarts the isolated machine"
              onClick={() => {
                const next = !fastArchimedesBoot;
                setFastArchimedesBoot(next);
                writeSetting("archimedes.boot", next ? "fast" : "authentic");
                onNotice(
                  `${next ? "Fast" : "Authentic-speed"} Archimedes boot selected · restarting isolated machine`,
                );
              }}
            >
              {fastArchimedesBoot ? "FAST BOOT" : "AUTHENTIC BOOT"}
            </button>
          )}
          <button
            className={`icon-button emulator-power ${machinePowered ? "active" : ""}`}
            type="button"
            aria-label={
              machinePowered ? "Power off machine" : "Power on machine"
            }
            aria-pressed={machinePowered}
            title={
              machinePowered
                ? "Power off and release the isolated emulator and all volatile state"
                : "Start a new isolated emulator session from the configured ROMs"
            }
            disabled={!fullMachine}
            onClick={machinePowered ? powerOffMachine : powerOnMachine}
          >
            <Icon name="power" />
          </button>
          <label className="emulator-speed">
            <span className="visually-hidden">Runtime speed</span>
            <select
              aria-label="Runtime speed"
              value={runtimeSpeed}
              disabled={
                !poweredMachine ||
                !full6502Machine ||
                !machineState ||
                Boolean(machineAudio?.enabled)
              }
              title={
                fullArchimedesMachine
                  ? "Unavailable for A310: the pinned core has no qualified live pacing API"
                  : machineAudio?.enabled
                    ? "Mute machine audio before changing runtime speed"
                    : RUNTIME_SPEEDS.find(
                        (speed) => speed.value === runtimeSpeed,
                      )?.detail
              }
              onChange={(event) => {
                const speed = Number(event.target.value);
                if (isRuntimeSpeed(speed))
                  sendMachine({ type: "set-speed", speed });
              }}
            >
              {RUNTIME_SPEEDS.map((speed) => (
                <option value={speed.value} key={speed.value}>
                  {speed.label}
                </option>
              ))}
            </select>
          </label>
          <label className="emulator-filter">
            <span className="visually-hidden">Framebuffer filter</span>
            <select
              aria-label="Framebuffer filter"
              value={displayFilter}
              disabled={!poweredMachine || (!machineState && !archimedesState)}
              title="Choose exact nearest-neighbour pixels or browser linear interpolation"
              onChange={(event) => {
                const filter = event.target.value;
                if (isEmulatorDisplayFilter(filter))
                  sendMachine({ type: "set-display-filter", filter });
              }}
            >
              <option value="nearest">PIXEL</option>
              <option value="linear">SMOOTH</option>
            </select>
          </label>
          <label className="emulator-filter emulator-effect">
            <span className="visually-hidden">Display presentation effect</span>
            <select
              aria-label="Display presentation effect"
              value={displayEffect}
              disabled={!poweredMachine || (!machineState && !archimedesState)}
              title={
                EMULATOR_DISPLAY_EFFECTS.find(
                  (effect) => effect.id === displayEffect,
                )?.detail
              }
              onChange={(event) => {
                const effect = event.target.value;
                if (isEmulatorDisplayEffect(effect)) {
                  setDisplayEffect(effect);
                  writeSetting("emulator.displayEffect", effect);
                  onNotice(
                    `${EMULATOR_DISPLAY_EFFECTS.find((item) => item.id === effect)?.label} presentation effect selected · captured framebuffer pixels are unchanged`,
                  );
                }
              }}
            >
              {EMULATOR_DISPLAY_EFFECTS.map((effect) => (
                <option value={effect.id} key={effect.id}>
                  {effect.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className={`emulator-input-button ${inputCaptured ? "captured" : ""}`}
            type="button"
            aria-expanded={inputControlsOpen}
            aria-controls="machine-input-controls"
            disabled={!poweredMachine || (!machineState && !archimedesState)}
            title="Inspect keyboard mapping, capture or release input, and queue reviewed text"
            onClick={() => setInputControlsOpen((value) => !value)}
          >
            {inputCaptured ? "KEYS CAPTURED" : "KEYS"}
          </button>
          <label className="emulator-scale">
            <span className="visually-hidden">Framebuffer scaling</span>
            <select
              aria-label="Framebuffer scaling"
              value={emulatorScale}
              disabled={!poweredMachine || (!machineState && !archimedesState)}
              title={
                EMULATOR_SCALE_MODES.find((mode) => mode.id === emulatorScale)
                  ?.detail
              }
              onChange={(event) => {
                const mode = event.target.value as EmulatorScaleMode;
                setEmulatorScale(mode);
                writeSetting("emulator.scale", mode);
                onNotice(
                  `${EMULATOR_SCALE_MODES.find((item) => item.id === mode)?.label} framebuffer scaling selected`,
                );
              }}
            >
              {EMULATOR_SCALE_MODES.map((mode) => (
                <option value={mode.id} key={mode.id}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="icon-button"
            type="button"
            /* The name follows what the control does. It did not, and that is
             * how somebody presses "Run program" expecting their build to
             * reach the machine and gets the operating system resumed instead.
             * A tooltip said which; a tooltip is not an accessible name. */
            aria-label={fullMachine ? "Resume machine" : "Run program"}
            title={
              fullMachine
                ? machinePowered
                  ? "Resume the emulated machine. To put this build on it, use Build and debug."
                  : "Power on the machine first"
                : artifact
                  ? "Continue the loaded program"
                  : "Supply the selected ROM set or build assembly first"
            }
            disabled={fullMachine ? !poweredMachine : !artifact}
            onClick={() =>
              poweredMachine ? sendMachine({ type: "run" }) : onRun()
            }
          >
            <Icon name="play" />
          </button>
          <button
            className="icon-button"
            type="button"
            /* Always Pause, because it always shows a pause icon. It used to
             * be called "Step instruction" when no machine was attached — a
             * pause icon that stepped, sharing its name with the step control
             * beside it, so two adjacent buttons announced themselves
             * identically and did the same thing. Stepping has its own control;
             * this one has nothing to pause when the ROM-less runtime is what
             * is loaded, because that runtime executes to completion rather
             * than running. */
            aria-label="Pause machine"
            title={
              fullMachine
                ? machinePowered
                  ? "Pause the emulated machine"
                  : "Power on the machine first"
                : "Nothing is running to pause: without a machine, a program runs to completion. Use Step to advance one instruction."
            }
            disabled={!poweredMachine}
            onClick={() => sendMachine({ type: "pause" })}
          >
            <Icon name="pause" />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Step instruction"
            title={
              adapterBlock("step") ??
              (fullMachine && !machinePowered
                ? "Power on the machine first"
                : "Execute one processor instruction")
            }
            disabled={
              (fullMachine ? !poweredMachine : !artifact) ||
              !!adapterBlock("step")
            }
            onClick={() =>
              poweredMachine ? sendMachine({ type: "step" }) : onStep()
            }
          >
            <Icon name="debug" />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Reset runtime"
            title={
              fullMachine
                ? machinePowered
                  ? "Hard reset the emulated machine"
                  : "Power on the machine first"
                : artifact
                  ? "Reset memory and registers"
                  : "No runtime is connected"
            }
            disabled={fullMachine ? !poweredMachine : !artifact}
            onClick={() =>
              poweredMachine
                ? sendMachine({
                    type: "reset",
                    ...(fullArchimedesMachine
                      ? { fastBootMs: archimedesFastBootMs }
                      : {}),
                  })
                : onReset()
            }
          >
            <Icon name="reset" />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label={
              (fullElectronMachine
                ? electronState?.audioEnabled
                : (machineAudio?.desired ?? machineAudio?.enabled))
                ? "Mute machine audio"
                : "Enable machine audio"
            }
            title={
              fullElectronMachine
                ? electronState?.audioEnabled
                  ? "Real ElkJS sound enabled · this core exposes no gain stage, so volume is fixed"
                  : "Enable real ElkJS sound"
                : runtimeSpeed !== 1 && full6502Machine
                ? "Machine audio is qualified only at authentic 1x runtime speed"
                : machineAudio?.available === false
                  ? "WebAudio is unavailable in this browser context"
                  : machineAudio?.requiresGesture
                    ? "Click Enable machine audio inside the emulated display to satisfy browser autoplay policy"
                    : machineAudio?.enabled
                      ? fullArchimedesMachine
                        ? `Real VIDC audio enabled · ${Number(machineAudio.queuedBytes ?? 0).toLocaleString()} queued bytes`
                        : `Real machine audio enabled · ${machineAudio.buffers.toLocaleString()} buffers`
                      : "Enable real machine audio"
            }
            disabled={
              !poweredMachine ||
              !(full6502Machine
                ? machineState
                : fullArchimedesMachine
                  ? archimedesState
                  : fullElectronMachine
                    ? electronState
                    : null) ||
              (!fullElectronMachine && machineAudio?.available === false) ||
              (full6502Machine && runtimeSpeed !== 1)
            }
            onClick={() => {
              const enabled = fullElectronMachine
                ? !electronState?.audioEnabled
                : !(machineAudio?.desired ?? machineAudio?.enabled);
              sendMachine({ type: "set-audio", enabled });
              onNotice(
                enabled ? "Enabling real machine audio" : "Machine audio muted",
              );
            }}
          >
            <Icon name="music" />
          </button>
          <label
            className="emulator-volume"
            title={
              fullArchimedesMachine
                ? "Unavailable for A310: the pinned SDL audio path has no qualified master gain"
                : (adapterBlock("set-volume") ?? `Machine volume ${machineVolume}%`)
            }
          >
            <span className="visually-hidden">Machine volume</span>
            <input
              aria-label="Machine volume"
              type="range"
              min="0"
              max="100"
              step="1"
              value={machineVolume}
              disabled={!poweredMachine || !full6502Machine || !machineState}
              onChange={(event) =>
                sendMachine({
                  type: "set-volume",
                  volume: Number(event.target.value),
                })
              }
            />
          </label>
          <button
            className={`emulator-record ${audioRecording ? "active" : ""}`}
            type="button"
            aria-label={
              audioRecording
                ? "Stop machine audio capture"
                : "Start machine audio capture"
            }
            title={
              audioRecording
                ? `Stop and download the bounded raw ${fullArchimedesMachine ? "stereo" : "mono"} PCM capture as WAV`
                : `Capture up to 10 seconds of raw ${fullArchimedesMachine ? "stereo" : "mono"} machine PCM as WAV`
            }
            disabled={
              !poweredMachine ||
              (!full6502Machine && !fullArchimedesMachine) ||
              (!machineState && !archimedesState) ||
              (!audioRecording &&
                (!machineAudio?.enabled || runtimeSpeed !== 1))
            }
            onClick={() =>
              sendMachine(
                audioRecording
                  ? { type: "stop-audio-capture" }
                  : { type: "start-audio-capture", seconds: 10 },
              )
            }
          >
            {audioRecording ? "STOP REC" : "REC"}
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Save machine state"
            title={
              fullArchimedesMachine
                ? "Unavailable for A310: the pinned Arculator core has no deterministic save-state API; a WebAssembly memory dump would omit SDL and filesystem state"
                : (adapterBlock("save-state") ??
                  "Download a versioned state of the live machine")
            }
            disabled={!poweredMachine || !machineState}
            onClick={() => sendMachine({ type: "save-state" })}
          >
            <Icon name="save" />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Load machine state"
            title={
              fullArchimedesMachine
                ? "Unavailable for A310 until the emulator core exposes a complete deterministic restore contract"
                : (adapterBlock("load-state") ??
                  "Restore a compatible versioned machine state")
            }
            disabled={!poweredMachine || !machineState}
            onClick={() => stateInputRef.current?.click()}
          >
            <Icon name="open" />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Capture machine screen"
            title="Download the current real framebuffer as PNG"
            disabled={
              !poweredMachine ||
              (!machineState && !archimedesState && !electronState)
            }
            onClick={() => sendMachine({ type: "capture-screen" })}
          >
            <Icon name="image" />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Toggle machine full screen"
            title="Show the real framebuffer full screen"
            disabled={
              !poweredMachine ||
              (!machineState && !archimedesState && !electronState)
            }
            onClick={() => void toggleFullScreen()}
          >
            <Icon name="expand" />
          </button>
          <button
            className="collapse-button"
            type="button"
            aria-label={collapsed ? "Expand emulator" : "Collapse emulator"}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? "↑" : "↓"}
          </button>
        </div>
      </div>
      {!collapsed && sessionManifest && (
        <details className="emulator-session-manifest">
          <summary>
            <strong>SESSION</strong>
            <code>{sessionManifest.fingerprint.slice(0, 12)}</code>
            <span>
              {sessionManifest.roms.length} ROM digest
              {sessionManifest.roms.length === 1 ? "" : "s"} ·{" "}
              {sessionManifest.substitutions.length
                ? `${sessionManifest.substitutions.length} substitution warning${sessionManifest.substitutions.length === 1 ? "" : "s"}`
                : "exact resolved profile"}
            </span>
          </summary>
          <div>
            <p>
              <strong>
                {sessionManifest.adapter.id}@{sessionManifest.adapter.version}
              </strong>{" "}
              ·{" "}
              <code>
                {sessionManifest.machine.platformClass}/
                {sessionManifest.machine.machineId}/
                {sessionManifest.machine.variant}/
                {sessionManifest.machine.romSetId}
              </code>
            </p>
            <p>
              Capabilities:{" "}
              {sessionManifest.machine.enabledCapabilities.join(", ") || "none"}{" "}
              · Tube {sessionManifest.boot.tube ? "enabled" : "disabled"} · Boot
              rate{" "}
              {sessionManifest.boot.fastBootMs
                ? `${sessionManifest.boot.fastBootMs.toLocaleString()} ms accelerated window`
                : "authentic"}
            </p>
            {sessionManifest.roms.map((rom) => (
              <p key={rom.key}>
                <strong>{rom.filename}</strong> · {rom.size.toLocaleString()}{" "}
                bytes · <code title={rom.sha256}>{rom.sha256}</code>
              </p>
            ))}
            {sessionManifest.limitations.map((limitation) => (
              <p className="honest-note" key={limitation}>
                {limitation}
              </p>
            ))}
          </div>
        </details>
      )}
      {!collapsed && programManifest && (
        <details className="emulator-session-manifest program-load-manifest">
          <summary>
            <strong>PROGRAM</strong>
            <code>{programManifest.fingerprint.slice(0, 12)}</code>
            <span>
              {programManifest.mode} · {programManifest.name} ·{" "}
              {programManifest.bytes.toLocaleString()} bytes
            </span>
          </summary>
          <div>
            <p>
              <strong>
                {programManifest.source === "build"
                  ? `${programManifest.build?.targetName} · ${programManifest.build?.toolchainId}@${programManifest.build?.toolchainVersion}`
                  : `${programManifest.host?.container} · ${programManifest.host?.filename}`}
              </strong>
            </p>
            {programManifest.placement === "interpreter-page" ? (
              <p>6502 · BBC BASIC tokens · guest address resolved from PAGE by the live interpreter</p>
            ) : programManifest.placement === "keyboard-queue" ? (
              <p>6502 · Atom BASIC text · entered through the paced live keyboard and interpreter</p>
            ) : (
              <p>
                {programManifest.processor} · origin{" "}
                <code>{formatAddress(programManifest.origin, programManifest.processor === "arm2" ? 8 : 4)}</code>{" "}
                · entry{" "}
                <code>{formatAddress(programManifest.entryPoint, programManifest.processor === "arm2" ? 8 : 4)}</code>
              </p>
            )}
            <p>
              Output SHA-256 <code>{programManifest.outputSha256}</code>
            </p>
            <p>
              Runtime session <code>{programManifest.sessionFingerprint}</code>
            </p>
            <button type="button" onClick={exportRuntimeRunRecord}>
              <Icon name="download" size={14} /> Export run record
            </button>
          </div>
        </details>
      )}
      {!collapsed && inputControlsOpen && poweredMachine && (
        <section
          id="machine-input-controls"
          className="machine-input-controls"
          aria-label="Machine keyboard and input controls"
        >
          <header>
            <div>
              <strong>Machine input</strong>
              <span>
                {inputCaptured
                  ? "Keyboard focus is captured by the emulator"
                  : "IDE shortcuts remain active until input is captured"}
              </span>
            </div>
            <button
              type="button"
              onClick={() =>
                sendMachine({
                  type: inputCaptured ? "release-input" : "focus-input",
                })
              }
            >
              {inputCaptured ? "Release input" : "Capture input"}
            </button>
            <button
              type="button"
              aria-label="Close machine input controls"
              onClick={() => setInputControlsOpen(false)}
            >
              <Icon name="close" size={14} />
            </button>
          </header>
          <div className="machine-input-grid">
            <section aria-label="On-screen Acorn keyboard">
              <h3>Acorn keyboard</h3>
              <p>
                {fullArchimedesMachine
                  ? "The A310 canvas accepts the host keyboard and reviewed text. On-screen key taps await a verified SDL mapping."
                  : "Keys below use jsbeeb host-key identities and operate the live keyboard matrix."}
              </p>
              <div
                className="acorn-keyboard"
                aria-label="Accessible on-screen Acorn keyboard"
              >
                {ACORN_KEY_ROWS.map((row, rowIndex) => (
                  <div key={rowIndex}>
                    {row.map((key) => (
                      <button
                        type="button"
                        key={`${key.label}-${key.code}`}
                        disabled={fullArchimedesMachine}
                        aria-label={`Press Acorn ${key.label} key`}
                        onClick={() =>
                          sendMachine({ type: "tap-key", code: key.code })
                        }
                      >
                        {key.label}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </section>
            <section
              className="machine-input-policy"
              aria-label="Keyboard mapping and pasted text policy"
            >
              <h3>Mapping and text queue</h3>
              {full6502Machine && (
                <label>
                  <span>jsbeeb mapping profile</span>
                  <select
                    value={keyboardLayout}
                    onChange={(event) => {
                      const layout = event.target.value as JsBeebKeyboardLayout;
                      setKeyboardLayout(layout);
                      writeSetting("machine.keyboardLayout", layout);
                      sendMachine({ type: "set-keyboard-layout", layout });
                    }}
                  >
                    {JSBEEB_KEYBOARD_LAYOUTS.map((layout) => (
                      <option value={layout.id} key={layout.id}>
                        {layout.label}
                      </option>
                    ))}
                  </select>
                  <small>
                    {
                      JSBEEB_KEYBOARD_LAYOUTS.find(
                        (layout) => layout.id === keyboardLayout,
                      )?.detail
                    }
                  </small>
                </label>
              )}
              <label>
                <span>Reviewed machine text</span>
                <textarea
                  maxLength={MACHINE_TEXT_LIMIT}
                  value={machineText}
                  onChange={(event) => setMachineText(event.target.value)}
                  placeholder="Type or paste plain ASCII text to queue"
                />
                <small>
                  {machineText.length.toLocaleString()} /{" "}
                  {MACHINE_TEXT_LIMIT.toLocaleString()} characters. CR is
                  normalized to RETURN. Unsupported Unicode is refused.
                </small>
              </label>
              <button
                type="button"
                disabled={!machineText.length}
                onClick={() =>
                  sendMachine({ type: "inject-text", text: machineText })
                }
              >
                Queue text to live machine
              </button>
              <aside>
                <strong>Browser conflicts</strong>
                <span>
                  F12 is captured as BREAK only after emulator focus. Ctrl, Alt
                  and browser-reserved shortcuts can remain browser-owned. Use
                  the on-screen keys or gaming profile on BBC-family targets
                  when a host shortcut wins.
                </span>
              </aside>
            </section>
            {full6502Machine && (
              <section
                className="machine-key-remaps"
                aria-label="Custom host key mappings"
              >
                <h3>Custom key mappings</h3>
                <p>
                  Map a maintained host key identity to an Acorn key after the
                  selected jsbeeb profile. Browser-reserved shortcuts can still
                  remain unavailable.
                </p>
                <div>
                  <label>
                    <span>Host key</span>
                    <select
                      aria-label="Custom mapping host key"
                      value={remapHostCode}
                      onChange={(event) =>
                        setRemapHostCode(Number(event.target.value))
                      }
                    >
                      {HOST_REMAP_KEYS.map((key) => (
                        <option value={key.code} key={key.code}>
                          {key.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Acorn key</span>
                    <select
                      aria-label="Custom mapping Acorn key"
                      value={remapTargetCode}
                      onChange={(event) =>
                        setRemapTargetCode(Number(event.target.value))
                      }
                    >
                      {ACORN_KEY_ROWS.flat().map((key) => (
                        <option
                          value={key.code}
                          key={`${key.label}-${key.code}`}
                        >
                          {key.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={keyRemaps.length >= 32}
                    onClick={() =>
                      applyKeyRemaps([
                        ...keyRemaps.filter(
                          (remap) => remap.hostCode !== remapHostCode,
                        ),
                        {
                          hostCode: remapHostCode,
                          targetCode: remapTargetCode,
                        },
                      ])
                    }
                  >
                    Add or replace mapping
                  </button>
                </div>
                {keyRemaps.length ? (
                  <ul>
                    {keyRemaps.map((remap) => (
                      <li key={remap.hostCode}>
                        <span>
                          {
                            HOST_REMAP_KEYS.find(
                              (key) => key.code === remap.hostCode,
                            )?.label
                          }{" "}
                          →{" "}
                          {
                            ACORN_KEY_ROWS.flat().find(
                              (key) => key.code === remap.targetCode,
                            )?.label
                          }
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove custom mapping for ${HOST_REMAP_KEYS.find((key) => key.code === remap.hostCode)?.label}`}
                          onClick={() =>
                            applyKeyRemaps(
                              keyRemaps.filter(
                                (item) => item.hostCode !== remap.hostCode,
                              ),
                            )
                          }
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <small>
                    No custom mappings. The selected jsbeeb profile applies
                    unchanged.
                  </small>
                )}
                <button
                  type="button"
                  disabled={!keyRemaps.length}
                  onClick={() => applyKeyRemaps([])}
                >
                  Clear custom mappings
                </button>
              </section>
            )}
            {full6502Machine && (
              <section className="machine-gamepad" aria-label="Gamepad input">
                <h3>Gamepad</h3>
                <label className="gamepad-enabled">
                  <input
                    type="checkbox"
                    checked={gamepadConfig.enabled}
                    onChange={(event) => {
                      if (event.target.checked && bbcMouseJoystick) applyBbcMouseJoystick(false);
                      applyGamepadConfig({ ...gamepadConfig, enabled: event.target.checked });
                    }}
                  />{" "}
                  Enable standard gamepad polling
                </label>
                <p>{gamepadStatus}</p>
                <div className="gamepad-config">
                  <label>
                    <span>Controller</span>
                    <select
                      aria-label="Gamepad controller index"
                      value={gamepadConfig.gamepadIndex}
                      onChange={(event) =>
                        applyGamepadConfig({
                          ...gamepadConfig,
                          gamepadIndex: Number(event.target.value),
                        })
                      }
                    >
                      {[0, 1, 2, 3].map((index) => (
                        <option value={index} key={index}>
                          Gamepad {index + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Interface</span>
                    <select
                      aria-label="Gamepad machine interface"
                      value={gamepadConfig.interfaceMode}
                      onChange={(event) =>
                        applyGamepadConfig({
                          ...gamepadConfig,
                          interfaceMode: event.target
                            .value as GamepadInputConfig["interfaceMode"],
                        })
                      }
                    >
                      <option value="keys">Acorn key mapping</option>
                      <option
                        value="bbc-analogue"
                        disabled={
                          !["bbc-a", "bbc-b", "bbc-bplus", "master"].includes(
                            machineProfile.machineId,
                          )
                        }
                      >
                        BBC analogue port
                      </option>
                      <option value="atom-atommc" disabled={!atomMmcJoystickSupported}>
                        Atom AtoMMC port
                      </option>
                    </select>
                  </label>
                  <label>
                    <span>Axis dead zone</span>
                    <input
                      aria-label="Gamepad axis dead zone"
                      type="number"
                      min="0.1"
                      max="0.9"
                      step="0.05"
                      value={gamepadConfig.deadZone}
                      onChange={(event) =>
                        applyGamepadConfig({
                          ...gamepadConfig,
                          deadZone: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  {gamepadConfig.interfaceMode === "keys" &&
                    GAMEPAD_ACTIONS.map((action) => (
                      <label key={action.id}>
                        <span>{action.label}</span>
                        <select
                          aria-label={`Gamepad ${action.label} Acorn key`}
                          value={gamepadConfig.mapping[action.id]}
                          onChange={(event) =>
                            applyGamepadConfig({
                              ...gamepadConfig,
                              mapping: {
                                ...gamepadConfig.mapping,
                                [action.id]: Number(event.target.value),
                              },
                            })
                          }
                        >
                          {ACORN_KEY_ROWS.flat().map((key) => (
                            <option
                              value={key.code}
                              key={`${action.id}-${key.label}-${key.code}`}
                            >
                              {key.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                </div>
                <output aria-live="polite">
                  {gamepadConfig.interfaceMode === "bbc-analogue"
                    ? "Axes 0 to 3 feed ADC channels 0 to 3. Buttons 0 and 1 feed active-low System VIA PB4 and PB5."
                    : gamepadConfig.interfaceMode === "atom-atommc"
                      ? "Axes 0/1 and the d-pad feed the active-low AtoMMC direction bits. Either fire button feeds its single fire bit."
                    : gamepadActive.length
                      ? `Held: ${gamepadActive.map((id) => GAMEPAD_ACTIONS.find((action) => action.id === id)?.label).join(", ")}`
                      : "No mapped controls held"}
                </output>
                <small>
                  {gamepadConfig.interfaceMode === "bbc-analogue"
                    ? "BBC joystick axes are inverted by hardware convention: left and up are 65,535, right and down are 0. Disconnect centres all channels and releases both fire inputs."
                    : gamepadConfig.interfaceMode === "atom-atommc"
                      ? "Guest software reads the five active-low controls with AtoMMC CMD_READ_PORT at &B400. Disconnect returns the port to &FF."
                    : "Standard axes 0/1, d-pad buttons 12 to 15 and buttons 0/1 generate real held key edges. Disconnect releases every active key."}
                </small>
              </section>
            )}
            {bbcAnalogueSupported && (
              <section className="machine-bbc-mouse-joystick" aria-label="BBC mouse analogue joystick">
                <h3>Mouse analogue joystick</h3>
                <label>
                  <input
                    type="checkbox"
                    checked={bbcMouseJoystick}
                    onChange={(event) => applyBbcMouseJoystick(event.target.checked)}
                  />{" "}
                  Drive the BBC analogue port from the live display
                </label>
                <output aria-live="polite">{bbcMouseJoystickStatus}</output>
                <small>
                  Pointer position feeds ADC channels 0 and 1 using the BBC
                  inverted convention. Left and right buttons feed active-low
                  System VIA PB4 and PB5. Leaving the display or losing focus
                  centres both axes and releases fire. Enabling this mode
                  disables standard gamepad polling so two host devices cannot
                  fight over the same hardware input.
                </small>
              </section>
            )}
            {fullArchimedesMachine && (
              <section
                className="machine-archimedes-mouse"
                aria-label="A310 mouse input"
              >
                <h3>A310 mouse</h3>
                <p>
                  Move over the live display for absolute RISC OS pointer input.
                  Left, right and middle buttons use Arculator's real host mouse
                  path.
                </p>
                <output aria-live="polite">{archimedesMouseStatus}</output>
                <small>
                  Canvas coordinates are scaled to the live framebuffer. Leaving
                  the display, releasing input, losing focus, resetting or
                  powering off releases every mouse button.
                </small>
              </section>
            )}
          </div>
        </section>
      )}
      {!collapsed &&
        (poweredMachine ? (
          <div
            className={`machine-frame-wrap scale-${emulatorScale}`}
            ref={machineFrameRef}
          >
            <iframe
              key={`${frameSource}:${frameGeneration}`}
              ref={frameRef}
              src={frameSource}
              title={`${machine} hardware emulator`}
              sandbox="allow-scripts allow-same-origin"
              allow="fullscreen; autoplay"
              onLoad={() => setFrameLoaded(true)}
              style={scaledViewport}
            />
            <button
              className="fullscreen-exit"
              type="button"
              aria-label="Exit machine full screen"
              onClick={() => void toggleFullScreen()}
            >
              <Icon name="close" size={15} /> Exit full screen
            </button>
            <div className="machine-bridge-state">
              <span>
                {machineError
                  ? "adapter error"
                  : fullElectronMachine
                  ? electronState?.running
                    ? "running"
                    : electronState
                      ? "paused"
                      : "waiting for firmware"
                  : fullArchimedesMachine
                    ? archimedesState?.fastBootActive
                      ? "fast boot"
                      : archimedesState?.running
                        ? "running"
                        : archimedesState
                          ? "paused"
                          : archimedesInitialisation
                    : machineState?.running
                      ? "running"
                      : machineState
                        ? "paused"
                        : "booting"}
              </span>
              {fullArchimedesMachine && archimedesState && (
                <>
                  <strong>PC {formatAddress(archimedesState.pc, 8)}</strong>
                  <small>
                    {archimedesState.fastBootActive
                      ? `${archimedesState.fastBootPercent}% · ${archimedesState.emulationMs.toLocaleString()} ms emulated`
                      : archimedesState.breakAddress === null
                        ? `${archimedesState.hookCount.toLocaleString()} ARM instructions observed`
                        : `breakpoint ${formatAddress(archimedesState.breakAddress, 8)}`}
                  </small>
                </>
              )}
              {fullArchimedesMachine && !archimedesState && (
                <small>Real core state will attach after this phase</small>
              )}
              {fullElectronMachine && electronState?.registers && (
                <>
                  <strong>PC {formatAddress(electronState.registers.pc)}</strong>
                  <small>
                    {machineProgram ??
                      `A ${formatByte(electronState.registers.a)} X ${formatByte(electronState.registers.x)} Y ${formatByte(electronState.registers.y)} · ${electronState.registers.source}`}
                  </small>
                </>
              )}
              {!fullArchimedesMachine && !fullElectronMachine && machineState && (
                <>
                  <strong>PC {formatAddress(machineState.registers.pc)}</strong>
                  <small>
                    {machineProgram ??
                      `${machineState.cycles.toLocaleString()} emulated cycles · ${machineState.speed}x`}
                  </small>
                </>
              )}
              {machineError && (
                <>
                  <small>{machineError}</small>
                  <button
                    type="button"
                    onClick={() => {
                      setMachineError(undefined);
                      setFrameGeneration((value) => value + 1);
                      onNotice(
                        "Restarting the isolated emulator with a new session",
                      );
                    }}
                  >
                    Restart adapter
                  </button>
                </>
              )}
            </div>
          </div>
        ) : fullMachine && !machinePowered ? (
          <div className="emulator-empty emulator-powered-off">
            <Icon name="power" size={27} />
            <div>
              <strong>{machine} is powered off</strong>
              <p>
                The isolated emulator and volatile RAM have been released.
                Mounted media acknowledgements were cleared. Select Power on
                machine to boot a new session from the configured ROMs.
              </p>
            </div>
          </div>
        ) : artifact && state ? (
          <div className="runtime-console">
            <div className="runtime-console-status">
              <span>{state.status}</span>
              <strong>PC {formatAddress(state.registers.pc)}</strong>
              <small>{state.instructions.toLocaleString()} instructions</small>
            </div>
            <pre>
              {state.output ||
                "6502 runtime loaded. Program output through OSWRCH/OSASCI/OSNEWL will appear here."}
            </pre>
            <p>
              ROM-less 6502 diagnostic runtime with MOS output shims · not a
              full {machine} hardware emulation
            </p>
          </div>
        ) : (
          <div className="emulator-empty">
            <Icon name="screen" size={27} />
            <div>
              <strong>
                {machineModel || archimedesRuntime
                  ? "ROM set not ready"
                  : "No machine adapter"}
              </strong>
              <p>
                {machineModel || archimedesRuntime
                  ? "Open Settings and supply the selected ROM files to activate real video, keyboard input and hardware execution."
                  : "Open a 6502 assembly file, then Build, Run or Debug. This target does not yet have a qualified full-machine adapter."}
              </p>
            </div>
          </div>
        ))}
      {fullElectronMachine && !collapsed && (
        <details className="adapter-capability-note">
          <summary>
            {electronRoute?.label ?? "ElkJS"} Electron adapter ·{" "}
            {(electronState?.capabilities ?? declaredCapabilities).length} of{" "}
            {(electronState?.capabilities ?? declaredCapabilities).length +
              Object.keys(electronState?.unavailable ?? declaredUnavailable)
                .length}{" "}
            capabilities offered
          </summary>
          <p>
            {elkulatorMachine
              ? ELKULATOR_ADAPTER_SUMMARY
              : ELECTRON_ADAPTER_SUMMARY}
          </p>
          <ul>
            {Object.entries(
              electronState?.unavailable ?? declaredUnavailable,
            ).map(([capability, reason]) => (
              <li key={capability}>
                <strong>{capability}</strong>
                <span>{reason}</span>
              </li>
            ))}
          </ul>
          <p className="adapter-capability-source">
            {electronState
              ? "Declared by the running core over the debug channel."
              : "Declared by this build; the running core republishes it on attach."}
          </p>
        </details>
      )}
    </section>
  );
}

export default App;
