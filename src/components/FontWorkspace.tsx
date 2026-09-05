import { useEffect, useMemo, useState } from 'react';
import { projectDocuments } from '../project/projectDocuments';
import type { ProjectFile } from '../project/project';
import { Icon } from './Icon';
import {
  addGlyph, clearGlyph, createFontDocument, FIRST_DEFINABLE_CODE, FIRST_RESERVED_UDG_CODE,
  generateFontOutput, glyphAt, glyphPixels, LAST_DEFINABLE_CODE, parseFontDocument, previewCharacters,
  removeGlyph, serializeFontDocument, setGlyphPixel, setSampleText, transformGlyph,
  type FontDocument, type GlyphTransform,
} from '../assets/fontDocument';
import type { ProjectPalette } from '../assets/paletteDocument';

interface FontWorkspaceProps {
  /** Everything the project holds, so a font already in it can be opened. */
  projectFiles?: readonly ProjectFile[];
  /** Colours the project's palette says the machine will show. */
  projectPalette: ProjectPalette;
  onAddSource: (name: string, content: string) => void;
  onAddLiveFont: (stem: string, content: string) => void;
  onNotice: (message: string) => void;
}

const STORAGE_KEY = '8bit-net-dev:font';

const TRANSFORMS: Array<{ id: GlyphTransform; label: string }> = [
  { id: 'flip-horizontal', label: 'Flip across' },
  { id: 'flip-vertical', label: 'Flip down' },
  { id: 'rotate-right', label: 'Rotate right' },
  { id: 'invert', label: 'Invert' },
  { id: 'shift-left', label: 'Shift left' },
  { id: 'shift-right', label: 'Shift right' },
  { id: 'shift-up', label: 'Shift up' },
  { id: 'shift-down', label: 'Shift down' },
];

export function FontWorkspace({ projectPalette, projectFiles = [], onAddSource, onAddLiveFont, onNotice }: FontWorkspaceProps) {
  /* A font document the project already holds. Sending somebody to a file
   * dialog to fetch what the product is sitting on is busy work, and after an
   * import it is the only thing they want. */
  const openable = useMemo(() => projectDocuments(projectFiles, ['font']), [projectFiles]);
  const recovered = useMemo(() => {
    try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) return parseFontDocument(saved); }
    catch { /* an invalid recovery starts a new validated document */ }
    return createFontDocument();
  }, []);
  const [history, setHistory] = useState<{ past: FontDocument[]; present: FontDocument }>({ past: [], present: recovered });
  const [activeCode, setActiveCode] = useState(recovered.glyphs[0]!.code);
  const [newCode, setNewCode] = useState(String(FIRST_RESERVED_UDG_CODE + 1));
  const document = history.present;

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, serializeFontDocument(document)); } catch { /* the storage panel reports quota */ } }, [document]);
  useEffect(() => { if (!glyphAt(document, activeCode)) setActiveCode(document.glyphs[0]!.code); }, [document, activeCode]);

  const guard = (operation: () => FontDocument, message?: string) => {
    try {
      const next = operation();
      setHistory((current) => ({ past: [...current.past, current.present].slice(-100), present: next }));
      if (message) onNotice(message);
    } catch (error) { onNotice(error instanceof Error ? error.message : String(error)); }
  };

  const glyph = glyphAt(document, activeCode) ?? document.glyphs[0]!;
  const pixels = glyphPixels(glyph);
  const output = useMemo(() => generateFontOutput(document), [document]);
  const preview = useMemo(() => previewCharacters(document), [document]);
  const undefinedCodes = [...new Set(preview.filter((entry) => !entry.pixels).map((entry) => entry.code))];
  const ink = projectPalette.colours[1] ?? '#ffffff';
  const paper = projectPalette.colours[0] ?? '#000000';
  const stem = document.name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'font';

  return (
    <section className="font-workspace" aria-label="Character set editor">
      <header className="font-toolbar">
        {!!openable.length && (
          <label className="project-source-picker"><span>From this project</span>
            <select aria-label="Open a font from this project" value="" onChange={(event) => {
              const held = projectFiles.find((file) => file.id === event.target.value);
              if (!held) return;
              guard(() => parseFontDocument(held.content), `${held.name} opened from this project`);
            }}>
              <option value="">Choose a font…</option>
              {openable.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.detail ? ` · ${entry.detail}` : ''}</option>)}
            </select>
          </label>
        )}
        <label><span>Name</span><input aria-label="Font name" value={document.name} onChange={(event) => guard(() => parseFontDocument({ ...document, name: event.target.value || 'untitled-font' }))} /></label>
        <label>
          <span>Editing</span>
          <select aria-label="Character being edited" value={activeCode} onChange={(event) => setActiveCode(Number(event.target.value))}>
            {document.glyphs.map((candidate) => <option key={candidate.code} value={candidate.code}>{candidate.code}{candidate.code >= FIRST_RESERVED_UDG_CODE ? '' : ' (outside the reserved range)'}</option>)}
          </select>
        </label>
        <label><span>Add code</span><input aria-label="Character code to add" type="number" min={FIRST_DEFINABLE_CODE} max={LAST_DEFINABLE_CODE} value={newCode} onChange={(event) => setNewCode(event.target.value)} /></label>
        <button type="button" onClick={() => guard(() => addGlyph(document, Number(newCode)), `Character ${newCode} added`)}>Add character</button>
        <button type="button" onClick={() => guard(() => removeGlyph(document, activeCode))}>Remove character</button>
        <button type="button" onClick={() => guard(() => clearGlyph(document, activeCode))}>Clear</button>
        <button type="button" disabled={!history.past.length} onClick={() => setHistory((current) => current.past.length ? { past: current.past.slice(0, -1), present: current.past[current.past.length - 1]! } : current)}>Undo</button>
      </header>

      <div className="font-body">
        <section aria-label="Character grid">
          <h2>Character {glyph.code}</h2>
          <div className="font-grid" role="grid" data-essential-target-size="A cell in this grid is one pixel of the artwork. Enlarging it past the artwork would change what the editor edits, so WCAG 2.2 AA 2.5.8 is met by its essential exception. The surrounding tools are full-size targets." aria-label={`Pixels of character ${glyph.code}`} style={{ background: paper }}>
            {pixels.map((on, index) => {
              const x = index % 8; const y = Math.floor(index / 8);
              return (
                <button
                  key={index}
                  type="button"
                  role="gridcell"
                  aria-label={`Row ${y + 1} column ${x + 1}, ${on ? 'set' : 'clear'}`}
                  aria-pressed={on}
                  style={{ background: on ? ink : paper }}
                  onClick={() => guard(() => setGlyphPixel(document, glyph.code, x, y, !on))}
                />
              );
            })}
          </div>
          <div className="font-rows" aria-label="Row bytes of the current character">
            {glyph.rows.map((row, index) => (
              <code key={index}>{index}: &amp;{row.toString(16).toUpperCase().padStart(2, '0')} {row.toString(2).padStart(8, '0').replaceAll('0', '.').replaceAll('1', '#')}</code>
            ))}
          </div>
          <div className="font-transforms">
            {TRANSFORMS.map((transform) => (
              <button key={transform.id} type="button" onClick={() => guard(() => transformGlyph(document, glyph.code, transform.id))}>{transform.label}</button>
            ))}
          </div>
        </section>

        <section aria-label="Text preview">
          <h2><Icon name="terminal" size={13} /> Text preview</h2>
          <label className="font-sample">
            <span>Sample text</span>
            <input aria-label="Sample text" value={document.sampleText} onChange={(event) => guard(() => setSampleText(document, event.target.value))} />
          </label>
          <div className="font-preview" aria-label="Sample text drawn with this character set" style={{ background: paper }}>
            {preview.map((entry, index) => entry.pixels ? (
              <span className="font-preview-glyph" key={index} role="img" aria-label={`Character ${entry.code}`}>
                {entry.pixels.map((on, pixel) => <i key={pixel} style={{ background: on ? ink : paper }} />)}
              </span>
            ) : (
              <span className="font-preview-missing" key={index} title={`Character ${entry.code} is not defined by this font`}>{entry.code}</span>
            ))}
          </div>
          <p className="binding-note">
            Only the characters this font defines can be drawn. This build does not ship the machine's own character
            ROM, so a code the font does not define is shown as its number rather than a stand-in shape.
          </p>
          {!!undefinedCodes.length && <p role="status" className="binding-warning">The sample uses {undefinedCodes.length} code{undefinedCodes.length === 1 ? '' : 's'} this font does not define: {undefinedCodes.join(', ')}.</p>}
          <p className="binding-note">
            {projectPalette.fileName ? `Drawn with logical colours 0 and 1 of ${projectPalette.fileName}.` : 'Drawn with logical colours 0 and 1 of the MODE 5 power-up palette.'}
          </p>
        </section>

        <section aria-label="Generated output">
          <h2>Generated output</h2>
          <dl className="font-manifest">
            <div><dt>Characters</dt><dd>{output.manifest.glyphCount}</dd></div>
            <div><dt>VDU bytes</dt><dd>{output.manifest.byteLength}</dd></div>
            <div><dt>SHA-256</dt><dd><code>{output.manifest.sha256.slice(0, 16)}…</code></dd></div>
          </dl>
          {!!output.manifest.codesOutsideReservedRange.length && (
            <p className="binding-warning">
              Codes {output.manifest.codesOutsideReservedRange.join(', ')} are outside 224 to 255. Redefining them
              works but claims extra character-definition memory on the real machine.
            </p>
          )}
          <pre aria-label="Generated font assembler source">{output.assembly}</pre>
          <pre aria-label="Generated font BASIC statements">{output.basic}</pre>
          <div className="font-actions">
            <button type="button" onClick={() => onAddSource(`${stem}.asm`, `${output.assembly}\n`)}>Add generated source</button>
            <button type="button" onClick={() => onAddLiveFont(stem, serializeFontDocument(document))}>Add live font build target</button>
          </div>
        </section>
      </div>
    </section>
  );
}
