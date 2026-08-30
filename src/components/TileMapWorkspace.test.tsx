import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TileMapWorkspace } from './TileMapWorkspace';
import { parseTileMapDocument } from '../assets/tileMapDocument';
import { resolveProjectPalette } from '../assets/paletteDocument';

afterEach(() => { cleanup(); localStorage.clear(); });

const wall = JSON.stringify({
  schema: '8bit-net.pixel-asset', version: 1, name: 'wall', kind: 'tile', width: 8, height: 8,
  pixels: Array(64).fill(1), palette: { indices: [0, 1, 2, 3], interpretation: 'logical-acorn-colours' },
  target: { family: 'acorn-8-bit', packing: 'logical-2bpp-msb-groups', previewPixelAspect: 'square-editor-preview' },
  extensions: {},
});

function renderWorkspace(overrides: Partial<Parameters<typeof TileMapWorkspace>[0]> = {}) {
  const props = {
    projectPalette: resolveProjectPalette([], 4),
    availableAssets: [{ name: 'wall.asset.json', content: wall }],
    onAddSource: vi.fn(),
    onAddLiveMap: vi.fn(),
    onNotice: vi.fn(),
    ...overrides,
  };
  render(<TileMapWorkspace {...props} />);
  return props;
}

const canvas = () => screen.getByRole('application', { name: /Tile map/ });
const stored = () => parseTileMapDocument(localStorage.getItem('8bit-net-dev:tile-map')!);

describe('TileMapWorkspace', () => {
  it('starts from a validated empty map and recovers it from browser storage', () => {
    renderWorkspace();
    expect(canvas()).toHaveAccessibleName('Tile map untitled-map, 20 by 16 tiles');
    const document = stored();
    expect(document.layers).toHaveLength(1);
    expect(document.layers[0]!.cells.every((cell) => cell === 0)).toBe(true);
  });

  it('moves a keyboard cursor and reports the cell without needing the canvas', () => {
    renderWorkspace();
    fireEvent.keyDown(canvas(), { key: 'ArrowRight' });
    fireEvent.keyDown(canvas(), { key: 'ArrowDown' });
    expect(screen.getByRole('status')).toHaveTextContent('Row 2 of 16, column 2 of 20, empty on layer Ground');
    fireEvent.keyDown(canvas(), { key: 'Home' });
    expect(screen.getByRole('status')).toHaveTextContent('column 1 of 20');
  });

  it('will not move the cursor outside the map', () => {
    renderWorkspace();
    for (let step = 0; step < 3; step += 1) fireEvent.keyDown(canvas(), { key: 'ArrowUp' });
    expect(screen.getByRole('status')).toHaveTextContent('Row 1 of 16');
    fireEvent.keyDown(canvas(), { key: 'End' });
    fireEvent.keyDown(canvas(), { key: 'ArrowRight' });
    expect(screen.getByRole('status')).toHaveTextContent('column 20 of 20');
  });

  it('declares a tile, attaches project artwork and paints it from the keyboard', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Declare tile 1' }));
    fireEvent.change(screen.getByLabelText('Artwork for tile 1'), { target: { value: 'wall.asset.json' } });
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    fireEvent.keyDown(canvas(), { key: 'Enter' });
    const document = stored();
    expect(document.tileset).toEqual([{ index: 1, assetFile: 'wall.asset.json', properties: [] }]);
    expect(document.layers[0]!.cells[0]).toBe(1);
    expect(screen.getByRole('status')).toHaveTextContent('tile 1 from wall.asset.json');
  });

  it('says an index has no artwork rather than showing an invented picture', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Declare tile 1' }));
    fireEvent.click(screen.getByRole('button', { name: '1 ?' }));
    fireEvent.keyDown(canvas(), { key: 'Enter' });
    expect(screen.getByRole('status')).toHaveTextContent('artwork not chosen');
    expect(screen.getByText(/Indices 1 have no artwork chosen/)).toBeInTheDocument();
    expect(screen.getByLabelText('Generated map assembler source')).toHaveTextContent('EQUW 0 ; index 1 has no artwork chosen yet');
  });

  it('names a tileset asset the project does not contain instead of ignoring it', () => {
    renderWorkspace({ availableAssets: [] });
    expect(screen.getByText(/no pixel asset documents yet/)).toBeInTheDocument();
  });

  it('fills a layer, then undoes and redoes the change', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Declare tile 1' }));
    fireEvent.click(screen.getByRole('button', { name: '1 ?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fill layer' }));
    expect(stored().layers[0]!.cells.every((cell) => cell === 1)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(stored().layers[0]!.cells.every((cell) => cell === 0)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(stored().layers[0]!.cells.every((cell) => cell === 1)).toBe(true);
  });

  it('adds and removes layers within the declared bound', () => {
    renderWorkspace();
    for (let count = 1; count < 4; count += 1) fireEvent.click(screen.getByRole('button', { name: 'Add layer' }));
    expect(stored().layers).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Add layer' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove layer Layer 2' }));
    expect(stored().layers).toHaveLength(3);
  });

  it('resizes while keeping retained cells and refuses an impossible size', () => {
    const { onNotice } = renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Declare tile 1' }));
    fireEvent.click(screen.getByRole('button', { name: '1 ?' }));
    fireEvent.keyDown(canvas(), { key: 'Enter' });
    fireEvent.change(screen.getByLabelText('Map width in tiles'), { target: { value: '6' } });
    expect(stored().width).toBe(6);
    expect(stored().layers[0]!.cells[0]).toBe(1);
    fireEvent.change(screen.getByLabelText('Map height in tiles'), { target: { value: '999' } });
    expect(onNotice).toHaveBeenCalledWith(expect.stringMatching(/Map height must be a whole number of tiles/));
    expect(stored().height).toBe(16);
  });

  it('clears painted cells when their tile index is removed, and says so', () => {
    const { onNotice } = renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Declare tile 1' }));
    fireEvent.click(screen.getByRole('button', { name: '1 ?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fill layer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove tile 1' }));
    expect(stored().tileset).toEqual([]);
    expect(stored().layers[0]!.cells.every((cell) => cell === 0)).toBe(true);
    expect(onNotice).toHaveBeenCalledWith(expect.stringMatching(/painted cells using it were cleared/));
  });

  it('adds an object at the cursor with byte properties', () => {
    renderWorkspace();
    fireEvent.keyDown(canvas(), { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('button', { name: 'Add object at cursor' }));
    fireEvent.change(screen.getByLabelText('Object name'), { target: { value: 'Spawn' } });
    fireEvent.change(screen.getByLabelText('Object properties'), { target: { value: '7, 9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save object' }));
    expect(stored().objects).toEqual([{ id: 'object-1', name: 'Spawn', kind: 'point', x: 1, y: 0, width: 1, height: 1, properties: [7, 9] }]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove object Spawn' }));
    expect(stored().objects).toEqual([]);
  });

  it('offers the generated source and a live build target using the map directive', () => {
    const { onAddSource, onAddLiveMap } = renderWorkspace();
    fireEvent.change(screen.getByLabelText('Map name'), { target: { value: 'level one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add generated source' }));
    expect(onAddSource).toHaveBeenCalledWith('level-one.asm', expect.stringContaining('.map_level_one'));
    fireEvent.click(screen.getByRole('button', { name: 'Add live map build target' }));
    expect(onAddLiveMap).toHaveBeenCalledWith('level-one', expect.stringContaining('"schema": "8bit-net.tile-map"'));
  });

  it('shows the tile indices of the current row as a text alternative to the canvas', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Declare tile 1' }));
    fireEvent.click(screen.getByRole('button', { name: '1 ?' }));
    fireEvent.keyDown(canvas(), { key: 'Enter' });
    const row = screen.getByLabelText('Tile indices on the current row');
    expect(within(row).getByText(/^1 0 0/)).toBeInTheDocument();
  });
});

describe('TileMapWorkspace tile properties', () => {
  it('records byte properties for a tile and reports the generated stride', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Declare tile 1' }));
    fireEvent.change(screen.getByLabelText('Properties for tile 1'), { target: { value: '1, 0' } });
    expect(stored().tileset[0]!.properties).toEqual([1, 0]);
    expect(screen.getByLabelText('Generated map assembler source')).toHaveTextContent('.map_untitled_map_tile_properties');
  });

  it('shows how many cells use each tile', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Declare tile 1' }));
    fireEvent.click(screen.getByRole('button', { name: '1 ?' }));
    fireEvent.keyDown(canvas(), { key: 'Enter' });
    expect(screen.getByText('1 cells')).toBeInTheDocument();
  });

  it('reports two indices that draw the same artwork so they can be merged', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Declare tile 1' }));
    fireEvent.change(screen.getByLabelText('Artwork for tile 1'), { target: { value: 'wall.asset.json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Declare tile 2' }));
    fireEvent.change(screen.getByLabelText('Artwork for tile 2'), { target: { value: 'wall.asset.json' } });
    expect(screen.getByText(/Tiles 1 and 2 both draw wall.asset.json/)).toBeInTheDocument();
  });
});

describe('TileMapWorkspace Tiled interchange', () => {
  const tiledMap = JSON.stringify({
    type: 'map', orientation: 'orthogonal', infinite: false, tiledversion: '1.10.2',
    name: 'imported', width: 4, height: 3, tilewidth: 8, tileheight: 8,
    tilesets: [{ firstgid: 1, source: 'shared.tsx' }],
    layers: [
      { type: 'tilelayer', name: 'Ground', width: 4, height: 3, encoding: 'csv', data: [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      { type: 'imagelayer', name: 'Backdrop' },
    ],
  });

  function chooseFile(content: string, name = 'level.json') {
    const file = new File([content], name, { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => content });
    const input = screen.getByLabelText('Import a Tiled JSON map') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    fireEvent.change(input);
  }

  it('imports a Tiled map and lists what it could not represent', async () => {
    renderWorkspace();
    chooseFile(tiledMap);
    expect(await screen.findByRole('region', { name: 'Interchange report' })).toBeInTheDocument();
    /* The import is driven by an asynchronous file read, so the document is
     * awaited rather than assumed to have landed with the report. */
    await waitFor(() => expect(stored().width).toBe(4));
    expect(stored().layers[0]!.cells.slice(0, 2)).toEqual([1, 1]);
    expect(screen.getByText(/Image layer "Backdrop"/)).toBeInTheDocument();
    expect(screen.getByText(/external tileset reference/)).toBeInTheDocument();
    expect(screen.getByText(/contains no Tiled code, artwork or content/)).toBeInTheDocument();
  });

  it('reports a refusal without changing the current map', async () => {
    const { onNotice } = renderWorkspace();
    const before = stored();
    chooseFile(JSON.stringify({ type: 'map', orientation: 'isometric', width: 4, height: 4 }));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(expect.stringMatching(/orthogonal maps only/)));
    await waitFor(() => expect(stored()).toEqual(before));
  });

  it('exports the current map as a Tiled document', () => {
    const { onAddSource } = renderWorkspace();
    fireEvent.change(screen.getByLabelText('Map name'), { target: { value: 'level one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export Tiled JSON' }));
    expect(onAddSource).toHaveBeenCalledWith('level-one.tiled.json', expect.stringContaining('"orientation": "orthogonal"'));
  });
});

describe('selecting a rectangle and moving it about', () => {
  const status = () => screen.getByRole('application', { name: /Tile map/ }).parentElement!.textContent ?? '';

  it('says there is no selection until a corner is marked, and how to make one', () => {
    renderWorkspace();
    expect(status()).toMatch(/No selection\. Press S to mark a corner/);
  });

  it('marks two corners from the keyboard and reports what was selected', () => {
    /* The canvas is reached by keyboard, so a selection has to be makeable
     * there rather than only with a pointer. */
    renderWorkspace();
    fireEvent.keyDown(canvas(), { key: 's' });
    expect(status()).toMatch(/One corner marked at 1,1; move and press S again/);
    fireEvent.keyDown(canvas(), { key: 'ArrowRight' });
    fireEvent.keyDown(canvas(), { key: 'ArrowDown' });
    fireEvent.keyDown(canvas(), { key: 's' });
    expect(status()).toMatch(/Selected 2 by 2 cells, from 1,1 to 2,2/);
  });

  it('copies an area and says what is on the clipboard', () => {
    const props = renderWorkspace();
    fireEvent.keyDown(canvas(), { key: 's' });
    fireEvent.keyDown(canvas(), { key: 'ArrowRight' });
    fireEvent.keyDown(canvas(), { key: 's' });
    fireEvent.keyDown(canvas(), { key: 'c' });
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/Copied 2 by 1 cells/));
    expect(status()).toMatch(/2 by 1 cells are on the clipboard; press V to paste/);
  });

  it('refuses to copy before a rectangle exists, and says how to make one', () => {
    const props = renderWorkspace();
    fireEvent.keyDown(canvas(), { key: 'c' });
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/press S at one corner and S again at the other/));
  });

  it('cuts an area, leaving the empty tile behind', () => {
    const props = renderWorkspace();
    /* Paint something so the cut has something to remove. */
    fireEvent.keyDown(canvas(), { key: 'Enter' });
    fireEvent.keyDown(canvas(), { key: 's' });
    fireEvent.keyDown(canvas(), { key: 's' });
    fireEvent.keyDown(canvas(), { key: 'x' });
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/Cut 1 by 1 cells/));
  });

  it('pastes at the cursor rather than where the copy came from', () => {
    const props = renderWorkspace();
    fireEvent.keyDown(canvas(), { key: 's' });
    fireEvent.keyDown(canvas(), { key: 's' });
    fireEvent.keyDown(canvas(), { key: 'c' });
    fireEvent.keyDown(canvas(), { key: 'ArrowDown' });
    fireEvent.keyDown(canvas(), { key: 'v' });
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/Pasted 1 by 1 cells into .* at 1,2/));
  });

  it('says nothing has been copied rather than pasting nothing', () => {
    const props = renderWorkspace();
    fireEvent.keyDown(canvas(), { key: 'v' });
    expect(props.onNotice).toHaveBeenCalledWith('Nothing has been copied yet.');
  });

  it('clears a selection with Escape', () => {
    renderWorkspace();
    fireEvent.keyDown(canvas(), { key: 's' });
    fireEvent.keyDown(canvas(), { key: 's' });
    expect(status()).toMatch(/Selected 1 by 1 cells/);
    fireEvent.keyDown(canvas(), { key: 'Escape' });
    expect(status()).toMatch(/No selection/);
  });

  it('offers the same operations as visible controls, not only as keys', () => {
    renderWorkspace();
    const tools = screen.getByRole('group', { name: 'Rectangular selection' });
    expect(within(tools).getByRole('button', { name: 'Mark corner' })).toBeEnabled();
    expect(within(tools).getByRole('button', { name: 'Copy area' })).toBeDisabled();
    fireEvent.click(within(tools).getByRole('button', { name: 'Mark corner' }));
    fireEvent.click(within(tools).getByRole('button', { name: 'Mark opposite corner' }));
    expect(within(tools).getByRole('button', { name: 'Copy area' })).toBeEnabled();
  });
});
