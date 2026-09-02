import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { KeyboardShortcutsPanel } from './KeyboardShortcutsPanel';
import { resolveKeyBindings, type KeyBindingOverrides } from '../commands/keyBindings';

/* This panel renders the whole shortcut inventory — every command in both
 * dispatch scopes — and each of these tests renders it again and then queries
 * it by role, which walks the rendered table computing roles as it goes. The
 * file takes about nineteen seconds on an idle machine, with its slowest test
 * around four; on a loaded one that test passed the ten-second default and
 * failed the gate on a green tree. The work is real and none of it is skipped,
 * so it is given room rather than trimmed. */
vi.setConfig({ testTimeout: 30_000 });

afterEach(cleanup);

function Harness({ onNotice = () => {}, initial = {} as KeyBindingOverrides }) {
  const [overrides, setOverrides] = useState<KeyBindingOverrides>(initial);
  return <KeyboardShortcutsPanel bindings={resolveKeyBindings(overrides)} overrides={overrides} onChangeOverrides={setOverrides} onNotice={onNotice} />;
}

/* Rows are addressed by their exact command label so that a warning naming
 * another command cannot select the wrong row. */
function row(label: string): HTMLTableRowElement {
  const heading = screen.getAllByText(label, { selector: 'th > span' })[0];
  return heading!.closest('tr') as HTMLTableRowElement;
}

function chordOf(label: string): string {
  return row(label).querySelector('kbd')!.textContent!;
}

describe('KeyboardShortcutsPanel', () => {
  it('lists both dispatch scopes with their effective and default chords', () => {
    render(<Harness />);
    expect(screen.getByRole('heading', { level: 4, name: 'Workbench' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Source editor' })).toBeInTheDocument();
    expect(chordOf('Build selected target')).toBe('F7');
    expect(chordOf('Go to definition')).toBe('F12');
    expect(screen.getByRole('status')).toHaveTextContent('All bindings are at their defaults');
  });

  it('records a pressed chord and applies it to the real binding', () => {
    const onNotice = vi.fn();
    render(<Harness onNotice={onNotice} />);
    fireEvent.click(within(row('Build selected target')).getByRole('button', { name: 'Change' }));
    fireEvent.keyDown(screen.getByLabelText('Press the new chord for Build selected target'), { key: '7', ctrlKey: true, altKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(chordOf('Build selected target')).toBe('Ctrl+Alt+7');
    expect(onNotice).toHaveBeenCalledWith('Build selected target is now Ctrl+Alt+7');
    expect(screen.getByRole('status')).toHaveTextContent('1 customised binding');
  });

  it('refuses a chord that would capture ordinary typing', () => {
    render(<Harness />);
    fireEvent.click(within(row('Build selected target')).getByRole('button', { name: 'Change' }));
    fireEvent.keyDown(screen.getByLabelText('Press the new chord for Build selected target'), { key: 'q' });
    expect(screen.getByText(/cannot capture ordinary typing/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('reports a conflict against the other command that claims the chord', () => {
    const onNotice = vi.fn();
    render(<Harness onNotice={onNotice} />);
    fireEvent.click(within(row('Build selected target')).getByRole('button', { name: 'Change' }));
    fireEvent.keyDown(screen.getByLabelText('Press the new chord for Build selected target'), { key: 'F5' });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('still conflicts with Build and run selected target'));
    expect(row('Build selected target')).toHaveClass('binding-conflict');
    expect(screen.getByRole('status')).toHaveTextContent('2 conflicting bindings');
  });

  it('unbinds a chord and restores it from the declared default', () => {
    const onNotice = vi.fn();
    render(<Harness onNotice={onNotice} />);
    fireEvent.click(within(row('Find in current file')).getByRole('button', { name: 'Unbind' }));
    expect(chordOf('Find in current file')).toBe('Unbound');
    expect(onNotice).toHaveBeenCalledWith('Find in current file is unbound and no longer dispatches a chord');
    fireEvent.click(within(row('Find in current file')).getByRole('button', { name: 'Reset' }));
    expect(chordOf('Find in current file')).toBe('Ctrl+F');
  });

  it('restores every customised binding at once and filters the inventory', () => {
    const onNotice = vi.fn();
    render(<Harness onNotice={onNotice} initial={{ 'workbench.build-active': 'Ctrl+Alt+7', 'editor.find': null }} />);
    expect(screen.getByRole('status')).toHaveTextContent('2 customised bindings');
    fireEvent.change(screen.getByLabelText('Filter shortcuts'), { target: { value: 'bookmark' } });
    expect(screen.getAllByRole('row').filter((element) => element.querySelector('kbd'))).toHaveLength(3);
    fireEvent.change(screen.getByLabelText('Filter shortcuts'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset all to defaults' }));
    expect(onNotice).toHaveBeenCalledWith('Restored 2 shortcuts to their defaults');
    expect(chordOf('Build selected target')).toBe('F7');
    expect(screen.getByRole('button', { name: 'Reset all to defaults' })).toBeDisabled();
  });

  it('names the host that usually claims a browser-reserved chord', () => {
    render(<Harness />);
    expect(within(row('Close current source editor')).getByText(/Browsers may close the tab first/)).toBeInTheDocument();
  });
});

describe('what the panel says about the emulated machine', () => {
  it('says what a running machine types instead of running the command', () => {
    /* The surprising part is not that a chord collides — while a machine is
     * running they all do — but what the machine receives, which is the key
     * without its modifiers. */
    render(<Harness />);
    const save = row('Save current source in browser');
    const summary = within(save).getByText(/While the machine is running/, { selector: 'summary' });
    expect(summary).toHaveTextContent('this types S');
    fireEvent.click(summary);
    expect(within(save).getByText(/The machine receives S instead/)).toBeInTheDocument();
    expect(within(save).getByText(/never reaches the workbench/)).toBeInTheDocument();
  });

  it('says plainly when the Acorn keyboard has no such key', () => {
    render(<Harness initial={{ 'workbench.build-active': 'Ctrl+PageUp' }} />);
    const build = row('Build selected target');
    expect(within(build).getByText(/the Acorn keyboard has no PageUp/)).toBeInTheDocument();
  });
});

describe('recording a two-stroke sequence', () => {
  it('extends the recording on a second press and applies the sequence', () => {
    /* The only way to enter one: typing a comma into a field that is capturing
     * key presses is not something a person can do. */
    render(<Harness />);
    fireEvent.click(within(row('Save current source in browser')).getByRole('button', { name: 'Change' }));
    const field = screen.getByLabelText('Press the new chord for Save current source in browser');
    fireEvent.keyDown(field, { key: 'k', code: 'KeyK', ctrlKey: true });
    expect(field).toHaveValue('Ctrl+K');
    fireEvent.keyDown(field, { key: 's', code: 'KeyS', ctrlKey: true });
    expect(field).toHaveValue('Ctrl+K, Ctrl+S');

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(chordOf('Save current source in browser')).toBe('Ctrl+K, Ctrl+S');
  });

  it('starts over on a third press, so a mistake is one key from being fixed', () => {
    render(<Harness />);
    fireEvent.click(within(row('Save current source in browser')).getByRole('button', { name: 'Change' }));
    const field = screen.getByLabelText('Press the new chord for Save current source in browser');
    fireEvent.keyDown(field, { key: 'k', code: 'KeyK', ctrlKey: true });
    fireEvent.keyDown(field, { key: 's', code: 'KeyS', ctrlKey: true });
    fireEvent.keyDown(field, { key: 'b', code: 'KeyB', ctrlKey: true });
    expect(field).toHaveValue('Ctrl+B');
  });
});
