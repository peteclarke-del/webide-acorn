/* Reading a folder from disk, and writing a project back to it.
 *
 * The folder importer reads through a directory `<input>`, which every browser
 * supports and which is a one-way door: the files arrive as a snapshot and
 * there is no way back to where they came from. A project imported that way can
 * only ever be exported as a download.
 *
 * The File System Access API gives a handle instead, so the same folder can be
 * written back to. It is not available everywhere — at the time of writing
 * Firefox and Safari do not implement `showDirectoryPicker` — so this module
 * reports what the browser can actually do rather than offering a control that
 * would fail when used, and the directory-input path remains for everyone else.
 *
 * Nothing is written without permission being granted for writing specifically.
 * Read access does not imply it, and asking at the point of saving rather than
 * at the point of importing is what a person expects.
 */

import { PALETTE_MODES } from '../assets/paletteDocument';
import { screenGeometry } from '../assets/screenDocument';
import { unsafeWritePath } from './safeNames';

export interface DirectoryEntry {
  /** Path relative to the chosen folder, using forward slashes. */
  path: string;
  content: string;
  /**
   * The raw bytes, kept only for a file that is not text but is exactly the
   * length of a display mode's frame buffer. A loading screen is saved as the
   * bytes the video hardware reads, so it is not text and was skipped, and the
   * project arrived without the artwork it opens on. Nothing else keeps its
   * bytes, because everything else that is not text is not something this
   * product can do anything with.
   */
  bytes?: Uint8Array;
}

export interface DirectorySupport {
  /** Whether this browser can hand back a writable directory handle. */
  available: boolean;
  reason: string;
}

/* Typed locally: the API is not in every TypeScript DOM library yet, and
 * declaring what is used is clearer than widening the global namespace. */
interface FileSystemDirectoryHandleLike {
  readonly name: string;
  readonly kind: 'directory';
  entries(): AsyncIterableIterator<[string, FileSystemHandleLike]>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandleLike>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandleLike>;
  queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}
interface FileSystemFileHandleLike {
  readonly name: string;
  readonly kind: 'file';
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string | BufferSource | Blob): Promise<void>; close(): Promise<void> }>;
}
type FileSystemHandleLike = FileSystemDirectoryHandleLike | FileSystemFileHandleLike;

type PickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandleLike>;
};

export function directorySupport(target: Pick<PickerWindow, 'showDirectoryPicker'> = window as PickerWindow): DirectorySupport {
  if (typeof target.showDirectoryPicker !== 'function') {
    return {
      available: false,
      reason: 'This browser cannot open a folder it can also write back to. Importing still works; the project will be saved as a download rather than into the folder it came from.',
    };
  }
  if (!window.isSecureContext) {
    return { available: false, reason: 'Opening a writable folder needs a secure context. Serve the workbench over HTTPS, or over http://localhost, to use it.' };
  }
  return { available: true, reason: 'This browser can open a folder and write the project back to it.' };
}

/* Every length a BBC frame buffer takes, so a screen saved out of the machine
 * can be told apart from any other file that will not decode as text. */
const SCREEN_BUFFER_LENGTHS = new Set(PALETTE_MODES.map((profile) => screenGeometry(profile.id).byteLength));

export const MAX_DIRECTORY_FILES = 512;
export const MAX_DIRECTORY_BYTES = 8 * 1024 * 1024;

/* The same directories the importer already ignores. Kept here so a folder read
 * through a handle sees exactly what a folder read through the input sees. */
const IGNORED = new Set(['node_modules', '.git', '.svn', 'dist', 'build', 'out', 'target', '.cache', '.idea', '.vscode']);

export interface DirectoryReadResult {
  entries: DirectoryEntry[];
  /** Paths passed over, each with the reason, rather than silently skipped. */
  skipped: Array<{ path: string; reason: string }>;
  truncated: boolean;
}

/**
 * Read every readable text file under a directory handle. Binary files and
 * anything unreadable are reported rather than dropped, because a project
 * missing a file it should have contained is worse than one that says so.
 */
export async function readDirectory(handle: FileSystemDirectoryHandleLike): Promise<DirectoryReadResult> {
  const entries: DirectoryEntry[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  let bytes = 0;
  let truncated = false;

  const walk = async (directory: FileSystemDirectoryHandleLike, prefix: string): Promise<void> => {
    for await (const [name, child] of directory.entries()) {
      if (entries.length >= MAX_DIRECTORY_FILES) { truncated = true; return; }
      const path = prefix ? `${prefix}/${name}` : name;
      if (child.kind === 'directory') {
        if (IGNORED.has(name)) { skipped.push({ path, reason: 'a build or tooling directory the importer never reads' }); continue; }
        await walk(child, path);
        continue;
      }
      try {
        const file = await child.getFile();
        if (bytes + file.size > MAX_DIRECTORY_BYTES) { truncated = true; return; }
        const content = await file.text();
        /* The same test the importer uses: a control character that is not
         * whitespace means this is not text, whatever its extension says. */
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(content)) {
          if (SCREEN_BUFFER_LENGTHS.has(file.size)) {
            bytes += file.size;
            entries.push({ path, content: '', bytes: new Uint8Array(await file.arrayBuffer()) });
            continue;
          }
          skipped.push({ path, reason: 'not readable as text' });
          continue;
        }
        bytes += file.size;
        entries.push({ path, content });
      } catch (error) {
        skipped.push({ path, reason: error instanceof Error ? error.message : 'could not be read' });
      }
    }
  };

  await walk(handle, '');
  return { entries, skipped, truncated };
}

export interface WriteResult {
  written: string[];
  /** Files that could not be written, each with the reason. */
  failed: Array<{ path: string; reason: string }>;
}

/**
 * Write files back into the folder they came from. Permission for writing is
 * requested here rather than at import, because that is when it is needed and
 * when a person can judge the request. A refusal is returned, not thrown past
 * the caller, so partial success is reportable.
 */
export async function writeDirectory(
  handle: FileSystemDirectoryHandleLike,
  files: ReadonlyArray<DirectoryEntry>,
): Promise<WriteResult> {
  const granted = await handle.requestPermission?.({ mode: 'readwrite' }) ?? 'granted';
  if (granted !== 'granted') throw new Error('Permission to write to that folder was not granted, so nothing was saved.');

  const written: string[] = [];
  const failed: Array<{ path: string; reason: string }> = [];
  for (const file of files) {
    try {
      /* The shared naming rule decides, so a name the project accepted is a
       * name that can be written, and a path that would climb out of the
       * chosen folder is refused rather than resolved into somewhere else. */
      const unsafe = unsafeWritePath(file.path);
      if (unsafe) { failed.push({ path: file.path, reason: unsafe }); continue; }
      const segments = file.path.split('/');
      const name = segments.pop()!;
      let directory = handle;
      for (const segment of segments) directory = await directory.getDirectoryHandle(segment, { create: true });
      const target = await directory.getFileHandle(name, { create: true });
      const writable = await target.createWritable();
      await writable.write(file.content);
      await writable.close();
      written.push(file.path);
    } catch (error) {
      failed.push({ path: file.path, reason: error instanceof Error ? error.message : 'could not be written' });
    }
  }
  return { written, failed };
}

/** Ask for a folder, or explain why this browser cannot offer one. */
export async function pickDirectory(target: PickerWindow = window as PickerWindow): Promise<FileSystemDirectoryHandleLike | null> {
  const support = directorySupport(target);
  if (!support.available) throw new Error(support.reason);
  try {
    return await target.showDirectoryPicker!({ mode: 'readwrite' });
  } catch (error) {
    /* Dismissing the picker is not an error worth reporting as one. */
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}

export type { FileSystemDirectoryHandleLike };
