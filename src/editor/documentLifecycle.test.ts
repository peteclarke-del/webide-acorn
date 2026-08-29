import { describe, expect, it } from 'vitest';
import { closeAllDocuments, closeDocument, closeOtherDocuments, initialDocuments, openDocument, removeDocument, reopenClosedDocument } from './documentLifecycle';

describe('editor document lifecycle', () => {
  it('closes the active tab and selects its right neighbour before its left', () => {
    let state = initialDocuments(['a', 'b', 'c']);
    state = openDocument(openDocument(state, 'b'), 'c');
    state = { ...state, activeId: 'b' };
    expect(closeDocument(state, 'b')).toMatchObject({ openIds: ['a', 'c'], activeId: 'c', recentlyClosed: ['b'] });
  });

  it('closes all without deleting availability and reopens in reverse close order', () => {
    let state = initialDocuments(['a', 'b']);
    state = openDocument(state, 'b');
    state = closeAllDocuments(state);
    expect(state).toMatchObject({ openIds: [], activeId: undefined, recentlyClosed: ['a', 'b'] });
    state = reopenClosedDocument(state, ['a', 'b']);
    expect(state).toMatchObject({ openIds: ['b'], activeId: 'b', recentlyClosed: ['a'] });
  });

  it('closes other tabs and permanently prunes a deleted file from history', () => {
    let state = initialDocuments(['a', 'b', 'c']);
    state = openDocument(openDocument(state, 'b'), 'c');
    state = closeOtherDocuments(state, 'b');
    expect(state).toMatchObject({ openIds: ['b'], activeId: 'b', recentlyClosed: ['a', 'c'] });
    state = removeDocument(state, 'c', ['a', 'b']);
    expect(state.recentlyClosed).toEqual(['a']);
  });
});
