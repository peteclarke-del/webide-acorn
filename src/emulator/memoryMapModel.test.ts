import { describe, expect, it } from 'vitest';
import { createMemoryMapState, mappedAddressIdentity, physicalMemoryIndex, validateMemorySpaceRead } from './memoryMapModel';

const swram = Array.from({ length: 16 }, (_, bank) => bank >= 4 && bank <= 7);

describe('live machine memory map model', () => {
  it('models BBC sideways selection and physical spaces', () => {
    const map = createMemoryMapState({ isMaster: false, isAtom: false, romsel: 5, acccon: 0, swram });
    expect(map.profile).toBe('bbc');
    expect(map.selectedBank).toBe(5);
    expect(map.selectedBankWritable).toBe(true);
    expect(map.regions.find((item) => item.start === 0x8000)?.label).toContain('RAM bank 5');
    expect(mappedAddressIdentity(map, 0x9000)).toMatchObject({ region: 'Sideways RAM bank 5', bank: 5, writable: true, source: 'live ROMSEL &05' });
    expect(validateMemorySpaceRead(map, 'sideways', 0x8000, 4096, 15).bank).toBe(15);
    expect(() => validateMemorySpaceRead(map, 'sideways', 0xbfff, 2, 5)).toThrow(/wholly inside/);
    expect(physicalMemoryIndex('sideways', 0x8123, 5)).toBe(0x20000 + 5 * 0x4000 + 0x123);
  });

  it('decodes Master ANDY, LYNNE and HAZEL overlays without hiding physical spaces', () => {
    const map = createMemoryMapState({ isMaster: true, isAtom: false, romsel: 0x86, acccon: 0x0d, swram });
    expect(map.profile).toBe('master');
    expect(map.regions.map((item) => item.label).join(' ')).toMatch(/LYNNE.*ANDY.*HAZEL/);
    expect(map.accconFlags.filter((item) => item.set).map((item) => item.bit)).toEqual(['Y', 'X', 'D']);
    expect(map.spaces.map((item) => item.id)).toEqual(expect.arrayContaining(['shadow', 'hazel', 'andy']));
    expect(physicalMemoryIndex('shadow', 0x3000)).toBe(0xb000);
    expect(physicalMemoryIndex('hazel', 0xc000)).toBe(0x9000);
    expect(mappedAddressIdentity(map, 0x8000)).toMatchObject({ region: 'ANDY private RAM', kind: 'overlay', writable: true });
    expect(mappedAddressIdentity(map, 0x9000)).toMatchObject({ region: 'Sideways RAM bank 6', bank: 6, writable: true, source: 'live ROMSEL &86' });
  });

  it('uses the distinct Atom map and rejects BBC-only banks', () => {
    const map = createMemoryMapState({ isMaster: false, isAtom: true, romsel: 0, acccon: 0, swram });
    expect(map.regions.map((item) => item.label)).toContain('Branquart bank');
    expect(map.spaces.map((item) => item.id)).not.toContain('sideways');
    expect(() => validateMemorySpaceRead(map, 'sideways', 0x8000, 1, 0)).toThrow(/not available/);
    expect(physicalMemoryIndex('atom-os', 0xf123)).toBe(0x420123);
  });
});
