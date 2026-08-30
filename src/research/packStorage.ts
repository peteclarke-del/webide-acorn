/* Where the library lives between sessions.
 *
 * Browser storage, because that is the only place it can be: nothing here is
 * uploaded and nothing here is fetched, so a pack somebody imported is
 * available for exactly as long as their browser keeps it, and available
 * offline for the same reason.
 *
 * Reading is deliberately not the mirror of writing. Anything stored is
 * re-parsed and re-digested on the way back in, because storage is editable by
 * hand and a partial write leaves a partial record; and a quota failure on the
 * way out is reported rather than swallowed, because a library that silently
 * stopped saving would look exactly like one that had saved.
 */
import { emptyLibrary, parsePackLibrary, type PackLibrary } from './packLibrary';

export const PACK_STORAGE_KEY = '8bit-net-dev:reference-packs';

export interface LoadedLibrary {
  library: PackLibrary;
  /** Anything that would not load, each with its reason. */
  dropped: string[];
}

export function loadPackLibrary(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): LoadedLibrary {
  if (!storage) return { library: emptyLibrary(), dropped: [] };
  let raw: string | null = null;
  try {
    raw = storage.getItem(PACK_STORAGE_KEY);
  } catch {
    /* A browser configured to refuse site data throws on access rather than
     * returning nothing. That is not a corrupt library; it is no library. */
    return { library: emptyLibrary(), dropped: [] };
  }
  if (!raw) return { library: emptyLibrary(), dropped: [] };
  try {
    return parsePackLibrary(JSON.parse(raw));
  } catch (error) {
    return {
      library: emptyLibrary(),
      dropped: [`The stored reference library could not be read and was not loaded: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

/**
 * Save, reporting failure rather than hiding it.
 *
 * Returns the reason on failure instead of throwing, because the caller is a
 * panel that has just done something for somebody and needs to tell them
 * whether it stuck.
 */
export function savePackLibrary(library: PackLibrary, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): string | null {
  if (!storage) return 'This browser is not keeping site data, so the reference library will be gone when this page closes.';
  try {
    storage.setItem(PACK_STORAGE_KEY, JSON.stringify(library));
    return null;
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'QuotaExceededError' || /quota/i.test(String(error))) {
      return 'There was not enough room in this browser to save the reference library, so this change will be gone when the page closes. Remove a pack and try again.';
    }
    return `The reference library could not be saved: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
