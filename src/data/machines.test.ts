import { describe, expect, it } from 'vitest';
import { defaultCapabilities, machinesForPlatform, resolveTarget } from './machines';

describe('machine profile resolution', () => {
  it('links the platform class to only compatible machines', () => {
    expect(machinesForPlatform('8-16-bit').map((machine) => machine.id)).toContain('bbc-b');
    expect(machinesForPlatform('8-16-bit').map((machine) => machine.id)).not.toContain('riscpc');
    expect(machinesForPlatform('32-bit').map((machine) => machine.id)).toContain('archimedes-a300');
  });

  it('falls back to valid linked variant and ROM values after a machine change', () => {
    const target = resolveTarget('32-bit', 'archimedes-a300', 'Model B · 8271 DFS', 'os12-basic2-dfs', ['dfs']);
    expect(target.variant).toBe('A305 · 512K');
    expect(target.rom.id).toBe('arthur120');
    expect(target.enabledCapabilities).toEqual([]);
  });

  it('excludes planned capabilities from defaults and resolved targets', () => {
    const machine = machinesForPlatform('8-16-bit').find((item) => item.id === 'bbc-b')!;
    expect(defaultCapabilities(machine)).toEqual(['dfs', 'sideways']);
    const target = resolveTarget('8-16-bit', 'bbc-b', machine.variants[0]!, machine.roms[0]!.id, ['dfs', 'speech']);
    expect(target.enabledCapabilities).toEqual(['dfs']);
  });
});
