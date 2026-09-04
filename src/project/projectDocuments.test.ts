import { describe, expect, it } from 'vitest';
import { projectDocuments } from './projectDocuments';
import { createTileMapDocument, serializeTileMapDocument } from '../assets/tileMapDocument';
import { createScreenDocument, serializeScreenDocument } from '../assets/screenDocument';
import { createFontDocument, serializeFontDocument } from '../assets/fontDocument';
import { createPaletteDocument, serializePaletteDocument } from '../assets/paletteDocument';
import { createSongDocument, serializeSongDocument } from '../assets/songDocument';
import { createVidcSampleDocument, serializeVidcSampleDocument } from '../assets/vidcSampleDocument';
import { createPixelAssetDocument, serializePixelAssetDocument } from '../assets/pixelAssetDocument';
import type { ProjectFile } from './project';

const file = (name: string, content: string): ProjectFile =>
  ({ id: name.replace(/[^A-Za-z0-9._-]+/g, '-'), name, content, language: 'text', modified: false });

const pixel = (name: string, kind: string, width = 16, height = 16, frames = 1) => file(name, JSON.stringify({
  schema: '8bit-net.pixel-asset', version: 1, name, kind, width, height,
  sprite: { frames: Array.from({ length: frames }, () => ({ pixels: [] })) },
}));

/*
 * Every kind, built by the constructor that really makes one.
 *
 * The mapping used to be six string literals, all six of them wrong, and the
 * tests passed because they used the same wrong literals. Building each
 * document the way the product builds it is what makes this test able to fail.
 */
describe('every kind of document the project can hold', () => {
  it('recognises a map, a screen, a font, a palette, a song and a sample', () => {
    const files = [
      file('level.map.json', serializeTileMapDocument(createTileMapDocument('level', 16, 14))),
      file('loading.screen.json', serializeScreenDocument(createScreenDocument('loading', 'bbc-mode-2'))),
      file('title.font.json', serializeFontDocument(createFontDocument('title'))),
      file('game.palette.json', serializePaletteDocument(createPaletteDocument('game'))),
      file('tune.song.json', serializeSongDocument(createSongDocument('tune'))),
      file('boom.sample.json', serializeVidcSampleDocument(createVidcSampleDocument('boom'))),
      file('hero.asset.json', serializePixelAssetDocument(createPixelAssetDocument('sprite', 16, 16))),
    ];
    expect(projectDocuments(files).map((entry) => entry.kind).sort()).toEqual(
      ['font', 'map', 'palette', 'sample', 'screen', 'song', 'sprite'],
    );
  });

  it('says something about every one of them, so two of a kind can be told apart', () => {
    /* Only the pixel documents carry a width and a height, so every other kind
     * was offered with an empty description beside its filename. */
    const files = [
      file('level.map.json', serializeTileMapDocument(createTileMapDocument('level', 16, 14))),
      file('loading.screen.json', serializeScreenDocument(createScreenDocument('loading', 'bbc-mode-2'))),
      file('title.font.json', serializeFontDocument(createFontDocument('title'))),
      file('game.palette.json', serializePaletteDocument(createPaletteDocument('game'))),
      file('tune.song.json', serializeSongDocument(createSongDocument('tune'))),
      file('boom.sample.json', serializeVidcSampleDocument(createVidcSampleDocument('boom'))),
      file('hero.asset.json', serializePixelAssetDocument(createPixelAssetDocument('sprite', 16, 16))),
    ];
    for (const document of projectDocuments(files)) {
      expect(document.detail, `${document.name} says what it is`).not.toBe('');
    }
  });

  it('offers each editor only what it can open', () => {
    const files = [
      file('level.map.json', serializeTileMapDocument(createTileMapDocument('level', 16, 14))),
      file('loading.screen.json', serializeScreenDocument(createScreenDocument('loading', 'bbc-mode-2'))),
    ];
    expect(projectDocuments(files, ['map']).map((entry) => entry.name)).toEqual(['level.map.json']);
    expect(projectDocuments(files, ['screen']).map((entry) => entry.name)).toEqual(['loading.screen.json']);
  });
});

describe('the documents a project holds', () => {
  it('offers each editor the kinds it can open, read from the document not the name', () => {
    const files = [
      pixel('assets/hero.asset.json', 'sprite', 16, 16, 3),
      pixel('assets/wall.asset.json', 'tile'),
      pixel('assets/letters.asset.json', 'character', 8, 8),
      /* Built by the constructor rather than written out as a literal: the
       * literal this used to carry was the schema of a build manifest, which
       * is how the classifier came to look for the wrong one and this test
       * came to agree with it. */
      file('levels/room.map.json', serializeTileMapDocument(createTileMapDocument('room', 20, 16))),
      file('src/main.6502', 'RTS'),
    ];

    expect(projectDocuments(files, ['sprite']).map((d) => d.name)).toEqual(['assets/hero.asset.json']);
    expect(projectDocuments(files, ['tile']).map((d) => d.name)).toEqual(['assets/wall.asset.json']);
    expect(projectDocuments(files, ['map']).map((d) => d.name)).toEqual(['levels/room.map.json']);
    expect(projectDocuments(files).map((d) => d.kind).sort()).toEqual(['character', 'map', 'sprite', 'tile']);
  });

  it('says what each one is, so two of the same name can be told apart', () => {
    const [sprite] = projectDocuments([pixel('hero.asset.json', 'sprite', 16, 16, 3)]);
    expect(sprite!.detail).toBe('16×16 · 3 frames');
    const [tile] = projectDocuments([pixel('wall.asset.json', 'tile', 8, 8)]);
    expect(tile!.detail).toBe('8×8');
  });

  it('leaves out a document nothing could open, rather than offering it', () => {
    /* A file that carries the schema but does not parse cannot be opened, and
     * listing it would promise something that does not work. */
    const broken = file('broken.asset.json', '{ "schema": "8bit-net.pixel-asset", ');
    const wrongKind = file('odd.asset.json', JSON.stringify({ schema: '8bit-net.pixel-asset', kind: 'mystery' }));
    expect(projectDocuments([broken, wrongKind])).toEqual([]);
  });

  it('orders them by name, because that is how somebody looks for one', () => {
    const files = [pixel('z.asset.json', 'sprite'), pixel('a.asset.json', 'sprite'), pixel('m.asset.json', 'sprite')];
    expect(projectDocuments(files).map((d) => d.name)).toEqual(['a.asset.json', 'm.asset.json', 'z.asset.json']);
  });
});
