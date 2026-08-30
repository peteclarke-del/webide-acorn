import { describe, expect, it } from 'vitest';
import { archimedesRomProfile, archimedesRuntimeConfiguration, interleaveArchimedesRomLanes } from './archimedesRom';

describe('Archimedes physical ROM normalization', () => {
  it('maps exact RISC OS revisions to their four MAME byte lanes', () => {
    expect(archimedesRomProfile('archimedes-a300', 'riscos310')?.laneFilenames[0]).toBe('0296,041-01.rom');
    expect(archimedesRomProfile('archimedes-a300', 'riscos311')?.laneFilenames[3]).toBe('0296,044-02.rom');
    expect(archimedesRomProfile('bbc-b', 'riscos311')).toBeUndefined();
  });

  it('interleaves lane bytes into the 32-bit ROM memory order Arculator consumes', () => {
    const definition = { ...archimedesRomProfile('archimedes-a300', 'arthur120')!, laneSize: 2 };
    const output = interleaveArchimedesRomLanes(definition, [new Uint8Array([1, 5]), new Uint8Array([2, 6]), new Uint8Array([3, 7]), new Uint8Array([4, 8])]);
    expect([...output]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('rejects missing, wrong-sized and blank physical chips', () => {
    const definition = { ...archimedesRomProfile('archimedes-a300', 'arthur120')!, laneSize: 2 };
    expect(() => interleaveArchimedesRomLanes(definition, [])).toThrow('Expected four');
    expect(() => interleaveArchimedesRomLanes(definition, [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3]), new Uint8Array([4])])).toThrow('must be 2 bytes');
    expect(() => interleaveArchimedesRomLanes(definition, [new Uint8Array([0, 0]), new Uint8Array([2, 2]), new Uint8Array([3, 3]), new Uint8Array([4, 4])])).toThrow('blank ROM');
  });

  it('only advertises the browser-qualified A300 runtime and derives its memory', () => {
    expect(archimedesRuntimeConfiguration('archimedes-a300', 'A305 · 512K', 'riscos311')?.memoryKiB).toBe(512);
    expect(archimedesRuntimeConfiguration('archimedes-a300', 'A310 · 1MB', 'riscos311')?.memoryKiB).toBe(1024);
    expect(archimedesRuntimeConfiguration('archimedes-a400', 'A410/1', 'riscos311')).toBeUndefined();
  });
});
