import { describe, expect, it } from 'vitest';
import { createRuntimeSessionManifest } from './runtimeSessionManifest';
import { createMachineStateEnvelope, openMachineStateEnvelope } from './machineStateEnvelope';

const manifest = createRuntimeSessionManifest({
  id: 'session', createdAt: '2026-08-25T10:00:00.000Z', adapter: { id: 'jsbeeb', version: '1.19.1' },
  machine: { platformClass: '8bit', machineId: 'bbc-b', label: 'BBC B', variant: 'Model B', model: 'B-DFS0.9', romSetId: 'os12-basic2-dfs', enabledCapabilities: ['dfs'] },
  roms: [{ key: 'set/os.rom', filename: 'os.rom', size: 16384, sha256: 'a'.repeat(64) }],
  boot: { tube: false, extraRoms: [], keyboardLayout: 'physical', runtimeSpeed: 1, fastBootMs: 0 }, substitutions: [], limitations: [],
});

describe('versioned machine state envelope', () => {
  it('round trips an exact jsbeeb snapshot with adapter, profile and ROM binding', () => {
    const json = createMachineStateEnvelope('{"model":"B-DFS0.9","state":[1,2,3]}', 'B-DFS0.9', manifest);
    const opened = openMachineStateEnvelope(json, 'B-DFS0.9', manifest);
    expect(opened.payloadJson).toBe('{"model":"B-DFS0.9","state":[1,2,3]}');
    expect(opened.envelope.roms[0]?.sha256).toBe('a'.repeat(64));
    expect(opened.envelope.payload.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects legacy, wrong-model and tampered payload files', () => {
    expect(() => openMachineStateEnvelope('{"model":"legacy"}', 'B-DFS0.9', manifest)).toThrow(/supported/);
    const json = createMachineStateEnvelope('{"state":1}', 'B-DFS0.9', manifest);
    expect(() => openMachineStateEnvelope(json, 'Master', manifest)).toThrow(/incompatible/);
    const tampered = JSON.stringify({ ...JSON.parse(json), payload: { ...JSON.parse(json).payload, json: '{"state":2}' } });
    expect(() => openMachineStateEnvelope(tampered, 'B-DFS0.9', manifest)).toThrow(/integrity/);
  });

  it('rejects a different ROM digest even with the same filename and model', () => {
    const changedManifest = createRuntimeSessionManifest({ ...JSON.parse(JSON.stringify(manifest)), id: 'other', roms: [{ key: 'set/os.rom', filename: 'os.rom', size: 16384, sha256: 'b'.repeat(64) }] });
    const json = createMachineStateEnvelope('{"state":1}', 'B-DFS0.9', manifest);
    expect(() => openMachineStateEnvelope(json, 'B-DFS0.9', changedManifest)).toThrow(/ROM SHA-256/);
  });
});
