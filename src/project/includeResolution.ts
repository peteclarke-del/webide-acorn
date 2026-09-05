/* Where an INCLUDE points, once a project can hold folders.
 *
 * A project used to hold a flat list of names, so an include resolved by
 * looking the requested name up and nothing else. Now that an imported
 * codebase keeps the shape it had on disk, `INCLUDE "sprites.s"` written in
 * `src/main.s` means the file beside it, exactly as it did in the assembler the
 * code was written for. The order below is what a person expects and what the
 * original toolchain does:
 *
 *   1. beside the file doing the including,
 *   2. as a path from the top of the project,
 *   3. by basename anywhere in the project, but only when exactly one file
 *      carries that name — a guess between two candidates would silently build
 *      the wrong program.
 *
 * The lookup map is keyed by lowercased name because the machines this product
 * targets, and the filesystems it is used on, do not agree about case.
 */

/** The folder part of a project name, keeping its trailing slash, or ''. */
export function directoryOf(name: string): string {
  const slash = name.lastIndexOf('/');
  return slash < 0 ? '' : name.slice(0, slash + 1);
}

/** The basename of a project name. */
export function basenameOf(name: string): string {
  const slash = name.lastIndexOf('/');
  return slash < 0 ? name : name.slice(slash + 1);
}

/**
 * `requested` resolved against `directory`, or null if it climbs above the top
 * of the project. A path that leaves the project cannot name a project file, so
 * refusing it is the honest answer rather than clamping it to the root.
 */
export function resolveRelativeName(directory: string, requested: string): string | null {
  const segments = `${directory}${requested}`.replaceAll('\\', '/').split('/');
  const resolved: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') { if (!resolved.length) return null; resolved.pop(); continue; }
    resolved.push(segment);
  }
  return resolved.length ? resolved.join('/') : null;
}

/**
 * The project file an include names, or undefined when nothing answers to it.
 *
 * `byName` is keyed by lowercased project name; `fromName` is the file the
 * directive was written in, so that a relative include means what it says.
 */
export function resolveIncluded<T>(byName: ReadonlyMap<string, T>, requested: string, fromName: string): T | undefined {
  const asked = requested.trim().replaceAll('\\', '/');
  if (!asked) return undefined;

  const beside = resolveRelativeName(directoryOf(fromName), asked);
  if (beside) {
    const found = byName.get(beside.toLowerCase());
    if (found) return found;
  }

  const fromRoot = resolveRelativeName('', asked);
  if (fromRoot) {
    const found = byName.get(fromRoot.toLowerCase());
    if (found) return found;
  }

  /* Last resort, for a project whose files gained folders after the includes
   * were written. Only ever answered when the name is unambiguous. */
  const base = basenameOf(asked).toLowerCase();
  if (!base || base === asked.toLowerCase()) {
    let only: T | undefined;
    let seen = 0;
    for (const [name, value] of byName) {
      if (basenameOf(name) !== base) continue;
      seen += 1;
      only = value;
    }
    if (seen === 1) return only;
  }
  return undefined;
}
