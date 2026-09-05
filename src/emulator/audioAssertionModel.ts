/* An audio capture that ran and heard nothing returns the FNV-1a offset basis,
 * 811C9DC5. So does a session that had no capture running at all, and so does
 * the fallback used when there is no audio device to capture from. Those three
 * are the same number, which means an assertion written against silence would
 * pass on a session that never listened — the strongest kind of false green,
 * because it looks like evidence.
 *
 * This is the one place that decides what an audio assertion may conclude, so
 * that the distinction cannot be lost by an edit to the branch that once
 * resolved it inline.
 */

/** What a capture reports back, whether or not one actually ran. */
export interface AudioCaptureReading {
  digest: string;
  writes: number;
  speakerTransitions: number;
  speakerAvailable: boolean;
  /** Whether these numbers came from a capture that actually ran. */
  captured: boolean;
}

/** Said in place of a value, so a report never shows a number nobody measured. */
export const NOT_CAPTURED = 'not captured — this session had no sound capture running';

/** The reading to use when there was no audio device to capture from at all. */
export const UNCAPTURED_READING: AudioCaptureReading = {
  digest: '811C9DC5', writes: 0, speakerTransitions: 0, speakerAvailable: false, captured: false,
};

export interface ResolvedAudioAssertion {
  actual: string | number;
  passed: boolean;
  writes?: number;
}

/** Resolves an `AUDIO[WRITES]` assertion against a capture reading. */
export function resolveAudioDigest(reading: AudioCaptureReading, expected: string): ResolvedAudioAssertion {
  if (!reading.captured) return { actual: NOT_CAPTURED, writes: 0, passed: false };
  return { actual: reading.digest, writes: reading.writes, passed: reading.digest === expected };
}

/** Resolves a speaker-transition assertion against a capture reading. */
export function resolveAudioSpeaker(reading: AudioCaptureReading, expected: number): ResolvedAudioAssertion {
  /* A speaker assertion on a machine with no speaker is refused when the plan
   * is validated, before a run starts, so there is no second refusal here. */
  if (!reading.captured) return { actual: NOT_CAPTURED, passed: false };
  return { actual: reading.speakerTransitions, passed: reading.speakerTransitions === expected };
}
