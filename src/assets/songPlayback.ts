/*
 * Hearing a song before it is built.
 *
 * The Sound workspace writes a song for one of four chips, and until this the
 * only way to hear it was to build the player into a program and run it. This
 * turns a song document into what each row sounds like, in the browser's
 * terms: a frequency, a level, a waveform and a length for every channel of
 * every row, on the same scales the machine's own player uses. It is an
 * audition, not the chip: the SN76489's tone is a square wave and its noise a
 * noise; the 6581's waveforms are approximated by the browser's, its pulse
 * width by a square, and its envelope by the attack, decay and release
 * times its registers stand for. The real sound is what the machine plays.
 */
import { SID_VOICES, sidFrequencyRegister, songTargetProfile, type SidVoiceSettings, type SongDocument, type SongTarget } from './songDocument';

export type PreviewWave = 'square' | 'triangle' | 'sawtooth' | 'noise' | 'silence';

export interface PreviewVoice {
  /** Hertz; 0 for silence or for noise, which has no pitch. */
  frequency: number;
  /** 0 to 1. */
  level: number;
  wave: PreviewWave;
  /** Seconds, for the BeebSID's envelope; 0 for the other chips, which switch. */
  attack: number;
  decay: number;
  release: number;
}

export interface PreviewRow {
  row: number;
  /** Seconds from the start of the song. */
  start: number;
  /** Seconds. */
  duration: number;
  voices: PreviewVoice[];
}

/** OSWORD 7's pitch: 48 units to the octave, 89 being A-4 at 440 Hz. */
export function oswordPitchHertz(pitch: number): number {
  return 440 * 2 ** ((pitch - 89) / 48);
}

/** The Atom player's speaker toggle: a DEY/BNE loop of five cycles a count and about 21 of overhead a half period, at 1 MHz. */
export function atomHalfPeriodSeconds(pitch: number): number {
  return (5 * Math.max(1, pitch) + 21) / 1_000_000;
}

/** The 6581's envelope rates, in seconds, as the datasheet lists them for each register value. */
const SID_ATTACK_SECONDS = [0.002, 0.008, 0.016, 0.024, 0.038, 0.056, 0.068, 0.08, 0.1, 0.25, 0.5, 0.8, 1, 3, 5, 8];
const SID_DECAY_SECONDS = [0.006, 0.024, 0.048, 0.072, 0.114, 0.168, 0.204, 0.24, 0.3, 0.75, 1.5, 2.4, 3, 9, 15, 24];

const SID_CLOCK = 1_000_000;

function silence(): PreviewVoice { return { frequency: 0, level: 0, wave: 'silence', attack: 0, decay: 0, release: 0 }; }

function sidVoice(note: number, level: number, settings: SidVoiceSettings | undefined): PreviewVoice {
  if (!level || !settings) return silence();
  const wave: PreviewWave = settings.waveform === 'pulse' ? 'square' : settings.waveform;
  return {
    frequency: wave === 'noise' ? 0 : sidFrequencyRegister(note) * SID_CLOCK / 16_777_216,
    level: level / 15,
    wave,
    attack: SID_ATTACK_SECONDS[settings.attack & 15]!,
    decay: SID_DECAY_SECONDS[settings.decay & 15]!,
    release: SID_DECAY_SECONDS[settings.release & 15]!,
  };
}

function chipVoice(target: SongTarget, channel: number, pitch: number, volume: number): PreviewVoice {
  if (!volume) return silence();
  if (target === 'atom-speaker') return { frequency: 1 / (2 * atomHalfPeriodSeconds(pitch)), level: 1, wave: 'square', attack: 0, decay: 0, release: 0 };
  if (target === 'bbc-sn76489' && channel === 0) return { frequency: 0, level: volume / 15, wave: 'noise', attack: 0, decay: 0, release: 0 };
  const level = target === 'electron-ula' ? 1 : volume / 15;
  return { frequency: oswordPitchHertz(pitch), level, wave: 'square', attack: 0, decay: 0, release: 0 };
}

/** How long one row lasts. The Atom's player counts toggles rather than twentieths, so its rows are as long as the note makes them. */
export function rowSeconds(document: SongDocument, row: number): number {
  if (document.target !== 'atom-speaker') return document.rowDuration / 20;
  const pitch = document.rows[row]?.[0]?.pitch ?? 1;
  return document.rowDuration * 2 * atomHalfPeriodSeconds(pitch);
}

/** Every row of the song as what it sounds like, in order, with when it starts. */
export function previewRows(document: SongDocument): PreviewRow[] {
  const profile = songTargetProfile(document.target);
  let start = 0;
  return document.rows.map((cells, row) => {
    const duration = rowSeconds(document, row);
    const voices = Array.from({ length: profile.channels }, (_, channel) => {
      const cell = cells[channel] ?? { pitch: 0, volume: 0 };
      return document.target === 'bbc-beebsid'
        ? sidVoice(cell.pitch, cell.volume, document.voices?.[channel])
        : chipVoice(document.target, channel, cell.pitch, cell.volume);
    });
    const entry = { row, start, duration, voices };
    start += duration;
    return entry;
  });
}

/** Seconds the whole song lasts. */
export function songSeconds(document: SongDocument): number {
  return previewRows(document).reduce((sum, row) => sum + row.duration, 0);
}

/*
 * The transport: where playback is and whether it is running. A plain state
 * so the buttons, the row highlight and the audio all read one thing, and so
 * it can be tested without a speaker.
 */
export interface Transport { row: number; playing: boolean }

export const STEP_ROWS = 4;

export function transportPlay(state: Transport, rows: number): Transport {
  if (!rows) return state;
  return { row: state.row >= rows ? 0 : state.row, playing: true };
}
export function transportPause(state: Transport): Transport { return { ...state, playing: false }; }
export function transportStop(): Transport { return { row: 0, playing: false }; }
export function transportRewind(state: Transport): Transport { return { ...state, row: Math.max(0, state.row - STEP_ROWS) }; }
export function transportForward(state: Transport, rows: number): Transport { return { ...state, row: Math.min(Math.max(0, rows - 1), state.row + STEP_ROWS) }; }
/** The row ends: the next one, or the end, where playback stops. */
export function transportAdvance(state: Transport, rows: number): Transport {
  if (!state.playing) return state;
  return state.row + 1 >= rows ? { row: 0, playing: false } : { ...state, row: state.row + 1 };
}

export { SID_VOICES };
