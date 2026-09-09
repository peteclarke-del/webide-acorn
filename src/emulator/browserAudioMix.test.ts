import { describe, expect, it } from 'vitest';
import { mixSampleSource } from './browserAudio';

/** A source that hands back a fixed run of samples, one per call. */
const source = (values: number[]) => { let at = 0; return { sample: () => values[at++] ?? 0 }; };

describe('mixing a second chip into the machine output', () => {
  it('takes one sample per output sample so a chip with its own clock stays in step', () => {
    const buffer = new Float32Array([0, 0, 0, 0]);
    mixSampleSource(buffer, source([0.1, 0.2, 0.3, 0.4]));
    expect(Array.from(buffer)).toEqual([0.1, 0.2, 0.3, 0.4].map((value) => Math.fround(value)));
  });

  it('adds to what the sound chip already put there rather than replacing it', () => {
    const buffer = new Float32Array([0.5, -0.5]);
    mixSampleSource(buffer, source([0.25, 0.25]));
    expect(buffer[0]).toBeCloseTo(0.75, 5);
    expect(buffer[1]).toBeCloseTo(-0.25, 5);
  });

  it('clips rather than wraps, because two chips at full output exceed the format', () => {
    const buffer = new Float32Array([0.9, -0.9]);
    mixSampleSource(buffer, source([0.9, -0.9]));
    expect(buffer[0]).toBe(1);
    expect(buffer[1]).toBe(-1);
  });

  it('leaves the buffer alone when the source is silent', () => {
    const buffer = new Float32Array([0.3, -0.2]);
    mixSampleSource(buffer, source([0, 0]));
    expect(buffer[0]).toBeCloseTo(0.3, 5);
    expect(buffer[1]).toBeCloseTo(-0.2, 5);
  });
});
