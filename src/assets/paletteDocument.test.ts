import { describe, expect, it } from 'vitest';
import {
  createPaletteDocument, defaultPaletteEntries, generatePaletteOutput, PALETTE_MODES, paletteLabel,
  paletteModeProfile, parsePaletteDocument, physicalColour, resetPalette, resolveProjectPalette,
  serializePaletteDocument, setPaletteEntry, setPaletteMode,
} from './paletteDocument';

describe('physical colours', () => {
  it('names the eight steady colours in the machine order', () => {
    expect(physicalColour(0)).toMatchObject({ name: 'black', flashing: false, rgb: '#000000' });
    expect(physicalColour(1).name).toBe('red');
    expect(physicalColour(7)).toMatchObject({ name: 'white', flashing: false, rgb: '#ffffff' });
  });

  it('describes a flashing colour by both phases rather than only the first', () => {
    const flashing = physicalColour(8);
    expect(flashing.flashing).toBe(true);
    expect(flashing.name).toBe('flashing black/white');
    expect(flashing.rgb).toBe('#000000');
    expect(flashing.alternateRgb).toBe('#ffffff');
    expect(physicalColour(9).name).toBe('flashing red/cyan');
    expect(physicalColour(15).name).toBe('flashing white/black');
  });

  it('wraps an out-of-range index into the sixteen the hardware has', () => {
    expect(physicalColour(16).index).toBe(0);
    expect(physicalColour(-1).index).toBe(15);
  });
});

describe('palette documents', () => {
  it('starts every mode from its own power-up palette', () => {
    expect(defaultPaletteEntries('bbc-mode-5')).toEqual([0, 1, 3, 7]);
    expect(defaultPaletteEntries('bbc-mode-4')).toEqual([0, 7]);
    expect(defaultPaletteEntries('bbc-mode-2')).toEqual(Array.from({ length: 16 }, (_, index) => index));
    for (const mode of PALETTE_MODES) {
      expect(createPaletteDocument('p', mode.id).entries).toHaveLength(mode.logicalColours);
    }
  });

  it('round-trips through serialization', () => {
    const document = setPaletteEntry(createPaletteDocument('level palette'), 2, 6);
    expect(parsePaletteDocument(serializePaletteDocument(document))).toEqual(document);
  });

  it('refuses a wrong entry count, an out-of-range colour and an unknown mode', () => {
    expect(() => parsePaletteDocument({ schema: '8bit-net.palette', version: 1, name: 'p', mode: 'bbc-mode-5', entries: [0, 1] }))
      .toThrow(/MODE 5 has 4 logical colours/);
    expect(() => parsePaletteDocument({ schema: '8bit-net.palette', version: 1, name: 'p', mode: 'bbc-mode-5', entries: [0, 1, 3, 16] }))
      .toThrow(/physical colour from 0 to 15/);
    expect(() => parsePaletteDocument({ schema: '8bit-net.palette', version: 1, name: 'p', mode: 'bbc-mode-9', entries: [] }))
      .toThrow(/Palette mode must be one of/);
    expect(() => parsePaletteDocument({ schema: 'other', version: 1 })).toThrow(/Unsupported palette schema/);
  });

  it('keeps the entries that still exist when the mode changes', () => {
    const mode5 = setPaletteEntry(createPaletteDocument('p', 'bbc-mode-5'), 1, 6);
    const mode2 = setPaletteMode(mode5, 'bbc-mode-2');
    expect(mode2.entries).toHaveLength(16);
    expect(mode2.entries.slice(0, 4)).toEqual([0, 6, 3, 7]);
    const backToFour = setPaletteMode(mode2, 'bbc-mode-5');
    expect(backToFour.entries).toEqual([0, 6, 3, 7]);
  });

  it('restores the power-up palette and refuses an index outside the mode', () => {
    const changed = setPaletteEntry(createPaletteDocument('p'), 0, 4);
    expect(changed.entries[0]).toBe(4);
    expect(resetPalette(changed).entries).toEqual([0, 1, 3, 7]);
    expect(() => setPaletteEntry(changed, 4, 1)).toThrow(/not in this mode/);
  });
});

describe('generated palette output', () => {
  const output = generatePaletteOutput(setPaletteEntry(createPaletteDocument('level palette'), 3, 9));

  it('emits the exact VDU 19 stream the machine needs', () => {
    expect(Array.from(output.bytes)).toEqual([
      19, 0, 0, 0, 0, 0,
      19, 1, 1, 0, 0, 0,
      19, 2, 3, 0, 0, 0,
      19, 3, 9, 0, 0, 0,
    ]);
    expect(output.manifest).toMatchObject({ displayMode: 5, logicalColours: 4, byteLength: 24 });
    expect(output.manifest.sha256).toBe(generatePaletteOutput(setPaletteEntry(createPaletteDocument('level palette'), 3, 9)).manifest.sha256);
  });

  it('names each mapping in the generated source and offers a BASIC form', () => {
    expect(paletteLabel('level palette')).toBe('palette_level_palette');
    expect(output.assembly).toContain('.palette_level_palette');
    expect(output.assembly).toContain('EQUB 19, 3, 9, 0, 0, 0 ; logical 3 becomes flashing red/cyan');
    expect(output.basic.split('\n')).toEqual(['VDU 19,0,0,0,0,0', 'VDU 19,1,1,0,0,0', 'VDU 19,2,3,0,0,0', 'VDU 19,3,9,0,0,0']);
  });

  it('reports which logical colours actually flash on the machine', () => {
    expect(output.manifest.flashingLogicalColours).toEqual([3]);
    expect(generatePaletteOutput(createPaletteDocument('steady')).manifest.flashingLogicalColours).toEqual([]);
  });
});

describe('the shared project palette', () => {
  const palette = (name: string, mode: string, entries: number[]) => ({
    name, content: JSON.stringify({ schema: '8bit-net.palette', version: 1, name, mode, entries, extensions: {} }),
  });

  it('falls back to the power-up palette and says no project palette was found', () => {
    const resolved = resolveProjectPalette([], 4);
    expect(resolved.document).toBeNull();
    expect(resolved.fileName).toBeNull();
    expect(resolved.colours).toEqual(['#000000', '#ff0000', '#ffff00', '#ffffff']);
  });

  it('prefers a palette whose mode has the requested number of logical colours', () => {
    const files = [palette('wide.palette.json', 'bbc-mode-2', Array.from({ length: 16 }, (_, index) => index)), palette('level.palette.json', 'bbc-mode-5', [0, 2, 4, 6])];
    const resolved = resolveProjectPalette(files, 4);
    expect(resolved.fileName).toBe('level.palette.json');
    expect(resolved.colours).toEqual(['#000000', '#00ff00', '#0000ff', '#00ffff']);
  });

  it('uses any palette it can parse when none matches the colour count exactly', () => {
    const resolved = resolveProjectPalette([palette('wide.palette.json', 'bbc-mode-2', Array.from({ length: 16 }, () => 2))], 4);
    expect(resolved.fileName).toBe('wide.palette.json');
    expect(resolved.colours).toEqual(['#00ff00', '#00ff00', '#00ff00', '#00ff00']);
  });

  it('ignores a palette file that does not parse rather than failing the preview', () => {
    const resolved = resolveProjectPalette([{ name: 'broken.palette.json', content: '{not json' }], 4);
    expect(resolved.document).toBeNull();
    expect(resolved.colours).toHaveLength(4);
  });

  it('reports flashing logical colours so a still preview can say what it cannot show', () => {
    const resolved = resolveProjectPalette([palette('flash.palette.json', 'bbc-mode-5', [0, 10, 3, 7])], 4);
    expect(resolved.flashing).toEqual([1]);
    expect(resolved.colours[1]).toBe('#00ff00');
  });

  it('serves a two colour and a sixteen colour request from the same project', () => {
    const files = [palette('level.palette.json', 'bbc-mode-5', [0, 1, 3, 7])];
    expect(resolveProjectPalette(files, 2).colours).toHaveLength(2);
    expect(resolveProjectPalette(files, 16).colours).toHaveLength(16);
  });

  it('exposes each mode profile the editors offer', () => {
    expect(paletteModeProfile('bbc-mode-2')).toMatchObject({ mode: 2, logicalColours: 16, bitsPerPixel: 4 });
    expect(() => paletteModeProfile('bbc-mode-3' as never)).toThrow(/Unknown palette mode/);
  });
});
