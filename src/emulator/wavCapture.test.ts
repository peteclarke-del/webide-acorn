import { describe, expect, it } from 'vitest';
import { encodeMonoPcm16Wav, validateAudioCaptureSeconds } from './wavCapture';

describe('bounded mono PCM WAV capture', () => {
  it('writes a valid little-endian PCM16 header and bounded samples', () => {
    const wav = encodeMonoPcm16Wav(new Float32Array([-1, 0, 1]), 44100);
    const view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe('WAVE');
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(40, true)).toBe(6);
    expect([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true)]).toEqual([-32768, 0, 32767]);
  });

  it('validates sample rate, capture length and requested seconds', () => {
    expect(validateAudioCaptureSeconds(30)).toBe(30);
    expect(() => validateAudioCaptureSeconds(0)).toThrow(/1 to 30/);
    expect(() => encodeMonoPcm16Wav(new Float32Array(1), 1000)).toThrow(/sample rate/);
    expect(() => encodeMonoPcm16Wav(new Float32Array(8001 * 30 + 1), 8001)).toThrow(/30 seconds/);
  });
});
