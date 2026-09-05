import { describe, expect, it, vi } from 'vitest';
import {
  ACTIVITY_RAIL_WIDTH, DEFAULT_PANEL_SIZES, MINIMUM_EDITOR_HEIGHT, MINIMUM_EDITOR_WIDTH,
  PANEL_BOUNDS, PANEL_SIZES_KEY, SEPARATOR_SIZE, clampPanelSize, normalizePanelSizes, readPanelSizes,
  resizeByKey, resizePanel, workbenchColumns, workspaceRows, writePanelSizes,
  type PanelOpenState, type PanelSizes,
} from './panelLayout';

const allOpen: PanelOpenState = { config: true, explorer: true, inspector: true, runtime: true };
const sizes = (): PanelSizes => ({ ...DEFAULT_PANEL_SIZES });
const wide = { width: 1600, height: 900 };

describe('how wide the workbench panels are', () => {
  it('lays out only the panels that are open', () => {
    expect(workbenchColumns(allOpen, sizes())).toBe('43px 286px 5px 215px 5px minmax(320px, 1fr) 5px 286px');
    expect(workbenchColumns({ ...allOpen, config: false, inspector: false }, sizes()))
      .toBe('43px 215px 5px minmax(320px, 1fr)');
    /* A closed panel takes no column at all, rather than a zero-width one that
     * still draws its border. */
    expect(workbenchColumns({ config: false, explorer: false, inspector: false, runtime: false }, sizes()))
      .toBe('43px minmax(320px, 1fr)');
  });

  it('gives the editor the whole height when the machine runtime is put away', () => {
    expect(workspaceRows(allOpen, sizes())).toBe('minmax(200px, 1fr) 5px 300px');
    expect(workspaceRows({ ...allOpen, runtime: false }, sizes())).toBe('minmax(0, 1fr)');
  });
});

describe('resizing a panel', () => {
  it('keeps a panel inside its own bounds', () => {
    expect(resizePanel(sizes(), allOpen, 'explorer', 10, wide).explorer).toBe(PANEL_BOUNDS.explorer.min);
    expect(resizePanel(sizes(), allOpen, 'explorer', 99_999, wide).explorer).toBe(PANEL_BOUNDS.explorer.max);
    expect(clampPanelSize('config', Number.NaN)).toBe(DEFAULT_PANEL_SIZES.config);
  });

  it('never squeezes the editor below the width it can be read at', () => {
    /* An editor too narrow to read is worse than a panel too narrow to use,
     * and somebody who wants the room can close a panel instead. */
    const room = { width: 1400, height: 800 };
    const grown = resizePanel(sizes(), allOpen, 'config', PANEL_BOUNDS.config.max, room);
    const used = ACTIVITY_RAIL_WIDTH + 3 * SEPARATOR_SIZE + grown.config + grown.explorer + grown.inspector;
    expect(room.width - used).toBeGreaterThanOrEqual(MINIMUM_EDITOR_WIDTH);
  });

  it('refuses to grow rather than shrinking what somebody is dragging larger', () => {
    /* In a window already too small for the panels that are open, the honest
     * answer to "make this wider" is to leave it where it is. Shrinking the
     * panel being dragged outwards would be the opposite of what was asked. */
    const cramped = { width: 1000, height: 800 };
    const before = sizes();
    expect(resizePanel(before, allOpen, 'config', 600, cramped).config).toBe(before.config);
    /* Making one smaller is always allowed, and frees the room. */
    expect(resizePanel(before, allOpen, 'config', 220, cramped).config).toBe(220);
  });

  it('gives a panel more room once its neighbours are closed', () => {
    const narrow = { width: 1000, height: 800 };
    const alone: PanelOpenState = { config: true, explorer: false, inspector: false, runtime: true };
    expect(resizePanel(sizes(), alone, 'config', 600, narrow).config)
      .toBeGreaterThan(resizePanel(sizes(), allOpen, 'config', 600, narrow).config);
  });

  it('never reports a panel narrower than it can be drawn', () => {
    /* The window is simply too small for what is open; the panel can be closed,
     * but describing it as narrower than it draws would be a lie about the
     * layout. */
    const tiny = { width: 400, height: 300 };
    expect(resizePanel(sizes(), allOpen, 'config', 10, tiny).config).toBe(PANEL_BOUNDS.config.min);
  });

  it('leaves the editor a readable height when the machine runtime grows', () => {
    const short = { width: 1600, height: 600 };
    const grown = resizePanel(sizes(), allOpen, 'runtime', 1200, short);
    expect(short.height - grown.runtime - SEPARATOR_SIZE).toBeGreaterThanOrEqual(MINIMUM_EDITOR_HEIGHT);
  });
});

describe('resizing without a pointer', () => {
  it('moves a separator with the arrow keys in the direction it lies', () => {
    /* The explorer sits before its separator, so right grows it; the inspector
     * sits after its own, so right shrinks it. */
    expect(resizeByKey('ArrowRight', 'explorer', 200, true)).toBe(216);
    expect(resizeByKey('ArrowLeft', 'explorer', 200, true)).toBe(184);
    expect(resizeByKey('ArrowRight', 'inspector', 200, false)).toBe(184);
    expect(resizeByKey('ArrowLeft', 'inspector', 200, false)).toBe(216);
  });

  it('moves the machine runtime separator up and down instead', () => {
    expect(resizeByKey('ArrowUp', 'runtime', 300, false)).toBe(316);
    expect(resizeByKey('ArrowDown', 'runtime', 300, false)).toBe(284);
    expect(resizeByKey('ArrowRight', 'runtime', 300, false)).toBeNull();
  });

  it('offers the extremes and a way back to the default', () => {
    expect(resizeByKey('Home', 'config', 300, true)).toBe(PANEL_BOUNDS.config.min);
    expect(resizeByKey('End', 'config', 300, true)).toBe(PANEL_BOUNDS.config.max);
    expect(resizeByKey('Enter', 'config', 300, true)).toBe(DEFAULT_PANEL_SIZES.config);
    expect(resizeByKey(' ', 'config', 300, true)).toBe(DEFAULT_PANEL_SIZES.config);
  });

  it('says nothing for a key a separator does not handle', () => {
    expect(resizeByKey('a', 'config', 300, true)).toBeNull();
    expect(resizeByKey('Escape', 'config', 300, true)).toBeNull();
  });
});

describe('remembering the sizes somebody chose', () => {
  it('reads what was stored and repairs what was not', () => {
    expect(readPanelSizes({ getItem: () => JSON.stringify({ config: 400, explorer: 9 }) }))
      .toMatchObject({ config: 400, explorer: PANEL_BOUNDS.explorer.min, inspector: DEFAULT_PANEL_SIZES.inspector });
    expect(readPanelSizes({ getItem: () => '{broken' })).toEqual({ ...DEFAULT_PANEL_SIZES });
    expect(readPanelSizes({ getItem: () => null })).toEqual({ ...DEFAULT_PANEL_SIZES });
    expect(normalizePanelSizes('nonsense')).toEqual({ ...DEFAULT_PANEL_SIZES });
  });

  it('writes only sizes it would accept back, and reports a refusal', () => {
    const setItem = vi.fn();
    expect(writePanelSizes({ ...DEFAULT_PANEL_SIZES, config: 99_999 }, { setItem })).toBe(true);
    expect(setItem).toHaveBeenCalledWith(PANEL_SIZES_KEY, JSON.stringify({ ...DEFAULT_PANEL_SIZES, config: PANEL_BOUNDS.config.max }));
    expect(writePanelSizes(DEFAULT_PANEL_SIZES, { setItem: () => { throw new Error('quota'); } })).toBe(false);
  });
});
