import type { AssemblyArtifact } from '../build/assembler6502';
import type { Breakpoint6502Group, Persisted6502BreakpointIntent } from '../project/project';
import { validateBreakpointSpec, type BreakpointSpec } from './breakpointModel';
import { resolveMemoryExpression } from './memoryInspectorModel';

export interface Resolved6502BreakpointIntent {
  intent: Persisted6502BreakpointIntent;
  address: number | null;
  buildFingerprint: string | null;
  error?: string;
  wireSpec?: BreakpointSpec;
}

export function resolve6502BreakpointIntents(intents: Persisted6502BreakpointIntent[], artifact: AssemblyArtifact | null, groups: Breakpoint6502Group[] = []): Resolved6502BreakpointIntent[] {
  const symbols = artifact?.symbols ?? {};
  const fingerprint = artifact?.provenance?.output.sha256 ?? artifact?.provenance?.output.fingerprint ?? null;
  return intents.map((intent) => {
    if (!intent.enabled) return { intent, address: null, buildFingerprint: fingerprint, error: 'disabled' };
    if (intent.groupId) {
      const group = groups.find((candidate) => candidate.id === intent.groupId);
      if (!group) return { intent, address: null, buildFingerprint: fingerprint, error: 'breakpoint group is missing' };
      if (!group.enabled) return { intent, address: null, buildFingerprint: fingerprint, error: `group "${group.name}" is disabled` };
    }
    const address = resolveMemoryExpression(intent.expression, symbols);
    if (address === null) return { intent, address: null, buildFingerprint: fingerprint, error: artifact ? 'symbol or address is unresolved in the active build' : 'an active current 6502 build is required' };
    try {
      let condition: BreakpointSpec['condition'];
      if (intent.condition) {
        const value = resolveMemoryExpression(intent.condition.expression, symbols);
        if (value === null) throw new Error('condition comparison symbol or value is unresolved in the active build');
        const maximum = intent.condition.register === 'pc' ? 0xffff : 0xff;
        if (value > maximum) throw new Error(`${intent.condition.register.toUpperCase()} comparison exceeds ${intent.condition.register === 'pc' ? '16' : '8'} bits`);
        condition = { register: intent.condition.register, operator: intent.condition.operator, value };
      }
      const spec = validateBreakpointSpec({ address, enabled: true, stop: intent.action !== 'log', ...(condition ? { condition } : {}), ...(intent.hitTarget === undefined ? {} : { hitTarget: intent.hitTarget }), ...(intent.logMessage === undefined ? {} : { logMessage: intent.logMessage }) });
      return { intent, address, buildFingerprint: fingerprint, wireSpec: spec };
    } catch (error) {
      return { intent, address, buildFingerprint: fingerprint, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

function displayAddress(address: number) { return `&${address.toString(16).toUpperCase().padStart(4, '0')}`; }

export function record6502BreakpointResolutions(intents: Persisted6502BreakpointIntent[], resolved: Resolved6502BreakpointIntent[]): Persisted6502BreakpointIntent[] {
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
        ? `moved from ${displayAddress(previous.address!)} to ${displayAddress(address!)}`
        : previous ? 'resolved unchanged after rebuild' : 'initial resolution';
    changed = true;
    return { ...intent, resolutionHistory: [...(intent.resolutionHistory ?? []), { requestedExpression: intent.expression, buildFingerprint: result.buildFingerprint, address, verification, reason }].slice(-8) };
  });
  return changed ? next : intents;
}
