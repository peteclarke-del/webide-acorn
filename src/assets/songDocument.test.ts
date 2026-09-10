import { describe, expect, it } from 'vitest';
import {
  CHANNEL_LABELS, clearSongRow, createSongDocument, generateSongOutput, MAX_ATOM_ROWS, MAX_SID_NOTE, MAX_SONG_ROWS,
  maximumPitch, parseSongDocument, serializeSongDocument, setSidVoice, setSongCell, setSongLength, sidFrequencyRegister, songLabel,
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

describe('a song for the BeebSID', () => {
  /* The 6581 at &FC20: three voices, seven registers each, a master volume at
   * &FC38. The pinned core's own SID (src/emulator/beebSid.ts) decodes these
   * registers, and the frequency register is what a 1 MHz clock makes of a
   * pitch: Fout = Fn * 1,000,000 / 16,777,216. */
  const sid = () => {
    let document = createSongDocument('dusk', 4, 'bbc-beebsid');
    document = setSongCell(document, 0, 0, { pitch: 57, volume: 12 });
    document = setSongCell(document, 1, 2, { pitch: 94, volume: 8 });
    document = setSidVoice(document, 0, { waveform: 'sawtooth', attack: 2, decay: 9, release: 6 });
    document = setSidVoice(document, 1, { waveform: 'pulse', pulseWidth: 0x800 });
    return document;
  };

  it('has three voices with a waveform and envelope each, and carries them through serialisation', () => {
    const document = sid();
    expect(document.rows[0]).toHaveLength(3);
    expect(songTargetProfile('bbc-beebsid').channelLabels).toEqual(['Voice 1', 'Voice 2', 'Voice 3']);
    expect(document.voices).toHaveLength(3);
    expect(document.voices![0]).toEqual({ waveform: 'sawtooth', pulseWidth: 2048, attack: 2, decay: 9, release: 6 });
    expect(parseSongDocument(serializeSongDocument(document))).toEqual(document);
    /* A song for another chip carries no voices. */
    expect(createSongDocument('sn', 4).voices).toBeUndefined();
    expect(() => setSidVoice(createSongDocument('sn', 4), 0, { attack: 1 })).toThrow(/Only a BeebSID song has voices/);
  });

  it('plays notes up to A# in the seventh octave, where a sixteen-bit frequency register runs out', () => {
    expect(maximumPitch(0, 'bbc-beebsid')).toBe(MAX_SID_NOTE);
    expect(sidFrequencyRegister(0)).toBe(274);
    expect(sidFrequencyRegister(57)).toBe(7382);
    expect(sidFrequencyRegister(94)).toBe(62567);
    expect(sidFrequencyRegister(95)).toBeGreaterThan(0xffff);
    expect(() => setSongCell(sid(), 0, 0, { pitch: 95, volume: 1 })).toThrow(/pitch must be a whole number from 0 to 94/);
  });

  it('refuses a voice outside what the chip has', () => {
    expect(() => setSidVoice(sid(), 0, { attack: 16 })).toThrow(/attack must be a whole number from 0 to 15/);
    expect(() => setSidVoice(sid(), 1, { pulseWidth: 4096 })).toThrow(/pulse width must be a whole number from 0 to 4095/);
    expect(() => setSidVoice(sid(), 2, { waveform: 'square' as never })).toThrow(/waveform must be triangle, sawtooth, pulse or noise/);
    expect(() => setSidVoice(sid(), 3, { attack: 1 })).toThrow(/not on the chip/);
    /* A document written before voices existed still plays, with the defaults. */
    const { voices, ...without } = sid();
    expect(voices).toBeDefined();
    expect(parseSongDocument(without).voices![2]).toEqual({ waveform: 'pulse', pulseWidth: 2048, attack: 0, decay: 9, release: 6 });
  });

  it('emits eight bytes a row, three voices and two of padding, then the voice table', () => {
    const output = generateSongOutput(sid());
    expect(Array.from(output.bytes.slice(0, 3))).toEqual([4, 3, 10]);
    expect(Array.from(output.bytes.slice(3, 11))).toEqual([57, 12, 0, 0, 0, 0, 0, 0]);
    expect(Array.from(output.bytes.slice(11, 19))).toEqual([0, 0, 0, 0, 94, 8, 0, 0]);
    /* Sawtooth, pulse width 2048, attack 2 decay 9, release 6. */
    expect(Array.from(output.bytes.slice(3 + 4 * 8, 3 + 4 * 8 + 5))).toEqual([0x20, 0x00, 0x08, 0x29, 0x06]);
    expect(output.bytes).toHaveLength(3 + 4 * 8 + 15);
    expect(output.manifest.channels).toBe(3);
  });

  it('generates a player that writes the chip directly and assembles with no diagnostics', () => {
    const output = generateSongOutput(sid());
    const label = songLabel('dusk');
    /* Voice 1: sustain and release, attack and decay, the note, the pulse width, then gate closed and opened. */
    expect(output.assembly).toContain('STA &FC26');
    expect(output.assembly).toContain('LDA #&29\n  STA &FC25');
    expect(output.assembly).toContain(`LDA ${label}_freq_lo,X\n  STA &FC20`);
    expect(output.assembly).toContain('LDA #&20\n  STA &FC24\n  LDA #&21\n  STA &FC24');
    /* Voice 3 is seven registers on. */
    expect(output.assembly).toContain('STA &FC32');
    /* Reset opens the master volume and closes every gate. */
    expect(output.assembly).toContain('LDA #&0F\n  STA &FC38');
    /* A-4 is &1CD6, at index 57 of the two tables. */
    const lo = output.assembly.split(`.${label}_freq_lo\n`)[1]!.split(`.${label}_freq_hi`)[0]!.match(/&[0-9A-F]{2}/g)!;
    const hi = output.assembly.split(`.${label}_freq_hi\n`)[1]!.match(/&[0-9A-F]{2}/g)!;
    expect(lo).toHaveLength(95);
    expect(hi).toHaveLength(95);
    expect(`${hi[57]}${lo[57]!.slice(1)}`).toBe('&1CD6');
    const artifact = assemble6502(`ORG &1900\n.start\nJSR ${label}_reset\nJSR ${label}_play_row\nRTS\n${output.assembly}`);
    expect(artifact.diagnostics).toEqual([]);
    expect(artifact.symbols.SONG_DUSK_PLAY_ROW).toBeDefined();
    expect(artifact.symbols.SONG_DUSK_VOICES).toBeDefined();
    expect(output.basic).toContain('CALL the generated player');
  });
});
