import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SongWorkspace } from './SongWorkspace';
import { parseSongDocument } from '../assets/songDocument';

afterEach(() => { cleanup(); localStorage.clear(); });

function renderWorkspace() {
  const props = { onAddSource: vi.fn(), onAddLiveSong: vi.fn(), onNotice: vi.fn() };
  render(<SongWorkspace {...props} />);
  return props;
}
const stored = () => parseSongDocument(localStorage.getItem('8bit-net-dev:song')!);

describe('SongWorkspace', () => {
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

  it('says it does not synthesise the machine sound in the browser', () => {
    renderWorkspace();
    expect(screen.getByText(/Nothing is synthesised here/)).toBeInTheDocument();
    expect(screen.getByText(/run it to hear the real hardware play it/)).toBeInTheDocument();
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
