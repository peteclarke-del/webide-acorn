import { describe, expect, it } from 'vitest';
import type { AssemblyArtifact } from '../build/assembler6502';
import type { Persisted6502BreakpointIntent } from '../project/project';
import { record6502BreakpointResolutions, resolve6502BreakpointIntents } from './breakpointPersistence6502Model';

const artifact = (address: number, fingerprint = 'abcdef1234567890') => ({ kind: '6502-binary', symbols: { LOOP: address }, provenance: { output: { sha256: fingerprint } } } as unknown as AssemblyArtifact);
const intent = (update: Partial<Persisted6502BreakpointIntent> = {}): Persisted6502BreakpointIntent => ({ id: 'one', expression: 'loop+1', enabled: true, action: 'pause', ...update });

describe('persisted 6502 breakpoint model', () => {
  it('resolves symbols, conditions and enabled groups into core breakpoint specs', () => {
    expect(resolve6502BreakpointIntents([intent({ condition: { register: 'x', operator: 'eq', expression: '3' }, groupId: 'game' })], artifact(0x1900), [{ id: 'game', name: 'Game', enabled: true }])[0]).toMatchObject({ address: 0x1901, wireSpec: { address: 0x1901, condition: { register: 'x', operator: 'eq', value: 3 }, stop: true } });
  });

  it('does not install disabled groups and reports unresolved symbols honestly', () => {
    expect(resolve6502BreakpointIntents([intent({ groupId: 'game' })], artifact(0x1900), [{ id: 'game', name: 'Game', enabled: false }])[0]?.error).toContain('disabled');
    expect(resolve6502BreakpointIntents([intent({ expression: 'missing' })], artifact(0x1900))[0]?.wireSpec).toBeUndefined();
  });

  it('records exact rebuild movement without duplicating the same proof', () => {
    const first = record6502BreakpointResolutions([intent()], resolve6502BreakpointIntents([intent()], artifact(0x1900)));
    const duplicate = record6502BreakpointResolutions(first, resolve6502BreakpointIntents(first, artifact(0x1900)));
    const moved = record6502BreakpointResolutions(duplicate, resolve6502BreakpointIntents(duplicate, artifact(0x1910, '12345678abcdef00')));
    expect(duplicate).toBe(first);
    expect(moved[0]?.resolutionHistory?.map((record) => record.reason)).toEqual(['initial resolution', 'moved from &1901 to &1911']);
  });
});
