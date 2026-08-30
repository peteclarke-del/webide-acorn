export function encodeMonoPcm16Wav(samples: Float32Array, sampleRate: number): Uint8Array {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('WAV sample rate must be 8,000 to 192,000 Hz');
  if (samples.length > sampleRate * 30) throw new Error('WAV capture is limited to 30 seconds');
  const output = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(output.buffer);
  const ascii = (offset: number, text: string) => Array.from(text).forEach((character, index) => { output[offset + index] = character.charCodeAt(0); });
  ascii(0, 'RIFF'); view.setUint32(4, output.length - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => {
    const bounded = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0));
    view.setInt16(44 + index * 2, bounded < 0 ? Math.round(bounded * 32768) : Math.round(bounded * 32767), true);
  });
  return output;
}

export function validateAudioCaptureSeconds(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 30) throw new Error('Audio capture duration must be a whole number from 1 to 30 seconds');
  return Number(value);
}
