/* How wide and how tall each workbench panel is, and what may change it.
 *
 * The workbench used to describe its columns as eight hardcoded permutations of
 * which panels were open, each with a fixed width. That was survivable while
 * the text was small. It stopped being survivable once the type scale was
 * raised for readability: the same controls need more room, and a panel that
 * cannot be widened, narrowed or put away leaves options that cannot be reached
 * at all on a smaller screen.
 *
 * The sizes live here rather than in the component so that the rules about them
 * — what the minimum useful width of each panel is, what happens when several
 * panels together would leave no editor, how a drag or an arrow key changes
 * them — can be checked without a rendered workbench and cannot disagree with
 * the ones the workbench applies.
 */

export type PanelId = 'config' | 'explorer' | 'inspector' | 'runtime';

export type PanelSizes = Record<PanelId, number>;

/** The width, or for the runtime panel the height, each panel starts at. */
export const DEFAULT_PANEL_SIZES: Readonly<PanelSizes> = Object.freeze({
  config: 286,
  explorer: 215,
  inspector: 286,
  runtime: 300,
});

/**
 * What each panel may be resized to.
 *
 * The minimums are the width below which the panel's own controls start to
 * clip rather than merely look cramped; somebody who wants less than that
 * wants the panel closed, which is a different control. The maximums stop a
 * drag from taking the whole window, and the editor's own floor below stops
 * several panels together from doing it.
 */
export const PANEL_BOUNDS: Readonly<Record<PanelId, { min: number; max: number }>> = Object.freeze({
  config: { min: 210, max: 620 },
  explorer: { min: 170, max: 560 },
  inspector: { min: 210, max: 620 },
  runtime: { min: 130, max: 1200 },
});

/** The narrowest the editor is allowed to become while panels are resized. */
export const MINIMUM_EDITOR_WIDTH = 320;

/** The shortest the editor is allowed to become while the runtime is resized. */
export const MINIMUM_EDITOR_HEIGHT = 200;

/** Width of the activity rail, which is not resizable. */
export const ACTIVITY_RAIL_WIDTH = 43;

/**
 * The grab area between two panels.
 *
 * A separator is a column of the grid rather than something laid over the
 * panels, so it cannot be clipped by a panel that scrolls and cannot cover a
 * control at the panel's edge.
 */
export const SEPARATOR_SIZE = 5;

export const PANEL_SIZES_KEY = '8bit-net-dev-panel-sizes-1';

export interface PanelOpenState {
  config: boolean;
  explorer: boolean;
  inspector: boolean;
  runtime: boolean;
}

const round = (value: number) => Math.round(value);

/** `value` brought inside the panel's own bounds. */
export function clampPanelSize(panel: PanelId, value: number): number {
  const bounds = PANEL_BOUNDS[panel];
  if (!Number.isFinite(value)) return DEFAULT_PANEL_SIZES[panel];
  return round(Math.min(bounds.max, Math.max(bounds.min, value)));
}

/**
 * The sizes after one panel is asked to become `value`, given how much room
 * there is and which panels are open.
 *
 * A panel is never allowed to squeeze the editor below its floor, because an
 * editor too narrow to read is worse than a panel too narrow to use, and the
 * person resizing can always close a panel instead.
 */
export function resizePanel(
  sizes: PanelSizes,
  open: PanelOpenState,
  panel: PanelId,
  value: number,
  available: { width: number; height: number },
): PanelSizes {
  const wanted = clampPanelSize(panel, value);
  if (panel === 'runtime') {
    const room = Math.max(PANEL_BOUNDS.runtime.min, available.height - MINIMUM_EDITOR_HEIGHT - SEPARATOR_SIZE);
    return { ...sizes, runtime: Math.min(wanted, round(room)) };
  }
  const others = (['config', 'explorer', 'inspector'] as const)
    .filter((other) => other !== panel && open[other])
    .reduce((total, other) => total + sizes[other], 0);
  const separators = ((open.config ? 1 : 0) + (open.explorer ? 1 : 0) + (open.inspector ? 1 : 0)) * SEPARATOR_SIZE;
  const room = round(available.width - ACTIVITY_RAIL_WIDTH - separators - others - MINIMUM_EDITOR_WIDTH);
  /* A resize may not push the editor below its floor, but it may not make the
   * layout worse either: in a window too small for the panels already open,
   * refusing to grow is right and shrinking the panel somebody is dragging
   * larger is not. Making a panel smaller is always allowed. */
  const ceiling = Math.max(sizes[panel], room, PANEL_BOUNDS[panel].min);
  return { ...sizes, [panel]: Math.min(wanted, ceiling) };
}

/**
 * The grid columns for the workbench, in the order the panels are laid out.
 *
 * Only the open panels appear, so a closed panel takes no room at all rather
 * than a zero-width column that still draws its border.
 */
export function workbenchColumns(open: PanelOpenState, sizes: PanelSizes): string {
  const columns = [`${ACTIVITY_RAIL_WIDTH}px`];
  if (open.config) columns.push(`${clampPanelSize('config', sizes.config)}px`, `${SEPARATOR_SIZE}px`);
  if (open.explorer) columns.push(`${clampPanelSize('explorer', sizes.explorer)}px`, `${SEPARATOR_SIZE}px`);
  columns.push(`minmax(${MINIMUM_EDITOR_WIDTH}px, 1fr)`);
  if (open.inspector) columns.push(`${SEPARATOR_SIZE}px`, `${clampPanelSize('inspector', sizes.inspector)}px`);
  return columns.join(' ');
}

/** The rows for the editor and the machine runtime beneath it. */
export function workspaceRows(open: PanelOpenState, sizes: PanelSizes): string {
  if (!open.runtime) return 'minmax(0, 1fr)';
  return `minmax(${MINIMUM_EDITOR_HEIGHT}px, 1fr) ${SEPARATOR_SIZE}px ${clampPanelSize('runtime', sizes.runtime)}px`;
}

/** Every size brought inside its bounds, whatever arrived. */
export function normalizePanelSizes(value: unknown): PanelSizes {
  const candidate = (value && typeof value === 'object' ? value : {}) as Partial<Record<PanelId, unknown>>;
  const sizes = { ...DEFAULT_PANEL_SIZES } as PanelSizes;
  for (const panel of Object.keys(DEFAULT_PANEL_SIZES) as PanelId[]) {
    const supplied = candidate[panel];
    if (typeof supplied === 'number') sizes[panel] = clampPanelSize(panel, supplied);
  }
  return sizes;
}

export function readPanelSizes(storage: { getItem(key: string): string | null }): PanelSizes {
  try {
    const raw = storage.getItem(PANEL_SIZES_KEY);
    return raw ? normalizePanelSizes(JSON.parse(raw)) : { ...DEFAULT_PANEL_SIZES };
  } catch {
    return { ...DEFAULT_PANEL_SIZES };
  }
}

export function writePanelSizes(sizes: PanelSizes, storage: { setItem(key: string, value: string): void }): boolean {
  try {
    storage.setItem(PANEL_SIZES_KEY, JSON.stringify(normalizePanelSizes(sizes)));
    return true;
  } catch {
    return false;
  }
}

/** How far one press of an arrow key moves a separator. */
export const KEYBOARD_RESIZE_STEP = 16;

/**
 * The size a separator key press asks for, or null when the key is not one a
 * separator handles.
 *
 * A separator that can only be dragged cannot be used without a pointer, and
 * the workbench is meant to be usable from the keyboard throughout.
 */
export function resizeByKey(key: string, panel: PanelId, current: number, before: boolean): number | null {
  /* `before` says the panel sits before the separator, so growing it means
   * moving the separator away from the panel rather than towards it. */
  const grow = before ? 1 : -1;
  const moves: Record<string, number | undefined> = {
    ArrowRight: panel === 'runtime' ? undefined : grow * KEYBOARD_RESIZE_STEP,
    ArrowLeft: panel === 'runtime' ? undefined : -grow * KEYBOARD_RESIZE_STEP,
    ArrowDown: panel === 'runtime' ? grow * KEYBOARD_RESIZE_STEP : undefined,
    ArrowUp: panel === 'runtime' ? -grow * KEYBOARD_RESIZE_STEP : undefined,
  };
  const delta = moves[key];
  if (delta === undefined) {
    if (key === 'Home') return PANEL_BOUNDS[panel].min;
    if (key === 'End') return PANEL_BOUNDS[panel].max;
    if (key === 'Enter' || key === ' ') return DEFAULT_PANEL_SIZES[panel];
    return null;
  }
  return current + delta;
}
