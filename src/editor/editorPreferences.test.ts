import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_EDITOR_PREFERENCES, EDITOR_PREFERENCES_KEY, normalizeEditorPreferences, readEditorPreferences, writeEditorPreferences } from './editorPreferences';

describe('editor preferences', () => {
  it('normalizes bounded typography, tab and wrap values', () => {
    expect(normalizeEditorPreferences({ fontSize: 16, lineHeight: 28, tabSize: 4, wordWrap: true })).toEqual({ fontSize: 16, lineHeight: 28, tabSize: 4, wordWrap: true });
    expect(normalizeEditorPreferences({ fontSize: 99, lineHeight: 2, tabSize: 3, wordWrap: 'yes' })).toEqual(DEFAULT_EDITOR_PREFERENCES);
  });

  it('reads valid JSON and recovers from malformed storage', () => {
    expect(readEditorPreferences({ getItem: () => '{"fontSize":14,"lineHeight":24,"tabSize":8,"wordWrap":true}' })).toMatchObject({ fontSize: 14, lineHeight: 24, tabSize: 8, wordWrap: true });
    expect(readEditorPreferences({ getItem: () => '{broken' })).toEqual(DEFAULT_EDITOR_PREFERENCES);
  });

  it('writes only the normalized schema and reports storage refusal', () => {
    const setItem = vi.fn();
    expect(writeEditorPreferences({ fontSize: 12, lineHeight: 23, tabSize: 4, wordWrap: false }, { setItem })).toBe(true);
    expect(setItem).toHaveBeenCalledWith(EDITOR_PREFERENCES_KEY, '{"fontSize":12,"lineHeight":23,"tabSize":4,"wordWrap":false}');
    expect(writeEditorPreferences(DEFAULT_EDITOR_PREFERENCES, { setItem: () => { throw new Error('quota'); } })).toBe(false);
  });
});
