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
import { useRef, useState, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
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

export function ProjectTree({
  files, buildTargets, activeFileId, activeBuildTargetId, trash,
  onOpenFile, onSelectBuildTarget, onRestore, onPurge, onReorder, artifacts,
}: ProjectTreeProps) {
  /* Which row is being dragged, and where it would land. The payload of a drag
   * is not readable during dragover in any browser, so the identity is held
   * here instead. It is kept in a ref as well as state because a drag that
   * reaches its first dragover before React has re-rendered would otherwise
   * find no drag in progress and refuse the drop. */
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
            {grouped.map((file) => (
              <button
                className={[
                  activeFileId === file.id ? 'tree-item active' : 'tree-item',
                  dragging === file.id ? 'dragging' : '',
                  dropTarget?.id === file.id ? `drop-${dropTarget.position}` : '',
                ].filter(Boolean).join(' ')}
                type="button"
                role="treeitem"
                aria-selected={activeFileId === file.id}
                tabIndex={tabIndexFor(file.id)}
                data-tree-item={file.id}
                key={file.id}
                draggable={!!onReorder}
                onDragStart={(event) => beginDrag(event, file.id)}
                onDragOver={(event) => overRow(event, file.id)}
                onDragLeave={() => setDropTarget((current) => current?.id === file.id ? null : current)}
                onDrop={(event) => dropOnRow(event, file.id)}
                onDragEnd={endDrag}
                onClick={() => onOpenFile(file.id)}
              >
                <Icon name="file" size={15} /> <span>{file.name}</span>
                <small>{file.kind === 'generated' ? 'GEN RO' : file.access === 'read-only' ? 'RO' : file.modified ? 'M' : ''}</small>
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
