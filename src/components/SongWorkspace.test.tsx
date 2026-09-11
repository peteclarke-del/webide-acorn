import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SongWorkspace } from './SongWorkspace';
import { createSongDocument, parseSongDocument, serializeSongDocument } from '../assets/songDocument';

afterEach(() => { cleanup(); localStorage.clear(); });

function renderWorkspace(projectFiles: ReturnType<typeof projectHolding> = []) {
  const props = { projectFiles, onAddSource: vi.fn(), onAddLiveSong: vi.fn(), onNotice: vi.fn() };
  render(<SongWorkspace {...props} />);
  return props;
}

/* A project holding one of these documents, so the editor can be asked whether
 * it offers what the person already has. */
function projectHolding(name: string, content: string) {
  return [{
    id: name, name, content, language: 'text' as const, encoding: 'utf-8' as const, lineEnding: 'lf' as const,
    modified: false, saved: true, savedName: name, savedContent: content,
    savedEncoding: 'utf-8' as const, savedLineEnding: 'lf' as const, kind: 'authored' as const, access: 'editable' as const,
  }];
}
const stored = () => parseSongDocument(localStorage.getItem('8bit-net-dev:song')!);

describe('SongWorkspace', () => {
  it('plays the song row by row from the transport, highlights the row, and stops, rewinds and fast forwards', () => {
    /* A browser audio context that records rather than sounds. */
    const started: string[] = [];
    const clock = { now: 0 };
    class FakeAudioContext {
      get currentTime() { return clock.now; }
      sampleRate = 8000; destination = 'speaker'; state = 'running';
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
      createOscillator() { started.push('oscillator'); const param = { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }; return { type: 'sine', frequency: param, connect() {}, disconnect() {}, start() {}, stop() {} }; }
      createGain() { const param = { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }; return { gain: param, connect() {}, disconnect() {} }; }
      createBuffer(_c: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
      createBufferSource() { return { buffer: null, loop: false, connect() {}, disconnect() {}, start() {}, stop() {} }; }
    }
    (globalThis as { AudioContext?: unknown }).AudioContext = FakeAudioContext;
    vi.useFakeTimers();
    try {
      renderWorkspace();
      const position = () => screen.getByText(/Row \d+ of \d+/).textContent;
      expect(position()).toBe('Row 0 of 16');
      fireEvent.click(screen.getByRole('button', { name: 'Play song' }));
      expect(position()).toBe('Row 0 of 16 · playing');
      expect(started.length).toBe(4);
      expect(screen.getAllByRole('row').find((row) => row.getAttribute('aria-current') === 'true')).toHaveTextContent('0');
      clock.now += 0.6;
      act(() => { vi.advanceTimersByTime(100); });
      expect(position()).toBe('Row 1 of 16 · playing');
      fireEvent.click(screen.getByRole('button', { name: 'Fast forward four rows' }));
      expect(position()).toBe('Row 5 of 16 · playing');
      fireEvent.click(screen.getByRole('button', { name: 'Rewind four rows' }));
      expect(position()).toBe('Row 1 of 16 · playing');
      fireEvent.click(screen.getByRole('button', { name: 'Pause song' }));
      expect(position()).toBe('Row 1 of 16');
      fireEvent.click(screen.getByRole('button', { name: 'Stop song' }));
      expect(position()).toBe('Row 0 of 16');
      /* Playing through the end stops at the start. */
      fireEvent.click(screen.getByRole('button', { name: 'Play song' }));
      clock.now += 16 * 0.5 + 0.2;
      act(() => { vi.advanceTimersByTime(100); });
      expect(position()).toBe('Row 0 of 16');
    } finally {
      vi.useRealTimers();
      delete (globalThis as { AudioContext?: unknown }).AudioContext;
    }
  });

  it('starts from a silent sixteen-row grid of four machine channels', () => {
    renderWorkspace();
    expect(stored().rows).toHaveLength(16);
    expect(screen.getByRole('columnheader', { name: 'Noise' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Tone 3' })).toBeInTheDocument();
    expect(stored().rows.every((row) => row.every((cell) => cell.volume === 0))).toBe(true);
  });

  it('enters a note and shows it in the generated data and BASIC', () => {
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Row 0 Tone 1 pitch'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Row 0 Tone 1 volume'), { target: { value: '12' } });
    expect(stored().rows[0]![1]).toEqual({ pitch: 100, volume: 12 });
    expect(screen.getByLabelText('Generated song data and player')).toHaveTextContent('&00, &00, &64, &0C');
    expect(screen.getByLabelText('Generated song BASIC statements')).toHaveTextContent('SOUND 1,-12,100,10');
  });

  it('holds the noise channel to the range the machine accepts', () => {
    const { onNotice } = renderWorkspace();
    fireEvent.change(screen.getByLabelText('Row 0 Noise pitch'), { target: { value: '9' } });
    expect(onNotice).toHaveBeenCalledWith(expect.stringMatching(/Noise pitch must be a whole number from 0 to 7/));
    expect(stored().rows[0]![0]!.pitch).toBe(0);
  });

  it('changes length, keeping earlier rows', () => {
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Row 0 Tone 1 volume'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Song rows'), { target: { value: '4' } });
    expect(stored().rows).toHaveLength(4);
    expect(stored().rows[0]![1]!.volume).toBe(5);
  });

  it('clears a row and undoes the change', () => {
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Row 1 Tone 2 volume'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear row 1' }));
    expect(stored().rows[1]![2]!.volume).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(stored().rows[1]![2]!.volume).toBe(7);
  });

  it('names the zero page the generated player claims and follows a change to it', () => {
    renderWorkspace();
    expect(screen.getByRole('status')).toHaveTextContent('owns zero page &70 to &72');
    fireEvent.change(screen.getByLabelText('Player zero-page base'), { target: { value: '128' } });
    expect(screen.getByRole('status')).toHaveTextContent('owns zero page &80 to &82');
    expect(screen.getByLabelText('Generated song data and player')).toHaveTextContent('LDA (&80),Y');
  });

  it('says the browser playback is an audition and the chip is heard by building and running', () => {
    renderWorkspace();
    expect(screen.getByText(/an approximation of the chip/)).toBeInTheDocument();
    expect(screen.getByText(/run it to hear the chip itself/)).toBeInTheDocument();
  });

  it('offers generated source and a live build target', () => {
    const { onAddSource, onAddLiveSong } = renderWorkspace();
    fireEvent.change(screen.getByLabelText('Song name'), { target: { value: 'title theme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add generated source' }));
    expect(onAddSource).toHaveBeenCalledWith('title-theme.asm', expect.stringContaining('.song_title_theme_play_row'));
    fireEvent.click(screen.getByRole('button', { name: 'Add live song build target' }));
    expect(onAddLiveSong).toHaveBeenCalledWith('title-theme', expect.stringContaining('"schema": "8bit-net.song"'));
  });
});

describe('SongWorkspace sound hardware', () => {
  it('switches to the Atom speaker with one channel and no volume', () => {
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Sound hardware'), { target: { value: 'atom-speaker' } });
    expect(stored().target).toBe('atom-speaker');
    expect(stored().rows[0]).toHaveLength(1);
    expect(screen.getByRole('columnheader', { name: 'Speaker' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Tone 3' })).not.toBeInTheDocument();
    expect(screen.getByText(/one-bit speaker has no volume/)).toBeInTheDocument();
  });

  it('clamps a BBC volume to the Atom speaker on-or-off range when switching', () => {
    const { onNotice } = renderWorkspace();
    fireEvent.change(screen.getByLabelText('Row 0 Tone 1 volume'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Sound hardware'), { target: { value: 'atom-speaker' } });
    expect(stored().rows[0]![0]!.volume).toBe(0);
    fireEvent.change(screen.getByLabelText('Row 0 Speaker volume'), { target: { value: '2' } });
    expect(onNotice).toHaveBeenCalledWith(expect.stringMatching(/Speaker volume must be a whole number from 0 to 1/));
  });

  it('generates the PPIA speaker player rather than an OSWORD one', () => {
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Sound hardware'), { target: { value: 'atom-speaker' } });
    const generated = screen.getByLabelText('Generated song data and player');
    expect(generated).toHaveTextContent('STA &B003');
    expect(generated).not.toHaveTextContent('JSR &FFF1');
  });
});

describe('a song the project already holds', () => {
  it('is offered beside the file dialog, and opening one loads it', () => {
    const props = renderWorkspace(projectHolding('theme.song.json', serializeSongDocument(createSongDocument('theme'))));
    fireEvent.change(screen.getByLabelText('Open a song from this project'), { target: { value: 'theme.song.json' } });
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringContaining('opened from this project'));
    expect(screen.getByLabelText('Song name')).toHaveValue('theme');
  });

  it('does not offer a picker when the project holds no song', () => {
    renderWorkspace();
    expect(screen.queryByLabelText('Open a song from this project')).toBeNull();
  });
});

describe('a song for the BeebSID in the workspace', () => {
  it('switches to three voices with a waveform and envelope each', () => {
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Sound hardware'), { target: { value: 'bbc-beebsid' } });
    expect(stored().target).toBe('bbc-beebsid');
    expect(stored().rows[0]).toHaveLength(3);
    expect(stored().voices).toHaveLength(3);
    expect(screen.getByRole('columnheader', { name: 'Voice 3' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Voice 1 waveform'), { target: { value: 'sawtooth' } });
    fireEvent.change(screen.getByLabelText('Voice 1 attack'), { target: { value: '3' } });
    expect(stored().voices![0]).toMatchObject({ waveform: 'sawtooth', attack: 3 });
    expect(screen.getByLabelText('Voice 1 pulse width')).toBeDisabled();
  });

  it('names the note beside a pitch that sounds, and generates the chip writes', () => {
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Sound hardware'), { target: { value: 'bbc-beebsid' } });
    fireEvent.change(screen.getByLabelText('Row 0 Voice 1 pitch'), { target: { value: '57' } });
    fireEvent.change(screen.getByLabelText('Row 0 Voice 1 volume'), { target: { value: '12' } });
    expect(screen.getByText('A-4')).toBeInTheDocument();
    const generated = screen.getByLabelText('Generated song data and player');
    expect(generated).toHaveTextContent('STA &FC24');
    expect(generated).not.toHaveTextContent('JSR &FFF1');
    expect(screen.getByLabelText('Generated song BASIC statements')).toHaveTextContent('CALL the generated player');
  });

  it('drops the voices again when the song goes back to the SN76489', () => {
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Sound hardware'), { target: { value: 'bbc-beebsid' } });
    fireEvent.change(screen.getByLabelText('Sound hardware'), { target: { value: 'bbc-sn76489' } });
    expect(stored().voices).toBeUndefined();
    expect(screen.queryByLabelText('Voice 1 waveform')).toBeNull();
  });
});
