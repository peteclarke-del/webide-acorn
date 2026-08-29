/* Undo and redo over analysis annotations.
 *
 * Annotation edits are pure functions returning whole documents, so history is
 * a bounded list of those documents rather than a list of inverse operations.
 * That has two properties worth the memory: undo is exact — it restores the
 * document that existed, not a reconstruction of it — and a corrupted or
 * partially applied edit cannot leave the history describing a state that never
 * existed.
 *
 * The cap is on entries, not bytes, and the oldest entries are dropped from the
 * far end. Dropping is reported rather than silent, because a user who has just
 * lost the ability to undo their earliest edit should be able to find out why.
 */
import { annotationSummary, type AnalysisAnnotations } from './analysisAnnotations';

export const DEFAULT_HISTORY_CAPACITY = 64;

export interface AnnotationHistoryEntry {
  readonly annotations: AnalysisAnnotations;
  /** What the edit did, in the user's terms. The first entry describes the starting point. */
  readonly description: string;
}

export interface AnnotationHistory {
  readonly entries: readonly AnnotationHistoryEntry[];
  /** Index into `entries` of the state currently in effect. */
  readonly position: number;
  readonly capacity: number;
  /** How many entries have been dropped from the oldest end to stay within capacity. */
  readonly dropped: number;
}

export function createAnnotationHistory(
  annotations: AnalysisAnnotations,
  description = 'Analysis opened',
  capacity = DEFAULT_HISTORY_CAPACITY,
): AnnotationHistory {
  if (!Number.isInteger(capacity) || capacity < 2) throw new Error('An annotation history needs room for at least two states');
  return Object.freeze({
    entries: Object.freeze([Object.freeze({ annotations, description })]),
    position: 0,
    capacity,
    dropped: 0,
  });
}

/**
 * Record a new state. Anything that had been undone is discarded, which is the
 * behaviour every editor has and the only one that keeps redo meaningful.
 * Recording the state already in effect is a no-op, so a repeated edit that
 * changes nothing does not fill the history with identical entries.
 */
export function recordAnnotationEdit(
  history: AnnotationHistory,
  annotations: AnalysisAnnotations,
  description: string,
): AnnotationHistory {
  if (annotations === current(history).annotations) return history;
  const kept = history.entries.slice(0, history.position + 1);
  const appended = [...kept, Object.freeze({ annotations, description })];
  const excess = Math.max(0, appended.length - history.capacity);
  const entries = excess ? appended.slice(excess) : appended;
  return Object.freeze({
    entries: Object.freeze(entries),
    position: entries.length - 1,
    capacity: history.capacity,
    dropped: history.dropped + excess,
  });
}

export function canUndoAnnotations(history: AnnotationHistory): boolean {
  return history.position > 0;
}

export function canRedoAnnotations(history: AnnotationHistory): boolean {
  return history.position < history.entries.length - 1;
}

export function undoAnnotations(history: AnnotationHistory): AnnotationHistory {
  if (!canUndoAnnotations(history)) return history;
  return Object.freeze({ ...history, position: history.position - 1 });
}

export function redoAnnotations(history: AnnotationHistory): AnnotationHistory {
  if (!canRedoAnnotations(history)) return history;
  return Object.freeze({ ...history, position: history.position + 1 });
}

export function currentAnnotations(history: AnnotationHistory): AnalysisAnnotations {
  return current(history).annotations;
}

function current(history: AnnotationHistory): AnnotationHistoryEntry {
  return history.entries[history.position]!;
}

/** What undo would do next, for a button label or title. */
export function undoDescription(history: AnnotationHistory): string | null {
  return canUndoAnnotations(history) ? current(history).description : null;
}

/** What redo would do next. */
export function redoDescription(history: AnnotationHistory): string | null {
  return canRedoAnnotations(history) ? history.entries[history.position + 1]!.description : null;
}

/** One line describing where the reader is in their own edit history. */
export function annotationHistorySummary(history: AnnotationHistory): string {
  const step = `Step ${history.position + 1} of ${history.entries.length}`;
  const state = annotationSummary(currentAnnotations(history));
  const lost = history.dropped ? ` · ${history.dropped} earlier step${history.dropped === 1 ? '' : 's'} dropped at the ${history.capacity}-step limit` : '';
  return `${step} · ${state}${lost}`;
}
