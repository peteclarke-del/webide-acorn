import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ScreenWorkspace } from './ScreenWorkspace';
import { createScreenDocument, serializeScreenDocument, parseScreenDocument, readScreenPixel, screenBytes, screenGeometry } from '../assets/screenDocument';
import { resolveProjectPalette } from '../assets/paletteDocument';

/* The editor's actions live in a menu bar, so a test reaches them the way
 * somebody with a pointer does: open the menu, then choose from it. Opening is
 * idempotent, because clicking the bar again would shut a menu that is already
 * open — right for a person, wrong for a test. */
function openMenu(label: string) {
  if (!screen.queryByRole('menu', { name: label })) fireEvent.click(screen.getByRole('menuitem', { name: label }));
  return screen.getByRole('menu', { name: label });
}
function chooseFromMenu(menu: string, item: string | RegExp) {
  fireEvent.click(within(openMenu(menu)).getByRole('menuitem', { name: item }));
}

afterEach(() => { cleanup(); localStorage.clear(); });

function renderWorkspace(projectFiles: ReturnType<typeof projectHolding> = []) {
  const props = { projectPalette: resolveProjectPalette([], 4), projectFiles, onAddSource: vi.fn(), onAddLiveScreen: vi.fn(), onNotice: vi.fn() };
  render(<ScreenWorkspace {...props} />);
  return props;
}
/* A project holding one of these documents, so the editor can be asked whether
 * it offers what the person already has. */
function projectHolding(name: string, content: string) {
  return [{
    id: name, name, content, language: 'text' as const, encoding: 'utf-8' as const, lineEnding: 'lf' as const,
    modified: false, saved: true, savedName: name, savedContent: content,
    savedEncoding: 'utf-8' as const, savedLineEnding: 'lf' as const, kind: 'authored' as const, access: 'editable' as const,
  }];
}

const canvas = () => screen.getByRole('application', { name: /Screen/ });

/* Persisting a whole frame buffer is debounced in the editor, so the stored
 * document is awaited rather than read straight after an edit. */
const stored = () => waitFor(() => {
  const raw = localStorage.getItem('8bit-net-dev:screen');
  expect(raw).not.toBeNull();
  return parseScreenDocument(raw!);
});
const pixelAt = async (x: number, y: number) => {
  const document = await stored();
  return readScreenPixel(screenBytes(document), screenGeometry(document.mode), x, y);
};

describe('ScreenWorkspace', () => {
  it('starts from a blank MODE 5 screen of the right size', async () => {
    renderWorkspace();
    expect((await stored()).mode).toBe('bbc-mode-5');
    expect(screenBytes(await stored())).toHaveLength(10240);
    expect(canvas()).toHaveAccessibleName('Screen untitled-screen, 160 by 256 pixels');
  });

  it('paints at the keyboard cursor and reports the colour under it', async () => {
    renderWorkspace();
    fireEvent.keyDown(canvas(), { key: 'ArrowRight' });
    fireEvent.keyDown(canvas(), { key: 'ArrowDown' });
    fireEvent.keyDown(canvas(), { key: 'Enter' });
    expect(await pixelAt(1, 1)).toBe(1);
    expect(screen.getByRole('status')).toHaveTextContent('Pixel 2, 2 of 160 by 256 is logical colour 1');
  });

  it('moves eight pixels at a time with Shift and stops at the edges', () => {
    renderWorkspace();
    fireEvent.keyDown(canvas(), { key: 'ArrowRight', shiftKey: true });
    expect(screen.getByRole('status')).toHaveTextContent('Pixel 9, 1');
    for (let step = 0; step < 3; step += 1) fireEvent.keyDown(canvas(), { key: 'ArrowUp' });
    expect(screen.getByRole('status')).toHaveTextContent('Pixel 9, 1');
  });

  it('selects a logical colour within the mode and fills with it', async () => {
    const { onNotice } = renderWorkspace();
    fireEvent.click(screen.getByRole('radio', { name: 'Logical colour 3' }));
    chooseFromMenu('Edit', /^Fill screen/);
    expect(await pixelAt(0, 0)).toBe(3);
    expect(await pixelAt(159, 255)).toBe(3);
    expect(onNotice).toHaveBeenCalledWith('Screen filled with logical colour 3');
  });

  it('offers exactly the logical colours the chosen mode has', async () => {
    renderWorkspace();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    fireEvent.change(screen.getByLabelText('Display mode'), { target: { value: 'bbc-mode-2' } });
    expect(screen.getAllByRole('radio')).toHaveLength(16);
    expect(screenBytes(await stored())).toHaveLength(20480);
  });

  it('says how lossy a mode conversion was rather than implying it was clean', () => {
    const { onNotice } = renderWorkspace();
    fireEvent.change(screen.getByLabelText('Display mode'), { target: { value: 'bbc-mode-1' } });
    expect(onNotice).toHaveBeenCalledWith(expect.stringMatching(/Converted to MODE 1: [\d,]+ pixels resampled and 0 clamped/));
  });

  it('reports the colours the picture uses and the frame-buffer size', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('radio', { name: 'Logical colour 2' }));
    fireEvent.keyDown(canvas(), { key: 'Enter' });
    expect(screen.getByText('10,240 bytes')).toBeInTheDocument();
    expect(screen.getByText('0, 2')).toBeInTheDocument();
  });

  it('offers generated source and a live build target', () => {
    const { onAddSource, onAddLiveScreen } = renderWorkspace();
    fireEvent.change(screen.getByLabelText('Screen name'), { target: { value: 'title screen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add generated source' }));
    expect(onAddSource).toHaveBeenCalledWith('title-screen.asm', expect.stringContaining('.screen_title_screen'));
    fireEvent.click(screen.getByRole('button', { name: 'Add live screen build target' }));
    expect(onAddLiveScreen).toHaveBeenCalledWith('title-screen', expect.stringContaining('"schema": "8bit-net.screen"'));
  });

  it('says the generated bytes are the picture only', () => {
    renderWorkspace();
    expect(screen.getByText(/do not include the mode change or the palette/)).toBeInTheDocument();
  });
});

describe('selecting a rectangle of the screen', () => {
  const status = () => screen.getByRole('application', { name: /Screen/ }).parentElement!.textContent ?? '';

  it('says there is no selection until a corner is marked', () => {
    renderWorkspace();
    expect(status()).toMatch(/No selection\. Press S to mark a corner/);
  });

  it('marks a rectangle from the keyboard and reports it', () => {
    renderWorkspace();
    fireEvent.keyDown(canvas(), { key: 's' });
    fireEvent.keyDown(canvas(), { key: 'ArrowRight' });
    fireEvent.keyDown(canvas(), { key: 's' });
    expect(status()).toMatch(/Selected 2 by 1 pixels|Selected 2 by 1 cells/);
  });

  it('copies and reports what is on the clipboard', () => {
    const props = renderWorkspace();
    fireEvent.keyDown(canvas(), { key: 's' });
    fireEvent.keyDown(canvas(), { key: 's' });
    fireEvent.keyDown(canvas(), { key: 'c' });
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/Copied 1 by 1 cells/));
    expect(status()).toMatch(/1 by 1 pixels are on the clipboard/);
  });

  it('pastes at the cursor', () => {
    const props = renderWorkspace();
    fireEvent.keyDown(canvas(), { key: 's' });
    fireEvent.keyDown(canvas(), { key: 's' });
    fireEvent.keyDown(canvas(), { key: 'c' });
    fireEvent.keyDown(canvas(), { key: 'ArrowDown' });
    fireEvent.keyDown(canvas(), { key: 'v' });
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/Pasted 1 by 1 pixels at 1,2/));
  });

  it('cuts to logical colour zero and says so', () => {
    const props = renderWorkspace();
    fireEvent.keyDown(canvas(), { key: 's' });
    fireEvent.keyDown(canvas(), { key: 's' });
    fireEvent.keyDown(canvas(), { key: 'x' });
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/Cut 1 by 1 cells.* to logical colour 0/));
  });

  it('offers the same operations to a pointer, not only to the keyboard', () => {
    /* Marking a corner is done while working on the picture and stays on the
     * surface; what is then done to the marked area is in the Edit menu. */
    renderWorkspace();
    const tools = screen.getByRole('group', { name: 'Rectangular selection' });
    expect(within(openMenu('Edit')).getByRole('menuitem', { name: 'Copy area' })).toBeDisabled();
    fireEvent.mouseDown(document.body);
    fireEvent.click(within(tools).getByRole('button', { name: 'Mark corner' }));
    fireEvent.click(within(tools).getByRole('button', { name: 'Mark opposite corner' }));
    expect(within(openMenu('Edit')).getByRole('menuitem', { name: 'Copy area' })).toBeEnabled();
  });
});

describe('a screen the project already holds', () => {
  it('is offered in the Document menu, and opening one loads it', () => {
    /* The loading screen an import recovers lands in the project as a
     * document. Before this the editor could only open one from disk, so the
     * recovered screen was in the file tree and nowhere else. */
    const document = createScreenDocument('loading', 'bbc-mode-2');
    const props = renderWorkspace(projectHolding('loading.screen.json', serializeScreenDocument(document)));
    chooseFromMenu('Document', /^Open loading\.screen\.json/);
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringContaining('opened from this project'));
    expect(screen.getByLabelText('Screen name')).toHaveValue('loading');
  });

  it('offers nothing when the project holds no screen', () => {
    renderWorkspace();
    expect(within(openMenu('Document')).queryByRole('menuitem', { name: /^Open / })).toBeNull();
  });
});
