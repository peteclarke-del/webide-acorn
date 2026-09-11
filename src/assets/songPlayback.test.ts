import { describe, expect, it } from 'vitest';
import { createSongDocument, parseSongDocument, setSidVoice, setSongCell } from './songDocument';
import { atomHalfPeriodSeconds, oswordPitchHertz, previewRows, rowSeconds, songSeconds, transportAdvance, transportForward, transportPause, transportPlay, transportRewind, transportStop } from './songPlayback';

describe('what a song sounds like before it is built', () => {
  it('reads OSWORD 7 pitch on the machine scale: 89 is A-4, 48 units an octave, 53 middle C', () => {
    expect(oswordPitchHertz(89)).toBeCloseTo(440, 6);
    expect(oswordPitchHertz(41)).toBeCloseTo(220, 6);
    expect(oswordPitchHertz(53)).toBeCloseTo(261.63, 1);
  });

  it('turns a BBC row into square waves at those pitches, the noise channel into noise, and silence into silence', () => {
    let document = createSongDocument('t', 2, 'bbc-sn76489');
    document = setSongCell(document, 0, 1, { pitch: 89, volume: 15 });
    document = setSongCell(document, 0, 0, { pitch: 3, volume: 8 });
    const rows = previewRows(document);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.voices[1]).toMatchObject({ wave: 'square', level: 1 });
    expect(rows[0]!.voices[1]!.frequency).toBeCloseTo(440, 6);
    expect(rows[0]!.voices[0]).toMatchObject({ wave: 'noise', frequency: 0 });
    expect(rows[0]!.voices[0]!.level).toBeCloseTo(8 / 15, 6);
    expect(rows[1]!.voices.every((voice) => voice.wave === 'silence')).toBe(true);
    /* Rows are twentieths of a second long, and start one after another. */
    expect(rows[0]!.duration).toBe(0.5);
    expect(rows[1]!.start).toBe(0.5);
    expect(songSeconds(document)).toBe(1);
  });

  it('turns a BeebSID row into the voice\'s waveform at the chip\'s frequency with its envelope times', () => {
    let document = createSongDocument('t', 1, 'bbc-beebsid');
    document = setSidVoice(document, 0, { waveform: 'sawtooth', pulseWidth: 2048, attack: 0, decay: 9, release: 15 });
    document = setSongCell(document, 0, 0, { pitch: 57, volume: 15 });
    const voice = previewRows(document)[0]!.voices[0]!;
    expect(voice.wave).toBe('sawtooth');
    /* A-4: the register for 440 Hz at a 1 MHz clock, back to hertz. */
    expect(voice.frequency).toBeCloseTo(440, 0);
    expect(voice).toMatchObject({ level: 1, attack: 0.002, decay: 0.75, release: 24 });
  });

  it('times the Atom by its delay loop, five cycles a count, so a row lasts as long as its toggles', () => {
    expect(atomHalfPeriodSeconds(100)).toBeCloseTo(521e-6, 9);
    let document = parseSongDocument({ ...createSongDocument('t', 1, 'atom-speaker'), rowDuration: 10 });
    document = setSongCell(document, 0, 0, { pitch: 100, volume: 1 });
    expect(rowSeconds(document, 0)).toBeCloseTo(10 * 2 * 521e-6, 9);
    expect(previewRows(document)[0]!.voices[0]!.frequency).toBeCloseTo(1 / (2 * 521e-6), 3);
  });

  it('moves the transport: play, step, rewind and fast forward by four, stop to the start, and the end stops it', () => {
    let state = transportStop();
    expect(state).toEqual({ row: 0, playing: false });
    state = transportPlay(state, 16);
    expect(state.playing).toBe(true);
    state = transportAdvance(state, 16);
    expect(state.row).toBe(1);
    state = transportForward(state, 16);
    expect(state.row).toBe(5);
    state = transportForward({ row: 14, playing: true }, 16);
    expect(state.row).toBe(15);
    state = transportRewind(state);
    expect(state.row).toBe(11);
    expect(transportRewind({ row: 2, playing: false }).row).toBe(0);
    expect(transportPause(state)).toEqual({ row: 11, playing: false });
    expect(transportAdvance({ row: 15, playing: true }, 16)).toEqual({ row: 0, playing: false });
    expect(transportAdvance({ row: 3, playing: false }, 16)).toEqual({ row: 3, playing: false });
    /* Play from the end starts again from the top. */
    expect(transportPlay({ row: 16, playing: false }, 16)).toEqual({ row: 0, playing: true });
  });
});
