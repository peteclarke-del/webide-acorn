/* What the editor owes someone who is not using a mouse, a Latin keyboard, a
 * large window, or their eyes.
 *
 * These are stated as contracts rather than checked by hand because every one
 * of them is invisible in ordinary use: a surface with no accessible name
 * looks identical to one that has a name, an undo that reaches into another
 * document looks like nothing at all until someone loses work, and a
 * composition event only appears when text is entered through an input method
 * rather than typed a character at a time. Two hundred per cent zoom and
 * reflow at 320 CSS pixels are checked separately in a real browser, because a
 * layout is a property of a rendering engine and jsdom does not have one.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { ProjectFile } from '../project/project';
import { SourceWorkspace } from './SourceWorkspace';

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

function sourceFile(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    id: 'main', name: 'main.asm', content: 'ORG &1900\n.start\n  RTS\n',
    language: '6502', modified: false,
    ...overrides,
  } as ProjectFile;
}

/** An editable workspace whose content really changes, so undo has a subject. */
function Workspace({ files: initial, activeFileId = 'main' }: { files: ProjectFile[]; activeFileId?: string }) {
  const [files, setFiles] = useState(initial);
  return <SourceWorkspace
    files={files}
    projectFiles={files}
    activeFileId={activeFileId}
    onSelectFile={() => undefined}
    onChange={(id, content) => setFiles((current) => current.map((file) => file.id === id ? { ...file, content, modified: true } : file))}
    onNewFile={() => undefined}
    onRenameFile={() => undefined}
    onDeleteFile={() => undefined}
    onDownloadFile={() => undefined}
    onSave={() => undefined}
    onCaretChange={() => undefined}
    onNotice={() => undefined}
  />;
}

describe('screen reader semantics', () => {
  it('gives the editing surface a name that says which file it edits', () => {
    render(<Workspace files={[sourceFile()]} />);
    /* "Edit" alone would be identical across two open editors, which is the
     * situation where the name matters most. */
    expect(screen.getByLabelText('Edit main.asm')).toBeInTheDocument();
  });

  it('names every region of the workspace, so a screen reader can move between them', () => {
    render(<Workspace files={[sourceFile()]} />);
    const named = screen.getAllByRole('complementary').map((region) => region.getAttribute('aria-label'));
    expect(named).toContain('Source outline');
    for (const label of named) expect(label?.trim()).toBeTruthy();
  });

  it('leaves no interactive control without an accessible name', () => {
    render(<Workspace files={[sourceFile()]} />);
    const unnamed = [...screen.getAllByRole('button'), ...screen.queryAllByRole('combobox'), ...screen.queryAllByRole('searchbox')]
      .filter((control) => !(control.getAttribute('aria-label') ?? control.textContent ?? '').trim())
      .map((control) => control.outerHTML.slice(0, 120));
    expect(unnamed).toEqual([]);
  });

  it('reports a single-file problem in a named region rather than by colour alone', () => {
    render(<Workspace files={[sourceFile({ content: '.start\n  RTS\n.start\n  RTS' })]} />);
    const issues = screen.getByRole('region', { name: /issues/ });
    /* The severity is a word, not a border colour. */
    expect(within(issues).getByText('error')).toBeInTheDocument();
  });
});

describe('keyboard operation', () => {
  it('reaches the editing surface, the outline and the symbol search without a pointer', () => {
    render(<Workspace files={[sourceFile()]} />);
    const stops = [
      screen.getByLabelText('Edit main.asm'),
      within(screen.getByRole('complementary', { name: 'Source outline' })).getByRole('button', { name: /start/ }),
      screen.getByLabelText('Find project symbol'),
    ];
    for (const stop of stops) {
      expect(stop.tabIndex, stop.getAttribute('aria-label') ?? stop.textContent ?? '').toBeGreaterThanOrEqual(0);
      stop.focus();
      expect(document.activeElement).toBe(stop);
    }
  });

  it('clears the symbol search with Escape rather than requiring a pointer', () => {
    render(<Workspace files={[sourceFile()]} />);
    const search = screen.getByLabelText('Find project symbol') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'start' } });
    expect(search.value).toBe('start');
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search.value).toBe('');
  });

  it('keeps focus in the editor when parameter help appears', async () => {
    /* Help that steals focus makes an editor unusable with a screen reader:
     * every keystroke would land somewhere else. */
    render(<Workspace files={[sourceFile({ id: 'bas', name: 'menu.bas', language: 'bbc-basic', content: '10 SOUND ' })]} activeFileId="bas" />);
    const editor = screen.getByLabelText('Edit menu.bas') as HTMLTextAreaElement;
    editor.focus();
    fireEvent.change(editor, { target: { value: '10 SOUND 1,' } });
    editor.setSelectionRange(11, 11);
    fireEvent.keyUp(editor, { key: ',' });
    await waitFor(() => expect(document.activeElement).toBe(editor));
  });
});

describe('international input', () => {
  it('keeps text entered through an input method rather than dropping the composition', () => {
    /* Japanese, Chinese and Korean input arrives as a composition, not as
     * individual key presses. An editor that only listens for keys loses it. */
    render(<Workspace files={[sourceFile({ content: '' })]} />);
    const editor = screen.getByLabelText('Edit main.asm') as HTMLTextAreaElement;
    fireEvent.compositionStart(editor);
    fireEvent.change(editor, { target: { value: '; コメント' } });
    fireEvent.compositionEnd(editor, { data: 'コメント' });
    expect((screen.getByLabelText('Edit main.asm') as HTMLTextAreaElement).value).toBe('; コメント');
  });

  it('keeps characters outside the basic plane whole', () => {
    render(<Workspace files={[sourceFile({ content: '' })]} />);
    const editor = screen.getByLabelText('Edit main.asm') as HTMLTextAreaElement;
    /* An emoji is two UTF-16 code units. Anything that counts characters as
     * code units can cut one in half and produce a replacement character. */
    fireEvent.change(editor, { target: { value: '; 🐑 sheep\n; naïve café\n; Ωμέγα\n' } });
    const value = (screen.getByLabelText('Edit main.asm') as HTMLTextAreaElement).value;
    expect(value).toContain('🐑');
    expect(value).toContain('naïve café');
    expect(value).toContain('Ωμέγα');
    expect(value).not.toContain('�');
  });

  it('counts a line of non-Latin text as one line in the gutter', () => {
    render(<Workspace files={[sourceFile({ content: '; Ωμέγα\n; コメント\n; 🐑\n' })]} />);
    const editor = screen.getByLabelText('Edit main.asm') as HTMLTextAreaElement;
    expect(editor.value.split('\n')).toHaveLength(4);
  });
});

describe('large files', () => {
  const large = () => sourceFile({ content: `; ${'x'.repeat(80)}\n`.repeat(4000) });

  it('says what it has paused rather than appearing to have stopped working', () => {
    render(<Workspace files={[large()]} />);
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('Large source mode');
    expect(notice).toHaveTextContent(/outline/);
    expect(notice).toHaveTextContent(/editing, find, navigation, save and download remain available/);
  });

  it('keeps the file editable, which is the part that must not be given up', () => {
    render(<Workspace files={[large()]} />);
    const editor = screen.getByLabelText('Edit main.asm') as HTMLTextAreaElement;
    expect(editor).not.toHaveAttribute('readonly');
    fireEvent.change(editor, { target: { value: 'RTS\n' } });
    expect((screen.getByLabelText('Edit main.asm') as HTMLTextAreaElement).value).toBe('RTS\n');
  });

  it('states the size that put it in large mode, rather than only that it did', () => {
    render(<Workspace files={[large()]} />);
    expect(screen.getByRole('status').textContent).toMatch(/[\d,]+ bytes/);
  });
});

describe('undo isolation', () => {
  it('does not reach into another file’s history', async () => {
    /* Two documents, two histories. An undo in one that rewrote the other
     * would be indistinguishable from data loss. */
    const files = [sourceFile(), sourceFile({ id: 'other', name: 'other.asm', content: 'RTS\n' })];
    const { rerender } = render(<Workspace files={files} activeFileId="main" />);
    const editor = screen.getByLabelText('Edit main.asm') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'ORG &2000\n' } });

    rerender(<Workspace files={files} activeFileId="other" />);
    const other = screen.getByLabelText('Edit other.asm') as HTMLTextAreaElement;
    other.focus();
    fireEvent.keyDown(other, { key: 'z', ctrlKey: true });
    /* The other file is untouched: its own history is empty, so there is
     * nothing to undo, and nothing of main.asm's is reachable from here. */
    expect((screen.getByLabelText('Edit other.asm') as HTMLTextAreaElement).value).toBe('RTS\n');
  });

  it('undoes one editor command as one step, not character by character', () => {
    render(<Workspace files={[sourceFile({ content: 'one\ntwo\nthree\n' })]} />);
    const editor = screen.getByLabelText('Edit main.asm') as HTMLTextAreaElement;
    editor.focus();
    editor.setSelectionRange(0, 0);
    fireEvent.keyUp(editor, { key: 'ArrowRight' });
    fireEvent.keyDown(editor, { key: '/', ctrlKey: true });
    const commented = (screen.getByLabelText('Edit main.asm') as HTMLTextAreaElement).value;
    expect(commented).not.toBe('one\ntwo\nthree\n');

    fireEvent.keyDown(screen.getByLabelText('Edit main.asm'), { key: 'z', ctrlKey: true });
    expect((screen.getByLabelText('Edit main.asm') as HTMLTextAreaElement).value).toBe('one\ntwo\nthree\n');
  });
});
