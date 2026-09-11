import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { previewRows, transportForward, transportPause, transportPlay, transportRewind, transportStop, type Transport } from '../assets/songPlayback';
import { browserAudioContext, SongPlayer, type PlayerContext } from '../assets/songPlayer';
import { projectDocuments } from '../project/projectDocuments';
import type { ProjectFile } from '../project/project';
import { Icon } from './Icon';
import {
  clearSongRow, createSongDocument, defaultSidVoice, emptyRow, generateSongOutput, MAX_ROW_DURATION, maximumPitch,
  MIN_ROW_DURATION, MIN_SONG_ROWS, parseSongDocument, serializeSongDocument, setSidVoice, setSongCell, setSongLength,
  SID_VOICES, SID_WAVEFORM_BITS, SONG_TARGETS, songTargetProfile, type SidWaveform, type SongDocument, type SongTarget,
} from '../assets/songDocument';

/** A note number as a musician reads it: C-0 is 0, A-4 is 57. */
function noteName(note: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[note % 12]}-${Math.floor(note / 12)}`;
}

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

  /* Playback: the transport is one state the buttons, the row highlight and
   * the speaker all read. When it starts, or is moved while playing, the
   * rows from that one are scheduled on the audio clock in one go, so the
   * tempo holds even in a window the browser is throttling; a timer only
   * follows the clock to move the highlight and to stop at the end. The
   * browser's audio context is made on the first Play, which is the user
   * action a browser wants before it will make a sound. */
  const [transport, setTransport] = useState<Transport>({ row: 0, playing: false });
  const contextRef = useRef<PlayerContext | null>(null);
  const playerRef = useRef<{ player: SongPlayer; channels: number } | null>(null);
  const runRef = useRef<{ fromRow: number; startTime: number } | null>(null);
  const audioAvailable = typeof (globalThis as { AudioContext?: unknown }).AudioContext === 'function' || typeof (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext === 'function';
  const rows = useMemo(() => previewRows(document), [document]);
  useEffect(() => {
    if (!transport.playing) { runRef.current = null; playerRef.current?.player.silence(); return; }
    const context = contextRef.current ?? browserAudioContext();
    if (!context) { setTransport(transportStop()); onNotice('This browser has no audio output to play the song through'); return; }
    contextRef.current = context;
    if (context.state === 'suspended') void context.resume?.();
    if (!playerRef.current || playerRef.current.channels !== profile.channels) {
      playerRef.current?.player.dispose();
      playerRef.current = { player: new SongPlayer(context, profile.channels), channels: profile.channels };
    }
    if (!rows[transport.row]) { setTransport(transportStop()); return; }
    /* A run is the rows from where playing started or was moved to; the
     * highlight following the clock does not start a new one. */
    const run = runRef.current;
    const expectedRow = run ? rows.findIndex((row) => row.start - rows[run.fromRow]!.start > context.currentTime - run.startTime) - 1 : -1;
    if (!run || (expectedRow >= 0 && expectedRow !== transport.row && Math.abs(expectedRow - transport.row) > 1)) {
      const startTime = context.currentTime + 0.05;
      runRef.current = { fromRow: transport.row, startTime };
      playerRef.current.player.scheduleRows(rows.slice(transport.row), startTime);
    }
    const timer = window.setInterval(() => {
      const current = runRef.current;
      if (!current) return;
      const elapsed = context.currentTime - current.startTime;
      const base = rows[current.fromRow]!.start;
      const reached = rows.findIndex((row) => row.start - base + row.duration > elapsed);
      if (reached < 0) { runRef.current = null; setTransport(transportStop()); return; }
      setTransport((state) => state.playing && state.row !== reached ? { ...state, row: reached } : state);
    }, 60);
    return () => window.clearInterval(timer);
  }, [transport, rows, profile.channels, onNotice]);
  useEffect(() => () => { playerRef.current?.player.dispose(); playerRef.current = null; }, []);
  useEffect(() => { setTransport((state) => state.row >= rows.length ? transportStop() : state); }, [rows.length]);

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
    /* A SID song carries its voices; a song for another chip carries none. */
    const { voices, ...rest } = current;
    const withVoices = target === 'bbc-beebsid' ? { voices: voices ?? Array.from({ length: SID_VOICES }, () => defaultSidVoice()) } : {};
    return parseSongDocument({ ...rest, ...withVoices, target, rows: rows.length ? rows : [emptyRow(target)] });
  }

  return (
    <section className="song-workspace" aria-label="Song editor">
      <header className="song-toolbar" role="group" aria-label="Song tools">
        {!!openable.length && (
          <label className="project-source-picker"><span>From this project</span>
            <select aria-label="Open a song from this project" value="" onChange={(event) => {
              const held = projectFiles.find((file) => file.id === event.target.value);
              if (!held) return;
              guard(() => parseSongDocument(held.content), `${held.name} opened from this project`);
            }}>
              <option value="">Choose a song...</option>
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
          <div className="song-transport" role="group" aria-label="Playback">
            <button type="button" aria-label="Rewind four rows" title="Back four rows" onClick={() => setTransport((state) => transportRewind(state))}>⏮</button>
            <button type="button" aria-label={transport.playing ? 'Pause song' : 'Play song'} title={audioAvailable ? (transport.playing ? 'Pause' : 'Play the song from this row through the browser') : 'This browser has no audio output'} disabled={!audioAvailable} onClick={() => setTransport((state) => state.playing ? transportPause(state) : transportPlay(state, rows.length))}>{transport.playing ? '⏸ Pause' : '▶ Play'}</button>
            <button type="button" aria-label="Stop song" title="Stop, and back to the first row" onClick={() => setTransport(transportStop())}>⏹ Stop</button>
            <button type="button" aria-label="Fast forward four rows" title="On four rows" onClick={() => setTransport((state) => transportForward(state, rows.length))}>⏭</button>
            <span className="song-transport-position" aria-live="polite">Row {transport.row} of {rows.length}{transport.playing ? ' · playing' : ''}</span>
          </div>
          <p className="binding-note">
            {profile.detail}. {document.target === 'atom-speaker'
              ? 'The pitch number is the speaker half-period delay count, not a musical pitch, and volume is only on or off because a one-bit speaker has no volume.'
              : document.target === 'bbc-beebsid'
                ? 'Pitch is a note, C-0 being 0 and A-4 being 57, up to A#-7 at 94, which is where a sixteen-bit frequency register runs out at the 1 MHz clock. Volume is the envelope\'s sustain level, 0 closing the gate; a level that is not zero retriggers the note, so a note held across rows is entered on each.'
              : document.target === 'electron-ula'
                ? "Pitch is the number OSWORD 7 takes, on the machine's own scale of forty-eight units to the octave, and volume is only on or off: a real Electron was measured playing every amplitude from -1 to -5 at exactly the same divider. There is one generator, so a note sent anywhere else would replace this one rather than sound beside it."
                : 'Pitch and volume are the numbers OSWORD 7 takes: volume 0 is silence and 1 to 15 become amplitudes -1 to -15, and channel 0 takes pitches 0 to 7.'}
            {' '}Play auditions the song through the browser's own oscillators on the machine's pitch scale, which is an approximation of the chip; build the song and run it to hear the chip itself.
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
                  <tr key={rowIndex} className={[row.every((cell) => cell.volume === 0) ? 'song-row-silent' : '', transport.playing && rowIndex === transport.row ? 'song-row-playing' : ''].filter(Boolean).join(' ') || undefined} aria-current={transport.playing && rowIndex === transport.row ? 'true' : undefined}>
                    <th scope="row">{rowIndex}</th>
                    {row.map((cell, channel) => (
                      <Fragment key={channel}>
                        <td>
                          <input
                            aria-label={`Row ${rowIndex} ${profile.channelLabels[channel]} pitch`}
                            type="number" min={0} max={maximumPitch(channel, document.target)} value={cell.pitch}
                            onChange={(event) => guard(() => setSongCell(document, rowIndex, channel, { pitch: Number(event.target.value) }))}
                          />
                          {document.target === 'bbc-beebsid' && cell.volume > 0 && <small className="song-note-name">{noteName(cell.pitch)}</small>}
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

        {document.target === 'bbc-beebsid' && document.voices && (
          <section aria-label="Voices">
            <h2>Voices</h2>
            <p className="binding-note">
              Each voice keeps one waveform and one envelope for the whole song. Attack, decay and release are the
              chip's sixteen rates, 0 the fastest; the pulse width is the pulse waveform's duty cycle out of 4,096
              and does nothing for the others. The row's level is the sustain, so it is not set here.
            </p>
            <table className="song-grid">
              <thead><tr><th scope="col">Voice</th><th scope="col">Waveform</th><th scope="col">Pulse width</th><th scope="col">Attack</th><th scope="col">Decay</th><th scope="col">Release</th></tr></thead>
              <tbody>
                {document.voices.map((voice, index) => (
                  <tr key={index}>
                    <th scope="row">{index + 1}</th>
                    <td>
                      <select aria-label={`Voice ${index + 1} waveform`} value={voice.waveform} onChange={(event) => guard(() => setSidVoice(document, index, { waveform: event.target.value as SidWaveform }))}>
                        {(Object.keys(SID_WAVEFORM_BITS) as SidWaveform[]).map((waveform) => <option key={waveform} value={waveform}>{waveform}</option>)}
                      </select>
                    </td>
                    <td><input aria-label={`Voice ${index + 1} pulse width`} type="number" min={0} max={4095} value={voice.pulseWidth} disabled={voice.waveform !== 'pulse'} onChange={(event) => guard(() => setSidVoice(document, index, { pulseWidth: Number(event.target.value) }))} /></td>
                    {(['attack', 'decay', 'release'] as const).map((stage) => (
                      <td key={stage}><input aria-label={`Voice ${index + 1} ${stage}`} type="number" min={0} max={15} value={voice[stage]} onChange={(event) => guard(() => setSidVoice(document, index, { [stage]: Number(event.target.value) }))} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section aria-label="Generated output">
          <h2><Icon name="music" size={13} /> Generated output</h2>
          <dl className="song-manifest">
            <div><dt>Data bytes</dt><dd>{output.manifest.byteLength}</dd></div>
            <div><dt>Rows</dt><dd>{output.manifest.rowCount}</dd></div>
            <div><dt>Silent rows</dt><dd>{output.manifest.silentRows.length}</dd></div>
            <div><dt>SHA-256</dt><dd><code>{output.manifest.sha256.slice(0, 16)}...</code></dd></div>
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
