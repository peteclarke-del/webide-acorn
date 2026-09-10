/*
 * A BeebSID song's player, run on the machine and read back from the chip.
 *
 * `scripts/measureSidSong.mjs` assembles the player the song editor generates
 * for the document below, loads it on a Model B with BeebSID fitted, calls its
 * reset and then its play-row entry once per row, and reads the 6581's
 * register file after each call through the same SID engine the runtime fits.
 * What it read is recorded here, and the tests hold the generator to it: a
 * change to the player that writes a different register, or the same register
 * with a different value, fails against what the chip actually held.
 */
import { createSongDocument, setSidVoice, setSongCell, sidFrequencyRegister, SID_WAVEFORM_BITS, type SongDocument } from './songDocument';

export const MEASURED_SONG = Object.freeze({ name: 'measured', rows: 3 });

/** Two notes on two voices, one released, one voice never used. */
export function measuredSongDocument(): SongDocument {
  let document = createSongDocument(MEASURED_SONG.name, MEASURED_SONG.rows, 'bbc-beebsid');
  document = setSidVoice(document, 0, { waveform: 'sawtooth', attack: 2, decay: 9, release: 6 });
  document = setSidVoice(document, 1, { waveform: 'pulse', pulseWidth: 0x800, attack: 0, decay: 4, release: 3 });
  document = setSongCell(document, 0, 0, { pitch: 57, volume: 12 });
  document = setSongCell(document, 0, 1, { pitch: 45, volume: 15 });
  document = setSongCell(document, 1, 0, { pitch: 60, volume: 12 });
  /* Row 1 leaves voice 2 at level zero: its gate closes. Row 2 is silent. */
  return document;
}

/**
 * The register file, &FC20 to &FC38, after reset and after each row, exactly
 * as the chip held it. Recorded by scripts/measureSidSong.mjs.
 */
export const MEASURED_REGISTERS: Readonly<Record<string, readonly number[]>> = Object.freeze({
  'after reset': [0x00, 0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0f],
  'after row 0': [0xd6, 0x1c, 0x00, 0x08, 0x21, 0x29, 0xc6, 0x6b, 0x0e, 0x00, 0x08, 0x41, 0x04, 0xf3, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0f],
  'after row 1': [0x4b, 0x22, 0x00, 0x08, 0x21, 0x29, 0xc6, 0x6b, 0x0e, 0x00, 0x08, 0x40, 0x04, 0xf3, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0f],
  'after row 2': [0x4b, 0x22, 0x00, 0x08, 0x20, 0x29, 0xc6, 0x6b, 0x0e, 0x00, 0x08, 0x40, 0x04, 0xf3, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0f],
});

/**
 * What the player is meant to leave in the chip: the model the generator is
 * written to, stated apart from it so the measurement can be checked against
 * the intent and the generator against both. The register file is &FC20 to
 * &FC38, twenty-five bytes; registers a row does not touch keep their value.
 */
export function expectedSidRegisters(document: SongDocument, rowsPlayed: number): number[] {
  const voices = document.voices ?? [];
  const registers = new Array<number>(0x19).fill(0);
  voices.forEach((voice, index) => { registers[index * 7 + 4] = SID_WAVEFORM_BITS[voice.waveform]; });
  registers[0x18] = 0x0f;
  for (let row = 0; row < rowsPlayed; row += 1) {
    document.rows[row]!.forEach((cell, index) => {
      const voice = voices[index]!;
      const base = index * 7;
      const wave = SID_WAVEFORM_BITS[voice.waveform];
      if (cell.volume === 0) { registers[base + 4] = wave; return; }
      const frequency = sidFrequencyRegister(cell.pitch);
      registers[base + 0] = frequency & 0xff;
      registers[base + 1] = frequency >> 8;
      registers[base + 2] = voice.pulseWidth & 0xff;
      registers[base + 3] = (voice.pulseWidth >> 8) & 0x0f;
      registers[base + 4] = wave | 1;
      registers[base + 5] = (voice.attack << 4) | voice.decay;
      registers[base + 6] = (cell.volume << 4) | voice.release;
    });
  }
  return registers;
}
