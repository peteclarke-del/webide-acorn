import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_EDITOR_PREFERENCES, EDITOR_PREFERENCES_KEY, normalizeEditorPreferences, readEditorPreferences, writeEditorPreferences } from './editorPreferences';

describe('editor preferences', () => {
  it('normalizes bounded typography, tab and wrap values', () => {
    expect(normalizeEditorPreferences({ fontSize: 16, lineHeight: 28, tabSize: 4, wordWrap: true, inlayHints: true })).toEqual({ fontSize: 16, lineHeight: 28, tabSize: 4, wordWrap: true, inlayHints: true });
    expect(normalizeEditorPreferences({ fontSize: 99, lineHeight: 2, tabSize: 3, wordWrap: 'yes', inlayHints: 'on' })).toEqual(DEFAULT_EDITOR_PREFERENCES);
  });

  it('reads valid JSON and recovers from malformed storage', () => {
    expect(readEditorPreferences({ getItem: () => '{"fontSize":14,"lineHeight":24,"tabSize":8,"wordWrap":true}' })).toMatchObject({ fontSize: 14, lineHeight: 24, tabSize: 8, wordWrap: true });
    expect(readEditorPreferences({ getItem: () => '{broken' })).toEqual(DEFAULT_EDITOR_PREFERENCES);
  });

  it('writes only the normalized schema and reports storage refusal', () => {
    const setItem = vi.fn();
    expect(writeEditorPreferences({ fontSize: 12, lineHeight: 23, tabSize: 4, wordWrap: false, inlayHints: true }, { setItem })).toBe(true);
    expect(setItem).toHaveBeenCalledWith(EDITOR_PREFERENCES_KEY, '{"fontSize":12,"lineHeight":23,"tabSize":4,"wordWrap":false,"inlayHints":true}');
    expect(writeEditorPreferences(DEFAULT_EDITOR_PREFERENCES, { setItem: () => { throw new Error('quota'); } })).toBe(false);
  });

  it('never starts smaller than the interface can be read at', () => {
    /* The reader can size the code column themselves, but what they are given
     * before they choose has to be readable, so it starts no smaller than the
     * floor the rest of the interface is held to. */
    const theme = readFileSync(resolve(process.cwd(), 'src/theme.css'), 'utf8');
    const floor = Number(/--fs-floor:\s*(\d+)px/.exec(theme)?.[1]);
    expect(floor).toBeGreaterThan(0);
    expect(DEFAULT_EDITOR_PREFERENCES.fontSize).toBeGreaterThanOrEqual(floor);
    /* Somebody who wants more code on screen may still choose smaller; what
     * must not happen is a size nobody chose landing below the floor. */
    expect(normalizeEditorPreferences({ fontSize: 4 }).fontSize).toBeGreaterThanOrEqual(floor);
    expect(normalizeEditorPreferences(null).fontSize).toBeGreaterThanOrEqual(floor);
  });

  it('leaves the decoration off for anybody who has never chosen', () => {
    /* A decoration nobody asked for is clutter in the column somebody reads
     * code in, so a stored preference from before this existed stays off. */
    expect(DEFAULT_EDITOR_PREFERENCES.inlayHints).toBe(false);
    expect(readEditorPreferences({ getItem: () => '{"fontSize":14,"lineHeight":24,"tabSize":8,"wordWrap":true}' }).inlayHints).toBe(false);
  });
});
