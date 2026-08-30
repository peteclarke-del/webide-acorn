import { fake6502 } from 'jsbeeb/src/fake6502.js';
import { findModel } from 'jsbeeb/src/models.js';
import { Video } from 'jsbeeb/src/video.js';
import { Keyboard } from 'jsbeeb/src/keyboard.js';
import { discFor } from 'jsbeeb/src/fdc.js';
import { loadTapeFromData } from 'jsbeeb/src/tapes.js';
import { createSnapshot, restoreSnapshot, snapshotFromJSON, snapshotToJSON } from 'jsbeeb/src/snapshot.js';
import { BrowserAudio } from './browserAudio';
import { CommandSequence } from './commandSequence';
import { breakpointMatches, renderBreakpointLog, validateBreakpointSpec, type BreakpointSpec } from './breakpointModel';
import { commandBelongsToSession, type DebugCapability, type DebugCommandAudit, type DebugProtocolSnapshot } from './debugProtocol';
import { validateWatchpointSpec, watchpointKey, watchpointMatches, type WatchpointSpec } from './watchpointModel';
import { validateRegisterPatch, type Editable6502Register } from './registerEditModel';
import { decodeInstructionState, type DecodedInstructionState } from './instructionState';
import { traceInstructionMatches, traceTriggerMatches, validateTraceConfig, type TraceConfig, type TraceEventKind } from './traceModel';
import { validateLiveDisassemblyRequest } from './liveDisassemblyModel';
import { createMemoryMapState, mappedAddressIdentity, physicalMemoryIndex, validateMemorySpaceRead, type MappedAddressIdentity, type MemorySpaceId } from './memoryMapModel';
import { compareHardwareGroups, field, flagFields, packKeyboardColumn, type HardwareGroupDraft, type HardwareInspection, type HardwareRegisterDraft } from './hardwareInspectorModel';
import { rasterEvents, rasterPositionMatches, validateRasterConfig, type RasterConfig, type RasterEventKind, type RasterSample } from './rasterTimelineModel';
import { DEFAULT_PROFILER_CONFIG, profileBuildFingerprint, profilerMemoryRegion, validateProfilerConfig, type ProfilerConfig } from './profilerModel';
import { DEFAULT_REPLAY_CONFIG, appendReplayWriteDigest, replayVerificationMatches, validateReplayConfig, type ReplayConfig, type ReplayVerificationState } from './replayModel';
import { appendCrashDiagnostic, EMPTY_FRAME_PERFORMANCE, observeFrame, type RuntimeCrashDiagnostic } from './runtimePerformanceModel';
import { MOS_TEST_EVENT_ADDRESSES, type MachineAssertion, type MosTestEvent } from '../testing/testPlan';
import { EMULATOR_SCREEN_WIDTH, base64ToBytes, compareFramebufferRegion, framebufferRegionFnv32, validateScreenRegion } from '../testing/screenAssertion';
import { validateTapeImage } from '../media/tapeFormat';
import { isJsBeebKeyboardLayout, validateMachineTapCode, validateMachineText } from './keyboardInputModel';
import { cyclesForPresentationFrame, validateRuntimeSpeed, type RuntimeSpeed } from './runtimeSpeedModel';
import { validateRuntimeSessionManifest, type RuntimeSessionManifest } from './runtimeSessionManifest';
import { validateEmulatorDisplayFilter, validateMachineVolume } from './audioDisplayControlModel';
import { createMachineStateEnvelope, openMachineStateEnvelope, MACHINE_STATE_LIMIT } from './machineStateEnvelope';
import { encodeMonoPcm16Wav, validateAudioCaptureSeconds } from './wavCapture';
import { validateProgramLoadManifest, type ProgramLoadManifest } from './programLoadManifest';
import { validateMachineKeyRemaps, type MachineKeyRemap } from './keyRemapModel';
import { GAMEPAD_ACTIONS, type AtomMmcJoystickState, type GamepadAction } from './gamepadInputModel';
import { setBaseUrl, stringToBBCKeys } from 'jsbeeb/src/utils.js';
import { stringToATOMKeys } from 'jsbeeb/src/utils_atom.js';
import './runtime.css';

const WIDTH = 1024;
const HEIGHT = 625;
const FRAME_RATE = 50;
const FRAME_BUDGET_MS = 1000 / FRAME_RATE;
const RUNTIME_BUDGETS = Object.freeze({ activeSessions: 1, frameBudgetMs: FRAME_BUDGET_MS, snapshotIntervalMs: 200, audioSampleIntervalMs: 500, crashCapacity: 16, traceCapacity: 4096, mediaBytesPerDrive: 2 * 1024 * 1024 });
const canvas = document.querySelector<HTMLCanvasElement>('#machine-screen')!;
const status = document.querySelector<HTMLDivElement>('#machine-status')!;
const audioActivation = document.querySelector<HTMLButtonElement>('#audio-activation')!;
const context = canvas.getContext('2d', { alpha: false })!;
let cpu: JsBeebCpu | null = null;
let keyboard: Keyboard | null = null;
let video: Video | null = null;
let framebuffer = new Uint32Array(WIDTH * HEIGHT);
let browserAudio: BrowserAudio | null = null;
let audioEnabled = false;
let runtimeSpeed: RuntimeSpeed = 1;
let runtimeSessionManifest: RuntimeSessionManifest | null = null;
let loadedProgramManifest: ProgramLoadManifest | null = null;
let keyRemaps = new Map<number, number>();
let analogueJoystickChannels: [number, number, number, number] = [0x8000, 0x8000, 0x8000, 0x8000];
let atomMmcGamepadButtons = Array<boolean>(16).fill(false);
let bbcMouseJoystickEnabled = false;
let bbcMouseJoystickButtons: [boolean, boolean] = [false, false];
let lastAudioSnapshot = 0;
let running = false;
let frameRequest = 0;
let lastSnapshot = 0;
let emulatedCycles = 0;
let framePerformance = { ...EMPTY_FRAME_PERFORMANCE };
let lastFrameAt = 0;
let backgroundSuspended = document.hidden;
let resumeAfterBackground = false;
let crashDiagnostics: RuntimeCrashDiagnostic[] = [];
let crashSequence = 0;
const commandSequence = new CommandSequence();
let trace: Array<{ address: number; instruction: string; bytes: number[] }> = [];
interface InstalledBreakpoint { hook: JsBeebDebugHookHandle; spec: BreakpointSpec; hits: number }
interface BreakpointLogEntry { sequence: number; address: number; hits: number; message: string }
const breakpointHooks = new Map<number, InstalledBreakpoint>();
let breakpointLogs: BreakpointLogEntry[] = [];
let breakpointLogSequence = 0;
interface InstalledWatchpoint { hook: JsBeebDebugHookHandle; spec: WatchpointSpec; hits: number; previousValue?: number; lastValue?: number; pc?: number }
interface WatchpointEvent { sequence: number; address: number; pc: number; access: WatchpointSpec['access']; hits: number; previousValue?: number; value: number }
const watchpointHooks = new Map<string, InstalledWatchpoint>();
let watchpointEvents: WatchpointEvent[] = [];
let watchpointSequence = 0;
let watchInstructionHook: JsBeebDebugHookHandle | null = null;
let watchInstructionPc = 0;
let watchpointsSuspended = false;
type RegisterSnapshot = Record<Editable6502Register, number>;
interface RegisterEditEntry { sequence: number; before: RegisterSnapshot; after: RegisterSnapshot; changed: Editable6502Register[] }
let registerEdits: RegisterEditEntry[] = [];
let registerEditSequence = 0;
interface InterruptSnapshot { irqSourceMask: number; irqLine: boolean; irqAccepted: boolean; nmiLevel: boolean; nmiEdge: boolean; interruptDisable: boolean }
interface InterruptSourceState { id: string; label: string; pending: boolean; enabled: boolean; source: string }
interface InterruptHistoryEvent { sequence: number; timeMs: number; cycle: number; pc: number; kind: 'irq-line' | 'irq-accepted' | 'nmi-line' | 'nmi-edge' | 'handler-enter' | 'handler-exit'; detail: string; traceSequence?: number; sources: InterruptSourceState[] }
interface InterruptMonitorSample { pc: number; opcode: number; s: number; p: number; state: InterruptSnapshot }
let interruptMonitorEnabled = false;
let interruptMonitorCapacity = 128;
let interruptMonitorHook: JsBeebDebugHookHandle | null = null;
let interruptMonitorPrevious: InterruptMonitorSample | null = null;
let interruptHistory: InterruptHistoryEvent[] = [];
let interruptHistorySequence = 0;
let interruptHandlerDepth = 0;
interface RasterTimelineEvent extends RasterSample { sequence: number; timeMs: number; cycle: number; pc: number; event: RasterEventKind; detail: string }
let rasterMonitorEnabled = false;
let rasterMonitorHook: JsBeebDebugHookHandle | null = null;
let rasterConfig: RasterConfig = { capacity: 256, recordHSync: false, sampleEveryScanlines: 16 };
let rasterPrevious: RasterSample | null = null;
let rasterTimeline: RasterTimelineEvent[] = [];
let rasterSequence = 0;
let rasterDroppedEvents = 0;
let rasterLastMatchedFrame: number | undefined;
interface LastStepState { instruction: DecodedInstructionState; before: RegisterSnapshot; after: RegisterSnapshot; cycles: number; changed: Editable6502Register[]; flagsChanged: string[]; interruptBefore: InterruptSnapshot; interruptAfter: InterruptSnapshot }
let lastStep: LastStepState | null = null;
interface TraceMemoryAccess { type: 'read' | 'write'; address: number; value: number; previousValue?: number; addressSpace: 'mapped 6502'; mapping: MappedAddressIdentity; cycle: number; timeMs: number }
interface TraceSourceLocation { fileName: string; line: number }
interface TraceRecord { sequence: number; timeMs: number; cycle: number; cycles: number; cpu: string; pc: number; addressSpace: 'mapped 6502'; bank: string; mapping: MappedAddressIdentity; instruction: DecodedInstructionState; before: RegisterSnapshot; after: RegisterSnapshot; changed: Editable6502Register[]; flagsChanged: string[]; accesses: TraceMemoryAccess[]; droppedAccesses: number; interruptBefore: InterruptSnapshot; interruptAfter: InterruptSnapshot; source?: TraceSourceLocation; symbol?: string; trigger?: string }
interface PendingTrace { pc: number; startedAtCycle: number; instruction: DecodedInstructionState; mapping: MappedAddressIdentity; before: RegisterSnapshot; interruptBefore: InterruptSnapshot; accesses: TraceMemoryAccess[]; droppedAccesses: number }
interface UnifiedTraceEvent { sequence: number; timeMs: number; cycle: number; cpu: string; kind: TraceEventKind; pc: number; pcMapping: MappedAddressIdentity; detail: string; instructionSequence: number; source?: TraceSourceLocation; symbol?: string; address?: number; addressMapping?: MappedAddressIdentity; value?: number; previousValue?: number }
let traceEnabled = false;
let traceConfig: TraceConfig = { capacity: 256, sampleEvery: 1, captureBus: true, eventKinds: ['instruction'], pauseOnMatch: false, preTriggerRecords: 0, postTriggerRecords: 0, pauseOnTrigger: false };
let traceRecords: TraceRecord[] = [];
let traceWriteIndex = 0;
let traceDroppedRecords = 0;
let traceSequence = 0;
let traceTriggeredSequence: number | undefined;
let tracePostRemaining: number | undefined;
let traceTriggerComplete = false;
let traceDiscardedByTrigger = 0;
let traceCandidateInstructions = 0;
let traceSkippedBySampling = 0;
let unifiedTraceEvents: UnifiedTraceEvent[] = [];
let unifiedTraceEventSequence = 0;
let unifiedTraceEventsDropped = 0;
let tracePending: PendingTrace | null = null;
let traceInstructionHook: JsBeebDebugHookHandle | null = null;
let traceReadHook: JsBeebDebugHookHandle | null = null;
let traceWriteHook: JsBeebDebugHookHandle | null = null;
let loadedSourceLocations: Record<number, TraceSourceLocation> = {};
let loadedSymbols: Record<number, string> = {};
interface ProfilerAddressEntry { address: number; instructions: number; cycles: number; minCycles: number; maxCycles: number; symbol?: string; source?: TraceSourceLocation }
interface ProfilerFrameEntry { frame: number; cycles: number; instructions: number }
interface ProfilerBusEntry { region: string; reads: number; writes: number }
interface PendingProfileInstruction { pc: number; opcode: number; startedAtCycle: number }
let profilerEnabled = false;
let profilerConfig: ProfilerConfig = DEFAULT_PROFILER_CONFIG;
let profilerInstructionHook: JsBeebDebugHookHandle | null = null;
let profilerReadHook: JsBeebDebugHookHandle | null = null;
let profilerWriteHook: JsBeebDebugHookHandle | null = null;
let profilerPending: PendingProfileInstruction | null = null;
let profilerAddresses = new Map<number, ProfilerAddressEntry>();
let profilerCalls = new Map<number, number>();
let profilerFrames: ProfilerFrameEntry[] = [];
let profilerBus = new Map<string, ProfilerBusEntry>();
let profilerInstructions = 0;
let profilerCycles = 0;
let profilerUntrackedInstructions = 0;
let profilerFrame = 0;
let profilerFrameCycles = 0;
let profilerFrameInstructions = 0;
let loadedProgramFingerprint = 'ROM-session';
interface ReplayBoundary extends ReplayVerificationState { index: number; emulatedCycles: number; source?: TraceSourceLocation; symbol?: string }
interface ReplayCheckpoint extends ReplayBoundary { state: unknown; bytes: number }
let replayEnabled = false;
let replayConfig: ReplayConfig = DEFAULT_REPLAY_CONFIG;
let replayInstructionHook: JsBeebDebugHookHandle | null = null;
let replayWriteHook: JsBeebDebugHookHandle | null = null;
let replayBoundaries: ReplayBoundary[] = [];
let replayCheckpoints: ReplayCheckpoint[] = [];
let replayIndex = 0;
let replayLastCycle = 0;
let replayWriteDigest = 0x811c9dc5;
let replayInProgress = false;
let replayBoundaryReason = 'No irreversible boundary in this segment';
let replayLastVerification = 'No replay attempted';
let replaySegment = 0;
let runToHook: JsBeebDebugHookHandle | null = null;
type HardwareTestCapture = { id: string; kind: 'registers' } | { id: string; kind: 'memory'; address: number; length: number };
type HardwareTestInput = { kind: 'delay'; cycles: number } | { kind: 'key'; code: string; pressed: boolean } | { kind: 'gamepad'; action: GamepadAction; code: number; pressed: boolean } | { kind: 'bbc-analogue'; channels: [number, number, number, number]; buttons: [boolean, boolean] } | { kind: 'bbc-mouse'; x: number; y: number; buttons: [boolean, boolean] } | { kind: 'atom-atommc'; up: boolean; down: boolean; left: boolean; right: boolean; fire: boolean } | { kind: 'media'; action: 'eject-disc-0' | 'eject-disc-1' | 'eject-tape' | 'mount-initial-disc-0' | 'mount-initial-disc-1' | 'mount-initial-tape' } | { kind: 'emulator-event'; event: 'next-video-frame' } | { kind: 'reset'; reset: 'hard' | 'soft' };
interface ActiveHardwareTest { name: string; requestId?: string; planId?: string; suite?: string; buildFingerprint?: string; assertions: MachineAssertion[]; output: string; eventCounts: Record<MosTestEvent, number>; addressEventCounts: Map<number, number>; captures: HardwareTestCapture[]; inputs: HardwareTestInput[]; initialDiscs: Map<number, { name: string; bytes: Uint8Array }>; initialTape: typeof mountedTape; inputIndex: number; delayUntil: number | null; eventFrameStart: number | null; appliedInputs: number; teardown: 'pause' | 'reset'; startCycles: number; deadline: number; stopAddress: number; hook: JsBeebDebugHookHandle; reached: boolean }
let activeHardwareTest: ActiveHardwareTest | null = null;
function discardHardwareTest() {
  if (!activeHardwareTest) return;
  activeHardwareTest.hook.remove();
  (keyboard as unknown as { clearKeys?: () => void } | null)?.clearKeys?.();
  activeHardwareTest = null;
  browserAudio?.endTestCapture();
}

function applyBbcAnalogueJoystick(channels: number[], buttons: boolean[]) {
  if (!cpu || cpu.model.isAtom || !Array.isArray(channels) || channels.length !== 4 || channels.some((value) => !Number.isInteger(value) || value < 0 || value > 0xffff) || !Array.isArray(buttons) || buttons.length !== 2 || buttons.some((value) => typeof value !== 'boolean')) throw new Error('BBC analogue joystick state requires four 16-bit ADC channels and two button states');
  analogueJoystickChannels = channels as [number, number, number, number];
  const systemVia = cpu.sysvia as unknown as { setJoystickButton: (button: number, pressed: boolean) => void; getJoysticks: () => { button1: boolean; button2: boolean } };
  systemVia.setJoystickButton(0, buttons[0]!); systemVia.setJoystickButton(1, buttons[1]!);
  const converter = cpu.adconverter as unknown as { getChannelSource: (channel: number) => { getValue: (channel: number) => number } | null };
  const verifiedChannels = [0, 1, 2, 3].map((channel) => converter.getChannelSource(channel)?.getValue(channel) ?? -1);
  const joystickButtons = systemVia.getJoysticks();
  const verifiedButtons = [joystickButtons.button1, joystickButtons.button2];
  if (verifiedChannels.some((value, channel) => value !== analogueJoystickChannels[channel]) || verifiedButtons.some((value, button) => value !== buttons[button])) throw new Error('BBC analogue joystick hardware readback did not match the requested state');
  return { verifiedChannels, verifiedButtons };
}

function applyAtomMmcJoystick(state: Omit<AtomMmcJoystickState, 'port'>) {
  if (!cpu?.model.isAtom || !cpu.atommc || !runtimeSessionManifest?.machine.enabledCapabilities.includes('atommc')) throw new Error('Atom AtoMMC joystick input requires a live Atom session with AtoMMC enabled');
  if (['up', 'down', 'left', 'right', 'fire'].some((key) => typeof state[key as keyof typeof state] !== 'boolean')) throw new Error('Atom AtoMMC joystick state requires five boolean controls');
  atomMmcGamepadButtons.fill(false);
  atomMmcGamepadButtons[12] = state.up; atomMmcGamepadButtons[13] = state.down; atomMmcGamepadButtons[14] = state.left; atomMmcGamepadButtons[15] = state.right; atomMmcGamepadButtons[0] = state.fire;
  if (cpu.atommc.gamepad?.gamepadButtons !== atomMmcGamepadButtons) throw new Error('Atom AtoMMC gamepad source is not attached to the live device');
  const port = 0xff ^ (state.right ? 0x01 : 0) ^ (state.left ? 0x02 : 0) ^ (state.down ? 0x04 : 0) ^ (state.up ? 0x08 : 0) ^ (state.fire ? 0x10 : 0);
  return { port, verifiedButtons: { up: state.up, down: state.down, left: state.left, right: state.right, fire: state.fire } };
}
let hardwareInspection: HardwareInspection | null = null;
let hardwareInspectionSequence = 0;
interface TapeStreamInternals { pos?: number; end?: number }
interface TapeInternals { stream?: TapeStreamInternals; curChunk?: { id?: number; stream?: TapeStreamInternals } | null; state?: number; count?: number; curByte?: number; baseFrequency?: number; atomWavebitsLeft?: number }
let mountedTape: { name: string; format: string; size: number; tape: TapeInternals } | null = null;
const mountedDiscs = new Map<number, { name: string; bytes: Uint8Array; dirty: boolean; revision: number }>();
interface TubeTransferEvent { sequence: number; timeMs: number; hostCycle: number; parasiteCycle: number; side: 'host' | 'parasite'; access: 'read' | 'write'; address: number; register: number; value: number; hostPc: number; parasitePc: number }
let tubeTransferEvents: TubeTransferEvent[] = [];
let tubeTransferSequence = 0;
let tubeTransferEventsDropped = 0;

type Command = CommandPayload & { commandId?: number; sessionId?: string };
type CommandPayload =
  | { type: 'initialise'; model: string; romSetId: string; tube?: boolean; extraRoms?: string[]; keyboardLayout?: string; keyRemaps?: MachineKeyRemap[]; sessionManifest: RuntimeSessionManifest }
  | { type: 'run' | 'pause' | 'stop' | 'step' | 'step-over' | 'step-out' | 'reset' }
  | { type: 'source-step'; mode: 'in' | 'over' | 'out'; instructionBudget?: number }
  | { type: 'run-to'; address: number }
  | ({ type: 'breakpoint' } & BreakpointSpec)
  | { type: 'set-breakpoints'; breakpoints: BreakpointSpec[] }
  | ({ type: 'watchpoint' } & WatchpointSpec)
  | { type: 'read-memory'; address: number; length: number; requestId: string; addressSpace?: MemorySpaceId; bank?: number }
  | { type: 'read-tube-memory'; address: number; length: number; requestId: string; addressSpace: 'tube-logical' | 'tube-ram' | 'tube-rom' }
  | { type: 'inspect-hardware' }
  | { type: 'interrupt-monitor'; enabled: boolean; capacity?: number }
  | { type: 'interrupt-history-clear' }
  | ({ type: 'raster-monitor'; enabled: boolean } & Partial<RasterConfig>)
  | { type: 'raster-timeline-clear' }
  | ({ type: 'profiler-config'; enabled: boolean } & Partial<ProfilerConfig>)
  | { type: 'profiler-clear' }
  | ({ type: 'replay-config'; enabled: boolean } & Partial<ReplayConfig>)
  | { type: 'reverse-step' | 'reverse-continue' }
  | { type: 'read-disassembly'; address: number; instructionCount: number; requestId: string }
  | { type: 'write-memory'; address: number; bytes: number[] }
  | { type: 'write-registers'; registers: Record<string, unknown> }
  | { type: 'trace-config'; enabled: boolean; capacity: number; addressStart?: number; addressEnd?: number; opcode?: number; pauseOnMatch?: boolean }
  | { type: 'trace-clear' }
  | { type: 'run-test'; name: string; requestId?: string; planId?: string; suite?: string; buildFingerprint?: string; bytes: number[]; origin: number; entryPoint: number; stopAddress: number; cycleBudget: number; assertions: MachineAssertion[]; setup?: { reset?: 'hard' | 'soft' | 'none'; media?: 'retain' | 'eject' }; inputs?: HardwareTestInput[]; captures?: HardwareTestCapture[]; teardown?: 'pause' | 'reset'; programManifest: ProgramLoadManifest }
  | { type: 'load-basic'; format?: 'bbc-basic-program' | 'atom-basic-text'; bytes: number[]; autorun?: boolean; programManifest: ProgramLoadManifest }
  | { type: 'load-machine-code'; bytes: number[]; origin: number; entryPoint: number; autorun?: boolean; breakpoints?: number[]; sourceLocations?: Record<string, TraceSourceLocation>; symbols?: Record<string, number>; programManifest: ProgramLoadManifest }
  | { type: 'load-disc'; name: string; bytes: number[]; drive?: number }
  | { type: 'load-tape'; name: string; bytes: number[] }
  | { type: 'eject-disc'; drive: number }
  | { type: 'export-disc'; drive: number }
  | { type: 'eject-tape' }
  | { type: 'save-state' }
  | { type: 'load-state'; json: string }
  | { type: 'capture-screen' }
  | { type: 'focus-input' | 'release-input' }
  | { type: 'set-keyboard-layout'; layout: string }
  | { type: 'set-key-remaps'; remaps: MachineKeyRemap[] }
  | { type: 'inject-text'; text: string }
  | { type: 'tap-key'; code: number }
  | { type: 'gamepad-key-edge'; action: GamepadAction; code: number; pressed: boolean }
  | { type: 'bbc-analogue-joystick'; channels: number[]; buttons: boolean[] }
  | { type: 'atom-atommc-joystick'; up: boolean; down: boolean; left: boolean; right: boolean; fire: boolean }
  | { type: 'set-bbc-mouse-joystick'; enabled: boolean }
  | { type: 'set-audio'; enabled: boolean }
  | { type: 'set-speed'; speed: number }
  | { type: 'set-volume'; volume: number }
  | { type: 'set-display-filter'; filter: string }
  | { type: 'start-audio-capture'; seconds: number }
  | { type: 'stop-audio-capture' };

const debugSessionId = new URLSearchParams(window.location.search).get('session') ?? '';
let eventSequence = 0;
let acceptedCommands = 0;
let commandAudit: DebugCommandAudit[] = [];
const debugCapabilities: DebugCapability[] = ['execution', 'register-read', 'register-write', 'memory-read', 'memory-write', 'execute-breakpoint', 'conditional-breakpoint', 'logpoint', 'data-watchpoint', 'source-step', 'trace', 'interrupt-monitor', 'raster-breakpoint', 'profiler', 'replay', 'hardware-inspection', 'media', 'screen-capture', 'audio'];
function recordDebugCommand(command: Command) { commandAudit = [...commandAudit, { sequence: ++acceptedCommands, commandId: command.commandId ?? 0, type: command.type, acceptedAtMs: performance.now() }].slice(-32); }
function debugProtocolSnapshot(): DebugProtocolSnapshot { return { version: 2, adapter: 'jsbeeb', sessionBound: Boolean(debugSessionId), owner: 'workbench-parent', acceptedCommands, lastCommandId: commandAudit.at(-1)?.commandId ?? 0, auditCapacity: 32, audit: commandAudit.slice(), capabilities: debugCapabilities.slice() }; }
function send(message: Record<string, unknown>) { const payload = message.type === 'snapshot' ? { ...message, protocol: debugProtocolSnapshot(), programManifest: loadedProgramManifest } : message; window.parent.postMessage({ channel: '8bit-net-machine', sessionId: debugSessionId, eventSequence: ++eventSequence, ...payload }, window.location.origin); }
function setStatus(message: string, tone: 'waiting' | 'ready' | 'error' = 'waiting') { status.textContent = message; status.className = tone === 'waiting' ? '' : tone; }

async function initialise(modelName: string, romSetId: string, tube = false, extraRoms: string[] = [], requestedKeyboardLayout: unknown = 'physical', requestedSessionManifest?: RuntimeSessionManifest, requestedKeyRemaps: unknown = []) {
  running = false;
  if (frameRequest) cancelAnimationFrame(frameRequest);
  breakpointHooks.forEach((entry) => entry.hook.remove()); breakpointHooks.clear();
  clearWatchpoints();
  stopTrace(); clearTrace();
  stopProfiler(); clearProfiler(); loadedProgramFingerprint = 'ROM-session';
  stopReplay();
  runToHook?.remove(); runToHook = null;
  discardHardwareTest();
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(romSetId)) throw new Error('Invalid ROM-set identity');
  runtimeSessionManifest = validateRuntimeSessionManifest(requestedSessionManifest);
  loadedProgramManifest = null;
  keyRemaps = new Map(validateMachineKeyRemaps(requestedKeyRemaps).map((remap) => [remap.hostCode, remap.targetCode]));
  if (runtimeSessionManifest.id !== debugSessionId || runtimeSessionManifest.adapter.id !== 'jsbeeb' || runtimeSessionManifest.machine.model !== modelName || runtimeSessionManifest.machine.romSetId !== romSetId) throw new Error('Runtime session manifest does not match this jsbeeb child or resolved machine profile');
  if (!Array.isArray(extraRoms) || extraRoms.length > 8 || extraRoms.some((path) => typeof path !== 'string' || path.length > 160 || path.includes('..') || path.startsWith('/') || !/^[a-zA-Z0-9._/-]+$/.test(path))) throw new Error('Invalid sideways ROM manifest');
  const model = findModel(modelName);
  if (!model) throw new Error(`Unsupported jsbeeb model ${modelName}`);
  setStatus(`Loading ${model.name}`);
  setBaseUrl(`/user-roms/${encodeURIComponent(romSetId)}/`);
  framebuffer = new Uint32Array(WIDTH * HEIGHT);
  const image = new ImageData(new Uint8ClampedArray(framebuffer.buffer), WIDTH, HEIGHT);
  video = new Video(model.isMaster, framebuffer, () => context.putImageData(image, 0, 0), { isAtom: model.isAtom });
  await browserAudio?.close();
  browserAudio = new BrowserAudio(model.isAtom, model.cyclesPerSecond);
  audioEnabled = false;
  runtimeSpeed = 1;
  cpu = fake6502(model, { video, tube, soundChip: browserAudio.soundChip });
  analogueJoystickChannels = [0x8000, 0x8000, 0x8000, 0x8000];
  atomMmcGamepadButtons = Array<boolean>(16).fill(false);
  if (model.isAtom && cpu.atommc) cpu.atommc.attachGamepad({ gamepadButtons: atomMmcGamepadButtons });
  bbcMouseJoystickEnabled = false; bbcMouseJoystickButtons = [false, false];
  const analogueConverter = cpu.adconverter as unknown as { setChannelSource?: (channel: number, source: { getValue: (channel: number) => number; dispose: () => void }) => boolean } | undefined;
  if (!model.isAtom && analogueConverter?.setChannelSource) {
    const source = { getValue: (channel: number) => analogueJoystickChannels[channel] ?? 0x8000, dispose() {} };
    for (let channel = 0; channel < 4; channel++) analogueConverter.setChannelSource(channel, source);
  }
  // jsbeeb's test-friendly factory constructs the full hardware CPU used by this
  // adapter but only forwards a subset of session config. Attach manifest-owned
  // sideways ROMs before initialise/loadOs reads the config.
  cpu.config.extraRoms = [...extraRoms];
  await Promise.all([cpu.initialise(), browserAudio.ready]);
  installTubeEventCapture();
  keyboard = new Keyboard({ processor: cpu, inputEnabledFunction: () => false, dbgr: { enabled: () => false, keyPress: () => false } });
  keyboard.setKeyLayout(isJsBeebKeyboardLayout(requestedKeyboardLayout) ? requestedKeyboardLayout : 'physical');
  keyboard.setRunning(true);
  emulatedCycles = 0; framePerformance = { ...EMPTY_FRAME_PERFORMANCE }; lastFrameAt = 0; crashDiagnostics = []; crashSequence = 0; trace = []; breakpointLogs = []; breakpointLogSequence = 0; watchpointEvents = []; watchpointSequence = 0; registerEdits = []; registerEditSequence = 0; lastStep = null; loadedSourceLocations = {}; loadedSymbols = {}; hardwareInspection = null; hardwareInspectionSequence = 0; stopInterruptMonitor(); clearInterruptHistory(); stopRasterMonitor(); clearRasterTimeline();
  commandSequence.reset();
  mountedDiscs.clear(); mountedTape = null; tubeTransferEvents = []; tubeTransferSequence = 0; tubeTransferEventsDropped = 0;
  running = true;
  setStatus(`${model.name} running`, 'ready');
  send({ type: 'ready', model: model.name });
  sendAudioState();
  scheduleFrame();
}

function scheduleFrame() {
  frameRequest = requestAnimationFrame((frameAt) => {
    try {
    if (cpu && running && !backgroundSuspended) {
      if (lastFrameAt) framePerformance = observeFrame(framePerformance, frameAt - lastFrameAt, FRAME_BUDGET_MS);
      lastFrameAt = frameAt;
      const cycles = cyclesForPresentationFrame(cpu.model.cyclesPerSecond, runtimeSpeed, FRAME_RATE);
      executeCycles(cycles);
      if (profilerEnabled) {
        if (profilerPending && absoluteCpuCycles() > profilerPending.startedAtCycle && !cpu.breakpointResume) finalizeProfilerInstruction();
        appendProfilerFrame(profilerFrame++);
      }
      if (activeHardwareTest && !activeHardwareTest.reached && absoluteCpuCycles() >= activeHardwareTest.deadline) finishHardwareTest('timeout');
      const now = performance.now();
      if (now - lastSnapshot > 200) { sendSnapshot(); lastSnapshot = now; }
      if (audioEnabled && now - lastAudioSnapshot > 500) { sendAudioState(); lastAudioSnapshot = now; }
    } else lastFrameAt = 0;
    } catch (error) {
      running = false;
      const message = error instanceof Error ? error.message : String(error);
      crashDiagnostics = appendCrashDiagnostic(crashDiagnostics, { sequence: ++crashSequence, timeMs: performance.now(), kind: 'execution', message });
      setStatus(`Runtime execution stopped: ${message}`, 'error');
      send({ type: 'error', message: `Runtime execution stopped: ${message}` });
      sendSnapshot('execution crash');
    }
    scheduleFrame();
  });
}

function executeCycles(cycles: number) {
  if (!cpu) return;
  const before = cpu.cycleSeconds * cpu.model.cyclesPerSecond + cpu.currentCycles;
  cpu.execute(cycles);
  const after = cpu.cycleSeconds * cpu.model.cyclesPerSecond + cpu.currentCycles;
  emulatedCycles += Math.max(0, after - before);
}

function instructionAt(address: number) {
  if (!cpu) return { address, instruction: '', bytes: [] as number[] };
  try {
    const [instruction, nextAddress] = cpu.disassembler.disassemble(address, true);
    const length = Math.max(1, Math.min(3, (nextAddress - address) & 0xffff));
    return { address, instruction: String(instruction), bytes: Array.from({ length }, (_, offset) => cpu!.peekmem((address + offset) & 0xffff)) };
  } catch {
    return { address, instruction: '???', bytes: [cpu.peekmem(address)] };
  }
}

function cpuCoreName() {
  if (!cpu) return 'unavailable';
  return cpu.model._cpuModel === 0 ? 'NMOS 6502' : cpu.model._cpuModel === 1 ? 'CMOS 65C02' : cpu.model._cpuModel === 2 ? 'CMOS 65C12' : 'unknown 6502-family core';
}

function memoryMapState() {
  if (!cpu) return null;
  return createMemoryMapState({ isMaster: cpu.model.isMaster, isAtom: cpu.model.isAtom, romsel: cpu.romsel, acccon: cpu.acccon, swram: cpu.model.swram });
}

function interruptState(): InterruptSnapshot {
  if (!cpu) return { irqSourceMask: 0, irqLine: false, irqAccepted: false, nmiLevel: false, nmiEdge: false, interruptDisable: false };
  return { irqSourceMask: cpu.interrupt >>> 0, irqLine: cpu.interrupt !== 0, irqAccepted: Boolean(cpu.takeInt), nmiLevel: Boolean(cpu._nmiLevel), nmiEdge: Boolean(cpu._nmiEdge), interruptDisable: Boolean(cpu.p.asByte() & 0x04) };
}

function interruptSources(): InterruptSourceState[] {
  if (!cpu) return [];
  const sources: InterruptSourceState[] = [];
  const viaBits: Array<[number, string]> = [[6, 'Timer 1'], [5, 'Timer 2'], [4, 'CB1'], [3, 'CB2'], [2, 'Shift register'], [1, 'CA1'], [0, 'CA2']];
  const addVia = (id: string, label: string, via: { snapshotState(): Record<string, unknown> } | undefined) => {
    if (!via) return;
    const state = via.snapshotState();
    const pending = Number(state.ifr ?? 0);
    const enabled = Number(state.ier ?? 0);
    viaBits.forEach(([bit, event]) => sources.push({ id: `${id}-${bit}`, label: `${label} ${event}`, pending: Boolean(pending & (1 << bit)), enabled: Boolean(enabled & (1 << bit)), source: `${label}.snapshotState() IFR/IER` }));
  };
  addVia('sysvia', 'System VIA', cpu.sysvia);
  addVia('uservia', 'User VIA', cpu.uservia);
  const acia = cpu.acia?.snapshotState();
  if (acia) sources.push({ id: 'acia', label: 'ACIA serial/cassette IRQ', pending: Boolean(Number(acia.sr ?? 0) & 0x80), enabled: Boolean(Number(acia.cr ?? 0) & 0x60), source: 'ACIA.snapshotState() SR/CR' });
  const fdc = cpu.fdc.snapshotState();
  const fdcPending = Object.prototype.hasOwnProperty.call(fdc, 'isIntRq') ? Boolean(fdc.isIntRq) : Boolean(Number(fdc.status ?? 0) & 0x80);
  sources.push({ id: 'fdc', label: 'Floppy controller interrupt', pending: fdcPending, enabled: true, source: 'FDC.snapshotState() interrupt/status latch' });
  return sources;
}

function appendInterruptEvent(kind: InterruptHistoryEvent['kind'], pc: number, detail: string) {
  const latestTrace = orderedTraceRecords().at(-1);
  interruptHistory.push({ sequence: ++interruptHistorySequence, timeMs: performance.now(), cycle: absoluteCpuCycles(), pc, kind, detail, ...(latestTrace ? { traceSequence: latestTrace.sequence } : {}), sources: interruptSources().filter((source) => source.pending || source.enabled) });
  if (interruptHistory.length > interruptMonitorCapacity) interruptHistory.splice(0, interruptHistory.length - interruptMonitorCapacity);
}

function clearInterruptHistory() { interruptHistory = []; interruptHistorySequence = 0; interruptHandlerDepth = 0; }

function stopInterruptMonitor() {
  interruptMonitorHook?.remove(); interruptMonitorHook = null; interruptMonitorEnabled = false; interruptMonitorPrevious = null;
}

function startInterruptMonitor(capacity: number) {
  if (!cpu) return;
  if (!Number.isInteger(capacity) || capacity < 16 || capacity > 1024) throw new Error('Interrupt history capacity must be 16–1,024 events');
  stopInterruptMonitor(); interruptMonitorCapacity = capacity; interruptMonitorEnabled = true;
  interruptMonitorPrevious = { pc: cpu.pc, opcode: cpu.peekmem(cpu.pc), s: cpu.s, p: cpu.p.asByte(), state: interruptState() };
  interruptMonitorHook = cpu.debugInstruction.add((pc, opcode) => {
    const current = interruptState();
    const currentOpcode = (opcode ?? cpu!.peekmem(pc)) & 0xff;
    const currentS = cpu!.s;
    const currentP = cpu!.p.asByte();
    const previous = interruptMonitorPrevious;
    if (previous) {
      if (previous.state.irqLine !== current.irqLine) appendInterruptEvent('irq-line', pc, `IRQ line ${current.irqLine ? 'asserted' : 'cleared'}`);
      if (previous.state.irqAccepted !== current.irqAccepted) appendInterruptEvent('irq-accepted', pc, `IRQ acceptance ${current.irqAccepted ? 'pending' : 'cleared'}`);
      if (previous.state.nmiLevel !== current.nmiLevel) appendInterruptEvent('nmi-line', pc, `NMI line ${current.nmiLevel ? 'high' : 'low'}`);
      if (previous.state.nmiEdge !== current.nmiEdge) appendInterruptEvent('nmi-edge', pc, `NMI edge ${current.nmiEdge ? 'latched' : 'consumed'}`);
      const interruptFramePushed = ((previous.s - currentS) & 0xff) === 3 && Boolean(currentP & 0x04) && previous.opcode !== 0x00;
      if (interruptFramePushed) {
        const interruptKind = previous.state.nmiLevel || previous.state.nmiEdge ? 'NMI' : 'IRQ';
        appendInterruptEvent('irq-accepted', pc, `${interruptKind} accepted; core pushed a three-byte interrupt frame after &${previous.pc.toString(16).toUpperCase().padStart(4, '0')}`);
        interruptHandlerDepth++;
        appendInterruptEvent('handler-enter', pc, `${interruptKind} handler entered with SP &${currentS.toString(16).toUpperCase().padStart(2, '0')}`);
      }
    }
    if (currentOpcode === 0x40 && interruptHandlerDepth > 0) { appendInterruptEvent('handler-exit', pc, 'RTI will return from the monitored interrupt handler'); interruptHandlerDepth--; }
    interruptMonitorPrevious = { pc, opcode: currentOpcode, s: currentS, p: currentP, state: current };
    return false;
  });
}

function currentRasterSample(): RasterSample {
  if (!cpu || !video) throw new Error('Raster monitor requires an initialised video adapter');
  const atomMode = Number(cpu.atomppia?.latcha ?? 0);
  const atomCss = Number(cpu.atomppia?.latchc ?? 0) & 0x08 ? 1 : 0;
  return { frame: video.frameCount >>> 0, x: video.bitmapX | 0, y: video.bitmapY | 0, hSync: Boolean(video.inHSync), vSync: Boolean(video.inVSync), scanline: video.scanlineCounter >>> 0, horizontalCounter: video.horizCounter >>> 0, verticalCounter: video.vertCounter >>> 0, displayAddress: video.addr >>> 0, mode: cpu.model.isAtom ? (atomMode >>> 4) & 0x0f : video.ulaMode >>> 0, ulaControl: cpu.model.isAtom ? atomMode : video.ulactrl >>> 0, palette: cpu.model.isAtom ? [atomCss] : Array.from(video.actualPal, (value) => value >>> 0) };
}

function rasterEventDetail(event: RasterEventKind, sample: RasterSample) {
  if (event === 'frame') return `Frame ${sample.frame} began`;
  if (event === 'mode') return `Video mode ${sample.mode} · control &${sample.ulaControl.toString(16).toUpperCase().padStart(2, '0')}`;
  if (event === 'palette') return `Palette ${sample.palette.map((value) => value.toString(16).toUpperCase()).join(' ')}`;
  if (event === 'scanline') return `Sampled display row ${sample.y}`;
  return `${event.replace('-', ' ')} at beam ${sample.x},${sample.y}`;
}

function appendRasterEvent(event: RasterEventKind, sample: RasterSample, pc: number) {
  rasterTimeline.push({ ...sample, sequence: ++rasterSequence, timeMs: performance.now(), cycle: absoluteCpuCycles(), pc, event, detail: rasterEventDetail(event, sample) });
  if (rasterTimeline.length > rasterConfig.capacity) { rasterTimeline.shift(); rasterDroppedEvents++; }
}

function clearRasterTimeline() { rasterTimeline = []; rasterSequence = 0; rasterDroppedEvents = 0; rasterLastMatchedFrame = undefined; }

function stopRasterMonitor() { rasterMonitorHook?.remove(); rasterMonitorHook = null; rasterMonitorEnabled = false; rasterPrevious = null; }

function startRasterMonitor(input: Record<string, unknown>) {
  if (!cpu || !video) return;
  const config = validateRasterConfig(input);
  stopRasterMonitor();
  if (config.capacity !== rasterConfig.capacity) clearRasterTimeline();
  rasterConfig = config; rasterMonitorEnabled = true; rasterPrevious = currentRasterSample(); rasterLastMatchedFrame = undefined;
  rasterMonitorHook = cpu.debugInstruction.add((pc) => {
    const current = currentRasterSample();
    const previous = rasterPrevious!;
    const events = rasterEvents(previous, current, rasterConfig);
    events.forEach((event) => appendRasterEvent(event, current, pc));
    const eventMatch = rasterConfig.breakEvent !== undefined && events.includes(rasterConfig.breakEvent);
    const positionMatch = rasterPositionMatches(previous, current, rasterConfig, rasterLastMatchedFrame);
    if (positionMatch && !events.includes('scanline')) appendRasterEvent('scanline', current, pc);
    rasterPrevious = current;
    if (eventMatch || positionMatch) {
      rasterLastMatchedFrame = current.frame;
      running = false;
      const reason = eventMatch ? `raster ${rasterConfig.breakEvent}` : `raster position ${current.x},${current.y}`;
      setStatus(`${cpu!.model.name} paused at ${reason}`, 'ready');
      queueMicrotask(() => sendSnapshot(reason));
      return true;
    }
    return false;
  });
}

function instructionDetailsAt(address: number) {
  if (!cpu) return null;
  const opcode = cpu.peekmem(address) & 0xff;
  return decodeInstructionState({ pc: address, a: cpu.a, x: cpu.x, y: cpu.y, opcodeSpec: cpu.opcodes.opcodes[opcode], nmos: cpu.model.nmos, read: (target) => cpu!.peekmem(target) });
}

function absoluteCpuCycles() {
  return cpu ? cpu.cycleSeconds * cpu.model.cyclesPerSecond + cpu.currentCycles : 0;
}

function orderedTraceRecords() {
  if (traceRecords.length < traceConfig.capacity || traceWriteIndex === 0) return traceRecords.slice();
  return [...traceRecords.slice(traceWriteIndex), ...traceRecords.slice(0, traceWriteIndex)];
}

function clearTrace() { traceRecords = []; traceWriteIndex = 0; traceDroppedRecords = 0; traceSequence = 0; tracePending = null; traceTriggeredSequence = undefined; tracePostRemaining = undefined; traceTriggerComplete = false; traceDiscardedByTrigger = 0; traceCandidateInstructions = 0; traceSkippedBySampling = 0; unifiedTraceEvents = []; unifiedTraceEventSequence = 0; unifiedTraceEventsDropped = 0; }

function appendTrace(record: TraceRecord) {
  if (traceRecords.length < traceConfig.capacity) traceRecords.push(record);
  else { traceRecords[traceWriteIndex] = record; traceWriteIndex = (traceWriteIndex + 1) % traceConfig.capacity; traceDroppedRecords++; }
}

function appendUnifiedTraceEvent(event: Omit<UnifiedTraceEvent, 'sequence'>) {
  unifiedTraceEvents.push({ ...event, sequence: ++unifiedTraceEventSequence });
  if (unifiedTraceEvents.length > traceConfig.capacity) { unifiedTraceEvents.shift(); unifiedTraceEventsDropped++; }
}

function traceTriggerLabel(config: TraceConfig) {
  if (!config.trigger) return '';
  const value = config.trigger.value;
  return config.trigger.kind === 'interrupt' ? 'interrupt transition' : `${config.trigger.kind} &${value!.toString(16).toUpperCase().padStart(config.trigger.kind === 'opcode' ? 2 : 4, '0')}`;
}

function finalizeTracePending() {
  if (!tracePending || !cpu) return { pauseAfterMatch: false, triggerComplete: false };
  const pending = tracePending; tracePending = null;
  const after = testRegisters();
  const interruptAfter = interruptState();
  const flags = ['C', 'Z', 'I', 'D', 'B', 'U', 'V', 'N'];
  const matched = traceInstructionMatches(traceConfig, pending.pc, pending.instruction);
  const record: TraceRecord = {
    sequence: 0, timeMs: performance.now(), cycle: pending.startedAtCycle,
    cycles: Math.max(0, absoluteCpuCycles() - pending.startedAtCycle), cpu: cpuCoreName(), pc: pending.pc,
    addressSpace: 'mapped 6502', bank: pending.mapping.bank === undefined ? pending.mapping.region : `${pending.mapping.region} · bank ${pending.mapping.bank}`, mapping: pending.mapping, instruction: pending.instruction, before: pending.before, after,
    changed: (Object.keys(pending.before) as Editable6502Register[]).filter((name) => pending.before[name] !== after[name]),
    flagsChanged: flags.filter((_, bit) => Boolean((pending.before.p ^ after.p) & (1 << bit))), accesses: pending.accesses,
    droppedAccesses: pending.droppedAccesses, interruptBefore: pending.interruptBefore, interruptAfter,
    source: loadedSourceLocations[pending.pc], symbol: loadedSymbols[pending.pc],
  };
  const justTriggered = traceTriggeredSequence === undefined && traceTriggerMatches(traceConfig, record);
  const inPostWindow = traceTriggeredSequence !== undefined && !traceTriggerComplete;
  if (matched || justTriggered || inPostWindow) {
    record.sequence = ++traceSequence; appendTrace(record);
    const common = { cpu: record.cpu, pc: record.pc, pcMapping: record.mapping, instructionSequence: record.sequence, source: record.source, symbol: record.symbol };
    if (traceConfig.eventKinds.includes('instruction')) appendUnifiedTraceEvent({ ...common, kind: 'instruction', timeMs: record.timeMs, cycle: record.cycle, detail: `${record.instruction.opcodeSpec} completed in ${record.cycles} cycles` });
    for (const access of record.accesses) {
      const kind: TraceEventKind = access.type === 'read' ? 'memory-read' : 'memory-write';
      if (traceConfig.eventKinds.includes(kind)) appendUnifiedTraceEvent({ ...common, kind, timeMs: access.timeMs, cycle: access.cycle, address: access.address, addressMapping: access.mapping, value: access.value, previousValue: access.previousValue, detail: `${access.type.toUpperCase()} &${access.address.toString(16).toUpperCase().padStart(4, '0')} = &${access.value.toString(16).toUpperCase().padStart(2, '0')}` });
    }
    if (traceConfig.eventKinds.includes('interrupt') && (record.interruptBefore.irqAccepted !== record.interruptAfter.irqAccepted || record.interruptBefore.nmiEdge !== record.interruptAfter.nmiEdge)) appendUnifiedTraceEvent({ ...common, kind: 'interrupt', timeMs: record.timeMs, cycle: record.cycle + record.cycles, detail: `IRQ ${record.interruptBefore.irqAccepted ? 'accepted' : 'clear'}→${record.interruptAfter.irqAccepted ? 'accepted' : 'clear'} · NMI ${record.interruptBefore.nmiEdge ? 'latched' : 'clear'}→${record.interruptAfter.nmiEdge ? 'latched' : 'clear'}` });
  }
  if (justTriggered) {
    record.trigger = traceTriggerLabel(traceConfig);
    traceTriggeredSequence = record.sequence;
    const ordered = orderedTraceRecords();
    const keep = Math.min(ordered.length, traceConfig.preTriggerRecords + 1);
    traceDiscardedByTrigger += ordered.length - keep;
    traceRecords = ordered.slice(-keep); traceWriteIndex = 0;
    const firstKeptSequence = traceRecords[0]?.sequence ?? record.sequence;
    const beforeEvents = unifiedTraceEvents.length;
    unifiedTraceEvents = unifiedTraceEvents.filter((event) => event.instructionSequence >= firstKeptSequence);
    unifiedTraceEventsDropped += beforeEvents - unifiedTraceEvents.length;
    tracePostRemaining = traceConfig.postTriggerRecords;
    traceTriggerComplete = tracePostRemaining === 0;
  } else if (inPostWindow && tracePostRemaining !== undefined) {
    tracePostRemaining = Math.max(0, tracePostRemaining - 1);
    traceTriggerComplete = tracePostRemaining === 0;
  }
  return { pauseAfterMatch: matched && traceConfig.pauseOnMatch, triggerComplete: traceTriggerComplete && (justTriggered || inPostWindow) };
}

function recordTraceAccess(type: TraceMemoryAccess['type'], address: number, value?: number) {
  if (!traceEnabled || !tracePending || !cpu || watchpointsSuspended) return false;
  // jsbeeb fetches instruction and operand bytes through readmem. Those bytes
  // are already represented by instruction.bytes; keep the access list for data/I/O.
  if (type === 'read' && address === cpu.pc) return false;
  if (tracePending.accesses.length >= 24) { tracePending.droppedAccesses++; return false; }
  const normalized = address & 0xffff;
  const map = memoryMapState(); if (!map) return false;
  tracePending.accesses.push({ type, address: normalized, value: (value ?? cpu.peekmem(normalized)) & 0xff, ...(type === 'write' ? { previousValue: cpu.peekmem(normalized) & 0xff } : {}), addressSpace: 'mapped 6502', mapping: mappedAddressIdentity(map, normalized), cycle: absoluteCpuCycles(), timeMs: performance.now() });
  return false;
}

function startTrace(input: Record<string, unknown>) {
  if (!cpu) return;
  const config = validateTraceConfig(input);
  const collectionModeChanged = config.sampleEvery !== traceConfig.sampleEvery || config.captureBus !== traceConfig.captureBus || config.eventKinds.join(',') !== traceConfig.eventKinds.join(',');
  stopTrace();
  if (config.capacity !== traceConfig.capacity || collectionModeChanged) clearTrace();
  traceConfig = config;
  if (config.trigger) clearTrace();
  traceEnabled = true; tracePending = null;
  traceTriggeredSequence = undefined; tracePostRemaining = undefined; traceTriggerComplete = false; traceDiscardedByTrigger = 0;
  traceInstructionHook = cpu.debugInstruction.add((pc) => {
    const outcome = finalizeTracePending();
    if (outcome.triggerComplete) {
      if (traceConfig.pauseOnTrigger) running = false;
      setStatus(`Trace trigger window complete before &${pc.toString(16).toUpperCase().padStart(4, '0')}`, 'ready');
      queueMicrotask(() => { stopTrace(); sendSnapshot('trace trigger complete'); });
      return true;
    }
    if (outcome.pauseAfterMatch) {
      running = false; setStatus(`Trace match completed before &${pc.toString(16).toUpperCase().padStart(4, '0')}`, 'ready');
      queueMicrotask(() => sendSnapshot('trace match'));
      return true;
    }
    traceCandidateInstructions++;
    if ((traceCandidateInstructions - 1) % traceConfig.sampleEvery !== 0) { traceSkippedBySampling++; return false; }
    const map = memoryMapState(); if (!map) return false;
    tracePending = { pc, startedAtCycle: absoluteCpuCycles(), instruction: instructionDetailsAt(pc)!, mapping: mappedAddressIdentity(map, pc), before: testRegisters(), interruptBefore: interruptState(), accesses: [], droppedAccesses: 0 };
    return false;
  });
  if (config.captureBus) {
    traceReadHook = cpu.debugRead.add((address, value) => recordTraceAccess('read', address, value));
    traceWriteHook = cpu.debugWrite.add((address, value) => recordTraceAccess('write', address, value));
  }
}

function stopTrace() {
  if (tracePending && absoluteCpuCycles() > tracePending.startedAtCycle && !cpu?.breakpointResume) finalizeTracePending();
  traceInstructionHook?.remove(); traceInstructionHook = null;
  traceReadHook?.remove(); traceReadHook = null;
  traceWriteHook?.remove(); traceWriteHook = null;
  tracePending = null; traceEnabled = false;
}

function clearProfiler() {
  profilerAddresses = new Map(); profilerCalls = new Map(); profilerFrames = []; profilerBus = new Map();
  profilerInstructions = 0; profilerCycles = 0; profilerUntrackedInstructions = 0; profilerPending = null;
  profilerFrame = 0; profilerFrameCycles = 0; profilerFrameInstructions = 0;
}

function appendProfilerFrame(frame: number) {
  if (!profilerFrameInstructions && !profilerFrameCycles) return;
  profilerFrames.push({ frame, cycles: profilerFrameCycles, instructions: profilerFrameInstructions });
  if (profilerFrames.length > profilerConfig.frameCapacity) profilerFrames.shift();
  profilerFrameCycles = 0; profilerFrameInstructions = 0;
}

function finalizeProfilerInstruction() {
  if (!profilerPending || !cpu) return;
  const pending = profilerPending; profilerPending = null;
  const cycles = Math.max(0, absoluteCpuCycles() - pending.startedAtCycle);
  profilerInstructions++; profilerCycles += cycles; profilerFrameInstructions++; profilerFrameCycles += cycles;
  let entry = profilerAddresses.get(pending.pc);
  if (!entry && profilerAddresses.size < profilerConfig.maxAddresses) {
    entry = { address: pending.pc, instructions: 0, cycles: 0, minCycles: Number.POSITIVE_INFINITY, maxCycles: 0, symbol: loadedSymbols[pending.pc], source: loadedSourceLocations[pending.pc] };
    profilerAddresses.set(pending.pc, entry);
  }
  if (entry) { entry.instructions++; entry.cycles += cycles; entry.minCycles = Math.min(entry.minCycles, cycles); entry.maxCycles = Math.max(entry.maxCycles, cycles); }
  else profilerUntrackedInstructions++;
}

function recordProfilerBus(kind: 'read' | 'write', address: number) {
  if (!profilerEnabled || !profilerConfig.captureBus) return false;
  const region = profilerMemoryRegion(address);
  const entry = profilerBus.get(region) ?? { region, reads: 0, writes: 0 };
  entry[kind === 'read' ? 'reads' : 'writes']++;
  profilerBus.set(region, entry);
  return false;
}

function stopProfiler() {
  if (profilerPending && absoluteCpuCycles() > profilerPending.startedAtCycle && !cpu?.breakpointResume) finalizeProfilerInstruction();
  profilerInstructionHook?.remove(); profilerInstructionHook = null;
  profilerReadHook?.remove(); profilerReadHook = null;
  profilerWriteHook?.remove(); profilerWriteHook = null;
  profilerPending = null; profilerEnabled = false;
}

function startProfiler(input: Record<string, unknown>) {
  if (!cpu || !video) return;
  const config = validateProfilerConfig(input);
  stopProfiler(); profilerConfig = config; clearProfiler(); profilerEnabled = true;
  profilerInstructionHook = cpu.debugInstruction.add((pc) => {
    finalizeProfilerInstruction();
    const opcode = cpu!.peekmem(pc) & 0xff;
    if (opcode === 0x20) {
      const target = (cpu!.peekmem((pc + 1) & 0xffff) | (cpu!.peekmem((pc + 2) & 0xffff) << 8)) & 0xffff;
      profilerCalls.set(target, (profilerCalls.get(target) ?? 0) + 1);
    }
    profilerPending = { pc, opcode, startedAtCycle: absoluteCpuCycles() };
    return false;
  });
  if (config.captureBus) {
    profilerReadHook = cpu.debugRead.add((address) => recordProfilerBus('read', address));
    profilerWriteHook = cpu.debugWrite.add((address) => recordProfilerBus('write', address));
  }
}

function profilerSnapshot() {
  const addresses = Array.from(profilerAddresses.values()).sort((a, b) => b.cycles - a.cycles || b.instructions - a.instructions || a.address - b.address);
  const calls = Array.from(profilerCalls, ([target, count]) => ({ target, count, symbol: loadedSymbols[target], source: loadedSourceLocations[target] })).sort((a, b) => b.count - a.count || a.target - b.target);
  const bus = Array.from(profilerBus.values());
  return { enabled: profilerEnabled, config: profilerConfig, buildFingerprint: loadedProgramFingerprint, instructions: profilerInstructions, cycles: profilerCycles, uniqueAddresses: profilerAddresses.size, untrackedInstructions: profilerUntrackedInstructions, overhead: profilerEnabled ? (profilerConfig.captureBus ? 'high: instruction-boundary and all mapped bus hooks active' : 'medium: one instruction-boundary hook active') : 'none: profiler hooks removed; normal fast path active', source: 'Exact jsbeeb instruction-boundary cycle deltas grouped by emulator 50 Hz execution slice; JSR call sites are opcode-proven; bus reads include opcode and operand fetches', addresses: profilerEnabled && running ? addresses.slice(0, 256) : addresses, calls, frames: profilerFrames.slice(), bus, busReads: bus.reduce((sum, entry) => sum + entry.reads, 0), busWrites: bus.reduce((sum, entry) => sum + entry.writes, 0) };
}

function estimateReplayStateBytes(value: unknown, seen = new WeakSet<object>()): number {
  if (value === null || value === undefined) return 0;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (typeof value === 'number') return 8;
  if (typeof value === 'boolean') return 1;
  if (typeof value === 'string') return value.length * 2;
  if (typeof value !== 'object' || seen.has(value as object)) return 0;
  seen.add(value as object);
  return Object.entries(value as Record<string, unknown>).reduce((total, [key, entry]) => total + key.length * 2 + estimateReplayStateBytes(entry, seen), 0);
}

function replayVerification(writeDigest = replayWriteDigest): ReplayVerificationState {
  const registers = testRegisters();
  return { ...registers, cycle: absoluteCpuCycles(), writeDigest: writeDigest >>> 0 };
}

function replayBoundary(index = replayIndex): ReplayBoundary {
  return { index, ...replayVerification(), emulatedCycles, source: loadedSourceLocations[cpu!.pc], symbol: loadedSymbols[cpu!.pc] };
}

function captureReplayCheckpoint(boundary: ReplayBoundary) {
  if (!cpu) return;
  const state = cpu.snapshotState({ includeRoms: true });
  replayCheckpoints.push({ ...boundary, state, bytes: estimateReplayStateBytes(state) });
  if (replayCheckpoints.length > replayConfig.checkpointCapacity) replayCheckpoints.shift();
  const oldest = replayCheckpoints[0]?.index ?? boundary.index;
  replayBoundaries = replayBoundaries.filter((entry) => entry.index >= oldest);
}

function resetReplaySegment(reason: string) {
  if (!replayEnabled || !cpu) return;
  replaySegment++; replayIndex = 0; replayWriteDigest = 0x811c9dc5; replayLastCycle = absoluteCpuCycles();
  replayBoundaries = []; replayCheckpoints = []; replayBoundaryReason = reason; replayLastVerification = 'No replay attempted in this segment';
  const initial = replayBoundary(0); replayBoundaries.push(initial); captureReplayCheckpoint(initial);
}

function stopReplay() {
  replayInstructionHook?.remove(); replayInstructionHook = null;
  replayWriteHook?.remove(); replayWriteHook = null;
  replayEnabled = false; replayInProgress = false; replayBoundaries = []; replayCheckpoints = [];
}

function startReplay(input: Record<string, unknown>) {
  if (!cpu) return;
  if (running) throw new Error('Pause the machine before starting deterministic history');
  const config = validateReplayConfig(input);
  stopReplay(); replayConfig = config; replayEnabled = true;
  replayWriteHook = cpu.debugWrite.add((address, value) => {
    if (!replayEnabled) return false;
    if (replayInProgress) replayObservedDigest = appendReplayWriteDigest(replayObservedDigest, address, value ?? 0);
    else replayWriteDigest = appendReplayWriteDigest(replayWriteDigest, address, value ?? 0);
    return false;
  });
  replayInstructionHook = cpu.debugInstruction.add((pc) => {
    if (replayInProgress) return false;
    const cycle = absoluteCpuCycles();
    if (cycle === replayLastCycle) return false;
    replayLastCycle = cycle; replayIndex++;
    const boundary = replayBoundary(); boundary.pc = pc;
    replayBoundaries.push(boundary);
    if (replayIndex % replayConfig.checkpointInterval === 0) captureReplayCheckpoint(boundary);
    return false;
  });
  resetReplaySegment('History started at this paused boundary');
}

let replayObservedDigest = 0x811c9dc5;

function reverseTo(targetIndex: number, reason: string) {
  if (!cpu || !video || !replayEnabled || running) return;
  const target = replayBoundaries.find((entry) => entry.index === targetIndex);
  const checkpoint = replayCheckpoints.filter((entry) => entry.index <= targetIndex).at(-1);
  if (!target || !checkpoint) { send({ type: 'error', message: 'No verified replay path exists for that instruction boundary' }); return; }
  const originalState = cpu.snapshotState({ includeRoms: true });
  const original = { index: replayIndex, cycle: replayLastCycle, digest: replayWriteDigest, emulatedCycles };
  stopTrace(); stopProfiler(); stopRasterMonitor(); stopInterruptMonitor();
  replayInProgress = true; watchpointsSuspended = true; replayObservedDigest = checkpoint.writeDigest;
  let replayStop: JsBeebDebugHookHandle | null = null;
  try {
    cpu.restoreState(checkpoint.state); cpu.breakpointResume = false;
    const instructions = targetIndex - checkpoint.index;
    if (instructions > 0) {
      let remaining = instructions; let first = true;
      replayStop = cpu.debugInstruction.add(() => { if (first) { first = false; return false; } remaining--; return remaining === 0; });
      cpu.execute(Math.max(64, target.cycle - checkpoint.cycle + 64));
      if (remaining !== 0) throw new Error(`Replay stopped ${remaining} instruction${remaining === 1 ? '' : 's'} before the requested boundary`);
    }
    const actual = replayVerification(replayObservedDigest);
    if (!replayVerificationMatches(target, actual)) throw new Error(`Verification mismatch: expected PC &${target.pc.toString(16).toUpperCase().padStart(4, '0')} cycle ${target.cycle} digest ${target.writeDigest.toString(16)}, received PC &${actual.pc.toString(16).toUpperCase().padStart(4, '0')} cycle ${actual.cycle} digest ${actual.writeDigest.toString(16)}`);
    replayIndex = targetIndex; replayLastCycle = target.cycle; replayWriteDigest = target.writeDigest; emulatedCycles = target.emulatedCycles;
    replayBoundaries = replayBoundaries.filter((entry) => entry.index <= targetIndex);
    replayCheckpoints = replayCheckpoints.filter((entry) => entry.index <= targetIndex);
    replayLastVerification = `Verified CPU, cycle and ordered bus-write digest at instruction ${targetIndex}`;
    lastStep = null; cpu.breakpointResume = false; video.paint(); setStatus(`${cpu.model.name} ${reason} verified`, 'ready');
  } catch (error) {
    cpu.restoreState(originalState); replayIndex = original.index; replayLastCycle = original.cycle; replayWriteDigest = original.digest; emulatedCycles = original.emulatedCycles;
    replayLastVerification = `Replay rejected and original state restored: ${error instanceof Error ? error.message : String(error)}`;
    send({ type: 'error', message: replayLastVerification });
  } finally {
    replayStop?.remove(); replayInProgress = false; watchpointsSuspended = false; running = false;
    sendSnapshot(reason);
  }
}

function reverseStep() { if (replayIndex > (replayBoundaries[0]?.index ?? 0)) reverseTo(replayIndex - 1, 'reverse step'); }
function reverseContinue() {
  const previous = replayCheckpoints.filter((entry) => entry.index < replayIndex).at(-1);
  if (previous) reverseTo(previous.index, 'reverse continue to checkpoint');
}

function replaySnapshot() {
  const oldest = replayBoundaries[0]?.index ?? replayIndex;
  return { enabled: replayEnabled, config: replayConfig, segment: replaySegment, currentInstruction: replayIndex, oldestInstruction: oldest, retainedInstructions: Math.max(0, replayIndex - oldest), checkpointCount: replayCheckpoints.length, checkpointBytes: replayCheckpoints.reduce((sum, checkpoint) => sum + checkpoint.bytes, 0), canReverseStep: replayEnabled && !running && replayIndex > oldest, canReverseContinue: replayEnabled && !running && replayCheckpoints.some((checkpoint) => checkpoint.index < replayIndex), boundaryReason: replayBoundaryReason, lastVerification: replayLastVerification, overhead: replayEnabled ? 'high: every-instruction boundary/write hooks plus bounded full machine checkpoints including sideways banks' : 'none: replay hooks and checkpoints inactive', checkpoints: replayCheckpoints.map(({ index, pc, cycle, bytes, source, symbol }) => ({ index, pc, cycle, bytes, source, symbol })) };
}

function captureTubeTransfer(side: TubeTransferEvent['side'], access: TubeTransferEvent['access'], address: number, value: number) {
  if (!cpu?.tube) return;
  tubeTransferEvents.push({ sequence: ++tubeTransferSequence, timeMs: performance.now(), hostCycle: absoluteCpuCycles(), parasiteCycle: Number(cpu.tube.cycles ?? 0), side, access, address: address & 0xffff, register: address & 7, value: value & 0xff, hostPc: cpu.pc & 0xffff, parasitePc: Number(cpu.tube.pc ?? 0) & 0xffff });
  if (tubeTransferEvents.length > 256) { tubeTransferEvents.shift(); tubeTransferEventsDropped++; }
}

function installTubeEventCapture() {
  const ula = cpu?.tube?.tube;
  if (!ula) return;
  const hostRead = ula.hostRead.bind(ula);
  const hostWrite = ula.hostWrite.bind(ula);
  const parasiteRead = ula.parasiteRead.bind(ula);
  const parasiteWrite = ula.parasiteWrite.bind(ula);
  ula.hostRead = (address) => { const value = hostRead(address); captureTubeTransfer('host', 'read', address, value); return value; };
  ula.hostWrite = (address, value) => { hostWrite(address, value); captureTubeTransfer('host', 'write', address, value); };
  ula.parasiteRead = (address) => { const value = parasiteRead(address); captureTubeTransfer('parasite', 'read', address, value); return value; };
  ula.parasiteWrite = (address, value) => { parasiteWrite(address, value); captureTubeTransfer('parasite', 'write', address, value); };
}

function tubeProcessorSnapshot() {
  if (!cpu?.hasTube || !cpu.tube) return null;
  const state = cpu.tube.snapshotState({ includeRoms: true }) as Record<string, unknown>;
  const ula = (state.ula ?? {}) as Record<string, unknown>;
  const memory = state.memory instanceof Uint8Array ? state.memory : new Uint8Array(0x10000);
  const rom = state.rom instanceof Uint8Array ? state.rom : new Uint8Array(0x1000);
  const pc = hardwareNumber(state, 'pc') & 0xffff;
  const memoryStart = Math.min(0xffe0, pc & 0xfff0);
  const physical = Array.from(memory.slice(memoryStart, memoryStart + 32));
  const logical = physical.map((value, offset) => {
    const address = memoryStart + offset;
    if ((address & 0xfff8) === 0xfef8) return null;
    return Boolean(state.romPaged) && address >= 0xf000 ? rom[address & 0xfff]! : value;
  });
  return {
    model: cpu.model.isMaster ? '65C102 Turbo Tube' : '65C02 Tube',
    scheduling: 'Parasite execution is cycle-coupled to the host by jsbeeb; independent pause and step are unavailable',
    registers: { pc, a: hardwareNumber(state, 'a') & 0xff, x: hardwareNumber(state, 'x') & 0xff, y: hardwareNumber(state, 'y') & 0xff, s: hardwareNumber(state, 's') & 0xff, p: hardwareNumber(state, 'p') & 0xff },
    cycles: Number(state.cycles ?? 0),
    romPaged: Boolean(state.romPaged), nmiLevel: Boolean(state.nmiLevel), nmiEdge: Boolean(state.nmiEdge), irqPending: Boolean(state.takeInt), resetHeldLow: Boolean((cpu.tube as unknown as { resetHeldLow?: boolean }).resetHeldLow),
    ula: { internalStatus: hardwareNumber(ula, 'internalStatusRegister') & 0xff, hostStatus: hardwareValues(ula, 'hostStatus').slice(0, 4), parasiteStatus: hardwareValues(ula, 'parasiteStatus').slice(0, 4), parasiteToHostFifo1: hardwareNumber(ula, 'parasiteToHostFifoByteCount1'), parasiteToHostFifo3: hardwareNumber(ula, 'parasiteToHostFifoByteCount3'), hostToParasiteFifo3: hardwareNumber(ula, 'hostToParasiteFifoByteCount3') },
    memory: { start: memoryStart, logical, physical, source: 'Tube6502.snapshotState({ includeRoms: true }); ULA addresses &FEF8 to &FEFF are excluded to avoid side effects' },
    transfers: { retained: tubeTransferEvents.length, dropped: tubeTransferEventsDropped, capacity: 256, source: 'Wrapped real jsbeeb Tube ULA hostRead, hostWrite, parasiteRead and parasiteWrite boundaries', events: running ? tubeTransferEvents.slice(-96) : tubeTransferEvents.slice() },
  };
}

function decodedCallStack() {
  if (!cpu) return [];
  const bytes = Array.from({ length: Math.min(32, 0xff - cpu.s) }, (_, offset) => ({ address: 0x100 + cpu!.s + 1 + offset, value: cpu!.peekmem(0x100 + cpu!.s + 1 + offset) & 0xff }));
  const frames: Array<Record<string, unknown>> = [{ kind: 'current', pc: cpu.pc & 0xffff, symbol: loadedSymbols[cpu.pc], source: loadedSourceLocations[cpu.pc], confidence: 'live processor PC' }];
  const seen = new Set<number>();
  for (let index = 0; index + 1 < bytes.length && frames.length < 9; index++) {
    const storedReturn = bytes[index]!.value | (bytes[index + 1]!.value << 8);
    const returnAddress = (storedReturn + 1) & 0xffff;
    const callSite = (returnAddress - 3) & 0xffff;
    if (cpu.peekmem(callSite) !== 0x20) continue;
    const target = cpu.peekmem((callSite + 1) & 0xffff) | (cpu.peekmem((callSite + 2) & 0xffff) << 8);
    if (seen.has(returnAddress)) continue;
    seen.add(returnAddress);
    frames.push({ kind: 'jsr-return-candidate', pc: returnAddress, callSite, target, stackAddress: bytes[index]!.address, symbol: loadedSymbols[target], source: loadedSourceLocations[callSite], confidence: 'adjacent hardware-stack bytes decode to a return address whose preceding instruction is JSR with matching operand bytes' });
  }
  return frames;
}

function runtimePerformanceSnapshot() {
  const audio = browserAudio?.status(false);
  return {
    isolation: 'same-origin sandboxed emulator iframe; build, analysis and project search use dedicated workers',
    budgets: RUNTIME_BUDGETS,
    background: { policy: 'suspend emulation and active audio while document is hidden; resume prior run state when visible', hidden: document.hidden, suspended: backgroundSuspended, resumePending: resumeAfterBackground },
    frames: { ...framePerformance, source: 'requestAnimationFrame intervals while active; droppedFrames estimates missed 20 ms presentation slots' },
    audio: { latencyMs: audio?.latencyMs ?? 0, underrunsAvailable: true, underruns: audio?.underruns ?? 0, lastBufferGapMs: audio?.lastBufferGapMs ?? 0, backgroundSuspended: audio?.backgroundSuspended ?? false, source: 'AudioContext base/output latency and sound-chip buffer arrival gaps while enabled' },
    crashes: { retained: crashDiagnostics.length, capacity: RUNTIME_BUDGETS.crashCapacity, records: crashDiagnostics.slice() },
  };
}

function sendSnapshot(reason = running ? 'running' : 'paused') {
  if (!cpu) return;
  const stackLength = Math.min(16, 0xff - cpu.s);
  const stack = Array.from({ length: stackLength }, (_, offset) => ({ address: 0x100 + cpu!.s + 1 + offset, value: cpu!.peekmem(0x100 + cpu!.s + 1 + offset) }));
  const orderedTrace = orderedTraceRecords();
  send({ type: 'snapshot', reason, running, speed: runtimeSpeed, sessionManifest: runtimeSessionManifest, cycles: emulatedCycles, cpuCore: cpuCoreName(), performance: runtimePerformanceSnapshot(), memoryMap: memoryMapState(), profiler: profilerSnapshot(), replay: replaySnapshot(), interrupts: interruptState(), interruptSources: interruptSources(), interruptMonitor: { enabled: interruptMonitorEnabled, capacity: interruptMonitorCapacity, retained: interruptHistory.length, overhead: interruptMonitorEnabled ? 'medium: one instruction-boundary hook; normal fast CPU path disabled' : 'none: monitor hook removed', handlerDepth: interruptHandlerDepth, events: interruptMonitorEnabled && running ? interruptHistory.slice(-128) : interruptHistory.slice() }, rasterMonitor: { enabled: rasterMonitorEnabled, config: rasterConfig, retained: rasterTimeline.length, droppedEvents: rasterDroppedEvents, overhead: rasterMonitorEnabled ? 'high: video state sampled at every instruction boundary; normal fast CPU path disabled' : 'none: raster hook removed', source: cpu.model.isAtom ? 'jsbeeb MC6847 facade counters plus Atom PPIA mode/CSS latches' : 'jsbeeb Video direct beam/CRTC/ULA state', events: rasterMonitorEnabled && running ? rasterTimeline.slice(-128) : rasterTimeline.slice() }, instructionDetails: instructionDetailsAt(cpu.pc), lastStep, hardwareTrace: { enabled: traceEnabled, config: traceConfig, retained: traceRecords.length, droppedRecords: traceDroppedRecords, skippedBySampling: traceSkippedBySampling, candidateInstructions: traceCandidateInstructions, triggeredSequence: traceTriggeredSequence, postRemaining: tracePostRemaining, triggerComplete: traceTriggerComplete, discardedByTrigger: traceDiscardedByTrigger, eventRetained: unifiedTraceEvents.length, eventDropped: unifiedTraceEventsDropped, overhead: traceEnabled ? `${traceConfig.sampleEvery > 1 ? 'medium: sampled instruction hook' : 'high: every-instruction hook'}${traceConfig.captureBus ? ' plus data-bus hooks' : '; bus hooks disabled'}; normal fast path disabled` : 'none: trace hooks removed', events: traceEnabled && running ? unifiedTraceEvents.slice(-256) : unifiedTraceEvents.slice(), records: traceEnabled && running ? orderedTrace.slice(-256) : orderedTrace }, registers: testRegisters(), registerEdits: registerEdits.slice(-16), currentInstruction: instructionAt(cpu.pc), callStack: decodedCallStack(), breakpoints: Array.from(breakpointHooks.values()).map((entry) => ({ ...entry.spec, hits: entry.hits })).sort((a, b) => a.address - b.address), breakpointLogs: breakpointLogs.slice(-32), watchpoints: Array.from(watchpointHooks.values()).map((entry) => ({ ...entry.spec, hits: entry.hits, previousValue: entry.previousValue, lastValue: entry.lastValue, pc: entry.pc, width: 1, addressSpace: 'mapped 6502 main RAM', implementation: 'jsbeeb debugRead/debugWrite hook' })).sort((a, b) => a.address - b.address || a.access.localeCompare(b.access)), watchpointEvents: watchpointEvents.slice(-32), stack, trace: trace.slice(-16) });
  send({ type: 'tube-state', tube: tubeProcessorSnapshot(), capturedAtCycles: emulatedCycles });
}

function step() {
  if (!cpu) return;
  running = false;
  const current = instructionAt(cpu.pc);
  const decoded = instructionDetailsAt(cpu.pc)!;
  const registersBefore = testRegisters();
  const interruptBefore = interruptState();
  const cyclesBefore = emulatedCycles;
  trace.push(current);
  if (trace.length > 64) trace.shift();
  // jsbeeb suppresses the first debug hook itself when resuming from a hook stop.
  // Only suppress it here when the CPU was paused by a non-hook action.
  let first = !cpu.breakpointResume;
  const hook = cpu.debugInstruction.add(() => { if (first) { first = false; return false; } return true; });
  executeCycles(64);
  hook.remove();
  const registersAfter = testRegisters();
  const flagNames = ['C', 'Z', 'I', 'D', 'B', 'U', 'V', 'N'];
  lastStep = {
    instruction: decoded, before: registersBefore, after: registersAfter, cycles: emulatedCycles - cyclesBefore,
    changed: (Object.keys(registersBefore) as Editable6502Register[]).filter((name) => registersBefore[name] !== registersAfter[name]),
    flagsChanged: flagNames.filter((_, bit) => Boolean((registersBefore.p ^ registersAfter.p) & (1 << bit))),
    interruptBefore, interruptAfter: interruptState(),
  };
  setStatus(`${cpu.model.name} paused`, 'ready');
  sendSnapshot('single step');
}

function runTo(address: number, reason = 'run to address') {
  if (!cpu || !Number.isInteger(address) || address < 0 || address > 0xffff) {
    send({ type: 'error', message: 'Run-to address must be a 16-bit address' });
    return;
  }
  const target = address & 0xffff;
  runToHook?.remove();
  if (cpu.pc === target) { running = false; setStatus(`${cpu.model.name} paused at run-to target`, 'ready'); sendSnapshot(reason); return; }
  runToHook = cpu.debugInstruction.add((pc) => {
    if (pc !== target) return false;
    running = false;
    runToHook?.remove(); runToHook = null;
    setStatus(`Run-to target &${pc.toString(16).toUpperCase().padStart(4, '0')}`, 'ready');
    queueMicrotask(() => sendSnapshot(reason));
    return true;
  });
  running = true;
  setStatus(`${cpu.model.name} running to &${target.toString(16).toUpperCase().padStart(4, '0')}`, 'ready');
  sendSnapshot('running to address');
}

function stepOver() {
  if (!cpu) return;
  const [instruction, nextAddress] = cpu.disassembler.disassemble(cpu.pc, true);
  if (String(instruction).startsWith('JSR ')) runTo(nextAddress & 0xffff, 'step over');
  else step();
}

function stepOut() {
  if (!cpu) return;
  if (cpu.s > 0xfd) { send({ type: 'error', message: 'No 6502 return address is present on the hardware stack' }); return; }
  const low = cpu.peekmem(0x100 + ((cpu.s + 1) & 0xff));
  const high = cpu.peekmem(0x100 + ((cpu.s + 2) & 0xff));
  runTo((((high << 8) | low) + 1) & 0xffff, 'step out');
}

function sourceStep(mode: 'in' | 'over' | 'out', instructionBudget = 100000) {
  if (!cpu) return;
  if (running) { send({ type: 'error', message: 'Pause the machine before source stepping' }); return; }
  const startPc = cpu.pc & 0xffff;
  const startSource = loadedSourceLocations[startPc];
  if (!startSource) { send({ type: 'error', message: 'The current 6502 address has no retained source mapping' }); return; }
  if (!Number.isInteger(instructionBudget) || instructionBudget < 1 || instructionBudget > 100000) { send({ type: 'error', message: 'Source-step budget must be between 1 and 100,000 instructions' }); return; }
  if (mode === 'out') { stepOut(); return; }
  if (mode === 'over') {
    const [instruction, nextAddress] = cpu.disassembler.disassemble(startPc, true);
    if (String(instruction).startsWith('JSR ')) { runTo(nextAddress & 0xffff, 'source step over'); return; }
  }
  let instructions = 0;
  let first = true;
  let hook: JsBeebDebugHookHandle;
  hook = cpu.debugInstruction.add((pc) => {
    if (first) { first = false; return false; }
    instructions += 1;
    const source = loadedSourceLocations[pc & 0xffff];
    const changed = !!source && (source.fileName !== startSource.fileName || source.line !== startSource.line);
    if (!changed && instructions < instructionBudget) return false;
    running = false; hook.remove();
    if (changed) {
      setStatus(`${cpu!.model.name} source step ${mode} complete`, 'ready');
      send({ type: 'source-step-complete', mode, instructions, source, address: pc & 0xffff });
      queueMicrotask(() => sendSnapshot(`source step ${mode}`));
    } else {
      setStatus(`${cpu!.model.name} source-step budget reached`, 'error');
      send({ type: 'source-step-budget', mode, instructions, instructionBudget, address: pc & 0xffff });
      queueMicrotask(() => sendSnapshot('source-step budget reached'));
    }
    return true;
  });
  running = true;
  setStatus(`${cpu.model.name} source step ${mode}`, 'ready');
  send({ type: 'source-step-started', mode, address: startPc, source: startSource, instructionBudget });
  sendSnapshot(`source step ${mode} started`);
}

function testRegisters(): RegisterSnapshot {
  if (!cpu) return { a: 0, x: 0, y: 0, s: 0, p: 0, pc: 0 };
  return { a: cpu.a, x: cpu.x, y: cpu.y, s: cpu.s, p: cpu.p.asByte(), pc: cpu.pc };
}

function finishHardwareTest(reason: 'stop address reached' | 'timeout') {
  if (!cpu || !activeHardwareTest) return;
  const test = activeHardwareTest;
  test.hook.remove(); activeHardwareTest = null; running = false;
  (keyboard as unknown as { clearKeys?: () => void } | null)?.clearKeys?.();
  const registers = testRegisters();
  const elapsedCycles = absoluteCpuCycles() - test.startCycles;
  const audioCapture = browserAudio?.endTestCapture() ?? { digest: '811C9DC5', writes: 0, speakerTransitions: 0, speakerAvailable: false };
  const results = test.assertions.map((assertion) => assertion.kind === 'register'
    ? { ...assertion, actual: registers[assertion.register], passed: registers[assertion.register] === assertion.expected }
    : assertion.kind === 'memory'
      ? (() => { const actual = assertion.expected.map((_, offset) => cpu!.peekmem(assertion.address + offset)); return { ...assertion, actual, passed: actual.every((byte, index) => byte === assertion.expected[index]) }; })()
      : assertion.kind === 'output'
        ? { ...assertion, actual: test.output, passed: test.output === assertion.expected }
        : assertion.kind === 'audio'
          ? { ...assertion, actual: audioCapture.digest, writes: audioCapture.writes, passed: audioCapture.digest === assertion.expected }
        : assertion.kind === 'screen'
          ? (() => { const actual = framebufferRegionFnv32(framebuffer, assertion, EMULATOR_SCREEN_WIDTH); return { ...assertion, actual, passed: actual === assertion.expected }; })()
          : assertion.kind === 'screen-golden'
            ? (() => { const difference = compareFramebufferRegion(framebuffer, assertion, assertion.expectedRgbaBase64, assertion.allowedChannelDelta, assertion.allowedDifferingPixels, EMULATOR_SCREEN_WIDTH); return { ...assertion, ...difference, actual: difference.actualDigest }; })()
          : assertion.kind === 'event'
            ? { ...assertion, actual: test.eventCounts[assertion.event], passed: test.eventCounts[assertion.event] === assertion.expected }
          : assertion.kind === 'event-address'
            ? (() => { const actual = test.addressEventCounts.get(assertion.address) ?? 0; return { ...assertion, actual, passed: actual === assertion.expected }; })()
          : assertion.kind === 'audio-speaker'
            ? { ...assertion, actual: audioCapture.speakerTransitions, passed: audioCapture.speakerTransitions === assertion.expected }
            : { ...assertion, actual: elapsedCycles, passed: assertion.operator === 'eq' ? elapsedCycles === assertion.expected : assertion.operator === 'lte' ? elapsedCycles <= assertion.expected : assertion.operator === 'gte' ? elapsedCycles >= assertion.expected : elapsedCycles >= assertion.expected && elapsedCycles <= (assertion as { expectedMaximum: number }).expectedMaximum });
  const timedOut = reason === 'timeout';
  const passed = !timedOut && results.every((result) => result.passed);
  const status = passed ? 'passed' : timedOut ? 'timeout' : 'failed';
  const captures = test.captures.map((capture) => capture.kind === 'registers'
    ? { id: capture.id, kind: 'registers' as const, registers: { ...registers } }
    : { id: capture.id, kind: 'memory' as const, address: capture.address, bytes: Array.from({ length: capture.length }, (_, offset) => cpu!.peekmem(capture.address + offset)) });
  setStatus(`${test.name} ${status}`, passed ? 'ready' : 'error');
  send({ type: 'test-result', name: test.name, requestId: test.requestId, planId: test.planId, suite: test.suite, buildFingerprint: test.buildFingerprint, programFingerprint: loadedProgramManifest?.fingerprint, status, reason: `${reason} · ${test.appliedInputs} input action${test.appliedInputs === 1 ? '' : 's'} applied`, cycles: elapsedCycles, stopAddress: test.stopAddress, registers, assertions: results, captures, appliedInputs: test.appliedInputs, teardown: test.teardown });
  if (test.teardown === 'reset') { cpu.reset(true); setStatus(`${test.name} ${status} · reset teardown complete`, passed ? 'ready' : 'error'); }
  sendSnapshot(`test ${status} · ${test.teardown} teardown`);
}

/* A machine that has just been reset has not initialised its operating system.
 * Its vectors below &0300 are still uninitialised RAM, so a program injected at
 * that moment cannot call the MOS, and the language ROM would later clear the
 * program area from PAGE. Run the real core until it reaches the OSRDCH entry,
 * which is the first instant at which the OS has installed its vectors and the
 * language is running and waiting for input. */
const OS_READY_ENTRY_ADDRESS = MOS_TEST_EVENT_ADDRESSES.osrdch;
const OS_BOOT_CYCLE_CEILING = 20_000_000;

function runUntilOperatingSystemReady(): { marker: number | null; ready: boolean; cycles: number } {
  /* The Atom MOS is not the BBC MOS and this build has no verified readiness
   * entry point for it, so no marker is claimed for that model. */
  if (!cpu || cpu.model.isAtom) return { marker: null, ready: false, cycles: 0 };
  const start = absoluteCpuCycles();
  let ready = false;
  const hook = cpu.debugInstruction.add((pc) => {
    if (pc !== OS_READY_ENTRY_ADDRESS) return false;
    ready = true;
    return true;
  });
  try {
    while (!ready && absoluteCpuCycles() - start < OS_BOOT_CYCLE_CEILING) executeCycles(200_000);
  } finally { hook.remove(); }
  return { marker: OS_READY_ENTRY_ADDRESS, ready, cycles: absoluteCpuCycles() - start };
}

function startHardwareTest(command: Extract<CommandPayload, { type: 'run-test' }>) {
  if (!cpu) return;
  if (!command.name.trim() || command.name.length > 80) throw new Error('Test name must contain 1–80 characters');
  if (command.programManifest?.mode !== 'test' || command.programManifest.build?.fingerprint !== command.buildFingerprint) throw new Error('Hardware test requires a matching immutable test-mode program manifest');
  if (!Number.isInteger(command.cycleBudget) || command.cycleBudget < 100 || command.cycleBudget > 10_000_000) throw new Error('Test cycle budget must be between 100 and 10,000,000');
  if (!Number.isInteger(command.stopAddress) || command.stopAddress < 0 || command.stopAddress > 0xffff) throw new Error('Test stop address must be a 16-bit address');
  if (!Array.isArray(command.assertions) || command.assertions.length < 1 || command.assertions.length > 64) throw new Error('Tests require 1–64 assertions');
  /* Addresses named by EVENT[...] assertions, so the instruction hook only
   * looks for what this plan actually asked about. */
  const watchedEventAddresses: number[] = [];
  let memoryBytes = 0;
  for (const assertion of command.assertions) {
    if (assertion.kind === 'register') {
      const maximum = assertion.register === 'pc' ? 0xffff : 0xff;
      if (!['a','x','y','s','p','pc'].includes(assertion.register) || !Number.isInteger(assertion.expected) || assertion.expected < 0 || assertion.expected > maximum) throw new Error('Test contains an invalid register assertion');
    } else if (assertion.kind === 'memory') {
      memoryBytes += assertion.expected.length;
      if (!Number.isInteger(assertion.address) || assertion.address < 0 || assertion.expected.length < 1 || assertion.address + assertion.expected.length > 0x10000 || assertion.expected.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 0xff)) throw new Error('Test contains an invalid memory assertion');
    } else if (assertion.kind === 'output') {
      if (typeof assertion.expected !== 'string' || assertion.expected.length > 4096) throw new Error('Test output assertion is invalid');
      /* OUTPUT is captured at the BBC MOS OSWRCH entry. The Atom MOS is a
       * different operating system at different addresses, so the same capture
       * on that machine would report whatever happens to sit there. */
      if (cpu.model.isAtom) throw new Error('OUTPUT captures the BBC MOS OSWRCH entry, which is not the Atom operating system; assert registers or memory instead');
    } else if (assertion.kind === 'audio') {
      if (!/^[0-9A-F]{8}$/.test(assertion.expected)) throw new Error('Test audio-write assertion is invalid');
    } else if (assertion.kind === 'screen') {
      if (!/^[0-9A-F]{8}$/.test(assertion.expected) || validateScreenRegion(assertion)) throw new Error('Test screen-region assertion is invalid');
    } else if (assertion.kind === 'screen-golden') {
      const regionError = validateScreenRegion(assertion);
      let expectedBytes: Uint8Array;
      try { expectedBytes = base64ToBytes(assertion.expectedRgbaBase64); } catch { throw new Error('Test screen golden is not valid base64'); }
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(assertion.goldenId) || regionError || expectedBytes.length !== assertion.width * assertion.height * 4 || !Number.isInteger(assertion.allowedChannelDelta) || assertion.allowedChannelDelta < 0 || assertion.allowedChannelDelta > 255 || !Number.isInteger(assertion.allowedDifferingPixels) || assertion.allowedDifferingPixels < 0 || assertion.allowedDifferingPixels > assertion.width * assertion.height) throw new Error('Test tolerant screen assertion is invalid');
    } else if (assertion.kind === 'event') {
      if (!(assertion.event in MOS_TEST_EVENT_ADDRESSES) || !Number.isSafeInteger(assertion.expected) || assertion.expected < 0 || assertion.expected > 65_535) throw new Error('Test event assertion is invalid');
      if (cpu.model.isAtom) throw new Error(`EVENT[${assertion.event.toUpperCase()}] counts an entry to the BBC MOS, which the Atom does not have at that address; assert registers or memory instead`);
    } else if (assertion.kind === 'event-address') {
      if (!Number.isInteger(assertion.address) || assertion.address < 0 || assertion.address > 0xffff || !Number.isSafeInteger(assertion.expected) || assertion.expected < 0 || assertion.expected > 65_535) throw new Error('Test address-event assertion is invalid');
      watchedEventAddresses.push(assertion.address);
    } else if (assertion.kind === 'audio-speaker') {
      if (!Number.isSafeInteger(assertion.expected) || assertion.expected < 0 || assertion.expected > 1_000_000) throw new Error('Test speaker assertion is invalid');
      /* Only a machine with a one-bit speaker has transitions to count. On a
       * sound-chip machine there is nothing to observe, so the assertion is
       * refused rather than answered with a zero that would look like a pass. */
      if (!browserAudio?.speakerAvailable) throw new Error('AUDIO[SPEAKER] counts transitions of a one-bit speaker, which this machine does not have; assert AUDIO[WRITES] instead');
    } else if (assertion.kind === 'cycles') {
      if (!['eq', 'lte', 'gte', 'range'].includes(assertion.operator) || !Number.isSafeInteger(assertion.expected) || assertion.expected < 0 || assertion.expected > 10_000_000) throw new Error('Test cycle assertion is invalid');
      if (assertion.operator === 'range' && (!Number.isSafeInteger(assertion.expectedMaximum) || assertion.expectedMaximum < assertion.expected || assertion.expectedMaximum > 10_000_000)) throw new Error('Test cycle range assertion is invalid');
    } else throw new Error('Test contains an unsupported assertion');
  }
  if (memoryBytes > 1024) throw new Error('Test memory assertions are limited to 1,024 bytes');
  const captures = Array.isArray(command.captures) ? command.captures : [];
  if (captures.length > 16) throw new Error('Tests are limited to 16 artifact captures');
  let captureBytes = 0;
  for (const capture of captures) {
    if (!capture || typeof capture.id !== 'string' || !capture.id || capture.id.length > 80) throw new Error('Test capture identity is invalid');
    if (capture.kind === 'registers') continue;
    if (capture.kind !== 'memory' || !Number.isInteger(capture.address) || !Number.isInteger(capture.length) || capture.address < 0 || capture.length < 1 || capture.length > 4096 || capture.address + capture.length > 0x10000) throw new Error('Test memory capture is outside the 16-bit address space');
    captureBytes += capture.length;
  }
  if (captureBytes > 4096) throw new Error('Test memory captures are limited to 4,096 bytes');
  if (command.teardown !== undefined && command.teardown !== 'pause' && command.teardown !== 'reset') throw new Error('Unsupported test teardown action');
  if (command.setup?.reset !== undefined && !['hard', 'soft', 'none'].includes(command.setup.reset)) throw new Error('Unsupported test setup reset');
  if (command.setup?.media !== undefined && command.setup.media !== 'retain' && command.setup.media !== 'eject') throw new Error('Unsupported test setup media policy');
  const inputs = Array.isArray(command.inputs) ? command.inputs : [];
  const initialDiscs = new Map(Array.from(mountedDiscs, ([drive, disc]) => [drive, { name: disc.name, bytes: disc.bytes.slice() }]));
  const initialTape = mountedTape;
  if (inputs.length > 256) throw new Error('Tests are limited to 256 input actions');
  for (const input of inputs) {
    if (input.kind === 'delay' && Number.isInteger(input.cycles) && input.cycles >= 1 && input.cycles <= 10_000_000) continue;
    if (input.kind === 'key' && /^[A-Za-z0-9]{1,24}$/.test(input.code) && typeof input.pressed === 'boolean') continue;
    if (input.kind === 'gamepad' && GAMEPAD_ACTIONS.some((action) => action.id === input.action) && typeof input.pressed === 'boolean') { validateMachineTapCode(input.code); continue; }
    if (input.kind === 'bbc-analogue' && !cpu.model.isAtom && input.channels.length === 4 && input.channels.every((value) => Number.isInteger(value) && value >= 0 && value <= 0xffff) && input.buttons.length === 2 && input.buttons.every((value) => typeof value === 'boolean')) continue;
    if (input.kind === 'bbc-mouse' && !cpu.model.isAtom && Number.isInteger(input.x) && input.x >= 0 && input.x <= 0xffff && Number.isInteger(input.y) && input.y >= 0 && input.y <= 0xffff && input.buttons.length === 2 && input.buttons.every((value) => typeof value === 'boolean')) continue;
    if (input.kind === 'atom-atommc' && cpu.model.isAtom && runtimeSessionManifest?.machine.enabledCapabilities.includes('atommc') && ['up', 'down', 'left', 'right', 'fire'].every((key) => typeof input[key as keyof typeof input] === 'boolean')) continue;
    if (input.kind === 'media' && ['eject-disc-0', 'eject-disc-1', 'eject-tape', 'mount-initial-disc-0', 'mount-initial-disc-1', 'mount-initial-tape'].includes(input.action)) {
      if (input.action.startsWith('mount-initial-disc-')) {
        const drive = input.action.endsWith('-1') ? 1 : 0;
        if (!initialDiscs.has(drive)) throw new Error(`Test cannot mount initial drive ${drive} because no disk was present when the run started`);
      }
      if (input.action === 'mount-initial-tape' && !initialTape) throw new Error('Test cannot mount the initial cassette because no tape was present when the run started');
      continue;
    }
    if (input.kind === 'emulator-event' && input.event === 'next-video-frame') continue;
    if (input.kind === 'reset' && (input.reset === 'hard' || input.reset === 'soft')) continue;
    throw new Error('Test input action is invalid');
  }
  discardHardwareTest();
  if (command.setup?.media === 'eject') { cpu.fdc.loadDisc(0, null); cpu.fdc.loadDisc(1, null); if (cpu.model.isAtom) cpu.atomppia?.setTape(null); else cpu.acia?.setTape(null); mountedDiscs.clear(); mountedTape = null; }
  let osBoot: ReturnType<typeof runUntilOperatingSystemReady> = { marker: null, ready: false, cycles: 0 };
  if (command.setup?.reset === 'hard' || command.setup?.reset === 'soft') {
    cpu.reset(command.setup.reset === 'hard');
    osBoot = runUntilOperatingSystemReady();
    if (osBoot.marker !== null && !osBoot.ready) throw new Error(`The reset machine did not reach its operating-system entry &${osBoot.marker.toString(16).toUpperCase()} within ${OS_BOOT_CYCLE_CEILING.toLocaleString()} cycles`);
  }
  loadMachineCode(command.bytes, command.origin, command.entryPoint, false, [], {}, {}, command.programManifest);
  browserAudio?.beginTestCapture();
  const startCycles = absoluteCpuCycles();
  let test: ActiveHardwareTest;
  const hook = cpu.debugInstruction.add((pc) => {
    for (const [event, address] of Object.entries(MOS_TEST_EVENT_ADDRESSES) as [MosTestEvent, number][]) {
      if (pc === address) test.eventCounts[event] += 1;
    }
    if (test.addressEventCounts.size) {
      const seen = test.addressEventCounts.get(pc);
      if (seen !== undefined) test.addressEventCounts.set(pc, seen + 1);
    }
    if (pc === MOS_TEST_EVENT_ADDRESSES.oswrch && test.output.length < 4096) test.output += String.fromCharCode(cpu!.a & 0xff);
    while (test.inputIndex < test.inputs.length) {
      const input = test.inputs[test.inputIndex]!;
      if (input.kind === 'delay') {
        if (test.delayUntil === null) test.delayUntil = absoluteCpuCycles() + input.cycles;
        if (absoluteCpuCycles() < test.delayUntil) break;
        test.delayUntil = null; test.inputIndex += 1; test.appliedInputs += 1; continue;
      }
      if (input.kind === 'key') {
        const event = new KeyboardEvent(input.pressed ? 'keydown' : 'keyup', { code: input.code });
        if (input.pressed) keyboard?.keyDown(event); else keyboard?.keyUp(event);
      } else if (input.kind === 'gamepad') {
        const keyCode = validateMachineTapCode(input.code);
        const event = { keyCode, which: keyCode, charCode: 0, location: 0, altKey: false, ctrlKey: false, shiftKey: false, preventDefault() {} } as KeyboardEvent;
        if (input.pressed) keyboard?.keyDown(event); else keyboard?.keyUp(event);
      } else if (input.kind === 'bbc-analogue') {
        const verified = applyBbcAnalogueJoystick(input.channels, input.buttons);
        send({ type: 'test-input-applied', index: test.inputIndex, kind: input.kind, channels: [...input.channels], buttons: [...input.buttons], ...verified, source: 'jsbeeb ADC channel sources and System VIA PB4/PB5 readback' });
      } else if (input.kind === 'bbc-mouse') {
        const channels: [number, number, number, number] = [0xffff - input.x, 0xffff - input.y, 0x8000, 0x8000];
        const verified = applyBbcAnalogueJoystick(channels, input.buttons);
        send({ type: 'test-input-applied', index: test.inputIndex, kind: input.kind, x: input.x, y: input.y, buttons: [...input.buttons], channels, ...verified, source: 'normalized pointer through jsbeeb ADC channel sources and System VIA PB4/PB5 readback' });
      } else if (input.kind === 'atom-atommc') {
        const { kind: _kind, ...state } = input;
        const verified = applyAtomMmcJoystick(state);
        send({ type: 'test-input-applied', index: test.inputIndex, ...input, ...verified, source: 'attached AtoMMC gamepad source read by CMD_READ_PORT at &B400' });
      } else if (input.kind === 'media') {
        if (input.action === 'eject-tape') { if (cpu!.model.isAtom) cpu!.atomppia?.setTape(null); else cpu!.acia?.setTape(null); mountedTape = null; }
        else if (input.action.startsWith('mount-initial-disc-')) {
          const drive = input.action.endsWith('-1') ? 1 : 0;
          const source = test.initialDiscs.get(drive)!;
          const mounted = { name: source.name, bytes: source.bytes.slice(), dirty: false, revision: 0 };
          cpu!.fdc.loadDisc(drive, discFor(cpu!.fdc, mounted.name, mounted.bytes, (changedBytes) => { mounted.bytes = changedBytes.slice(); mounted.dirty = true; mounted.revision += 1; }));
          mountedDiscs.set(drive, mounted);
        } else if (input.action === 'mount-initial-tape') {
          mountedTape = test.initialTape;
          if (cpu!.model.isAtom) cpu!.atomppia?.setTape(mountedTape!.tape); else cpu!.acia?.setTape(mountedTape!.tape);
        } else { const drive = input.action === 'eject-disc-0' ? 0 : 1; cpu!.fdc.loadDisc(drive, null); mountedDiscs.delete(drive); }
        send({ type: 'test-input-applied', index: test.inputIndex, kind: input.kind, action: input.action, mountedDiscs: [...mountedDiscs.keys()].sort(), tapeMounted: mountedTape !== null, source: 'live jsbeeb FDC/ACIA/PPIA media state' });
      } else if (input.kind === 'emulator-event') {
        const observedFrame = video!.frameCount >>> 0;
        if (test.eventFrameStart === null) test.eventFrameStart = observedFrame;
        if (observedFrame === test.eventFrameStart) break;
        send({ type: 'test-input-applied', index: test.inputIndex, kind: input.kind, event: input.event, startFrame: test.eventFrameStart, observedFrame, source: 'live jsbeeb video frame counter at instruction boundaries' });
        test.eventFrameStart = null;
      } else cpu!.reset(input.reset === 'hard');
      test.inputIndex += 1; test.appliedInputs += 1;
    }
    if (test.inputIndex < test.inputs.length) return false;
    if (pc !== command.stopAddress) return false;
    test.reached = true; running = false;
    queueMicrotask(() => finishHardwareTest('stop address reached'));
    return true;
  });
  test = { name: command.name.trim(), requestId: command.requestId, planId: command.planId, suite: command.suite, buildFingerprint: command.buildFingerprint, assertions: command.assertions, output: '', eventCounts: { osrdch: 0, osasci: 0, osnewl: 0, oswrcr: 0, oswrch: 0, osword: 0, osbyte: 0, oscli: 0 }, addressEventCounts: new Map(watchedEventAddresses.map((address) => [address, 0])), captures, inputs, initialDiscs, initialTape, inputIndex: 0, delayUntil: null, eventFrameStart: null, appliedInputs: 0, teardown: command.teardown ?? 'pause', startCycles, deadline: startCycles + command.cycleBudget, stopAddress: command.stopAddress, hook, reached: false };
  activeHardwareTest = test; running = true;
  setStatus(`${test.name} running`, 'ready');
  send({ type: 'test-started', name: test.name, requestId: test.requestId, stopAddress: test.stopAddress, cycleBudget: command.cycleBudget, assertionCount: test.assertions.length, osBoot });
  sendSnapshot('test running');
}

function loadBasic(bytes: number[], autorun = true, format: 'bbc-basic-program' | 'atom-basic-text' = 'bbc-basic-program', programManifest?: ProgramLoadManifest) {
  if (!cpu || !keyboard) return;
  if (!Array.isArray(bytes) || bytes.length < 1 || bytes.length > 32768 || bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 0xff)) { send({ type: 'error', message: 'BASIC artifacts must contain 1–32,768 valid bytes' }); return; }
  if (cpu.model.isAtom !== (format === 'atom-basic-text')) { send({ type: 'error', message: `${format === 'atom-basic-text' ? 'Atom BASIC text' : 'BBC BASIC tokens'} cannot be loaded into ${cpu.model.name}` }); return; }
  if (!runtimeSessionManifest) { send({ type: 'error', message: 'BASIC load requires an initialized runtime session manifest' }); return; }
  try {
    if (!programManifest || programManifest.format !== format || programManifest.placement !== (format === 'bbc-basic-program' ? 'interpreter-page' : 'keyboard-queue')) throw new Error('BASIC load requires a matching interpreter-placement program manifest');
    loadedProgramManifest = validateProgramLoadManifest(programManifest, runtimeSessionManifest.fingerprint, Uint8Array.from(bytes), 0, 0);
  } catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); return; }
  clearWatchpoints(); watchpointEvents = []; watchpointSequence = 0; registerEdits = []; registerEditSequence = 0; lastStep = null; stopTrace(); clearTrace(); stopInterruptMonitor(); clearInterruptHistory(); stopRasterMonitor(); clearRasterTimeline(); stopProfiler(); clearProfiler(); loadedProgramFingerprint = 'BASIC-session'; loadedSourceLocations = {}; loadedSymbols = {};
  const targetCpu = cpu;
  const targetKeyboard = keyboard;
  if (targetCpu.model.isAtom) {
    try {
      const source = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
      if (!/^(?:\d{1,5}[^\r\n]*\n)+$/.test(source) || Array.from(source).some((character) => character !== '\n' && (character.charCodeAt(0) < 0x20 || character.charCodeAt(0) > 0x7e))) throw new Error('Atom BASIC artifact is not bounded numbered ASCII source');
      const entry = `NEW\n${source}${autorun ? 'RUN\n' : ''}`;
      // The Atom ROM polls an 8255 keyboard matrix and performs its own line
      // editor/debounce work. Add an explicit inter-key settle period on top of
      // jsbeeb's key-up gap so commands are not lost while RETURN is processed.
      const pacedKeys = stringToATOMKeys(entry).flatMap((key) => [key, 140]);
      targetKeyboard.sendRawKeyboard([500, ...pacedKeys], false);
      if (replayEnabled) resetReplaySegment('Atom BASIC keyboard entry is an irreversible history boundary');
      const page = targetCpu.readmem(0x18) << 8;
      running = true;
      setStatus(`${targetCpu.model.name} Atom BASIC entry queued`, 'ready');
      send({ type: 'program-loaded', format: 'Atom BASIC keyboard queue', address: page, size: bytes.length, autorun, programManifest: loadedProgramManifest });
    } catch (error) {
      send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  const idleAddress = targetCpu.model.isMaster ? 0xe7e6 : 0xe581;
  const hook = targetCpu.debugInstruction.add((address) => {
    if (address !== idleAddress) return false;
    const page = targetCpu.readmem(0x18) << 8;
    bytes.forEach((byte, offset) => targetCpu.writemem(page + offset, byte));
    const end = page + bytes.length;
    for (const lowAddress of [0x02, 0x12]) { targetCpu.writemem(lowAddress, end & 0xff); targetCpu.writemem(lowAddress + 1, end >>> 8); }
    if (replayEnabled) resetReplaySegment('BASIC injection is an irreversible history boundary');
    hook.remove();
    if (autorun) {
      const keys = targetCpu.model.isAtom ? stringToATOMKeys('RUN\n') : stringToBBCKeys('RUN\n');
      targetKeyboard.sendRawKeyboard([1000, ...keys], false);
    }
    setStatus(`${targetCpu.model.name} BASIC loaded`, 'ready');
    send({ type: 'program-loaded', format: 'bbc-basic', address: page, size: bytes.length, autorun, programManifest: loadedProgramManifest });
    return false;
  });
  running = true;
  setStatus(`${cpu.model.name} loading BASIC`, 'ready');
}

function installBreakpoint(input: BreakpointSpec) {
  if (!cpu) return;
  const spec = validateBreakpointSpec(input);
  const normalized = spec.address & 0xffff;
  breakpointHooks.get(normalized)?.hook.remove();
  let entry: InstalledBreakpoint;
  const hook = cpu.debugInstruction.add((pc) => {
    if (replayInProgress) return false;
    if (pc !== normalized) return false;
    entry.hits++;
    const registers = { pc, a: cpu!.a, x: cpu!.x, y: cpu!.y, s: cpu!.s, p: cpu!.p.asByte() };
    if (!breakpointMatches(spec, registers, entry.hits)) return false;
    if (spec.logMessage) {
      const logEntry = { sequence: ++breakpointLogSequence, address: pc, hits: entry.hits, message: renderBreakpointLog(spec.logMessage, registers, entry.hits) };
      breakpointLogs.push(logEntry); if (breakpointLogs.length > 64) breakpointLogs.shift();
      send({ type: 'breakpoint-log', ...logEntry });
    }
    if (!spec.stop) return false;
    running = false;
    const kind = spec.condition ? 'conditional breakpoint' : spec.hitTarget ? 'hit-count breakpoint' : 'breakpoint';
    setStatus(`${kind} at &${pc.toString(16).toUpperCase().padStart(4, '0')}`, 'ready');
    queueMicrotask(() => sendSnapshot(kind));
    return true;
  });
  entry = { hook, spec, hits: 0 };
  breakpointHooks.set(normalized, entry);
}

function clearWatchpoints() {
  watchpointHooks.forEach((entry) => entry.hook.remove());
  watchpointHooks.clear();
  watchInstructionHook?.remove(); watchInstructionHook = null;
}

function installWatchpoint(input: WatchpointSpec) {
  if (!cpu) return;
  const spec = validateWatchpointSpec(input);
  const key = watchpointKey(spec);
  watchpointHooks.get(key)?.hook.remove(); watchpointHooks.delete(key);
  if (watchpointHooks.size >= 16) throw new Error('Hardware watchpoints are limited to 16 per debug session');
  if (!watchInstructionHook) watchInstructionHook = cpu.debugInstruction.add((pc) => { watchInstructionPc = pc; return false; });
  let entry: InstalledWatchpoint;
  const onAccess = (address: number, suppliedValue?: number) => {
    if (watchpointsSuspended) return false;
    if (address !== spec.address) return false;
    const value = spec.access === 'read' ? (suppliedValue ?? cpu!.peekmem(address)) & 0xff : (suppliedValue ?? 0) & 0xff;
    const previousValue = spec.access === 'read' ? undefined : cpu!.peekmem(address) & 0xff;
    entry.hits += 1; entry.previousValue = previousValue; entry.lastValue = value;
    const pc = address === cpu!.pc ? address : watchInstructionPc;
    entry.pc = pc;
    if (!watchpointMatches(spec, previousValue, value)) return false;
    const event = { sequence: ++watchpointSequence, address, pc, access: spec.access, hits: entry.hits, previousValue, value };
    watchpointEvents.push(event); if (watchpointEvents.length > 64) watchpointEvents.shift();
    running = false;
    const verb = spec.access === 'read' ? 'read' : spec.access === 'change' ? 'changed' : 'written';
    setStatus(`Watchpoint &${address.toString(16).toUpperCase().padStart(4, '0')} ${verb}`, 'ready');
    send({ type: 'watchpoint-hit', ...event });
    queueMicrotask(() => sendSnapshot(`${spec.access} watchpoint`));
    return true;
  };
  const hook = spec.access === 'read' ? cpu.debugRead.add(onAccess) : cpu.debugWrite.add(onAccess);
  entry = { hook, spec, hits: 0 };
  watchpointHooks.set(key, entry);
}

function loadMachineCode(bytes: number[], origin: number, entryPoint: number, autorun = true, breakpoints: number[] = [], sourceLocations: Record<string, TraceSourceLocation> = {}, symbols: Record<string, number> = {}, programManifest?: ProgramLoadManifest) {
  if (!cpu) return;
  if (!Number.isInteger(origin) || !Number.isInteger(entryPoint) || origin < 0 || origin > 0xffff || entryPoint < 0 || entryPoint > 0xffff) {
    send({ type: 'error', message: 'Machine-code origin and entry point must be 16-bit addresses' });
    return;
  }
  if (bytes.length === 0 || bytes.length > 0x8000 || origin + bytes.length > 0x8000) {
    send({ type: 'error', message: 'Machine-code loading is restricted to a non-empty contiguous RAM range below &8000' });
    return;
  }
  if (programManifest) {
    if (!runtimeSessionManifest) throw new Error('Program load requires an initialised runtime session');
    loadedProgramManifest = validateProgramLoadManifest(programManifest, runtimeSessionManifest.fingerprint, Uint8Array.from(bytes), origin, entryPoint);
  } else {
    loadedProgramManifest = null;
  }
  running = false;
  clearWatchpoints(); watchpointEvents = []; watchpointSequence = 0; stopInterruptMonitor(); clearInterruptHistory(); stopRasterMonitor(); clearRasterTimeline(); stopProfiler(); clearProfiler();
  registerEdits = []; registerEditSequence = 0; lastStep = null; stopTrace(); clearTrace();
  loadedSourceLocations = Object.fromEntries(Object.entries(sourceLocations).slice(0, 0x8000).flatMap(([address, location]) => {
    const numeric = Number(address);
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 0xffff && typeof location?.fileName === 'string' && location.fileName.length <= 255 && Number.isInteger(location.line) && location.line > 0 ? [[numeric, { fileName: location.fileName, line: location.line }]] : [];
  }));
  loadedSymbols = {};
  Object.entries(symbols).slice(0, 4096).forEach(([name, address]) => { if (name.length <= 128 && Number.isInteger(address) && address >= 0 && address <= 0xffff && loadedSymbols[address] === undefined) loadedSymbols[address] = name; });
  loadedProgramFingerprint = profileBuildFingerprint(bytes, origin);
  bytes.forEach((byte, offset) => cpu!.writemem(origin + offset, byte & 0xff));
  breakpointHooks.forEach((entry) => entry.hook.remove());
  breakpointHooks.clear();
  runToHook?.remove(); runToHook = null;
  discardHardwareTest();
  cpu.breakpointResume = false;
  breakpointLogs = []; breakpointLogSequence = 0;
  breakpoints.filter((address) => Number.isInteger(address) && address >= origin && address < origin + bytes.length).forEach((address) => installBreakpoint({ address, enabled: true, stop: true }));
  cpu.pc = entryPoint;
  trace = [];
  if (replayEnabled) resetReplaySegment('Machine-code load is an irreversible history boundary');
  running = autorun;
  setStatus(`${cpu.model.name} machine code ${autorun ? 'running' : 'loaded'}`, 'ready');
  send({ type: 'program-loaded', format: '6502 machine code', address: origin, size: bytes.length, entryPoint, autorun, programManifest: loadedProgramManifest });
  sendSnapshot(autorun ? 'program started' : 'program loaded');
}

async function loadTape(name: string, values: number[]) {
  if (!cpu) return;
  const bytes = Uint8Array.from(values);
  const format = validateTapeImage(bytes);
  const tape = await loadTapeFromData(name, bytes, cpu.model);
  if (!tape) throw new Error('The emulator could not parse this cassette image');
  if (cpu.model.isAtom) {
    if (!cpu.atomppia) throw new Error('This Atom profile has no cassette PPIA');
    cpu.atomppia.setTape(tape);
  } else {
    if (!cpu.acia) throw new Error('This machine profile has no cassette ACIA');
    cpu.acia.setTape(tape);
  }
  mountedTape = { name, format, size: bytes.length, tape: tape as unknown as TapeInternals };
  if (replayEnabled) resetReplaySegment('Cassette mount is an irreversible history boundary');
  setStatus(`${cpu.model.name} cassette mounted`, 'ready');
  send({ type: 'media-loaded', kind: 'tape', name, size: bytes.length, format });
}

function saveState() {
  if (!cpu || !runtimeSessionManifest) return;
  try {
    const wasRunning = running;
    running = false;
    const media = mountedDiscs.size ? {
      drives: Array.from(mountedDiscs, ([drive, disc]) => ({ drive, name: disc.name, bytes: disc.bytes })),
    } : undefined;
    const snapshot = createSnapshot(cpu, cpu.model, media);
    const payloadJson = snapshotToJSON(snapshot);
    const json = createMachineStateEnvelope(payloadJson, cpu.model.name, runtimeSessionManifest);
    const timestamp = snapshot.timestamp.replace(/[:.]/g, '-');
    send({ type: 'state-saved', json, filename: `8bit-net-${cpu.model.name.replace(/[^A-Za-z0-9._-]+/g, '-')}-${timestamp}.8bitstate.json`, size: json.length, schema: '8bit-net.machine-state', version: 1, romCount: runtimeSessionManifest.roms.length, adapterVersion: runtimeSessionManifest.adapter.version });
    running = wasRunning;
    setStatus(`${cpu.model.name} state saved`, 'ready');
    sendSnapshot('state saved');
  } catch (error) {
    send({ type: 'error', message: `Unable to save machine state: ${error instanceof Error ? error.message : String(error)}` });
  }
}

function loadState(json: string) {
  if (!cpu || !video || !runtimeSessionManifest) return;
  try {
    if (json.length > MACHINE_STATE_LIMIT) throw new Error('State files are limited to 12 MiB');
    running = false;
    const opened = openMachineStateEnvelope(json, cpu.model.name, runtimeSessionManifest);
    const snapshot = snapshotFromJSON(opened.payloadJson);
    const drives = snapshot.media?.drives;
    if (drives !== undefined && !Array.isArray(drives)) throw new Error('Snapshot media manifest is invalid');
    mountedDiscs.clear(); mountedTape = null;
    for (const item of drives ?? []) {
      if ((item.drive !== 0 && item.drive !== 1) || typeof item.name !== 'string' || !(item.bytes instanceof Uint8Array) || item.bytes.length > 2 * 1024 * 1024) throw new Error('Snapshot contains invalid or oversized disk media');
      cpu.fdc.loadDisc(item.drive, discFor(cpu.fdc, item.name, item.bytes));
      mountedDiscs.set(item.drive, { name: item.name, bytes: item.bytes.slice(), dirty: false, revision: 0 });
      send({ type: 'media-loaded', kind: 'disc', name: item.name, size: item.bytes.length, drive: item.drive });
    }
    clearWatchpoints(); watchpointEvents = []; watchpointSequence = 0; registerEdits = []; registerEditSequence = 0; lastStep = null; stopTrace(); clearTrace(); stopInterruptMonitor(); clearInterruptHistory(); stopRasterMonitor(); clearRasterTimeline(); stopProfiler(); clearProfiler(); loadedProgramFingerprint = 'restored-state'; loadedSourceLocations = {}; loadedSymbols = {};
    restoreSnapshot(cpu, cpu.model, snapshot);
    if (replayEnabled) resetReplaySegment('Loaded machine state is an irreversible history boundary');
    cpu.breakpointResume = false;
    breakpointHooks.forEach((entry) => entry.hook.remove());
    breakpointHooks.clear();
    runToHook?.remove(); runToHook = null;
    discardHardwareTest();
    trace = [];
    video.paint();
    setStatus(`${cpu.model.name} state restored`, 'ready');
    send({ type: 'state-loaded', model: snapshot.model, timestamp: snapshot.timestamp, mediaCount: drives?.length ?? 0, schema: opened.envelope.schema, version: opened.envelope.version, romCount: opened.envelope.roms.length, adapterVersion: opened.envelope.adapter.version, payloadSha256: opened.envelope.payload.sha256 });
    sendSnapshot('state restored');
  } catch (error) {
    send({ type: 'error', message: `Unable to load machine state: ${error instanceof Error ? error.message : String(error)}` });
  }
}

function captureScreen() {
  if (!cpu) return;
  canvas.toBlob((blob) => {
    if (!blob) { send({ type: 'error', message: 'Unable to encode the current framebuffer' }); return; }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    send({ type: 'screen-captured', blob, filename: `8bit-net-${cpu!.model.name.replace(/[^A-Za-z0-9._-]+/g, '-')}-${timestamp}.png`, width: canvas.width, height: canvas.height, size: blob.size });
  }, 'image/png');
}

function sendAudioState() {
  const status = browserAudio?.status() ?? { available: false, enabled: false, contextState: 'unavailable', buffers: 0, peak: 0 };
  const contextState = status.contextState;
  const available = status.available;
  const requiresGesture = audioEnabled && available && contextState !== 'running';
  audioActivation.hidden = !requiresGesture;
  send({ type: 'audio-state', ...status, enabled: audioEnabled && status.enabled, requiresGesture, recording: browserAudio?.captureActive ?? false });
}

async function setAudio(enabled: boolean) {
  if (!browserAudio) return;
  if (enabled && runtimeSpeed !== 1) { send({ type: 'audio-rejected', message: 'Machine audio is qualified only at authentic 1x runtime speed' }); return; }
  audioEnabled = enabled;
  try { await browserAudio.setEnabled(enabled); }
  catch { /* autoplay policy is represented by the suspended context state */ }
  sendAudioState();
  if (replayEnabled) resetReplaySegment('Audio activation is an external-session history boundary');
}

const hardwareNumber = (state: Record<string, unknown>, key: string) => Number(state[key] ?? 0) >>> 0;
const hardwareValues = (state: Record<string, unknown>, key: string) => Array.from((state[key] as ArrayLike<number> | undefined) ?? [], (value) => Number(value) >>> 0);
const hardwareRegister = (id: string, name: string, address: string, value: number, width: 8 | 16 | 32 = 8, access: HardwareRegisterDraft['access'] = 'read/write', bitfields: HardwareRegisterDraft['bitfields'] = []): HardwareRegisterDraft => ({ id, name, address, value: value >>> 0, width, access, bitfields });
const viaInterruptBits: Array<[number, string]> = [[7, 'IRQ'], [6, 'T1'], [5, 'T2'], [4, 'CB1'], [3, 'CB2'], [2, 'SR'], [1, 'CA1'], [0, 'CA2']];

function viaInspectorGroup(id: string, label: string, base: number, state: Record<string, unknown>): HardwareGroupDraft {
  const address = (offset: number) => `&${(base + offset).toString(16).toUpperCase().padStart(4, '0')}`;
  return { id, label, source: `jsbeeb ${label}.snapshotState() · side-effect-free internal state`, registers: [
    hardwareRegister('orb', 'ORB / IRB', address(0), hardwareNumber(state, 'orb')),
    hardwareRegister('ora', 'ORA / IRA', address(1), hardwareNumber(state, 'ora')),
    hardwareRegister('ddrb', 'Data direction B', address(2), hardwareNumber(state, 'ddrb'), 8, 'read/write', flagFields(hardwareNumber(state, 'ddrb'), Array.from({ length: 8 }, (_, bit) => [bit, `PB${bit}`]))),
    hardwareRegister('ddra', 'Data direction A', address(3), hardwareNumber(state, 'ddra'), 8, 'read/write', flagFields(hardwareNumber(state, 'ddra'), Array.from({ length: 8 }, (_, bit) => [bit, `PA${bit}`]))),
    hardwareRegister('t1c', 'Timer 1 counter', `${address(4)}–${address(5)}`, hardwareNumber(state, 't1c') & 0xffff, 16, 'internal state'),
    hardwareRegister('t1l', 'Timer 1 latch', `${address(6)}–${address(7)}`, hardwareNumber(state, 't1l') & 0xffff, 16),
    hardwareRegister('t2c', 'Timer 2 counter', `${address(8)}–${address(9)}`, hardwareNumber(state, 't2c') & 0xffff, 16, 'internal state'),
    hardwareRegister('sr', 'Shift register', address(10), hardwareNumber(state, 'sr')),
    hardwareRegister('acr', 'Auxiliary control', address(11), hardwareNumber(state, 'acr'), 8, 'read/write', [field('T1 mode', hardwareNumber(state, 'acr'), 0xc0, 6), field('T2 mode', hardwareNumber(state, 'acr'), 0x20, 5), field('shift mode', hardwareNumber(state, 'acr'), 0x1c, 2)]),
    hardwareRegister('pcr', 'Peripheral control', address(12), hardwareNumber(state, 'pcr'), 8, 'read/write', [field('CB2', hardwareNumber(state, 'pcr'), 0xe0, 5), field('CB1 edge', hardwareNumber(state, 'pcr'), 0x10, 4), field('CA2', hardwareNumber(state, 'pcr'), 0x0e, 1), field('CA1 edge', hardwareNumber(state, 'pcr'), 0x01)]),
    hardwareRegister('ifr', 'Interrupt flags', address(13), hardwareNumber(state, 'ifr'), 8, 'read/write', flagFields(hardwareNumber(state, 'ifr'), viaInterruptBits)),
    hardwareRegister('ier', 'Interrupt enables', address(14), hardwareNumber(state, 'ier'), 8, 'read/write', flagFields(hardwareNumber(state, 'ier'), viaInterruptBits)),
    hardwareRegister('pins-a', 'Port A pins', 'pins', hardwareNumber(state, 'portapins'), 8, 'internal state'),
    hardwareRegister('pins-b', 'Port B pins', 'pins', hardwareNumber(state, 'portbpins'), 8, 'internal state'),
    ...(Object.prototype.hasOwnProperty.call(state, 'IC32') ? [hardwareRegister('ic32', 'IC32 addressable latch', 'System VIA latch', hardwareNumber(state, 'IC32'), 8, 'internal state', flagFields(hardwareNumber(state, 'IC32'), [[7, 'caps LED'], [6, 'shift LED'], [3, 'keyboard write'], [2, 'speech read'], [1, 'speech write'], [0, 'sound write']]))] : []),
  ] };
}

function keyboardInspectorGroup(keys: ArrayLike<ArrayLike<number>> | undefined, enabled: boolean | undefined, source: string): HardwareGroupDraft | null {
  if (!keys) return null;
  const columns = Array.from(keys, (rows) => Array.from(rows, (pressed) => Number(pressed) ? 1 : 0));
  return { id: 'keyboard', label: 'Keyboard matrix', source, registers: [
    hardwareRegister('enabled', 'Keyboard scanning enabled', 'input gate', enabled === false ? 0 : 1, 8, 'internal state', flagFields(enabled === false ? 0 : 1, [[0, 'enabled']])),
    ...columns.map((rows, column) => {
      const value = packKeyboardColumn(rows);
      return hardwareRegister(`column-${column}`, `Matrix column ${column}`, `key matrix C${column}`, value, 16, 'internal state', rows.slice(0, 16).map((pressed, row) => ({ label: `R${row}`, value: pressed ? '1' : '0', active: Boolean(pressed) })));
    }),
  ] };
}

function cassetteInspectorGroup(): HardwareGroupDraft | null {
  if (!mountedTape) return null;
  const tape = mountedTape.tape;
  const stream = tape.stream ?? {};
  const chunkStream = tape.curChunk?.stream ?? {};
  const isUef = mountedTape.format.toUpperCase() === 'UEF';
  return { id: 'cassette', label: `${mountedTape.format} cassette transport`, source: 'jsbeeb loaded tape parser internals · observation does not poll, seek or consume data', registers: [
    hardwareRegister('source-size', 'Mounted source bytes', mountedTape.name, mountedTape.size, 32, 'read-only'),
    hardwareRegister('stream-position', isUef ? 'Outer UEF stream position' : 'Tapefile stream position', 'byte offset', Number(stream.pos ?? 0), 32, 'internal state'),
    hardwareRegister('stream-length', 'Decoded stream length', 'bytes', Number(stream.end ?? mountedTape.size), 32, 'read-only'),
    ...(isUef ? [
      hardwareRegister('chunk-id', 'Current UEF chunk ID', 'UEF chunk', Number(tape.curChunk?.id ?? 0), 16, 'internal state'),
      hardwareRegister('chunk-position', 'Current chunk position', 'chunk byte offset', Number(chunkStream.pos ?? 0), 32, 'internal state'),
      hardwareRegister('chunk-length', 'Current chunk length', 'chunk bytes', Number(chunkStream.end ?? 0), 32, 'read-only'),
      hardwareRegister('parser-state', 'Parser state', 'UEF decoder', Number(tape.state ?? -1) >>> 0, 32, 'internal state'),
      hardwareRegister('current-byte', 'Current decoded byte', 'UEF decoder', Number(tape.curByte ?? 0), 8, 'internal state'),
      hardwareRegister('base-frequency', 'Base frequency', 'Hz', Number(tape.baseFrequency ?? 0), 32, 'internal state'),
      hardwareRegister('atom-wavebits', 'Queued Atom wavebits', 'Atom decoder', Number(tape.atomWavebitsLeft ?? 0), 16, 'internal state'),
    ] : [hardwareRegister('parser-count', 'Tapefile parser count', 'tapefile decoder', Number(tape.count ?? 0), 32, 'internal state')]),
  ] };
}

function captureHardwareInspection(): HardwareInspection {
  if (!cpu || !video) throw new Error('Hardware inspector requires an initialised machine');
  const groups: HardwareGroupDraft[] = [];
  const videoState = video.snapshotState();
  groups.push({ id: 'video-timing', label: cpu.model.isAtom ? 'MC6847 video timing' : 'Video timing and beam', source: 'jsbeeb Video.snapshotState() · renderer counters', registers: [
    hardwareRegister('frame', 'Frame count', 'renderer', hardwareNumber(videoState, 'frameCount'), 32, 'internal state'),
    hardwareRegister('x', 'Bitmap X', 'beam', hardwareNumber(videoState, 'bitmapX'), 16, 'internal state'),
    hardwareRegister('y', 'Bitmap Y', 'beam', hardwareNumber(videoState, 'bitmapY'), 16, 'internal state'),
    ...(cpu.model.isAtom ? [] : [hardwareRegister('address', 'Display address', 'CRTC MA', hardwareNumber(videoState, 'addr'), 16, 'internal state'), hardwareRegister('scanline', 'Scanline counter', 'CRTC RA', hardwareNumber(videoState, 'scanlineCounter'), 8, 'internal state')]),
  ] });
  if (cpu.model.isAtom) {
    const ppia = cpu.atomppia?.snapshotState() ?? {};
    const portA = hardwareNumber(ppia, 'latcha');
    const portC = hardwareNumber(ppia, 'latchc');
    groups.push({ id: 'atom-ppia', label: '8255 PPIA · keyboard, tape and video', source: 'jsbeeb AtomPPIA.snapshotState() · side-effect-free internal state', registers: [
      hardwareRegister('porta', 'Port A latch / VDG mode', '&B000', portA, 8, 'read/write', [...flagFields(portA, [[7, 'GM2'], [6, 'GM1'], [5, 'GM0'], [4, 'A/G']]), field('keyboard row', portA, 0x0f)]),
      hardwareRegister('portb', 'Port B latch / keyboard input', '&B001', hardwareNumber(ppia, 'latchb')),
      hardwareRegister('portc', 'Port C latch / tape, speaker, CSS', '&B002', portC, 8, 'read/write', flagFields(portC, [[3, 'CSS'], [2, 'speaker'], [1, 'tape out'], [0, '2.4 kHz']])),
      hardwareRegister('control', 'PPIA control', '&B003', hardwareNumber(ppia, 'creg')),
      hardwareRegister('pins-a', 'Port A pins', 'pins', hardwareNumber(ppia, 'portapins'), 8, 'internal state'),
      hardwareRegister('pins-b', 'Port B pins', 'pins', hardwareNumber(ppia, 'portbpins'), 8, 'internal state'),
      hardwareRegister('pins-c', 'Port C pins', 'pins', hardwareNumber(ppia, 'portcpins'), 8, 'internal state'),
    ] });
    const keyboardGroup = keyboardInspectorGroup(cpu.atomppia?.keys, cpu.atomppia?.keyboardEnabled, 'jsbeeb AtomPPIA key matrix · direct side-effect-free internal array read; coordinates are not guessed key names');
    if (keyboardGroup) groups.push(keyboardGroup);
  } else {
    const crtcNames = ['Horizontal total', 'Horizontal displayed', 'HSync position', 'Sync widths', 'Vertical total', 'Vertical adjust', 'Vertical displayed', 'VSync position', 'Interlace / skew', 'Scanlines per character', 'Cursor start', 'Cursor end', 'Display start high', 'Display start low', 'Cursor address high', 'Cursor address low', 'Light pen high', 'Light pen low'];
    const crtc = hardwareValues(videoState, 'regs');
    groups.push({ id: 'crtc', label: '6845 CRTC', source: 'jsbeeb Video.snapshotState().regs · selected-register latch is not read', registers: crtcNames.map((name, index) => hardwareRegister(`r${index}`, `R${index} · ${name}`, `&FE00/01 · R${index}`, crtc[index] ?? 0, 8, index < 12 ? 'write-only latch' : 'read/write', index === 3 ? [field('HSync width', crtc[index] ?? 0, 0x0f), field('VSync width', crtc[index] ?? 0, 0xf0, 4)] : index === 8 ? [field('interlace', crtc[index] ?? 0, 0x03), field('display skew', crtc[index] ?? 0, 0x30, 4), field('cursor skew', crtc[index] ?? 0, 0xc0, 6)] : [])) });
    const ula = hardwareNumber(videoState, 'ulactrl');
    groups.push({ id: 'video-ula', label: 'Video ULA', source: 'jsbeeb Video.snapshotState() · internal latch and resolved palette', registers: [hardwareRegister('control', 'Control latch', '&FE20', ula, 8, 'write-only latch', [...flagFields(ula, [[0, 'flash phase'], [1, 'teletext'], [4, '8 px/character']]), field('mode', ula, 0x0c, 2)]), ...hardwareValues(videoState, 'actualPal').slice(0, 16).map((colour, index) => hardwareRegister(`palette-${index}`, `Logical colour ${index}`, '&FE21 latch', colour, 8, 'write-only latch'))] });
    if (cpu.sysvia) groups.push(viaInspectorGroup('system-via', 'System VIA 6522', 0xfe40, cpu.sysvia.snapshotState()));
    if (cpu.uservia) groups.push(viaInspectorGroup('user-via', 'User VIA 6522', 0xfe60, cpu.uservia.snapshotState()));
    const keyboardGroup = keyboardInspectorGroup(cpu.sysvia?.keys, cpu.sysvia?.keyboardEnabled, 'jsbeeb System VIA key matrix · direct side-effect-free internal array read; coordinates are not guessed key names');
    if (keyboardGroup) groups.push(keyboardGroup);
    const acia = cpu.acia?.snapshotState();
    if (acia) groups.push({ id: 'acia', label: '6850 ACIA · serial and cassette', source: 'jsbeeb ACIA.snapshotState() · data register is not consumed', registers: [hardwareRegister('status', 'Status', '&FE08', hardwareNumber(acia, 'sr'), 8, 'read-only', flagFields(hardwareNumber(acia, 'sr'), [[7, 'IRQ'], [3, 'DCD'], [2, 'TDRE'], [1, 'RDRF']])), hardwareRegister('control', 'Control', '&FE08', hardwareNumber(acia, 'cr'), 8, 'write-only latch'), hardwareRegister('data', 'Data latch', '&FE09', hardwareNumber(acia, 'dr'), 8, 'internal state'), hardwareRegister('transport', 'Cassette / serial selection', 'transport', (hardwareNumber(acia, 'rs423Selected') ? 2 : 0) | (hardwareNumber(acia, 'motorOn') ? 1 : 0), 8, 'internal state', flagFields((hardwareNumber(acia, 'rs423Selected') ? 2 : 0) | (hardwareNumber(acia, 'motorOn') ? 1 : 0), [[1, 'RS423'], [0, 'motor']])), hardwareRegister('rx-rate', 'Receive clock rate', 'serial clock', hardwareNumber(acia, 'serialReceiveRate'), 32, 'internal state'), hardwareRegister('tx-rate', 'Transmit clock rate', 'serial clock', hardwareNumber(acia, 'serialTransmitRate'), 32, 'internal state')] });
    const adc = cpu.adconverter?.snapshotState();
    if (adc) { const base = cpu.model.isMaster ? 0xfe18 : 0xfec0; groups.push({ id: 'adc', label: 'Analogue-to-digital converter', source: 'jsbeeb ADC.snapshotState() · conversion is not started or acknowledged', registers: [hardwareRegister('status', 'Status / channel', `&${base.toString(16).toUpperCase()}`, hardwareNumber(adc, 'status'), 8, 'read-only'), hardwareRegister('result', 'Conversion result', `&${(base + 1).toString(16).toUpperCase()}–&${(base + 2).toString(16).toUpperCase()}`, ((hardwareNumber(adc, 'high') << 8) | hardwareNumber(adc, 'low')) & 0xffff, 16, 'read-only')] }); }
    const map = memoryMapState()!;
    groups.push({ id: 'memory-control', label: 'ROM and memory control', source: 'jsbeeb CPU romsel/acccon fields · no paging register access', registers: [
      hardwareRegister('romsel', 'ROMSEL / sideways bank', '&FE30', cpu.romsel, 8, cpu.model.isMaster ? 'read/write' : 'write-only latch', [field('bank', cpu.romsel, 0x0f), ...(cpu.model.isMaster ? flagFields(cpu.romsel, [[7, 'ANDY enable']]) : [])]),
      ...(cpu.model.isMaster ? [hardwareRegister('acccon', 'ACCCON', '&FE34', cpu.acccon, 8, 'read/write', map.accconFlags.map((item) => ({ label: item.bit, value: item.set ? '1' : '0', active: item.set })))] : []),
    ] });
    const fdc = cpu.fdc.snapshotState();
    const fdcBase = cpu.model.isMaster ? 0xfe24 : 0xfe80;
    const wdController = Object.prototype.hasOwnProperty.call(fdc, 'controlRegister');
    const driveStates = Array.isArray(fdc.drives) ? fdc.drives as Array<Record<string, unknown>> : [];
    groups.push({ id: 'fdc', label: wdController ? '1770 floppy controller' : '8271 floppy controller', source: `jsbeeb ${wdController ? 'WD FDC' : 'Intel FDC'}.snapshotState() · status/data are not acknowledged`, registers: [...(wdController ? [
      hardwareRegister('control', 'Drive control', `&${fdcBase.toString(16).toUpperCase()}`, hardwareNumber(fdc, 'controlRegister'), 8, 'write-only latch'),
      hardwareRegister('status', 'Status', `&${(fdcBase + 4).toString(16).toUpperCase()}`, hardwareNumber(fdc, 'statusRegister'), 8, 'read-only', flagFields(hardwareNumber(fdc, 'statusRegister'), [[7, 'motor'], [1, 'DRQ'], [0, 'busy']])),
      hardwareRegister('track', 'Track', `&${(fdcBase + 5).toString(16).toUpperCase()}`, hardwareNumber(fdc, 'trackRegister')),
      hardwareRegister('sector', 'Sector', `&${(fdcBase + 6).toString(16).toUpperCase()}`, hardwareNumber(fdc, 'sectorRegister')),
      hardwareRegister('data', 'Data latch', `&${(fdcBase + 7).toString(16).toUpperCase()}`, hardwareNumber(fdc, 'dataRegister'), 8, 'internal state'),
    ] : [
      hardwareRegister('status', 'Host status', '&FE80', hardwareNumber(fdc, 'status'), 8, 'read-only', flagFields(hardwareNumber(fdc, 'status'), [[7, 'NMI'], [3, 'need data'], [2, 'result full'], [1, 'command full'], [0, 'busy']])),
      hardwareRegister('data', 'Internal data latch', '&FE84–&FE87', hardwareNumber(fdc, 'mmioData'), 8, 'internal state'),
      hardwareRegister('drive', 'Drive output', 'controller pins', hardwareNumber(fdc, 'driveOut'), 8, 'internal state'),
    ]), ...driveStates.flatMap((drive, index) => [hardwareRegister(`drive-${index}-track`, `Drive ${index} track`, 'mechanism', hardwareNumber(drive, 'track'), 8, 'internal state'), hardwareRegister(`drive-${index}-state`, `Drive ${index} mechanics`, 'mechanism', (hardwareNumber(drive, 'spinning') ? 1 : 0) | (hardwareNumber(drive, 'isSideUpper') ? 2 : 0) | (hardwareNumber(drive, 'is40Track') ? 4 : 0), 8, 'internal state', flagFields((hardwareNumber(drive, 'spinning') ? 1 : 0) | (hardwareNumber(drive, 'isSideUpper') ? 2 : 0) | (hardwareNumber(drive, 'is40Track') ? 4 : 0), [[0, 'spinning'], [1, 'upper side'], [2, '40 track']]))])] });
    const sound = cpu.soundChip?.snapshotState();
    if (sound && hardwareValues(sound, 'registers').length) groups.push({ id: 'sound', label: 'SN76489 sound generator', source: 'jsbeeb SoundChip.snapshotState() · internal tone/noise and attenuation latches', registers: [
      ...hardwareValues(sound, 'registers').slice(0, 4).map((value, index) => hardwareRegister(`tone-${index}`, index < 3 ? `Tone ${index} period` : 'Noise control', 'System VIA slow bus', value, 16, 'write-only latch')),
      ...hardwareValues(sound, 'volume').slice(0, 4).map((value, index) => hardwareRegister(`volume-${index}`, `Channel ${index} attenuation`, 'System VIA slow bus', value, 16, 'internal state')),
      hardwareRegister('latched', 'Selected register', 'internal latch', hardwareNumber(sound, 'latchedRegister'), 8, 'internal state'),
    ] });
    if (cpu.hasTube && cpu.tube) {
      const tubeProcessor = cpu.tube.snapshotState();
      const tube = (tubeProcessor.ula ?? {}) as Record<string, unknown>;
      const hostStatus = hardwareValues(tube, 'hostStatus');
      const parasiteStatus = hardwareValues(tube, 'parasiteStatus');
      groups.push({ id: 'tube-ula', label: 'Tube ULA', source: 'jsbeeb Tube.snapshotState() · FIFO/status latches are not acknowledged', registers: [
        hardwareRegister('control', 'Internal status / control', '&FEE0', hardwareNumber(tube, 'internalStatusRegister'), 8, 'internal state'),
        ...hostStatus.slice(0, 4).map((value, index) => hardwareRegister(`host-${index + 1}`, `Host status R${index + 1}`, `&FEE${index * 2 + 1}`, value, 8, 'internal state')),
        ...parasiteStatus.slice(0, 4).map((value, index) => hardwareRegister(`parasite-${index + 1}`, `Parasite status R${index + 1}`, `parasite R${index + 1}`, value, 8, 'internal state')),
        hardwareRegister('p2h-1', 'Parasite→host FIFO 1 count', 'FIFO', hardwareNumber(tube, 'parasiteToHostFifoByteCount1'), 8, 'internal state'),
        hardwareRegister('p2h-3', 'Parasite→host FIFO 3 count', 'FIFO', hardwareNumber(tube, 'parasiteToHostFifoByteCount3'), 8, 'internal state'),
        hardwareRegister('h2p-3', 'Host→parasite FIFO 3 count', 'FIFO', hardwareNumber(tube, 'hostToParasiteFifoByteCount3'), 8, 'internal state'),
      ] });
    }
  }
  const cassetteGroup = cassetteInspectorGroup();
  if (cassetteGroup) groups.push(cassetteGroup);
  const inspection: HardwareInspection = { sequence: ++hardwareInspectionSequence, cycles: absoluteCpuCycles(), profile: cpu.model.isAtom ? 'atom' : cpu.model.isMaster ? 'master' : 'bbc', groups: compareHardwareGroups(groups, hardwareInspection) };
  hardwareInspection = inspection;
  return inspection;
}

window.addEventListener('message', (event: MessageEvent<Command>) => {
  if (event.origin !== window.location.origin || event.source !== window.parent) return;
  const command = event.data;
  if (!command || typeof command.type !== 'string') return;
  if (!commandBelongsToSession(debugSessionId, command.sessionId)) return;
  if (!commandSequence.accept(command.commandId)) return;
  recordDebugCommand(command);
  send({ type: 'command-accepted', commandId: command.commandId ?? 0, queued: 0, capacity: 64 });
  if (command.type === 'initialise') void initialise(command.model, command.romSetId, command.tube, command.extraRoms, command.keyboardLayout, command.sessionManifest, command.keyRemaps).catch((error) => { const message = error instanceof Error ? error.message : String(error); setStatus(message, 'error'); send({ type: 'error', message }); });
  else if (command.type === 'run' && cpu) { running = true; setStatus(`${cpu.model.name} running`, 'ready'); sendSnapshot('continued'); }
  else if (command.type === 'pause' && cpu) { running = false; if (tracePending && absoluteCpuCycles() > tracePending.startedAtCycle && !cpu.breakpointResume) finalizeTracePending(); if (profilerPending && absoluteCpuCycles() > profilerPending.startedAtCycle && !cpu.breakpointResume) finalizeProfilerInstruction(); setStatus(`${cpu.model.name} paused`, 'ready'); sendSnapshot(); }
  else if (command.type === 'stop' && cpu) { running = false; runToHook?.remove(); runToHook = null; discardHardwareTest(); setStatus(`${cpu.model.name} debug session stopped`, 'ready'); sendSnapshot('debug session stopped'); }
  else if (command.type === 'step') step();
  else if (command.type === 'step-over') stepOver();
  else if (command.type === 'step-out') stepOut();
  else if (command.type === 'source-step') sourceStep(command.mode, command.instructionBudget);
  else if (command.type === 'run-to') runTo(command.address);
  else if (command.type === 'run-test' && cpu) { try { startHardwareTest(command); } catch (error) { send({ type: 'test-result', name: command.name, requestId: command.requestId, planId: command.planId, suite: command.suite, buildFingerprint: command.buildFingerprint, status: 'error', reason: error instanceof Error ? error.message : String(error), cycles: 0, assertions: [] }); } }
  else if (command.type === 'reset' && cpu) { runToHook?.remove(); runToHook = null; discardHardwareTest(); stopTrace(); clearTrace(); stopInterruptMonitor(); clearInterruptHistory(); stopRasterMonitor(); clearRasterTimeline(); stopProfiler(); clearProfiler(); loadedProgramFingerprint = 'ROM-session'; if (bbcMouseJoystickEnabled && !cpu.model.isAtom) updateBbcMouseJoystick(undefined, true); cpu.reset(true); running = true; trace = []; emulatedCycles = 0; registerEdits = []; registerEditSequence = 0; lastStep = null; if (replayEnabled) resetReplaySegment('Hard reset is an irreversible history boundary'); setStatus(`${cpu.model.name} reset`, 'ready'); sendSnapshot('hard reset'); }
  else if (command.type === 'breakpoint' && cpu) {
    const address = command.address & 0xffff;
    breakpointHooks.get(address)?.hook.remove(); breakpointHooks.delete(address);
    try {
      if (command.enabled) installBreakpoint(command);
      sendSnapshot('breakpoints changed');
    } catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
  } else if (command.type === 'set-breakpoints' && cpu) {
    try {
      if (!Array.isArray(command.breakpoints) || command.breakpoints.length > 64) throw new Error('At most 64 permanent 6502 breakpoints may be installed');
      const specs = command.breakpoints.map(validateBreakpointSpec);
      const addresses = new Set<number>();
      specs.forEach((spec) => { if (addresses.has(spec.address)) throw new Error(`Duplicate breakpoint address &${spec.address.toString(16).toUpperCase().padStart(4, '0')}`); addresses.add(spec.address); });
      breakpointHooks.forEach((entry) => entry.hook.remove()); breakpointHooks.clear();
      specs.forEach(installBreakpoint);
      sendSnapshot('breakpoint set changed');
    } catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
  } else if (command.type === 'watchpoint' && cpu) {
    const key = watchpointKey(command);
    watchpointHooks.get(key)?.hook.remove(); watchpointHooks.delete(key);
    if (!watchpointHooks.size) { watchInstructionHook?.remove(); watchInstructionHook = null; }
    try {
      if (command.enabled) installWatchpoint(command);
      sendSnapshot('watchpoints changed');
    } catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
  } else if (command.type === 'interrupt-monitor' && cpu) {
    try { if (command.enabled) startInterruptMonitor(command.capacity ?? 128); else stopInterruptMonitor(); sendSnapshot(command.enabled ? 'interrupt monitor started' : 'interrupt monitor stopped'); }
    catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
  } else if (command.type === 'interrupt-history-clear' && cpu) {
    clearInterruptHistory();
    if (interruptMonitorEnabled) interruptMonitorPrevious = { pc: cpu.pc, opcode: cpu.peekmem(cpu.pc), s: cpu.s, p: cpu.p.asByte(), state: interruptState() };
    sendSnapshot('interrupt history cleared');
  } else if (command.type === 'raster-monitor' && cpu) {
    try { if (command.enabled) startRasterMonitor(command); else stopRasterMonitor(); sendSnapshot(command.enabled ? 'raster monitor started' : 'raster monitor stopped'); }
    catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
  } else if (command.type === 'raster-timeline-clear' && cpu) {
    clearRasterTimeline(); if (rasterMonitorEnabled) rasterPrevious = currentRasterSample(); sendSnapshot('raster timeline cleared');
  } else if (command.type === 'profiler-config' && cpu) {
    try { if (command.enabled) startProfiler(command); else stopProfiler(); sendSnapshot(command.enabled ? 'profiler started' : 'profiler stopped'); }
    catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
  } else if (command.type === 'profiler-clear' && cpu) {
    clearProfiler(); sendSnapshot('profiler cleared');
  } else if (command.type === 'replay-config' && cpu) {
    try { if (command.enabled) startReplay(command); else stopReplay(); sendSnapshot(command.enabled ? 'deterministic history started' : 'deterministic history stopped'); }
    catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
  } else if (command.type === 'reverse-step' && cpu) {
    reverseStep();
  } else if (command.type === 'reverse-continue' && cpu) {
    reverseContinue();
  } else if (command.type === 'inspect-hardware' && cpu) {
    try { send({ type: 'hardware-inspection', inspection: captureHardwareInspection() }); }
    catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
  } else if (command.type === 'read-disassembly' && cpu) {
    try {
      const request = validateLiveDisassemblyRequest(command);
      const rows: Array<Record<string, unknown>> = [];
      let address = request.address;
      for (let index = 0; index < request.instructionCount; index++) {
        const decoded = instructionDetailsAt(address)!;
        const rendered = instructionAt(address);
        const controlTarget = decoded.branchTarget ?? (['JMP', 'JSR'].includes(decoded.mnemonic) ? decoded.effectiveAddress : undefined);
        rows.push({ address, addressSpace: 'mapped 6502', bank: 'current mapping', bytes: decoded.bytes, instruction: rendered.instruction, mnemonic: decoded.mnemonic, addressingMode: decoded.addressingMode, branchTarget: controlTarget, effectiveAddress: decoded.effectiveAddress, source: loadedSourceLocations[address], symbol: loadedSymbols[address] });
        const next = address + Math.max(1, decoded.length);
        if (next > 0xffff) break;
        address = next;
      }
      send({ type: 'disassembly', requestId: request.requestId, address: request.address, addressSpace: 'mapped 6502', bank: 'current mapping', capturedAtCycles: emulatedCycles, rows });
    } catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
  } else if (command.type === 'read-memory' && cpu) {
    try {
      if (typeof command.requestId !== 'string' || !command.requestId || command.requestId.length > 128) throw new Error('Memory request ID must contain 1–128 characters');
      const map = memoryMapState()!;
      const addressSpace = command.addressSpace ?? 'mapped';
      const validated = validateMemorySpaceRead(map, addressSpace, command.address, command.length, command.bank);
      const bytes = Array.from({ length: command.length }, (_, offset) => {
        const address = command.address + offset;
        if (addressSpace === 'mapped') return cpu!.peekmem(address);
        const index = physicalMemoryIndex(addressSpace, address, command.bank, cpu!.romOffset, cpu!.osOffset);
        if (index === null || index < 0 || index >= cpu!.ramRomOs.length) throw new Error('Resolved physical memory index is outside the emulator store');
        return cpu!.ramRomOs[index]!;
      });
      send({ type: 'memory', requestId: command.requestId, address: command.address, addressSpace, addressSpaceLabel: validated.space.label, bank: validated.bank, capturedAtCycles: emulatedCycles, bytes });
    } catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
  } else if (command.type === 'read-tube-memory' && cpu) {
    try {
      if (!cpu.hasTube || !cpu.tube) throw new Error('The attached machine has no Tube parasite processor');
      if (typeof command.requestId !== 'string' || !command.requestId || command.requestId.length > 128) throw new Error('Tube memory request ID must contain 1 to 128 characters');
      const start = command.addressSpace === 'tube-rom' ? 0xf000 : 0;
      const end = 0xffff;
      if (!Number.isInteger(command.address) || !Number.isInteger(command.length) || command.length < 1 || command.length > 4096 || command.address < start || command.address + command.length - 1 > end) throw new Error(`Tube ${command.addressSpace === 'tube-rom' ? 'boot ROM' : 'address-space'} reads require 1–4096 bytes wholly inside &${start.toString(16).toUpperCase().padStart(4, '0')}–&FFFF`);
      if (command.addressSpace === 'tube-logical' && command.address <= 0xfeff && command.address + command.length - 1 >= 0xfef8) throw new Error('Logical Tube reads cannot include ULA I/O at &FEF8–&FEFF because a read could acknowledge or consume FIFO state');
      const state = cpu.tube.snapshotState({ includeRoms: true }) as Record<string, unknown>;
      const memory = state.memory instanceof Uint8Array ? state.memory : new Uint8Array(0x10000);
      const rom = state.rom instanceof Uint8Array ? state.rom : new Uint8Array(0x1000);
      const bytes = Array.from({ length: command.length }, (_, offset) => {
        const address = command.address + offset;
        if (command.addressSpace === 'tube-rom') return rom[address - 0xf000]!;
        if (command.addressSpace === 'tube-logical' && Boolean(state.romPaged) && address >= 0xf000) return rom[address - 0xf000]!;
        return memory[address]!;
      });
      const labels = { 'tube-logical': `Parasite logical CPU view${Boolean(state.romPaged) ? ' with boot ROM overlay' : ''}`, 'tube-ram': 'Parasite physical 64 KiB RAM backing', 'tube-rom': 'Parasite physical 4 KiB boot ROM' };
      send({ type: 'memory', requestId: command.requestId, address: command.address, addressSpace: command.addressSpace, addressSpaceLabel: labels[command.addressSpace], capturedAtCycles: emulatedCycles, bytes });
    } catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
  } else if (command.type === 'write-memory' && cpu) {
    if (running) { send({ type: 'error', message: 'Pause the machine before editing memory' }); return; }
    if (!Number.isInteger(command.address) || command.address < 0 || command.address >= 0x8000 || command.bytes.length < 1 || command.bytes.length > 256 || command.address + command.bytes.length > 0x8000 || command.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 0xff)) { send({ type: 'error', message: 'Memory edits are limited to 1–256 validated bytes in main RAM below &8000' }); return; }
    watchpointsSuspended = true;
    try { command.bytes.forEach((byte, offset) => cpu!.writemem(command.address + offset, byte)); }
    finally { watchpointsSuspended = false; }
    if (replayEnabled) resetReplaySegment('Memory edit is an irreversible history boundary');
    send({ type: 'memory-written', address: command.address, bytes: command.bytes });
    const readBackLength = Math.min(Math.max(16, command.bytes.length), 0x10000 - command.address);
    send({ type: 'memory', requestId: `write-${command.address}`, address: command.address, addressSpace: 'mapped 6502', capturedAtCycles: emulatedCycles, bytes: Array.from({ length: readBackLength }, (_, offset) => cpu!.peekmem(command.address + offset)) });
    sendSnapshot('memory edited');
  } else if (command.type === 'write-registers' && cpu) {
    if (running) { send({ type: 'error', message: 'Pause the machine before editing registers' }); return; }
    try {
      const patch = validateRegisterPatch(command.registers);
      const before = testRegisters();
      for (const [name, value] of Object.entries(patch) as Array<[Editable6502Register, number]>) {
        if (name === 'p') cpu.p.setFromByte(value);
        else cpu[name] = value;
      }
      if (patch.p !== undefined) cpu.checkInt();
      if (patch.pc !== undefined) cpu.breakpointResume = false;
      lastStep = null;
      const after = testRegisters();
      const changed = (Object.keys(patch) as Editable6502Register[]).filter((name) => before[name] !== after[name]);
      const entry = { sequence: ++registerEditSequence, before, after, changed };
      registerEdits.push(entry); if (registerEdits.length > 32) registerEdits.shift();
      if (replayEnabled) resetReplaySegment('Register edit is an irreversible history boundary');
      send({ type: 'registers-written', ...entry });
      setStatus(`${cpu.model.name} registers edited`, 'ready');
      sendSnapshot('registers edited');
    } catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
  }
  else if (command.type === 'trace-config' && cpu) {
    try { if (command.enabled) startTrace(command); else stopTrace(); sendSnapshot(command.enabled ? 'trace started' : 'trace stopped'); }
    catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
  } else if (command.type === 'trace-clear' && cpu) { clearTrace(); sendSnapshot('trace cleared'); }
  else if (command.type === 'load-basic') loadBasic(command.bytes, command.autorun, command.format, command.programManifest);
  else if (command.type === 'load-machine-code') loadMachineCode(command.bytes, command.origin, command.entryPoint, command.autorun, command.breakpoints, command.sourceLocations, command.symbols, command.programManifest);
  else if (command.type === 'save-state') saveState();
  else if (command.type === 'load-state') loadState(command.json);
  else if (command.type === 'capture-screen') captureScreen();
  else if (command.type === 'focus-input') { canvas.focus(); send({ type: 'input-focus', captured: document.activeElement === canvas }); }
  else if (command.type === 'release-input') { canvas.blur(); cpu?.sysvia?.clearKeys?.(); cpu?.atomppia?.clearKeys?.(); send({ type: 'input-focus', captured: false }); }
  else if (command.type === 'set-keyboard-layout' && keyboard) {
    if (!isJsBeebKeyboardLayout(command.layout)) { send({ type: 'error', message: 'Unknown jsbeeb keyboard mapping profile' }); return; }
    keyboard.setKeyLayout(command.layout); send({ type: 'keyboard-layout', layout: command.layout });
  }
  else if (command.type === 'set-key-remaps') {
    try { const remaps = validateMachineKeyRemaps(command.remaps); keyRemaps = new Map(remaps.map((remap) => [remap.hostCode, remap.targetCode])); cpu?.sysvia?.clearKeys?.(); cpu?.atomppia?.clearKeys?.(); send({ type: 'key-remaps', remaps }); }
    catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
  }
  else if (command.type === 'inject-text' && keyboard && cpu) {
    try {
      const text = validateMachineText(command.text);
      const keys = cpu.model.isAtom ? stringToATOMKeys(text) : stringToBBCKeys(text);
      keyboard.sendRawKeyboard([100, ...keys], false);
      if (replayEnabled) resetReplaySegment('Pasted machine text is an irreversible history boundary');
      send({ type: 'text-queued', characters: text.length });
    } catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
  }
  else if (command.type === 'tap-key' && keyboard) {
    try {
      const keyCode = validateMachineTapCode(command.code);
      const event = { keyCode, which: keyCode, charCode: 0, location: 0, altKey: false, ctrlKey: false, shiftKey: false, preventDefault() {} } as KeyboardEvent;
      keyboard.keyDown(event); window.setTimeout(() => keyboard?.keyUp(event), 70);
      if (replayEnabled) resetReplaySegment('On-screen keyboard input is an irreversible history boundary');
      send({ type: 'key-tapped', code: keyCode });
    } catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
  }
  else if (command.type === 'gamepad-key-edge' && keyboard) {
    try {
      if (!GAMEPAD_ACTIONS.some((action) => action.id === command.action) || typeof command.pressed !== 'boolean') throw new Error('Gamepad edge action or state is invalid');
      const keyCode = validateMachineTapCode(command.code);
      const event = { keyCode, which: keyCode, charCode: 0, location: 0, altKey: false, ctrlKey: false, shiftKey: false, preventDefault() {} } as KeyboardEvent;
      if (command.pressed) keyboard.keyDown(event); else keyboard.keyUp(event);
      if (replayEnabled) resetReplaySegment('Gamepad input is an irreversible history boundary');
      send({ type: 'gamepad-input', action: command.action, code: keyCode, pressed: command.pressed });
    } catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
  }
  else if (command.type === 'bbc-analogue-joystick' && cpu) {
    try {
      const { verifiedChannels, verifiedButtons } = applyBbcAnalogueJoystick(command.channels, command.buttons);
      if (replayEnabled) resetReplaySegment('BBC analogue joystick input is an irreversible history boundary');
      send({ type: 'bbc-analogue-joystick-input', channels: [...analogueJoystickChannels], buttons: [...command.buttons], verifiedChannels, verifiedButtons, source: 'jsbeeb ADC channel sources and System VIA PB4/PB5 readback' });
    } catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
  }
  else if (command.type === 'atom-atommc-joystick' && cpu) {
    try {
      const { port, verifiedButtons } = applyAtomMmcJoystick(command);
      if (replayEnabled) resetReplaySegment('Atom AtoMMC joystick input is an irreversible history boundary');
      send({ type: 'atom-atommc-joystick-input', ...verifiedButtons, port, source: 'attached AtoMMC gamepad source read by CMD_READ_PORT at &B400' });
    } catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
  }
  else if (command.type === 'set-bbc-mouse-joystick' && cpu) {
    try {
      if (typeof command.enabled !== 'boolean' || cpu.model.isAtom) throw new Error('Mouse analogue joystick mode requires a BBC or Master jsbeeb model');
      bbcMouseJoystickEnabled = command.enabled;
      if (!command.enabled) { bbcMouseJoystickButtons = [false, false]; applyBbcAnalogueJoystick([0x8000, 0x8000, 0x8000, 0x8000], bbcMouseJoystickButtons); }
      send({ type: 'bbc-mouse-joystick-state', enabled: bbcMouseJoystickEnabled, channels: [...analogueJoystickChannels], buttons: [...bbcMouseJoystickButtons] });
    } catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
  }
  else if (command.type === 'set-audio') void setAudio(command.enabled);
  else if (command.type === 'set-volume' && browserAudio) {
    try { const volume = validateMachineVolume(command.volume); browserAudio.setVolume(volume); sendAudioState(); send({ type: 'volume-state', volume }); }
    catch (error) { send({ type: 'control-rejected', message: error instanceof Error ? error.message : String(error) }); }
  }
  else if (command.type === 'set-display-filter') {
    try { const filter = validateEmulatorDisplayFilter(command.filter); canvas.style.imageRendering = filter === 'nearest' ? 'pixelated' : 'auto'; send({ type: 'display-filter', filter }); }
    catch (error) { send({ type: 'control-rejected', message: error instanceof Error ? error.message : String(error) }); }
  }
  else if (command.type === 'start-audio-capture' && browserAudio) {
    try {
      if (runtimeSpeed !== 1) throw new Error('WAV capture requires authentic 1x runtime speed');
      const seconds = validateAudioCaptureSeconds(command.seconds); const capture = browserAudio.beginCapture(seconds);
      send({ type: 'audio-capture-state', recording: true, seconds, sampleRate: capture.sampleRate, limitSamples: capture.limitSamples }); sendAudioState();
    } catch (error) { send({ type: 'control-rejected', message: error instanceof Error ? error.message : String(error) }); }
  }
  else if (command.type === 'stop-audio-capture' && browserAudio) {
    try {
      const capture = browserAudio.endCapture(); if (!capture.samples.length) throw new Error('Audio capture contains no sound-chip samples yet');
      const wav = encodeMonoPcm16Wav(capture.samples, capture.sampleRate); const blob = new Blob([wav], { type: 'audio/wav' });
      send({ type: 'audio-captured', blob, filename: `8bit-net-${cpu?.model.name.replace(/[^A-Za-z0-9._-]+/g, '-') ?? 'machine'}-${new Date().toISOString().replace(/[:.]/g, '-')}.wav`, size: wav.length, samples: capture.samples.length, sampleRate: capture.sampleRate, durationSeconds: capture.samples.length / capture.sampleRate });
      send({ type: 'audio-capture-state', recording: false }); sendAudioState();
    } catch (error) { send({ type: 'control-rejected', message: error instanceof Error ? error.message : String(error) }); }
  }
  else if (command.type === 'set-speed' && cpu) {
    try {
      const speed = validateRuntimeSpeed(command.speed);
      if (audioEnabled && speed !== 1) { send({ type: 'speed-rejected', message: 'Mute machine audio before selecting a non-authentic runtime speed' }); return; }
      runtimeSpeed = speed;
      lastFrameAt = 0;
      if (replayEnabled) resetReplaySegment('Runtime speed change is an external-session history boundary');
      send({ type: 'speed-state', speed: runtimeSpeed });
      sendSnapshot(`runtime speed ${runtimeSpeed}x`);
    } catch (error) { send({ type: 'speed-rejected', message: error instanceof Error ? error.message : String(error) }); }
  }
  else if (command.type === 'load-tape' && cpu) {
    void loadTape(command.name, command.bytes).catch((error) => {
      const message = `Unable to mount cassette: ${error instanceof Error ? error.message : String(error)}`;
      setStatus(message, 'error');
      send({ type: 'error', message });
    });
  }
  else if (command.type === 'load-disc' && cpu) {
    const drive = command.drive === 1 ? 1 : 0;
    const bytes = Uint8Array.from(command.bytes);
    const mounted = { name: command.name, bytes: bytes.slice(), dirty: false, revision: 0 };
    cpu.fdc.loadDisc(drive, discFor(cpu.fdc, command.name, bytes, (changedBytes) => {
      mounted.bytes = changedBytes.slice(); mounted.dirty = true; mounted.revision += 1;
      send({ type: 'media-changed', kind: 'disc', name: mounted.name, size: mounted.bytes.length, drive, dirty: true, revision: mounted.revision });
    }));
    mountedDiscs.set(drive, mounted);
    if (replayEnabled) resetReplaySegment('Disk mount is an irreversible history boundary');
    send({ type: 'media-loaded', kind: 'disc', name: command.name, size: command.bytes.length, drive });
  }
  else if (command.type === 'eject-disc' && cpu) {
    if (command.drive !== 0 && command.drive !== 1) { send({ type: 'error', message: 'Disk eject requires live drive 0 or 1' }); return; }
    cpu.fdc.loadDisc(command.drive, null); mountedDiscs.delete(command.drive);
    if (replayEnabled) resetReplaySegment('Disk eject is an irreversible history boundary');
    send({ type: 'media-ejected', kind: 'disc', drive: command.drive }); sendSnapshot(`drive ${command.drive} ejected`);
  }
  else if (command.type === 'export-disc') {
    if (command.drive !== 0 && command.drive !== 1) { send({ type: 'error', message: 'Disk export requires live drive 0 or 1' }); return; }
    const disc = mountedDiscs.get(command.drive);
    if (!disc) { send({ type: 'error', message: `Drive ${command.drive} has no mounted disk to export` }); return; }
    const blob = new Blob([disc.bytes.slice()], { type: 'application/octet-stream' });
    send({ type: 'media-exported', kind: 'disc', name: disc.name, drive: command.drive, dirty: disc.dirty, revision: disc.revision, size: disc.bytes.length, blob });
  }
  else if (command.type === 'eject-tape' && cpu) {
    if (cpu.model.isAtom) cpu.atomppia?.setTape(null); else cpu.acia?.setTape(null);
    mountedTape = null;
    if (replayEnabled) resetReplaySegment('Cassette eject is an irreversible history boundary');
    send({ type: 'media-ejected', kind: 'tape' }); sendSnapshot('cassette ejected');
  }
});

canvas.addEventListener('focus', () => send({ type: 'input-focus', captured: true }));
canvas.addEventListener('blur', () => { send({ type: 'input-focus', captured: false }); updateBbcMouseJoystick(undefined, true); });
function updateBbcMouseJoystick(event?: PointerEvent, release = false) {
  if (!bbcMouseJoystickEnabled || !cpu || cpu.model.isAtom) return;
  const rect = canvas.getBoundingClientRect();
  const x = release || !event || rect.width <= 0 ? 0x8000 : Math.round((1 - Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))) * 0xffff);
  const y = release || !event || rect.height <= 0 ? 0x8000 : Math.round((1 - Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))) * 0xffff);
  if (release) bbcMouseJoystickButtons = [false, false];
  const { verifiedChannels, verifiedButtons } = applyBbcAnalogueJoystick([x, y, 0x8000, 0x8000], bbcMouseJoystickButtons);
  send({ type: 'bbc-mouse-joystick-input', x, y, buttons: [...bbcMouseJoystickButtons], verifiedChannels, verifiedButtons, source: 'canvas pointer through jsbeeb ADC channel sources and System VIA PB4/PB5 readback' });
}
canvas.addEventListener('pointermove', (event) => updateBbcMouseJoystick(event));
canvas.addEventListener('pointerdown', (event) => { if (!bbcMouseJoystickEnabled || (event.button !== 0 && event.button !== 2)) return; event.preventDefault(); bbcMouseJoystickButtons[event.button === 0 ? 0 : 1] = true; canvas.focus(); updateBbcMouseJoystick(event); });
canvas.addEventListener('pointerup', (event) => { if (!bbcMouseJoystickEnabled || (event.button !== 0 && event.button !== 2)) return; event.preventDefault(); bbcMouseJoystickButtons[event.button === 0 ? 0 : 1] = false; updateBbcMouseJoystick(event); });
canvas.addEventListener('pointerleave', () => updateBbcMouseJoystick(undefined, true));
canvas.addEventListener('contextmenu', (event) => { if (bbcMouseJoystickEnabled) event.preventDefault(); });
const remappedKeyboardEvent = (event: KeyboardEvent) => { const keyCode = keyRemaps.get(event.keyCode || event.which); return keyCode === undefined ? event : ({ keyCode, which: keyCode, charCode: 0, location: 0, altKey: false, ctrlKey: false, shiftKey: event.shiftKey, preventDefault: () => event.preventDefault() } as KeyboardEvent); };
canvas.addEventListener('keydown', (event) => { const hostCode = event.keyCode || event.which; keyboard?.keyDown(remappedKeyboardEvent(event)); const targetCode = keyRemaps.get(hostCode); if (targetCode !== undefined) send({ type: 'key-remap-input', pressed: true, hostCode, targetCode }); if (replayEnabled) resetReplaySegment('Keyboard input is an irreversible history boundary'); });
canvas.addEventListener('keyup', (event) => { const hostCode = event.keyCode || event.which; keyboard?.keyUp(remappedKeyboardEvent(event)); const targetCode = keyRemaps.get(hostCode); if (targetCode !== undefined) send({ type: 'key-remap-input', pressed: false, hostCode, targetCode }); if (replayEnabled) resetReplaySegment('Keyboard input is an irreversible history boundary'); });
audioActivation.addEventListener('click', () => void setAudio(true));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    resumeAfterBackground = running;
    backgroundSuspended = true;
    running = false;
    void browserAudio?.setBackgroundSuspended(true);
    sendSnapshot('background suspended');
    return;
  }
  backgroundSuspended = false;
  running = resumeAfterBackground;
  resumeAfterBackground = false;
  lastFrameAt = 0;
  void browserAudio?.setBackgroundSuspended(false);
  sendSnapshot(running ? 'foreground resumed' : 'foreground visible');
});
const recordBrowserCrash = (kind: RuntimeCrashDiagnostic['kind'], value: unknown) => {
  const raw = value instanceof Error ? value.message : String(value);
  const message = raw.replace(/(?:https?|file):\/\/\S+/gi, '[redacted-url]').replace(/\/(?:[^\s/]+\/)+[^\s]+/g, '[redacted-path]');
  crashDiagnostics = appendCrashDiagnostic(crashDiagnostics, { sequence: ++crashSequence, timeMs: performance.now(), kind, message });
  sendSnapshot(kind);
};
window.addEventListener('error', (event) => recordBrowserCrash('error', event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => recordBrowserCrash('unhandled-rejection', event.reason));
window.addEventListener('pagehide', () => {
  running = false;
  if (frameRequest) { cancelAnimationFrame(frameRequest); frameRequest = 0; }
  breakpointHooks.forEach((entry) => entry.hook.remove()); breakpointHooks.clear();
  runToHook?.remove(); runToHook = null;
  discardHardwareTest();
  clearWatchpoints(); stopTrace(); stopProfiler(); stopReplay();
  void browserAudio?.close(); browserAudio = null;
}, { once: true });
send({ type: 'bridge-ready' });
