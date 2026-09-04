import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GridSelectionError,
  copySelection,
  describeSelection,
  fillSelection,
  pasteSelection,
  selectionContains,
  type GridClipboard,
  type GridSelection,
} from '../assets/gridSelection';
import { Icon } from './Icon';
import { PanelMenuBar } from './PanelMenuBar';
import {
  addTileMapLayer, createTileMapDocument, fillTileMapArea, generateTileMapOutput, MAX_MAP_DIMENSION,
  MAX_MAP_LAYERS, MAX_OBJECT_PROPERTIES, MIN_MAP_DIMENSION, paintTileMapCell, parseTileMapDocument,
  removeTileMapLayer, removeTileMapObject, resizeTileMap, serializeTileMapDocument, setTileMapTileset,
  upsertTileMapObject, MAX_TILE_PROPERTIES,
  TILE_ATTRIBUTE_FLIP_X, TILE_ATTRIBUTE_FLIP_Y, TILE_ATTRIBUTE_PRIORITY,
  type TileMapDocument, type TileMapLayer, type TileMapObject,
  type TileMapPropertySlot, type TileMapPropertyType,
} from '../assets/tileMapDocument';
import { parsePixelAssetDocument, type PixelAssetDocument } from '../assets/pixelAssetDocument';
import { importImageIntoTileMap } from '../assets/tileMapImageImport';

import type { ProjectPalette } from '../assets/paletteDocument';
import { exportTiledMap, importTiledMap, type TiledImportReport } from '../assets/tiledMapInterchange';

interface TileMapWorkspaceProps {
  /** Colours the project's palette document says the machine will show. */
  projectPalette: ProjectPalette;
  /** Pixel asset documents already in the project, offered as tileset artwork. */
  availableAssets: Array<{ name: string; content: string }>;
  /** Maps the project holds, so one can be opened without a file dialog. */
  availableMaps?: Array<{ id: string; name: string; detail: string; content: string }>;
  onAddSource: (name: string, content: string) => void;
  onAddLiveMap: (stem: string, content: string) => void;
  onNotice: (message: string) => void;
}

const STORAGE_KEY = '8bit-net-dev:tile-map';

/** The colour a tile is mostly made of, for a view with one pixel to spend. */
function dominantColour(pixels: readonly number[]): number {
  const counts = new Map<number, number>();
  for (const pixel of pixels) counts.set(pixel, (counts.get(pixel) ?? 0) + 1);
  let best = 0; let bestCount = -1;
  for (const [colour, count] of counts) if (count > bestCount) { best = colour; bestCount = count; }
  return best;
}

interface History { past: TileMapDocument[]; present: TileMapDocument; future: TileMapDocument[] }

export function TileMapWorkspace({ projectPalette, availableAssets, availableMaps = [], onAddSource, onAddLiveMap, onNotice }: TileMapWorkspaceProps) {
  const recovered = useMemo(() => {
    try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) return parseTileMapDocument(saved); }
    catch { /* an invalid recovery starts a new validated document */ }
    return createTileMapDocument();
  }, []);
  const [history, setHistory] = useState<History>({ past: [], present: recovered, future: [] });
  const [activeLayerId, setActiveLayerId] = useState(recovered.layers[0]!.id);
  const [brush, setBrush] = useState(0);
  /* Painted alongside the index. Zero costs the map nothing, so a project that
   * never touches this generates exactly what it did before attributes existed. */
  const [brushAttribute, setBrushAttribute] = useState(0);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(2);
  /* The two file inputs the Document menu reaches. A menu item cannot itself be
   * a file input, so the inputs wait in the header for one to ask for them. */
  const tiledInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [objectDraft, setObjectDraft] = useState<TileMapObject>();
  const [interchange, setInterchange] = useState<Omit<TiledImportReport, 'document'>>();
  const [imageImport, setImageImport] = useState<{ name: string; notes: string[]; distinctTiles: number; assets: number }>();
  /* Anchored at the first corner, so a selection is made the same way with the
   * keyboard as with a pointer: mark a corner, move, mark the other. */
  const [selectionAnchor, setSelectionAnchor] = useState<{ x: number; y: number }>();
  const [selection, setSelection] = useState<GridSelection>();
  const [clipboard, setClipboard] = useState<GridClipboard>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overviewRef = useRef<HTMLCanvasElement>(null);
  const document = history.present;

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, serializeTileMapDocument(document)); } catch { /* quota is reported by the storage panel */ } }, [document]);
  useEffect(() => { if (!document.layers.some((layer) => layer.id === activeLayerId)) setActiveLayerId(document.layers[0]!.id); }, [document, activeLayerId]);

  const commit = (next: TileMapDocument, message?: string) => {
    setHistory((current) => ({ past: [...current.past, current.present].slice(-100), present: next, future: [] }));
    if (message) onNotice(message);
  };
  const guard = (operation: () => TileMapDocument, message?: string) => {
    try { commit(operation(), message); }
    catch (error) { onNotice(error instanceof Error ? error.message : String(error)); }
  };

  /* Tileset artwork is resolved from the live project, so a tile edited in the
   * pixel editor changes this preview without the map storing any pixels. */
  const tileArtwork = useMemo(() => {
    const resolved = new Map<number, PixelAssetDocument | null>();
    for (const entry of document.tileset) {
      if (!entry.assetFile) { resolved.set(entry.index, null); continue; }
      const file = availableAssets.find((candidate) => candidate.name.toLowerCase() === entry.assetFile!.toLowerCase());
      if (!file) { resolved.set(entry.index, null); continue; }
      try { resolved.set(entry.index, parsePixelAssetDocument(file.content)); }
      catch { resolved.set(entry.index, null); }
    }
    return resolved;
  }, [document.tileset, availableAssets]);

  const output = useMemo(() => generateTileMapOutput(document), [document]);
  const missingArtwork = document.tileset.filter((entry) => entry.assetFile && !availableAssets.some((candidate) => candidate.name.toLowerCase() === entry.assetFile!.toLowerCase()));

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext?.('2d');
    /* Environments without a 2D context still get the structured grid below. */
    if (!canvas || !context) return;
    const cell = document.tileWidth * zoom;
    canvas.width = document.width * cell;
    canvas.height = document.height * cell;
    context.fillStyle = '#101010';
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (const layer of document.layers) {
      if (!layer.visible) continue;
      layer.cells.forEach((tile, index) => {
        if (!tile) return;
        const artwork = tileArtwork.get(tile) ?? null;
        const x = (index % document.width) * cell;
        const y = Math.floor(index / document.width) * cell;
        if (!artwork) {
          /* An index with no resolvable artwork is drawn as an explicit marker
           * rather than an invented picture. */
          context.fillStyle = '#3a3a3a';
          context.fillRect(x, y, cell, cell);
          context.fillStyle = '#9a9a9a';
          context.fillText(String(tile), x + 2, y + cell - 3);
          return;
        }
        const pixelSize = cell / artwork.width;
        artwork.pixels.forEach((colour, pixel) => {
          context.fillStyle = projectPalette.colours[colour & 3] ?? '#000000';
          context.fillRect(x + (pixel % artwork.width) * pixelSize, y + Math.floor(pixel / artwork.width) * pixelSize, pixelSize, pixelSize);
        });
      });
    }
    /* The selection is tinted rather than only outlined, because on a map the
     * cursor outline is already a rectangle and two rectangles in one colour
     * would be one rectangle to anybody looking. */
    if (selection) {
      context.fillStyle = 'rgba(242, 193, 78, 0.28)';
      for (let y = 0; y < document.height; y += 1) {
        for (let x = 0; x < document.width; x += 1) {
          if (selectionContains(selection, x, y)) context.fillRect(x * cell, y * cell, cell, cell);
        }
      }
    }
    if (selectionAnchor) {
      context.strokeStyle = '#6fd08c';
      context.lineWidth = 2;
      context.strokeRect(selectionAnchor.x * cell + 1, selectionAnchor.y * cell + 1, cell - 2, cell - 2);
    }
    context.strokeStyle = '#f2c14e';
    context.lineWidth = 2;
    context.strokeRect(cursor.x * cell + 1, cursor.y * cell + 1, cell - 2, cell - 2);
  }, [document, tileArtwork, zoom, cursor, projectPalette, selection, selectionAnchor]);

  /*
   * The whole map at one pixel per cell, whatever the zoom.
   *
   * A 128 by 128 map at 2x is well past a screen, and the editing canvas can
   * only ever show part of it; without this there is no view that answers
   * "what does the level look like" at all. It is a second view of the same
   * document, never a second copy: it reads the layers directly.
   */
  useEffect(() => {
    const canvas = overviewRef.current;
    const context = canvas?.getContext?.('2d');
    if (!canvas || !context) return;
    canvas.width = document.width;
    canvas.height = document.height;
    context.fillStyle = '#101010';
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (const layer of document.layers) {
      if (!layer.visible) continue;
      layer.cells.forEach((tile, index) => {
        if (!tile) return;
        const artwork = tileArtwork.get(tile) ?? null;
        /* One pixel cannot show a tile, so it shows the tile's commonest
         * colour — and an index with no artwork stays the explicit marker
         * grey rather than being given a colour it does not have. */
        context.fillStyle = artwork ? projectPalette.colours[dominantColour(artwork.pixels) & 3] ?? '#000000' : '#3a3a3a';
        context.fillRect(index % document.width, Math.floor(index / document.width), 1, 1);
      });
    }
    context.strokeStyle = '#f2c14e';
    context.lineWidth = 1;
    context.strokeRect(cursor.x + 0.5, cursor.y + 0.5, 1, 1);
  }, [document, tileArtwork, cursor, projectPalette]);

  /*
   * Decoding happens in the browser, which already knows how; the conversion
   * itself is a pure function so it can be tested without one.
   *
   * The artwork is added to the project here rather than left for somebody to
   * do afterwards: a map pointing at asset files nobody added would generate
   * zero pointers and a diagnostic for every tile.
   */
  const importImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = window.document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser did not provide a 2D canvas to read the image with');
      context.drawImage(bitmap, 0, 0);
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height);
      const stem = (file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'imported') + '-tile';
      const result = importImageIntoTileMap(document, data.data, bitmap.width, bitmap.height, projectPalette.colours, stem.slice(0, 33));
      for (const asset of result.assets) onAddSource(asset.name, asset.content);
      commit(result.document, `Imported ${file.name} as ${result.distinctTiles} tiles. ${result.notes.join(' ')}`);
      setImageImport({ name: file.name, notes: result.notes, distinctTiles: result.distinctTiles, assets: result.assets.length });
    } catch (error) {
      onNotice(`That image was not imported: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const paintAt = (x: number, y: number) => guard(() => paintTileMapCell(document, activeLayerId, x, y, brush, brushAttribute));

  /* The tileset's own length is the bound, so a clipboard from a map with more
   * tiles than this one is refused with the number rather than clamped into
   * whatever happens to be there. */
  const gridOf = (layer: TileMapLayer) => ({
    width: document.width, height: document.height, kind: 'tiles' as const,
    valueLimit: Math.max(1, document.tileset.length + 1),
    cells: layer.cells,
  });

  const markSelectionCorner = (x: number, y: number) => {
    if (!selectionAnchor) { setSelectionAnchor({ x, y }); setSelection(undefined); return; }
    setSelection({ start: selectionAnchor, end: { x, y } });
    setSelectionAnchor(undefined);
  };

  const copyArea = () => {
    if (!selection) { onNotice('Choose a rectangle first: press S at one corner and S again at the other.'); return; }
    try {
      const layer = document.layers.find((candidate) => candidate.id === activeLayerId) ?? document.layers[0]!;
      const copied = copySelection(layer.cells, gridOf(layer), selection);
      setClipboard(copied);
      onNotice(`Copied ${describeSelection(selection)} from ${layer.name}.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const cutArea = () => {
    if (!selection) { onNotice('Choose a rectangle first: press S at one corner and S again at the other.'); return; }
    const layer = document.layers.find((candidate) => candidate.id === activeLayerId) ?? document.layers[0]!;
    try {
      setClipboard(copySelection(layer.cells, gridOf(layer), selection));
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
      return;
    }
    /* Cut leaves the empty tile behind, which is what tile zero is. */
    const cleared = fillSelection(layer.cells, document.width, selection, 0);
    commit({ ...document, layers: document.layers.map((candidate) => candidate.id === layer.id ? { ...candidate, cells: cleared } : candidate) },
      `Cut ${describeSelection(selection)} from ${layer.name}.`);
  };

  const pasteArea = () => {
    if (!clipboard) { onNotice('Nothing has been copied yet.'); return; }
    const layer = document.layers.find((candidate) => candidate.id === activeLayerId) ?? document.layers[0]!;
    try {
      const pasted = pasteSelection(layer.cells, gridOf(layer), clipboard, cursor);
      commit({ ...document, layers: document.layers.map((candidate) => candidate.id === layer.id ? { ...candidate, cells: pasted } : candidate) },
        `Pasted ${clipboard.width} by ${clipboard.height} cells into ${layer.name} at ${cursor.x + 1},${cursor.y + 1}.`);
    } catch (error) {
      /* A refusal here is the point of the shared clipboard: tile indices from
       * a larger tileset would otherwise be written as tiles that do not
       * exist. */
      onNotice(error instanceof GridSelectionError ? error.message : String(error));
    }
  };

  const onCanvasKeyDown = (event: React.KeyboardEvent) => {
    const moves: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      setCursor((current) => ({
        x: Math.min(document.width - 1, Math.max(0, current.x + move[0])),
        y: Math.min(document.height - 1, Math.max(0, current.y + move[1])),
      }));
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); paintAt(cursor.x, cursor.y); return; }
    if (event.key === 'Home') { event.preventDefault(); setCursor((current) => ({ ...current, x: 0 })); return; }
    if (event.key === 'End') { event.preventDefault(); setCursor((current) => ({ ...current, x: document.width - 1 })); return; }
    /* Single letters rather than modifier chords: the canvas is reached by
     * keyboard and a chord here would collide with the browser's own. */
    const key = event.key.toLowerCase();
    if (key === 's') { event.preventDefault(); markSelectionCorner(cursor.x, cursor.y); return; }
    if (key === 'c') { event.preventDefault(); copyArea(); return; }
    if (key === 'x') { event.preventDefault(); cutArea(); return; }
    if (key === 'v') { event.preventDefault(); pasteArea(); return; }
    if (key === 'escape') { event.preventDefault(); setSelection(undefined); setSelectionAnchor(undefined); }
  };

  const activeLayer = document.layers.find((layer) => layer.id === activeLayerId) ?? document.layers[0]!;
  const cursorTile = activeLayer.cells[cursor.y * document.width + cursor.x] ?? 0;
  const cursorEntry = document.tileset.find((entry) => entry.index === cursorTile);
  const cursorDescription = cursorTile === 0
    ? 'empty'
    : `tile ${cursorTile}${cursorEntry?.assetFile ? ` from ${cursorEntry.assetFile}` : ', artwork not chosen'}`;

  const cursorAttribute = activeLayer.attributes?.[cursor.y * document.width + cursor.x] ?? 0;
  const cursorAttributeDescription = [
    (cursorAttribute & TILE_ATTRIBUTE_FLIP_X) ? 'flipped in x' : null,
    (cursorAttribute & TILE_ATTRIBUTE_FLIP_Y) ? 'flipped in y' : null,
    (cursorAttribute & TILE_ATTRIBUTE_PRIORITY) ? 'drawn in front' : null,
  ].filter(Boolean).join(', ');

  /* Edited in place rather than rebuilt, so renaming a slot cannot silently
   * renumber the properties the tiles already carry. */
  const updateSlot = (position: number, slot: TileMapPropertySlot) => guard(() => parseTileMapDocument({
    ...document,
    propertySchema: document.propertySchema.map((candidate, index) => index === position ? slot : candidate),
  }));

  const overviewFilled = document.layers.filter((layer) => layer.visible).reduce((total, layer) => total + layer.cells.filter((cell) => cell !== 0).length, 0);

  const declaredIndices = document.tileset.map((entry) => entry.index);
  const nextIndex = Array.from({ length: 255 }, (_, index) => index + 1).find((index) => !declaredIndices.includes(index));

  const addToProject = () => {
    const stem = document.name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'map';
    onAddLiveMap(stem, serializeTileMapDocument(document));
  };

  return (
    <section className="tile-map-workspace" aria-label="Tile map editor">
      <header className="tile-map-toolbar">
        <div><span className="eyebrow">TILE MAP · SCHEMA 1</span><h2>Map editor</h2></div>
        {/* The document's own actions, in a menu rather than a row: the four
          * imports and exports were spending a quarter of the panel's height on
          * things somebody does once a session, above the map itself. */}
        <PanelMenuBar label="Map actions" menus={[
          { id: 'document', label: 'Document', items: [
            ...availableMaps.map((entry) => ({
              id: `open-${entry.id}`,
              label: entry.name.replace(/\.map\.json$/i, ''),
              icon: 'file' as const,
              description: `Open ${entry.name} from this project`,
              hint: entry.detail,
              onSelect: () => { guard(() => parseTileMapDocument(entry.content)); onNotice(`${entry.name} opened from this project`); },
            })),
            { id: 'import-tiled', label: 'Import Tiled…', icon: 'open', description: 'Read a Tiled JSON map, reporting whatever it holds that this editor cannot', separated: !!availableMaps.length, onSelect: () => tiledInputRef.current?.click() },
            { id: 'import-image', label: 'Import image…', icon: 'image', description: 'Cut an image into tiles and lay them out as a map, counting what the conversion lost', onSelect: () => imageInputRef.current?.click() },
            { id: 'export-tiled', label: 'Export Tiled', icon: 'download', description: 'Write this map into the project as a Tiled JSON document', hint: 'tiled.json', separated: true, onSelect: () => onAddSource(`${document.name.replace(/[^A-Za-z0-9_-]+/g, '-') || 'map'}.tiled.json`, exportTiledMap(document)) },
          ] },
          { id: 'edit', label: 'Edit', items: [
            { id: 'undo', label: 'Undo', icon: 'reset', description: 'Undo the last change to this map', disabled: !history.past.length, onSelect: () => setHistory((current) => current.past.length ? { past: current.past.slice(0, -1), present: current.past[current.past.length - 1]!, future: [current.present, ...current.future].slice(0, 100) } : current) },
            { id: 'redo', label: 'Redo', description: 'Redo the change that was undone', disabled: !history.future.length, onSelect: () => setHistory((current) => current.future.length ? { past: [...current.past, current.present].slice(-100), present: current.future[0]!, future: current.future.slice(1) } : current) },
            { id: 'copy-area', label: 'Copy area', description: 'Copy the marked rectangle of cells', disabled: !selection, separated: true, onSelect: copyArea },
            { id: 'cut-area', label: 'Cut area', description: 'Copy the marked rectangle and clear it', disabled: !selection, onSelect: cutArea },
            { id: 'paste-area', label: 'Paste', description: 'Paste the copied cells at the keyboard cursor', disabled: !clipboard, onSelect: pasteArea },
            { id: 'clear-selection', label: 'Deselect', description: 'Forget the marked rectangle', disabled: !selection && !selectionAnchor, onSelect: () => { setSelection(undefined); setSelectionAnchor(undefined); } },
          ] },
        ]} />
        {/* Marking a corner and the magnification stay on the surface: both are
          * things somebody reaches for while working on the map. */}
        <div className="map-selection-tools" role="group" aria-label="Rectangular selection">
          <button type="button" aria-pressed={!!selectionAnchor} onClick={() => markSelectionCorner(cursor.x, cursor.y)}>
            {selectionAnchor ? 'Mark opposite corner' : 'Mark corner'}
          </button>
        </div>
        <label><span>Zoom</span><select aria-label="Map zoom" value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>{[1, 2, 3, 4].map((level) => <option key={level} value={level}>{level}×</option>)}</select></label>
        {/* Reached from the Document menu; a file input cannot be a menu item,
          * so it waits here for one to ask for it. */}
        <input ref={tiledInputRef} type="file" accept=".json,application/json" aria-label="Import a Tiled JSON map" hidden onChange={(event) => {
              const file = event.target.files?.[0]; event.target.value = '';
              if (!file) return;
              void file.text().then((text) => {
                try {
                  const report = importTiledMap(text, file.name);
                  const { document: imported, ...rest } = report;
                  commit(imported, `Imported ${file.name}: ${rest.unsupported.length} unsupported feature${rest.unsupported.length === 1 ? '' : 's'} and ${rest.adjustments.length} adjustment${rest.adjustments.length === 1 ? '' : 's'} are listed below.`);
                  setInterchange(rest);
                } catch (error) { onNotice(`That Tiled map was not imported: ${error instanceof Error ? error.message : String(error)}`); }
              });
            }} />
        <input ref={imageInputRef} type="file" accept="image/*" aria-label="Import an image as tiles" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void importImage(file); }} />
      </header>

      <div className="tile-map-body">
        <div className="tile-map-canvas-column">
          <div
            className="tile-map-canvas"
            role="application"
            aria-label={`Tile map ${document.name}, ${document.width} by ${document.height} tiles`}
            aria-describedby="tile-map-cursor"
            tabIndex={0}
            onKeyDown={onCanvasKeyDown}
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              const cell = document.tileWidth * zoom;
              const x = Math.floor((event.clientX - bounds.left) / cell);
              const y = Math.floor((event.clientY - bounds.top) / cell);
              if (x < 0 || y < 0 || x >= document.width || y >= document.height) return;
              setCursor({ x, y });
              paintAt(x, y);
            }}
          >
            <canvas ref={canvasRef} aria-hidden="true" />
          </div>
          <p id="tile-map-cursor" role="status" className="tile-map-cursor-status">
            Row {cursor.y + 1} of {document.height}, column {cursor.x + 1} of {document.width}, {cursorDescription} on layer {activeLayer.name}.
            {selection ? ` Selected ${describeSelection(selection)}.` : selectionAnchor ? ` One corner marked at ${selectionAnchor.x + 1},${selectionAnchor.y + 1}; move and press S again.` : ' No selection. Press S to mark a corner.'}
            {clipboard ? ` ${clipboard.width} by ${clipboard.height} cells are on the clipboard; press V to paste at the cursor.` : ''}
            Move with the arrow keys and paint with Enter.
            {projectPalette.fileName ? ` Previewed with ${projectPalette.fileName}.` : ' Previewed with the MODE 5 power-up palette.'}
          </p>
          <div className="tile-map-row-view" aria-label="Tile indices on the current row">
            <strong>Row {cursor.y + 1}</strong>
            <code>{activeLayer.cells.slice(cursor.y * document.width, cursor.y * document.width + document.width).join(' ')}</code>
          </div>
        </div>

        <div className="tile-map-side">
          <section aria-label="Map document">
            <h2>Document</h2>
            <div className="tile-map-document">
        <label><span>Name</span><input aria-label="Map name" value={document.name} onChange={(event) => guard(() => parseTileMapDocument({ ...document, name: event.target.value || 'untitled-map' }))} /></label>
        <label><span>Width</span><input aria-label="Map width in tiles" type="number" min={MIN_MAP_DIMENSION} max={MAX_MAP_DIMENSION} value={document.width} onChange={(event) => guard(() => resizeTileMap(document, Number(event.target.value) || document.width, document.height))} /></label>
        <label><span>Height</span><input aria-label="Map height in tiles" type="number" min={MIN_MAP_DIMENSION} max={MAX_MAP_DIMENSION} value={document.height} onChange={(event) => guard(() => resizeTileMap(document, document.width, Number(event.target.value) || document.height))} /></label>
            </div>
          </section>
          <section aria-label="Brush">
            <h2>Brush</h2>
            <div className="tile-map-brushes">
              <button type="button" className={brush === 0 ? 'active' : undefined} aria-pressed={brush === 0} onClick={() => setBrush(0)}>Empty</button>
              {document.tileset.map((entry) => (
                <button key={entry.index} type="button" className={brush === entry.index ? 'active' : undefined} aria-pressed={brush === entry.index} onClick={() => setBrush(entry.index)}>
                  {entry.index}{entry.assetFile ? '' : ' ?'}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => guard(() => fillTileMapArea(document, activeLayerId, 0, 0, document.width, document.height, brush, brushAttribute), `Filled ${activeLayer.name} with ${brush === 0 ? 'the empty tile' : `tile ${brush}`}`)}>Fill layer</button>
            <fieldset className="tile-map-attributes">
              <legend>Painted with</legend>
              {([
                [TILE_ATTRIBUTE_FLIP_X, 'Flip in x'],
                [TILE_ATTRIBUTE_FLIP_Y, 'Flip in y'],
                [TILE_ATTRIBUTE_PRIORITY, 'Draw in front'],
              ] as const).map(([bit, caption]) => (
                <label key={bit}>
                  <input
                    type="checkbox" aria-label={caption}
                    checked={(brushAttribute & bit) !== 0}
                    onChange={(event) => setBrushAttribute(event.target.checked ? brushAttribute | bit : brushAttribute & ~bit)}
                  />
                  <span>{caption}</span>
                </label>
              ))}
              <small className="binding-note">
                {output.manifest.attributePlanes
                  ? `${output.manifest.cellsWithAttributes.toLocaleString()} cells carry an attribute, so every layer generates a plane of them.`
                  : 'No cell carries one, so no attribute plane is generated at all.'}
              </small>
            </fieldset>
            <p className="binding-note">The cell under the cursor: {cursorAttribute ? cursorAttributeDescription : 'no attribute'}.</p>
          </section>

          <section aria-label="Layers">
            <h2>Layers</h2>
            <ul className="tile-map-layers">
              {document.layers.map((layer) => (
                <li key={layer.id}>
                  <label>
                    <input type="radio" name="tile-map-layer" checked={layer.id === activeLayerId} onChange={() => setActiveLayerId(layer.id)} aria-label={`Edit layer ${layer.name}`} />
                    <span>{layer.name}</span>
                  </label>
                  <label className="tile-map-visible">
                    <input type="checkbox" checked={layer.visible} aria-label={`Show layer ${layer.name}`} onChange={(event) => guard(() => parseTileMapDocument({ ...document, layers: document.layers.map((candidate) => candidate.id === layer.id ? { ...candidate, visible: event.target.checked } : candidate) }))} />
                    <span>Visible</span>
                  </label>
                  <button type="button" aria-label={`Remove layer ${layer.name}`} disabled={document.layers.length === 1} onClick={() => guard(() => removeTileMapLayer(document, layer.id))}>Remove</button>
                </li>
              ))}
            </ul>
            <button type="button" disabled={document.layers.length >= MAX_MAP_LAYERS} onClick={() => guard(() => addTileMapLayer(document))}>Add layer</button>
          </section>

          <section aria-label="Tileset">
            <h2>Tileset</h2>
            <p className="binding-note">
              Each index names a pixel asset already in this project. Index 0 is always the empty tile, and an index
              with no artwork chosen is generated as a zero pointer and reported by the build.
            </p>
            <ul className="tile-map-tileset">
              {document.tileset.map((entry) => (
                <li key={entry.index}>
                  <strong>{entry.index}</strong>
                  <label>
                    <span className="visually-hidden">Artwork for tile {entry.index}</span>
                    <select
                      aria-label={`Artwork for tile ${entry.index}`}
                      value={entry.assetFile ?? ''}
                      onChange={(event) => guard(() => setTileMapTileset(document, document.tileset.map((candidate) => candidate.index === entry.index ? { ...candidate, assetFile: event.target.value || null } : candidate)))}
                    >
                      <option value="">Not chosen yet</option>
                      {availableAssets.map((asset) => <option key={asset.name} value={asset.name}>{asset.name}</option>)}
                    </select>
                  </label>
                  <label className="tile-map-properties">
                    <span>Properties</span>
                    <input
                      aria-label={`Properties for tile ${entry.index}`}
                      value={entry.properties.join(', ')}
                      placeholder="0, 255"
                      onChange={(event) => guard(() => setTileMapTileset(document, document.tileset.map((candidate) => candidate.index === entry.index
                        ? { ...candidate, properties: event.target.value.split(',').map((item) => Number(item.trim())).filter((item) => Number.isFinite(item)).slice(0, MAX_TILE_PROPERTIES) }
                        : candidate)))}
                    />
                  </label>
                  <small className="binding-note">{(output.manifest.tileUsage.find((usage) => usage.index === entry.index)?.cells ?? 0).toLocaleString()} cells</small>
                  <button type="button" aria-label={`Remove tile ${entry.index}`} onClick={() => guard(() => setTileMapTileset(document, document.tileset.filter((candidate) => candidate.index !== entry.index)), `Tile ${entry.index} removed; painted cells using it were cleared`)}>Remove</button>
                </li>
              ))}
            </ul>
            <button type="button" disabled={nextIndex === undefined} onClick={() => nextIndex !== undefined && guard(() => setTileMapTileset(document, [...document.tileset, { index: nextIndex, assetFile: null }]))}>Declare tile {nextIndex ?? ''}</button>
            {!availableAssets.length && <p className="binding-warning">This project has no pixel asset documents yet. Create one in the Tiles workspace and add it to the project first.</p>}
            {!!output.manifest.duplicateArtwork.length && <p className="binding-warning">{output.manifest.duplicateArtwork.map((group) => `Tiles ${group.indices.join(' and ')} both draw ${group.assetFile}; they can be merged into one index.`).join(' ')}</p>}
            {!!missingArtwork.length && <p className="binding-warning">{missingArtwork.map((entry) => `Tile ${entry.index} names ${entry.assetFile}, which is not in this project.`).join(' ')}</p>}
          </section>

          <section aria-label="Whole map overview">
            <h2>The whole map</h2>
            <canvas
              ref={overviewRef} className="tile-map-overview"
              aria-label={`Overview of ${document.name}, ${document.width} by ${document.height} tiles, one pixel per tile`}
              style={{ width: `${Math.min(240, document.width * 2)}px`, imageRendering: 'pixelated' }}
              onClick={(event) => {
                /* Clicking the overview moves the editing cursor there, which
                 * is the only way to reach the far side of a large map without
                 * scrolling to it. */
                const bounds = event.currentTarget.getBoundingClientRect();
                if (!bounds.width || !bounds.height) return;
                setCursor({
                  x: Math.max(0, Math.min(document.width - 1, Math.floor((event.clientX - bounds.left) * document.width / bounds.width))),
                  y: Math.max(0, Math.min(document.height - 1, Math.floor((event.clientY - bounds.top) * document.height / bounds.height))),
                });
              }}
            />
            <p className="binding-note">
              {document.width * document.height} cells, {overviewFilled.toLocaleString()} of them painted on the visible layers.
              The editing canvas above shows {Math.min(document.width, Math.ceil(720 / (document.tileWidth * zoom)))} columns at this zoom.
            </p>
          </section>

          <section aria-label="Tile property schema">
            <h2>What a property byte means</h2>
            <p className="binding-note">
              Untyped, a property is a column of numbers whose meaning lives in somebody's head, and a
              flag set to 2 reads as deliberate. A declared slot gives the generated source a name and
              a range, and a value the slot cannot hold is refused where it is written.
            </p>
            <ul className="tile-map-property-schema">
              {document.propertySchema.map((slot, position) => (
                <li key={position}>
                  <label>
                    <span>Name</span>
                    <input
                      aria-label={`Property slot ${position + 1} name`} value={slot.name}
                      onChange={(event) => updateSlot(position, { ...slot, name: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Type</span>
                    <select
                      aria-label={`Property slot ${position + 1} type`} value={slot.type}
                      onChange={(event) => {
                        const type = event.target.value as TileMapPropertyType;
                        updateSlot(position, type === 'enum'
                          ? { name: slot.name, type, values: slot.values ?? ['first', 'second'] }
                          : { name: slot.name, type });
                      }}
                    >
                      <option value="flag">flag · 0 or 1</option>
                      <option value="byte">byte · 0 to 255</option>
                      <option value="enum">enum · a named choice</option>
                    </select>
                  </label>
                  {slot.type === 'enum' && (
                    <label>
                      <span>Values</span>
                      <input
                        aria-label={`Property slot ${position + 1} values`} value={(slot.values ?? []).join(', ')}
                        onChange={(event) => updateSlot(position, { ...slot, values: event.target.value.split(',').map((entry) => entry.trim()).filter(Boolean) })}
                      />
                    </label>
                  )}
                  <button type="button" aria-label={`Remove property slot ${position + 1}`} onClick={() => guard(() => parseTileMapDocument({ ...document, propertySchema: document.propertySchema.filter((_, index) => index !== position) }))}>Remove</button>
                </li>
              ))}
            </ul>
            <button
              type="button" disabled={document.propertySchema.length >= MAX_TILE_PROPERTIES}
              onClick={() => guard(() => parseTileMapDocument({ ...document, propertySchema: [...document.propertySchema, { name: `property${document.propertySchema.length + 1}`, type: 'byte' as const }] }))}
            >Declare a property</button>
            {!document.propertySchema.length && <p className="binding-note">Nothing is declared, so the property bytes are generated as raw numbers, exactly as they were before this existed.</p>}
          </section>

          <section aria-label="Storage">
            <h2>How the map is stored</h2>
            <label>
              <span>Planes</span>
              <select
                aria-label="Map plane encoding" value={document.encoding}
                onChange={(event) => guard(() => parseTileMapDocument({ ...document, encoding: event.target.value }))}
              >
                <option value="raw">Raw · one byte per cell</option>
                <option value="rle">Run-length encoded</option>
              </select>
            </label>
            {document.encoding === 'rle' && (
              <label>
                <span>Unpacker zero page</span>
                <input
                  aria-label="Unpacker first zero-page byte" value={`&${document.unpackZeroPage.toString(16).toUpperCase().padStart(2, '0')}`}
                  onChange={(event) => guard(() => parseTileMapDocument({ ...document, unpackZeroPage: Number.parseInt(event.target.value.replace(/^&/, ''), 16) }))}
                />
              </label>
            )}
            {/* Announced when it changes, but not a second `status` landmark:
              * this workspace already has one for the cell under the cursor,
              * and two would be one region to anybody navigating by role. */}
            <p className={output.manifest.encodingRequested === 'rle' && output.manifest.encoding === 'raw' ? 'binding-warning' : 'binding-note'} aria-live="polite">
              {output.manifest.encoding === 'rle'
                ? `Compressed: ${output.manifest.rawPlaneBytes.toLocaleString()} bytes of cells in ${output.manifest.compressedPlaneBytes.toLocaleString()}. The generated source carries an unpacker that claims seven zero-page bytes.`
                : output.manifest.encodingRequested === 'rle'
                  ? `Run-length encoding was asked for and declined: it would take ${output.manifest.compressedPlaneBytes.toLocaleString()} bytes against ${output.manifest.rawPlaneBytes.toLocaleString()} raw. Emitting a larger file because a setting was ticked helps nobody, so the planes are raw and the header says so.`
                  : `Raw: ${output.manifest.rawPlaneBytes.toLocaleString()} bytes of cells, read directly with no unpacking.`}
            </p>
          </section>

          <section aria-label="Objects">
            <h2>Objects</h2>
            <ul className="tile-map-objects">
              {document.objects.map((object) => (
                <li key={object.id}>
                  <strong>{object.name}</strong>
                  <span>{object.kind} at {object.x},{object.y}{object.kind === 'region' ? ` size ${object.width}×${object.height}` : ''}{object.properties.length ? ` · properties ${object.properties.join(', ')}` : ''}</span>
                  <button type="button" aria-label={`Edit object ${object.name}`} onClick={() => setObjectDraft(object)}>Edit</button>
                  <button type="button" aria-label={`Remove object ${object.name}`} onClick={() => guard(() => removeTileMapObject(document, object.id))}>Remove</button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setObjectDraft({ id: `object-${document.objects.length + 1}`, name: `Object ${document.objects.length + 1}`, kind: 'point', x: cursor.x, y: cursor.y, width: 1, height: 1, properties: [] })}>Add object at cursor</button>
            {objectDraft && (
              <div className="tile-map-object-draft">
                <label><span>Name</span><input aria-label="Object name" value={objectDraft.name} onChange={(event) => setObjectDraft({ ...objectDraft, name: event.target.value })} /></label>
                <label><span>Kind</span><select aria-label="Object kind" value={objectDraft.kind} onChange={(event) => setObjectDraft({ ...objectDraft, kind: event.target.value as TileMapObject['kind'], width: 1, height: 1 })}><option value="point">point</option><option value="region">region</option></select></label>
                <label><span>X</span><input aria-label="Object column" type="number" value={objectDraft.x} onChange={(event) => setObjectDraft({ ...objectDraft, x: Number(event.target.value) })} /></label>
                <label><span>Y</span><input aria-label="Object row" type="number" value={objectDraft.y} onChange={(event) => setObjectDraft({ ...objectDraft, y: Number(event.target.value) })} /></label>
                {objectDraft.kind === 'region' && <>
                  <label><span>W</span><input aria-label="Object width" type="number" value={objectDraft.width} onChange={(event) => setObjectDraft({ ...objectDraft, width: Number(event.target.value) })} /></label>
                  <label><span>H</span><input aria-label="Object height" type="number" value={objectDraft.height} onChange={(event) => setObjectDraft({ ...objectDraft, height: Number(event.target.value) })} /></label>
                </>}
                <label><span>Properties</span><input aria-label="Object properties" value={objectDraft.properties.join(', ')} placeholder="0, 255" onChange={(event) => setObjectDraft({ ...objectDraft, properties: event.target.value.split(',').map((item) => Number(item.trim())).filter((item) => Number.isFinite(item)).slice(0, MAX_OBJECT_PROPERTIES) })} /></label>
                <button type="button" onClick={() => { guard(() => upsertTileMapObject(document, objectDraft)); setObjectDraft(undefined); }}>Save object</button>
                <button type="button" onClick={() => setObjectDraft(undefined)}>Cancel</button>
              </div>
            )}
          </section>

          {imageImport && (
            <section aria-label="Image import report">
              <h2>Imported from an image</h2>
              <p className="binding-note">
                {imageImport.name} became {imageImport.distinctTiles} distinct tiles, and {imageImport.assets} pixel asset
                document{imageImport.assets === 1 ? ' was' : 's were'} added to the project so the map's artwork exists.
              </p>
              <ul className="tile-map-report">{imageImport.notes.map((note) => <li key={note}>{note}</li>)}</ul>
              <button type="button" onClick={() => setImageImport(undefined)}>Dismiss report</button>
            </section>
          )}

          {interchange && (
            <section aria-label="Interchange report">
              <h2>Imported from Tiled</h2>
              <p className="binding-note">{interchange.licenceNotice}</p>
              {interchange.unsupported.length ? (
                <>
                  <strong>Not represented in this build</strong>
                  <ul className="tile-map-report">{interchange.unsupported.map((entry) => <li className="binding-warning" key={entry}>{entry}</li>)}</ul>
                </>
              ) : <p className="binding-note">Everything that file carried is represented here.</p>}
              {!!interchange.adjustments.length && <>
                <strong>Changed to fit this build</strong>
                <ul className="tile-map-report">{interchange.adjustments.map((entry) => <li key={entry}>{entry}</li>)}</ul>
              </>}
              <button type="button" onClick={() => setInterchange(undefined)}>Dismiss report</button>
            </section>
          )}

          <section aria-label="Generated output">
            <h2><Icon name="layers" size={13} /> Generated output</h2>
            <dl className="tile-map-manifest">
              <div><dt>Data bytes</dt><dd>{output.manifest.byteLength.toLocaleString()}</dd></div>
              <div><dt>Layers</dt><dd>{output.manifest.layerCount}</dd></div>
              <div><dt>Objects</dt><dd>{output.manifest.objectCount}</dd></div>
              <div><dt>Property stride</dt><dd>{output.manifest.propertyStride}</dd></div>
              <div><dt>SHA-256</dt><dd><code>{output.manifest.sha256.slice(0, 16)}…</code></dd></div>
            </dl>
            {!!output.manifest.unassignedIndices.length && <p className="binding-warning">Indices {output.manifest.unassignedIndices.join(', ')} have no artwork chosen; their pointers generate as zero.</p>}
            <pre aria-label="Generated map assembler source">{output.assembly}</pre>
            <div className="tile-map-actions">
              <button type="button" onClick={() => onAddSource(`${document.name.replace(/[^A-Za-z0-9_-]+/g, '-') || 'map'}.asm`, `${output.assembly}\n`)}>Add generated source</button>
              <button type="button" onClick={addToProject}>Add live map build target</button>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
