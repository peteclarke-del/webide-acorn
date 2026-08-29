import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_KEY_BINDINGS, KEY_BINDINGS_STORAGE_KEY, browserReservedNote, chordAssignmentError,
  chordFromEvent, formatChord, keyBindingLookup, normalizeKeyBindingOverrides, parseChord,
  readKeyBindingOverrides, resolveKeyBindings, writeKeyBindingOverrides,
  ariaKeyShortcuts,
} from './keyBindings';

describe('key chord normalization', () => {
  it('normalizes events to one canonical modifier order and key name', () => {
    expect(chordFromEvent({ key: 'p', ctrlKey: true, shiftKey: true })).toBe('Ctrl+Shift+P');
    expect(chordFromEvent({ key: 'p', metaKey: true, shiftKey: true })).toBe('Ctrl+Shift+P');
    expect(chordFromEvent({ key: 'F12', ctrlKey: true, altKey: true, shiftKey: true })).toBe('Ctrl+Alt+Shift+F12');
    expect(chordFromEvent({ key: ' ', code: 'Space', ctrlKey: true })).toBe('Ctrl+Space');
    expect(chordFromEvent({ key: 'PageDown', ctrlKey: true, altKey: true })).toBe('Ctrl+Alt+PageDown');
  });

  it('resolves shifted punctuation from the physical key rather than the shifted glyph', () => {
    expect(chordFromEvent({ key: '?', code: 'Slash', ctrlKey: true, shiftKey: true })).toBe('Ctrl+Shift+/');
    expect(chordFromEvent({ key: '/', ctrlKey: true })).toBe('Ctrl+/');
    expect(chordFromEvent({ key: '\\', ctrlKey: true })).toBe('Ctrl+\\');
  });

  it('produces nothing for bare modifiers and unsupported keys', () => {
    expect(chordFromEvent({ key: 'Control', ctrlKey: true })).toBeNull();
    expect(chordFromEvent({ key: 'Shift', shiftKey: true })).toBeNull();
    expect(chordFromEvent({ key: 'Unidentified' })).toBeNull();
    expect(chordFromEvent({ key: '£', ctrlKey: true })).toBeNull();
  });

  it('parses typed text with either separator, platform modifier name or alias', () => {
    expect(parseChord('ctrl shift p')).toBe('Ctrl+Shift+P');
    expect(parseChord('Cmd+/')).toBe('Ctrl+/');
    expect(parseChord('option+shift+f')).toBe('Alt+Shift+F');
    expect(parseChord('ctrl+alt+pgup')).toBe('Ctrl+Alt+PageUp');
    expect(parseChord('ctrl+a+b')).toBeNull();
    expect(parseChord('ctrl')).toBeNull();
    expect(parseChord(42)).toBeNull();
  });

  it('renames only the Ctrl role for Apple platforms', () => {
    expect(formatChord('Ctrl+Shift+P', 'MacIntel')).toBe('Cmd+Shift+P');
    expect(formatChord('Ctrl+Shift+P', 'Linux x86_64')).toBe('Ctrl+Shift+P');
    expect(formatChord('Alt+F8', 'MacIntel')).toBe('Alt+F8');
    expect(formatChord(null, 'Linux x86_64')).toBe('Unbound');
  });
});

describe('chord assignment rules', () => {
  it('refuses chords that would capture ordinary typing', () => {
    expect(chordAssignmentError('Ctrl+Alt+B')).toBeNull();
    expect(chordAssignmentError('F8')).toBeNull();
    expect(chordAssignmentError('Shift+F12')).toBeNull();
    expect(chordAssignmentError('A')).toMatch(/Ctrl, Alt or a function key/);
    expect(chordAssignmentError('Shift+A')).toMatch(/Ctrl, Alt or a function key/);
    expect(chordAssignmentError('Ctrl+Tab')).toMatch(/focus movement/);
    expect(chordAssignmentError('ctrl+shift+p')).toMatch(/supported key/);
  });

  it('reports likely host ownership without refusing the assignment', () => {
    expect(browserReservedNote('Ctrl+W')).toMatch(/close the tab/);
    expect(chordAssignmentError('Ctrl+W')).toBeNull();
    expect(browserReservedNote('Ctrl+Alt+B')).toBeNull();
  });
});

describe('binding inventory', () => {
  it('declares unique ids and only assignable default chords', () => {
    const ids = DEFAULT_KEY_BINDINGS.map((binding) => binding.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const binding of DEFAULT_KEY_BINDINGS) {
      expect(parseChord(binding.defaultChord)).toBe(binding.defaultChord);
      expect(chordAssignmentError(binding.defaultChord)).toBeNull();
    }
  });

  it('has no default chord claimed by two different commands in one scope', () => {
    const conflicts = resolveKeyBindings().filter((binding) => binding.conflicts.length);
    expect(conflicts.map((binding) => `${binding.id} ${binding.chord}`)).toEqual([]);
  });
});

describe('override resolution', () => {
  it('applies, unbinds and reports the source of each effective chord', () => {
    const resolved = resolveKeyBindings({ 'workbench.build-active': 'Ctrl+Alt+9', 'editor.join-lines': null });
    const build = resolved.find((binding) => binding.id === 'workbench.build-active')!;
    const join = resolved.find((binding) => binding.id === 'editor.join-lines')!;
    const untouched = resolved.find((binding) => binding.id === 'workbench.run-active')!;
    expect(build).toMatchObject({ chord: 'Ctrl+Alt+9', source: 'custom' });
    expect(join).toMatchObject({ chord: null, source: 'unbound' });
    expect(untouched).toMatchObject({ chord: 'F5', source: 'default' });
  });

  it('reports same-scope conflicts and editor bindings that hide a workbench chord', () => {
    const resolved = resolveKeyBindings({ 'workbench.build-active': 'F5', 'editor.join-lines': 'Ctrl+G' });
    const build = resolved.find((binding) => binding.id === 'workbench.build-active')!;
    const run = resolved.find((binding) => binding.id === 'workbench.run-active')!;
    const join = resolved.find((binding) => binding.id === 'editor.join-lines')!;
    expect(build.conflicts).toContain('workbench.run-active');
    expect(run.conflicts).toContain('workbench.build-active');
    expect(join.conflicts).toEqual([]);
    expect(join.shadows).toEqual(['workbench.editor-go-line']);
  });

  it('does not treat an alternate chord for the same command as a conflict', () => {
    const redo = resolveKeyBindings().filter((binding) => binding.commandId === 'editor-redo');
    expect(redo).toHaveLength(2);
    expect(redo.flatMap((binding) => binding.conflicts)).toEqual([]);
  });

  it('discards unknown ids, unassignable chords and redundant default restatements', () => {
    expect(normalizeKeyBindingOverrides({ 'not.a.binding': 'Ctrl+K' })).toEqual({});
    expect(normalizeKeyBindingOverrides({ 'workbench.build-active': 'Q' })).toEqual({});
    expect(normalizeKeyBindingOverrides({ 'workbench.build-active': 'F7' })).toEqual({});
    expect(normalizeKeyBindingOverrides({ 'workbench.build-active': 'ctrl alt 7' })).toEqual({ 'workbench.build-active': 'Ctrl+Alt+7' });
    expect(normalizeKeyBindingOverrides({ 'workbench.build-active': null })).toEqual({ 'workbench.build-active': null });
    expect(normalizeKeyBindingOverrides(['Ctrl+K'])).toEqual({});
  });
});

describe('scoped dispatch lookup', () => {
  it('maps each scope chord to exactly one command', () => {
    const resolved = resolveKeyBindings();
    const workbench = keyBindingLookup(resolved, 'workbench');
    const editor = keyBindingLookup(resolved, 'editor');
    expect(workbench.get('Ctrl+Shift+P')).toBe('palette-open');
    expect(workbench.get('F1')).toBe('palette-open');
    expect(workbench.get('Ctrl+Shift+F')).toBe('editor-search-project');
    expect(workbench.has('Ctrl+F')).toBe(false);
    expect(editor.get('Ctrl+F')).toBe('editor-find');
    expect(editor.get('Ctrl+Shift+Z')).toBe('editor-redo');
    expect(editor.has('Ctrl+Shift+F')).toBe(false);
  });

  it('omits unbound chords from dispatch', () => {
    const editor = keyBindingLookup(resolveKeyBindings({ 'editor.find': null }), 'editor');
    expect(editor.has('Ctrl+F')).toBe(false);
  });
});

describe('persistence', () => {
  it('reads a versioned envelope and recovers from malformed storage', () => {
    expect(readKeyBindingOverrides({ getItem: () => '{"version":1,"overrides":{"workbench.build-active":"Ctrl+Alt+7"}}' })).toEqual({ 'workbench.build-active': 'Ctrl+Alt+7' });
    expect(readKeyBindingOverrides({ getItem: () => '{broken' })).toEqual({});
    expect(readKeyBindingOverrides({ getItem: () => null })).toEqual({});
  });

  it('writes only the normalized envelope and reports storage refusal', () => {
    const setItem = vi.fn();
    expect(writeKeyBindingOverrides({ 'workbench.build-active': 'Ctrl+Alt+7', 'bogus': 'Ctrl+K' }, { setItem })).toBe(true);
    expect(setItem).toHaveBeenCalledWith(KEY_BINDINGS_STORAGE_KEY, '{"version":1,"overrides":{"workbench.build-active":"Ctrl+Alt+7"}}');
    expect(writeKeyBindingOverrides({}, { setItem: () => { throw new Error('quota'); } })).toBe(false);
  });
});

describe('assistive-technology advertisement', () => {
  it('announces only the chords that are actually dispatched, in ARIA key names', () => {
    const announced = ariaKeyShortcuts(resolveKeyBindings(), 'editor').split(' ');
    expect(announced).toContain('Control+Alt+B');
    expect(announced).toContain('Alt+Shift+F8');
    expect(announced).toContain('F12');
    expect(announced.some((chord) => chord.startsWith('Ctrl+'))).toBe(false);
    expect(new Set(announced).size).toBe(announced.length);
  });

  it('drops an unbound chord and follows a remapped one', () => {
    const remapped = resolveKeyBindings({ 'editor.goto-definition': 'Ctrl+Alt+D', 'editor.bookmark-toggle': null });
    const announced = ariaKeyShortcuts(remapped, 'editor').split(' ');
    expect(announced).toContain('Control+Alt+D');
    expect(announced).not.toContain('F12');
    expect(announced).not.toContain('Control+Alt+B');
  });
});
