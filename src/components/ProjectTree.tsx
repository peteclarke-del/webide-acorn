/* The project explorer tree.
 *
 * Two things this fixes, both of which were invisible until someone tried to
 * use the product without a mouse or without sight.
 *
 * It had one tab stop per file. A project with fifty sources put fifty stops
 * between the explorer and the editor. It now holds a single stop and moves
 * between rows with the arrow keys, which is what a tree is supposed to do.
 *
 * It listed every source together with a one-letter badge. Where a file came
 * from governs what may be done to it — a generated file is read-only and will
 * be replaced by its generator — so sources are grouped by origin and each
 * group says how many it holds.
 *
 * The trash sits at the bottom, because a deletion that can be undone is only
 * useful if the undo is somewhere you can see.
 */
import { useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Icon, type IconName } from './Icon';
import type { ProjectFile } from '../project/project';
import { trashEntrySummary, type TrashedFile } from '../project/projectTrash';

export type SourceGroupId = 'authored' | 'imported' | 'generated';

export const SOURCE_GROUPS: ReadonlyArray<{ id: SourceGroupId; label: string; icon: IconName }> = [
  { id: 'authored', label: 'SOURCE FILES', icon: 'folder' },
  { id: 'imported', label: 'IMPORTED', icon: 'open' },
  { id: 'generated', label: 'GENERATED', icon: 'layers' },
];

export function sourceGroupOf(file: Pick<ProjectFile, 'kind'>): SourceGroupId {
  if (file.kind === 'generated') return 'generated';
  if (file.kind === 'imported') return 'imported';
  return 'authored';
}

/**
 * Where a key press moves within a list of rows, or null when the key is not
 * one this tree handles. Pure, so the movement rules are testable without a
 * rendered tree and cannot disagree with the ones the tree applies.
 */
export function nextTreeIndex(key: string, index: number, length: number): number | null {
  if (!length) return null;
  const moves: Record<string, number | undefined> = {
    ArrowDown: index + 1,
    ArrowUp: index - 1,
    Home: 0,
    End: length - 1,
  };
  const next = moves[key];
  if (next === undefined) return null;
  return Math.max(0, Math.min(length - 1, next));
}

export type TreeRow =
  | { kind: 'folder'; key: string; label: string; depth: number; collapsed: boolean; holds: number }
  | { kind: 'file'; key: string; file: ProjectFile; label: string; depth: number };

/**
 * A group's files laid out as folders and files, in the order they are shown.
 *
 * A project keeps the folders an imported codebase arrived in, so the explorer
 * has to show them: a flat list of `src/game/main.asm` beside `src/lib/maths.s`
 * reads as noise, and hides which files sit together. Folder rows are headings
 * rather than tree items, so the arrow keys still move file to file and the
 * number of tab stops does not change.
 *
 * Pure, so what the tree shows can be checked without rendering one.
 */
export function foldersAndFiles(files: readonly ProjectFile[], collapsed: ReadonlySet<string> = new Set()): TreeRow[] {
  /* What each folder holds, counted before anything is hidden, so a shut folder
   * can say how much is inside it rather than just disappearing. */
  const holds = new Map<string, number>();
  for (const file of files) {
    const folders = file.name.split('/').slice(0, -1);
    for (let depth = 0; depth < folders.length; depth += 1) {
      const key = folders.slice(0, depth + 1).join('/');
      holds.set(key, (holds.get(key) ?? 0) + 1);
    }
  }

  const rows: TreeRow[] = [];
  let open: string[] = [];
  for (const file of files) {
    const segments = file.name.split('/');
    const folders = segments.slice(0, -1);
    /* Only announce the folders that changed since the previous file, so a run
     * of files in one folder is listed under one heading. */
    let shared = 0;
    while (shared < folders.length && shared < open.length && folders[shared] === open[shared]) shared += 1;
    let hidden = false;
    for (let depth = 0; depth < folders.length; depth += 1) {
      const key = folders.slice(0, depth + 1).join('/');
      /* A folder inside a shut one is not drawn at all; the shut folder is,
       * because it is the way back to what it holds. */
      if (depth >= shared && !hidden) {
        rows.push({ kind: 'folder', key, label: folders[depth]!, depth, collapsed: collapsed.has(key), holds: holds.get(key) ?? 0 });
      }
      if (collapsed.has(key)) hidden = true;
    }
    open = folders;
    if (!hidden) rows.push({ kind: 'file', key: file.id, file, label: segments[segments.length - 1]!, depth: folders.length });
  }
  return rows;
}

/** The folder a row sits in, for the arrow key that moves out to the parent. */
export function parentFolderOf(row: TreeRow): string | null {
  const segments = row.kind === 'folder' ? row.key.split('/') : row.file.name.split('/').slice(0, -1);
  const parent = row.kind === 'folder' ? segments.slice(0, -1) : segments;
  return parent.length ? parent.join('/') : null;
}

export interface ProjectTreeProps {
  files: ProjectFile[];
  /** Move one file before or after another. Refusals are reported, not silent. */
  onReorder?: (movedId: string, targetId: string, position: 'before' | 'after') => void;
  buildTargets: Array<{ id: string; name: string }>;
  activeFileId: string;
  activeBuildTargetId: string;
  trash: readonly TrashedFile[];
  onOpenFile: (id: string) => void;
  onSelectBuildTarget: (id: string) => void;
  onRestore: (id: string) => void;
  onPurge: (id?: string) => void;
  /** Anything the workbench renders between the build targets and the trash. */
  artifacts?: React.ReactNode;
}

const COLLAPSED_KEY = '8bit-net-dev:tree-collapsed';

export function ProjectTree({
  files, buildTargets, activeFileId, activeBuildTargetId, trash,
  onOpenFile, onSelectBuildTarget, onRestore, onPurge, onReorder, artifacts,
}: ProjectTreeProps) {
  /* Which row is being dragged, and where it would land. The payload of a drag
   * is not readable during dragover in any browser, so the identity is held
   * here instead. It is kept in a ref as well as state because a drag that
   * reaches its first dragover before React has re-rendered would otherwise
   * find no drag in progress and refuse the drop. */
  /*
   * Which folders are shut.
   *
   * Remembered in this browser, because a project that arrives with sixty rooms
   * under one folder is unusable if every visit reopens all of it, and because
   * the arrangement of the workbench is already remembered this way.
   */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? '[]') as unknown;
      return new Set(Array.isArray(saved) ? saved.filter((entry): entry is string => typeof entry === 'string') : []);
    } catch { return new Set(); }
  });
  const toggleFolder = (key: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (!next.delete(key)) next.add(key);
    try { window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next])); } catch { /* a browser that refuses storage still opens and shuts folders */ }
    return next;
  });

  const draggingRef = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null);

  const dropPosition = (event: ReactDragEvent<HTMLElement>): 'before' | 'after' => {
    const box = event.currentTarget.getBoundingClientRect();
    return event.clientY < box.top + box.height / 2 ? 'before' : 'after';
  };

  const beginDrag = (event: ReactDragEvent<HTMLElement>, id: string) => {
    draggingRef.current = id;
    setDragging(id);
    event.dataTransfer.effectAllowed = 'move';
    /* A plain-text payload as well, so dragging a file into an editor or
     * another application carries its name rather than nothing. */
    event.dataTransfer.setData('text/plain', files.find((file) => file.id === id)?.name ?? id);
  };

  const overRow = (event: ReactDragEvent<HTMLElement>, id: string) => {
    if (!onReorder || !draggingRef.current || draggingRef.current === id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const position = dropPosition(event);
    setDropTarget((current) => current?.id === id && current.position === position ? current : { id, position });
  };

  const dropOnRow = (event: ReactDragEvent<HTMLElement>, id: string) => {
    const moved = draggingRef.current;
    if (!onReorder || !moved || moved === id) return;
    event.preventDefault();
    onReorder(moved, id, dropPosition(event));
    endDrag();
  };

  const endDrag = () => { draggingRef.current = null; setDragging(null); setDropTarget(null); };

  /* The keyboard alternative to dragging. Alt with an arrow moves the focused
   * file past its neighbour, which is the same operation a drag performs and
   * the only one available without a pointer. */
  const reorderByKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>): boolean => {
    if (!onReorder || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return false;
    const id = (event.target as HTMLElement).closest<HTMLElement>('[data-tree-item]')?.dataset.treeItem;
    const index = files.findIndex((file) => file.id === id);
    if (index < 0) return false;
    const neighbour = files[event.key === 'ArrowUp' ? index - 1 : index + 1];
    if (!neighbour) return false;
    event.preventDefault();
    onReorder(files[index]!.id, neighbour.id, event.key === 'ArrowUp' ? 'before' : 'after');
    return true;
  };
  /* The row order is the render order, so navigation always matches what is on
   * screen rather than a separately maintained list that could drift. */
  const rows = [...files.map((file) => file.id), ...buildTargets.map((target) => target.id)];
  const focused = rows.includes(activeFileId) ? activeFileId : rows.includes(activeBuildTargetId) ? activeBuildTargetId : rows[0];
  const tabIndexFor = (id: string) => (id === focused ? 0 : -1);

  const move = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (reorderByKeyboard(event)) return;
    /* Right and left open and shut a folder, which is what they do in every
     * tree. On a file, left goes out to the folder it sits in. */
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-tree-item]');
    const folderKey = row?.dataset.treeFolder;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const shutting = event.key === 'ArrowLeft';
      if (folderKey && collapsed.has(folderKey) !== shutting) { event.preventDefault(); toggleFolder(folderKey); return; }
      if (shutting) {
        const parent = row?.dataset.treeParent;
        if (parent) {
          event.preventDefault();
          event.currentTarget.querySelector<HTMLElement>(`[data-tree-folder="${CSS.escape(parent)}"]`)?.focus();
          return;
        }
      }
      if (!folderKey && !shutting) return;
    }
    const container = event.currentTarget;
    const items = Array.from(container.querySelectorAll<HTMLElement>('[data-tree-item]'));
    const current = (event.target as HTMLElement).closest<HTMLElement>('[data-tree-item]');
    const index = current ? items.indexOf(current) : 0;
    const next = nextTreeIndex(event.key, index, items.length);
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  };

  return (
    <div
      className="tree"
      role="tree"
      aria-label="Project files"
      /* Dragging cannot be done without a pointer, so the alternative is
       * declared next to the thing that needs it rather than listed somewhere
       * a reviewer has to go and find. */
      data-drag-alternative="Hold Alt and press the up or down arrow to move the focused file past its neighbour. This is the same operation a drag performs."
      onKeyDown={move}
    >
      {SOURCE_GROUPS.map((group) => {
        const grouped = files.filter((file) => sourceGroupOf(file) === group.id);
        if (!grouped.length) return null;
        return (
          <div key={group.id} role="group" aria-label={group.label}>
            <div className="tree-section"><Icon name="chevron" size={13} /><Icon name={group.icon} size={15} /><strong>{group.label}</strong><small>{grouped.length}</small></div>
            {foldersAndFiles(grouped, collapsed).map((row) => row.kind === 'folder' ? (
              <button
                className={row.collapsed ? 'tree-folder collapsed' : 'tree-folder'}
                type="button"
                role="treeitem"
                aria-expanded={!row.collapsed}
                aria-label={`${row.key}, ${row.holds} file${row.holds === 1 ? '' : 's'}`}
                tabIndex={-1}
                data-tree-item={`folder:${row.key}`}
                data-tree-folder={row.key}
                {...(parentFolderOf(row) ? { 'data-tree-parent': parentFolderOf(row)! } : {})}
                key={`folder:${row.key}`}
                title={`${row.key} · ${row.holds} file${row.holds === 1 ? '' : 's'}`}
                style={{ '--tree-depth': row.depth } as CSSProperties}
                onClick={() => toggleFolder(row.key)}
              >
                <Icon name="chevron" size={12} /><Icon name="folder" size={14} /><span>{row.label}</span>
                {row.collapsed && <small>{row.holds}</small>}
              </button>
            ) : (
              <button
                className={[
                  activeFileId === row.file.id ? 'tree-item active' : 'tree-item',
                  dragging === row.file.id ? 'dragging' : '',
                  dropTarget?.id === row.file.id ? `drop-${dropTarget.position}` : '',
                ].filter(Boolean).join(' ')}
                type="button"
                role="treeitem"
                aria-selected={activeFileId === row.file.id}
                tabIndex={tabIndexFor(row.file.id)}
                data-tree-item={row.file.id}
                {...(parentFolderOf(row) ? { 'data-tree-parent': parentFolderOf(row)! } : {})}
                key={row.file.id}
                title={row.file.name}
                style={{ '--tree-depth': row.depth } as CSSProperties}
                draggable={!!onReorder}
                onDragStart={(event) => beginDrag(event, row.file.id)}
                onDragOver={(event) => overRow(event, row.file.id)}
                onDragLeave={() => setDropTarget((current) => current?.id === row.file.id ? null : current)}
                onDrop={(event) => dropOnRow(event, row.file.id)}
                onDragEnd={endDrag}
                onClick={() => onOpenFile(row.file.id)}
              >
                <Icon name="file" size={15} /> <span>{row.label}</span>
                <small>{row.file.kind === 'generated' ? 'GEN RO' : row.file.access === 'read-only' ? 'RO' : row.file.modified ? 'M' : ''}</small>
              </button>
            ))}
          </div>
        );
      })}

      <div role="group" aria-label="BUILD">
        <div className="tree-section top-gap"><Icon name="chevron" size={13} /><Icon name="build" size={15} /><strong>BUILD</strong><small>{buildTargets.length}</small></div>
        {buildTargets.map((target) => (
          <button
            className={activeBuildTargetId === target.id ? 'tree-item active' : 'tree-item'}
            type="button"
            role="treeitem"
            aria-selected={activeBuildTargetId === target.id}
            tabIndex={tabIndexFor(target.id)}
            data-tree-item={target.id}
            key={target.id}
            onClick={() => onSelectBuildTarget(target.id)}
          >
            <Icon name="build" size={15} /><span>{target.name}</span>{activeBuildTargetId === target.id && <small>ACTIVE</small>}
          </button>
        ))}
      </div>

      {artifacts}

      {trash.length > 0 && (
        <div role="group" aria-label="TRASH">
          <div className="tree-section top-gap"><Icon name="chevron" size={13} /><Icon name="close" size={15} /><strong>TRASH</strong><small>{trash.length}</small></div>
          {trash.map((entry) => (
            <div className="tree-trash-item" key={entry.id}>
              <span><Icon name="file" size={13} /><span>{entry.file.name}</span><small>{trashEntrySummary(entry)}</small></span>
              <span className="tree-trash-actions">
                <button type="button" aria-label={`Restore ${entry.file.name}`} onClick={() => onRestore(entry.id)}>Restore</button>
                <button type="button" aria-label={`Permanently delete ${entry.file.name}`} onClick={() => onPurge(entry.id)}>Delete</button>
              </span>
            </div>
          ))}
          <button className="tree-trash-empty" type="button" onClick={() => onPurge()}>Empty trash</button>
        </div>
      )}
    </div>
  );
}
