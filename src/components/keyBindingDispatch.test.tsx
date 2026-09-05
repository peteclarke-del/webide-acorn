import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import type { ProjectFile } from '../project/project';
import { SourceWorkspace } from './SourceWorkspace';
import { resolveKeyBindings, type KeyBindingOverrides } from '../commands/keyBindings';

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

/* Proves the settings surface changes real dispatch: the editor obeys the
 * resolved binding table rather than a private hard-coded chord list. */
function Harness({ overrides = {} as KeyBindingOverrides, onSave = () => {} }) {
  const [files, setFiles] = useState<ProjectFile[]>([{
    id: 'main', name: 'main.bas', content: '10 PRINT "A"\n20 PRINT "B"', language: 'bbc-basic', modified: false,
  }]);
  return <SourceWorkspace
    keyBindings={resolveKeyBindings(overrides)}
    files={files}
    activeFileId="main"
    onSelectFile={() => undefined}
    onChange={(id, content) => setFiles((current) => current.map((file) => file.id === id ? { ...file, content } : file))}
    onNewFile={() => undefined}
    onRenameFile={() => undefined}
    onDeleteFile={() => undefined}
    onDownloadFile={() => undefined}
    onSave={onSave}
    onCaretChange={() => undefined}
    onNotice={() => undefined}
  />;
}

const editor = () => screen.getByLabelText('Edit main.bas');
const findOpen = () => !!screen.queryByRole('search');

describe('editor key binding dispatch', () => {
  it('opens find on the default chord', () => {
    render(<Harness />);
    fireEvent.keyDown(editor(), { key: 'f', ctrlKey: true });
    expect(findOpen()).toBe(true);
  });

  it('moves the command to a remapped chord and abandons the replaced default', () => {
    render(<Harness overrides={{ 'editor.find': 'Ctrl+Alt+8' }} />);
    fireEvent.keyDown(editor(), { key: 'f', ctrlKey: true });
    expect(findOpen()).toBe(false);
    fireEvent.keyDown(editor(), { key: '8', ctrlKey: true, altKey: true });
    expect(findOpen()).toBe(true);
  });

  it('stops dispatching an unbound command entirely', () => {
    render(<Harness overrides={{ 'editor.find': null }} />);
    fireEvent.keyDown(editor(), { key: 'f', ctrlKey: true });
    expect(findOpen()).toBe(false);
  });

  it('leaves a project-search chord to the workbench instead of opening the local find', () => {
    render(<Harness />);
    const event = fireEvent.keyDown(editor(), { key: 'F', ctrlKey: true, shiftKey: true });
    expect(findOpen()).toBe(false);
    expect(event).toBe(true);
  });

  it('leaves an unclaimed chord to the browser rather than consuming it', () => {
    render(<Harness />);
    expect(fireEvent.keyDown(editor(), { key: 'q', ctrlKey: true, altKey: true })).toBe(true);
  });

  it('dispatches a remapped save through the same table', () => {
    const onSave = vi.fn();
    render(<Harness overrides={{ 'editor.save': 'Ctrl+Alt+9' }} onSave={onSave} />);
    fireEvent.keyDown(editor(), { key: 's', ctrlKey: true });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.keyDown(editor(), { key: '9', ctrlKey: true, altKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe('two-stroke sequences in the editor', () => {
  it('runs the command only after the second stroke', () => {
    /* The first stroke does nothing visible and, crucially, does not run the
     * single-stroke command that shares its chord. */
    render(<Harness overrides={{ 'editor.find': 'Ctrl+K, Ctrl+F' }} />);
    fireEvent.keyDown(editor(), { key: 'k', code: 'KeyK', ctrlKey: true });
    expect(findOpen()).toBe(false);
    fireEvent.keyDown(editor(), { key: 'f', code: 'KeyF', ctrlKey: true });
    expect(findOpen()).toBe(true);
  });

  it('abandons the prefix when the second stroke is not part of any sequence', () => {
    /* And the abandoned prefix must not then be completed by a later key: a
     * sequence that finished itself minutes afterwards is the failure that
     * makes people stop trusting them. */
    render(<Harness overrides={{ 'editor.find': 'Ctrl+K, Ctrl+F' }} />);
    fireEvent.keyDown(editor(), { key: 'k', code: 'KeyK', ctrlKey: true });
    fireEvent.keyDown(editor(), { key: 'x', code: 'KeyX', ctrlKey: true });
    expect(findOpen()).toBe(false);
    fireEvent.keyDown(editor(), { key: 'f', code: 'KeyF', ctrlKey: true });
    expect(findOpen()).toBe(false);
  });

  it('leaves the replaced single-stroke default doing nothing', () => {
    render(<Harness overrides={{ 'editor.find': 'Ctrl+K, Ctrl+F' }} />);
    fireEvent.keyDown(editor(), { key: 'f', code: 'KeyF', ctrlKey: true });
    expect(findOpen()).toBe(false);
  });
});

describe('Command and Control as separate keys', () => {
  it('answers a Command press with the shared binding, as it always has', () => {
    render(<Harness />);
    fireEvent.keyDown(editor(), { key: 'f', code: 'KeyF', metaKey: true });
    expect(findOpen()).toBe(true);
  });

  it('runs the Command-specific binding in preference to the shared one', () => {
    render(<Harness overrides={{ 'editor.find': 'Cmd+J' }} />);
    /* Control does not reach a binding that named Command. */
    fireEvent.keyDown(editor(), { key: 'j', code: 'KeyJ', ctrlKey: true });
    expect(findOpen()).toBe(false);
    fireEvent.keyDown(editor(), { key: 'j', code: 'KeyJ', metaKey: true });
    expect(findOpen()).toBe(true);
  });
});
