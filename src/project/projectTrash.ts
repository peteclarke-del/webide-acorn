/* Deleting a file from a project, reversibly.
 *
 * Deletion used to be a confirmation dialog and then the file was gone, along
 * with every build target that named it and every bookmark inside it. A
 * confirmation is not an undo: it asks whether you meant it, which is a
 * different question from whether you were right.
 *
 * A deleted file now goes to the project's own trash, together with the build
 * targets and bookmarks that were removed with it, so restoring puts back the
 * state that existed rather than an approximation of it. The trash lives in the
 * project, so it survives a reload and travels with an export.
 */
import { createBuildTarget, type BuildTarget } from '../build/buildTarget';
import { uniqueFilename, type LocalProject, type ProjectFile, type SourceBookmark } from './project';

/** Kept small deliberately: a trash is an undo, not an archive. */
export const MAX_TRASH_ENTRIES = 25;

export interface TrashedFile {
  /** The identifier the file had, which restoring gives back. */
  id: string;
  deletedAt: string;
  file: ProjectFile;
  /** Build targets removed because they named this file. */
  buildTargets: BuildTarget[];
  /** Bookmarks that lived in this file. */
  bookmarks: SourceBookmark[];
}

export interface TrashResult {
  project: LocalProject;
  entry: TrashedFile;
  /** Entries dropped to stay within the limit, reported rather than silent. */
  dropped: TrashedFile[];
}

/** Everything about the project that referenced this file, gathered in one place. */
function dependents(project: LocalProject, id: string) {
  return {
    buildTargets: project.buildTargets.filter((target) => target.entryFileId === id),
    bookmarks: project.bookmarks.filter((bookmark) => bookmark.fileId === id),
  };
}

/**
 * Move a file to the trash. Refuses to empty the project, because a project
 * with no files has nothing to build and nothing to restore into.
 */
export function trashFile(project: LocalProject, id: string, deletedAt: string): TrashResult {
  const file = project.files.find((candidate) => candidate.id === id);
  if (!file) throw new Error('That file is not in this project');
  if (project.files.length === 1) throw new Error('A project must contain at least one source file');

  const removed = dependents(project, id);
  const files = project.files.filter((candidate) => candidate.id !== id);
  let buildTargets = project.buildTargets.filter((target) => target.entryFileId !== id);
  /* A project always has somewhere to build from. If the last target named the
   * deleted file, one is created for a remaining source rather than leaving the
   * project in a state no build could run from. */
  if (!buildTargets.length) buildTargets = [createBuildTarget(files.find((item) => item.language === '6502' || item.language === 'bbc-basic') ?? files[0]!)];
  const activeBuildTargetId = buildTargets.some((target) => target.id === project.activeBuildTargetId)
    ? project.activeBuildTargetId
    : buildTargets[0]!.id;

  const entry: TrashedFile = { id, deletedAt, file: { ...file }, buildTargets: removed.buildTargets, bookmarks: removed.bookmarks };
  const combined = [entry, ...project.trash];
  const dropped = combined.slice(MAX_TRASH_ENTRIES);

  return {
    project: {
      ...project,
      files,
      buildTargets,
      activeBuildTargetId,
      bookmarks: project.bookmarks.filter((bookmark) => bookmark.fileId !== id),
      breakpoints: Object.fromEntries(Object.entries(project.breakpoints).filter(([fileId]) => fileId !== id)),
      trash: combined.slice(0, MAX_TRASH_ENTRIES),
    },
    entry,
    dropped,
  };
}

export interface RestoreResult {
  project: LocalProject;
  entry: TrashedFile;
  /** The name it came back under, when the original was taken in the meantime. */
  renamedTo: string | null;
  /** Build targets that could not be restored, with the reason. */
  skippedTargets: string[];
}

/**
 * Put a trashed file back, with the build targets and bookmarks that went with
 * it. A name taken since the deletion is resolved by renaming rather than by
 * overwriting whatever now holds it.
 */
export function restoreFromTrash(project: LocalProject, id: string): RestoreResult {
  const entry = project.trash.find((candidate) => candidate.id === id);
  if (!entry) throw new Error('That file is not in the trash');
  if (project.files.some((file) => file.id === id)) throw new Error(`${entry.file.name} is already in the project`);

  const taken = project.files.some((file) => file.name.toLowerCase() === entry.file.name.toLowerCase());
  const name = taken ? uniqueFilename(entry.file.name, project.files) : entry.file.name;
  const file: ProjectFile = { ...entry.file, name, savedName: entry.file.savedName ? name : entry.file.savedName };

  /* A build target only comes back if its identifier is still free; one taken
   * since the deletion belongs to something else now. */
  const skippedTargets: string[] = [];
  const buildTargets = [...project.buildTargets];
  for (const target of entry.buildTargets) {
    if (project.buildTargets.some((existing) => existing.id === target.id)) {
      skippedTargets.push(`${target.name} was not restored because another build target now uses its identifier`);
      continue;
    }
    buildTargets.push(target);
  }

  return {
    project: {
      ...project,
      files: [...project.files, file],
      buildTargets,
      bookmarks: [...project.bookmarks, ...entry.bookmarks],
      trash: project.trash.filter((candidate) => candidate.id !== id),
    },
    entry,
    renamedTo: taken ? name : null,
    skippedTargets,
  };
}

/** Remove one entry, or everything, permanently. */
export function purgeTrash(project: LocalProject, id?: string): LocalProject {
  return { ...project, trash: id ? project.trash.filter((entry) => entry.id !== id) : [] };
}

/** One line describing what a trashed entry would bring back. */
export function trashEntrySummary(entry: TrashedFile): string {
  const parts: string[] = [];
  if (entry.buildTargets.length) parts.push(`${entry.buildTargets.length} build target${entry.buildTargets.length === 1 ? '' : 's'}`);
  if (entry.bookmarks.length) parts.push(`${entry.bookmarks.length} bookmark${entry.bookmarks.length === 1 ? '' : 's'}`);
  return parts.length ? `restores with ${parts.join(' and ')}` : 'restores on its own';
}

/** Validate trash entries arriving from a project file. */
export function validateTrash(value: unknown, knownFileIds: ReadonlySet<string>): TrashedFile[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: TrashedFile[] = [];
  for (const candidate of value.slice(0, MAX_TRASH_ENTRIES)) {
    if (!candidate || typeof candidate !== 'object') continue;
    const entry = candidate as Partial<TrashedFile>;
    const file = entry.file as ProjectFile | undefined;
    if (typeof entry.id !== 'string' || !entry.id || seen.has(entry.id)) continue;
    /* A trashed file whose identifier is back in the project would restore into
     * a collision, so it is not carried. */
    if (knownFileIds.has(entry.id)) continue;
    if (!file || typeof file.name !== 'string' || typeof file.content !== 'string') continue;
    if (typeof entry.deletedAt !== 'string' || !Number.isFinite(Date.parse(entry.deletedAt))) continue;
    seen.add(entry.id);
    entries.push({
      id: entry.id,
      deletedAt: entry.deletedAt,
      file,
      buildTargets: Array.isArray(entry.buildTargets) ? entry.buildTargets.slice(0, 16) : [],
      bookmarks: Array.isArray(entry.bookmarks) ? entry.bookmarks.slice(0, 64) : [],
    });
  }
  return entries;
}
