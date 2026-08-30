/* One rule for what a name may be, wherever a name enters the product.
 *
 * Project filenames were only ever checked for slashes. That was survivable
 * while a project lived in browser storage and left as a download, because the
 * browser writes a download safely whatever it is called. It stopped being
 * survivable when a project could be written back into a folder on disk: the
 * names in the project become the names on a real filesystem, and several
 * shapes a project happily holds are either refused or silently altered there.
 *
 *   `.` and `..` are directory references, not files.
 *   `CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9` and `LPT1`-`LPT9` are device
 *   names on Windows, with or without an extension, and cannot be opened as
 *   files at all.
 *   A trailing dot or space is discarded by Windows when the file is created,
 *   so `report.` and `report` become the same file and one silently replaces
 *   the other.
 *   The characters < > : " | ? * and the control characters are refused by
 *   Windows, and a colon has its own meaning on macOS.
 *
 * The rule lives here rather than in either caller so that a name accepted into
 * a project is the same name that can be written to disk. A name that has to
 * change is reported with what changed and why: silently altering what someone
 * typed is how a person ends up looking for a file that is not there.
 */

/** Device names Windows reserves, with or without an extension. */
export const RESERVED_DEVICE_NAMES: ReadonlySet<string> = new Set([
  'con', 'prn', 'aux', 'nul',
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

/** Longest filename this product will hold, well inside every filesystem. */
export const MAX_FILENAME_LENGTH = 120;

const FALLBACK_NAME = 'untitled.txt';
const UNWRITABLE = /[\u0000-\u001f\u007f<>:"|?*]/g;

export interface NormalizedName {
  name: string;
  /** What had to change, in words for a person, or null if nothing did. */
  reason: string | null;
}

function splitExtension(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? { stem: name.slice(0, dot), extension: name.slice(dot) } : { stem: name, extension: '' };
}

/**
 * The name this product will use for what was requested, and what it changed.
 *
 * Every rule here is applied because a filesystem or the project model would
 * otherwise apply it silently. Nothing is refused outright: a name always comes
 * back, because a person who typed something unusable is better served by a
 * usable name and a sentence saying so than by a dialog that will not close.
 */
export function normalizeProjectFilename(requested: string): NormalizedName {
  const changes: string[] = [];
  let name = requested.trim();

  if (/[\\/]/.test(name)) { name = name.replace(/[\\/]/g, '-'); changes.push('path separators are not part of a project filename'); }
  if (UNWRITABLE.test(name)) { name = name.replace(UNWRITABLE, ''); changes.push('characters that a filesystem will not accept were removed'); }
  UNWRITABLE.lastIndex = 0;
  name = name.trim();

  if (name === '.' || name === '..') { changes.push(`"${name}" names a directory rather than a file`); name = ''; }

  /* Windows discards a trailing dot or space when it creates the file, so two
   * names differing only there would become one file on disk. */
  const withoutTail = name.replace(/[. ]+$/, '');
  if (withoutTail !== name) { name = withoutTail; changes.push('a trailing dot or space would be discarded when the file is written'); }

  if (!name) { name = FALLBACK_NAME; changes.push('the name was empty'); }

  const { stem, extension } = splitExtension(name);
  if (RESERVED_DEVICE_NAMES.has(stem.toLowerCase())) {
    name = `_${stem}${extension}`;
    changes.push(`"${stem}" is a reserved device name on Windows and cannot be a file`);
  }

  if (name.length > MAX_FILENAME_LENGTH) {
    const parts = splitExtension(name);
    const room = Math.max(1, MAX_FILENAME_LENGTH - parts.extension.length);
    name = `${parts.stem.slice(0, room)}${parts.extension}`.slice(0, MAX_FILENAME_LENGTH);
    changes.push(`names are limited to ${MAX_FILENAME_LENGTH} characters`);
  }

  return { name, reason: changes.length ? changes.join('; ') : null };
}

/**
 * Why a path may not be written into a chosen folder, or null if it may be.
 *
 * Separate from the normaliser because a path being written to disk is not
 * repaired: the project already holds names that passed the rule above, so a
 * path that fails here is either a bug or an attempt to write outside the
 * folder, and the honest response is to refuse it and name the file that was
 * not written.
 */
export function unsafeWritePath(path: string): string | null {
  if (!path || path.endsWith('/')) return 'has no filename';
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return 'leaves the chosen folder';
  for (const segment of segments) {
    if (normalizeProjectFilename(segment).name !== segment) return `contains "${segment}", which cannot be written as a filename`;
  }
  return null;
}
