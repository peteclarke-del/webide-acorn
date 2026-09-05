import { describe, expect, it } from 'vitest';
import { BrowserAudio } from './browserAudio';

describe('browser audio test capture', () => {
  it('hashes exact sound-chip writes without requiring an audio output device', async () => {
    const audio = new BrowserAudio(false, 2_000_000);
    const soundChip = audio.soundChip as unknown as { poke(value: number): void };
    audio.beginTestCapture();
    soundChip.poke(0x9f);
    soundChip.poke(0x80);
    expect(audio.endTestCapture()).toEqual({ digest: 'AE6CA46A', writes: 2, speakerTransitions: 0, speakerAvailable: false, captured: true });

    soundChip.poke(0xff);
    expect(audio.endTestCapture()).toEqual({ digest: 'AE6CA46A', writes: 2, speakerTransitions: 0, speakerAvailable: false, captured: true });
    await audio.close();
  });

  it('resets the digest and write count for every test', async () => {
    const audio = new BrowserAudio(false, 2_000_000);
    const soundChip = audio.soundChip as unknown as { poke(value: number): void };
    audio.beginTestCapture();
    expect(audio.endTestCapture()).toEqual({ digest: '811C9DC5', writes: 0, speakerTransitions: 0, speakerAvailable: false, captured: true });
    audio.beginTestCapture();
    soundChip.poke(0);
    expect(audio.endTestCapture()).toEqual({ digest: '050C5D1F', writes: 1, speakerTransitions: 0, speakerAvailable: false, captured: true });
    await audio.close();
  });
  it('counts real one-bit speaker transitions on an Atom, and says the machine has one', async () => {
    const audio = new BrowserAudio(true, 1_000_000);
    const speaker = (audio.soundChip as unknown as { speakerGenerator: { pushBit(bit: number, cycles: number, seconds: number): void } }).speakerGenerator;
    expect(audio.speakerAvailable).toBe(true);
    audio.beginTestCapture();
    /* The emulated PPIA raises this only when the line changes level, so each
     * call is one transition. */
    speaker.pushBit(1, 100, 0.0001);
    speaker.pushBit(0, 200, 0.0002);
    speaker.pushBit(1, 300, 0.0003);
    const result = audio.endTestCapture();
    expect(result.speakerTransitions).toBe(3);
    expect(result.speakerAvailable).toBe(true);
    await audio.close();
  });

  it('reports no speaker on a sound-chip machine rather than a transition count of zero that looks real', async () => {
    const audio = new BrowserAudio(false, 2_000_000);
    expect(audio.speakerAvailable).toBe(false);
    await audio.close();
  });

  it('resets the transition count for every capture', async () => {
    const audio = new BrowserAudio(true, 1_000_000);
    const speaker = (audio.soundChip as unknown as { speakerGenerator: { pushBit(bit: number, cycles: number, seconds: number): void } }).speakerGenerator;
    audio.beginTestCapture();
    speaker.pushBit(1, 10, 0.00001);
    expect(audio.endTestCapture().speakerTransitions).toBe(1);
    audio.beginTestCapture();
    expect(audio.endTestCapture().speakerTransitions).toBe(0);
    await audio.close();
  });
});

describe('telling silence from never having listened', () => {
  it('reports a capture that never started, which returns the same digest as one that heard nothing', () => {
    /* The reset test above ends a capture that heard nothing and gets
     * 811C9DC5 — the FNV offset basis. So does this, having never captured at
     * all. The flag is the only thing separating them, and without it an
     * assertion would compare against a silence it never observed. */
    const audio = new BrowserAudio(false, 2_000_000);
    const result = audio.endTestCapture();
    expect(result.digest).toBe('811C9DC5');
    expect(result.captured).toBe(false);
  });
});
