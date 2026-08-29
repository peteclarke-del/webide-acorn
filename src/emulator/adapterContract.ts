export const EMULATOR_ADAPTER_API_VERSION = 1 as const;

export type EmulatorLifecycle =
  | 'created'
  | 'configured'
  | 'loaded'
  | 'running'
  | 'paused'
  | 'powered-off'
  | 'crashed'
  | 'destroyed';

export type EmulatorOperation =
  | 'configure'
  | 'mount-media'
  | 'load-artifact'
  | 'start'
  | 'pause'
  | 'resume'
  | 'reset'
  | 'power-off'
  | 'step'
  | 'serialize-state'
  | 'restore-state'
  | 'capture-frame'
  | 'capture-audio'
  | 'inject-input'
  | 'inspect-state'
  | 'debug'
  | 'destroy';

export type EmulatorResetKind = 'soft' | 'hard' | 'power-cycle';
export type EmulatorInputEvent =
  | { kind: 'key'; code: string; pressed: boolean }
  | { kind: 'text'; text: string }
  | { kind: 'joystick'; port: number; control: string; value: number }
  | { kind: 'mouse'; dx: number; dy: number; buttons: number }
  | { kind: 'analogue'; channel: number; value: number };

export interface EmulatorAdapterDescriptor {
  readonly apiVersion: typeof EMULATOR_ADAPTER_API_VERSION;
  readonly id: string;
  readonly version: string;
  readonly operations: Readonly<Record<EmulatorOperation, boolean>>;
  readonly limitations: readonly string[];
}

export interface EmulatorConfiguration {
  readonly machineManifestId: string;
  readonly machineManifestSha256: string;
  readonly roms: readonly { readonly key: string; readonly sha256: string }[];
  readonly options: Readonly<Record<string, string | number | boolean>>;
}

export interface EmulatorArtifact {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly loadAddress?: number;
  readonly entryPoint?: number;
}

export interface EmulatorMedia {
  readonly slot: string;
  readonly name: string;
  readonly format: string;
  readonly bytes: Uint8Array;
  readonly writable: boolean;
}

export interface EmulatorStateBlob {
  readonly format: string;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly machineManifestSha256: string;
  readonly bytes: Uint8Array;
}

export interface EmulatorInspection {
  readonly lifecycle: EmulatorLifecycle;
  readonly running: boolean;
  readonly monotonicTime: number;
  readonly state: Readonly<Record<string, unknown>>;
}

export interface EmulatorCapture {
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly monotonicTime: number;
}

export interface EmulatorAdapter {
  readonly descriptor: EmulatorAdapterDescriptor;
  lifecycle(): EmulatorLifecycle;
  configure(configuration: EmulatorConfiguration): Promise<void>;
  mountMedia(media: EmulatorMedia): Promise<void>;
  loadArtifact(artifact: EmulatorArtifact): Promise<void>;
  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  reset(kind: EmulatorResetKind): Promise<void>;
  powerOff(): Promise<void>;
  step(instructions?: number): Promise<void>;
  serializeState(): Promise<EmulatorStateBlob>;
  restoreState(state: EmulatorStateBlob): Promise<void>;
  captureFrame(): Promise<EmulatorCapture>;
  captureAudio(durationMs: number): Promise<EmulatorCapture>;
  injectInput(events: readonly EmulatorInputEvent[]): Promise<void>;
  inspectState(): Promise<EmulatorInspection>;
  debug(command: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>;
  destroy(): Promise<void>;
}

const operationNames: readonly EmulatorOperation[] = [
  'configure', 'mount-media', 'load-artifact', 'start', 'pause', 'resume',
  'reset', 'power-off', 'step', 'serialize-state', 'restore-state',
  'capture-frame', 'capture-audio', 'inject-input', 'inspect-state', 'debug', 'destroy',
];

export function validateAdapterDescriptor(descriptor: EmulatorAdapterDescriptor): readonly string[] {
  const errors: string[] = [];
  if (descriptor.apiVersion !== EMULATOR_ADAPTER_API_VERSION) errors.push(`Unsupported adapter API version ${descriptor.apiVersion}`);
  if (!/^[a-z0-9][a-z0-9.-]{1,63}$/.test(descriptor.id)) errors.push('Adapter id must be a stable lower-case identifier');
  if (!descriptor.version.trim()) errors.push('Adapter version is required');
  for (const operation of operationNames) if (typeof descriptor.operations[operation] !== 'boolean') errors.push(`Operation ${operation} must be declared`);
  for (const required of ['configure', 'start', 'pause', 'resume', 'reset', 'power-off', 'inject-input', 'inspect-state', 'destroy'] as const) {
    if (!descriptor.operations[required]) errors.push(`Required lifecycle operation ${required} is unavailable`);
  }
  if (!descriptor.operations['serialize-state'] && descriptor.operations['restore-state']) errors.push('State restore cannot be advertised without state serialization');
  if (!descriptor.operations['capture-audio'] && descriptor.limitations.every((item) => !/audio capture/i.test(item))) errors.push('Unavailable audio capture requires a published limitation');
  return errors;
}

export function assertOperation(descriptor: EmulatorAdapterDescriptor, operation: EmulatorOperation): void {
  if (!descriptor.operations[operation]) throw new Error(`${descriptor.id}@${descriptor.version} does not support ${operation}`);
}

export function canTransitionEmulator(from: EmulatorLifecycle, to: EmulatorLifecycle): boolean {
  if (from === to) return true;
  const transitions: Record<EmulatorLifecycle, readonly EmulatorLifecycle[]> = {
    created: ['configured', 'crashed', 'destroyed'],
    configured: ['loaded', 'running', 'powered-off', 'crashed', 'destroyed'],
    loaded: ['configured', 'running', 'paused', 'powered-off', 'crashed', 'destroyed'],
    running: ['paused', 'configured', 'powered-off', 'crashed', 'destroyed'],
    paused: ['running', 'configured', 'loaded', 'powered-off', 'crashed', 'destroyed'],
    'powered-off': ['configured', 'running', 'crashed', 'destroyed'],
    crashed: ['configured', 'destroyed'],
    destroyed: [],
  };
  return transitions[from].includes(to);
}

export function assertEmulatorTransition(from: EmulatorLifecycle, to: EmulatorLifecycle): void {
  if (!canTransitionEmulator(from, to)) throw new Error(`Illegal emulator lifecycle transition from ${from} to ${to}`);
}

const completeOperations = (overrides: Partial<Record<EmulatorOperation, boolean>>): Readonly<Record<EmulatorOperation, boolean>> =>
  Object.freeze(Object.fromEntries(operationNames.map((name) => [name, overrides[name] ?? true])) as Record<EmulatorOperation, boolean>);

export const productionAdapterDescriptors = Object.freeze({
  jsbeeb: Object.freeze({
    apiVersion: EMULATOR_ADAPTER_API_VERSION,
    id: 'jsbeeb',
    version: '1.19.1',
    operations: completeOperations({}),
    limitations: Object.freeze([]),
  }),
  arculator: Object.freeze({
    apiVersion: EMULATOR_ADAPTER_API_VERSION,
    id: 'arculator-wasm',
    version: '579ac437b9a4',
    operations: completeOperations({ 'serialize-state': false, 'restore-state': false }),
    limitations: Object.freeze(['Core-native state serialization is unavailable.']),
  }),
} satisfies Record<string, EmulatorAdapterDescriptor>);
