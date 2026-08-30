// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { NOT_CAPTURED, UNCAPTURED_READING, resolveAudioDigest, resolveAudioSpeaker, type AudioCaptureReading } from './audioAssertionModel';

const heard: AudioCaptureReading = {
  digest: 'AE6CA46A', writes: 2, speakerTransitions: 4, speakerAvailable: true, captured: true,
};
/* A capture that ran and heard nothing. The digest is the FNV-1a offset basis,
 * which is the same number the fallback reports when nothing ran at all. */
const silence: AudioCaptureReading = { ...UNCAPTURED_READING, captured: true };

describe('an assertion about sound that was measured', () => {
  it('passes on the digest the capture produced and carries the write count', () => {
    expect(resolveAudioDigest(heard, 'AE6CA46A')).toEqual({ actual: 'AE6CA46A', writes: 2, passed: true });
  });

  it('fails on a different digest, showing what was heard instead', () => {
    expect(resolveAudioDigest(heard, 'DEADBEEF')).toEqual({ actual: 'AE6CA46A', writes: 2, passed: false });
  });

  it('lets a program assert that it made no sound at all', () => {
    /* Silence is a real result and a program is entitled to assert it — but
     * only because the capture ran, which is the whole point of the flag. */
    expect(resolveAudioDigest(silence, '811C9DC5')).toEqual({ actual: '811C9DC5', writes: 0, passed: true });
  });

  it('compares speaker transitions that were counted', () => {
    expect(resolveAudioSpeaker(heard, 4)).toEqual({ actual: 4, passed: true });
    expect(resolveAudioSpeaker(heard, 3)).toEqual({ actual: 4, passed: false });
  });
});

describe('an assertion about sound nobody listened for', () => {
  it('refuses rather than comparing against a silence it never observed', () => {
    /* This is the case the flag exists for: the digest here is byte-identical
     * to the one the silence reading carries, and that reading passes above.
     * Without the flag this assertion would pass too, on no evidence. */
    expect(UNCAPTURED_READING.digest).toBe(silence.digest);
    expect(resolveAudioDigest(UNCAPTURED_READING, '811C9DC5')).toEqual({ actual: NOT_CAPTURED, writes: 0, passed: false });
  });

  it('refuses a speaker count for the same reason', () => {
    expect(resolveAudioSpeaker({ ...UNCAPTURED_READING, speakerAvailable: true }, 0)).toEqual({ actual: NOT_CAPTURED, passed: false });
  });

  it('reports no writes rather than a write count nobody measured', () => {
    expect(resolveAudioDigest({ ...UNCAPTURED_READING, writes: 99 }, 'X').writes).toBe(0);
  });
});
