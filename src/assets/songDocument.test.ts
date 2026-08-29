import { describe, expect, it } from 'vitest';
import {
  CHANNEL_LABELS, clearSongRow, createSongDocument, generateSongOutput, MAX_ATOM_ROWS, MAX_SONG_ROWS,
  maximumPitch, parseSongDocument, serializeSongDocument, setSongCell, setSongLength, songLabel,
  songTargetProfile, SONG_CHANNELS,
} from './songDocument';
import { assemble6502 } from '../build/assembler6502';

function sample() {
  let document = createSongDocument('title theme', 4);
  document = setSongCell(document, 0, 1, { pitch: 100, volume: 12 });
  document = setSongCell(document, 1, 2, { pitch: 140, volume: 8 });
  document = setSongCell(document, 3, 0, { pitch: 5, volume: 4 });
  return document;
}

describe('song documents', () => {
  it('creates a silent grid of four channels', () => {
    const document = createSongDocument('s', 8);
    expect(document.rows).toHaveLength(8);
    expect(document.rows[0]).toHaveLength(SONG_CHANNELS);
    expect(CHANNEL_LABELS).toEqual(['Noise', 'Tone 1', 'Tone 2', 'Tone 3']);
    expect(parseSongDocument(document)).toEqual(document);
  });

  it('round-trips through serialization', () => {
    expect(parseSongDocument(serializeSongDocument(sample()))).toEqual(sample());
  });

  it('holds the noise channel to the range the machine accepts', () => {
    expect(maximumPitch(0)).toBe(7);
    expect(maximumPitch(1)).toBe(255);
    expect(() => setSongCell(createSongDocument('s'), 0, 0, { pitch: 8, volume: 1 })).toThrow(/Noise pitch must be a whole number from 0 to 7/);
    expect(setSongCell(createSongDocument('s'), 0, 1, { pitch: 255, volume: 1 }).rows[0]![1]!.pitch).toBe(255);
  });

  it('refuses bad volumes, durations, row counts and zero-page bases', () => {
    expect(() => setSongCell(createSongDocument('s'), 0, 1, { volume: 16 })).toThrow(/volume must be a whole number from 0 to 15/);
    expect(() => parseSongDocument({ ...sample(), rowDuration: 0 })).toThrow(/Row duration must be/);
    expect(() => parseSongDocument({ ...sample(), rows: [] })).toThrow(/1 to 256 rows/);
    expect(() => parseSongDocument({ ...sample(), zeroPageBase: 0xfe })).toThrow(/room for four bytes/);
    expect(() => parseSongDocument({ ...sample(), rows: [[{ pitch: 0, volume: 0 }]] })).toThrow(/exactly 4 channels/);
    expect(() => parseSongDocument({ schema: 'other', version: 1 })).toThrow(/Unsupported song schema/);
  });

  it('lengthens with silence and shortens by dropping trailing rows', () => {
    const longer = setSongLength(sample(), 6);
    expect(longer.rows).toHaveLength(6);
    expect(longer.rows[0]![1]!.volume).toBe(12);
    expect(longer.rows[5]!.every((cell) => cell.volume === 0)).toBe(true);
    const shorter = setSongLength(sample(), 2);
    expect(shorter.rows).toHaveLength(2);
    expect(shorter.rows[1]![2]!.pitch).toBe(140);
    expect(() => setSongLength(sample(), MAX_SONG_ROWS + 1)).toThrow(/1 to 256 rows/);
  });

  it('clears a row and refuses one that is not in the song', () => {
    expect(clearSongRow(sample(), 0).rows[0]!.every((cell) => cell.volume === 0)).toBe(true);
    expect(() => clearSongRow(sample(), 9)).toThrow(/not in this song/);
    expect(() => setSongCell(sample(), 0, 4, { volume: 1 })).toThrow(/not in this song/);
  });
});

describe('generated song output', () => {
  const output = generateSongOutput(sample());

  it('emits a header and two bytes per channel per row', () => {
    expect(Array.from(output.bytes.slice(0, 3))).toEqual([4, 4, 10]);
    expect(Array.from(output.bytes.slice(3, 11))).toEqual([0, 0, 100, 12, 0, 0, 0, 0]);
    expect(output.manifest).toMatchObject({ rowCount: 4, channels: 4, rowDuration: 10, byteLength: 3 + 4 * 8 });
    expect(output.manifest.sha256).toBe(generateSongOutput(sample()).manifest.sha256);
  });

  it('names the zero page the player claims and the rows that are silent', () => {
    expect(output.manifest.zeroPage).toEqual([0x70, 0x71, 0x72, 0x73]);
    expect(output.manifest.silentRows).toEqual([2]);
    expect(output.assembly).toContain('The player owns zero page &70 to &73');
    const moved = generateSongOutput(parseSongDocument({ ...sample(), zeroPageBase: 0x80 }));
    expect(moved.manifest.zeroPage).toEqual([0x80, 0x81, 0x82, 0x83]);
    expect(moved.assembly).toContain('LDA (&80),Y');
  });

  it('generates a player that assembles with no diagnostics', () => {
    const artifact = assemble6502(`ORG &1900\n.start\nJSR ${songLabel('title theme')}_reset\nJSR ${songLabel('title theme')}_play_row\nRTS\n${output.assembly}`);
    expect(artifact.diagnostics).toEqual([]);
    expect(artifact.symbols.SONG_TITLE_THEME_PLAY_ROW).toBeDefined();
    expect(artifact.symbols.SONG_TITLE_THEME_RESET).toBeDefined();
    expect(artifact.symbols.SONG_TITLE_THEME_BLOCK).toBeDefined();
  });

  it('offers a BASIC form that plays only the notes that sound', () => {
    expect(output.basic).toContain('SOUND 1,-12,100,10');
    expect(output.basic).toContain('SOUND 0,-4,5,10');
    // Row 2 is silent, so it contributes nothing.
    expect(output.basic).not.toContain('row 2');
  });
});

describe('a song for the Atom speaker', () => {
  const atom = () => setSongCell(createSongDocument('beep', 4, 'atom-speaker'), 0, 0, { pitch: 40, volume: 1 });

  it('has one channel and no volume, because that is the hardware', () => {
    const profile = songTargetProfile('atom-speaker');
    expect(profile.channels).toBe(1);
    expect(profile.maxVolume).toBe(1);
    expect(atom().rows[0]).toHaveLength(1);
    expect(() => setSongCell(atom(), 0, 0, { volume: 2 })).toThrow(/Speaker volume must be a whole number from 0 to 1/);
    expect(() => setSongCell(atom(), 0, 1, { volume: 1 })).toThrow(/not in this song/);
  });

  it('cannot be given the four BBC channels however it is constructed', () => {
    expect(() => parseSongDocument({ ...atom(), rows: [[{ pitch: 0, volume: 0 }, { pitch: 0, volume: 0 }, { pitch: 0, volume: 0 }, { pitch: 0, volume: 0 }]] }))
      .toThrow(/exactly 1 channel for Atom/);
  });

  it('is bounded to the rows its byte-indexed player can reach', () => {
    expect(() => setSongLength(atom(), MAX_ATOM_ROWS + 1)).toThrow(/Atom · 1-bit speaker song must have 1 to 128 rows/);
    expect(setSongLength(atom(), MAX_ATOM_ROWS).rows).toHaveLength(MAX_ATOM_ROWS);
  });

  it('generates a speaker player that toggles the PPIA bit and assembles', () => {
    const output = generateSongOutput(atom());
    expect(output.manifest.target).toBe('atom-speaker');
    expect(output.assembly).toContain('STA &B003');
    expect(output.assembly).toContain('LDA #&05');
    expect(output.assembly).toContain('LDA #&04');
    expect(output.assembly).not.toContain('JSR &FFF1');
    expect(output.basic).toMatch(/no SOUND statement/);
    const artifact = assemble6502(`ORG &1900\n.start\nJSR song_beep_reset\nJSR song_beep_play_row\nRTS\n${output.assembly}`);
    expect(artifact.diagnostics).toEqual([]);
    expect(artifact.symbols.SONG_BEEP_DELAY).toBeDefined();
  });
});

describe('long songs', () => {
  it('computes a sixteen-bit row offset so rows past the first thirty-two are reachable', () => {
    let document = setSongLength(createSongDocument('long'), 64);
    document = setSongCell(document, 63, 1, { pitch: 200, volume: 9 });
    const output = generateSongOutput(document);
    // Row 63 at eight bytes a row is offset 504, which does not fit in a byte.
    expect(output.assembly).toContain('ROL &73');
    const artifact = assemble6502(`ORG &1900\n.start\nJSR song_long_play_row\nRTS\n${output.assembly}`);
    expect(artifact.diagnostics).toEqual([]);
    const data = artifact.symbols.SONG_LONG_DATA! - artifact.origin;
    expect(artifact.bytes[data + 63 * 8 + 2]).toBe(200);
    expect(artifact.bytes[data + 63 * 8 + 3]).toBe(9);
  });
});
