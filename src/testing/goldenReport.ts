/* Saying where a golden differs, not only how much.
 *
 * A count of differing pixels and a worst-channel figure tell somebody that
 * their picture changed and nothing about what changed. Two failures with
 * identical numbers — one where a caption moved by a pixel, one where a whole
 * sprite vanished — read the same, and the person has to squint at two images
 * to tell them apart.
 *
 * So a report locates the difference: the box it fits in, where the worst pixel
 * is, and whether the differing pixels are gathered in one place or scattered.
 * Those three answer the question somebody actually has, which is "is this the
 * thing I just changed, or is it something else".
 *
 * The audio half exists for the same reason. A digest mismatch on a stream of
 * sound-chip writes says only that the sound is not what it was; the useful
 * answer is which write first differed, because that points at the instruction
 * that wrote it.
 */
import { base64ToBytes } from './screenAssertion';

export interface DifferenceRegion {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface DifferenceLocation {
  /** The smallest box holding every differing pixel. */
  bounds: DifferenceRegion | null;
  /** Where the single worst pixel is, and how far out it is. */
  worst: { x: number; y: number; channelDelta: number } | null;
  differingPixels: number;
  /**
   * What fraction of the bounding box actually differs. A caption that shifted
   * fills its box; a few scattered pixels do not, and the difference between
   * those two is usually the difference between one cause and another.
   */
  density: number;
  /** Said in words, for a report somebody reads rather than parses. */
  summary: string;
}

/**
 * Locate the difference between two images of the same size.
 *
 * Tolerance is applied the same way the comparison applies it, so what this
 * calls a differing pixel is what the assertion called one.
 */
export function locateDifference(
  expectedRgbaBase64: string,
  actualRgbaBase64: string,
  width: number,
  height: number,
  allowedChannelDelta: number,
): DifferenceLocation {
  const expected = base64ToBytes(expectedRgbaBase64);
  const actual = base64ToBytes(actualRgbaBase64);
  if (expected.length !== actual.length) throw new Error('Those two images are not the same size, so they cannot be compared pixel for pixel.');
  if (expected.length !== width * height * 4) throw new Error(`A ${width} by ${height} image is ${width * height * 4} bytes and these are ${expected.length}.`);

  let left = width; let top = height; let right = -1; let bottom = -1;
  let differingPixels = 0;
  let worst: DifferenceLocation['worst'] = null;

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    let delta = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      delta = Math.max(delta, Math.abs(actual[offset + channel]! - expected[offset + channel]!));
    }
    if (delta <= allowedChannelDelta) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    differingPixels += 1;
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
    if (!worst || delta > worst.channelDelta) worst = { x, y, channelDelta: delta };
  }

  if (!differingPixels) {
    return { bounds: null, worst: null, differingPixels: 0, density: 0, summary: 'The two images agree within the tolerance allowed.' };
  }

  const bounds: DifferenceRegion = {
    left, top, right, bottom,
    width: right - left + 1,
    height: bottom - top + 1,
  };
  const density = differingPixels / (bounds.width * bounds.height);
  const shape = density > 0.5
    ? 'gathered into one area, which usually means something moved or changed wholesale'
    : density > 0.1
      ? 'spread across that area rather than filling it'
      : 'scattered thinly, which usually means a colour or timing difference rather than a change of content';

  return {
    bounds,
    worst,
    differingPixels,
    density: Math.round(density * 1000) / 1000,
    summary: `${differingPixels.toLocaleString()} pixel${differingPixels === 1 ? '' : 's'} differ, inside a ${bounds.width} by ${bounds.height} box at ${bounds.left},${bounds.top}. They are ${shape}. The worst is at ${worst!.x},${worst!.y}, out by ${worst!.channelDelta}.`,
  };
}

export interface AudioWriteDifference {
  /** The first write that differs, which points at the instruction that wrote it. */
  firstDifferingIndex: number | null;
  expectedLength: number;
  actualLength: number;
  differingWrites: number;
  /** A few writes either side of the first difference, for context. */
  context: Array<{ index: number; expected: number | null; actual: number | null }>;
  summary: string;
}

/** How many writes either side of a difference are worth showing. */
const AUDIO_CONTEXT = 4;

/**
 * Compare two streams of sound-chip writes.
 *
 * A digest says only that the sound is not what it was. The first differing
 * write is what points at the instruction responsible, and a stream that is
 * simply shorter than expected is a different fault from one that is the same
 * length and says something else.
 */
export function compareAudioWrites(expected: readonly number[], actual: readonly number[]): AudioWriteDifference {
  const length = Math.max(expected.length, actual.length);
  let firstDifferingIndex: number | null = null;
  let differingWrites = 0;
  for (let index = 0; index < length; index += 1) {
    if (expected[index] === actual[index]) continue;
    differingWrites += 1;
    if (firstDifferingIndex === null) firstDifferingIndex = index;
  }

  const context: AudioWriteDifference['context'] = [];
  if (firstDifferingIndex !== null) {
    const from = Math.max(0, firstDifferingIndex - AUDIO_CONTEXT);
    const to = Math.min(length, firstDifferingIndex + AUDIO_CONTEXT + 1);
    for (let index = from; index < to; index += 1) {
      context.push({ index, expected: expected[index] ?? null, actual: actual[index] ?? null });
    }
  }

  const summary = firstDifferingIndex === null
    ? `Both streams hold the same ${expected.length.toLocaleString()} writes.`
    : expected.length !== actual.length
      ? `${differingWrites.toLocaleString()} of ${length.toLocaleString()} writes differ, first at index ${firstDifferingIndex}. The expected stream holds ${expected.length.toLocaleString()} writes and this run produced ${actual.length.toLocaleString()}, so the program is driving the sound chip a different number of times.`
      : `${differingWrites.toLocaleString()} of ${length.toLocaleString()} writes differ, first at index ${firstDifferingIndex}. Both streams are the same length, so the program is writing as often as before and writing something else.`;

  return { firstDifferingIndex, expectedLength: expected.length, actualLength: actual.length, differingWrites, context, summary };
}
