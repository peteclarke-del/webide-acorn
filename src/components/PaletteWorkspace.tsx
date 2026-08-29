import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import {
  createPaletteDocument, generatePaletteOutput, PALETTE_MODES, paletteModeProfile, parsePaletteDocument,
  physicalColour, resetPalette, resolveProjectPalette, serializePaletteDocument, setPaletteEntry,
  setPaletteMode, type PaletteDocument, type PaletteModeId,
} from '../assets/paletteDocument';

interface PaletteWorkspaceProps {
  /** Every project file, so the workspace can name the palette in use. */
  projectFiles: Array<{ name: string; content: string }>;
  onAddSource: (name: string, content: string) => void;
  onAddLivePalette: (stem: string, content: string) => void;
  onNotice: (message: string) => void;
}

const STORAGE_KEY = '8bit-net-dev:palette';

export function PaletteWorkspace({ projectFiles, onAddSource, onAddLivePalette, onNotice }: PaletteWorkspaceProps) {
  const recovered = useMemo(() => {
    try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) return parsePaletteDocument(saved); }
    catch { /* an invalid recovery starts a new validated document */ }
    return createPaletteDocument();
  }, []);
  const [history, setHistory] = useState<{ past: PaletteDocument[]; present: PaletteDocument }>({ past: [], present: recovered });
  const document = history.present;
  const profile = paletteModeProfile(document.mode);
  const output = useMemo(() => generatePaletteOutput(document), [document]);
  const projectPalette = useMemo(() => resolveProjectPalette(projectFiles, profile.logicalColours), [projectFiles, profile.logicalColours]);

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, serializePaletteDocument(document)); } catch { /* the storage panel reports quota */ } }, [document]);

  const guard = (operation: () => PaletteDocument, message?: string) => {
    try {
      const next = operation();
      setHistory((current) => ({ past: [...current.past, current.present].slice(-100), present: next }));
      if (message) onNotice(message);
    } catch (error) { onNotice(error instanceof Error ? error.message : String(error)); }
  };

  const stem = document.name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'palette';

  return (
    <section className="palette-workspace" aria-label="Palette editor">
      <header className="palette-toolbar">
        <label><span>Name</span><input aria-label="Palette name" value={document.name} onChange={(event) => guard(() => parsePaletteDocument({ ...document, name: event.target.value || 'untitled-palette' }))} /></label>
        <label>
          <span>Display mode</span>
          <select aria-label="Display mode" value={document.mode} onChange={(event) => guard(() => setPaletteMode(document, event.target.value as PaletteModeId))}>
            {PALETTE_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label} · {mode.detail}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => guard(() => resetPalette(document), `${profile.label} restored to its power-up palette`)}>Reset to power-up</button>
        <button type="button" disabled={!history.past.length} onClick={() => setHistory((current) => current.past.length ? { past: current.past.slice(0, -1), present: current.past[current.past.length - 1]! } : current)}>Undo</button>
      </header>

      <div className="palette-body">
        <section aria-label="Logical colours">
          <h2>Logical colours</h2>
          <p className="binding-note">
            {profile.label} has {profile.logicalColours} logical colours at {profile.bitsPerPixel} bits per pixel.
            VDU 19 maps each one onto a physical colour. Eight physical colours are steady and eight flash between a
            colour and its complement; a still preview can only show the first phase, so flashing entries say so.
          </p>
          <table className="palette-table">
            <thead><tr><th scope="col">Logical</th><th scope="col">Preview</th><th scope="col">Physical colour</th></tr></thead>
            <tbody>
              {document.entries.map((physical, logical) => {
                const colour = physicalColour(physical);
                return (
                  <tr key={logical}>
                    <th scope="row">{logical}</th>
                    <td>
                      <span className="palette-swatch" style={{ background: colour.rgb }} aria-hidden="true" />
                      {colour.flashing && <span className="palette-swatch palette-swatch-alternate" style={{ background: colour.alternateRgb }} aria-hidden="true" />}
                      <span className="visually-hidden">{colour.name}</span>
                    </td>
                    <td>
                      <label>
                        <span className="visually-hidden">Physical colour for logical {logical}</span>
                        <select aria-label={`Physical colour for logical ${logical}`} value={physical} onChange={(event) => guard(() => setPaletteEntry(document, logical, Number(event.target.value)))}>
                          {Array.from({ length: 16 }, (_, index) => <option key={index} value={index}>{index} · {physicalColour(index).name}</option>)}
                        </select>
                      </label>
                      {colour.flashing && <small className="binding-warning">This entry flashes on the machine; only its first phase is shown.</small>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section aria-label="Project palette">
          <h2><Icon name="layers" size={13} /> Project palette</h2>
          <p role="status" className="palette-project-status">
            {projectPalette.fileName
              ? `The pixel and map editors preview ${profile.logicalColours}-colour work with ${projectPalette.fileName}.`
              : `This project has no palette document, so the editors preview with the ${profile.label} power-up palette.`}
          </p>
          <div className="palette-strip" aria-label="Colours the editors currently preview with">
            {projectPalette.colours.map((rgb, index) => (
              <span key={index} className="palette-strip-entry">
                <span className="palette-swatch" style={{ background: rgb }} aria-hidden="true" />
                <small>{index}{projectPalette.flashing.includes(index) ? ' flashing' : ''}</small>
              </span>
            ))}
          </div>
          {!projectPalette.fileName && <p className="binding-note">Add this palette to the project to make it the one the editors use.</p>}
        </section>

        <section aria-label="Generated output">
          <h2>Generated output</h2>
          <dl className="palette-manifest">
            <div><dt>VDU bytes</dt><dd>{output.manifest.byteLength}</dd></div>
            <div><dt>Display mode</dt><dd>{output.manifest.displayMode}</dd></div>
            <div><dt>Flashing</dt><dd>{output.manifest.flashingLogicalColours.length ? output.manifest.flashingLogicalColours.join(', ') : 'none'}</dd></div>
            <div><dt>SHA-256</dt><dd><code>{output.manifest.sha256.slice(0, 16)}…</code></dd></div>
          </dl>
          <pre aria-label="Generated palette assembler source">{output.assembly}</pre>
          <pre aria-label="Generated palette BASIC statements">{output.basic}</pre>
          <div className="palette-actions">
            <button type="button" onClick={() => onAddSource(`${stem}.asm`, `${output.assembly}\n`)}>Add generated source</button>
            <button type="button" onClick={() => onAddLivePalette(stem, serializePaletteDocument(document))}>Add live palette build target</button>
          </div>
        </section>
      </div>
    </section>
  );
}
