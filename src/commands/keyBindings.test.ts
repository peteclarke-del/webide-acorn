import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_KEY_BINDINGS, KEY_BINDINGS_STORAGE_KEY, browserReservedNote, chordAssignmentError,
  chordFromEvent, formatChord, keyBindingLookup, normalizeKeyBindingOverrides, parseChord,
  readKeyBindingOverrides, resolveKeyBindings, writeKeyBindingOverrides,
  ariaKeyShortcuts, chordCandidates, chordPrefixes, chordSteps, emulatedKeyboardConflict,
  matchKeyBinding, parseChordSequence,
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
    /* Cmd names the Command key itself now, where it used to fold into the
     * shared Control role. Nothing stored says Cmd — recorded chords come from
     * real key events, which still normalise Command to Ctrl — so this changes
     * what a person can write deliberately and nothing they already have. */
    expect(parseChord('Cmd+/')).toBe('Cmd+/');
    expect(parseChord('Ctrl+/')).toBe('Ctrl+/');
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

describe('telling Command apart from Control', () => {
  it('offers the specific chord before the shared one when Command is pressed', () => {
    /* Command and Control share a role by default, which is what somebody
     * moving between an Apple keyboard and any other expects. A binding that
     * wants one of them specifically had no way to say so while they were
     * collapsed on the way in. */
    expect(chordCandidates({ key: 's', code: 'KeyS', metaKey: true })).toEqual(['Cmd+S', 'Ctrl+S']);
    expect(chordCandidates({ key: 's', code: 'KeyS', ctrlKey: true })).toEqual(['Ctrl+S']);
    expect(chordCandidates({ key: 's', code: 'KeyS', metaKey: true, ctrlKey: true })).toEqual(['Cmd+Ctrl+S', 'Ctrl+S']);
    expect(chordCandidates({ key: 'Shift' })).toEqual([]);
  });

  it('runs the binding that named Command in preference to the shared one', () => {
    const lookup = new Map([['Cmd+S', 'command-save'], ['Ctrl+S', 'shared-save']]);
    expect(matchKeyBinding(lookup, new Set(), chordCandidates({ key: 's', code: 'KeyS', metaKey: true }))).toEqual({ kind: 'command', commandId: 'command-save', chord: 'Cmd+S' });
    expect(matchKeyBinding(lookup, new Set(), chordCandidates({ key: 's', code: 'KeyS', ctrlKey: true }))).toEqual({ kind: 'command', commandId: 'shared-save', chord: 'Ctrl+S' });
  });

  it('still answers a Command press with the shared binding when that is all there is', () => {
    /* Which is every binding this build ships, so nothing changes for anybody
     * who has not asked for the distinction. */
    const lookup = new Map([['Ctrl+S', 'shared-save']]);
    expect(matchKeyBinding(lookup, new Set(), chordCandidates({ key: 's', code: 'KeyS', metaKey: true }))).toMatchObject({ commandId: 'shared-save' });
  });
});

describe('two-stroke sequences', () => {
  it('reads a sequence separated by a comma, and no more than two strokes', () => {
    /* A comma rather than a space, because the chord parser already takes a
     * space between modifiers — "ctrl shift p" is one chord — so a space
     * cannot also mean "then". */
    expect(parseChordSequence('ctrl+k, ctrl+s')).toBe('Ctrl+K, Ctrl+S');
    expect(parseChordSequence('Ctrl+K, S')).toBe('Ctrl+K, S');
    expect(parseChordSequence('Ctrl+K')).toBe('Ctrl+K');
    expect(parseChordSequence('Ctrl+K, S, T')).toBeNull();
    expect(parseChordSequence('Ctrl+, S')).toBeNull();
    expect(chordSteps('Ctrl+K, S')).toEqual(['Ctrl+K', 'S']);
  });

  it('holds the first stroke and then runs the sequence', () => {
    const lookup = new Map([['Ctrl+K, Ctrl+S', 'save-all'], ['Ctrl+S', 'save']]);
    const prefixes = new Set(['Ctrl+K']);
    const held = matchKeyBinding(lookup, prefixes, ['Ctrl+K']);
    expect(held).toEqual({ kind: 'pending', chord: 'Ctrl+K' });
    expect(matchKeyBinding(lookup, prefixes, ['Ctrl+S'], 'Ctrl+K')).toEqual({ kind: 'command', commandId: 'save-all', chord: 'Ctrl+K, Ctrl+S' });
  });

  it('spends a held prefix on whatever follows it, completed or not', () => {
    /* A prefix that survived a stroke it did not complete would be finished off
     * by the next unrelated key, which is the failure that makes people stop
     * trusting sequences. */
    const lookup = new Map([['Ctrl+K, Ctrl+S', 'save-all'], ['Ctrl+S', 'save']]);
    const prefixes = new Set(['Ctrl+K']);
    expect(matchKeyBinding(lookup, prefixes, ['Ctrl+X'], 'Ctrl+K')).toEqual({ kind: 'none' });
    /* And the single-stroke binding does not fire while a prefix is held, or
     * the second stroke would run two commands. */
    expect(matchKeyBinding(lookup, prefixes, ['Ctrl+S'], 'Ctrl+K')).toMatchObject({ commandId: 'save-all' });
  });

  it('lets a second stroke be a bare letter, and never a first one', () => {
    /* A second stroke is only read while a prefix is open, so it captures
     * nothing — which is the whole reason sequences are worth having. */
    expect(chordAssignmentError('Ctrl+K, S')).toBeNull();
    expect(chordAssignmentError('S')).toMatch(/cannot capture ordinary typing/);
    expect(chordAssignmentError('Ctrl+K, Tab')).toBeNull();
    expect(chordAssignmentError('Ctrl+K, Ctrl+Tab')).toMatch(/reserved for focus movement/);
  });

  it('keeps sequences out of the ARIA advertisement', () => {
    /* ARIA has no notation for two strokes, so advertising the first alone
     * would promise a chord that does nothing on its own. */
    const resolved = resolveKeyBindings({ 'workbench.build-active': 'Ctrl+K, Ctrl+B' });
    expect(ariaKeyShortcuts(resolved, 'workbench')).not.toContain('Ctrl+K');
    expect(chordPrefixes(resolved, 'workbench').has('Ctrl+K')).toBe(true);
  });
});

describe('what a running machine does with a chord', () => {
  it('says the chord never arrives, and what the machine types instead', () => {
    /* Established from the pinned jsbeeb: keyDown calls preventDefault before
     * looking at any modifier and passes the key on with Shift alone. */
    expect(emulatedKeyboardConflict('Ctrl+S')).toEqual({
      machineKey: 'S',
      note: expect.stringContaining('The machine receives S instead'),
    });
    expect(emulatedKeyboardConflict('Ctrl+S')?.note).toMatch(/never reaches the workbench/);
    expect(emulatedKeyboardConflict('F10')?.machineKey).toBe('f0');
    expect(emulatedKeyboardConflict('Ctrl+Enter')?.machineKey).toBe('RETURN');
  });

  it('says so plainly when the Acorn keyboard has no such key', () => {
    const conflict = emulatedKeyboardConflict('Ctrl+PageUp');
    expect(conflict?.machineKey).toBeNull();
    expect(conflict?.note).toMatch(/the Acorn keyboard has no PageUp/);
  });

  it('reports a sequence by its first stroke, which is the one that is taken', () => {
    expect(emulatedKeyboardConflict('Ctrl+K, Ctrl+S')?.note).toMatch(/the first stroke of this sequence/);
  });

  it('has nothing to say about an unbound command', () => {
    expect(emulatedKeyboardConflict(null)).toBeNull();
  });
});
