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
 * (what the minimum useful width of each panel is, what happens when several
 * panels together would leave no editor, how a drag or an arrow key changes
 * them) can be checked without a rendered workbench and cannot disagree with
 * the ones the workbench applies.
 */

export type PanelId = 'config' | 'explorer' | 'inspector' | 'runtime';

export type PanelSizes = Record<PanelId, number>;

/** The panels that sit beside the editor. The runtime is below it and stays. */
export type SidePanelId = 'config' | 'explorer' | 'inspector';

/** The editor's place in the order, which is a slot rather than a panel. */
export const EDITOR_SLOT = 'editor';
export type LayoutSlot = SidePanelId | typeof EDITOR_SLOT;

/*
 * Where the panels sit, as one sequence with the editor somewhere in it.
 *
 * The obvious model is a side per panel, left or right, and it is the wrong
 * one, because it cannot say what order two panels on the same side are in
 * without a second field, and the two fields can then disagree. One ordered
 * list says both things at once: which side a panel is on is simply whether it
 * comes before or after the editor, and moving a panel is swapping it with its
 * neighbour. A panel that runs out of room on its side crosses the editor and
 * is on the other one, which is the behaviour somebody expects from pressing
 * the same button again rather than a special case to write.
 *
 * The runtime is not here. It is below the editor and the width sequence has
 * nothing to say about it.
 */
export const DEFAULT_PANEL_ORDER: readonly LayoutSlot[] = Object.freeze(['config', 'explorer', EDITOR_SLOT, 'inspector']);

export const SIDE_PANELS: readonly SidePanelId[] = Object.freeze(['config', 'explorer', 'inspector']);

export const PANEL_ORDER_KEY = '8bit-net-dev-panel-order-1';

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
export function workbenchColumns(open: PanelOpenState, sizes: PanelSizes, order: readonly LayoutSlot[] = DEFAULT_PANEL_ORDER): string {
  const columns = [`${ACTIVITY_RAIL_WIDTH}px`];
  for (const slot of normalizePanelOrder(order)) {
    if (slot === EDITOR_SLOT) {
      if (columns.length > 1) columns.push(`${SEPARATOR_SIZE}px`);
      columns.push(`minmax(${MINIMUM_EDITOR_WIDTH}px, 1fr)`);
      continue;
    }
    if (!open[slot]) continue;
    if (columns.length > 1) columns.push(`${SEPARATOR_SIZE}px`);
    columns.push(`${clampPanelSize(slot, sizes[slot])}px`);
  }
  return columns.join(' ');
}

/**
 * The slots actually laid out, in order, with the closed panels dropped.
 *
 * The workbench renders from this rather than working out for itself which
 * separators belong where, so the columns and the elements cannot disagree
 * about how many there are, which shows up as everything after the mistake
 * being one column out.
 */
export function laidOutSlots(open: PanelOpenState, order: readonly LayoutSlot[] = DEFAULT_PANEL_ORDER): LayoutSlot[] {
  return normalizePanelOrder(order).filter((slot) => slot === EDITOR_SLOT || open[slot]);
}

/**
 * The separator that precedes the slot at `index`, and which panel it resizes.
 *
 * A separator always resizes the panel on its side away from the editor, so
 * dragging it makes that panel wider or narrower rather than moving the editor
 *, which is what somebody grabbing the line between a panel and the editor
 * expects. Left of the editor that is the slot before the separator; right of
 * it, the slot after.
 *
 * Returns null before the first slot, where there is no separator to draw.
 */
export function separatorBefore(
  slots: readonly LayoutSlot[],
  index: number,
): { panel: SidePanelId; before: boolean } | null {
  if (index <= 0 || index >= slots.length) return null;
  const editorAt = slots.indexOf(EDITOR_SLOT);
  const candidate = index <= editorAt ? slots[index - 1] : slots[index];
  if (!candidate || candidate === EDITOR_SLOT) return null;
  return { panel: candidate, before: index <= editorAt };
}

/** Which side of the editor a panel is on. */
export function panelSide(panel: SidePanelId, order: readonly LayoutSlot[] = DEFAULT_PANEL_ORDER): 'left' | 'right' {
  const slots = normalizePanelOrder(order);
  return slots.indexOf(panel) < slots.indexOf(EDITOR_SLOT) ? 'left' : 'right';
}

/**
 * The order after `panel` is moved one place towards `direction`.
 *
 * Swapping with the neighbour is the whole rule, including when the neighbour
 * is the editor: a panel at the inside edge of the left group swaps with the
 * editor and is on the right, which is what pressing the button again should
 * do. A panel already at the outside edge does not move, and the caller is
 * expected to have disabled the control rather than relying on this.
 */
export function movePanel(order: readonly LayoutSlot[], panel: SidePanelId, direction: 'left' | 'right'): LayoutSlot[] {
  const slots = normalizePanelOrder(order);
  const at = slots.indexOf(panel);
  const to = direction === 'left' ? at - 1 : at + 1;
  if (at < 0 || to < 0 || to >= slots.length) return slots;
  const moved = [...slots];
  moved[at] = slots[to]!;
  moved[to] = panel;
  return moved;
}

/** Whether a move would change anything, which is what disables the control. */
export function canMovePanel(order: readonly LayoutSlot[], panel: SidePanelId, direction: 'left' | 'right'): boolean {
  const slots = normalizePanelOrder(order);
  const at = slots.indexOf(panel);
  return direction === 'left' ? at > 0 : at >= 0 && at < slots.length - 1;
}

/**
 * Any stored value turned into an order that can be laid out.
 *
 * A stored order is a thing a person can edit, and a workbench that renders
 * nothing because a key was mistyped is worse than one that ignores the file.
 * Every panel appears exactly once and the editor exactly once, whatever
 * arrived: unknown names are dropped, duplicates keep their first place, and
 * anything missing is put back where it starts.
 */
export function normalizePanelOrder(value: unknown): LayoutSlot[] {
  const supplied = Array.isArray(value) ? value : [];
  const wanted = new Set<LayoutSlot>([...SIDE_PANELS, EDITOR_SLOT]);
  const seen = new Set<LayoutSlot>();
  const order: LayoutSlot[] = [];
  for (const entry of supplied) {
    if (typeof entry !== 'string') continue;
    const slot = entry as LayoutSlot;
    if (!wanted.has(slot) || seen.has(slot)) continue;
    seen.add(slot);
    order.push(slot);
  }
  for (const slot of DEFAULT_PANEL_ORDER) if (!seen.has(slot)) order.push(slot);
  return order;
}

export function readPanelOrder(storage: { getItem(key: string): string | null }): LayoutSlot[] {
  try {
    const raw = storage.getItem(PANEL_ORDER_KEY);
    return raw ? normalizePanelOrder(JSON.parse(raw)) : [...DEFAULT_PANEL_ORDER];
  } catch {
    return [...DEFAULT_PANEL_ORDER];
  }
}

export function writePanelOrder(order: readonly LayoutSlot[], storage: { setItem(key: string, value: string): void }): boolean {
  try {
    storage.setItem(PANEL_ORDER_KEY, JSON.stringify(normalizePanelOrder(order)));
    return true;
  } catch {
    return false;
  }
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
