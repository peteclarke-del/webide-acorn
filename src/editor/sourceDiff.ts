export type SourceDiffKind = 'unchanged' | 'added' | 'removed';

export interface SourceDiffRow {
  kind: SourceDiffKind;
  beforeLine?: number;
  afterLine?: number;
  text: string;
}

export interface SourceDiff {
  rows: SourceDiffRow[];
  added: number;
  removed: number;
  exact: boolean;
}

const MAX_DIFF_MATRIX_CELLS = 250_000;

export function sourceLineDiff(before: string, after: string): SourceDiff {
  const left = before.split('\n');
  const right = after.split('\n');
  if (left.length * right.length > MAX_DIFF_MATRIX_CELLS) return alignedSourceDiff(left, right);

  const width = right.length + 1;
  const table = new Uint32Array((left.length + 1) * width);
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      const cell = leftIndex * width + rightIndex;
      table[cell] = left[leftIndex] === right[rightIndex]
        ? table[(leftIndex + 1) * width + rightIndex + 1]! + 1
        : Math.max(table[(leftIndex + 1) * width + rightIndex]!, table[leftIndex * width + rightIndex + 1]!);
    }
  }

  const rows: SourceDiffRow[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length || rightIndex < right.length) {
    if (leftIndex < left.length && rightIndex < right.length && left[leftIndex] === right[rightIndex]) {
      rows.push({ kind: 'unchanged', beforeLine: leftIndex + 1, afterLine: rightIndex + 1, text: left[leftIndex]! });
      leftIndex += 1; rightIndex += 1;
    } else if (rightIndex < right.length && (leftIndex === left.length || table[leftIndex * width + rightIndex + 1]! >= table[(leftIndex + 1) * width + rightIndex]!)) {
      rows.push({ kind: 'added', afterLine: rightIndex + 1, text: right[rightIndex]! });
      rightIndex += 1;
    } else {
      rows.push({ kind: 'removed', beforeLine: leftIndex + 1, text: left[leftIndex]! });
      leftIndex += 1;
    }
  }
  return summarize(rows, true);
}

function alignedSourceDiff(left: string[], right: string[]): SourceDiff {
  const rows: SourceDiffRow[] = [];
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (left[index] === right[index] && left[index] !== undefined) rows.push({ kind: 'unchanged', beforeLine: index + 1, afterLine: index + 1, text: left[index]! });
    else {
      if (left[index] !== undefined) rows.push({ kind: 'removed', beforeLine: index + 1, text: left[index]! });
      if (right[index] !== undefined) rows.push({ kind: 'added', afterLine: index + 1, text: right[index]! });
    }
  }
  return summarize(rows, false);
}

function summarize(rows: SourceDiffRow[], exact: boolean): SourceDiff {
  return { rows, added: rows.filter((row) => row.kind === 'added').length, removed: rows.filter((row) => row.kind === 'removed').length, exact };
}
