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

describe('TileMapWorkspace attributes, property schema, storage and overview', () => {
  const declareTile = () => fireEvent.click(screen.getByRole('button', { name: /Declare tile 1/ }));

  it('paints a flip and a priority alongside the index, and says what the cursor carries', () => {
    renderWorkspace();
    declareTile();
    fireEvent.click(screen.getByRole('button', { name: '1 ?' }));
    fireEvent.click(screen.getByLabelText('Flip in x'));
    fireEvent.click(screen.getByLabelText('Draw in front'));
    fireEvent.keyDown(canvas(), { key: ' ' });
    expect(stored().layers[0]!.attributes?.[0]).toBe(5);
    expect(screen.getByText(/The cell under the cursor: flipped in x, drawn in front/)).toBeInTheDocument();
  });

  it('says plainly when no cell carries an attribute, so nothing is generated for them', () => {
    renderWorkspace();
    expect(screen.getByText(/No cell carries one, so no attribute plane is generated at all/)).toBeInTheDocument();
  });

  it('declares a typed property and refuses a value the type cannot hold', () => {
    const props = renderWorkspace();
    declareTile();
    fireEvent.click(screen.getByRole('button', { name: 'Declare a property' }));
    fireEvent.change(screen.getByLabelText('Property slot 1 name'), { target: { value: 'solid' } });
    fireEvent.change(screen.getByLabelText('Property slot 1 type'), { target: { value: 'flag' } });
    fireEvent.change(screen.getByLabelText('Properties for tile 1'), { target: { value: '2' } });
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/solid is a flag, so it is 0 or 1, not 2/));
    /* And the map is left as it was rather than half-edited. */
    expect(stored().tileset[0]!.properties).toEqual([]);
    fireEvent.change(screen.getByLabelText('Properties for tile 1'), { target: { value: '1' } });
    expect(stored().tileset[0]!.properties).toEqual([1]);
    expect(screen.getByLabelText('Generated map assembler source').textContent).toContain('_prop_solid = 0 ; flag');
  });

  it('offers named values for an enum and generates a constant for each', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Declare a property' }));
    fireEvent.change(screen.getByLabelText('Property slot 1 name'), { target: { value: 'terrain' } });
    fireEvent.change(screen.getByLabelText('Property slot 1 type'), { target: { value: 'enum' } });
    fireEvent.change(screen.getByLabelText('Property slot 1 values'), { target: { value: 'grass, water, stone' } });
    const generated = screen.getByLabelText('Generated map assembler source').textContent ?? '';
    expect(generated).toContain('_prop_terrain_water = 1');
    expect(generated).toContain('_prop_terrain_stone = 2');
  });

  it('says that compression was asked for and declined, rather than emitting a larger map', () => {
    renderWorkspace();
    declareTile();
    fireEvent.click(screen.getByRole('button', { name: '1 ?' }));
    /* A default map is empty, which compresses well; painting alternating
     * cells is what makes the encoding genuinely worse than raw. */
    /* Shrunk to a size a keyboard can fill, then every other cell painted, so
     * no two neighbours are alike and the encoding is strictly worse than raw. */
    fireEvent.change(screen.getByLabelText('Map width in tiles'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Map height in tiles'), { target: { value: '2' } });
    for (let cell = 0; cell < 8; cell += 1) {
      if (cell % 2 === 0) fireEvent.keyDown(canvas(), { key: ' ' });
      fireEvent.keyDown(canvas(), { key: cell % 4 === 3 ? 'ArrowDown' : 'ArrowRight' });
      if (cell % 4 === 3) for (let back = 0; back < 3; back += 1) fireEvent.keyDown(canvas(), { key: 'ArrowLeft' });
    }
    fireEvent.change(screen.getByLabelText('Map plane encoding'), { target: { value: 'rle' } });
    expect(stored().encoding).toBe('rle');
    expect(screen.getByLabelText('Generated map assembler source').textContent).toMatch(/asked for and declined/);
  });

  it('compresses a map that repeats, and generates the unpacker with the zero page it was given', () => {
    renderWorkspace();
    declareTile();
    fireEvent.click(screen.getByRole('button', { name: '1 ?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fill layer' }));
    fireEvent.change(screen.getByLabelText('Map plane encoding'), { target: { value: 'rle' } });
    fireEvent.change(screen.getByLabelText('Unpacker first zero-page byte'), { target: { value: '&90' } });
    const generated = screen.getByLabelText('Generated map assembler source').textContent ?? '';
    expect(generated).toContain('_unpack_source = &90');
    expect(within(screen.getByRole('region', { name: 'Storage' })).getByText(/bytes of cells in/)).toBeInTheDocument();
  });

  it('shows the whole map and moves the cursor to a place the editing canvas cannot reach', () => {
    /* The point of the overview: a large map does not fit the editing canvas
     * at any useful zoom, so without this there is no view of the level. */
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Map width in tiles'), { target: { value: '120' } });
    const overview = screen.getByLabelText(/Overview of .*120 by 16 tiles, one pixel per tile/);
    overview.getBoundingClientRect = () => ({ left: 0, top: 0, width: 240, height: 32, right: 240, bottom: 32, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.click(overview, { clientX: 238, clientY: 30 });
    expect(screen.getByRole('status')).toHaveTextContent(/Row 16 of 16, column 120 of 120/);
  });
});

describe('TileMapWorkspace image import', () => {
  /* jsdom has no image decoder, so the browser's two decoding calls are stood
   * in for. Everything the conversion itself does is contracted against the
   * real function in tileMapImageImport.test.ts; what is under test here is
   * that the workspace adds the artwork, replaces the map and reports what was
   * lost — the parts a pure function cannot check. */
  function stubImageDecoding(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const [r, g, b] = pixel(x, y);
        const offset = (y * width + x) * 4;
        data[offset] = r; data[offset + 1] = g; data[offset + 2] = b; data[offset + 3] = 255;
      }
    }
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width, height })));
    /* One stub serves every canvas in the workspace, so it carries the drawing
     * calls the map and overview effects make as well; jsdom returns null for
     * all of them otherwise and those effects simply do not run. */
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => ({ data, width, height }),
      fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
      fillStyle: '', strokeStyle: '', lineWidth: 0,
    } as unknown as CanvasRenderingContext2D);
  }

  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const file = (name = 'level.png') => new File([new Uint8Array([1])], name, { type: 'image/png' });

  it('adds a pixel asset document per distinct tile, so the map is not left pointing at nothing', () => {
    /* Two by two tiles, each one of the project palette's own four colours, so
     * the quantiser has no reason to collapse any two of them together. */
    const colours = resolveProjectPalette([], 4).colours.slice(0, 4).map((colour) => [
      Number.parseInt(colour.slice(1, 3), 16), Number.parseInt(colour.slice(3, 5), 16), Number.parseInt(colour.slice(5, 7), 16),
    ] as [number, number, number]);
    stubImageDecoding(16, 16, (x, y) => colours[Math.floor(y / 8) * 2 + Math.floor(x / 8)]!);
    const props = renderWorkspace();
    fireEvent.change(screen.getByLabelText('Import an image as tiles'), { target: { files: [file()] } });

    return waitFor(() => {
      expect(props.onAddSource).toHaveBeenCalledTimes(4);
      expect(vi.mocked(props.onAddSource).mock.calls.map((call) => call[0])).toEqual([
        'level-tile-1.asset.json', 'level-tile-2.asset.json', 'level-tile-3.asset.json', 'level-tile-4.asset.json',
      ]);
      const document = stored();
      expect(document.width).toBe(2);
      expect(document.height).toBe(2);
      expect(document.layers[0]!.cells).toEqual([1, 2, 3, 4]);
      expect(document.tileset.every((entry) => entry.assetFile !== null)).toBe(true);
    });
  });

  it('reports what the conversion lost rather than presenting it as faithful', () => {
    stubImageDecoding(16, 16, () => [136, 51, 34]);
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Import an image as tiles'), { target: { files: [file('Odd Name.png')] } });

    return waitFor(() => {
      const report = within(screen.getByRole('region', { name: 'Image import report' }));
      expect(report.getByText(/pixels were not one of the 4 palette colours/)).toBeInTheDocument();
      expect(report.getByText(/became 1 distinct tiles/)).toBeInTheDocument();
    });
  });

  it('says why an image could not be imported and leaves the map alone', () => {
    stubImageDecoding(4, 4, () => [0, 0, 0]);
    const props = renderWorkspace();
    const before = stored();
    fireEvent.change(screen.getByLabelText('Import an image as tiles'), { target: { files: [file()] } });

    return waitFor(() => {
      expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/smaller than one 8 by 8 tile/));
      expect(stored()).toEqual(before);
      expect(props.onAddSource).not.toHaveBeenCalled();
    });
  });
});
