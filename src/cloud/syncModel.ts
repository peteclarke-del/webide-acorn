/*
 * What state a project is in with respect to the store, and what may be done.
 *
 * The state is derived from three facts — what the store's head is, what this
 * workbench last synchronised against, and whether the files have changed since
 * — rather than remembered as a flag somebody has to keep correct. A remembered
 * flag is wrong exactly when it matters: after a crash, a reload, or a second
 * workbench.
 *
 * Nothing here performs I/O. It decides, and the panel carries the decisions
 * out, so every branch can be tested without a server.
 */
import { mergeText, type MergeConflict } from './textMerge';

export type SyncState =
  /** Never stored. Local mode, which is most projects and is not a problem. */
  | 'untracked'
  /** The store's head is what this workbench last synchronised, and nothing has changed. */
  | 'in-step'
  /** Local changes the store does not have. */
  | 'ahead'
  /** The store has moved on and this workbench has no local changes. */
  | 'behind'
  /** Both moved. Something has to be decided. */
  | 'diverged'
  /** The store could not be reached; whatever is queued is still queued. */
  | 'offline';

export interface SyncFacts {
  /** The store's newest revision, or null when the project is not there. */
  storeHead: string | null;
  /** The revision this workbench last wrote or read, or null. */
  syncedAt: string | null;
  /** Whether the files differ from what was last synchronised. */
  locallyChanged: boolean;
  /** Whether the store answered at all. */
  reachable: boolean;
}

export function syncState(facts: SyncFacts): SyncState {
  if (!facts.reachable) return 'offline';
  if (facts.storeHead === null) return facts.syncedAt === null ? 'untracked' : 'diverged';
  if (facts.syncedAt === null) return facts.locallyChanged ? 'diverged' : 'behind';
  const behind = facts.storeHead !== facts.syncedAt;
  if (behind && facts.locallyChanged) return 'diverged';
  if (behind) return 'behind';
  return facts.locallyChanged ? 'ahead' : 'in-step';
}

/** What a person is offered in each state, in the words the panel uses. */
export function syncActions(state: SyncState): { primary: string | null; detail: string } {
  switch (state) {
    case 'untracked':
      return { primary: 'Copy this project to the store', detail: 'This project is not in the store. Copying leaves the local one exactly as it is.' };
    case 'in-step':
      return { primary: null, detail: 'The store holds what this workbench last synchronised, and nothing has changed since.' };
    case 'ahead':
      return { primary: 'Send these changes', detail: 'There are local changes the store does not have.' };
    case 'behind':
      return { primary: 'Take the store’s newer revision', detail: 'The store has moved on and nothing has changed here, so there is nothing to lose.' };
    case 'diverged':
      return { primary: 'Merge', detail: 'Both this workbench and the store have changed since they last agreed. Nothing is sent or overwritten until a merge is reviewed.' };
    case 'offline':
      return { primary: null, detail: 'The store did not answer. Local work is unaffected and anything queued is still queued.' };
  }
}

/** One change waiting to be sent, kept in order. */
export interface QueuedCommit {
  id: string;
  projectId: string;
  files: Record<string, string>;
  /** The revision this was written against, so a stale send is caught. */
  parent: string | null;
  note: string;
  queuedAt: string;
  /** Why the last attempt did not succeed, when there has been one. */
  lastRefusal?: string;
}

export const MAX_QUEUED_COMMITS = 32;

/**
 * Add to the queue.
 *
 * A queue that grows without limit becomes a way to lose work quietly: nobody
 * reads a hundred pending items, and the oldest are the ones a person has
 * forgotten they made. The bound is small and reaching it is refused rather
 * than absorbed by dropping the oldest.
 */
export function queueCommit(queue: readonly QueuedCommit[], commit: QueuedCommit): { queue: QueuedCommit[]; refusal: string | null } {
  if (queue.length >= MAX_QUEUED_COMMITS) {
    return {
      queue: [...queue],
      refusal: `${MAX_QUEUED_COMMITS} changes are already waiting for the store. Send or discard them before making more, rather than letting the oldest be forgotten.`,
    };
  }
  /* Superseding an unsent commit for the same project keeps the queue about
   * what still has to happen rather than about what was typed. The parent of
   * the earliest is kept, because that is what the whole run was written
   * against. */
  const earlier = queue.filter((entry) => entry.projectId === commit.projectId);
  const rest = queue.filter((entry) => entry.projectId !== commit.projectId);
  const parent = earlier.length ? earlier[0]!.parent : commit.parent;

  return { queue: [...rest, { ...commit, parent }], refusal: null };
}

export interface FileMerge {
  name: string;
  /** 'ours' and 'theirs' where only one side has the file at all. */
  outcome: 'merged' | 'ours' | 'theirs' | 'conflict' | 'not-text';
  content: string;
  conflicts: MergeConflict[];
}

export interface MergePlan {
  files: FileMerge[];
  clean: boolean;
  /** Said plainly when a merge cannot be reviewed and forking is the honest answer. */
  forkAdvice: string | null;
}

/* Content this build will not attempt to merge line by line. A packed sprite or
 * a disk image merged as text is corrupt in a way nobody can see until it runs,
 * so it is reported as a choice between two versions instead. */
const TEXT_SUFFIXES = /\.(asm|s|bas|c|h|txt|md|json|inf|cfg|ld)$/i;

export function isMergeableName(name: string): boolean {
  return TEXT_SUFFIXES.test(name);
}

/**
 * What merging would produce, without doing it.
 *
 * The base is the revision both sides started from. Without one there is
 * nothing to merge against and the honest answer is a fork, said as such.
 */
export function planMerge(
  base: Record<string, string> | null,
  ours: Record<string, string>,
  theirs: Record<string, string>,
): MergePlan {
  if (!base) {
    return {
      files: [],
      clean: false,
      forkAdvice: 'These two versions share no revision to merge against, so there is nothing to compare them by. Fork instead: keep both under different names and decide by reading them.',
    };
  }
  const names = [...new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])].sort();
  const files: FileMerge[] = names.map((name) => {
    const ourText = ours[name];
    const theirText = theirs[name];
    const baseText = base[name];
    if (ourText === undefined && theirText === undefined) return { name, outcome: 'merged', content: '', conflicts: [] };
    if (theirText === undefined) return { name, outcome: 'ours', content: ourText ?? '', conflicts: [] };
    if (ourText === undefined) return { name, outcome: 'theirs', content: theirText, conflicts: [] };
    if (ourText === theirText) return { name, outcome: 'merged', content: ourText, conflicts: [] };
    if (!isMergeableName(name)) {
      return {
        name,
        outcome: 'not-text',
        /* Neither is chosen: that is the point of reporting it. */
        content: ourText,
        conflicts: [{ line: 1, base: [], ours: [`${ourText.length} bytes here`], theirs: [`${theirText.length} bytes in the store`] }],
      };
    }
    const merged = mergeText(baseText ?? '', ourText, theirText);
    return {
      name,
      outcome: merged.clean ? 'merged' : 'conflict',
      content: merged.merged,
      conflicts: merged.conflicts,
    };
  });
  const clean = files.every((file) => file.outcome !== 'conflict' && file.outcome !== 'not-text');

  return {
    files,
    clean,
    forkAdvice: clean
      ? null
      : 'Some files cannot be merged without deciding what was meant. Review them, or fork and keep both versions under different names.',
  };
}
