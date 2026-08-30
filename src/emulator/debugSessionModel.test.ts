import { describe, expect, it } from 'vitest';
import { createDebugSession, lifecycleForSnapshot, transitionDebugSession, type DebugSessionBindingInput } from './debugSessionModel';

const input = (): DebugSessionBindingInput => ({
  id: 'session-1', createdAt: '2026-08-24T12:00:00.000Z',
  build: { targetId: 'target-1', targetName: 'Game', fingerprint: 'A1B2C3D4', outputSha256: 'a'.repeat(64), outputBytes: 12, toolchainId: '8bit-net.asm.6502', toolchainVersion: '1' },
  machineTarget: { platformClass: '8-16-bit', machineId: 'bbc-b', variant: 'Model B', romId: 'os12-basic2-dfs', enabledCapabilities: ['dfs'] },
  adapter: { id: 'jsbeeb', version: '1.19.1' },
  roms: [{ key: 'set/os', filename: 'os.rom', size: 16384, sha256: 'b'.repeat(64) }],
  runProfile: { mode: 'debug', processor: '6502', origin: 0x1900, entryPoint: 0x1900, romSetId: 'os12-basic2-dfs', capabilities: ['dfs'] },
});

describe('immutable debug sessions', () => {
  it('copies and freezes every provenance collection', () => {
    const source = input();
    const session = createDebugSession(source);
    source.machineTarget.enabledCapabilities.push('tube');
    source.roms[0]!.filename = 'changed.rom';
    expect(session.lifecycle).toBe('starting');
    expect(session.binding.machineTarget.enabledCapabilities).toEqual(['dfs']);
    expect(session.binding.roms[0]!.filename).toBe('os.rom');
    expect(Object.isFrozen(session.binding.roms[0])).toBe(true);
  });

  it('permits the complete operational lifecycle and retains one binding', () => {
    const starting = createDebugSession(input());
    const running = transitionDebugSession(starting, 'running', 'adapter acknowledged run');
    const stepping = transitionDebugSession(running, 'stepping', 'instruction step requested');
    const paused = transitionDebugSession(stepping, 'paused', 'instruction boundary reached');
    const rewinding = transitionDebugSession(paused, 'rewinding', 'reverse step requested');
    const terminated = transitionDebugSession(transitionDebugSession(rewinding, 'paused', 'history restored'), 'terminated', 'operator stopped session');
    expect(terminated.binding).toBe(starting.binding);
    expect(terminated.lifecycle).toBe('terminated');
  });

  it('rejects impossible transitions and incomplete build identity', () => {
    expect(() => transitionDebugSession(createDebugSession(input()), 'rewinding', 'invalid')).toThrow(/cannot transition/);
    expect(() => createDebugSession({ ...input(), build: { ...input().build, outputSha256: 'not-a-digest' } })).toThrow(/SHA-256/);
  });

  it('maps emulator snapshots without inventing intermediate state', () => {
    expect(lifecycleForSnapshot(true)).toBe('running');
    expect(lifecycleForSnapshot(false)).toBe('paused');
  });
});
