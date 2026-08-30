import type { ArmArtifact } from '../build/artifactTypes';
import type { ArmBreakpointGroup, PersistedArmBreakpointIntent } from '../project/project';
import { armBreakpointWireSpec, type ArmBreakpointSpec } from './armBreakpointModel';
import { resolveArmMemoryExpression, resolveArmValueExpression } from './armMemoryModel';

export interface ResolvedArmBreakpointIntent {
  intent: PersistedArmBreakpointIntent;
  address: number | null;
  buildFingerprint: string | null;
  error?: string;
  wireSpec?: ReturnType<typeof armBreakpointWireSpec>;
}

export function resolveArmBreakpointIntents(intents: PersistedArmBreakpointIntent[], artifact: ArmArtifact | null, groups: ArmBreakpointGroup[] = []): ResolvedArmBreakpointIntent[] {
  const symbols = Object.fromEntries(Object.entries(artifact?.symbols ?? {}).map(([name, address]) => [name.toUpperCase(), address]));
  const fingerprint = artifact?.provenance?.output.sha256 ?? artifact?.provenance?.output.fingerprint ?? null;
  return intents.map((intent) => {
    if (!intent.enabled) return { intent, address: null, buildFingerprint: fingerprint, error: 'disabled' };
    if (intent.groupId) {
      const group = groups.find((candidate) => candidate.id === intent.groupId);
      if (!group) return { intent, address: null, buildFingerprint: fingerprint, error: 'breakpoint group is missing' };
      if (!group.enabled) return { intent, address: null, buildFingerprint: fingerprint, error: `group "${group.name}" is disabled` };
    }
    const address = resolveArmMemoryExpression(intent.expression, symbols);
    if (address === null) return { intent, address: null, buildFingerprint: fingerprint, error: artifact ? 'symbol or address is unresolved in the active build' : 'an active current ARM build is required' };
    try {
      const conditions = intent.conditions.map((condition, index) => {
        const value = resolveArmValueExpression(condition.expression, symbols);
        if (value === null) throw new Error(`condition ${index + 1} comparison symbol or value is unresolved in the active build`);
        return { register: condition.register, operator: condition.operator, value };
      });
      const spec: ArmBreakpointSpec = { address, action: intent.action, conditions, ...(intent.hitTarget === undefined ? {} : { hitTarget: intent.hitTarget }), ...(intent.logMessage === undefined ? {} : { logMessage: intent.logMessage }) };
      return { intent, address, buildFingerprint: fingerprint, wireSpec: armBreakpointWireSpec(spec) };
    } catch (error) {
      return { intent, address, buildFingerprint: fingerprint, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

function resolutionAddress(address: number) { return `&${address.toString(16).toUpperCase().padStart(8, '0')}`; }

export function recordArmBreakpointResolutions(intents: PersistedArmBreakpointIntent[], resolved: ResolvedArmBreakpointIntent[]): PersistedArmBreakpointIntent[] {
  let changed = false;
  const next = intents.map((intent) => {
    const result = resolved.find((candidate) => candidate.intent.id === intent.id);
    if (!result?.buildFingerprint || result.error === 'disabled' || result.error?.startsWith('group "') || result.error === 'breakpoint group is missing') return intent;
    const previous = intent.resolutionHistory?.at(-1);
    const verification = result.wireSpec ? 'resolved' as const : 'rejected' as const;
    const address = result.wireSpec ? result.address : null;
    if (previous && previous.requestedExpression === intent.expression && previous.buildFingerprint === result.buildFingerprint && previous.address === address && previous.verification === verification) return intent;
    const reason = verification === 'rejected'
      ? result.error ?? 'rejected by current build'
      : previous?.verification === 'resolved' && previous.address !== address
        ? `moved from ${resolutionAddress(previous.address!)} to ${resolutionAddress(address!)}`
        : previous ? 'resolved unchanged after rebuild' : 'initial resolution';
    const record = { requestedExpression: intent.expression, buildFingerprint: result.buildFingerprint, address, verification, reason };
    changed = true;
    return { ...intent, resolutionHistory: [...(intent.resolutionHistory ?? []), record].slice(-8) };
  });
  return changed ? next : intents;
}
