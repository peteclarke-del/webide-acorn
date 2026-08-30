/* Keeping the working project in browser storage, and being honest about it.
 *
 * The project autosaves on every change. That is the right behaviour and it was
 * already here, but it was written as a bare `setItem` with nothing around it,
 * which produced two ways for the product to mislead someone.
 *
 * A full quota throws. The write failed, the interface said nothing, and the
 * next crash or reload lost everything since the last successful save while the
 * session looked exactly as it had a moment before. Saving now reports its
 * outcome, and a failure is shown rather than swallowed.
 *
 * A stored project that would not parse was replaced with a new empty one. From
 * the outside that is indistinguishable from the product having thrown the work
 * away — and the bytes were still sitting in storage the whole time. Now they
 * are moved aside intact, the reason is reported, and they can be downloaded.
 */
import { newProject, parseProject, type LocalProject } from './project';

export const PROJECT_STORAGE_KEY = '8bit-net-dev:local-project';
/** Where a snapshot that could not be read is kept rather than destroyed. */
export const QUARANTINE_STORAGE_KEY = '8bit-net-dev:local-project-unreadable';

export type SaveOutcome =
  | { ok: true; bytes: number; at: number }
  | { ok: false; reason: string; recoverable: boolean };

function storage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

/* How much this origin is holding, appended to a quota message so the figure
 * is a measurement rather than a guess. Silent when it cannot be measured. */
function usageNote(): string {
  const usage = storageUsage();
  return usage ? ` (this site is holding ${(usage.bytes / 1024).toFixed(0)} KiB across ${usage.keys} item${usage.keys === 1 ? '' : 's'})` : '';
}

/**
 * Write the working project. A failure returns why, and never leaves storage
 * holding a partial write: the previous snapshot is left exactly as it was, so
 * the fallback is the last good save rather than nothing.
 */
export function saveProjectSnapshot(project: LocalProject, now = Date.now()): SaveOutcome {
  const store = storage();
  if (!store) return { ok: false, reason: 'This browser does not allow local storage for this site, so the project is not being saved here.', recoverable: false };
  let text: string;
  try { text = JSON.stringify(project); }
  catch (error) { return { ok: false, reason: `The project could not be serialised: ${error instanceof Error ? error.message : String(error)}`, recoverable: false }; }
  /* What is there now, so a write that does not take can be undone rather than
   * leaving storage holding neither the old project nor the new one. */
  let previous: string | null = null;
  try { previous = store.getItem(PROJECT_STORAGE_KEY); } catch { previous = null; }

  try {
    store.setItem(PROJECT_STORAGE_KEY, text);
    /* Read back what was written. A browser can accept a write and store
     * nothing — a private window near its limit, or an extension partitioning
     * storage — and a save that reports success without having happened is the
     * one failure that costs someone their work. */
    const stored = store.getItem(PROJECT_STORAGE_KEY);
    if (stored !== text) {
      rollback(store, previous);
      return {
        ok: false,
        recoverable: true,
        reason: stored === null
          ? 'The browser accepted the save and then stored nothing, so the project was not saved. The last successful save is still there. Export the project before continuing.'
          : `The browser stored ${stored.length.toLocaleString()} of the ${text.length.toLocaleString()} bytes written, so the save was incomplete and has been undone. The last successful save is still there. Export the project before continuing.`,
      };
    }
    return { ok: true, bytes: text.length, at: now };
  } catch (error) {
    const quota = error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    return {
      ok: false,
      recoverable: quota,
      reason: quota
        ? `Browser storage is full, so this ${text.length.toLocaleString()}-byte project was not saved${usageNote()}. The last successful save is still there. Export the project, or free space in Settings, before continuing.`
        : `The project could not be saved: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/* Put back what was there before a write that did not take. Nothing more can
 * be done if this fails too, but the reported outcome is already a failure. */
function rollback(store: Storage, previous: string | null): void {
  try {
    if (previous === null) store.removeItem(PROJECT_STORAGE_KEY);
    else store.setItem(PROJECT_STORAGE_KEY, previous);
  } catch { /* the caller is already reporting that the save did not happen */ }
}

export interface StorageUsage {
  /** Characters held by this origin, across every key. */
  bytes: number;
  keys: number;
  /** Of those, what this project's snapshot accounts for. */
  projectBytes: number;
}

/**
 * What this origin is holding in browser storage.
 *
 * The browser does not expose its own limit, so none is reported: a figure
 * invented here would be wrong on some browser and would be believed. What can
 * be measured is what is stored, which is what makes a full-quota message
 * actionable — it says how much is there and what the project's share of it is.
 */
export function storageUsage(): StorageUsage | null {
  const store = storage();
  if (!store) return null;
  try {
    let bytes = 0;
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key === null) continue;
      bytes += key.length + (store.getItem(key)?.length ?? 0);
    }
    return { bytes, keys: store.length, projectBytes: store.getItem(PROJECT_STORAGE_KEY)?.length ?? 0 };
  } catch {
    return null;
  }
}

export type LoadStatus = 'restored' | 'empty' | 'unreadable' | 'unavailable';

export interface LoadResult {
  project: LocalProject;
  status: LoadStatus;
  /** What happened, when it was not simply restored. */
  reason?: string;
  /** Bytes preserved because they could not be read, if any. */
  quarantinedBytes?: number;
}

/**
 * Load the working project. A snapshot that cannot be read is moved aside
 * rather than overwritten, because the difference between "your work is
 * unreadable" and "your work is gone" matters, and only one of them is true.
 */
export function loadProjectSnapshot(): LoadResult {
  const store = storage();
  if (!store) {
    return { project: newProject(), status: 'unavailable', reason: 'This browser does not allow local storage for this site, so nothing was restored and nothing will be saved here.' };
  }
  let stored: string | null;
  try { stored = store.getItem(PROJECT_STORAGE_KEY); }
  catch (error) { return { project: newProject(), status: 'unavailable', reason: `Browser storage could not be read: ${error instanceof Error ? error.message : String(error)}` }; }
  if (!stored) return { project: newProject(), status: 'empty' };

  try {
    return { project: parseProject(stored), status: 'restored' };
  } catch (error) {
    /* Preserve the bytes before replacing them. They are the user's work, and
     * a later build or a manual repair may well read them. */
    try { store.setItem(QUARANTINE_STORAGE_KEY, stored); } catch { /* nothing more can be done, but the message below is still true of what was read */ }
    return {
      project: newProject(),
      status: 'unreadable',
      quarantinedBytes: stored.length,
      reason: `The saved project could not be read: ${error instanceof Error ? error.message : String(error)}. Its ${stored.length.toLocaleString()} bytes have been kept aside and can be downloaded rather than discarded.`,
    };
  }
}

/** The preserved bytes of a snapshot that could not be read, if there are any. */
export function quarantinedSnapshot(): string | null {
  try { return storage()?.getItem(QUARANTINE_STORAGE_KEY) ?? null; } catch { return null; }
}

export function clearQuarantinedSnapshot(): void {
  try { storage()?.removeItem(QUARANTINE_STORAGE_KEY); } catch { /* already unreachable */ }
}

/** One line for the status area describing where the project stands. */
export function saveStateSummary(outcome: SaveOutcome | null, now = Date.now()): string {
  if (!outcome) return 'Not yet saved in this browser';
  if (!outcome.ok) return outcome.reason;
  const seconds = Math.max(0, Math.round((now - outcome.at) / 1000));
  const when = seconds < 2 ? 'just now' : seconds < 60 ? `${seconds} seconds ago` : `${Math.round(seconds / 60)} minute${Math.round(seconds / 60) === 1 ? '' : 's'} ago`;
  return `Saved in this browser ${when} · ${(outcome.bytes / 1024).toFixed(1)} KiB`;
}
