/* Rectangular selection and clipboard, once, for every editor that has a grid.
 *
 * The pixel editor had this and the map and screen editors did not, and the
 * reason it had not spread is that the original was quietly specific: it
 * refused any value above 3, which is a four-colour assumption. That is correct
 * for MODE 5 artwork and wrong for MODE 2, and meaningless for a map, where the
 * numbers are tile indices rather than colours.
 *
 * So a clipboard now carries two things it did not: what kind of grid the
 * values came from, and the bound they were valid against. Both are checked on
 * paste, and both refusals matter for the same reason. Tile indices pasted into
 * pixel data would be accepted silently by anything that only counted values —
 * they are small numbers either way — and would produce artwork nobody drew.
 * Sixteen-colour artwork pasted into a four-colour asset would either be
 * clamped, losing what somebody drew, or written out of range, producing a
 * build that does not match what the editor showed.
 *
 * Neither is guessed at. A paste that cannot be done exactly is refused, and
 * the refusal says which value was the problem.
 */

export interface GridPoint { x: number; y: number }
export interface GridSelection { start: GridPoint; end: GridPoint }

/** What the numbers in a grid mean, so one kind is never pasted into another. */
export type GridKind = 'pixels' | 'tiles' | 'screen';

export const GRID_CLIPBOARD_SCHEMA = '8bit-net.grid-selection' as const;

export interface GridClipboard {
  schema: typeof GRID_CLIPBOARD_SCHEMA;
  version: 1;
  kind: GridKind;
  width: number;
  height: number;
  values: number[];
  /**
   * The exclusive upper bound the values were valid against when copied — the
   * colour count of the mode, or the number of tiles in the set.
   */
  valueLimit: number;
}

export class GridSelectionError extends Error {
  constructor(message: string) { super(message); this.name = 'GridSelectionError'; }
}

export function selectionBounds(selection: GridSelection) {
  return {
    left: Math.min(selection.start.x, selection.end.x),
    top: Math.min(selection.start.y, selection.end.y),
    right: Math.max(selection.start.x, selection.end.x),
    bottom: Math.max(selection.start.y, selection.end.y),
  };
}

export function selectionContains(selection: GridSelection, x: number, y: number): boolean {
  const bounds = selectionBounds(selection);
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

export function selectionSize(selection: GridSelection): { width: number; height: number } {
  const bounds = selectionBounds(selection);
  return { width: bounds.right - bounds.left + 1, height: bounds.bottom - bounds.top + 1 };
}

/** Lift a rectangle out of a grid, recording what it was and what it held. */
export function copySelection(
  values: readonly number[],
  grid: { width: number; height: number; kind: GridKind; valueLimit: number },
  selection: GridSelection,
): GridClipboard {
  const bounds = selectionBounds(selection);
  if (bounds.left < 0 || bounds.top < 0 || bounds.right >= grid.width || bounds.bottom >= grid.height) {
    throw new GridSelectionError('That selection lies outside the grid.');
  }
  const { width, height } = selectionSize(selection);
  const copied = Array.from({ length: width * height }, (_, index) => {
    const x = bounds.left + (index % width);
    const y = bounds.top + Math.floor(index / width);
    return values[y * grid.width + x] ?? 0;
  });
  return { schema: GRID_CLIPBOARD_SCHEMA, version: 1, kind: grid.kind, width, height, values: copied, valueLimit: grid.valueLimit };
}

/** Read a clipboard, refusing anything that is not one rather than repairing it. */
export function parseGridClipboard(value: string | unknown): GridClipboard {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { throw new GridSelectionError('The clipboard does not hold a grid selection.'); }
  }
  const record = parsed as Partial<GridClipboard> | null;
  if (!record || record.schema !== GRID_CLIPBOARD_SCHEMA || record.version !== 1) {
    throw new GridSelectionError('The clipboard does not hold a grid selection of a kind this build reads.');
  }
  if (!['pixels', 'tiles', 'screen'].includes(record.kind as string)) {
    throw new GridSelectionError(`The clipboard says it holds "${String(record.kind)}", which this build does not model.`);
  }
  if (!Number.isInteger(record.width) || !Number.isInteger(record.height) || record.width! < 1 || record.height! < 1) {
    throw new GridSelectionError('The clipboard does not say what shape it is.');
  }
  if (!Array.isArray(record.values) || record.values.length !== record.width! * record.height!) {
    throw new GridSelectionError('The clipboard holds a different number of values from the shape it declares.');
  }
  if (!Number.isInteger(record.valueLimit) || record.valueLimit! < 1) {
    throw new GridSelectionError('The clipboard does not say what range its values were valid against.');
  }
  if (record.values.some((item) => !Number.isInteger(item) || item < 0 || item >= record.valueLimit!)) {
    throw new GridSelectionError('The clipboard holds a value outside the range it declares.');
  }
  return {
    schema: GRID_CLIPBOARD_SCHEMA, version: 1, kind: record.kind as GridKind,
    width: record.width!, height: record.height!, values: [...record.values], valueLimit: record.valueLimit!,
  };
}

/**
 * Put a clipboard down, or say exactly why it cannot go there.
 *
 * Anything outside the destination is trimmed, which is ordinary. What is not
 * ordinary — a different kind of grid, or a value the destination has no room
 * for — is refused, because both would produce something nobody drew.
 */
export function pasteSelection(
  values: readonly number[],
  grid: { width: number; height: number; kind: GridKind; valueLimit: number },
  clipboard: GridClipboard | string,
  destination: GridPoint,
): number[] {
  const parsed = parseGridClipboard(clipboard);
  if (parsed.kind !== grid.kind) {
    throw new GridSelectionError(`That clipboard holds ${parsed.kind} and this is a grid of ${grid.kind}. The numbers would fit and would mean something else entirely, so it is refused rather than pasted.`);
  }
  const tooLarge = parsed.values.find((item) => item >= grid.valueLimit);
  if (tooLarge !== undefined) {
    throw new GridSelectionError(`That clipboard holds the value ${tooLarge} and this grid goes up to ${grid.valueLimit - 1}. Pasting it would either lose what was drawn or write something out of range, so it is refused rather than clamped.`);
  }

  const result = [...values];
  for (let y = 0; y < parsed.height; y += 1) {
    for (let x = 0; x < parsed.width; x += 1) {
      const targetX = destination.x + x;
      const targetY = destination.y + y;
      if (targetX < 0 || targetY < 0 || targetX >= grid.width || targetY >= grid.height) continue;
      result[targetY * grid.width + targetX] = parsed.values[y * parsed.width + x]!;
    }
  }
  return result;
}

/** Set every cell of a rectangle to one value — the cut half of cut and paste. */
export function fillSelection(
  values: readonly number[],
  gridWidth: number,
  selection: GridSelection,
  value: number,
): number[] {
  return values.map((item, index) => (selectionContains(selection, index % gridWidth, Math.floor(index / gridWidth)) ? value : item));
}

/**
 * What a selection would be described as, for a status line or a screen reader.
 *
 * Given in cells rather than in pixels-on-the-machine, because this is the
 * editing grid and conflating the two is how somebody ends up surprised by the
 * shape of what they drew.
 */
export function describeSelection(selection: GridSelection): string {
  const bounds = selectionBounds(selection);
  const { width, height } = selectionSize(selection);
  return `${width} by ${height} cells, from ${bounds.left + 1},${bounds.top + 1} to ${bounds.right + 1},${bounds.bottom + 1}`;
}
