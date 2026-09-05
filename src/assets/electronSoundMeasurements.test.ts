import { describe, expect, it } from 'vitest';
import {
  ELECTRON_PITCH_DIVIDERS, ELECTRON_SOUND_OBSERVATIONS, ELECTRON_SOUND_MEASUREMENT_SOURCE,
  electronToneFrequency,
} from './electronSoundMeasurements';
import {
  SONG_TARGETS, songTargetProfile, createSongDocument, generateSongOutput,
  maximumPitch, ELECTRON_CHANNELS,
} from './songDocument';

describe('what the Electron does with sound', () => {
  it('rises in pitch as the divider falls, without a single reversal', () => {
    const dividers = ELECTRON_PITCH_DIVIDERS.map((entry) => entry.divider);
    for (let index = 1; index < dividers.length; index += 1) expect(dividers[index]!).toBeLessThan(dividers[index - 1]!);
    const pitches = ELECTRON_PITCH_DIVIDERS.map((entry) => entry.pitch);
    for (let index = 1; index < pitches.length; index += 1) expect(pitches[index]!).toBeGreaterThan(pitches[index - 1]!);
  });

  it('measures the BBC scale of forty-eight pitch units to the octave', () => {
    /* Every pair of measured pitches an octave apart, against the frequency the
     * divider each was given actually produces. The divider is a small integer
     * at the top of the range, so the tolerance is the divider's, not a fudge. */
    const byPitch = new Map(ELECTRON_PITCH_DIVIDERS.map((entry) => [entry.pitch, entry.divider]));
    const octaves: Array<[number, number]> = [[53, 101], [101, 149], [149, 197]];
    for (const [low, high] of octaves) {
      const ratio = electronToneFrequency(byPitch.get(high)!) / electronToneFrequency(byPitch.get(low)!);
      expect(ratio).toBeGreaterThan(1.9);
      expect(ratio).toBeLessThan(2.15);
    }
  });

  it('computes the frequency from the ULA clock, and refuses a divider that is not one', () => {
    expect(electronToneFrequency(57)).toBeCloseTo(1_000_000 / (16 * 58), 6);
    expect(() => electronToneFrequency(-1)).toThrow();
    expect(() => electronToneFrequency(256)).toThrow();
    expect(() => electronToneFrequency(1.5)).toThrow();
  });

  it('records that the machine has no volume', () => {
    const amplitudes = ELECTRON_SOUND_OBSERVATIONS.filter((entry) => /^SOUND 1,-?\d+,101,10$/.test(entry.statement));
    expect(amplitudes).toHaveLength(4);
    const silent = amplitudes.filter((entry) => !entry.played);
    expect(silent.map((entry) => entry.statement)).toEqual(['SOUND 1,0,101,10']);
    const sounded = amplitudes.filter((entry) => entry.played);
    expect(new Set(sounded.flatMap((entry) => [...entry.dividers]))).toEqual(new Set([57]));
  });

  it('records that a note on another channel takes the machine away from the one playing', () => {
    const across = ELECTRON_SOUND_OBSERVATIONS.find((entry) => entry.statement === 'SOUND 1,-15,53,10:SOUND 2,-15,197,10')!;
    expect(across.dividers).toEqual([13]);
    const along = ELECTRON_SOUND_OBSERVATIONS.find((entry) => entry.statement === 'SOUND 1,-15,53,10:SOUND 1,-15,197,10')!;
    expect(along.dividers).toEqual([116, 13]);
  });

  it('records that channel 0 is noise made from the same generator', () => {
    const noise = ELECTRON_SOUND_OBSERVATIONS.find((entry) => entry.statement === 'SOUND 0,-15,101,10')!;
    expect(noise.played).toBe(true);
    expect(noise.dividers.length).toBeGreaterThan(4);
  });

  it('says where the numbers came from', () => {
    expect(ELECTRON_SOUND_MEASUREMENT_SOURCE).toContain('Elkulator');
    expect(ELECTRON_SOUND_MEASUREMENT_SOURCE).toContain('typed at the machine');
  });
});

describe('the Electron song target', () => {
  it('offers exactly one channel, because a second one would lose notes', () => {
    const profile = songTargetProfile('electron-ula');
    expect(profile.channels).toBe(ELECTRON_CHANNELS);
    expect(profile.channels).toBe(1);
    expect(profile.channelLabels).toEqual(['Tone']);
    expect(profile.maxVolume).toBe(1);
    expect(SONG_TARGETS.map((entry) => entry.id)).toContain('electron-ula');
  });

  it('takes the machine\'s full pitch range', () => {
    expect(maximumPitch(0, 'electron-ula')).toBe(255);
    const highest = ELECTRON_PITCH_DIVIDERS[ELECTRON_PITCH_DIVIDERS.length - 1]!;
    expect(highest.pitch).toBeLessThanOrEqual(maximumPitch(0, 'electron-ula'));
  });

  it('generates a player that uses channel 1, not the noise channel', () => {
    const song = createSongDocument('elk', 4, 'electron-ula');
    song.rows[0]![0] = { pitch: 101, volume: 1 };
    const output = generateSongOutput(song);
    expect(output.assembly).toContain('LDA #1');
    expect(output.assembly).toContain('JSR &FFF1');
    expect(output.assembly).toContain('OSWORD 7 on channel 1');
    /* And nothing that would step through channels it does not have. */
    expect(output.assembly).not.toContain('play_channel');
    expect(output.manifest.channels).toBe(1);
    expect(output.manifest.target).toBe('electron-ula');
  });

  it('writes BASIC that plays on channel 1 and skips silent rows', () => {
    const song = createSongDocument('elk', 3, 'electron-ula');
    song.rows[0]![0] = { pitch: 53, volume: 1 };
    song.rows[2]![0] = { pitch: 197, volume: 1 };
    const output = generateSongOutput(song);
    const lines = output.basic.split('\n').filter((line) => line.startsWith('SOUND'));
    expect(lines).toEqual([`SOUND 1,-15,53,${song.rowDuration}`, `SOUND 1,-15,197,${song.rowDuration}`]);
  });

  it('is a different song from the same rows on the BBC, and says so in its manifest', () => {
    const elk = createSongDocument('same', 2, 'electron-ula');
    const bbc = createSongDocument('same', 2, 'bbc-sn76489');
    expect(generateSongOutput(elk).manifest.channels).not.toBe(generateSongOutput(bbc).manifest.channels);
    expect(generateSongOutput(elk).assembly).not.toBe(generateSongOutput(bbc).assembly);
  });
});
