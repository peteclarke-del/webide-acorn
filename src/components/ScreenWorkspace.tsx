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
import { readableInk } from '../theme/readableInk';
import { Icon } from './Icon';
import { PanelMenuBar } from './PanelMenuBar';
import { projectDocuments } from '../project/projectDocuments';
import type { ProjectFile } from '../project/project';
import {
  createScreenDocument, generateScreenOutputFromBytes, importImageIntoScreen, parseScreenDocument,
  readScreenPixel, screenBytes, screenDocumentFromBytes, screenGeometry, serializeScreenDocument,
  setScreenMode, writeScreenPixel, type ScreenDocument,
} from '../assets/screenDocument';
import { PALETTE_MODES, paletteModeProfile, physicalColour, type PaletteModeId, type ProjectPalette } from '../assets/paletteDocument';

interface ScreenWorkspaceProps {
  projectPalette: ProjectPalette;
  /** Everything the project holds, so a screen already in it can be opened. */
  projectFiles?: readonly ProjectFile[];
  onAddSource: (name: string, content: string) => void;
  onAddLiveScreen: (stem: string, content: string) => void;
  onNotice: (message: string) => void;
}

const STORAGE_KEY = '8bit-net-dev:screen';

export function ScreenWorkspace({ projectPalette, projectFiles = [], onAddSource, onAddLiveScreen, onNotice }: ScreenWorkspaceProps) {
  /* A screen recovered from an imported game, or generated earlier, is in the
   * project already; sending somebody to a file dialog to fetch what the
   * product is holding is busy work. */
  const openable = useMemo(() => projectDocuments(projectFiles, ['screen']), [projectFiles]);
  const recovered = useMemo(() => {
    try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) return parseScreenDocument(saved); }
    catch { /* an invalid recovery starts a new validated document */ }
    return createScreenDocument();
  }, []);
  /* The working state is the decoded frame buffer, not a document. Painting a
   * pixel would otherwise base64 encode and decode a whole screen, which is
   * several milliseconds per keystroke in the larger modes. The document is
   * built only when one is actually needed. */
  const [screen, setScreen] = useState<{ name: string; mode: ScreenDocument['mode']; bytes: Uint8Array; revision: number }>(
    () => ({ name: recovered.name, mode: recovered.mode, bytes: screenBytes(recovered), revision: 0 }));
  const [past, setPast] = useState<Array<{ name: string; mode: ScreenDocument['mode']; bytes: Uint8Array }>>([]);
  const [colour, setColour] = useState(1);
  const [zoom, setZoom] = useState(2);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [selectionAnchor, setSelectionAnchor] = useState<{ x: number; y: number }>();
  const [selection, setSelection] = useState<GridSelection>();
  const [clipboard, setClipboard] = useState<GridClipboard>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /* Reached from the Document menu, since a menu item cannot be a file input. */
  const imageInputRef = useRef<HTMLInputElement>(null);
  const geometry = screenGeometry(screen.mode);
  const bytes = screen.bytes;
  const document = useMemo(() => screenDocumentFromBytes(screen.name, screen.mode, screen.bytes), [screen]);

  /* A mode's own colour count decides how many palette colours are meaningful,
   * so the strip is resolved for that depth rather than assumed to be four. */
  const modeColours = useMemo(() => Array.from({ length: geometry.logicalColours }, (_, index) =>
    projectPalette.document
      ? physicalColour(projectPalette.document.entries[index] ?? index).rgb
      : projectPalette.colours[index] ?? physicalColour(index).rgb), [geometry.logicalColours, projectPalette]);

  /* Persisting a whole screen is also an encode, so it is debounced rather than
   * run on every painted pixel. */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, serializeScreenDocument(document)); } catch { /* the storage panel reports quota */ }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [document]);
  useEffect(() => { if (colour >= geometry.logicalColours) setColour(0); }, [colour, geometry.logicalColours]);

  const remember = () => setPast((current) => [...current, { name: screen.name, mode: screen.mode, bytes: screen.bytes.slice() }].slice(-20));

  const commitDocument = (next: ScreenDocument, message?: string) => {
    remember();
    setScreen((current) => ({ name: next.name, mode: next.mode, bytes: screenBytes(next), revision: current.revision + 1 }));
    if (message) onNotice(message);
  };
  const guard = (operation: () => ScreenDocument, message?: string) => {
    try { commitDocument(operation(), message); }
    catch (error) { onNotice(error instanceof Error ? error.message : String(error)); }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext?.('2d');
    /* Without a 2D context the picture cannot be drawn; the cursor readout and
     * the generated bytes below still describe the screen exactly. */
    if (!canvas || !context) return;
    canvas.width = geometry.width * zoom;
    canvas.height = geometry.height * zoom;
    /* One image write beats a fill per pixel: MODE 0 is over 160,000 pixels. */
    const rgba = modeColours.map((entry) => [
      Number.parseInt(entry.slice(1, 3), 16), Number.parseInt(entry.slice(3, 5), 16), Number.parseInt(entry.slice(5, 7), 16),
    ] as const);
    const image = context.createImageData?.(canvas.width, canvas.height);
    if (image) {
      for (let y = 0; y < geometry.height; y += 1) {
        for (let x = 0; x < geometry.width; x += 1) {
          const [red, green, blue] = rgba[readScreenPixel(bytes, geometry, x, y)] ?? [0, 0, 0];
          for (let row = 0; row < zoom; row += 1) {
            let offset = ((y * zoom + row) * canvas.width + x * zoom) * 4;
            for (let column = 0; column < zoom; column += 1) {
              image.data[offset] = red!; image.data[offset + 1] = green!; image.data[offset + 2] = blue!; image.data[offset + 3] = 255;
              offset += 4;
            }
          }
        }
      }
      context.putImageData(image, 0, 0);
    }
    context.strokeStyle = '#f2c14e';
    context.lineWidth = 1;
    if (selection) {
      context.fillStyle = 'rgba(242, 193, 78, 0.28)';
      for (let y = 0; y < geometry.height; y += 1) {
        for (let x = 0; x < geometry.width; x += 1) {
          if (selectionContains(selection, x, y)) context.fillRect(x * zoom, y * zoom, zoom, zoom);
        }
      }
    }
    if (selectionAnchor) {
      context.strokeStyle = '#6fd08c';
      context.strokeRect(selectionAnchor.x * zoom - 1, selectionAnchor.y * zoom - 1, zoom + 2, zoom + 2);
    }
    context.strokeRect(cursor.x * zoom - 1, cursor.y * zoom - 1, zoom + 2, zoom + 2);
  }, [bytes, geometry, zoom, cursor, modeColours, selection, selectionAnchor]);

  const paintAt = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= geometry.width || y >= geometry.height) { onNotice('That pixel is outside the screen'); return; }
    remember();
    setScreen((current) => {
      const next = current.bytes.slice();
      writeScreenPixel(next, geometry, x, y, colour);
      return { ...current, bytes: next, revision: current.revision + 1 };
    });
  };

  /* The frame buffer is packed, so a selection works on the pixels the mode
   * shows rather than on the bytes behind them: the same rectangle means the
   * same picture whatever the depth. */
  const gridOf = () => ({ width: geometry.width, height: geometry.height, kind: 'screen' as const, valueLimit: geometry.logicalColours });
  const readPixels = () => Array.from({ length: geometry.width * geometry.height }, (_, index) =>
    readScreenPixel(bytes, geometry, index % geometry.width, Math.floor(index / geometry.width)));
  const writePixels = (values: number[], message: string) => {
    remember();
    setScreen((current) => {
      const next = current.bytes.slice();
      values.forEach((value, index) => writeScreenPixel(next, geometry, index % geometry.width, Math.floor(index / geometry.width), value));
      return { ...current, bytes: next, revision: current.revision + 1 };
    });
    onNotice(message);
  };

  const markSelectionCorner = (x: number, y: number) => {
    if (!selectionAnchor) { setSelectionAnchor({ x, y }); setSelection(undefined); return; }
    setSelection({ start: selectionAnchor, end: { x, y } });
    setSelectionAnchor(undefined);
  };

  const copyArea = () => {
    if (!selection) { onNotice('Choose a rectangle first: press S at one corner and S again at the other.'); return; }
    try {
      setClipboard(copySelection(readPixels(), gridOf(), selection));
      onNotice(`Copied ${describeSelection(selection)}.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : String(error)); }
  };

  const cutArea = () => {
    if (!selection) { onNotice('Choose a rectangle first: press S at one corner and S again at the other.'); return; }
    try {
      const pixels = readPixels();
      setClipboard(copySelection(pixels, gridOf(), selection));
      writePixels(fillSelection(pixels, geometry.width, selection, 0), `Cut ${describeSelection(selection)} to logical colour 0.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : String(error)); }
  };

  const pasteArea = () => {
    if (!clipboard) { onNotice('Nothing has been copied yet.'); return; }
    try {
      writePixels(pasteSelection(readPixels(), gridOf(), clipboard, cursor),
        `Pasted ${clipboard.width} by ${clipboard.height} pixels at ${cursor.x + 1},${cursor.y + 1}.`);
    } catch (error) {
      /* The refusal that matters here: artwork copied in a sixteen-colour mode
       * cannot be written into a four-colour one without either losing colours
       * or writing values the mode has no room for. */
      onNotice(error instanceof GridSelectionError ? error.message : String(error));
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const moves: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      const step = event.shiftKey ? 8 : 1;
      setCursor((current) => ({
        x: Math.min(geometry.width - 1, Math.max(0, current.x + move[0] * step)),
        y: Math.min(geometry.height - 1, Math.max(0, current.y + move[1] * step)),
      }));
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); paintAt(cursor.x, cursor.y); return; }
    const key = event.key.toLowerCase();
    if (key === 's') { event.preventDefault(); markSelectionCorner(cursor.x, cursor.y); return; }
    if (key === 'c') { event.preventDefault(); copyArea(); return; }
    if (key === 'x') { event.preventDefault(); cutArea(); return; }
    if (key === 'v') { event.preventDefault(); pasteArea(); return; }
    if (key === 'escape') { event.preventDefault(); setSelection(undefined); setSelectionAnchor(undefined); }
  };

  const changeMode = (mode: PaletteModeId) => {
    try {
      const result = setScreenMode(document, mode);
      commitDocument(result.document);
      onNotice(result.clampedColours || result.changedPixels
        ? `Converted to ${paletteModeProfile(mode).label}: ${result.changedPixels.toLocaleString()} pixels resampled and ${result.clampedColours.toLocaleString()} clamped to the new colour range.`
        : `Converted to ${paletteModeProfile(mode).label} with no pixel or colour change.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : String(error)); }
  };

  const importImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const scratch = window.document.createElement('canvas');
      scratch.width = bitmap.width; scratch.height = bitmap.height;
      const context = scratch.getContext('2d');
      if (!context) { onNotice('This browser did not provide a 2D context, so the image could not be read.'); return; }
      context.drawImage(bitmap, 0, 0);
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height);
      const result = importImageIntoScreen(document, data.data, bitmap.width, bitmap.height, modeColours);
      commitDocument(result.document);
      onNotice(`Imported ${file.name}: ${result.sourceColours.toLocaleString()} source colours, ${result.approximatedPixels.toLocaleString()} pixels approximated to the nearest palette colour${result.croppedPixels ? `, ${result.croppedPixels.toLocaleString()} pixels cropped` : ''}.`);
    } catch (error) { onNotice(`That image could not be imported: ${error instanceof Error ? error.message : String(error)}`); }
  };

  const output = useMemo(() => generateScreenOutputFromBytes(screen.name, screen.mode, screen.bytes), [screen]);
  const cursorColour = readScreenPixel(bytes, geometry, cursor.x, cursor.y);
  const stem = document.name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'screen';

  return (
    <section className="screen-workspace" aria-label="Screen editor">
      <header className="screen-toolbar">
        <div><span className="eyebrow">SCREEN · SCHEMA 1</span><h2>Screen editor</h2></div>
        {/* The same reasoning as the map and the sprite editors: the actions
          * somebody takes once a session were spending a quarter of the panel's
          * height above the picture they act on. */}
        <PanelMenuBar label="Screen actions" menus={[
          { id: 'document', label: 'Document', items: [
            ...openable.map((entry) => ({
              id: `open-${entry.id}`,
              label: `Open ${entry.name}`,
              hint: entry.detail,
              onSelect: () => {
                const held = projectFiles.find((file) => file.id === entry.id);
                if (!held) { onNotice(`${entry.name} is no longer in this project`); return; }
                guard(() => parseScreenDocument(held.content), `${entry.name} opened from this project`);
              },
            })),
            { id: 'import-image', label: 'Import an image', hint: 'converted to this mode', separated: !!openable.length, onSelect: () => imageInputRef.current?.click() },
          ] },
          { id: 'edit', label: 'Edit', items: [
            { id: 'undo', label: 'Undo', disabled: !past.length, onSelect: () => {
          const previous = past[past.length - 1];
          if (!previous) return;
          setPast((current) => current.slice(0, -1));
          setScreen((current) => ({ ...previous, bytes: previous.bytes.slice(), revision: current.revision + 1 }));
        } },
            { id: 'fill', label: 'Fill screen with the chosen colour', separated: true, onSelect: () => {
          remember();
          setScreen((current) => {
            const next = new Uint8Array(geometry.byteLength);
            for (let pixel = 0; pixel < geometry.pixelsPerByte; pixel += 1) writeScreenPixel(next, geometry, pixel, 0, colour);
            next.fill(next[0]!);
            return { ...current, bytes: next, revision: current.revision + 1 };
          });
          onNotice(`Screen filled with logical colour ${colour}`);
        } },
            { id: 'copy-area', label: 'Copy area', disabled: !selection, separated: true, onSelect: copyArea },
            { id: 'cut-area', label: 'Cut area', disabled: !selection, onSelect: cutArea },
            { id: 'paste-area', label: 'Paste at cursor', disabled: !clipboard, onSelect: pasteArea },
            { id: 'clear-selection', label: 'Clear selection', disabled: !selection && !selectionAnchor, onSelect: () => { setSelection(undefined); setSelectionAnchor(undefined); } },
          ] },
        ]} />
        <div className="map-selection-tools" role="group" aria-label="Rectangular selection">
          <button type="button" aria-pressed={!!selectionAnchor} onClick={() => markSelectionCorner(cursor.x, cursor.y)}>
            {selectionAnchor ? 'Mark opposite corner' : 'Mark corner'}
          </button>
        </div>
        <label><span>Zoom</span><select aria-label="Screen zoom" value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>{[1, 2, 3].map((level) => <option key={level} value={level}>{level}×</option>)}</select></label>
        <input ref={imageInputRef} type="file" accept="image/*" aria-label="Import an image" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void importImage(file); }} />
      </header>

      <div className="screen-body">
        <div className="screen-canvas-column">
          <div
            className="screen-canvas"
            role="application"
            aria-label={`Screen ${document.name}, ${geometry.width} by ${geometry.height} pixels`}
            aria-describedby="screen-cursor"
            tabIndex={0}
            onKeyDown={onKeyDown}
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              const x = Math.floor((event.clientX - bounds.left) / zoom);
              const y = Math.floor((event.clientY - bounds.top) / zoom);
              if (x < 0 || y < 0 || x >= geometry.width || y >= geometry.height) return;
              setCursor({ x, y });
              paintAt(x, y);
            }}
          >
            <canvas ref={canvasRef} aria-hidden="true" />
          </div>
          <p id="screen-cursor" role="status" className="screen-cursor-status">
            Pixel {cursor.x + 1}, {cursor.y + 1} of {geometry.width} by {geometry.height} is logical colour {cursorColour}.
            {selection ? ` Selected ${describeSelection(selection)}.` : selectionAnchor ? ` One corner marked at ${selectionAnchor.x + 1},${selectionAnchor.y + 1}; move and press S again.` : ' No selection. Press S to mark a corner.'}
            {clipboard ? ` ${clipboard.width} by ${clipboard.height} pixels are on the clipboard; press V to paste at the cursor.` : ''}
            Move with the arrow keys, eight pixels at a time with Shift, and paint with Enter.
          </p>
        </div>

        <div className="screen-side">
          <section aria-label="Screen document">
            <h2>Document</h2>
            <div className="screen-document">
        <label><span>Name</span><input aria-label="Screen name" value={document.name} onChange={(event) => guard(() => parseScreenDocument({ ...document, name: event.target.value || 'untitled-screen' }))} /></label>
        <label>
          <span>Display mode</span>
          <select aria-label="Display mode" value={document.mode} onChange={(event) => changeMode(event.target.value as PaletteModeId)}>
            {PALETTE_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label} · {mode.detail}</option>)}
          </select>
        </label>
            </div>
          </section>
          <section aria-label="Logical colour">
            <h2>Logical colour</h2>
            <div className="screen-colours" role="radiogroup" aria-label="Logical colour">
              {modeColours.map((rgb, index) => (
                <button
                  key={index}
                  type="button"
                  role="radio"
                  aria-checked={colour === index}
                  aria-label={`Logical colour ${index}`}
                  className={colour === index ? 'selected' : undefined}
                  style={{ background: rgb, color: readableInk(rgb).ink, textShadow: 'none' }}
                  onClick={() => setColour(index)}
                >{index}</button>
              ))}
            </div>
            <p className="binding-note">
              {projectPalette.fileName ? `Previewed with ${projectPalette.fileName}.` : 'Previewed with the power-up palette; add a palette document to change it.'}
              {projectPalette.flashing.length ? ` Colours ${projectPalette.flashing.join(', ')} flash on the machine and only their first phase is shown.` : ''}
            </p>
          </section>

          <section aria-label="Generated output">
            <h2><Icon name="layers" size={13} /> Generated output</h2>
            <dl className="screen-manifest">
              <div><dt>Frame buffer</dt><dd>{output.manifest.byteLength.toLocaleString()} bytes</dd></div>
              <div><dt>Resolution</dt><dd>{output.manifest.width}×{output.manifest.height}</dd></div>
              <div><dt>Depth</dt><dd>{output.manifest.bitsPerPixel} bpp</dd></div>
              <div><dt>Colours used</dt><dd>{output.manifest.usedColours.join(', ')}</dd></div>
              <div><dt>SHA-256</dt><dd><code>{output.manifest.sha256.slice(0, 16)}…</code></dd></div>
            </dl>
            <p className="binding-note">
              The generated bytes are the frame buffer in hardware block order, ready to copy to screen memory. They
              do not include the mode change or the palette; generate those from the palette document.
            </p>
            <div className="screen-actions">
              <button type="button" onClick={() => onAddSource(`${stem}.asm`, `${output.assembly}\n`)}>Add generated source</button>
              <button type="button" onClick={() => onAddLiveScreen(stem, serializeScreenDocument(document))}>Add live screen build target</button>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
