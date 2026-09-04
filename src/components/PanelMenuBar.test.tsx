import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { PanelMenuBar, type PanelMenu } from './PanelMenuBar';

afterEach(cleanup);

const menus = (onSelect = vi.fn()): PanelMenu[] => [
  { id: 'document', label: 'Document', items: [
    { id: 'add', label: 'Add document', onSelect },
    { id: 'equb', label: 'Add EQUB source', onSelect },
    { id: 'binary', label: 'Download binary', onSelect, hint: '16 bytes', separated: true },
  ] },
  { id: 'edit', label: 'Edit', items: [
    { id: 'undo', label: 'Undo', onSelect, disabled: true },
    { id: 'colour', label: 'Edit colour', onSelect, checked: true },
    { id: 'mask', label: 'Edit opacity mask', onSelect, checked: false },
  ] },
  { id: 'empty', label: 'Frames', items: [] },
];

describe('a panel menu bar', () => {
  it('offers one tab stop for the whole bar, not one per action', () => {
    /* The row it replaces put every action in the tab order and across the top
     * of the panel; a menu bar is one stop with the rest behind it. */
    render(<PanelMenuBar label="Sprite actions" menus={menus()} />);
    const bar = screen.getByRole('menubar', { name: 'Sprite actions' });
    const buttons = within(bar).getAllByRole('menuitem');
    expect(buttons.map((button) => button.textContent)).toEqual(['Document', 'Edit']);
    expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
  });

  it('says nothing about a menu with nothing in it', () => {
    render(<PanelMenuBar label="Sprite actions" menus={menus()} />);
    expect(screen.queryByRole('menuitem', { name: 'Frames' })).toBeNull();
  });

  it('opens a menu, runs what was chosen, and closes again', () => {
    const onSelect = vi.fn();
    render(<PanelMenuBar label="Sprite actions" menus={menus(onSelect)} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Document' }));
    expect(screen.getByRole('menuitem', { name: 'Document' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('menuitem', { name: /Add EQUB source/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('is driven from the keyboard the way a menu bar is', () => {
    render(<PanelMenuBar label="Sprite actions" menus={menus()} />);
    const first = screen.getByRole('menuitem', { name: 'Document' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Edit' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(screen.getByRole('menu', { name: 'Edit' })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Edit' }));
  });

  it('marks a choice among alternatives rather than presenting it as an action', () => {
    render(<PanelMenuBar label="Sprite actions" menus={menus()} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(screen.getByRole('menuitemradio', { name: 'Edit colour' })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: 'Edit opacity mask' })).not.toBeChecked();
    expect(screen.getByRole('menuitem', { name: 'Undo' })).toBeDisabled();
  });

  it('closes when the pointer goes elsewhere, so it does not eat the next click', () => {
    render(<><PanelMenuBar label="Sprite actions" menus={menus()} /><button type="button">Elsewhere</button></>);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Document' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
