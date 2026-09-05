import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ProjectTree, foldersAndFiles, nextTreeIndex, sourceGroupOf } from './ProjectTree';
import type { ProjectFile } from '../project/project';
import type { TrashedFile } from '../project/projectTrash';

function file(id: string, name: string, kind: ProjectFile['kind'] = 'authored'): ProjectFile {
  return {
    id, name, content: 'RTS\n', language: '6502', encoding: 'utf-8', lineEnding: 'lf',
    modified: false, saved: true, savedName: name, savedContent: 'RTS\n',
    savedEncoding: 'utf-8', savedLineEnding: 'lf', kind, access: kind === 'generated' ? 'read-only' : 'editable',
  };
}

const trashed = (id: string, name: string): TrashedFile => ({
  id, deletedAt: '2026-08-28T09:00:00.000Z', file: file(id, name),
  buildTargets: [], bookmarks: [],
});

function renderTree(overrides: Partial<React.ComponentProps<typeof ProjectTree>> = {}) {
  const props = {
    files: [file('main', 'main.asm'), file('notes', 'notes.txt', 'imported'), file('sprites', 'sprites.asm', 'generated')],
    buildTargets: [{ id: 'cpu', name: 'cpu' }, { id: 'loader', name: 'loader' }],
    activeFileId: 'main',
    activeBuildTargetId: 'cpu',
    trash: [] as readonly TrashedFile[],
    onOpenFile: vi.fn(),
    onSelectBuildTarget: vi.fn(),
    onRestore: vi.fn(),
    onPurge: vi.fn(),
    onReorder: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ProjectTree {...props} />) };
}

const rows = () => screen.getAllByRole('treeitem');

afterEach(cleanup);

describe('the project tree', () => {
  it('groups sources by where they came from, and counts each group', () => {
    renderTree();
    const tree = screen.getByRole('tree', { name: 'Project files' });
    const groups = within(tree).getAllByRole('group').map((group) => group.getAttribute('aria-label'));
    expect(groups).toEqual(['SOURCE FILES', 'IMPORTED', 'GENERATED', 'BUILD']);
    expect(within(screen.getByRole('group', { name: 'IMPORTED' })).getByText('notes.txt')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'GENERATED' })).getByText('sprites.asm')).toBeInTheDocument();
  });

  it('marks a generated file read-only, because its generator owns it', () => {
    renderTree();
    const generated = within(screen.getByRole('group', { name: 'GENERATED' })).getByRole('treeitem');
    expect(generated).toHaveTextContent('GEN RO');
  });

  it('holds one tab stop however many rows it has', () => {
    renderTree();
    expect(rows()).toHaveLength(5);
    expect(rows().filter((row) => row.tabIndex === 0)).toHaveLength(1);
    expect(rows().find((row) => row.tabIndex === 0)).toHaveAttribute('data-tree-item', 'main');
  });

  it('moves focus between rows with the arrow keys', () => {
    renderTree();
    rows()[0]!.focus();
    expect(document.activeElement).toHaveAttribute('data-tree-item', 'main');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toHaveAttribute('data-tree-item', 'notes');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toHaveAttribute('data-tree-item', 'sprites');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toHaveAttribute('data-tree-item', 'notes');
  });

  it('crosses from the last source into the build targets, because it is one tree', () => {
    renderTree();
    rows()[0]!.focus();
    for (let step = 0; step < 3; step += 1) fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toHaveAttribute('data-tree-item', 'cpu');
  });

  it('reaches both ends with Home and End, and stops there', () => {
    renderTree();
    rows()[0]!.focus();
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toHaveAttribute('data-tree-item', 'loader');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toHaveAttribute('data-tree-item', 'loader');
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toHaveAttribute('data-tree-item', 'main');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toHaveAttribute('data-tree-item', 'main');
  });

  it('leaves keys it does not handle to the browser', () => {
    renderTree();
    rows()[0]!.focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(document.activeElement).toHaveAttribute('data-tree-item', 'main');
    expect(nextTreeIndex('Tab', 0, 5)).toBeNull();
    expect(nextTreeIndex('ArrowDown', 0, 0)).toBeNull();
  });

  it('says which row is selected, so a screen reader can report it', () => {
    renderTree();
    expect(rows().find((row) => row.getAttribute('aria-selected') === 'true')).toHaveAttribute('data-tree-item', 'main');
    expect(rows().filter((row) => row.getAttribute('aria-selected') === 'true')).toHaveLength(2);
  });

  it('opens a file and selects a build target through their own handlers', () => {
    const { props } = renderTree();
    fireEvent.click(screen.getByText('notes.txt'));
    expect(props.onOpenFile).toHaveBeenCalledWith('notes');
    fireEvent.click(screen.getByText('loader'));
    expect(props.onSelectBuildTarget).toHaveBeenCalledWith('loader');
  });

  it('shows no trash section when nothing has been deleted', () => {
    renderTree();
    expect(screen.queryByRole('group', { name: 'TRASH' })).not.toBeInTheDocument();
  });

  it('offers each trashed file back, and says what it would restore with it', () => {
    const entry = { ...trashed('helper', 'helper.asm'), buildTargets: [{ id: 't', name: 'helper' }] as never, bookmarks: [{ id: 'b' }] as never };
    const { props } = renderTree({ trash: [entry] });
    const trash = screen.getByRole('group', { name: 'TRASH' });
    expect(within(trash).getByText('helper.asm')).toBeInTheDocument();
    expect(within(trash).getByText('restores with 1 build target and 1 bookmark')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Restore helper.asm' }));
    expect(props.onRestore).toHaveBeenCalledWith('helper');
    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete helper.asm' }));
    expect(props.onPurge).toHaveBeenCalledWith('helper');
    fireEvent.click(screen.getByRole('button', { name: 'Empty trash' }));
    expect(props.onPurge).toHaveBeenLastCalledWith();
  });

  it('keeps trashed files out of the tree rows, so they cannot be opened', () => {
    renderTree({ trash: [trashed('helper', 'helper.asm')] });
    expect(rows().map((row) => row.getAttribute('data-tree-item'))).not.toContain('helper');
  });

  it('classifies a file by its recorded origin', () => {
    expect(sourceGroupOf({ kind: 'generated' })).toBe('generated');
    expect(sourceGroupOf({ kind: 'imported' })).toBe('imported');
    expect(sourceGroupOf({ kind: 'authored' })).toBe('authored');
    expect(sourceGroupOf({ kind: undefined })).toBe('authored');
  });
});

describe('reordering files in the tree', () => {
  const rowFor = (id: string) => screen.getByRole('tree').querySelector<HTMLElement>(`[data-tree-item="${id}"]`)!;

  /* jsdom gives every element a zero-height box, so the midpoint test always
   * reads "after" unless a box is supplied. These helpers say which half of the
   * row the pointer is over. */
  const withBox = (row: HTMLElement, top: number, height: number) => {
    row.getBoundingClientRect = () => ({ top, height, bottom: top + height, left: 0, right: 0, width: 100, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  };
  const dataTransfer = () => ({ effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn() });

  /* jsdom has no DragEvent, so a pointer coordinate passed to fireEvent is
   * dropped. Defining it on the event is the only way to say which half of the
   * row the pointer is over. */
  const dragAt = (type: 'dragOver' | 'drop', target: HTMLElement, clientY: number) => {
    const event = createEvent[type](target, { dataTransfer: dataTransfer() });
    Object.defineProperty(event, 'clientY', { value: clientY });
    fireEvent(target, event);
  };

  it('offers files as draggable only when a reorder handler is supplied', () => {
    renderTree();
    expect(rowFor('main').draggable).toBe(true);
    cleanup();
    renderTree({ onReorder: undefined });
    expect(rowFor('main').draggable).toBe(false);
  });

  it('reports a drop on the upper half as before, and the lower half as after', () => {
    const { props } = renderTree();
    const source = rowFor('main');
    const target = rowFor('notes');
    withBox(target, 100, 20);

    fireEvent.dragStart(source, { dataTransfer: dataTransfer() });
    dragAt('dragOver', target, 104);
    dragAt('drop', target, 104);
    expect(props.onReorder).toHaveBeenLastCalledWith('main', 'notes', 'before');

    fireEvent.dragStart(source, { dataTransfer: dataTransfer() });
    dragAt('dragOver', target, 116);
    dragAt('drop', target, 116);
    expect(props.onReorder).toHaveBeenLastCalledWith('main', 'notes', 'after');
  });

  it('shows where the row would land while it is being dragged over', () => {
    renderTree();
    const target = rowFor('notes');
    withBox(target, 100, 20);
    fireEvent.dragStart(rowFor('main'), { dataTransfer: dataTransfer() });
    dragAt('dragOver', target, 104);
    expect(target).toHaveClass('drop-before');
    dragAt('dragOver', target, 116);
    expect(target).toHaveClass('drop-after');
    fireEvent.dragLeave(target);
    expect(target).not.toHaveClass('drop-after');
  });

  it('marks the row that is moving, and stops when the drag ends', () => {
    renderTree();
    const source = rowFor('main');
    fireEvent.dragStart(source, { dataTransfer: dataTransfer() });
    expect(source).toHaveClass('dragging');
    fireEvent.dragEnd(source);
    expect(source).not.toHaveClass('dragging');
  });

  it('ignores a drop of a row on itself', () => {
    const { props } = renderTree();
    const row = rowFor('main');
    fireEvent.dragStart(row, { dataTransfer: dataTransfer() });
    dragAt('drop', row, 0);
    expect(props.onReorder).not.toHaveBeenCalled();
  });

  it('honours a drop that arrives before the row has re-rendered', () => {
    /* A fast drag can reach dragover and drop in the same frame as dragstart.
     * The drag identity is therefore held in a ref, not only in state. */
    const { props } = renderTree();
    const source = rowFor('main');
    const target = rowFor('notes');
    withBox(target, 100, 20);
    const start = createEvent.dragStart(source, { dataTransfer: dataTransfer() });
    const over = createEvent.dragOver(target, { dataTransfer: dataTransfer() });
    const drop = createEvent.drop(target, { dataTransfer: dataTransfer() });
    Object.defineProperty(over, 'clientY', { value: 104 });
    Object.defineProperty(drop, 'clientY', { value: 104 });
    fireEvent(source, start);
    fireEvent(target, over);
    fireEvent(target, drop);
    expect(props.onReorder).toHaveBeenCalledWith('main', 'notes', 'before');
  });

  it('carries the file name as plain text, so a drag out of the tree means something', () => {
    renderTree();
    const transfer = dataTransfer();
    fireEvent.dragStart(rowFor('notes'), { dataTransfer: transfer });
    expect(transfer.setData).toHaveBeenCalledWith('text/plain', 'notes.txt');
  });

  it('moves a file with Alt and an arrow, which is the keyboard equivalent of the drag', () => {
    const { props } = renderTree();
    rowFor('notes').focus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp', altKey: true });
    expect(props.onReorder).toHaveBeenLastCalledWith('notes', 'main', 'before');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown', altKey: true });
    expect(props.onReorder).toHaveBeenLastCalledWith('notes', 'sprites', 'after');
  });

  it('does not move the first file up or the last file down', () => {
    const { props } = renderTree();
    rowFor('main').focus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp', altKey: true });
    rowFor('sprites').focus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown', altKey: true });
    expect(props.onReorder).not.toHaveBeenCalled();
  });

  it('keeps plain arrow keys navigating rather than reordering', () => {
    const { props } = renderTree();
    rowFor('main').focus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(props.onReorder).not.toHaveBeenCalled();
    expect(document.activeElement).toHaveAttribute('data-tree-item', 'notes');
  });

  it('does not offer keyboard reordering on a build target, which has no order to change', () => {
    const { props } = renderTree();
    rowFor('cpu').focus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp', altKey: true });
    expect(props.onReorder).not.toHaveBeenCalled();
  });
});

describe('showing the folders a project keeps', () => {
  const file = (id: string, name: string): ProjectFile => ({ id, name, content: '', language: '6502', modified: false, kind: 'imported' });

  it('announces each folder once and names files by their basename', () => {
    const rows = foldersAndFiles([
      file('a', 'src/game/main.asm'),
      file('b', 'src/game/sprites.asm'),
      file('c', 'src/lib/maths.asm'),
      file('d', 'readme.md'),
    ]);
    expect(rows.map((row) => `${row.kind}:${row.label}:${row.depth}`)).toEqual([
      'folder:src:0',
      'folder:game:1',
      'file:main.asm:2',
      'file:sprites.asm:2',
      'folder:lib:1',
      'file:maths.asm:2',
      'file:readme.md:0',
    ]);
  });

  it('announces a folder again when the order leaves and returns to it', () => {
    /* Files can be reordered by hand, so a folder's files need not be
     * contiguous; repeating the heading is truthful about where each file is. */
    const rows = foldersAndFiles([file('a', 'src/main.asm'), file('b', 'top.asm'), file('c', 'src/other.asm')]);
    expect(rows.filter((row) => row.kind === 'folder')).toHaveLength(2);
  });

  it('leaves a project without folders looking exactly as it did', () => {
    const rows = foldersAndFiles([file('a', 'main.asm'), file('b', 'gfx.asm')]);
    expect(rows.every((row) => row.kind === 'file' && row.depth === 0)).toBe(true);
  });

  const NESTED = [
    file('a', 'src/game/main.asm'),
    file('b', 'src/game/sprites.asm'),
    file('c', 'src/lib/maths.asm'),
    file('d', 'readme.md'),
  ];

  it('hides what a shut folder holds, and keeps the folder itself', () => {
    const rows = foldersAndFiles(NESTED, new Set(['src/game']));
    expect(rows.map((row) => `${row.kind}:${row.label}`)).toEqual([
      'folder:src', 'folder:game', 'folder:lib', 'file:maths.asm', 'file:readme.md',
    ]);
    expect(rows.find((row) => row.label === 'game')).toMatchObject({ collapsed: true, holds: 2 });
  });

  it('hides a folder inside a shut one entirely, rather than leaving it stranded', () => {
    const rows = foldersAndFiles(NESTED, new Set(['src']));
    expect(rows.map((row) => `${row.kind}:${row.label}`)).toEqual(['folder:src', 'file:readme.md']);
    /* And says how much is behind it, so shutting it does not simply lose three files. */
    expect(rows[0]).toMatchObject({ collapsed: true, holds: 3 });
  });

  it('counts what a folder holds before anything is hidden', () => {
    /* The count has to be of everything inside, or a folder shut inside another
     * would make the outer one appear to hold less than it does. */
    const outer = foldersAndFiles(NESTED, new Set(['src', 'src/game']))[0];
    expect(outer).toMatchObject({ label: 'src', holds: 3 });
  });
});

describe('opening and shutting the folders', () => {
  const file = (id: string, name: string): ProjectFile => ({ id, name, content: '', language: '6502', modified: false, kind: 'imported' });
  const NESTED = [file('a', 'src/game/main.asm'), file('b', 'src/game/sprites.asm'), file('c', 'top.asm')];
  const draw = () => render(
    <ProjectTree
      files={NESTED}
      buildTargets={[]}
      activeFileId="a"
      activeBuildTargetId=""
      trash={[] as readonly TrashedFile[]}
      onOpenFile={() => {}}
      onSelectBuildTarget={() => {}}
      onRestore={() => {}}
      onPurge={() => {}}
    />,
  );

  it('shuts a folder when it is chosen, and opens it again', () => {
    draw();
    const folder = screen.getByRole('treeitem', { name: /^src\/game, 2 files/ });
    expect(folder).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('treeitem', { name: /main\.asm/ })).toBeTruthy();

    fireEvent.click(folder);
    expect(screen.getByRole('treeitem', { name: /^src\/game, 2 files/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('treeitem', { name: /main\.asm/ }), 'its files are put away').toBeNull();
    /* And the file outside it is untouched. */
    expect(screen.queryByRole('treeitem', { name: /top\.asm/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('treeitem', { name: /^src\/game, 2 files/ }));
    expect(screen.queryByRole('treeitem', { name: /main\.asm/ })).toBeTruthy();
  });

  it('opens and shuts with the arrow keys, the way a tree does', () => {
    draw();
    const folder = screen.getByRole('treeitem', { name: /^src\/game, 2 files/ });
    fireEvent.keyDown(folder, { key: 'ArrowLeft' });
    expect(screen.getByRole('treeitem', { name: /^src\/game, 2 files/ })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(screen.getByRole('treeitem', { name: /^src\/game, 2 files/ }), { key: 'ArrowRight' });
    expect(screen.getByRole('treeitem', { name: /^src\/game, 2 files/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('remembers what was shut, so a visit does not reopen everything', () => {
    draw();
    fireEvent.click(screen.getByRole('treeitem', { name: /^src\/game, 2 files/ }));
    cleanup();
    draw();
    expect(screen.getByRole('treeitem', { name: /^src\/game, 2 files/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('treeitem', { name: /main\.asm/ })).toBeNull();
  });
});
