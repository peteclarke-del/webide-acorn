import { createProjectBundle, openProjectBundle } from '../project/projectBundle';
import type { LocalProject } from '../project/project';

/*
 * What a stored revision carries besides the source files.
 *
 * A revision used to hold only filenames against contents, which is enough to
 * read a program back but not enough to open the project it belonged to: the
 * build targets, breakpoints, bookmarks, disk sets and settings were left
 * behind, and opening a stored project meant having them guessed again from the
 * source. So a revision also carries the project's own portable bundle, under a
 * name the rest of the product already ignores.
 *
 * The bundle is the same one the export dialog writes, digests and all, so a
 * revision whose files were altered underneath it is refused on the way out
 * rather than opened as though nothing had happened.
 */

/** Dot-prefixed, so an importer that skips dot files skips this too. */
export const STORE_MANIFEST_FILENAME = '.8bit-net-project.json';

/** The files to commit for a project: its sources, and the project itself. */
export function storedFilesFor(project: LocalProject, createdAt: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const file of project.files) files[file.name] = file.content;
  files[STORE_MANIFEST_FILENAME] = JSON.stringify(createProjectBundle(project, { createdAt }), null, 2);
  return files;
}

export interface StoredProjectOpen {
  project: LocalProject | null;
  /** What happened, in words for a person, whether or not it worked. */
  detail: string;
}

/**
 * The project a revision holds, or the reason it holds none.
 *
 * A revision written before this existed, or by something that only sent
 * sources, has no manifest. That is not an error and not something to repair by
 * inventing build targets here: the caller is told, and can import the files as
 * a codebase instead, which is the path that proposes targets and says why.
 */
export function projectFromStoredFiles(files: Readonly<Record<string, string>>): StoredProjectOpen {
  const manifest = files[STORE_MANIFEST_FILENAME];
  if (manifest === undefined) {
    const count = Object.keys(files).length;
    return {
      project: null,
      detail: `This revision carries ${count} file${count === 1 ? '' : 's'} and no project manifest, so its build targets and breakpoints were never stored. Import the files as a codebase to propose targets for them.`,
    };
  }
  try {
    /* A bundle whose contents disagree with its own manifest is refused by the
     * opener rather than returned with a warning, so there is no half-opened
     * project to decide about here. */
    const opened = openProjectBundle(manifest);
    const migrated = opened.migratedFrom ? ` Its format was migrated from ${opened.migratedFrom}.` : '';
    return {
      project: opened.project,
      detail: `Opened ${opened.project.name} with ${opened.project.files.length} file${opened.project.files.length === 1 ? '' : 's'} and ${opened.project.buildTargets.length} build target${opened.project.buildTargets.length === 1 ? '' : 's'}.${migrated}`,
    };
  } catch (error) {
    return {
      project: null,
      detail: `The stored project could not be opened: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Whether a stored filename is the manifest rather than somebody's source. */
export function isStoreManifest(name: string): boolean {
  return name === STORE_MANIFEST_FILENAME;
}
