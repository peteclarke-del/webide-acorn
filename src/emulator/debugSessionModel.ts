import type { ProjectTarget } from '../project/project';

export type DebugLifecycleState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'paused'
  | 'stepping'
  | 'rewinding'
  | 'terminated'
  | 'crashed'
  | 'disconnected';

export interface DebugSessionBinding {
  readonly schema: '8bit-net.debug-session-binding';
  readonly version: 1;
  readonly id: string;
  readonly createdAt: string;
  readonly build: {
    readonly targetId: string;
    readonly targetName: string;
    readonly fingerprint: string;
    readonly outputSha256: string;
    readonly outputBytes: number;
    readonly toolchainId: string;
    readonly toolchainVersion: string;
  };
  readonly machineTarget: Readonly<Omit<ProjectTarget, 'enabledCapabilities'>> & { readonly enabledCapabilities: ReadonlyArray<string> };
  readonly adapter: { readonly id: 'jsbeeb' | 'arculator-wasm' | 'romless-6502'; readonly version: string };
  readonly roms: ReadonlyArray<{ readonly key: string; readonly filename: string; readonly size: number; readonly sha256: string }>;
  readonly runProfile: {
    readonly mode: 'debug';
    readonly processor: string;
    readonly origin: number;
    readonly entryPoint: number;
    readonly romSetId: string | null;
    readonly capabilities: ReadonlyArray<string>;
  };
}

export interface DebugSessionRecord {
  readonly binding: DebugSessionBinding;
  readonly lifecycle: DebugLifecycleState;
  readonly reason: string;
  readonly updatedAt: string;
}

export interface DebugSessionBindingInput {
  id: string;
  createdAt: string;
  build: DebugSessionBinding['build'];
  machineTarget: ProjectTarget;
  adapter: DebugSessionBinding['adapter'];
  roms: Array<{ key: string; filename: string; size: number; sha256: string }>;
  runProfile: { mode: 'debug'; processor: string; origin: number; entryPoint: number; romSetId: string | null; capabilities: string[] };
}

const transitions: Record<DebugLifecycleState, ReadonlySet<DebugLifecycleState>> = {
  stopped: new Set(['starting', 'terminated', 'disconnected']),
  starting: new Set(['running', 'paused', 'terminated', 'crashed', 'disconnected']),
  running: new Set(['paused', 'stepping', 'rewinding', 'starting', 'terminated', 'crashed', 'disconnected']),
  paused: new Set(['running', 'stepping', 'rewinding', 'starting', 'terminated', 'crashed', 'disconnected']),
  stepping: new Set(['paused', 'running', 'terminated', 'crashed', 'disconnected']),
  rewinding: new Set(['paused', 'running', 'terminated', 'crashed', 'disconnected']),
  terminated: new Set(['starting', 'disconnected']),
  crashed: new Set(['starting', 'terminated', 'disconnected']),
  disconnected: new Set(['starting', 'terminated']),
};

function cloneBinding(input: DebugSessionBindingInput): DebugSessionBinding {
  const machineTarget = Object.freeze({ ...input.machineTarget, enabledCapabilities: Object.freeze([...input.machineTarget.enabledCapabilities]) });
  const binding: DebugSessionBinding = {
    schema: '8bit-net.debug-session-binding',
    version: 1,
    id: input.id,
    createdAt: input.createdAt,
    build: Object.freeze({ ...input.build }),
    machineTarget,
    adapter: Object.freeze({ ...input.adapter }),
    roms: Object.freeze(input.roms.map((rom) => Object.freeze({ ...rom }))),
    runProfile: Object.freeze({ ...input.runProfile, capabilities: Object.freeze([...input.runProfile.capabilities]) }),
  };
  return Object.freeze(binding);
}

export function createDebugSession(input: DebugSessionBindingInput, reason = 'Debug adapter is loading the immutable build'): DebugSessionRecord {
  if (!input.build.outputSha256.match(/^[0-9a-f]{64}$/i)) throw new Error('Debug sessions require the exact SHA-256 digest of the build output');
  if (!input.build.fingerprint || !input.build.targetId || !input.adapter.version) throw new Error('Debug session binding provenance is incomplete');
  return Object.freeze({ binding: cloneBinding(input), lifecycle: 'starting', reason, updatedAt: input.createdAt });
}

export function transitionDebugSession(session: DebugSessionRecord, lifecycle: DebugLifecycleState, reason: string, updatedAt = new Date().toISOString()): DebugSessionRecord {
  if (lifecycle === session.lifecycle) return Object.freeze({ ...session, reason, updatedAt });
  if (!transitions[session.lifecycle].has(lifecycle)) throw new Error(`Debug lifecycle cannot transition from ${session.lifecycle} to ${lifecycle}`);
  return Object.freeze({ ...session, lifecycle, reason, updatedAt });
}

export function lifecycleForSnapshot(running: boolean): Extract<DebugLifecycleState, 'running' | 'paused'> {
  return running ? 'running' : 'paused';
}
