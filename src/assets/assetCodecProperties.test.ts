/* Property and fuzz coverage for every editable asset codec.
 *
 * Each document type is exercised three ways: a randomised but valid document
 * must serialize, re-parse and regenerate identically; a randomised mutation of
 * a valid document must either parse or be refused with an Error, never crash
 * or silently produce something different; and structurally hostile input must
 * be refused rather than partially accepted.
 *
 * The generator is seeded, so a failure names an exact reproducible case. */
import { describe, expect, it } from 'vitest';
import { createPixelAssetDocument, generatePixelAssetOutput, parsePixelAssetDocument, serializePixelAssetDocument } from './pixelAssetDocument';
import { createTileMapDocument, generateTileMapOutput, parseTileMapDocument, serializeTileMapDocument, setTileMapTileset } from './tileMapDocument';
import { createPaletteDocument, generatePaletteOutput, parsePaletteDocument, serializePaletteDocument, PALETTE_MODES } from './paletteDocument';
import { createFontDocument, generateFontOutput, parseFontDocument, serializeFontDocument } from './fontDocument';
import { createScreenDocument, generateScreenOutput, parseScreenDocument, serializeScreenDocument, paintScreenPixel, screenGeometry } from './screenDocument';
import { createSongDocument, generateSongOutput, parseSongDocument, serializeSongDocument, setSongCell, maximumPitch } from './songDocument';

/** Deterministic 32-bit generator, so any failure is reproducible from its seed. */
function random(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 0x100000000;
  };
}

/* Each codec is described through `unknown` so one table can hold every
 * document type; every entry still uses its own real functions. */
interface Codec {
  name: string;
  /** Cases to generate; a whole-screen document is far larger than the others. */
  cases?: number;
  build: (next: () => number) => unknown;
  parse: (value: unknown) => unknown;
  serialize: (document: never) => string;
  generate: (document: never) => { bytes: Uint8Array; manifest: { sha256: string } };
}

const CODECS: Codec[] = [
  {
    name: 'pixel asset',
    build: (next) => {
      const size = [8, 16, 24, 32][Math.floor(next() * 4)]!;
      const document = createPixelAssetDocument(['character', 'sprite', 'tile'][Math.floor(next() * 3)] as 'tile', size, size);
      document.name = `asset-${Math.floor(next() * 1000)}`;
      document.pixels = document.pixels.map(() => Math.floor(next() * 4));
      if (document.sprite) document.sprite.mask = document.pixels.map(() => (next() < 0.5 ? 0 : 1));
      document.target = { ...document.target, packing: next() < 0.5 ? 'logical-2bpp-msb-groups' : 'bbc-mode-5-hardware-interleaved-2bpp' };
      return document;
    },
    parse: parsePixelAssetDocument,
    serialize: serializePixelAssetDocument,
    generate: generatePixelAssetOutput,
  },
  {
    name: 'tile map',
    build: (next) => {
      const width = 2 + Math.floor(next() * 12);
      const height = 2 + Math.floor(next() * 12);
      const indices = 1 + Math.floor(next() * 6);
      const base = setTileMapTileset(createTileMapDocument(`map-${Math.floor(next() * 1000)}`, width, height),
        Array.from({ length: indices }, (_, offset) => ({ index: offset + 1, assetFile: next() < 0.5 ? null : `tile${offset}.asset.json`, properties: Array.from({ length: Math.floor(next() * 5) }, () => Math.floor(next() * 256)) })));
      return parseTileMapDocument({
        ...base,
        layers: base.layers.map((layer) => ({ ...layer, cells: layer.cells.map(() => Math.floor(next() * (indices + 1))) })),
      });
    },
    parse: parseTileMapDocument,
    serialize: serializeTileMapDocument,
    generate: generateTileMapOutput,
  },
  {
    name: 'palette',
    build: (next) => {
      const mode = PALETTE_MODES[Math.floor(next() * PALETTE_MODES.length)]!;
      const document = createPaletteDocument(`palette-${Math.floor(next() * 1000)}`, mode.id);
      return parsePaletteDocument({ ...document, entries: document.entries.map(() => Math.floor(next() * 16)) });
    },
    parse: parsePaletteDocument,
    serialize: serializePaletteDocument,
    generate: generatePaletteOutput,
  },
  {
    name: 'font',
    build: (next) => {
      const count = 1 + Math.floor(next() * 8);
      const codes = [...new Set(Array.from({ length: count }, () => 32 + Math.floor(next() * 224)))];
      return parseFontDocument({
        ...createFontDocument(`font-${Math.floor(next() * 1000)}`),
        glyphs: codes.map((code) => ({ code, rows: Array.from({ length: 8 }, () => Math.floor(next() * 256)) })),
        sampleText: String.fromCharCode(...codes.slice(0, 4)),
      });
    },
    parse: parseFontDocument,
    serialize: serializeFontDocument,
    generate: generateFontOutput,
  },
  {
    name: 'screen',
    cases: 20,
    build: (next) => {
      const mode = PALETTE_MODES[Math.floor(next() * PALETTE_MODES.length)]!.id;
      let document = createScreenDocument(`screen-${Math.floor(next() * 1000)}`, mode);
      const geometry = screenGeometry(mode);
      for (let placed = 0; placed < 24; placed += 1) {
        document = paintScreenPixel(document,
          Math.floor(next() * geometry.width),
          Math.floor(next() * geometry.height),
          Math.floor(next() * geometry.logicalColours));
      }
      return document;
    },
    parse: parseScreenDocument,
    serialize: serializeScreenDocument,
    generate: generateScreenOutput,
  },
  {
    name: 'song',
    build: (next) => {
      const atom = next() < 0.5;
      const target = atom ? 'atom-speaker' : 'bbc-sn76489';
      let document = createSongDocument(`song-${Math.floor(next() * 1000)}`, 1 + Math.floor(next() * 24), target);
      const channels = atom ? 1 : 4;
      for (let row = 0; row < document.rows.length; row += 1) {
        for (let channel = 0; channel < channels; channel += 1) {
          document = setSongCell(document, row, channel, {
            pitch: Math.floor(next() * (maximumPitch(channel, target) + 1)),
            volume: Math.floor(next() * ((atom ? 1 : 15) + 1)),
          });
        }
      }
      return document;
    },
    parse: parseSongDocument,
    serialize: serializeSongDocument,
    generate: generateSongOutput,
  },
];

const DEFAULT_CASES = 60;
const TIMEOUT_MS = 30_000;

describe.each(CODECS)('$name codec properties', (codec) => {
  it('serializes, re-parses and regenerates identically', () => {
    const next = random(0x51ed);
    for (let index = 0; index < (codec.cases ?? DEFAULT_CASES); index += 1) {
      const document = codec.build(next);
      const text = codec.serialize(document as never);
      const reparsed = codec.parse(text);
      expect(reparsed, `case ${index}`).toEqual(document);
      expect(codec.serialize(reparsed as never), `case ${index}`).toBe(text);
      const first = codec.generate(document as never);
      const second = codec.generate(reparsed as never);
      /* The digest is over the generated bytes, so matching digests and lengths
       * prove byte equality without copying a whole frame buffer per case. */
      expect(second.bytes.length, `case ${index}`).toBe(first.bytes.length);
      expect(second.manifest.sha256, `case ${index}`).toBe(first.manifest.sha256);
    }
  }, TIMEOUT_MS);

  it('either accepts or refuses a randomly mutated document, and never returns something different', () => {
    const next = random(0xc0de);
    for (let index = 0; index < (codec.cases ?? DEFAULT_CASES); index += 1) {
      const document = codec.build(next);
      const mutated = JSON.parse(codec.serialize(document as never)) as Record<string, unknown>;
      const keys = Object.keys(mutated);
      const key = keys[Math.floor(next() * keys.length)]!;
      const roll = next();
      mutated[key] = roll < 0.25 ? null : roll < 0.5 ? 'unexpected' : roll < 0.75 ? -1 : { nested: true };
      let accepted: unknown;
      try { accepted = codec.parse(mutated); }
      catch (error) {
        expect(error, `case ${index} key ${key}`).toBeInstanceOf(Error);
        expect((error as Error).message, `case ${index} key ${key}`).not.toBe('');
        continue;
      }
      /* Anything accepted must survive its own round trip unchanged, so a
       * mutation can never be half-applied. */
      expect(codec.parse(codec.serialize(accepted as never)), `case ${index} key ${key}`).toEqual(accepted);
    }
  }, TIMEOUT_MS);

  it('refuses structurally hostile input rather than partially accepting it', () => {
    const hostile: unknown[] = [
      null, undefined, 0, '', 'null', [], [1, 2, 3], { schema: 'wrong', version: 1 },
      { schema: 'wrong', version: 999 }, { __proto__: { polluted: true } },
    ];
    for (const value of hostile) {
      expect(() => codec.parse(value), String(value)).toThrow();
    }
  });

  it('refuses text that is not JSON at all', () => {
    for (const text of ['{', '{"a":', 'not json', '[[[[', ' ']) {
      expect(() => codec.parse(text)).toThrow();
    }
  });
});

describe('generated output is a pure function of the document', () => {
  it('produces the same bytes for two independently built equal documents', () => {
    for (const codec of CODECS) {
      const first = codec.build(random(0xabcd));
      const second = codec.build(random(0xabcd));
      expect(second, codec.name).toEqual(first);
      expect(codec.generate(second as never).manifest.sha256, codec.name).toBe(codec.generate(first as never).manifest.sha256);
    }
  });
});
