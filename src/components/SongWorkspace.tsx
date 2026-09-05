import { Fragment, useEffect, useMemo, useState } from 'react';
import { projectDocuments } from '../project/projectDocuments';
import type { ProjectFile } from '../project/project';
import { Icon } from './Icon';
import {
  clearSongRow, createSongDocument, emptyRow, generateSongOutput, MAX_ROW_DURATION, maximumPitch,
  MIN_ROW_DURATION, MIN_SONG_ROWS, parseSongDocument, serializeSongDocument, setSongCell, setSongLength,
  SONG_TARGETS, songTargetProfile, type SongDocument, type SongTarget,
} from '../assets/songDocument';

interface SongWorkspaceProps {
  /** Everything the project holds, so a song already in it can be opened. */
  projectFiles?: readonly ProjectFile[];
  onAddSource: (name: string, content: string) => void;
  onAddLiveSong: (stem: string, content: string) => void;
  onNotice: (message: string) => void;
}

const STORAGE_KEY = '8bit-net-dev:song';

export function SongWorkspace({ projectFiles = [], onAddSource, onAddLiveSong, onNotice }: SongWorkspaceProps) {
  /* A song document the project already holds. Sending somebody to a file
   * dialog to fetch what the product is sitting on is busy work, and after an
   * import it is the only thing they want. */
  const openable = useMemo(() => projectDocuments(projectFiles, ['song']), [projectFiles]);
  const recovered = useMemo(() => {
    try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) return parseSongDocument(saved); }
    catch { /* an invalid recovery starts a new validated document */ }
    return createSongDocument();
  }, []);
  const [history, setHistory] = useState<{ past: SongDocument[]; present: SongDocument }>({ past: [], present: recovered });
  const document = history.present;
  const profile = songTargetProfile(document.target);
  const output = useMemo(() => generateSongOutput(document), [document]);

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, serializeSongDocument(document)); } catch { /* the storage panel reports quota */ } }, [document]);

  const guard = (operation: () => SongDocument, message?: string) => {
    try {
      const next = operation();
      setHistory((current) => ({ past: [...current.past, current.present].slice(-100), present: next }));
      if (message) onNotice(message);
    } catch (error) { onNotice(error instanceof Error ? error.message : String(error)); }
  };

  const stem = document.name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'song';

  /* Switching hardware rebuilds the grid to that machine's real channel count
   * and row limit, so a song can never carry channels the target does not have. */
  function changeTarget(current: SongDocument, target: SongTarget): SongDocument {
    const next = songTargetProfile(target);
    const rows = current.rows.slice(0, next.maxRows).map((row) =>
      Array.from({ length: next.channels }, (_, channel) => {
        const cell = row[channel] ?? emptyRow(target)[0]!;
        return { pitch: Math.min(cell.pitch, maximumPitch(channel, target)), volume: Math.min(cell.volume, next.maxVolume) };
      }));
    return parseSongDocument({ ...current, target, rows: rows.length ? rows : [emptyRow(target)] });
  }

  return (
    <section className="song-workspace" aria-label="Song editor">
      <header className="song-toolbar">
        {!!openable.length && (
          <label className="project-source-picker"><span>From this project</span>
            <select aria-label="Open a song from this project" value="" onChange={(event) => {
              const held = projectFiles.find((file) => file.id === event.target.value);
              if (!held) return;
              guard(() => parseSongDocument(held.content), `${held.name} opened from this project`);
            }}>
              <option value="">Choose a song…</option>
              {openable.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.detail ? ` · ${entry.detail}` : ''}</option>)}
            </select>
          </label>
        )}
        <label><span>Name</span><input aria-label="Song name" value={document.name} onChange={(event) => guard(() => parseSongDocument({ ...document, name: event.target.value || 'untitled-song' }))} /></label>
        <label>
          <span>Sound hardware</span>
          <select aria-label="Sound hardware" value={document.target} onChange={(event) => guard(() => changeTarget(document, event.target.value as SongTarget))}>
            {SONG_TARGETS.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
          </select>
        </label>
        <label><span>Rows</span><input aria-label="Song rows" type="number" min={MIN_SONG_ROWS} max={profile.maxRows} value={document.rows.length} onChange={(event) => guard(() => setSongLength(document, Number(event.target.value) || document.rows.length))} /></label>
        <label><span>Row length</span><input aria-label="Row duration in twentieths of a second" type="number" min={MIN_ROW_DURATION} max={MAX_ROW_DURATION} value={document.rowDuration} onChange={(event) => guard(() => parseSongDocument({ ...document, rowDuration: Number(event.target.value) || document.rowDuration }))} /></label>
        <label><span>Player zero page</span><input aria-label="Player zero-page base" type="number" min={0} max={253} value={document.zeroPageBase} onChange={(event) => guard(() => parseSongDocument({ ...document, zeroPageBase: Number(event.target.value) }))} /></label>
        <button type="button" disabled={!history.past.length} onClick={() => setHistory((current) => current.past.length ? { past: current.past.slice(0, -1), present: current.past[current.past.length - 1]! } : current)}>Undo</button>
      </header>

      <div className="song-body">
        <section aria-label="Pattern">
          <h2>Pattern</h2>
          <p className="binding-note">
            {profile.detail}. {document.target === 'atom-speaker'
              ? 'The pitch number is the speaker half-period delay count, not a musical pitch, and volume is only on or off because a one-bit speaker has no volume.'
              : document.target === 'electron-ula'
                ? 'Pitch is the number OSWORD 7 takes, on the machine\u2019s own scale of forty-eight units to the octave, and volume is only on or off: a real Electron was measured playing every amplitude from \u22121 to \u22125 at exactly the same divider. There is one generator, so a note sent anywhere else would replace this one rather than sound beside it.'
                : 'Pitch and volume are the numbers OSWORD 7 takes: volume 0 is silence and 1 to 15 become amplitudes \u22121 to \u221215, and channel 0 takes pitches 0 to 7.'}
            {' '}Nothing is synthesised here; build the song and run it to hear the real hardware play it.
          </p>
          <div className="song-grid-scroll">
            <table className="song-grid">
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  {profile.channelLabels.map((label) => <th scope="col" key={label} colSpan={2}>{label}</th>)}
                  <th scope="col">Clear</th>
                </tr>
              </thead>
              <tbody>
                {document.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className={row.every((cell) => cell.volume === 0) ? 'song-row-silent' : undefined}>
                    <th scope="row">{rowIndex}</th>
                    {row.map((cell, channel) => (
                      <Fragment key={channel}>
                        <td>
                          <input
                            aria-label={`Row ${rowIndex} ${profile.channelLabels[channel]} pitch`}
                            type="number" min={0} max={maximumPitch(channel, document.target)} value={cell.pitch}
                            onChange={(event) => guard(() => setSongCell(document, rowIndex, channel, { pitch: Number(event.target.value) }))}
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Row ${rowIndex} ${profile.channelLabels[channel]} volume`}
                            type="number" min={0} max={profile.maxVolume} value={cell.volume}
                            onChange={(event) => guard(() => setSongCell(document, rowIndex, channel, { volume: Number(event.target.value) }))}
                          />
                        </td>
                      </Fragment>
                    ))}
                    <td><button type="button" aria-label={`Clear row ${rowIndex}`} onClick={() => guard(() => clearSongRow(document, rowIndex))}>Clear</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-label="Generated output">
          <h2><Icon name="music" size={13} /> Generated output</h2>
          <dl className="song-manifest">
            <div><dt>Data bytes</dt><dd>{output.manifest.byteLength}</dd></div>
            <div><dt>Rows</dt><dd>{output.manifest.rowCount}</dd></div>
            <div><dt>Silent rows</dt><dd>{output.manifest.silentRows.length}</dd></div>
            <div><dt>SHA-256</dt><dd><code>{output.manifest.sha256.slice(0, 16)}…</code></dd></div>
          </dl>
          <p role="status" className="binding-warning">
            The generated player owns zero page &amp;{output.manifest.zeroPage[0]!.toString(16).toUpperCase()} to
            &amp;{output.manifest.zeroPage[2]!.toString(16).toUpperCase()}. Move the base above if your program needs those bytes.
          </p>
          <pre aria-label="Generated song data and player">{output.assembly}</pre>
          <pre aria-label="Generated song BASIC statements">{output.basic || 'REM every row of this song is silent'}</pre>
          <div className="song-actions">
            <button type="button" onClick={() => onAddSource(`${stem}.asm`, `${output.assembly}\n`)}>Add generated source</button>
            <button type="button" onClick={() => onAddLiveSong(stem, serializeSongDocument(document))}>Add live song build target</button>
          </div>
        </section>
      </div>
    </section>
  );
}
