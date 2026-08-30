import { describe, expect, it } from 'vitest';
import { assemblyByteRuns, pixelAssetCandidates, pixelGeometriesFor, tileMapCandidates, tileMapFromCandidate } from './assemblyPixelData';
import { generateTileMapOutput } from './tileMapDocument';
import { generatePixelAssetOutput, parsePixelAssetDocument } from './pixelAssetDocument';

const SPRITE_BYTES = Array.from({ length: 16 }, (_, index) => (index * 17) & 0xff);
const SPRITE_SOURCE = [
  '; a hand-written sprite',
  '.hero_pixels',
  `EQUB ${SPRITE_BYTES.slice(0, 8).map((byte) => `&${byte.toString(16).toUpperCase().padStart(2, '0')}`).join(', ')}`,
  `EQUB ${SPRITE_BYTES.slice(8).map((byte) => `&${byte.toString(16).toUpperCase().padStart(2, '0')}`).join(', ')}`,
  '.hero_end',
  'RTS',
].join('\n');

describe('assembly byte runs', () => {
  it('collects consecutive numeric data lines under their own label', () => {
    const runs = assemblyByteRuns('gfx.asm', SPRITE_SOURCE);
    expect(runs.map((run) => run.label)).toEqual(['hero_pixels']);
    expect(runs[0]!.bytes).toEqual(SPRITE_BYTES);
    expect(runs[0]!.line).toBe(2);
  });

  it('accepts decimal, Acorn hexadecimal, C hexadecimal and binary items', () => {
    const runs = assemblyByteRuns('mix.asm', '.data\nEQUB 1, &02, $03, %00000100');
    expect(runs[0]!.bytes).toEqual([1, 2, 3, 4]);
  });

  it('stops a run at the next label, at an instruction and at a non-byte item', () => {
    expect(assemblyByteRuns('a.asm', '.one\nEQUB 1\n.two\nEQUB 2').map((run) => run.bytes)).toEqual([[1], [2]]);
    expect(assemblyByteRuns('b.asm', '.one\nEQUB 1\nLDA #0\nEQUB 9')[0]!.bytes).toEqual([1]);
    expect(assemblyByteRuns('c.asm', '.one\nEQUB 1\nEQUB label')[0]!.bytes).toEqual([1]);
    expect(assemblyByteRuns('d.asm', '.one\nEQUW 1')).toEqual([]);
  });

  it('ignores comments and reads data placed on the label line', () => {
    expect(assemblyByteRuns('e.asm', '.one EQUB 1, 2 ; two bytes')[0]!.bytes).toEqual([1, 2]);
  });
});

describe('pixel geometries', () => {
  it('offers only geometries the asset schema supports, squarest first', () => {
    expect(pixelGeometriesFor(16)).toEqual([{ width: 8, height: 8 }]);
    expect(pixelGeometriesFor(64)[0]).toEqual({ width: 16, height: 16 });
    expect(pixelGeometriesFor(32)).toEqual(expect.arrayContaining([{ width: 16, height: 8 }, { width: 8, height: 16 }]));
    expect(pixelGeometriesFor(17)).toEqual([]);
    expect(pixelGeometriesFor(20)).toEqual([]);
  });
});

describe('recovered pixel assets', () => {
  const runs = assemblyByteRuns('gfx.asm', SPRITE_SOURCE);

  it('regenerates the original bytes exactly from the editable document', () => {
    const [candidate] = pixelAssetCandidates(runs);
    expect(candidate).toBeDefined();
    expect(candidate!.width).toBe(8);
    expect(candidate!.height).toBe(8);
    const output = generatePixelAssetOutput(parsePixelAssetDocument(candidate!.document));
    expect(Array.from(output.bytes)).toEqual(SPRITE_BYTES);
  });

  it('reproduces the bytes under either packing, because both are reversible', () => {
    for (const packing of ['logical-2bpp-msb-groups', 'bbc-mode-5-hardware-interleaved-2bpp'] as const) {
      const [candidate] = pixelAssetCandidates(runs, new Set(), { packing });
      const document = parsePixelAssetDocument(candidate!.document);
      expect(document.target.packing).toBe(packing);
      expect(Array.from(generatePixelAssetOutput(document).bytes)).toEqual(SPRITE_BYTES);
    }
  });

  it('names the document from the label and avoids colliding with existing files', () => {
    const [first] = pixelAssetCandidates(runs);
    expect(first!.name).toBe('hero');
    expect(first!.fileName).toBe('hero.asset.json');
    const [second] = pixelAssetCandidates(runs, new Set(['hero.asset.json']));
    expect(second!.fileName).toBe('hero-2.asset.json');
  });

  it('offers nothing for a run whose length has no valid geometry', () => {
    expect(pixelAssetCandidates(assemblyByteRuns('x.asm', '.odd\nEQUB 1, 2, 3'))).toEqual([]);
  });

  it('records where the data came from so the original source stays authoritative', () => {
    const [candidate] = pixelAssetCandidates(runs);
    expect(candidate).toMatchObject({ sourceFile: 'gfx.asm', sourceLabel: 'hero_pixels', sourceLine: 2, byteLength: 16 });
  });
});

describe('tile map candidates', () => {
  const map = ['.level_map', ...Array.from({ length: 6 }, () => 'EQUB 1, 0, 0, 2, 0, 1, 1, 0')].join('\n');

  it('reports a small-alphabet run with the grid shapes its length allows', () => {
    const [candidate] = tileMapCandidates(assemblyByteRuns('level.asm', map));
    expect(candidate).toMatchObject({ sourceLabel: 'level_map', byteLength: 48, distinctValues: 3 });
    expect(candidate!.shapes).toEqual(expect.arrayContaining([{ width: 8, height: 6 }, { width: 6, height: 8 }]));
  });

  it('does not report pixel data or short runs as maps', () => {
    expect(tileMapCandidates(assemblyByteRuns('gfx.asm', SPRITE_SOURCE))).toEqual([]);
    expect(tileMapCandidates(assemblyByteRuns('s.asm', '.tiny\nEQUB 1, 0, 1, 0'))).toEqual([]);
  });
});

describe('promoting detected level data to a real map', () => {
  const map = ['.level_map', ...Array.from({ length: 6 }, () => 'EQUB 1, 0, 0, 2, 0, 1, 1, 0')].join('\n');
  const [candidate] = tileMapCandidates(assemblyByteRuns('level.asm', map));

  it('recovers the exact layout and declares each value it found', () => {
    const document = tileMapFromCandidate(candidate!, 8, 6);
    expect(document.name).toBe('level');
    expect(document.width).toBe(8);
    expect(document.height).toBe(6);
    expect(document.layers[0]!.cells).toEqual(candidate!.values);
    expect(document.tileset).toEqual([{ index: 1, assetFile: null, properties: [] }, { index: 2, assetFile: null, properties: [] }]);
  });

  it('regenerates the original bytes as its layer data', () => {
    const output = generateTileMapOutput(tileMapFromCandidate(candidate!, 8, 6));
    expect(Array.from(output.bytes.slice(6, 6 + candidate!.values.length))).toEqual(candidate!.values);
    expect(output.manifest.unassignedIndices).toEqual([1, 2]);
    expect(output.requiredAssets).toEqual([]);
  });

  it('refuses a grid shape the run length does not allow', () => {
    expect(() => tileMapFromCandidate(candidate!, 7, 7)).toThrow(/cannot be read as a 7 by 7 grid/);
  });
});
