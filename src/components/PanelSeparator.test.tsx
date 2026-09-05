import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { PanelSeparator } from './PanelSeparator';
import { DEFAULT_PANEL_SIZES, PANEL_BOUNDS } from '../layout/panelLayout';

afterEach(cleanup);

const separator = (over: Partial<Parameters<typeof PanelSeparator>[0]> = {}) => {
  const onResize = vi.fn();
  render(
    <PanelSeparator
      panel="explorer"
      orientation="vertical"
      before
      label="Resize the project explorer"
      size={220}
      onResize={onResize}
      {...over}
    />,
  );
  return { onResize, node: screen.getByRole('separator') };
};

describe('the handle between two panels', () => {
  it('says what it resizes and where that size sits in its range', () => {
    const { node } = separator();
    expect(node).toHaveAttribute('aria-label', 'Resize the project explorer');
    expect(node).toHaveAttribute('aria-orientation', 'vertical');
    expect(node).toHaveAttribute('aria-valuenow', '220');
    expect(node).toHaveAttribute('aria-valuemin', String(PANEL_BOUNDS.explorer.min));
    expect(node).toHaveAttribute('aria-valuemax', String(PANEL_BOUNDS.explorer.max));
  });

  it('can be moved without a pointer, which is the whole reason it takes focus', () => {
    const { onResize, node } = separator();
    expect(node).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(node, { key: 'ArrowRight' });
    expect(onResize).toHaveBeenCalledWith('explorer', 236);
    fireEvent.keyDown(node, { key: 'ArrowLeft' });
    expect(onResize).toHaveBeenCalledWith('explorer', 204);
  });

  it('offers the extremes and a way back from a drag somebody regrets', () => {
    const { onResize, node } = separator();
    fireEvent.keyDown(node, { key: 'Home' });
    expect(onResize).toHaveBeenCalledWith('explorer', PANEL_BOUNDS.explorer.min);
    fireEvent.keyDown(node, { key: 'End' });
    expect(onResize).toHaveBeenCalledWith('explorer', PANEL_BOUNDS.explorer.max);
    fireEvent.doubleClick(node);
    expect(onResize).toHaveBeenCalledWith('explorer', DEFAULT_PANEL_SIZES.explorer);
  });

  it('leaves a key it does not handle to whatever else wants it', () => {
    const { onResize, node } = separator();
    fireEvent.keyDown(node, { key: 'Tab' });
    fireEvent.keyDown(node, { key: 'a' });
    expect(onResize).not.toHaveBeenCalled();
  });

  /* This environment has no PointerEvent, so `fireEvent.pointerDown` sends a
   * bare Event carrying neither a button nor a coordinate and no drag could be
   * described at all. A MouseEvent of the same type carries both and is what
   * the handler reads, so the drag is exercised rather than skipped. */
  const pointer = (node: HTMLElement, type: string, init: MouseEventInit) => {
    node.setPointerCapture ??= vi.fn();
    node.hasPointerCapture ??= vi.fn(() => true);
    node.releasePointerCapture ??= vi.fn();
    fireEvent(node, new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
  };

  it('reports the size a drag asks for, in the direction the panel lies', () => {
    const { onResize, node } = separator();
    pointer(node, 'pointerdown', { button: 0, clientX: 300 });
    pointer(node, 'pointermove', { clientX: 360 });
    expect(onResize).toHaveBeenLastCalledWith('explorer', 280);
    pointer(node, 'pointerup', { clientX: 360 });
    /* A move after the drag ended is not a resize. */
    onResize.mockClear();
    pointer(node, 'pointermove', { clientX: 400 });
    expect(onResize).not.toHaveBeenCalled();
  });

  it('drags the other way for a panel that lies after it', () => {
    const { onResize, node } = separator({ panel: 'inspector', before: false, label: 'Resize the inspector' });
    pointer(node, 'pointerdown', { button: 0, clientX: 300 });
    pointer(node, 'pointermove', { clientX: 360 });
    expect(onResize).toHaveBeenLastCalledWith('inspector', 160);
  });

  it('ignores a press that is not the primary button', () => {
    const { onResize, node } = separator();
    pointer(node, 'pointerdown', { button: 2, clientX: 300 });
    pointer(node, 'pointermove', { clientX: 360 });
    expect(onResize).not.toHaveBeenCalled();
  });
});
