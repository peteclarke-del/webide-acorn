import { describe, expect, it } from 'vitest';
import { emptyAnalysisAnnotations, withComment, withEntryPoint } from './analysisAnnotations';
import {
  annotationHistorySummary,
  canRedoAnnotations,
  canUndoAnnotations,
  createAnnotationHistory,
  currentAnnotations,
  recordAnnotationEdit,
  redoAnnotations,
  redoDescription,
  undoAnnotations,
  undoDescription,
} from './annotationHistory';

const DIGEST = 'b'.repeat(64);
const start = () => emptyAnalysisAnnotations(DIGEST);

describe('analysis annotation history', () => {
  it('begins at the opened state with nothing to undo or redo', () => {
    const history = createAnnotationHistory(start());
    expect(canUndoAnnotations(history)).toBe(false);
    expect(canRedoAnnotations(history)).toBe(false);
    expect(undoDescription(history)).toBeNull();
    expect(redoDescription(history)).toBeNull();
    expect(annotationHistorySummary(history)).toBe('Step 1 of 1 · No annotations recorded');
  });

  it('needs room for at least two states to be a history at all', () => {
    expect(() => createAnnotationHistory(start(), 'opened', 1)).toThrow(/at least two/);
  });

  it('restores the exact earlier document rather than a reconstruction', () => {
    const first = start();
    const second = withEntryPoint(first, 0x1900);
    const third = withComment(second, 0x1900, 'loader entry');
    let history = createAnnotationHistory(first);
    history = recordAnnotationEdit(history, second, 'Add entry point &1900');
    history = recordAnnotationEdit(history, third, 'Comment &1900');
    expect(currentAnnotations(history)).toBe(third);
    history = undoAnnotations(history);
    expect(currentAnnotations(history)).toBe(second);
    history = undoAnnotations(history);
    expect(currentAnnotations(history)).toBe(first);
    expect(canUndoAnnotations(history)).toBe(false);
    history = redoAnnotations(history);
    expect(currentAnnotations(history)).toBe(second);
  });

  it('names what undo and redo would do next', () => {
    let history = createAnnotationHistory(start());
    history = recordAnnotationEdit(history, withEntryPoint(start(), 0x1900), 'Add entry point &1900');
    expect(undoDescription(history)).toBe('Add entry point &1900');
    history = undoAnnotations(history);
    expect(redoDescription(history)).toBe('Add entry point &1900');
  });

  it('discards the redo branch once a new edit is recorded', () => {
    const second = withEntryPoint(start(), 0x1900);
    const alternative = withEntryPoint(start(), 0x2000);
    let history = recordAnnotationEdit(createAnnotationHistory(start()), second, 'Add &1900');
    history = undoAnnotations(history);
    history = recordAnnotationEdit(history, alternative, 'Add &2000');
    expect(canRedoAnnotations(history)).toBe(false);
    expect(currentAnnotations(history)).toBe(alternative);
    expect(history.entries).toHaveLength(2);
  });

  it('ignores an edit that produced the state already in effect', () => {
    const history = createAnnotationHistory(start());
    const annotations = currentAnnotations(history);
    expect(recordAnnotationEdit(history, annotations, 'No change')).toBe(history);
  });

  it('drops the oldest steps at its capacity and says how many it lost', () => {
    let history = createAnnotationHistory(start(), 'Analysis opened', 3);
    let annotations = start();
    for (const address of [0x1900, 0x1910, 0x1920, 0x1930]) {
      annotations = withEntryPoint(annotations, address);
      history = recordAnnotationEdit(history, annotations, `Add &${address.toString(16)}`);
    }
    expect(history.entries).toHaveLength(3);
    expect(history.dropped).toBe(2);
    expect(annotationHistorySummary(history)).toContain('2 earlier steps dropped at the 3-step limit');
    /* The oldest reachable state is the third edit, not the opened one. */
    let rewound = history;
    while (canUndoAnnotations(rewound)) rewound = undoAnnotations(rewound);
    expect(currentAnnotations(rewound).entryPoints).toEqual([0x1900, 0x1910]);
  });

  it('does nothing when undo or redo has nowhere to go', () => {
    const history = createAnnotationHistory(start());
    expect(undoAnnotations(history)).toBe(history);
    expect(redoAnnotations(history)).toBe(history);
  });
});
