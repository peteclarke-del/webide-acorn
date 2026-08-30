export interface DebugEnvelope { sessionId?: unknown; eventSequence?: unknown }
export type DebugCapability = 'execution' | 'register-read' | 'register-write' | 'memory-read' | 'memory-write' | 'execute-breakpoint' | 'conditional-breakpoint' | 'logpoint' | 'data-watchpoint' | 'source-step' | 'trace' | 'interrupt-monitor' | 'raster-breakpoint' | 'profiler' | 'replay' | 'hardware-inspection' | 'media' | 'screen-capture' | 'audio';
export interface DebugCommandAudit { sequence: number; commandId: number; type: string; acceptedAtMs: number }
export interface DebugProtocolSnapshot {
  version: 2;
  adapter: 'jsbeeb' | 'arculator-wasm';
  sessionBound: boolean;
  owner: 'workbench-parent';
  acceptedCommands: number;
  lastCommandId: number;
  auditCapacity: 32;
  audit: DebugCommandAudit[];
  capabilities: DebugCapability[];
}

export function commandBelongsToSession(sessionId: string, candidate: unknown): boolean {
  if (!sessionId) return candidate === undefined || candidate === '';
  return typeof candidate === 'string' && candidate === sessionId;
}

export function acceptDebugEvent(envelope: DebugEnvelope, sessionId: string, lastAccepted: number): number | null {
  if (!commandBelongsToSession(sessionId, envelope.sessionId)) return null;
  if (!Number.isSafeInteger(envelope.eventSequence) || Number(envelope.eventSequence) <= lastAccepted) return null;
  return Number(envelope.eventSequence);
}
