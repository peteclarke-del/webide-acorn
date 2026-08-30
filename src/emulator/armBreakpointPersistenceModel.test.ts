import { describe, expect, it } from 'vitest';
import type { ArmArtifact } from '../build/artifactTypes';
import { recordArmBreakpointResolutions, resolveArmBreakpointIntents } from './armBreakpointPersistenceModel';

const artifact = { kind: 'arm-binary', symbols: { start: 0x8000, limit: 0x8120 }, provenance: { output: { sha256: 'build-sha' } } } as unknown as ArmArtifact;

describe('ARM breakpoint persistence model', () => {
  it('re-resolves symbol expressions and records the exact build identity', () => {
    const [resolved] = resolveArmBreakpointIntents([{ id: 'one', expression: 'start+4', enabled: true, conditions: [], action: 'pause' }], artifact);
    expect(resolved).toMatchObject({ address: 0x8004, buildFingerprint: 'build-sha', wireSpec: { address: 0x8004, action: 0, conditions: [] } });
  });
  it('keeps unresolved and disabled intent visible without fabricating an address', () => {
    expect(resolveArmBreakpointIntents([{ id: 'lost', expression: 'missing', enabled: true, conditions: [], action: 'pause' }], artifact)[0]).toMatchObject({ address: null, error: 'symbol or address is unresolved in the active build' });
    expect(resolveArmBreakpointIntents([{ id: 'off', expression: '&8000', enabled: false, conditions: [], action: 'pause' }], artifact)[0]).toMatchObject({ address: null, error: 'disabled' });
  });
  it('re-resolves symbol-valued comparison operands against the same exact build', () => {
    const [resolved] = resolveArmBreakpointIntents([{ id: 'condition', expression: 'start', enabled: true, conditions: [{ register: 2, operator: 'gte', expression: 'limit+4' }], action: 'pause' }], artifact);
    expect(resolved).toMatchObject({ address: 0x8000, buildFingerprint: 'build-sha', wireSpec: { conditions: [{ register: 2, operator: 6, value: 0x8124 }] } });
    const [missing] = resolveArmBreakpointIntents([{ id: 'missing-condition', expression: 'start', enabled: true, conditions: [{ register: 2, operator: 'eq', expression: 'removed_symbol' }], action: 'pause' }], artifact);
    expect(missing).toMatchObject({ address: 0x8000, error: 'condition 1 comparison symbol or value is unresolved in the active build' });
    expect(missing?.wireSpec).toBeUndefined();
  });
  it('projects only enabled groups into the live-core wire list', () => {
    const intent = { id: 'grouped', expression: 'start', enabled: true, conditions: [], action: 'pause' as const, groupId: 'combat' };
    const disabled = resolveArmBreakpointIntents([intent], artifact, [{ id: 'combat', name: 'Combat loop', enabled: false }])[0];
    expect(disabled).toMatchObject({ error: 'group "Combat loop" is disabled' });
    expect(disabled?.wireSpec).toBeUndefined();
    expect(resolveArmBreakpointIntents([intent], artifact, [{ id: 'combat', name: 'Combat loop', enabled: true }])[0]).toMatchObject({ address: 0x8000, wireSpec: { address: 0x8000 } });
    const missing = resolveArmBreakpointIntents([intent], artifact, [])[0];
    expect(missing).toMatchObject({ error: 'breakpoint group is missing' });
    expect(missing?.wireSpec).toBeUndefined();
  });
  it('records bounded requested-versus-resolved rebuild movement and rejection evidence', () => {
    const intent = { id: 'moving', expression: 'start', enabled: true, conditions: [], action: 'pause' as const };
    const first = recordArmBreakpointResolutions([intent], resolveArmBreakpointIntents([intent], artifact));
    expect(first[0]?.resolutionHistory).toEqual([{ requestedExpression: 'start', buildFingerprint: 'build-sha', address: 0x8000, verification: 'resolved', reason: 'initial resolution' }]);
    expect(recordArmBreakpointResolutions(first, resolveArmBreakpointIntents(first, artifact))).toBe(first);
    const movedArtifact = { ...artifact, symbols: { start: 0x8020 }, provenance: { output: { sha256: 'next-build-sha' } } } as unknown as ArmArtifact;
    const moved = recordArmBreakpointResolutions(first, resolveArmBreakpointIntents(first, movedArtifact));
    expect(moved[0]?.resolutionHistory?.at(-1)).toEqual({ requestedExpression: 'start', buildFingerprint: 'next-build-sha', address: 0x8020, verification: 'resolved', reason: 'moved from &00008000 to &00008020' });
    const rejectedArtifact = { ...artifact, symbols: {}, provenance: { output: { sha256: 'rejected-build-sha' } } } as unknown as ArmArtifact;
    const rejected = recordArmBreakpointResolutions(moved, resolveArmBreakpointIntents(moved, rejectedArtifact));
    expect(rejected[0]?.resolutionHistory?.at(-1)).toEqual({ requestedExpression: 'start', buildFingerprint: 'rejected-build-sha', address: null, verification: 'rejected', reason: 'symbol or address is unresolved in the active build' });
  });
});
