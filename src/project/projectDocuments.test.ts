import { describe, expect, it } from 'vitest';
import { projectDocuments } from './projectDocuments';
import type { ProjectFile } from './project';

const file = (name: string, content: string): ProjectFile =>
  ({ id: name.replace(/[^A-Za-z0-9._-]+/g, '-'), name, content, language: 'text', modified: false });

const pixel = (name: string, kind: string, width = 16, height = 16, frames = 1) => file(name, JSON.stringify({
  schema: '8bit-net.pixel-asset', version: 1, name, kind, width, height,
  sprite: { frames: Array.from({ length: frames }, () => ({ pixels: [] })) },
}));

describe('the documents a project holds', () => {
  it('offers each editor the kinds it can open, read from the document not the name', () => {
    const files = [
      pixel('assets/hero.asset.json', 'sprite', 16, 16, 3),
      pixel('assets/wall.asset.json', 'tile'),
      pixel('assets/letters.asset.json', 'character', 8, 8),
      file('levels/room.map.json', JSON.stringify({ schema: '8bit-net.generated-map', width: 20, height: 16 })),
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
