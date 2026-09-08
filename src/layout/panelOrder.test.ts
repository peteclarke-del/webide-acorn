import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PANEL_ORDER, EDITOR_SLOT, SIDE_PANELS,
  canMovePanel, laidOutSlots, movePanel, normalizePanelOrder, panelSide, separatorBefore,
  readPanelOrder, workbenchColumns, writePanelOrder,
  DEFAULT_PANEL_SIZES, type LayoutSlot, type PanelOpenState,
} from './panelLayout';

/*
 * Where the panels sit, and why it is one list rather than a side per panel.
 *
 * A side per panel cannot say what order two panels on the same side are in
 * without a second field, and the two fields can then disagree. One ordered
 * list says both at once: a panel's side is whether it comes before or after
 * the editor, and moving it is swapping with a neighbour. Crossing the editor
 * is not a special case. It falls out of the swap, which is what makes
 * pressing the same button again do the obvious thing.
 */
const allOpen: PanelOpenState = { config: true, explorer: true, inspector: true, runtime: false };

/** Grid columns split on the spaces between tracks, not the ones inside them. */
function tracks(template: string): string[] {
  return template.match(/(?:[^\s(]+\([^)]*\)|\S+)/g) ?? [];
}

describe('the order the panels are laid out in', () => {
  it('starts with two panels left of the editor and one right', () => {
    expect([...DEFAULT_PANEL_ORDER]).toEqual(['config', 'explorer', EDITOR_SLOT, 'inspector']);
    expect(panelSide('config')).toBe('left');
    expect(panelSide('explorer')).toBe('left');
    expect(panelSide('inspector')).toBe('right');
  });

  it('moves a panel one place, and swapping with the editor changes its side', () => {
    const once = movePanel(DEFAULT_PANEL_ORDER, 'inspector', 'left');
    expect(once).toEqual(['config', 'explorer', 'inspector', EDITOR_SLOT]);
    expect(panelSide('inspector', once)).toBe('left');
    const twice = movePanel(once, 'inspector', 'left');
    expect(twice).toEqual(['config', 'inspector', 'explorer', EDITOR_SLOT]);
    expect(panelSide('inspector', twice)).toBe('left');
  });

  it('takes a panel back across the editor the same way', () => {
    const left = movePanel(DEFAULT_PANEL_ORDER, 'explorer', 'right');
    expect(left).toEqual(['config', EDITOR_SLOT, 'explorer', 'inspector']);
    expect(panelSide('explorer', left)).toBe('right');
  });

  it('refuses to move past either end, and says so before being asked', () => {
    expect(canMovePanel(DEFAULT_PANEL_ORDER, 'config', 'left')).toBe(false);
    expect(movePanel(DEFAULT_PANEL_ORDER, 'config', 'left')).toEqual([...DEFAULT_PANEL_ORDER]);
    expect(canMovePanel(DEFAULT_PANEL_ORDER, 'inspector', 'right')).toBe(false);
    expect(movePanel(DEFAULT_PANEL_ORDER, 'inspector', 'right')).toEqual([...DEFAULT_PANEL_ORDER]);
    expect(canMovePanel(DEFAULT_PANEL_ORDER, 'config', 'right')).toBe(true);
  });

  it('keeps every panel and the editor however mangled the stored value', () => {
    /* A stored order is a thing a person can edit. A workbench that renders
     * nothing because a key was mistyped is worse than one that ignores it. */
    for (const bad of [null, undefined, 'left', 42, [], ['nonsense'], ['config', 'config'], [EDITOR_SLOT]]) {
      const order = normalizePanelOrder(bad);
      expect(order, String(bad)).toHaveLength(4);
      expect(new Set(order).size, String(bad)).toBe(4);
      for (const slot of [...SIDE_PANELS, EDITOR_SLOT]) expect(order, String(bad)).toContain(slot);
    }
  });

  it('keeps what a partial order does say, and puts the rest back where it starts', () => {
    expect(normalizePanelOrder(['inspector', EDITOR_SLOT])).toEqual(['inspector', EDITOR_SLOT, 'config', 'explorer']);
  });
});

describe('laying the order out', () => {
  it('puts a separator between neighbours and none at either end', () => {
    const columns = tracks(workbenchColumns(allOpen, DEFAULT_PANEL_SIZES));
    /* rail, config, sep, explorer, sep, editor, sep, inspector */
    expect(columns).toHaveLength(8);
    expect(columns[0]).toBe('43px');
    expect(columns.filter((column) => column === '5px')).toHaveLength(3);
    expect(columns.at(-1)).toBe('286px');
  });

  it('follows a changed order rather than the default', () => {
    const moved = movePanel(DEFAULT_PANEL_ORDER, 'inspector', 'left');
    const columns = tracks(workbenchColumns(allOpen, DEFAULT_PANEL_SIZES, moved));
    /* The editor is last now, so nothing follows it. */
    expect(columns.at(-1)).toMatch(/^minmax/);
  });

  it('gives a closed panel no column and no separator', () => {
    const open: PanelOpenState = { ...allOpen, explorer: false };
    const columns = tracks(workbenchColumns(open, DEFAULT_PANEL_SIZES));
    expect(columns).toHaveLength(6);
    expect(columns.filter((column) => column === '5px')).toHaveLength(2);
    expect(laidOutSlots(open)).toEqual(['config', EDITOR_SLOT, 'inspector']);
  });

  it('lays out the editor alone when every panel is shut', () => {
    const shut: PanelOpenState = { config: false, explorer: false, inspector: false, runtime: false };
    expect(laidOutSlots(shut)).toEqual([EDITOR_SLOT]);
    expect(tracks(workbenchColumns(shut, DEFAULT_PANEL_SIZES))).toHaveLength(2);
  });

  it('agrees with itself about how many separators there are', () => {
    /* The columns and the elements are generated from the same list precisely
     * so they cannot disagree, which shows up as everything after the mistake
     * being one column out. */
    for (const order of [DEFAULT_PANEL_ORDER, movePanel(DEFAULT_PANEL_ORDER, 'inspector', 'left'), normalizePanelOrder(['inspector', 'config', EDITOR_SLOT, 'explorer'])]) {
      for (const open of [allOpen, { ...allOpen, config: false }, { ...allOpen, inspector: false }]) {
        const slots = laidOutSlots(open, order);
        const columns = tracks(workbenchColumns(open, DEFAULT_PANEL_SIZES, order));
        expect(columns).toHaveLength(1 + slots.length + Math.max(0, slots.length - 1));
      }
    }
  });
});

describe('remembering the order', () => {
  function storage() {
    const held = new Map<string, string>();
    return { getItem: (key: string) => held.get(key) ?? null, setItem: (key: string, value: string) => { held.set(key, value); } };
  }

  it('reads back what was written', () => {
    const store = storage();
    const moved = movePanel(DEFAULT_PANEL_ORDER, 'inspector', 'left') as LayoutSlot[];
    expect(writePanelOrder(moved, store)).toBe(true);
    expect(readPanelOrder(store)).toEqual(moved);
  });

  it('falls back to the default where nothing was stored or the value is corrupt', () => {
    expect(readPanelOrder(storage())).toEqual([...DEFAULT_PANEL_ORDER]);
    const store = storage();
    store.setItem('8bit-net-dev-panel-order-1', 'not json');
    expect(readPanelOrder(store)).toEqual([...DEFAULT_PANEL_ORDER]);
  });

  it('survives a browser that refuses storage', () => {
    const refusing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readPanelOrder(refusing)).toEqual([...DEFAULT_PANEL_ORDER]);
    expect(writePanelOrder(DEFAULT_PANEL_ORDER, refusing)).toBe(false);
  });
});

describe('which panel a separator resizes', () => {
  /*
   * Always the panel on its side away from the editor, so dragging the line
   * between a panel and the editor makes that panel wider rather than moving
   * the editor. Left of the editor that is the slot before the separator;
   * right of it, the slot after.
   */
  it('resizes the panel on its outward side, on both sides of the editor', () => {
    const slots = laidOutSlots(allOpen);
    expect(slots).toEqual(['config', 'explorer', EDITOR_SLOT, 'inspector']);
    expect(separatorBefore(slots, 1)).toEqual({ panel: 'config', before: true });
    expect(separatorBefore(slots, 2)).toEqual({ panel: 'explorer', before: true });
    expect(separatorBefore(slots, 3)).toEqual({ panel: 'inspector', before: false });
  });

  it('draws nothing before the first slot', () => {
    expect(separatorBefore(laidOutSlots(allOpen), 0)).toBeNull();
  });

  it('follows a panel that has crossed the editor', () => {
    const moved = movePanel(DEFAULT_PANEL_ORDER, 'explorer', 'right');
    const slots = laidOutSlots(allOpen, moved);
    expect(slots).toEqual(['config', EDITOR_SLOT, 'explorer', 'inspector']);
    expect(separatorBefore(slots, 1)).toEqual({ panel: 'config', before: true });
    expect(separatorBefore(slots, 2)).toEqual({ panel: 'explorer', before: false });
    expect(separatorBefore(slots, 3)).toEqual({ panel: 'inspector', before: false });
  });

  it('gives every gap a separator and every separator a panel', () => {
    for (const order of [DEFAULT_PANEL_ORDER, movePanel(DEFAULT_PANEL_ORDER, 'inspector', 'left')]) {
      const slots = laidOutSlots(allOpen, order);
      for (let index = 1; index < slots.length; index += 1) {
        expect(separatorBefore(slots, index), `gap ${index}`).not.toBeNull();
      }
    }
  });
});
