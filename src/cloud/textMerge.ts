/*
 * Merging two edits to the same text, and refusing when it cannot be done.
 *
 * The dangerous outcome here is not a conflict, it is a merge that looks clean
 * and is wrong. So this only takes a side where exactly one side changed a
 * region; where both changed the same region differently, it reports a
 * conflict and hands back both versions rather than choosing. Choosing would
 * be this build deciding which of somebody's two edits mattered.
 *
 * Line-based, because source is lines and a character-level merge of assembly
 * produces regions no one can review.
 */

export interface MergeRegion {
  /** Lines agreed by both sides, or taken from the one side that changed. */
  lines: string[];
}

export interface MergeConflict {
  /** Where the conflict starts in the merged output, counting from 1. */
  line: number;
  base: string[];
  ours: string[];
  theirs: string[];
}

export interface MergeResult {
  merged: string;
  conflicts: MergeConflict[];
  /** True when nothing had to be chosen between: safe to write without review. */
  clean: boolean;
}

function splitLines(text: string): string[] {
  /* A trailing newline is a line ending rather than an empty line, and losing
   * or inventing one changes the file for no reason anybody asked for. */
  return text.split('\n');
}

/** Longest common subsequence of two line lists, as index pairs. */
function commonSubsequence(left: readonly string[], right: readonly string[]): Array<[number, number]> {
  const lengths: number[][] = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
  for (let index = left.length - 1; index >= 0; index -= 1) {
    for (let other = right.length - 1; other >= 0; other -= 1) {
      lengths[index]![other] = left[index] === right[other]
        ? lengths[index + 1]![other + 1]! + 1
        : Math.max(lengths[index + 1]![other]!, lengths[index]![other + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let index = 0;
  let other = 0;
  while (index < left.length && other < right.length) {
    if (left[index] === right[other]) { pairs.push([index, other]); index += 1; other += 1; }
    else if (lengths[index + 1]![other]! >= lengths[index]![other + 1]!) index += 1;
    else other += 1;
  }

  return pairs;
}

/** Which lines of `base` survive unchanged in `side`, as a map from base index. */
function alignment(base: readonly string[], side: readonly string[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const [baseIndex, sideIndex] of commonSubsequence(base, side)) map.set(baseIndex, sideIndex);

  return map;
}

/**
 * Three-way merge.
 *
 * `base` is the common ancestor — the revision both sides started from. Without
 * it there is no way to tell an addition from a deletion, so a two-way merge is
 * not offered: it would have to guess.
 */
export function mergeText(base: string, ours: string, theirs: string): MergeResult {
  const baseLines = splitLines(base);
  const ourLines = splitLines(ours);
  const theirLines = splitLines(theirs);
  if (ours === theirs) return { merged: ours, conflicts: [], clean: true };
  if (base === ours) return { merged: theirs, conflicts: [], clean: true };
  if (base === theirs) return { merged: ours, conflicts: [], clean: true };

  const ourAlignment = alignment(baseLines, ourLines);
  const theirAlignment = alignment(baseLines, theirLines);
  /* Anchors are base lines both sides kept, in order. Between two anchors each
   * side may have done anything, and that region is what has to be judged. */
  const anchors: number[] = [];
  let lastOur = -1;
  let lastTheir = -1;
  for (let index = 0; index < baseLines.length; index += 1) {
    const ourIndex = ourAlignment.get(index);
    const theirIndex = theirAlignment.get(index);
    if (ourIndex === undefined || theirIndex === undefined) continue;
    if (ourIndex <= lastOur || theirIndex <= lastTheir) continue;
    anchors.push(index);
    lastOur = ourIndex;
    lastTheir = theirIndex;
  }

  const merged: string[] = [];
  const conflicts: MergeConflict[] = [];
  let baseCursor = 0;
  let ourCursor = 0;
  let theirCursor = 0;

  const takeRegion = (baseEnd: number, ourEnd: number, theirEnd: number) => {
    const baseSlice = baseLines.slice(baseCursor, baseEnd);
    const ourSlice = ourLines.slice(ourCursor, ourEnd);
    const theirSlice = theirLines.slice(theirCursor, theirEnd);
    const weChanged = ourSlice.join('\n') !== baseSlice.join('\n');
    const theyChanged = theirSlice.join('\n') !== baseSlice.join('\n');
    if (weChanged && theyChanged) {
      if (ourSlice.join('\n') === theirSlice.join('\n')) merged.push(...ourSlice);
      else {
        conflicts.push({ line: merged.length + 1, base: baseSlice, ours: ourSlice, theirs: theirSlice });
        /* Both versions are kept, marked, so a person can see what was in
         * conflict rather than being told one was discarded. */
        merged.push('<<<<<<< yours', ...ourSlice, '=======', ...theirSlice, '>>>>>>> the store');
      }
    } else if (weChanged) merged.push(...ourSlice);
    else merged.push(...theirSlice);
  };

  for (const anchor of anchors) {
    takeRegion(anchor, ourAlignment.get(anchor)!, theirAlignment.get(anchor)!);
    merged.push(baseLines[anchor]!);
    baseCursor = anchor + 1;
    ourCursor = ourAlignment.get(anchor)! + 1;
    theirCursor = theirAlignment.get(anchor)! + 1;
  }
  takeRegion(baseLines.length, ourLines.length, theirLines.length);

  return { merged: merged.join('\n'), conflicts, clean: conflicts.length === 0 };
}
