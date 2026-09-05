/* Showing artwork the way the machine will, rather than the way the grid does.
 *
 * The editor draws square cells because a grid of cells is square. A BBC Micro
 * does not: every graphics mode paints the same screen with the same 256 lines,
 * so a MODE 5 pixel is four times as wide as a MODE 0 one and a circle drawn in
 * the editor is an oval on the machine.
 *
 * The panel therefore does two things the editor cannot. It draws the artwork
 * at the mode's own pixel shape, and it says which of the colours in use the
 * mode has nowhere to put — leaving those pixels empty rather than substituting
 * something, because a preview that looked right and a build that did not would
 * be worse than being told.
 */
import { useMemo, useState } from 'react';
import { PALETTE_MODES, type PaletteModeId, type ProjectPalette } from '../assets/paletteDocument';
import { previewCells, previewInEveryMode, previewInMode } from '../assets/targetModePreview';

interface TargetModePreviewProps {
  pixels: readonly number[];
  width: number;
  height: number;
  palette: ProjectPalette;
  /** Where a mask says a pixel is transparent, the preview shows it as such. */
  mask?: readonly number[];
  /** The mode the project is aimed at, offered first. */
  preferredMode?: PaletteModeId;
}

/** Wide enough to see the shape, small enough to sit beside the editor. */
const CELL = 6;

export function TargetModePreview({ pixels, width, height, palette, mask, preferredMode }: TargetModePreviewProps) {
  const suitability = useMemo(() => previewInEveryMode(pixels, { width, height }), [pixels, width, height]);
  const [mode, setMode] = useState<PaletteModeId>(preferredMode ?? suitability[0]?.mode ?? 'bbc-mode-5');
  const preview = useMemo(() => previewInMode(pixels, { width, height }, mode), [pixels, width, height, mode]);
  const cells = useMemo(() => previewCells(pixels, { width, height }, mode, palette), [pixels, width, height, mode, palette]);

  return (
    <section className="target-mode-preview" aria-label="How this looks on the machine">
      <div className="panel-heading">
        <div><span className="eyebrow">ON THE MACHINE</span><h3>Target mode preview</h3></div>
      </div>

      <div className="target-mode-choice" role="group" aria-label="Display mode to preview in">
        {PALETTE_MODES.map((profile) => {
          const standing = suitability.find((candidate) => candidate.mode === profile.id);
          return (
            <button
              type="button"
              key={profile.id}
              aria-pressed={mode === profile.id}
              className={mode === profile.id ? 'active' : ''}
              onClick={() => setMode(profile.id)}
            >
              {profile.label}
              <small>{standing?.unrepresentable.length ? `${standing.unrepresentable.length} colours missing` : `${profile.logicalColours} colours`}</small>
            </button>
          );
        })}
      </div>

      <div
        className="target-mode-canvas"
        role="img"
        aria-label={`${preview.modeLabel}: ${width} by ${height} pixels, each ${preview.pixelAspect} times as wide as it is tall relative to the narrowest mode. ${preview.unrepresentable.length ? `${preview.unrepresentable.length} colours in this artwork cannot be shown in this mode.` : 'Every colour in this artwork can be shown in this mode.'}`}
        style={{
          gridTemplateColumns: `repeat(${width}, ${CELL * preview.pixelAspect}px)`,
          gridAutoRows: `${CELL}px`,
        }}
      >
        {cells.map((cell, index) => (
          <span
            key={index}
            className={cell.colour === null ? 'target-mode-cell missing' : mask && mask[index] === 0 ? 'target-mode-cell transparent' : 'target-mode-cell'}
            style={cell.colour !== null && !(mask && mask[index] === 0) ? { background: cell.colour } : undefined}
            title={cell.colour === null ? `Colour ${cell.logical} cannot be shown in ${preview.modeLabel}` : undefined}
          />
        ))}
      </div>

      <dl className="target-mode-facts">
        <div><dt>Pixel shape</dt><dd>{preview.pixelAspect === 1 ? 'square' : `${preview.pixelAspect} times as wide`}</dd></div>
        <div><dt>Screen covered</dt><dd>{preview.screenCoverage.horizontal}% across, {preview.screenCoverage.vertical}% down</dd></div>
        <div><dt>One frame costs</dt><dd>{preview.frameBytes.toLocaleString()} bytes at {preview.bitsPerPixel} bpp</dd></div>
      </dl>

      {preview.notes.map((note) => (
        <p className={preview.unrepresentable.length ? 'dfs-warning' : 'binding-note'} key={note}>{note}</p>
      ))}

      {preview.unrepresentable.length > 0 && (
        <table className="target-mode-missing">
          <caption>Colours this mode has nowhere to put. Those pixels are left empty above rather than substituted.</caption>
          <thead><tr><th scope="col">Logical colour</th><th scope="col">Pixels using it</th></tr></thead>
          <tbody>
            {preview.unrepresentable.map((entry) => (
              <tr key={entry.colour}>
                <th scope="row"><code>{entry.colour}</code></th>
                <td>{entry.pixels.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
